/**
 * Uzay Savaşı & Koloni Baskını saf muharebe fiziği:
 *  - 12 roket silahı (makineli, çift top, kuşatma topu, şarapnel, raylı top, lazerler, plazma, roket, güdümlü füze, torpido, EMP)
 *  - Parça bazlı roket hasarı, enerji kalkanları ve yapısal kopma
 *  - Yüzey koloni binalarının hasar görmesi, kalkan kubbeleri, uçaksavar/SAM taret savunması ve koloni imhası
 */
import {
  baseReport,
  COLONY_SLOTS,
  COLONY_STATION_ID,
  colonyHealthSummary,
  colonyShieldCap,
  ensureSiteHp,
  ensureSites,
  MODULE_BY_ID,
  syncModules,
} from '../game/base'
import { partDef, partMaxHp } from '../game/data'
import type {
  Base,
  GameEvent,
  GameState,
  MultiplayerPlayer,
  LootCrate,
  PartInst,
  Projectile,
  Vessel,
} from '../game/types'
import { adjacency, arcade, cargoMass, components, partAlive, vesselStats } from '../game/vessel'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import { bodyAbsState, len, wrapPi } from './orbit'
import { type Controls, terrainHeight } from './physics'
import type { Fx } from './world'

const MAX_PROJECTILES = 160
const COLONY_COMPACT_OFFSET = 20
const COLONY_COMPACT_STEP = 10
const COLONY_STD_OFFSET = 28
const COLONY_STD_STEP = 13

export interface ColonyEntry {
  ownerId: string
  bodyId: BodyId
  base: Base
  isEarth: boolean
}

/** Silahların ve muharebe kurallarının açık olduğu çok oyunculu modlar (Uzay Savaşı ve Yağma). */
export function isWarfareMode(gs: GameState): boolean {
  return gs.mp?.config.mode === 'orbital-warfare' || gs.mp?.config.mode === 'loot-raid'
}

/** Yağma modu: uzay üsleri, kaynak sahaları, sandık toplama ve arcade uçuş. */
export function isLootMode(gs: GameState): boolean {
  return gs.mp?.config.mode === 'loot-raid'
}

/** Canı bu oranın altına (−maxHp·oran) inen devre dışı parça gövdeden kopar. */
export const BREAKOFF_RATIO = 0.75
/** 1 t ganimetin üsse teslim değeri (₡). */
export const LOOT_VALUE_PER_TON = 2500
const MAX_CRATES = 90

/** Yağma modunda uzaya ganimet sandıkları bırakır (en fazla 2 t'luk sandıklara bölünür). */
export function dropLoot(
  gs: GameState,
  pos: { x: number; y: number },
  vel: { x: number; y: number },
  tons: number,
  clock: number,
  site = -1,
): LootCrate[] {
  const loot = gs.mp?.loot
  if (!loot || tons < 0.05) return []
  const out: LootCrate[] = []
  const n = Math.max(1, Math.min(10, Math.ceil(tons / 2)))
  for (let k = 0; k < n; k += 1) {
    const ang = (k / n) * Math.PI * 2 + loot.nextCrateId * 1.7
    const spread = n > 1 ? 10 + 6 * (k % 3) : 0
    const c: LootCrate = {
      id: loot.nextCrateId,
      pos: { x: pos.x + Math.cos(ang) * spread, y: pos.y + Math.sin(ang) * spread },
      vel: { x: vel.x * 0.5 + Math.cos(ang) * (n > 1 ? 6 : 0), y: vel.y * 0.5 + Math.sin(ang) * (n > 1 ? 6 : 0) },
      tons: Math.round((tons / n) * 100) / 100,
      site,
      born: clock,
    }
    loot.nextCrateId += 1
    loot.crates.push(c)
    out.push(c)
  }
  if (loot.crates.length > MAX_CRATES) loot.crates.splice(0, loot.crates.length - MAX_CRATES)
  return out
}

function hasCommandPart(v: Vessel): boolean {
  if (v.outpost) return true
  return v.parts.some((p) => partDef(p.def).kind === 'command')
}

function pushProjectile(projs: Projectile[], proj: Projectile) {
  if (projs.length >= MAX_PROJECTILES) {
    // Önce yüksek değerli torpido/güdümlü füze yerine sıradan mermileri düşür
    const dropIdx = projs.findIndex((p) => p.kind !== 'torpedo' && p.kind !== 'missile')
    if (dropIdx >= 0) projs.splice(dropIdx, 1)
    else projs.shift()
  }
  projs.push(proj)
}

export function colonySlotOffset(slot: number, compact: boolean): number {
  return (compact ? COLONY_COMPACT_OFFSET : COLONY_STD_OFFSET) + slot * (compact ? COLONY_COMPACT_STEP : COLONY_STD_STEP)
}

/** Yüzeydeki bir koloni yuvasının gövde-merkezli dünya koordinatlarını döndürür. */
export function colonySlotWorldPos(
  bodyId: BodyId,
  siteAngle: number,
  slot: number,
  compact = false,
  heightAboveSurf = 4,
): { x: number; y: number } {
  const offset = colonySlotOffset(slot, compact)
  const r = BODIES[bodyId].radius + terrainHeight(bodyId, siteAngle) + heightAboveSurf
  const up = { x: Math.cos(siteAngle), y: Math.sin(siteAngle) }
  const tan = { x: Math.sin(siteAngle), y: -Math.cos(siteAngle) }
  return {
    x: up.x * r + tan.x * offset,
    y: up.y * r + tan.y * offset,
  }
}

export function colonyCenterWorldPos(bodyId: BodyId, siteAngle: number, compact = false): { x: number; y: number } {
  return colonySlotWorldPos(bodyId, siteAngle, 3.5, compact, 4)
}

export function allColoniesOnBody(gs: GameState, bodyId: BodyId): ColonyEntry[] {
  const out: ColonyEntry[] = []
  if (gs.mp) {
    if (bodyId === 'earth') {
      for (const p of Object.values(gs.mp.players)) {
        if (p.earthBase) out.push({ ownerId: p.id, bodyId: 'earth', base: p.earthBase, isEarth: true })
      }
      return out
    }
    if (isWarfareMode(gs)) {
      for (const p of Object.values(gs.mp.players)) {
        const b = p.colonies?.[bodyId]
        if (b) out.push({ ownerId: p.id, bodyId, base: b, isEarth: false })
      }
      return out
    }
    const shared = gs.bases[bodyId]
    if (shared && shared.ownerId) out.push({ ownerId: shared.ownerId, bodyId, base: shared, isEarth: false })
    return out
  }
  const b = gs.bases[bodyId]
  if (b) out.push({ ownerId: b.ownerId ?? gs.ownerId ?? 'local', bodyId, base: b, isEarth: bodyId === 'earth' })
  return out
}

export function countSurvivingColonies(p: MultiplayerPlayer): number {
  let n = 0
  if (p.earthBase && !p.earthBase.destroyed && colonyHealthSummary(p.earthBase).buildings > 0) n += 1
  if (p.colonies) {
    for (const b of Object.values(p.colonies)) {
      if (b && !b.destroyed && colonyHealthSummary(b).buildings > 0) n += 1
    }
  }
  return n
}

function getProjList(gs: GameState): Projectile[] {
  if (gs.mp) return (gs.mp.projectiles ??= [])
  return (gs.projectiles ??= [])
}

function nextProjId(gs: GameState): number {
  if (gs.mp) {
    const id = gs.mp.nextProjId ?? 1
    gs.mp.nextProjId = id + 1
    return id
  }
  const id = gs.nextProjId ?? 1
  gs.nextProjId = id + 1
  return id
}

function pushFx(fxOut: Fx[] | undefined, fx: Fx) {
  if (!fxOut) return
  fxOut.push(fx)
  if (fxOut.length > 90) fxOut.splice(0, fxOut.length - 90)
}

function awardScore(gs: GameState, attackerId: string | undefined, pts: number, bounty = 0) {
  if (!gs.mp || !attackerId) return
  const p = gs.mp.players[attackerId]
  if (!p) return
  p.score = (p.score ?? 0) + pts
  if (bounty > 0) {
    p.money += bounty
    if (gs.ownerId === p.id) gs.money = p.money
  }
}

export function pushFeed(gs: GameState, text: string, color?: string) {
  if (!gs.mp) return
  const last = gs.mp.feed[gs.mp.feed.length - 1]
  const id = (last?.id ?? 0) + 1
  gs.mp.feed.push({ id, time: gs.time, text, color })
  if (gs.mp.feed.length > 24) gs.mp.feed.splice(0, gs.mp.feed.length - 24)
}

function partWorldPos(v: Vessel, st: ReturnType<typeof vesselStats>, p: PartInst) {
  const d = partDef(p.def)
  const lx = p.x + d.w / 2 - st.comX
  const lf = -(p.y + d.h / 2 - st.comY)
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  return { x: v.pos.x + fwd.y * lx + fwd.x * lf, y: v.pos.y - fwd.x * lx + fwd.y * lf }
}

/** Dünya noktasının araçtaki en yakın parça indeksini ve mesafesini döndürür. */
export function closestPartOnVessel(
  v: Vessel,
  st: ReturnType<typeof vesselStats>,
  wx: number,
  wy: number,
): { idx: number; dist: number } {
  const dx = wx - v.pos.x
  const dy = wy - v.pos.y
  const fwdX = Math.cos(v.angle)
  const fwdY = Math.sin(v.angle)
  const lx = dx * fwdY - dy * fwdX
  const lf = dx * fwdX + dy * fwdY
  const gx = lx + st.comX
  const gy = -lf + st.comY

  let best = -1
  let bestD = Infinity
  for (let i = 0; i < v.parts.length; i += 1) {
    const p = v.parts[i]!
    const d = partDef(p.def)
    const ox = Math.max(p.x - gx, 0, gx - (p.x + d.w))
    const oy = Math.max(p.y - gy, 0, gy - (p.y + d.h))
    const dist = Math.hypot(ox, oy)
    if (dist < bestD) {
      bestD = dist
      best = i
    }
  }
  return { idx: best, dist: bestD }
}

function distSegPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): { dist: number; t: number; cx: number; cy: number } {
  const vx = bx - ax
  const vy = by - ay
  const vv = vx * vx + vy * vy
  const t = vv > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / vv)) : 0
  const cx = ax + vx * t
  const cy = ay + vy * t
  return { dist: Math.hypot(px - cx, py - cy), t, cx, cy }
}

/** Doğru parçasının (ax,ay)->(bx,by) roket parçalarından birine çarpıp çarpmadığını kontrol eder. */
function hitTestVesselSegment(
  v: Vessel,
  st: ReturnType<typeof vesselStats>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfRadius = 0,
): { hit: boolean; t: number; x: number; y: number } | null {
  const rad = Math.max(1.8, Math.hypot(st.maxX - st.minX, st.maxY - st.minY) * 0.56)
  const broad = distSegPoint(ax, ay, bx, by, v.pos.x, v.pos.y)
  if (broad.dist > rad + 1.5 + halfRadius) return null

  const segLen = Math.hypot(bx - ax, by - ay)
  const localRadius = rad + 2.2 + halfRadius
  const tHalf = segLen > 1e-6 ? localRadius / segLen : 1
  const t0 = Math.max(0, broad.t - tHalf)
  const t1 = Math.min(1, broad.t + tHalf)
  const spanLen = Math.max(1, (t1 - t0) * segLen)
  const samples = Math.max(4, Math.min(40, Math.ceil(spanLen / 0.85)))
  const hitTol = 0.65 + halfRadius
  for (let s = 0; s <= samples; s += 1) {
    const t = t0 + ((t1 - t0) * s) / samples
    const px = ax + (bx - ax) * t
    const py = ay + (by - ay) * t
    const cp = closestPartOnVessel(v, st, px, py)
    if (cp.idx >= 0 && cp.dist <= hitTol) {
      return { hit: true, t, x: px, y: py }
    }
  }
  return null
}

function spawnDebrisPiece(gs: GameState, v: Vessel, p: PartInst, wx: number, wy: number, k: number) {
  const id = gs.nextId
  gs.nextId += 1
  const ang = Math.atan2(wy - v.pos.y, wx - v.pos.x) + (k - 1) * 0.45
  gs.vessels.push({
    id,
    name: `Enkaz ${id}`,
    ownerId: v.ownerId,
    parts: [{ ...p, x: 0, y: 0 }],
    bodyId: v.bodyId,
    pos: { x: wx, y: wy },
    vel: { x: v.vel.x + Math.cos(ang) * 14, y: v.vel.y + Math.sin(ang) * 14 },
    angle: v.angle,
    angVel: v.angVel + (k % 2 ? 4 : -4),
    landed: false,
    throttle: 0,
    ec: 0,
    cargo: { modules: {}, ore: 0, oreFrom: null },
    rcsOn: false,
    sas: 'off',
    visited: [],
    assist: null,
    dvUsed: 0,
    noCollideUntil: gs.time + 0.8,
    debris: { ttl: 3.5 + (k % 3) },
  })
}

/** Ana gövdeden kopan çok parçalı bölüm: parçaları bir arada, kendi kütle merkezinde sürüklenen enkaz. */
function spawnWreck(gs: GameState, v: Vessel, st: ReturnType<typeof vesselStats>, piece: PartInst[], k: number) {
  if (!piece.length) return
  const pst = vesselStats(piece)
  const lx = pst.comX - st.comX
  const lf = -(pst.comY - st.comY)
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  const pos = { x: v.pos.x + fwd.y * lx + fwd.x * lf, y: v.pos.y - fwd.x * lx + fwd.y * lf }
  const ang = Math.atan2(pos.y - v.pos.y, pos.x - v.pos.x)
  const id = gs.nextId
  gs.nextId += 1
  gs.vessels.push({
    id,
    name: `Enkaz ${id}`,
    ownerId: v.ownerId,
    parts: piece.map((p) => ({ ...p, on: false })),
    bodyId: v.bodyId,
    pos,
    vel: { x: v.vel.x + Math.cos(ang) * 9, y: v.vel.y + Math.sin(ang) * 9 },
    angle: v.angle,
    angVel: v.angVel + (k % 2 ? 0.9 : -0.9),
    landed: false,
    throttle: 0,
    ec: 0,
    cargo: { modules: {}, ore: 0, oreFrom: null },
    rcsOn: false,
    sas: 'off',
    visited: [],
    assist: null,
    dvUsed: 0,
    noCollideUntil: gs.time + 2.5,
    debris: { ttl: 14 + (k % 3) * 2 },
  })
}

export function applyVesselDamage(
  gs: GameState,
  v: Vessel,
  hitX: number,
  hitY: number,
  dmg: number,
  opts: {
    attackerId?: string
    shieldMult?: number
    shieldFlat?: number
    shieldPierce?: number
    splash?: number
    empDrain?: number
    empStun?: number
    burnDot?: number
    resetCharge?: boolean
    silent?: boolean
    clock: number
    firing: Map<number, Map<number, number>>
    fxOut?: Fx[]
    events: GameEvent[]
  },
): { destroyed: boolean; colonyStaticDirty: boolean } {
  if (!gs.vessels.includes(v) || v.debris || v.station) return { destroyed: false, colonyStaticDirty: false }
  if (v.spawnShieldUntil && opts.clock < v.spawnShieldUntil) {
    pushFx(opts.fxOut, { kind: 'shield', bodyId: v.bodyId, x: v.pos.x, y: v.pos.y, born: opts.clock, size: 6, color: '#60a5fa' })
    return { destroyed: false, colonyStaticDirty: false }
  }

  const st = vesselStats(v.parts, v.cargo)
  const hadCommand = st.hasCommand
  if (opts.attackerId && opts.attackerId !== v.ownerId) v.lastAttackerId = opts.attackerId

  if (opts.empDrain) {
    v.ec = Math.max(0, v.ec - opts.empDrain)
  }
  if (opts.empStun) {
    v.empUntil = Math.max(v.empUntil ?? 0, opts.clock + opts.empStun)
    v.shieldRegenAt = opts.clock + opts.empStun + 3.5
  }
  if (opts.resetCharge) {
    for (const p of v.parts) {
      if (!partDef(p.def).weapon) continue
      p.charge = 0
      p.beamUntil = 0
      p.burstLeft = 0
      p.cd = Math.max(p.cd ?? 0, 1.8)
    }
  }

  let hullDmg = dmg
  if (v.shield && v.shield > 0) {
    const pierce = Math.max(0, Math.min(1, opts.shieldPierce ?? 0))
    const direct = dmg * pierce
    const shieldPoolDmg = dmg * (1 - pierce) * (opts.shieldMult ?? 1) + (opts.shieldFlat ?? 0)
    if (shieldPoolDmg <= v.shield) {
      v.shield -= shieldPoolDmg
      hullDmg = direct
    } else {
      const overflowRatio = Math.max(0, 1 - v.shield / Math.max(1e-6, shieldPoolDmg))
      v.shield = 0
      hullDmg = direct + dmg * (1 - pierce) * overflowRatio
    }
    v.shieldRegenAt = opts.clock + 4.0
    if (!opts.silent && shieldPoolDmg > 0.05) {
      pushFx(opts.fxOut, { kind: 'shield', bodyId: v.bodyId, x: hitX, y: hitY, born: opts.clock, size: Math.max(5, st.maxY - st.minY), color: '#38d9e8' })
      opts.events.push({ type: 'shieldHit', bodyId: v.bodyId, x: hitX, y: hitY })
    }
  }

  if (opts.burnDot && hullDmg > 0.05) {
    v.burnUntil = Math.max(v.burnUntil ?? 0, opts.clock + opts.burnDot)
  }

  if (hullDmg <= 1e-4) return { destroyed: false, colonyStaticDirty: false }

  const splash = opts.splash ?? 0
  const adj = adjacency(v.parts)
  const wasAlive = v.parts.map(partAlive)
  /** Zırh sertliği: her isabetten sabit hasar siler (sürekli yanma hasarında uygulanmaz). */
  const soak = (i: number, amount: number) => {
    const p = v.parts[i]!
    const ar = partDef(p.def).armor
    if (p.hp === undefined) p.hp = partMaxHp(p.def)
    const taken = ar && partAlive(p) && !opts.silent ? Math.max(amount * 0.2, amount - ar.hardness) : amount
    p.hp -= taken
  }
  /** Parçaya hasar: bitişikteki sağlam zırh plakaları hasarın bir kısmını üstlenir. */
  const hurt = (i: number, amount: number) => {
    if (amount <= 0) return
    const d = partDef(v.parts[i]!.def)
    let direct = amount
    if (!d.armor) {
      const plates = adj[i]!.filter((j) => partDef(v.parts[j]!.def).armor && partAlive(v.parts[j]!))
      if (plates.length) {
        const absorb = Math.max(...plates.map((j) => partDef(v.parts[j]!.def).armor!.absorb))
        const share = amount * absorb
        direct = amount - share
        for (const j of plates) soak(j, share / plates.length)
      }
    }
    soak(i, direct)
  }

  let nearestWasSplashed = false
  const nearest = closestPartOnVessel(v, st, hitX, hitY)
  for (let i = 0; i < v.parts.length; i += 1) {
    const p = v.parts[i]!
    const w = partWorldPos(v, st, p)
    const d = Math.hypot(w.x - hitX, w.y - hitY)
    let mult = 0
    if (splash > 0) {
      if (d <= splash) mult = Math.max(0.25, 1 - (d / splash) * 0.75)
    }
    if (mult > 0) {
      if (i === nearest.idx) nearestWasSplashed = true
      hurt(i, hullDmg * mult)
    }
  }
  // Doğrudan en yakın parçaya tam darbe (splash dışı veya merkez isabet)
  if (nearest.idx >= 0 && !nearestWasSplashed) {
    if (splash <= 0 || nearest.dist < 2.2) hurt(nearest.idx, hullDmg)
  }

  if (!opts.silent) {
    pushFx(opts.fxOut, { kind: 'hit', bodyId: v.bodyId, x: hitX, y: hitY, born: opts.clock, size: Math.min(8, 2.5 + hullDmg * 0.03), color: '#ffad57' })
  }

  // Yeni devre dışı kalan parçalar: işlevini yitirir ama gövdede kalır.
  // Dolu yakıt tankı patlar: yakıtı yok olur, komşu parçalara ikincil hasar verir (zincirleme en fazla 3 tur).
  let anyDisabled = false
  let wave = v.parts.map((_, i) => i).filter((i) => wasAlive[i] && !partAlive(v.parts[i]!))
  for (let round = 0; round < 3 && wave.length; round += 1) {
    anyDisabled = true
    const before = v.parts.map(partAlive)
    for (const i of wave) {
      const p = v.parts[i]!
      const d = partDef(p.def)
      const w = partWorldPos(v, st, p)
      p.charge = 0
      p.beamUntil = 0
      p.burstLeft = 0
      if (d.kind === 'tank') {
        const lost = p.fuel ?? 0
        p.fuel = 0
        if (lost > 0.3) {
          const blast = Math.min(140, 25 + lost * 16)
          pushFx(opts.fxOut, { kind: 'boom', bodyId: v.bodyId, x: w.x, y: w.y, born: opts.clock, size: 3 + Math.min(5, lost * 0.5) })
          opts.events.push({ type: 'explosion', size: 3 + Math.min(5, lost * 0.5), bodyId: v.bodyId, x: w.x, y: w.y })
          for (const j of adj[i]!) hurt(j, blast)
        }
      } else {
        pushFx(opts.fxOut, { kind: 'boom', bodyId: v.bodyId, x: w.x, y: w.y, born: opts.clock, size: 2.4 })
        opts.events.push({ type: 'explosion', size: 2.4, bodyId: v.bodyId, x: w.x, y: w.y })
      }
    }
    wave = v.parts.map((_, i) => i).filter((i) => before[i] && !partAlive(v.parts[i]!))
  }

  // Yapısal kopma: yalnızca tamamen ezilen (−maxHp·BREAKOFF_RATIO) parçalar gövdeden ayrılır.
  const torn = v.parts.filter((p) => (p.hp ?? 1) <= -partMaxHp(p.def) * BREAKOFF_RATIO)
  if (!anyDisabled && !torn.length) return { destroyed: false, colonyStaticDirty: false }

  if (torn.length) {
    torn.forEach((p, k) => {
      const w = partWorldPos(v, st, p)
      pushFx(opts.fxOut, { kind: 'boom', bodyId: v.bodyId, x: w.x, y: w.y, born: opts.clock, size: 3.2 })
      opts.events.push({ type: 'explosion', size: 3.2, bodyId: v.bodyId, x: w.x, y: w.y })
      if (k < 4) spawnDebrisPiece(gs, v, p, w.x, w.y, k)
    })
    const rest = v.parts.filter((p) => !torn.includes(p))
    const group = components(rest)
    const isCmd = (p: PartInst) => partDef(p.def).kind === 'command'
    // Çapa: sağlam komuta modülü; üslerde çekirdek; yoksa devre dışı komuta; o da yoksa en büyük gövde.
    let anchor = rest.findIndex((p) => isCmd(p) && partAlive(p))
    if (anchor < 0 && v.outpost) anchor = rest.findIndex((p) => p.def === 'base-core')
    if (anchor < 0) anchor = rest.findIndex(isCmd)
    let keepGroup = anchor >= 0 ? group[anchor]! : -1
    if (keepGroup < 0 && rest.length) {
      const sizes = new Map<number, number>()
      for (const g of group) sizes.set(g, (sizes.get(g) ?? 0) + 1)
      keepGroup = [...sizes.entries()].sort((x, y) => y[1] - x[1])[0]![0]
    }
    // Ana gövdeden kopan her bölüm tek tek dağılmaz: bütün hâlde sürüklenen bir enkaz olur.
    const groupIds = [...new Set(group)].filter((g) => g !== keepGroup)
    groupIds.forEach((g, k) => {
      const piece = rest.filter((_, i) => group[i] === g)
      if (k < 5) spawnWreck(gs, v, st, piece, k)
    })
    v.parts = rest.filter((_, i) => group[i] === keepGroup)
  }

  const st2 = vesselStats(v.parts, v.cargo)
  v.ec = Math.min(v.ec, st2.ecCap)
  if (v.shield !== undefined) v.shield = Math.min(v.shield, st2.shieldCap)
  // Kargo gövdesi giderse sığmayan yük uzaya saçılır (Yağma modunda sandık olarak toplanabilir).
  const over = cargoMass(v.cargo) - st2.cargoCap
  if (over > 1e-9) {
    const spill = Math.min(v.cargo.ore, over)
    if (spill > 0) {
      v.cargo.ore -= spill
      dropLoot(gs, { x: hitX, y: hitY }, v.vel, spill, opts.clock)
    }
    if (cargoMass(v.cargo) > st2.cargoCap + 1e-9) v.cargo = { modules: {}, ore: v.cargo.ore, oreFrom: v.cargo.oreFrom }
    if (v.cargo.ore <= 1e-9) v.cargo.oreFrom = null
  }

  if (v.outpost || !hadCommand || st2.hasCommand) return { destroyed: false, colonyStaticDirty: false }

  // Komuta modülü yok oldu: gemi patlamaz, kontrolsüz bir enkaza dönüşür (kargosu etrafa saçılır).
  const wasActive = gs.activeId === v.id
  opts.firing.delete(v.id)
  if (wasActive) gs.activeId = null
  if (gs.mp) {
    for (const pl of Object.values(gs.mp.players)) {
      if (pl.activeVesselId === v.id) pl.activeVesselId = null
    }
    if (isWarfareMode(gs) && opts.attackerId && opts.attackerId !== v.ownerId) {
      const atk = gs.mp.players[opts.attackerId]
      const vic = v.ownerId ? gs.mp.players[v.ownerId] : undefined
      if (atk) {
        atk.kills += 1
        awardScore(gs, atk.id, 2, 3500)
      }
      const msg = `💥 ${atk?.username ?? opts.attackerId}, ${vic?.username ?? v.name} roketini imha etti (+3.500 ₡)!`
      pushFeed(gs, msg, atk?.color)
      opts.events.push({ type: 'kill', attackerId: opts.attackerId, victimId: v.ownerId ?? null, victimName: v.name, speed: 0 })
    }
  }
  if (isLootMode(gs)) {
    dropLoot(gs, v.pos, v.vel, v.cargo.ore + (st.cost * 0.2) / LOOT_VALUE_PER_TON, opts.clock)
  }
  v.cargo = { modules: {}, ore: 0, oreFrom: null }
  v.debris = { ttl: 22 }
  v.throttle = 0
  v.autopilot = 'off'
  v.autoLand = false
  v.shield = 0
  v.angVel += 0.6
  pushFx(opts.fxOut, { kind: 'boom', bodyId: v.bodyId, x: v.pos.x, y: v.pos.y, born: opts.clock, size: 8.5 })
  opts.events.push({ type: 'explosion', size: 8.5, bodyId: v.bodyId, x: v.pos.x, y: v.pos.y })
  opts.events.push({ type: 'crash', name: v.name, wasActive, reason: 'ateş altında imha edildi', ownerId: v.ownerId, vesselId: v.id })
  return { destroyed: true, colonyStaticDirty: false }
}

/**
 * Çarpışma darbesi: tüm gemiyi rastgele parçalamak yerine temas noktasının çevresindeki
 * parçalara hasar verir. Motor tarafından çarpan gemi motorunu, burundan çarpan burnunu kaybeder.
 */
export function applyImpactDamage(
  gs: GameState,
  v: Vessel,
  hitX: number,
  hitY: number,
  shockSpeed: number,
  opts: { attackerId?: string; clock: number; firing: Map<number, Map<number, number>>; fxOut?: Fx[]; events: GameEvent[] },
): { destroyed: boolean } {
  const dmg = Math.min(9000, 2.2 * shockSpeed ** 1.6) * (v.outpost ? 0.4 : 1)
  const res = applyVesselDamage(gs, v, hitX, hitY, dmg, {
    ...opts,
    shieldPierce: 0.6,
    splash: 2.5 + Math.min(14, shockSpeed * 0.09),
  })
  return { destroyed: res.destroyed }
}

/** Bir koloniye (kalkan kubbesine veya belirli yuvadaki binalara) hasar uygular. */
export function applyColonyDamage(
  gs: GameState,
  entry: ColonyEntry,
  hitX: number,
  hitY: number,
  dmg: number,
  opts: {
    attackerId?: string
    colonyMult?: number
    shieldMult?: number
    shieldFlat?: number
    shieldPierce?: number
    splash?: number
    empStun?: number
    clock: number
    fxOut?: Fx[]
    events: GameEvent[]
  },
): boolean {
  const { base, bodyId, ownerId } = entry
  if (base.destroyed) return false
  const compact = isWarfareMode(gs)
  const sites = ensureSites(base)
  const hps = ensureSiteHp(base)

  let touched = false
  if (opts.empStun) {
    base.stunUntil = Math.max(base.stunUntil ?? 0, opts.clock + opts.empStun)
    base.shieldRegenAt = opts.clock + opts.empStun + 4.0
    touched = true
  }

  let remDmg = dmg * (opts.colonyMult ?? 1)
  if (base.shield && base.shield > 0) {
    const pierce = Math.max(0, Math.min(1, opts.shieldPierce ?? 0))
    const direct = remDmg * pierce
    const sDmg = remDmg * (1 - pierce) * (opts.shieldMult ?? 1) + (opts.shieldFlat ?? 0)
    if (sDmg <= base.shield) {
      base.shield -= sDmg
      remDmg = direct
    } else {
      const over = 1 - base.shield / Math.max(1e-6, sDmg)
      base.shield = 0
      remDmg = direct + remDmg * (1 - pierce) * over
    }
    base.shieldRegenAt = opts.clock + 5.0
    touched = true
    const center = colonyCenterWorldPos(bodyId, base.siteAngle, compact)
    pushFx(opts.fxOut, { kind: 'shield', bodyId, x: center.x, y: center.y, born: opts.clock, size: 58, color: '#38d9e8' })
    opts.events.push({ type: 'shieldHit', bodyId, x: center.x, y: center.y })
  }

  if (remDmg <= 0.1) return touched

  const splash = Math.max(10, opts.splash ?? 0)
  let anyHit = false
  let destroyedAny = false
  let nearestSlot = -1
  let nearestDist = Infinity

  for (let i = 0; i < COLONY_SLOTS; i += 1) {
    if (!sites[i]) continue
    const pos = colonySlotWorldPos(bodyId, base.siteAngle, i, compact)
    const d = Math.hypot(pos.x - hitX, pos.y - hitY)
    if (d < nearestDist) {
      nearestDist = d
      nearestSlot = i
    }
    if (d <= splash + 7) {
      const falloff = Math.max(0.35, 1 - d / (splash + 12))
      hps[i] = (hps[i] ?? (MODULE_BY_ID[sites[i]!]?.hp ?? 200)) - remDmg * falloff
      anyHit = true
    }
  }
  if (!anyHit && nearestSlot >= 0 && nearestDist < 32) {
    hps[nearestSlot] = (hps[nearestSlot] ?? (MODULE_BY_ID[sites[nearestSlot]!]?.hp ?? 200)) - remDmg
    anyHit = true
  }

  if (!anyHit) return touched

  pushFx(opts.fxOut, { kind: 'hit', bodyId, x: hitX, y: hitY, born: opts.clock, size: 4.5, color: '#ff8a3d' })

  for (let i = 0; i < COLONY_SLOTS; i += 1) {
    const id = sites[i]
    if (!id || (hps[i] ?? 1) > 0) continue
    const pos = colonySlotWorldPos(bodyId, base.siteAngle, i, compact)
    sites[i] = null
    hps[i] = null
    destroyedAny = true
    pushFx(opts.fxOut, { kind: 'boom', bodyId, x: pos.x, y: pos.y, born: opts.clock, size: 6.5 })
    opts.events.push({ type: 'explosion', size: 6.5, bodyId, x: pos.x, y: pos.y })
    if (opts.attackerId && opts.attackerId !== ownerId) {
      awardScore(gs, opts.attackerId, 1, 900)
    }
  }

  if (destroyedAny) {
    syncModules(base)
    const solarFactor = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
    const newShieldCap = colonyShieldCap(base, solarFactor)
    if (base.shield !== undefined) base.shield = Math.min(base.shield, newShieldCap)

    const remaining = colonyHealthSummary(base).buildings
    if (remaining === 0 && !base.destroyed) {
      base.destroyed = true
      const atk = opts.attackerId && gs.mp ? gs.mp.players[opts.attackerId] : undefined
      const vic = gs.mp ? gs.mp.players[ownerId] : undefined
      if (atk && atk.id !== ownerId) {
        atk.coloniesDestroyed = (atk.coloniesDestroyed ?? 0) + 1
        awardScore(gs, atk.id, 3, 6000)
      }
      const bName = BODIES[bodyId].name
      const msg = `💥 ${atk?.username ?? 'Saldırgan'}, ${vic?.username ?? ownerId} oyuncusunun ${bName} kolonisini yerle bir etti (+6.000 ₡)!`
      pushFeed(gs, msg, atk?.color)
      opts.events.push({ type: 'colonyDestroyed', bodyId, victimId: ownerId, attackerId: opts.attackerId ?? '', text: msg })
      opts.events.push({ type: 'toast', ownerId, text: `⚠ ${bName} kolonin yok edildi!` })
    }
  }

  return true
}

function findHomingTarget(
  gs: GameState,
  bodyId: BodyId,
  ownerId: string,
  pos: { x: number; y: number },
  aimPos?: { x: number; y: number },
): number | undefined {
  let bestId: number | undefined
  let bestScore = Infinity
  for (const o of gs.vessels) {
    if (o.bodyId !== bodyId || o.debris || o.station || o.cruise || !hasCommandPart(o)) continue
    if (o.ownerId === ownerId) continue
    const dShip = Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y)
    if (dShip > 8000) continue
    const dCursor = aimPos ? Math.hypot(o.pos.x - aimPos.x, o.pos.y - aimPos.y) : dShip
    const score = aimPos ? dCursor * 2.2 + dShip * 0.45 : dShip
    if (score < bestScore) {
      bestScore = score
      bestId = o.id
    }
  }
  return bestId
}

/** Aktif roket ve imleç için kilitlenilecek en iyi düşman aracını döndürür (HUD kilidi). */
export function findLockTarget(
  gs: GameState,
  v: Vessel,
  aimAngle?: number,
  aimDist?: number,
): Vessel | null {
  const ang = aimAngle ?? v.angle
  const dist = Math.min(5000, aimDist ?? 1400)
  const aimPos = { x: v.pos.x + Math.cos(ang) * dist, y: v.pos.y + Math.sin(ang) * dist }
  const tid = findHomingTarget(gs, v.bodyId, v.ownerId ?? gs.ownerId ?? 'local', v.pos, aimPos)
  return tid ? (gs.vessels.find((o) => o.id === tid) ?? null) : null
}

function fireWeaponInstance(
  gs: GameState,
  v: Vessel,
  p: PartInst,
  st: ReturnType<typeof vesselStats>,
  wantAim: number,
  aimDist: number | undefined,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: Fx[] | undefined,
  events: GameEvent[],
  opts: {
    spendAmmo: boolean
    spendEc: boolean
    dmgScale?: number
    soundPitch?: number
    emitFireEvent?: boolean
  },
): boolean {
  let colonyDirty = false
  const d = partDef(p.def)
  const w = d.weapon!
  const ownerId = v.ownerId ?? gs.ownerId ?? 'local'
  const gimbal = w.gimbal ?? 0.35
  const delta = wrapPi(wantAim - v.angle)
  const clamped = Math.max(-gimbal, Math.min(gimbal, delta))
  const fireAng = v.angle + clamped
  const dir = { x: Math.cos(fireAng), y: Math.sin(fireAng) }
  const partCenter = partWorldPos(v, st, p)
  const muzzleDist = Math.max(d.w, d.h) * 0.55 + 0.5
  const muzzle = { x: partCenter.x + dir.x * muzzleDist, y: partCenter.y + dir.y * muzzleDist }

  if (opts.spendEc && w.ecUse) {
    if (v.ec < w.ecUse) return false
    v.ec = Math.max(0, v.ec - w.ecUse)
  }
  if (opts.spendAmmo && w.ammo !== undefined) {
    const left = p.ammo ?? w.ammo
    if (left <= 0) return false
    p.ammo = left - 1
  }
  p.fireAt = clock

  if (w.recoil && !v.landed && (opts.dmgScale ?? 1) >= 0.4) {
    const m = Math.max(0.5, st.mass)
    const kick = w.recoil * (opts.dmgScale ?? 1)
    v.vel = { x: v.vel.x - (dir.x * kick) / m, y: v.vel.y - (dir.y * kick) / m }
  }

  if (opts.emitFireEvent !== false) {
    events.push({
      type: 'weaponFire',
      weaponId: d.id,
      kind: w.kind,
      bodyId: v.bodyId,
      x: muzzle.x,
      y: muzzle.y,
      pitch: opts.soundPitch,
    })
  }

  if (w.kind !== 'beam') {
    const mLen = w.kind === 'railgun' ? 9 : w.kind === 'rocket' || w.kind === 'missile' || w.kind === 'torpedo' ? 5 : 4.2
    pushFx(fxOut, {
      kind: 'muzzle',
      bodyId: v.bodyId,
      x: muzzle.x,
      y: muzzle.y,
      x2: muzzle.x + dir.x * mLen,
      y2: muzzle.y + dir.y * mLen,
      born: clock,
      size: Math.max(1.4, (w.dmg >= 120 ? 3.2 : 1.9)),
      color: w.color,
    })
  }

  if (w.kind === 'beam') {
    const range = w.range ?? 2400
    const end = { x: muzzle.x + dir.x * range, y: muzzle.y + dir.y * range }
    const pierceCap = w.overpenetrate ?? 1
    let maxT = 1

    // Arazi kesişimi sınırı
    const body = BODIES[v.bodyId]
    const steps = 48
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps
      const qx = muzzle.x + (end.x - muzzle.x) * t
      const qy = muzzle.y + (end.y - muzzle.y) * t
      const qr = Math.hypot(qx, qy)
      const qt = Math.atan2(qy, qx)
      const gR = body.radius + (body.landable ? terrainHeight(body.id, qt) : 0)
      if (qr <= gR) {
        maxT = t
        break
      }
    }

    type BeamHit =
      | { kind: 'vessel'; t: number; x: number; y: number; vessel: Vessel }
      | { kind: 'colony'; t: number; x: number; y: number; colony: ColonyEntry }
    const hits: BeamHit[] = []

    const beamHalfRadius = w.beamWidth ? Math.min(2.2, w.beamWidth * 0.25) : 0.2
    for (const o of gs.vessels) {
      if (o.id === v.id || o.bodyId !== v.bodyId || o.debris || o.station || o.cruise) continue
      if (o.ownerId && o.ownerId === ownerId) continue
      const ost = vesselStats(o.parts, o.cargo)
      const h = hitTestVesselSegment(o, ost, muzzle.x, muzzle.y, end.x, end.y, beamHalfRadius)
      if (h && h.t <= maxT) {
        hits.push({ kind: 'vessel', t: h.t, x: h.x, y: h.y, vessel: o })
      }
    }

    if (isWarfareMode(gs)) {
      for (const col of allColoniesOnBody(gs, v.bodyId)) {
        if (col.ownerId === ownerId || col.base.destroyed) continue
        const cPos = colonyCenterWorldPos(v.bodyId, col.base.siteAngle, true)
        const rad = (col.base.shield && col.base.shield > 0 ? 58 : 48) + (w.beamWidth ? w.beamWidth * 0.5 : 0)
        const seg = distSegPoint(muzzle.x, muzzle.y, end.x, end.y, cPos.x, cPos.y)
        if (seg.dist <= rad && seg.t <= maxT) {
          hits.push({ kind: 'colony', t: seg.t, x: seg.cx, y: seg.cy, colony: col })
        } else if (!(col.base.shield && col.base.shield > 0)) {
          // Kısmen yıkılmış koloninin uç yuvalarını da ışınla vurabil
          const sites = ensureSites(col.base)
          let bestColHit: BeamHit | null = null
          for (let i = 0; i < COLONY_SLOTS; i += 1) {
            if (!sites[i]) continue
            const sPos = colonySlotWorldPos(v.bodyId, col.base.siteAngle, i, true, 4)
            const sSeg = distSegPoint(muzzle.x, muzzle.y, end.x, end.y, sPos.x, sPos.y)
            if (sSeg.dist <= 11 + (w.beamWidth ?? 0) * 0.4 && sSeg.t <= maxT && (!bestColHit || sSeg.t < bestColHit.t)) {
              bestColHit = { kind: 'colony', t: sSeg.t, x: sSeg.cx, y: sSeg.cy, colony: col }
            }
          }
          if (bestColHit) hits.push(bestColHit)
        }
      }
    }

    hits.sort((a, b) => a.t - b.t)
    const activeHits = hits.slice(0, pierceCap)
    const beamEndT = pierceCap <= 1 && activeHits[0] ? activeHits[0].t : maxT
    const beamEnd = { x: muzzle.x + (end.x - muzzle.x) * beamEndT, y: muzzle.y + (end.y - muzzle.y) * beamEndT }

    pushFx(fxOut, {
      kind: 'beam',
      bodyId: v.bodyId,
      x: muzzle.x,
      y: muzzle.y,
      x2: beamEnd.x,
      y2: beamEnd.y,
      born: clock,
      size: w.beamWidth ?? (d.id === 'gun-beam' ? 9.5 : 2.4),
      color: w.color,
    })

    const sliceDmg = w.dmg * (opts.dmgScale ?? 1)
    for (const h of activeHits) {
      if (h.kind === 'vessel') {
        applyVesselDamage(gs, h.vessel, h.x, h.y, sliceDmg, {
          attackerId: ownerId,
          splash: w.splash,
          shieldMult: w.shieldMult,
          shieldPierce: w.shieldPierce,
          clock,
          firing,
          fxOut,
          events,
        })
      } else {
        if (
          applyColonyDamage(gs, h.colony, h.x, h.y, sliceDmg, {
            attackerId: ownerId,
            colonyMult: w.colonyMult,
            shieldMult: w.shieldMult,
            shieldPierce: w.shieldPierce,
            splash: w.splash,
            clock,
            fxOut,
            events,
          })
        ) {
          colonyDirty = true
        }
      }
    }
    if (!activeHits.length && maxT < 1) {
      pushFx(fxOut, { kind: 'hit', bodyId: v.bodyId, x: beamEnd.x, y: beamEnd.y, born: clock, size: d.id === 'gun-beam' ? 5 : 2.6, color: w.color })
    }
    return colonyDirty
  }

  const projs = getProjList(gs)
  const pellets = w.pellets ?? 1
  const lockPos = aimDist ? { x: muzzle.x + dir.x * aimDist, y: muzzle.y + dir.y * aimDist } : undefined
  const targetId = w.kind === 'missile' ? findHomingTarget(gs, v.bodyId, ownerId, muzzle, lockPos) : undefined
  const airburstBase =
    w.kind === 'flak' && aimDist !== undefined
      ? Math.max(160, Math.min(1800, aimDist))
      : w.kind === 'flak'
        ? 850
        : undefined
  for (let k = 0; k < pellets; k += 1) {
    const jitter = w.spread ? (Math.random() - 0.5) * w.spread : 0
    const a = fireAng + jitter
    const spd = w.speed * (pellets > 1 ? 0.9 + Math.random() * 0.2 : 1)
    pushProjectile(projs, {
      id: nextProjId(gs),
      ownerId,
      vesselId: v.id,
      weaponId: d.id,
      kind: w.kind,
      bodyId: v.bodyId,
      pos: { x: muzzle.x, y: muzzle.y },
      vel: { x: v.vel.x + Math.cos(a) * spd, y: v.vel.y + Math.sin(a) * spd },
      refVel: w.kind === 'flak' ? { x: v.vel.x, y: v.vel.y } : undefined,
      born: clock,
      ttl: w.ttl,
      dmg: w.dmg,
      colonyMult: w.colonyMult ?? 1,
      shieldMult: w.shieldMult ?? 1,
      shieldPierce: w.shieldPierce ?? 0,
      splash: w.splash ?? 0,
      gravityScale: w.gravityScale ?? (w.kind === 'railgun' || w.kind === 'plasma' || w.kind === 'emp' ? 0.1 : 0.45),
      turnRate: w.turnRate ?? 0,
      targetId,
      empDrain: w.empDrain ?? 0,
      empStun: w.empStun ?? 0,
      proximity: w.proximity ?? 0,
      traveled: 0,
      airburstRange: airburstBase ? airburstBase * (0.92 + Math.random() * 0.16) : undefined,
      overpenetrate: w.overpenetrate,
      burnDot: w.burnDot,
      shieldFlat: w.shieldFlat,
      resetCharge: w.resetCharge,
      color: w.color,
    })
  }
  return colonyDirty
}

/** FTL tarzı silahları çalıştırır: tek seçili silah ateşleme, şarj, seri atış ve zincir hızlanma. */
export function stepVesselWeapons(
  gs: GameState,
  v: Vessel,
  realDt: number,
  ctrl: Controls | null,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: Fx[] | undefined,
  events: GameEvent[],
): boolean {
  let colonyDirty = false
  for (const p of v.parts) {
    if (p.cd && p.cd > 0) p.cd = Math.max(0, p.cd - realDt)
  }

  if (v.debris || v.station || v.cruise) return false
  if ((v.empUntil ?? 0) > clock) {
    for (const p of v.parts) {
      if (partDef(p.def).weapon) {
        p.charge = 0
        p.beamUntil = 0
        p.burstLeft = 0
      }
    }
    return false
  }
  if (gs.mp && !isWarfareMode(gs)) return false

  const st = vesselStats(v.parts, v.cargo)
  const wantAim = ctrl?.aimAngle !== undefined && Number.isFinite(ctrl.aimAngle) ? ctrl.aimAngle : v.angle
  v.aimAngle = wantAim

  const mountedWeapons = v.parts.filter((p) => !!partDef(p.def).weapon && partAlive(p))
  if (!mountedWeapons.length) return false

  let selectedDef = mountedWeapons[0]!.def
  if (ctrl?.weaponKey && mountedWeapons.some((p) => p.def === ctrl.weaponKey)) {
    selectedDef = ctrl.weaponKey
  } else if (ctrl?.fireGroup && ctrl.fireGroup > 0) {
    const grpHit = mountedWeapons.find((p) => partDef(p.def).weapon?.group === ctrl.fireGroup)
    if (grpHit) selectedDef = grpHit.def
  }

  const wantFire = Boolean(ctrl?.fire)
  if (wantFire && (v.spawnShieldUntil ?? 0) > clock) {
    v.spawnShieldUntil = 0
  }

  for (const p of v.parts) {
    const d = partDef(p.def)
    const w = d.weapon
    if (!w || !partAlive(p)) continue
    const isSel = p.def === selectedDef

    // Devam eden seri atış (Burst — FTL Burst Laser / Rocket Salvo)
    if ((p.burstLeft ?? 0) > 0) {
      p.burstCd = (p.burstCd ?? 0) - realDt
      if ((p.burstCd ?? 0) <= 0) {
        if (w.ammo === undefined || (p.ammo ?? 0) > 0) {
          const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
            spendAmmo: true,
            spendEc: false,
          })
          if (ok) colonyDirty = true
        }
        p.burstLeft = (p.burstLeft ?? 1) - 1
        p.burstCd = w.burstInterval ?? 0.09
      }
    }

    // Aktif Dev Ölüm Işını süpürmesi (şarj tamamlandıktan sonra basılı tuttukça kesintisiz biçer!)
    if (w.beamDuration && p.beamUntil && clock < p.beamUntil) {
      if (wantFire && isSel && v.ec >= 1.5) {
        p.burstCd = (p.burstCd ?? 0) - realDt
        if ((p.burstCd ?? 0) <= 0) {
          v.ec = Math.max(0, v.ec - 1.5)
          const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
            spendAmmo: false,
            spendEc: false,
            dmgScale: 1,
            soundPitch: 1.15,
            emitFireEvent: true,
          })
          if (ok) colonyDirty = true
          p.burstCd = 0.14
        }
        continue
      }
      p.beamUntil = 0
    }

    if (!wantFire || !isSel) {
      if (p.charge && p.charge > 0) p.charge = Math.max(0, p.charge - realDt * 0.9)
      if (p.beamUntil) p.beamUntil = 0
      continue
    }

    const ecNeed = w.ecUse ?? 0
    const hasAmmo = w.ammo === undefined || (p.ammo ?? w.ammo) > 0
    if (!hasAmmo || (ecNeed > 0 && v.ec < ecNeed)) {
      if (p.charge && p.charge > 0) p.charge = Math.max(0, p.charge - realDt * 0.6)
      continue
    }

    // FTL Chain Vulcan: ateş edildikçe hızlanır
    if (w.minCooldown && w.spinRate) {
      p.charge = Math.min(1, (p.charge ?? 0) + realDt * w.spinRate)
      if ((p.cd ?? 0) > 0) continue
      const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
        spendAmmo: true,
        spendEc: true,
        soundPitch: 0.78 + p.charge * 0.72,
      })
      if (ok) colonyDirty = true
      p.cd = w.cooldown + (w.minCooldown - w.cooldown) * p.charge
      continue
    }

    if ((p.cd ?? 0) > 0) continue

    // Şarjlı silahlar (Odak Lazeri, Dev Ölüm Lazeri, Raylı Top)
    if (w.chargeTime && w.chargeTime > 0) {
      p.charge = Math.min(1, (p.charge ?? 0) + realDt / w.chargeTime)
      if (p.charge < 1) continue

      if (w.beamSustain) {
        const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
          spendAmmo: false,
          spendEc: true,
          soundPitch: 1.0,
        })
        if (ok) colonyDirty = true
        p.cd = w.cooldown
        p.charge = 1
        continue
      }

      if (w.beamDuration) {
        if (ecNeed > 0) v.ec = Math.max(0, v.ec - ecNeed)
        p.beamUntil = clock + w.beamDuration
        p.burstCd = 0.14
        p.charge = 0
        p.cd = w.cooldown + w.beamDuration
        const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
          spendAmmo: false,
          spendEc: false,
          soundPitch: 1.25,
        })
        if (ok) colonyDirty = true
        continue
      }

      p.charge = 0
      const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
        spendAmmo: true,
        spendEc: true,
      })
      if (ok) colonyDirty = true
      p.cd = w.cooldown
      continue
    }

    // Anında ateşlenen veya seri (burst) silahlar
    const ok = fireWeaponInstance(gs, v, p, st, wantAim, ctrl?.aimDist, clock, firing, fxOut, events, {
      spendAmmo: true,
      spendEc: true,
    })
    if (ok) colonyDirty = true
    p.cd = w.cooldown
    if (w.burstCount && w.burstCount > 1 && (w.ammo === undefined || (p.ammo ?? 0) > 0)) {
      p.burstLeft = w.burstCount - 1
      p.burstCd = w.burstInterval ?? 0.09
    }
  }
  return colonyDirty
}

function detonateArea(
  gs: GameState,
  proj: Projectile,
  hx: number,
  hy: number,
  directVessel: Vessel | null,
  directColony: ColonyEntry | null,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: Fx[] | undefined,
  events: GameEvent[],
): boolean {
  let colonyDirty = false
  const splash = proj.splash
  const hitFXSize = Math.max(2.5, Math.min(10, splash * 0.28 + 2))
  if (splash >= 10) {
    pushFx(fxOut, { kind: 'boom', bodyId: proj.bodyId, x: hx, y: hy, born: clock, size: hitFXSize })
    events.push({ type: 'explosion', size: hitFXSize, bodyId: proj.bodyId, x: hx, y: hy })
  } else {
    pushFx(fxOut, { kind: 'hit', bodyId: proj.bodyId, x: hx, y: hy, born: clock, size: hitFXSize, color: proj.color })
  }

  const opts = {
    attackerId: proj.ownerId,
    shieldMult: proj.shieldMult,
    shieldFlat: proj.shieldFlat,
    shieldPierce: proj.shieldPierce,
    splash,
    empDrain: proj.empDrain,
    empStun: proj.empStun,
    burnDot: proj.burnDot,
    resetCharge: proj.resetCharge,
    clock,
    firing,
    fxOut,
    events,
  }

  if (directVessel) {
    applyVesselDamage(gs, directVessel, hx, hy, proj.dmg, opts)
  }

  if (splash > 0) {
    for (const o of [...gs.vessels]) {
      if (o === directVessel || o.bodyId !== proj.bodyId || o.debris || o.station || o.cruise) continue
      if (o.ownerId === proj.ownerId) continue
      const d = Math.hypot(o.pos.x - hx, o.pos.y - hy)
      if (d <= splash + 8) {
        const fall = Math.max(0.25, 1 - d / (splash + 10))
        applyVesselDamage(gs, o, hx, hy, proj.dmg * fall, opts)
      }
    }
  }

  if (isWarfareMode(gs)) {
    if (directColony) {
      if (applyColonyDamage(gs, directColony, hx, hy, proj.dmg, { ...opts, colonyMult: proj.colonyMult })) {
        colonyDirty = true
      }
    } else if (splash > 0) {
      for (const col of allColoniesOnBody(gs, proj.bodyId)) {
        if (col.ownerId === proj.ownerId || col.base.destroyed) continue
        const cPos = colonyCenterWorldPos(proj.bodyId, col.base.siteAngle, true)
        if (Math.hypot(cPos.x - hx, cPos.y - hy) <= splash + 55) {
          if (applyColonyDamage(gs, col, hx, hy, proj.dmg, { ...opts, colonyMult: proj.colonyMult })) {
            colonyDirty = true
          }
        }
      }
    }
  }
  return colonyDirty
}

/** Aktif mermileri ilerletir, yerçekimi/güdüm uygular ve çarpışmaları çözer. */
export function stepProjectiles(
  gs: GameState,
  dt: number,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: Fx[] | undefined,
  events: GameEvent[],
): boolean {
  const projs = gs.mp ? gs.mp.projectiles : gs.projectiles
  if (!projs?.length) return false
  let colonyDirty = false
  const keep: Projectile[] = []

  for (const proj of projs) {
    if (clock - proj.born >= proj.ttl) continue
    const body = BODIES[proj.bodyId]
    if (!body) continue

    // Güdümlü füze takibi
    if (proj.turnRate > 0) {
      let target = proj.targetId
        ? gs.vessels.find((o) => o.id === proj.targetId && o.bodyId === proj.bodyId && !o.debris && !o.cruise && hasCommandPart(o))
        : undefined
      if (!target) {
        const tid = findHomingTarget(gs, proj.bodyId, proj.ownerId, proj.pos)
        if (tid) {
          proj.targetId = tid
          target = gs.vessels.find((o) => o.id === tid)
        }
      }
      if (target) {
        const toT = { x: target.pos.x - proj.pos.x, y: target.pos.y - proj.pos.y }
        const dist = Math.hypot(toT.x, toT.y) || 1
        const tLead = Math.min(1.2, dist / Math.max(200, Math.hypot(proj.vel.x, proj.vel.y)))
        const aimX = target.pos.x + (target.vel.x - proj.vel.x) * tLead * 0.45 - proj.pos.x
        const aimY = target.pos.y + (target.vel.y - proj.vel.y) * tLead * 0.45 - proj.pos.y
        const desiredAng = Math.atan2(aimY, aimX)
        const curSpd = Math.max(120, Math.hypot(proj.vel.x, proj.vel.y))
        const curAng = Math.atan2(proj.vel.y, proj.vel.x)
        const err = wrapPi(desiredAng - curAng)
        const maxTurn = proj.turnRate * dt
        const nextAng = curAng + Math.max(-maxTurn, Math.min(maxTurn, err))
        const maxTrackSpd = Math.max(680, Math.hypot(target.vel.x, target.vel.y) + 520)
        const boostSpd = Math.min(maxTrackSpd, curSpd + 45 * dt)
        proj.vel = { x: Math.cos(nextAng) * boostSpd, y: Math.sin(nextAng) * boostSpd }
      }
    }

    const prev = { x: proj.pos.x, y: proj.pos.y }
    if (proj.gravityScale > 0 && !arcade.on) {
      const r = Math.hypot(proj.pos.x, proj.pos.y)
      if (r > 1) {
        const gF = -(body.mu / (r * r * r)) * proj.gravityScale
        proj.vel = { x: proj.vel.x + proj.pos.x * gF * dt, y: proj.vel.y + proj.pos.y * gF * dt }
      }
    }
    proj.pos = { x: proj.pos.x + proj.vel.x * dt, y: proj.pos.y + proj.vel.y * dt }
    const relVx = proj.vel.x - (proj.refVel?.x ?? 0)
    const relVy = proj.vel.y - (proj.refVel?.y ?? 0)
    proj.traveled = (proj.traveled ?? 0) + Math.hypot(relVx, relVy) * dt

    // FTL Flak hava patlaması: imleç/hedef mesafesine varınca otomatik infilak
    if (proj.kind === 'flak' && proj.airburstRange && proj.traveled >= proj.airburstRange) {
      const savedSplash = proj.splash
      proj.splash = Math.max(savedSplash, proj.proximity ? proj.proximity + 2 : savedSplash)
      if (detonateArea(gs, proj, proj.pos.x, proj.pos.y, null, null, clock, firing, fxOut, events)) colonyDirty = true
      proj.splash = savedSplash
      continue
    }

    let hit = false

    // 1) Roket çarpışma kontrolü
    for (const o of gs.vessels) {
      if (o.bodyId !== proj.bodyId || o.debris || o.station || o.cruise) continue
      if (o.ownerId && o.ownerId === proj.ownerId) continue
      if (proj.hitIds?.includes(o.id)) continue
      const ost = vesselStats(o.parts, o.cargo)
      if (proj.proximity > 0) {
        const dProx = distSegPoint(prev.x, prev.y, proj.pos.x, proj.pos.y, o.pos.x, o.pos.y)
        if (dProx.dist <= proj.proximity) {
          const savedSplash = proj.splash
          proj.splash = Math.max(savedSplash, proj.proximity + 2)
          if (detonateArea(gs, proj, dProx.cx, dProx.cy, o, null, clock, firing, fxOut, events)) colonyDirty = true
          proj.splash = savedSplash
          hit = true
          break
        }
      }
      const h = hitTestVesselSegment(o, ost, prev.x, prev.y, proj.pos.x, proj.pos.y)
      if (h) {
        if (detonateArea(gs, proj, h.x, h.y, o, null, clock, firing, fxOut, events)) colonyDirty = true
        if ((proj.overpenetrate ?? 1) > 1) {
          proj.overpenetrate = (proj.overpenetrate ?? 1) - 1
          proj.dmg *= 0.85
          ;(proj.hitIds ??= []).push(o.id)
        } else {
          hit = true
          break
        }
      }
    }
    if (hit) continue

    // 2) Koloni kalkanı ve bina çarpışma kontrolü
    if (isWarfareMode(gs)) {
      for (const col of allColoniesOnBody(gs, proj.bodyId)) {
        if (col.ownerId === proj.ownerId || col.base.destroyed) continue
        if (col.base.shield && col.base.shield > 0) {
          const cPos = colonyCenterWorldPos(proj.bodyId, col.base.siteAngle, true)
          const seg = distSegPoint(prev.x, prev.y, proj.pos.x, proj.pos.y, cPos.x, cPos.y)
          if (seg.dist <= 58) {
            if (detonateArea(gs, proj, seg.cx, seg.cy, null, col, clock, firing, fxOut, events)) colonyDirty = true
            hit = true
            break
          }
        }
        const sites = ensureSites(col.base)
        for (let i = 0; i < COLONY_SLOTS; i += 1) {
          if (!sites[i]) continue
          const sPos = colonySlotWorldPos(proj.bodyId, col.base.siteAngle, i, true)
          const seg = distSegPoint(prev.x, prev.y, proj.pos.x, proj.pos.y, sPos.x, sPos.y)
          if (seg.dist <= 8) {
            if (detonateArea(gs, proj, seg.cx, seg.cy, null, col, clock, firing, fxOut, events)) colonyDirty = true
            hit = true
            break
          }
        }
        if (hit) break
      }
    }
    if (hit) continue

    // 3) Yüzey çarpışması
    const r = Math.hypot(proj.pos.x, proj.pos.y)
    const theta = Math.atan2(proj.pos.y, proj.pos.x)
    const surfR = body.radius + (body.landable ? terrainHeight(body.id, theta) : 0)
    if (r <= surfR) {
      if (detonateArea(gs, proj, proj.pos.x, proj.pos.y, null, null, clock, firing, fxOut, events)) colonyDirty = true
      continue
    }

    keep.push(proj)
  }

  if (gs.mp) gs.mp.projectiles = keep
  else gs.projectiles = keep
  return colonyDirty
}

/** Roket çarpışmasının yakınındaki düşman kolonilerine verdiği patlama hasarı. */
export function damageNearbyColoniesOnCrash(
  gs: GameState,
  v: Vessel,
  shockSpeed: number,
  clock: number,
  fxOut: Fx[] | undefined,
  events: GameEvent[],
): boolean {
  if (!isWarfareMode(gs) || v.debris) return false
  let dirty = false
  const dmg = Math.min(350, Math.max(40, shockSpeed * 3.5))
  for (const col of allColoniesOnBody(gs, v.bodyId)) {
    if (col.ownerId === v.ownerId || col.base.destroyed) continue
    const cPos = colonyCenterWorldPos(v.bodyId, col.base.siteAngle, true)
    if (Math.hypot(cPos.x - v.pos.x, cPos.y - v.pos.y) <= 75) {
      if (
        applyColonyDamage(gs, col, v.pos.x, v.pos.y, dmg, {
          attackerId: v.ownerId,
          splash: 38,
          clock,
          fxOut,
          events,
        })
      ) {
        dirty = true
      }
    }
  }
  return dirty
}

/** Araç enerji kalkanı yenilemesini ve koloni savunma sistemlerini (kalkan, tamir, uçaksavar, SAM) yürütür. */
export function stepCombatSystems(
  gs: GameState,
  realDt: number,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: Fx[] | undefined,
  events: GameEvent[],
): boolean {
  let colonyDirty = false

  // Araç kalkan yenilemesi ve plazma yanığı
  for (const v of gs.vessels) {
    if (v.debris || v.station) continue
    if (v.burnUntil && v.burnUntil > clock && v.parts.length > 0) {
      applyVesselDamage(gs, v, v.pos.x, v.pos.y, 12 * realDt, {
        attackerId: v.lastAttackerId,
        shieldPierce: 1,
        silent: true,
        clock,
        firing,
        fxOut: undefined,
        events,
      })
    }
    const st = vesselStats(v.parts, v.cargo)
    if (st.shieldCap <= 0) {
      if (v.shield) v.shield = 0
      continue
    }
    if (v.shield === undefined) v.shield = st.shieldCap
    else if (v.shield > st.shieldCap) v.shield = st.shieldCap
    if ((v.empUntil ?? 0) <= clock && (v.shieldRegenAt ?? 0) <= clock && v.shield < st.shieldCap && v.ec > 0.5) {
      const regen = Math.min(st.shieldCap - v.shield, 18 * realDt, v.ec * 2)
      v.shield += regen
      v.ec = Math.max(0, v.ec - regen * 0.25)
    }
  }

  if (!isWarfareMode(gs) || !gs.mp) return false

  for (const bodyId of Object.keys(BODIES) as BodyId[]) {
    if (!BODIES[bodyId].landable) continue
    const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
    for (const col of allColoniesOnBody(gs, bodyId)) {
      const { base, ownerId } = col
      if (base.destroyed) continue
      const sites = ensureSites(base)
      const hps = ensureSiteHp(base)
      const rep = baseReport(base, flux)
      const stunned = (base.stunUntil ?? 0) > clock

      // Kalkan kubbesi
      const sCap = colonyShieldCap(base, flux)
      if (sCap > 0) {
        if (base.shield === undefined) base.shield = sCap
        else if (base.shield > sCap) {
          base.shield = sCap
          colonyDirty = true
        }
        if (!stunned && (base.shieldRegenAt ?? 0) <= clock && base.shield < sCap) {
          const prevShield = base.shield
          base.shield = Math.min(sCap, base.shield + 45 * realDt)
          if (Math.floor(prevShield / 18) !== Math.floor(base.shield / 18) || base.shield >= sCap) {
            colonyDirty = true
          }
        }
      } else if (base.shield) {
        base.shield = 0
        colonyDirty = true
      }

      if (stunned) continue

      // Onarım hangarı
      const repairCount = rep.sites.filter((s) => s.id === 'repair-bay' && s.powered).length
      if (repairCount > 0) {
        for (let i = 0; i < COLONY_SLOTS; i += 1) {
          const id = sites[i]
          if (!id) continue
          const maxHp = MODULE_BY_ID[id]?.hp ?? 200
          const curHp = hps[i] ?? maxHp
          if (curHp < maxHp) {
            const nextHp = Math.min(maxHp, curHp + 10 * repairCount * realDt)
            hps[i] = nextHp
            if (Math.floor(curHp / 12) !== Math.floor(nextHp / 12) || nextHp >= maxHp) {
              colonyDirty = true
            }
          }
        }
      }

      // Aktif savunma taretleri (AA Lazer & SAM Füze)
      if (base.turretCd && base.turretCd > 0) {
        base.turretCd = Math.max(0, base.turretCd - realDt)
        continue
      }

      const aaSlots: number[] = []
      const samSlots: number[] = []
      rep.sites.forEach((s, idx) => {
        if (!s.powered) return
        if (s.id === 'aa-turret') aaSlots.push(idx)
        else if (s.id === 'sam-battery') samSlots.push(idx)
      })
      if (!aaSlots.length && !samSlots.length) continue

      const cCenter = colonyCenterWorldPos(bodyId, base.siteAngle, true)
      const maxRange = samSlots.length ? 2800 : 1600
      let target: Vessel | null = null
      let bestDist = maxRange
      for (const v of gs.vessels) {
        if (v.bodyId !== bodyId || v.debris || v.station || v.cruise || !hasCommandPart(v)) continue
        if (v.ownerId === ownerId) continue
        if (v.spawnShieldUntil && clock < v.spawnShieldUntil) continue
        // Yerde kendi Dünya rampasında bekleyen oyuncuyu vurma
        if (v.landed && bodyId === 'earth' && v.ownerId) {
          const ownEarthAngle = gs.mp.players[v.ownerId]?.earthBase?.siteAngle
          if (ownEarthAngle !== undefined) {
            const ownCenter = colonyCenterWorldPos('earth', ownEarthAngle, true)
            if (Math.hypot(v.pos.x - ownCenter.x, v.pos.y - ownCenter.y) < 240) continue
          }
        }
        const d = Math.hypot(v.pos.x - cCenter.x, v.pos.y - cCenter.y)
        if (d < bestDist) {
          bestDist = d
          target = v
        }
      }
      if (!target) continue

      // AA lazer atışı
      let fired = false
      if (aaSlots.length && bestDist <= 1600) {
        for (const sIdx of aaSlots) {
          const origin = colonySlotWorldPos(bodyId, base.siteAngle, sIdx, true, 7)
          pushFx(fxOut, {
            kind: 'beam',
            bodyId,
            x: origin.x,
            y: origin.y,
            x2: target.pos.x,
            y2: target.pos.y,
            born: clock,
            size: 2.4,
            color: '#38d9e8',
          })
          events.push({ type: 'weaponFire', weaponId: 'gun-laser', kind: 'beam', bodyId, x: origin.x, y: origin.y, pitch: 1.3 })
          applyVesselDamage(gs, target, target.pos.x, target.pos.y, 24, {
            attackerId: ownerId,
            clock,
            firing,
            fxOut,
            events,
          })
          fired = true
        }
        base.turretCd = 0.95
      }

      // SAM füze atışı (tüm enerjili SAM yuvalarından)
      if (samSlots.length && bestDist <= 2800 && (!fired || Math.random() < 0.5)) {
        const projs = getProjList(gs)
        for (const sIdx of samSlots.slice(0, 3)) {
          const origin = colonySlotWorldPos(bodyId, base.siteAngle, sIdx, true, 8)
          const dx = target.pos.x - origin.x
          const dy = target.pos.y - origin.y
          const dist = Math.hypot(dx, dy) || 1
          pushProjectile(projs, {
            id: nextProjId(gs),
            ownerId,
            vesselId: 0,
            weaponId: 'sam-battery',
            kind: 'missile',
            bodyId,
            pos: { x: origin.x, y: origin.y },
            vel: { x: (dx / dist) * 420, y: (dy / dist) * 420 },
            born: clock,
            ttl: 6.5,
            dmg: 75,
            colonyMult: 1,
            shieldMult: 1,
            shieldPierce: 0,
            splash: 16,
            gravityScale: 0.15,
            turnRate: 3.1,
            targetId: target.id,
            empDrain: 0,
            empStun: 0,
            proximity: 10,
            color: '#fb7185',
            fromColony: true,
          })
          events.push({ type: 'weaponFire', weaponId: 'gun-missile', kind: 'missile', bodyId, x: origin.x, y: origin.y })
        }
        base.turretCd = Math.max(base.turretCd ?? 0, 2.2)
      }
    }
  }

  return colonyDirty
}

/** Uzay Savaşı'nda aktif gezegen kolonilerini sayar, pasif gelir ve zafer koşullarını denetler. */
export function stepWarfareRules(gs: GameState, events: GameEvent[]) {
  const mp = gs.mp
  if (!mp || !mp.started || !isWarfareMode(gs) || isLootMode(gs) || mp.winnerId) return

  const players = Object.values(mp.players)
  for (const p of players) {
    let planetCols = 0
    if (p.colonies) {
      for (const [bid, b] of Object.entries(p.colonies)) {
        if (!b || b.destroyed) continue
        const flux = solarFlux(len(bodyAbsState(bid as BodyId, gs.time).r))
        const hasStation = (b.modules[COLONY_STATION_ID] ?? 0) > 0
        if (hasStation && baseReport(b, flux).sites.some((s) => s.id === COLONY_STATION_ID && s.powered)) {
          planetCols += 1
        }
      }
    }
    p.planetsHeld = planetCols

    if (countSurvivingColonies(p) === 0 && !p.eliminated) {
      p.eliminated = true
      pushFeed(gs, `☠️ ${p.username} tüm kolonilerini kaybetti ve elendi!`, p.color)
    }
  }

  const goal = mp.config.warfareGoal ?? 'siege'
  if (goal === 'siege' && players.length >= 2) {
    const alive = players.filter((p) => !p.eliminated && countSurvivingColonies(p) > 0)
    if (alive.length === 1) {
      const winner = alive[0]!
      mp.winnerId = winner.id
      const msg = `🏆 ${winner.username}, tüm rakip kolonileri yok ederek savaşı kazandı!`
      pushFeed(gs, msg, winner.color)
      events.push({ type: 'victory', winnerId: winner.id, winnerName: winner.username })
    } else if (alive.length === 0) {
      const winner = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.kills - a.kills)[0]
      if (winner) {
        mp.winnerId = winner.id
        const msg = `🏆 ${winner.username}, tüm rakip kolonileri yok ederek savaşı kazandı!`
        pushFeed(gs, msg, winner.color)
        events.push({ type: 'victory', winnerId: winner.id, winnerName: winner.username })
      }
    }
  } else if (goal === 'score15' || goal === 'score30') {
    const targetScore = goal === 'score15' ? 15 : 30
    for (const p of players) {
      if (p.eliminated) continue
      const totalScore = p.score ?? 0
      if (totalScore >= targetScore) {
        mp.winnerId = p.id
        const msg = `🏆 ${p.username}, ${totalScore} puana ulaşarak Uzay Savaşı'nı kazandı!`
        pushFeed(gs, msg, p.color)
        events.push({ type: 'victory', winnerId: p.id, winnerName: p.username })
        break
      }
    }
  }
}
