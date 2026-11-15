/**
 * Çok oyunculu "Gezegenleri Ele Geçir" (Capture the Planets) saf oyun kuralları:
 *  - Dinamik akıllı zaman hızlandırma (otomatik yükselme, çarpışma/iniş/yanışta anında fren)
 *  - Süpürmeli (swept) roket-roket çarpışma ve uzayda/havada parçalanma
 *  - Bayrak kapmaca tarzı gezegen ele geçirme ve savunma
 *  - Oyuncu başına bağımsız bütçe, fırlatma rampası ve hedef yönetimi
 */
import { baseReport, emptyBase, STARTER_EARTH_SITES, syncModules, tickBase } from '../game/base'
import { DEFAULT_DESIGN, partDef } from '../game/data'
import { INITIAL_TECH } from '../game/tech'
import type {
  Base,
  DynamicWarpInfo,
  GameEvent,
  GameState,
  MultiplayerConfig,
  MultiplayerPlayer,
  PartInst,
  PlanetCapture,
  Vessel,
} from '../game/types'
import { cargoMass, components, vesselStats } from '../game/vessel'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import { bodyAbsState, elementsFromState, len } from './orbit'
import {
  type Controls,
  effectiveAutopilot,
  landingTolerance,
  needsPhysics,
  orbitCoastWait,
  PAD_ANGLE,
  situation,
} from './physics'

export const WARPS = [1, 2, 4, 10, 25, 100, 500, 2500, 10000, 50000, 100000]
export const PHYSICS_WARP_MAX_IDX = 4

export const CONQUERABLE_BODIES: BodyId[] = ['moon', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']
export const PLAYER_COLORS = ['#38d9e8', '#fb7185', '#4ade80', '#fbbf24', '#c084fc', '#fb923c', '#60a5fa', '#f472b6']

const CAPTURE_CLAIM_SEC = 5
const CAPTURE_NEUTRALIZE_SEC = 5

export interface FxEventLike {
  kind: 'boom' | 'whale' | 'tower'
  bodyId: BodyId
  x: number
  y: number
  born: number
  size: number
}

/** Dünya üzerindeki düz rampa bölgesinde her oyuncu yuvası için ayrı açı döndürür. */
export function padAngleForSlot(slot: number): number {
  if (slot <= 0) return PAD_ANGLE
  const k = Math.ceil(slot / 2)
  const dir = slot % 2 === 1 ? 1 : -1
  return PAD_ANGLE + dir * k * 0.00045
}

export function playerPadAngle(gs: GameState, ownerId?: string): number {
  if (!gs.mp || !ownerId) return PAD_ANGLE
  const p = gs.mp.players[ownerId]
  return padAngleForSlot(p?.slot ?? 0)
}

export function makeStarterEarthBase(slot: number, ownerId?: string): Base {
  const b = emptyBase(padAngleForSlot(slot), ownerId)
  b.sites = [...STARTER_EARTH_SITES]
  syncModules(b)
  return b
}

export function createMultiplayerPlayer(
  id: string,
  username: string,
  slot: number,
  color: string,
  startingMoney: number,
): MultiplayerPlayer {
  return {
    id,
    username,
    color,
    slot,
    money: startingMoney,
    targetBody: 'moon',
    activeVesselId: null,
    wantsWarpIdx: -1,
    warpAnchor: false,
    planetsHeld: 0,
    captures: 0,
    kills: 0,
    earthBase: makeStarterEarthBase(slot, id),
  }
}

export function newMultiplayerGame(
  roomId: string,
  hostId: string,
  playersList: { id: string; username: string; color: string; slot: number }[],
  config: Partial<MultiplayerConfig> = {},
): GameState {
  const cfg: MultiplayerConfig = {
    targetPlanets: config.targetPlanets ?? 4,
    startingMoney: config.startingMoney ?? 50_000,
    passiveBonusPerPlanet: config.passiveBonusPerPlanet ?? 12_000,
    allowAutoWarp: config.allowAutoWarp ?? true,
  }
  const players: Record<string, MultiplayerPlayer> = {}
  const playerMeta: Record<string, { id: string; username: string; color: string }> = {}
  for (const p of playersList) {
    players[p.id] = createMultiplayerPlayer(p.id, p.username, p.slot, p.color, cfg.startingMoney)
    playerMeta[p.id] = { id: p.id, username: p.username, color: p.color }
  }
  if (!players[hostId]) {
    const col = PLAYER_COLORS[0]!
    players[hostId] = createMultiplayerPlayer(hostId, hostId, 0, col, cfg.startingMoney)
    playerMeta[hostId] = { id: hostId, username: hostId, color: col }
  }
  const captures: Partial<Record<BodyId, PlanetCapture>> = {}
  for (const id of CONQUERABLE_BODIES) {
    captures[id] = {
      bodyId: id,
      ownerId: null,
      flagAngle: Math.PI / 2,
      progress: 0,
      capturerId: null,
      phase: 'idle',
    }
  }
  const earth = makeStarterEarthBase(0, hostId)
  return {
    time: 0,
    tick: 0,
    protocolVersion: 1,
    ownerId: hostId,
    players: playerMeta,
    money: players[hostId]!.money,
    vessels: [],
    activeId: null,
    nextId: 1,
    bases: { earth },
    missionsDone: [],
    techDone: [INITIAL_TECH],
    design: DEFAULT_DESIGN.map((p) => ({ ...p })),
    designCargo: {},
    targetBody: 'moon',
    lastSavedAt: Date.now(),
    mp: {
      roomId,
      hostId,
      started: true,
      winnerId: null,
      config: cfg,
      players,
      captures,
      warpInfo: {
        warpIdx: 0,
        warp: 1,
        mode: 'auto',
        reason: 'Akıllı zaman senkronu aktif',
        nearestInterceptM: null,
      },
      feed: [{ id: 1, time: 0, text: '🚀 Fetih başladı! En çok gezegeni ele geçir ve rakip roketleri avla.' }],
    },
  }
}

export function addMultiplayerPlayer(gs: GameState, id: string, username: string, color: string, slot: number) {
  if (!gs.mp) return
  if (gs.mp.players[id]) return
  gs.mp.players[id] = createMultiplayerPlayer(id, username, slot, color, gs.mp.config.startingMoney)
  gs.players = { ...(gs.players ?? {}), [id]: { id, username, color } }
  pushMpFeed(gs, `🛰️ ${username} savaşa katıldı.`, color)
}

export function removeMultiplayerPlayer(gs: GameState, id: string) {
  if (!gs.mp) return
  const p = gs.mp.players[id]
  if (!p) return
  delete gs.mp.players[id]
  pushMpFeed(gs, `${p.username} ayrıldı.`, p.color)
}

export function pushMpFeed(gs: GameState, text: string, color?: string) {
  if (!gs.mp) return
  const last = gs.mp.feed[gs.mp.feed.length - 1]
  const id = (last?.id ?? 0) + 1
  gs.mp.feed.push({ id, time: gs.time, text, color })
  if (gs.mp.feed.length > 24) gs.mp.feed.splice(0, gs.mp.feed.length - 24)
}

export function getPlayerMoney(gs: GameState, ownerId?: string): number {
  if (!gs.mp) return gs.money
  const key = ownerId ?? gs.ownerId ?? gs.mp.hostId
  return gs.mp.players[key]?.money ?? gs.money
}

export function addPlayerMoney(gs: GameState, delta: number, ownerId?: string) {
  if (!gs.mp) {
    gs.money += delta
    return
  }
  const key = ownerId ?? gs.ownerId ?? gs.mp.hostId
  const p = gs.mp.players[key]
  if (p) {
    p.money += delta
    if (key === gs.ownerId) gs.money = p.money
  }
}

export function getActiveVesselForPlayer(gs: GameState, ownerId?: string): Vessel | null {
  if (!gs.mp) return gs.vessels.find((v) => v.id === gs.activeId) ?? null
  const key = ownerId ?? gs.ownerId
  if (!key) return null
  const aid = gs.mp.players[key]?.activeVesselId
  return aid ? gs.vessels.find((v) => v.id === aid) ?? null : null
}

export function setActiveVesselForPlayer(gs: GameState, ownerId: string, vesselId: number | null) {
  if (!gs.mp) {
    gs.activeId = vesselId
    return
  }
  const p = gs.mp.players[ownerId]
  if (p) p.activeVesselId = vesselId
  if (ownerId === gs.ownerId) gs.activeId = vesselId
}

export function isAnyActivePlayerVessel(gs: GameState, v: Vessel): boolean {
  if (!gs.mp) return v.id === gs.activeId
  for (const p of Object.values(gs.mp.players)) {
    if (p.activeVesselId === v.id) return true
  }
  return false
}

export function vesselTargetBody(gs: GameState, v: Vessel): BodyId {
  if (v.targetBody) return v.targetBody
  if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]) return gs.mp.players[v.ownerId]!.targetBody
  return (gs.targetBody ?? 'moon') as BodyId
}

export function playerPassiveIncomePerHour(gs: GameState, playerId: string): number {
  if (!gs.mp) return 0
  const p = gs.mp.players[playerId]
  if (!p) return 0
  const earthFlux = solarFlux(len(bodyAbsState('earth', gs.time).r))
  let sum = p.earthBase ? baseReport(p.earthBase, earthFlux, 1).incomePerHour : 0
  for (const bodyId of CONQUERABLE_BODIES) {
    const cap = gs.mp.captures[bodyId]
    if (cap?.ownerId !== playerId) continue
    const b = BODIES[bodyId]
    sum += gs.mp.config.passiveBonusPerPlanet * Math.max(1, b.incomeMult * 0.5)
    const colony = gs.bases[bodyId]
    if (colony) {
      const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
      sum += baseReport(colony, flux, b.incomeMult).incomePerHour
    }
  }
  return sum
}

export function stepMultiplayerIncome(gs: GameState, incomeDt: number) {
  if (!gs.mp) return
  const hours = incomeDt / 3600
  const earthFlux = solarFlux(len(bodyAbsState('earth', gs.time).r))
  for (const p of Object.values(gs.mp.players)) {
    if (p.earthBase) {
      p.money += tickBase(p.earthBase, earthFlux, incomeDt, 1, false)
    }
  }
  for (const bodyId of CONQUERABLE_BODIES) {
    const cap = gs.mp.captures[bodyId]
    if (!cap?.ownerId) continue
    const owner = gs.mp.players[cap.ownerId]
    if (!owner) continue
    const b = BODIES[bodyId]
    owner.money += gs.mp.config.passiveBonusPerPlanet * Math.max(1, b.incomeMult * 0.5) * hours
    const colony = gs.bases[bodyId]
    if (colony) {
      const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
      owner.money += tickBase(colony, flux, incomeDt, b.incomeMult, true)
    }
  }
  if (gs.ownerId && gs.mp.players[gs.ownerId]) gs.money = gs.mp.players[gs.ownerId]!.money
}

// ───────────────────────── Roket-Roket Çarpışmaları ─────────────────────────

export function vesselRadius(v: Vessel): number {
  if (v.station) return 4.2
  const st = vesselStats(v.parts)
  return Math.max(1.2, Math.hypot(st.maxX - st.minX, st.maxY - st.minY) * 0.44)
}

function partWorldPos(v: Vessel, st: ReturnType<typeof vesselStats>, p: PartInst) {
  const d = partDef(p.def)
  const lx = p.x + d.w / 2 - st.comX
  const lf = -(p.y + d.h / 2 - st.comY)
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  return { x: v.pos.x + fwd.y * lx + fwd.x * lf, y: v.pos.y - fwd.x * lx + fwd.y * lf }
}

function spawnBoomFx(
  fxOut: FxEventLike[] | undefined,
  events: GameEvent[],
  bodyId: BodyId,
  x: number,
  y: number,
  born: number,
  size: number,
) {
  if (fxOut) {
    fxOut.push({ kind: 'boom', bodyId, x, y, born, size })
    if (fxOut.length > 60) fxOut.splice(0, fxOut.length - 60)
  }
  events.push({ type: 'explosion', size })
}

function clearOwnershipPointers(gs: GameState, vesselId: number) {
  if (gs.activeId === vesselId) gs.activeId = null
  if (gs.mp) {
    for (const p of Object.values(gs.mp.players)) {
      if (p.activeVesselId === vesselId) p.activeVesselId = null
    }
  }
}

/**
 * Uzayda / havada veya yüzeydeki rakibe çarpışma hasarı:
 * Yüzeydeki `shatter()`'ın aksine aracı yüzeye ışınlamaz — uçuyorsa yörüngede kalır!
 */
function shatterMidAir(
  gs: GameState,
  v: Vessel,
  shockSpeed: number,
  reason: string,
  attackerId: string | undefined,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: FxEventLike[] | undefined,
  events: GameEvent[],
) {
  if (v.debris) {
    const d = partDef(v.parts[0]?.def ?? 'tank-s')
    spawnBoomFx(fxOut, events, v.bodyId, v.pos.x, v.pos.y, clock, 1.8 + Math.max(d.w, d.h) * 0.8)
    gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
    firing.delete(v.id)
    return
  }

  const st = vesselStats(v.parts)
  const tol = landingTolerance(st)
  const severity = shockSpeed / Math.max(1, tol)
  const total = v.parts.length
  const totalDestroy = severity >= 2.2
  const breakCount = totalDestroy
    ? total
    : Math.max(1, Math.min(total - 1, Math.round(total * 0.34 * Math.max(0.25, severity - 0.55))))

  // Çarpışmada kopacak parçalar (ağır darbede tümü)
  const order = v.parts.map((_, i) => i).sort((a, b) => Math.abs(v.parts[b]!.y - st.comY) - Math.abs(v.parts[a]!.y - st.comY))
  const lost = new Set(order.slice(0, breakCount))
  const keep = v.parts.filter((_, i) => !lost.has(i))
  const group = components(keep)
  const cmd = keep.findIndex((p) => partDef(p.def).kind === 'command')
  const survivors = !totalDestroy && cmd >= 0 ? keep.filter((_, i) => group[i] === group[cmd]) : []
  const debris = v.parts.filter((p) => !survivors.includes(p))

  const kick = Math.min(48, 5 + shockSpeed * 0.35)
  debris.forEach((p, k) => {
    const w = partWorldPos(v, st, p)
    const ang = Math.atan2(w.y - v.pos.y, w.x - v.pos.x) + (k - debris.length / 2) * 0.35
    const id = gs.nextId
    gs.nextId += 1
    gs.vessels.push({
      id,
      name: `Enkaz ${id}`,
      ownerId: v.ownerId,
      parts: [{ ...p, x: 0, y: 0 }],
      bodyId: v.bodyId,
      pos: { x: w.x, y: w.y },
      vel: { x: v.vel.x + Math.cos(ang) * kick, y: v.vel.y + Math.sin(ang) * kick },
      angle: v.angle,
      angVel: v.angVel + ((k % 2 ? 1 : -1) * 4.5),
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
      debris: { ttl: 4.5 + (k % 4) },
    })
    if (k % 4 === 0) spawnBoomFx(fxOut, events, v.bodyId, w.x, w.y, clock, 2.2 + Math.max(partDef(p.def).w, partDef(p.def).h) * 0.6)
  })

  if (!survivors.length) {
    const wasActive = gs.activeId === v.id
    gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
    firing.delete(v.id)
    clearOwnershipPointers(gs, v.id)
    spawnBoomFx(fxOut, events, v.bodyId, v.pos.x, v.pos.y, clock, 7.5)
    events.push({ type: 'crash', name: v.name, wasActive, reason, ownerId: v.ownerId, vesselId: v.id })
    if (gs.mp && attackerId && v.ownerId && attackerId !== v.ownerId) {
      const attacker = gs.mp.players[attackerId]
      const victim = gs.mp.players[v.ownerId]
      if (attacker) {
        attacker.kills += 1
        attacker.money += 3000
        if (gs.ownerId === attacker.id) gs.money = attacker.money
      }
      const txt = `💥 ${attacker?.username ?? attackerId}, ${victim?.username ?? v.ownerId} oyuncusunun ${v.name} aracını yok etti (+3.000 ₡)!`
      pushMpFeed(gs, txt, attacker?.color)
      events.push({ type: 'kill', attackerId, victimId: v.ownerId, victimName: v.name, speed: shockSpeed })
    }
    return
  }

  v.parts = survivors
  v.landed = false
  v.throttle = 0
  v.autopilot = 'off'
  v.autoLand = false
  v.autopilotNote = undefined
  v.noCollideUntil = gs.time + 0.6
  if (attackerId && attackerId !== v.ownerId) v.lastAttackerId = attackerId
  const st2 = vesselStats(v.parts)
  v.ec = Math.min(v.ec, st2.ecCap)
  if (cargoMass(v.cargo) > st2.cargoCap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
  events.push({ type: 'toast', text: `${v.name}: ${reason} (hasarlı)!` })
}

/**
 * Aynı gök cismindeki tüm roket çiftleri arasında süpürmeli (swept) çarpışma kontrolü.
 * Yavaş temaslarda (<3.5 m/s) sadece elastik sekme uygular (kenetlenmeye izin verir);
 * hızlı çarpmalarda gerçekçi kütle oranlı şok ve parçalanma üretir.
 */
export function resolveVesselCollisions(
  gs: GameState,
  prevPos: Map<number, { x: number; y: number }>,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: FxEventLike[] | undefined,
  events: GameEvent[],
) {
  const snapshot = [...gs.vessels]
  for (let i = 0; i < snapshot.length; i += 1) {
    const a = snapshot[i]!
    if (!gs.vessels.includes(a)) continue
    for (let j = i + 1; j < snapshot.length; j += 1) {
      const b = snapshot[j]!
      if (!gs.vessels.includes(b)) continue
      if (a.bodyId !== b.bodyId) continue
      if (a.debris && b.debris) continue
      if (a.cruise || b.cruise) continue
      if (a.landed && b.landed) continue
      if (a.ownerId && a.ownerId === b.ownerId && (a.noCollideUntil ?? 0) > gs.time && (b.noCollideUntil ?? 0) > gs.time) {
        continue
      }

      const rA = vesselRadius(a)
      const rB = vesselRadius(b)
      const rSum = rA + rB
      const p0 = prevPos.get(a.id) ?? a.pos
      const q0 = prevPos.get(b.id) ?? b.pos
      const dp0x = p0.x - q0.x
      const dp0y = p0.y - q0.y
      const dp1x = a.pos.x - b.pos.x
      const dp1y = a.pos.y - b.pos.y
      const dx = dp1x - dp0x
      const dy = dp1y - dp0y
      const dd = dx * dx + dy * dy
      const t = dd > 1e-9 ? Math.max(0, Math.min(1, -(dp0x * dx + dp0y * dy) / dd)) : 0
      const cx = dp0x + dx * t
      const cy = dp0y + dy * t
      const dist = Math.hypot(cx, cy)
      if (dist > rSum) continue

      const rvx = a.vel.x - b.vel.x
      const rvy = a.vel.y - b.vel.y
      const vRel = Math.hypot(rvx, rvy)

      // Aynı oyuncunun rampadaki durağan veya birbirine kenetlenmeye çalışan çok yavaş araçlarını koru
      if (a.bodyId === 'earth' && (a.landed || b.landed) && vRel < 5 && len(a.pos) - BODIES.earth.radius < 120) {
        continue
      }

      let nx = dist > 1e-6 ? cx / dist : vRel > 1e-6 ? rvx / vRel : 1
      let ny = dist > 1e-6 ? cy / dist : vRel > 1e-6 ? rvy / vRel : 0
      const mA = Math.max(0.2, vesselStats(a.parts, a.cargo).mass)
      const mB = Math.max(0.2, vesselStats(b.parts, b.cargo).mass)
      const kA = mB / (mA + mB)
      const kB = mA / (mA + mB)

      // Çarpışma anındaki konuma al + ayır
      const overlap = Math.max(0.15, rSum - dist + 0.15)
      a.pos = { x: a.pos.x + nx * overlap * kA, y: a.pos.y + ny * overlap * kA }
      b.pos = { x: b.pos.x - nx * overlap * kB, y: b.pos.y - ny * overlap * kB }

      if (vRel < 3.5) {
        // Yavaş temas: kenetlenme için hasarsız yumuşak itme
        const vn = rvx * nx + rvy * ny
        if (vn < 0) {
          const jImp = -1.25 * vn
          a.vel = { x: a.vel.x + nx * jImp * kA, y: a.vel.y + ny * jImp * kA }
          b.vel = { x: b.vel.x - nx * jImp * kB, y: b.vel.y - ny * jImp * kB }
        }
        continue
      }

      // Yüksek hızlı çarpışma!
      const hitX = (a.pos.x + b.pos.x) / 2
      const hitY = (a.pos.y + b.pos.y) / 2
      spawnBoomFx(fxOut, events, a.bodyId, hitX, hitY, clock, Math.min(12, 4 + vRel * 0.05))

      const vn = rvx * nx + rvy * ny
      const jImp = Math.max(2, -1.35 * vn)
      a.vel = { x: a.vel.x + nx * jImp * kA * 0.55, y: a.vel.y + ny * jImp * kA * 0.55 }
      b.vel = { x: b.vel.x - nx * jImp * kB * 0.55, y: b.vel.y - ny * jImp * kB * 0.55 }

      const shockA = Math.max(vRel * (0.45 + 0.8 * kA), 6)
      const shockB = Math.max(vRel * (0.45 + 0.8 * kB), 6)
      const reasonA = `${b.name} ile çarpıştı (${vRel.toFixed(0)} m/s)`
      const reasonB = `${a.name} ile çarpıştı (${vRel.toFixed(0)} m/s)`

      if (!a.station) {
        const tolA = landingTolerance(vesselStats(a.parts))
        if (shockA >= tolA * 0.85 || a.debris || vRel >= 16) {
          shatterMidAir(gs, a, shockA, reasonA, b.ownerId, clock, firing, fxOut, events)
        }
      }
      if (!b.station) {
        const tolB = landingTolerance(vesselStats(b.parts))
        if (shockB >= tolB * 0.85 || b.debris || vRel >= 16) {
          shatterMidAir(gs, b, shockB, reasonB, a.ownerId, clock, firing, fxOut, events)
        }
      }
    }
  }
}

// ───────────────────────── Bayrak Kapmaca: Gezegen Fethi ─────────────────────────

export function stepPlanetCaptures(gs: GameState, realDt: number, events: GameEvent[]) {
  const mp = gs.mp
  if (!mp || !mp.started) return

  const counts: Record<string, number> = {}
  for (const bodyId of CONQUERABLE_BODIES) {
    const body = BODIES[bodyId]
    const cap = (mp.captures[bodyId] ??= {
      bodyId,
      ownerId: null,
      flagAngle: Math.PI / 2,
      progress: 0,
      capturerId: null,
      phase: 'idle',
    })

    const landedByOwner = new Map<string, Vessel[]>()
    for (const v of gs.vessels) {
      if (v.bodyId !== bodyId || !v.landed || v.debris || v.station || !v.ownerId) continue
      if (!vesselStats(v.parts).hasCommand) continue
      const arr = landedByOwner.get(v.ownerId) ?? []
      arr.push(v)
      landedByOwner.set(v.ownerId, arr)
    }

    const activeOwners = [...landedByOwner.keys()]
    const bounty = 5000 + Math.round(body.incomeMult * 2000)

    if (!cap.ownerId) {
      if (activeOwners.length === 1) {
        const who = activeOwners[0]!
        const ship = landedByOwner.get(who)![0]!
        if (cap.capturerId !== who) {
          cap.capturerId = who
          cap.progress = 0
        }
        cap.phase = 'claiming'
        cap.progress = Math.min(1, cap.progress + realDt / CAPTURE_CLAIM_SEC)
        if (cap.progress >= 1) {
          cap.ownerId = who
          cap.flagAngle = Math.atan2(ship.pos.y, ship.pos.x)
          cap.progress = 1
          cap.capturerId = null
          cap.phase = 'captured'
          const p = mp.players[who]
          if (p) {
            p.captures += 1
            p.money += bounty
            if (gs.ownerId === p.id) gs.money = p.money
          }
          const msg = `🚩 ${p?.username ?? who}, ${body.name} gezegenini ele geçirdi (+${bounty.toLocaleString('tr-TR')} ₡)!`
          pushMpFeed(gs, msg, p?.color)
          events.push({ type: 'capture', bodyId, ownerId: who, previousOwnerId: null, text: msg })
        }
      } else if (activeOwners.length > 1) {
        cap.phase = 'contested'
      } else {
        cap.phase = 'idle'
        cap.progress = Math.max(0, cap.progress - realDt / CAPTURE_CLAIM_SEC)
        if (cap.progress <= 0) cap.capturerId = null
      }
    } else {
      const ownerShips = landedByOwner.get(cap.ownerId) ?? []
      const rivals = activeOwners.filter((id) => id !== cap.ownerId)

      if (ownerShips.length > 0) {
        if (rivals.length > 0) {
          cap.phase = 'contested'
        } else {
          cap.phase = 'captured'
          cap.progress = 1
          cap.capturerId = null
        }
      } else if (rivals.length === 1) {
        // Savunucusu yok veya roket çarpışmasıyla yok edildi → rakip bayrağı indirip ele geçiriyor!
        const challenger = rivals[0]!
        const ship = landedByOwner.get(challenger)![0]!
        const prevOwner = cap.ownerId
        if (cap.capturerId !== challenger) {
          cap.capturerId = challenger
          cap.progress = 1
          cap.phase = 'neutralizing'
        }
        cap.phase = 'neutralizing'
        cap.progress = Math.max(0, cap.progress - realDt / CAPTURE_NEUTRALIZE_SEC)
        if (cap.progress <= 0) {
          cap.ownerId = challenger
          cap.flagAngle = Math.atan2(ship.pos.y, ship.pos.x)
          cap.progress = 1
          cap.capturerId = null
          cap.phase = 'captured'
          const winner = mp.players[challenger]
          const loser = mp.players[prevOwner]
          if (winner) {
            winner.captures += 1
            winner.money += bounty
            if (gs.ownerId === winner.id) gs.money = winner.money
          }
          const msg = `🚩 ${winner?.username ?? challenger}, ${body.name} bayrağını ${loser?.username ?? prevOwner} elinden kaptı (+${bounty.toLocaleString('tr-TR')} ₡)!`
          pushMpFeed(gs, msg, winner?.color)
          events.push({ type: 'capture', bodyId, ownerId: challenger, previousOwnerId: prevOwner, text: msg })
        }
      } else if (rivals.length > 1) {
        cap.phase = 'contested'
      } else {
        cap.phase = 'captured'
        cap.progress = 1
        cap.capturerId = null
      }
    }

    if (cap.ownerId) counts[cap.ownerId] = (counts[cap.ownerId] ?? 0) + 1
  }

  for (const p of Object.values(mp.players)) {
    p.planetsHeld = counts[p.id] ?? 0
    if (mp.config.targetPlanets > 0 && p.planetsHeld >= mp.config.targetPlanets && !mp.winnerId) {
      mp.winnerId = p.id
      const msg = `🏆 ${p.username}, ${p.planetsHeld} gezegeni ele geçirerek oyunu kazandı!`
      pushMpFeed(gs, msg, p.color)
      events.push({ type: 'victory', winnerId: p.id, winnerName: p.username })
    }
  }
}

// ───────────────────────── Akıllı Dinamik Zaman Hızlandırma ─────────────────────────

function chooseCoastIdx(waitSec: number, maxCap = 9): number {
  let idx = 0
  for (let i = 0; i < WARPS.length; i += 1) if (WARPS[i]! <= waitSec / 3) idx = i
  return Math.min(maxCap, idx)
}

function closestApproach(a: Vessel, b: Vessel, maxLookSec = 25): { dist: number; tca: number; minAtTca: number } {
  const dpX = a.pos.x - b.pos.x
  const dpY = a.pos.y - b.pos.y
  const dist = Math.hypot(dpX, dpY)
  const dvX = a.vel.x - b.vel.x
  const dvY = a.vel.y - b.vel.y
  const vv = dvX * dvX + dvY * dvY
  const tca = vv > 1e-6 ? Math.max(0, Math.min(maxLookSec, -(dpX * dvX + dpY * dvY) / vv)) : 0
  const minAtTca = Math.hypot(dpX + dvX * tca, dpY + dvY * tca)
  return { dist, tca, minAtTca }
}

/**
 * Tüm oyuncuların anlık uçuş durumunu analiz ederek evrensel zaman hızını dinamik seçer:
 * - İki roket 3 km içine girince (veya 15 sn içinde çarpışma rotasında) ANINDA 1×'e düşer.
 * - Manuel iniş / yoğun atmosfer / manuel yakışta 1×–4× sınırlar.
 * - Herkes güvenli yörüngedeyken veya süzülme otopilotundayken yumuşak biçimde hızlanır.
 * - Yavaşlatma anlık (0 ms), hızlandırma yumuşak kademeli yapılır.
 */
export function computeDynamicWarp(
  gs: GameState,
  curWarpIdx: number,
  rampTimer: number,
  realDt: number,
  realClock: number,
  controlsByPlayer: Map<string, Controls>,
  autopilotWantedByVessel: Map<number, number>,
): { warpIdx: number; rampTimer: number; info: DynamicWarpInfo } {
  const mp = gs.mp
  const maxIdx = WARPS.length - 1
  if (!mp) {
    return {
      warpIdx: curWarpIdx,
      rampTimer: 0,
      info: { warpIdx: curWarpIdx, warp: WARPS[curWarpIdx]!, mode: 'manual', reason: '' },
    }
  }

  let hardCap = maxIdx
  let capMode: DynamicWarpInfo['mode'] = 'auto'
  let capReason = ''
  let throttledBy: string | undefined
  let nearestInterceptM: number | null = null
  let maxAutoCoastWish = 0
  const manualDesires: { who: string; idx: number; active: boolean }[] = []

  const tighten = (limit: number, mode: DynamicWarpInfo['mode'], reason: string, by?: string) => {
    if (limit < hardCap) {
      hardCap = limit
      capMode = mode
      capReason = reason
      throttledBy = by
    }
  }

  for (const p of Object.values(mp.players)) {
    if (p.warpAnchor) {
      tighten(0, 'anchor', `${p.username}: 1× sabitledi`, p.username)
    }

    const v = p.activeVesselId ? gs.vessels.find((o) => o.id === p.activeVesselId) ?? null : null
    if (!v || v.debris) {
      if (p.wantsWarpIdx >= 0) manualDesires.push({ who: p.username, idx: p.wantsWarpIdx, active: false })
      continue
    }

    const body = BODIES[v.bodyId]
    const st = vesselStats(v.parts, v.cargo)
    const s = situation(v, st)
    const ap = effectiveAutopilot(v)
    const c = controlsByPlayer.get(p.id) ?? null
    const usingControls = !!(c && (c.rotate !== 0 || c.tx !== 0 || c.ty !== 0))
    const recentManual = usingControls || (p.lastManualAt !== undefined && realClock - p.lastManualAt < 2.2)

    // 1) Roket-roket yakın temas / çarpışma algılama (yüksek warp'ta öngörü mesafesi genişler)
    const lookAheadSec = Math.max(22, Math.min(300, (WARPS[curWarpIdx] ?? 1) * 0.35))
    for (const o of gs.vessels) {
      if (o.id === v.id || o.bodyId !== v.bodyId || o.debris) continue
      if (o.ownerId === v.ownerId && (aLandedSkip(v, o))) continue
      const ca = closestApproach(v, o, lookAheadSec)
      if (nearestInterceptM === null || ca.dist < nearestInterceptM) nearestInterceptM = ca.dist
      if (ca.dist < 3000 || (ca.tca > 0 && ca.tca < Math.min(lookAheadSec, Math.max(15, (WARPS[curWarpIdx] ?? 1) * 0.2)) && ca.minAtTca < 2500)) {
        const capTo = ca.dist < 3000 ? 0 : 1
        tighten(capTo, 'combat', `⚔️ Yakın temas (${Math.round(ca.dist)} m) — ${WARPS[capTo]}×`, p.username)
      } else if (ca.dist < 12000 && ca.minAtTca < 4000) {
        tighten(1, 'combat', `⚔️ Kesişme yaklaşımı (${(ca.dist / 1000).toFixed(1)} km)`, p.username)
      }
    }

    if (!v.landed) {
      // 2) Manuel iniş / yüzeye tehlikeli yaklaşma
      if (body.landable && s.alt < 3000 && s.vr < -1 && ap === 'off') {
        tighten(s.alt < 1200 ? 0 : 1, 'landing', `${p.username}: ${body.name} manuel inişi`, p.username)
      } else if (body.landable && s.alt < 1200) {
        tighten(ap === 'land' ? 2 : 1, 'landing', `${p.username}: ${body.name} yüzey yaklaşımı`, p.username)
      } else if (body.atmoHeight > 0 && s.altSea < body.atmoHeight) {
        tighten(recentManual || v.throttle > 0 ? 1 : 2, 'burn', `${p.username}: ${body.name} atmosferi`, p.username)
      } else if (recentManual || (v.throttle > 0 && ap === 'off')) {
        tighten(2, 'burn', `${p.username}: manuel uçuş`, p.username)
      } else if (ap === 'land') {
        tighten(s.alt < 500 ? 1 : 3, 'landing', `${p.username}: ${body.name} oto-iniş`, p.username)
      } else if (ap === 'orbit' || ap === 'transfer') {
        const autoWish = autopilotWantedByVessel.get(v.id)
        if (v.throttle > 0) {
          tighten(2, 'burn', `${p.username}: otopilot yanışı`, p.username)
        } else if (needsPhysics(v, null)) {
          const el = elementsFromState(v.pos, v.vel, body.mu)
          const wait = orbitCoastWait(v, body, s)
          if (wait !== null && wait > 20) {
            maxAutoCoastWish = Math.max(maxAutoCoastWish, chooseCoastIdx(wait, 4))
          } else {
            const toAp = s.vr > 0 && el.e < 1 ? (el.ra - s.r) / Math.max(1, s.vr) : 0
            if (toAp > 45) maxAutoCoastWish = Math.max(maxAutoCoastWish, 4)
            else tighten(2, 'burn', `${p.username}: manevra hazırlığı`, p.username)
          }
        } else if (autoWish !== undefined && autoWish > 0) {
          maxAutoCoastWish = Math.max(maxAutoCoastWish, autoWish)
        }
      }
    }

    if (p.wantsWarpIdx >= 0) {
      manualDesires.push({ who: p.username, idx: p.wantsWarpIdx, active: !v.landed && v.throttle > 0 })
    }
  }

  let targetIdx = 0
  if (manualDesires.length > 0) {
    // Manuel tercih veren oyunculardan en temkinlisi belirler; Auto oyuncular güvenli ise engellemez.
    targetIdx = Math.min(...manualDesires.map((m) => m.idx))
    if (maxAutoCoastWish > targetIdx && manualDesires.every((m) => !m.active && m.idx >= 0)) {
      targetIdx = Math.max(targetIdx, maxAutoCoastWish)
    }
    if (targetIdx > 0 && capMode === 'auto') {
      capMode = 'manual'
      capReason = `${manualDesires[0]!.who}: ${WARPS[Math.min(hardCap, targetIdx)]!.toLocaleString('tr-TR')}× seçildi`
    }
  } else {
    targetIdx = mp.config.allowAutoWarp ? maxAutoCoastWish : 0
    if (targetIdx > 0 && capMode === 'auto') {
      capReason = 'Otopilot transfer süzülmesi — otomatik hızlanma'
    }
  }

  const desiredIdx = Math.max(0, Math.min(hardCap, targetIdx))
  let nextIdx = curWarpIdx
  let nextTimer = rampTimer

  if (desiredIdx < curWarpIdx) {
    // Tehlike/manevra anında anında yavaşla!
    nextIdx = desiredIdx
    nextTimer = 0
  } else if (desiredIdx > curWarpIdx) {
    nextTimer += realDt
    if (nextTimer >= 0.32) {
      nextIdx = Math.min(desiredIdx, curWarpIdx + 1)
      nextTimer = 0
    }
  } else {
    nextTimer = 0
  }

  if (!capReason) {
    capReason = nextIdx === 0 ? 'Akıllı zaman: normal akış (1×)' : `Akıllı zaman: ${WARPS[nextIdx]!.toLocaleString('tr-TR')}×`
  }

  const info: DynamicWarpInfo = {
    warpIdx: nextIdx,
    warp: WARPS[nextIdx]!,
    mode: capMode,
    reason: capReason,
    throttledBy,
    nearestInterceptM: nearestInterceptM !== null ? Math.round(nearestInterceptM) : null,
  }
  mp.warpInfo = info
  return { warpIdx: nextIdx, rampTimer: nextTimer, info }
}

function aLandedSkip(a: Vessel, b: Vessel) {
  return a.landed && b.landed
}
