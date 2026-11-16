/**
 * Açık dünya simülasyonu: tüm araçlar, zaman hızlandırma, etki alanı (SOI) geçişleri,
 * otopilotlar (yörünge & hedef transferi), gezegen gridi ve komut dağıtıcısı. React'ten bağımsızdır.
 */
import {
  baseReport,
  COLONY_SHIELD_PER_GEN,
  COLONY_STATION_ID,
  colonyShieldCap,
  colonyStationStatus,
  EARTH_MODULES,
  emptyBase,
  ensureSiteHp,
  ensureSites,
  ISS_SUPPLY_REWARD,
  MODULE_BY_ID,
  STARTER_EARTH_SITES,
  syncModules,
  tickBase,
  WARFARE_EARTH_MODULES,
} from '../game/base'
import { DEFAULT_DESIGN, GRID_H, GRID_W, INITIAL_MONEY, ISS_ALTITUDE_M, ISS_DESIGN, PART_BY_ID, partDef, partMaxHp } from '../game/data'
import { MISSION_BY_ID, MISSIONS } from '../game/missions'
import { baseIncomeMultiplier, hasAutoLandTech, INITIAL_TECH, isModuleUnlocked, isPartUnlocked, orePriceMultiplier, requiredTechForModule, requiredTechForPart } from '../game/tech'
import type { AutopilotMode, Base, GameCommand, GameEvent, GameState, PartInst, Vessel } from '../game/types'
import { activeEngines, cargoMass, components, estimateDeltaV, freshParts, fuelGroups, isCombatPart, isConnected, nextStage, setIspBoost, splitParts, vesselStats } from '../game/vessel'
import { BODIES, childrenOf, solarFlux, type BodyId } from '../nasa/bodies'
import { damageNearbyColoniesOnCrash, isWarfareMode, stepCombatSystems, stepProjectiles, stepVesselWeapons } from './combat'
import { bodyAbsState, bodyRelState, elementsFromState, hohmann, len, wrapPi } from './orbit'
import {
  orbitCoastWait,
  landingTolerance,
  chargeBatteries,
  type Controls,
  effectiveAutopilot,
  needsPhysics,
  PAD_ANGLE,
  rotateVessel,
  safeOrbitAlt,
  situation,
  stepPhysics,
  stepRails,
  terrainHeight,
} from './physics'
import { predictTrajectory } from './predict'
import {
  addPlayerMoney,
  computeDynamicWarp,
  getActiveVesselForPlayer,
  getPlayerMoney,
  isAnyActivePlayerVessel,
  landingWarpCap,
  PHYSICS_WARP_MAX_IDX,
  playerPadAngle,
  resolveVesselCollisions,
  setActiveVesselForPlayer,
  stepMultiplayerIncome,
  stepPlanetCaptures,
  vesselTargetBody,
  WARPS,
} from './multiplayerSim'

export { PHYSICS_WARP_MAX_IDX, WARPS }
const PHYSICS_DT = 0.02

export interface Fx {
  kind: 'boom' | 'whale' | 'tower' | 'beam' | 'hit' | 'shield' | 'muzzle'
  bodyId: BodyId
  x: number
  y: number
  x2?: number
  y2?: number
  color?: string
  born: number
  size: number
}

export interface Sim {
  gs: GameState
  warpIdx: number
  warpRampTimer?: number
  /** araç id → (parça indeksi → motor gücü) ; yalnızca çizim için */
  firing: Map<number, Map<number, number>>
  /** görsel efektler (patlama, balina, su kulesi, lazer…); kayda girmez */
  fx?: Fx[]
  /** efekt saati (gerçek saniye) */
  clock?: number
  towerHeat?: number
  towerGone?: boolean
  /** Rampada 50 m altında geçen süre (su kulesi easter egg'i). */
  padLinger?: number
  /** Otopilot 500 m altında 1×'e kilitlediğinde oyuncunun seçtiği hız. */
  warpLockPrev?: number
  /** Otopilot sırasında oyuncu hızı kendisi düşürdüyse otomatik hızlandırma yapılmaz (otopilot bitince sıfırlanır). */
  apWarpPinned?: boolean
  /** Bu gerçek saate (sim.clock) kadar zaman 1×'te tutulur (hedef yörüngesine oturunca kısa mola). */
  warpHoldUntil?: number
  rcsPulses?: number[]
  /** Çok oyunculu savaş modunda koloni hasarı/değişikliği anında senkron işareti */
  colonyDirty?: boolean
}

export function newGame(ownerId = 'local'): GameState {
  const earth = emptyBase(PAD_ANGLE, ownerId)
  earth.sites = [...STARTER_EARTH_SITES]
  syncModules(earth)
  return {
    time: 0,
    tick: 0,
    protocolVersion: 1,
    ownerId,
    players: { [ownerId]: { id: ownerId, username: ownerId } },
    money: INITIAL_MONEY,
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
  }
}

/** Zaman hızlandırmada pasif gelir istismarını önler: en fazla 5× hızında gelir birikir. */
export function effectiveIncomeDt(realDt: number, warp: number): number {
  const w = Math.max(0, warp)
  const effWarp = w <= 1 ? w : Math.min(5, 1 + Math.log2(w) * 0.85)
  return Math.max(0, realDt) * effWarp
}

export function tickBasesOnly(gs: GameState, incomeDtS: number, clockDtS = incomeDtS): number {
  let total = 0
  for (const id of Object.keys(gs.bases) as BodyId[]) {
    const base = gs.bases[id]
    if (!base) continue
    const flux = solarFlux(len(bodyAbsState(id, gs.time).r))
    const mult = baseIncomeMultiplier(gs, id)
    total += tickBase(base, flux, incomeDtS, mult, id !== 'earth')
  }
  gs.money += total
  gs.time += clockDtS
  return total
}

export function totalPassiveIncomePerHour(gs: GameState): number {
  let sum = 0
  for (const id of Object.keys(gs.bases) as BodyId[]) {
    const base = gs.bases[id]
    if (!base) continue
    const flux = solarFlux(len(bodyAbsState(id, gs.time).r))
    sum += baseReport(base, flux, baseIncomeMultiplier(gs, id)).incomePerHour
  }
  return sum
}

export const activeVessel = (gs: GameState) => gs.vessels.find((v) => v.id === gs.activeId) ?? null

function completeMission(gs: GameState, id: string, events: GameEvent[]) {
  if (gs.missionsDone.includes(id)) return
  const m = MISSION_BY_ID[id]
  if (!m) return
  gs.missionsDone.push(id)
  gs.money += m.reward
  events.push({ type: 'mission', id, title: m.title, reward: m.reward })
}

function signedWaitSec(targetPhase: number, currentPhase: number, phaseRate: number): number {
  let d = wrapPi(targetPhase - currentPhase)
  const s = Math.sign(phaseRate || 1)
  if (s > 0 && d < 0) d += 2 * Math.PI
  if (s < 0 && d > 0) d -= 2 * Math.PI
  return Math.abs(d / Math.max(1e-10, Math.abs(phaseRate)))
}

/** Çok oyunculu sabit zaman çarpanı (WARPS[1] = 2×). */
export const MP_FIXED_WARP_IDX = 1

/** Tek oyunculu otopilot: raylarda en fazla bu oyun zamanına kadar güvenle süzülünür (bir sonraki yanış). */
const apHold = new WeakMap<Vessel, number>()
const apLastMode = new WeakMap<Vessel, AutopilotMode>()
function isAutopilotOn(v: Vessel): boolean {
  const ap = effectiveAutopilot(v)
  return ap === 'orbit' || ap === 'transfer' || ap === 'land'
}
/** Yörünge/transfer otopilotu alçakta değilse oyuncu istediği hızı seçebilir; oto-iniş her zaman kontrollüdür. */
export const AP_LOCK_ALT = 500
/** Otopilotta 1× kilidinin yüksekliği: Dünya'da 500 m, diğer gök cisimlerinde 1000 m. */
export const apLockAlt = (bodyId: BodyId) => (bodyId === 'earth' ? AP_LOCK_ALT : 1000)
function apFree(gs: GameState, v: Vessel | null): boolean {
  if (!v || gs.mp || v.id !== gs.activeId || v.landed) return false
  const ap = effectiveAutopilot(v)
  if (ap !== 'orbit' && ap !== 'transfer' && ap !== 'land') return false
  return situation(v).alt >= apLockAlt(v.bodyId)
}
/** Fizik alt adımı: atmosferde/yere yakınken sabit, boşlukta hızla birlikte büyür. */
function physStep(v: Vessel, warp: number, free: boolean): number {
  if (!free || warp <= 25) return PHYSICS_DT
  const b = BODIES[v.bodyId]
  const s = situation(v)
  if (s.altSea < b.atmoHeight + 2000 || s.alt < 5000) return PHYSICS_DT
  if (v.throttle > 0) return PHYSICS_DT
  return Math.min(0.2, PHYSICS_DT * (warp / 25))
}
const PHYS_STEP_BUDGET = 260

// ───────── Çok oyunculu arcade hızlı yolculuk ─────────
const vcirc = (mu: number, r: number) => Math.sqrt(mu / r)
const visViva = (mu: number, r: number, a: number) => Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)))

function ancestry(id: BodyId): BodyId[] {
  const out: BodyId[] = []
  let cur: BodyId | null = id
  while (cur) {
    out.push(cur)
    cur = BODIES[cur].parentId as BodyId | null
  }
  return out
}

/** Varış yüksekliği: atmosfer sınırının hemen üstü (atmosfersizse güvenli alçak yörünge). */
export function arcadeArrivalRadius(id: BodyId): number {
  const b = BODIES[id]
  return b.radius + (b.atmoHeight > 0 ? b.atmoHeight + 3000 : Math.max(8000, safeOrbitAlt(b) * 0.6))
}

/** v∞ ile `top` seviyesinden çıkmak için `from` cisminin çevresinde gereken ek hız (yamalı konikler). */
function chainExcess(from: BodyId, top: BodyId, vinfTop: number): number {
  // top'tan aşağı from'a: her seviyede alt cismin yörünge yarıçapında gereken hızdan v∞ türet.
  const path = ancestry(from)
  const idx = path.indexOf(top)
  let vinf = vinfTop
  for (let k = idx; k > 0; k -= 1) {
    const X = BODIES[path[k]!]
    const Xc = BODIES[path[k - 1]!]
    const ra = Xc.orbit!.a
    const need = Math.sqrt(vinf * vinf + (2 * X.mu) / ra)
    vinf = Math.abs(need - vcirc(X.mu, ra))
  }
  return vinf
}

/** Hedefin atmosfer sınırındaki dairesel yörüngeye varmak için gereken Δv (yaklaşık, yamalı konikler). */
export function arcadeDeltaV(v: Vessel, targetId: BodyId): number {
  const A = v.bodyId
  if (A === targetId) return 0
  const r0 = Math.max(1, len(v.pos))
  const s0 = len(v.vel)
  const rA = arcadeArrivalRadius(targetId)
  const B = BODIES[targetId]
  const upA = ancestry(A)
  const upB = ancestry(targetId)
  const C = upA.find((id) => upB.includes(id))!
  const muC = BODIES[C].mu
  const childOnPath = (path: BodyId[]) => path[path.indexOf(C) - 1]!
  if (C === A) {
    // Hedef bu cismin uydusu (Dünya → Ay)
    const b = BODIES[childOnPath(upB)]
    const ab = b.orbit!.a
    const at = (r0 + ab) / 2
    const dv1 = Math.abs(visViva(muC, r0, at) - s0)
    const vinfB = Math.abs(vcirc(muC, ab) - visViva(muC, ab, at))
    const vinf = chainExcess(targetId, b.id, vinfB)
    return dv1 + Math.max(0, Math.sqrt(vinf * vinf + (2 * B.mu) / rA) - vcirc(B.mu, rA))
  }
  if (C === targetId) {
    // Ebeveyne dönüş (Ay → Dünya): enberisi atmosfer sınırında olan elips
    const a = BODIES[childOnPath(upA)]
    const aa = a.orbit!.a
    const at = (aa + rA) / 2
    const vinfA = Math.abs(vcirc(muC, aa) - visViva(muC, aa, at))
    const vinf = chainExcess(A, a.id, vinfA)
    const esc = Math.max(0, Math.sqrt(vinf * vinf + (2 * BODIES[A].mu) / r0) - s0)
    return esc + Math.max(0, visViva(muC, rA, at) - vcirc(muC, rA))
  }
  // Kardeş seviyeler (Dünya → Mars, Ay → Mars…): ortak ebeveyn çevresinde Hohmann
  const a = BODIES[childOnPath(upA)]
  const b = BODIES[childOnPath(upB)]
  const ra = a.orbit!.a
  const rb = b.orbit!.a
  const at = (ra + rb) / 2
  const vinfA = chainExcess(A, a.id, Math.abs(visViva(muC, ra, at) - vcirc(muC, ra)))
  const vinfB = chainExcess(targetId, b.id, Math.abs(vcirc(muC, rb) - visViva(muC, rb, at)))
  const esc = A === 'sun' ? 0 : Math.max(0, Math.sqrt(vinfA * vinfA + (2 * BODIES[A].mu) / r0) - s0)
  return esc + Math.max(0, Math.sqrt(vinfB * vinfB + (2 * B.mu) / rA) - vcirc(B.mu, rA))
}

/** Gereken Δv kadar yakıtı kademe kademe harcar; biten kademeler düşer. Yetmezse false (araç değişmez). */
export function arcadeBurn(v: Vessel, dv: number): boolean {
  const total = estimateDeltaV(v.parts, cargoMass(v.cargo), 9.8).reduce((s, st) => s + st.dv, 0)
  if (total + 1e-6 < dv) return false
  const origParts = v.parts.map((p) => ({ ...p }))
  const origDv = v.dvUsed
  let rem = dv
  for (let guard = 0; guard < 12 && rem > 1e-6; guard += 1) {
    const engines = activeEngines(v.parts)
    if (engines.length) {
      const groups = fuelGroups(v.parts)
      const gset = new Set(engines.map((i) => groups[i]))
      const tanks = v.parts.filter((p, j) => gset.has(groups[j]) && partDef(p.def).kind === 'tank' && (p.fuel ?? 0) > 0)
      const fuel = tanks.reduce((s, t) => s + (t.fuel ?? 0), 0)
      const thrust = engines.reduce((s, i) => s + partDef(v.parts[i]!.def).thrust!, 0)
      const flow = engines.reduce((s, i) => s + partDef(v.parts[i]!.def).thrust! / (partDef(v.parts[i]!.def).ispVac! * 9.80665), 0)
      const m0 = vesselStats(v.parts, v.cargo).mass
      if (fuel > 0 && flow > 0) {
        const ve = thrust / flow
        const stageDv = ve * Math.log(m0 / (m0 - fuel))
        if (rem <= stageDv) {
          const burn = m0 * (1 - Math.exp(-rem / ve))
          for (const t of tanks) t.fuel = Math.max(0, (t.fuel ?? 0) - burn * ((t.fuel ?? 0) / fuel))
          v.dvUsed += dv
          const stPost = vesselStats(v.parts, v.cargo)
          v.ec = Math.min(v.ec, stPost.ecCap)
          return true
        }
        for (const t of tanks) t.fuel = 0
        rem -= stageDv
      }
    }
    const stage = nextStage(v.parts)
    if (!stage.length) break
    const kept = splitParts(v.parts, stage)[0]
    if (!kept?.length) break
    v.parts = kept
  }
  if (rem <= 1e-6) {
    v.dvUsed += dv - rem
    const stPost = vesselStats(v.parts, v.cargo)
    v.ec = Math.min(v.ec, stPost.ecCap)
    return true
  }
  v.parts = origParts
  v.dvUsed = origDv
  return false
}

/** Arcade yolculuğu başlatır: yakıt düşülür, araç birkaç saniyede hedefin atmosfer sınırına geçer. */
function tryStartCruise(sim: Sim, v: Vessel, events: GameEvent[]): boolean {
  const gs = sim.gs
  const targetId = vesselTargetBody(gs, v)
  if (targetId === v.bodyId || v.landed || v.debris) return false
  const body = BODIES[v.bodyId]
  const s = situation(v)
  // Önce uzaya çık: atmosfer sınırı (atmosfersizse yüzeyden en az 3 km).
  const spaceAlt = body.atmoHeight > 0 ? body.atmoHeight : 3000
  if (v.bodyId !== 'sun' && s.altSea < spaceAlt) {
    v.autopilotNote = `${BODIES[targetId].name} (hızlı yolculuk · uzaya çıkış ${Math.max(0, Math.round(s.altSea / 1000))}/${Math.round(spaceAlt / 1000)} km)…`
    return false
  }
  const dv = arcadeDeltaV(v, targetId) * 1.05
  const target = BODIES[targetId]
  if (!arcadeBurn(v, dv)) {
    const have = estimateDeltaV(v.parts, cargoMass(v.cargo), 9.8).reduce((a, st) => a + st.dv, 0)
    v.autopilot = 'off'
    v.autopilotNote = undefined
    events.push({ type: 'toast', ownerId: v.ownerId, text: `Hızlı yolculuk → ${target.name}: ≈ ${Math.round(dv)} m/s gerekli, gemide ${Math.round(have)} m/s var.` })
    return true
  }
  const t = gs.time
  const fromAbs = bodyAbsState(v.bodyId, t).r
  const toAbs = bodyAbsState(targetId, t).r
  const startAbs = { x: fromAbs.x + v.pos.x, y: fromAbs.y + v.pos.y }
  let dir = { x: startAbs.x - toAbs.x, y: startAbs.y - toAbs.y }
  const dl = Math.max(1, len(dir))
  dir = { x: dir.x / dl, y: dir.y / dl }
  const rA = arcadeArrivalRadius(targetId)
  const vc = vcirc(target.mu, rA)
  const dist = len({ x: toAbs.x - startAbs.x, y: toAbs.y - startAbs.y })
  v.cruise = {
    from: v.bodyId,
    fromRel: { ...v.pos },
    to: targetId,
    toRel: { x: dir.x * rA, y: dir.y * rA },
    toVel: { x: -dir.y * vc, y: dir.x * vc },
    start: sim.clock ?? 0,
    dur: Math.max(7.5, Math.min(13.5, 6.5 + 2.3 * Math.log10(Math.max(1, dist / 1e6)))),
  }
  v.throttle = 0
  v.autopilot = 'off'
  v.autopilotNote = `Hızlı yolculuk → ${target.name}…`
  v.vel = { x: 0, y: 0 }
  sim.firing.delete(v.id)
  events.push({ type: 'toast', ownerId: v.ownerId, text: `Hızlı yolculuk → ${target.name}: ${Math.round(dv)} m/s'lik yakıt harcandı.` })
  return true
}

/** Hızlı yolculuktaki aracı ilerletir (ev sahibi ve istemci aynı hesabı yapar). Vardıysa 'arrived'. */
export function stepCruise(gs: GameState, clock: number, v: Vessel): 'cruising' | 'arrived' | null {
  const c = v.cruise
  if (!c) return null
  const u = Math.max(0, Math.min(1, (clock - c.start) / c.dur))
  if (u >= 1) {
    v.bodyId = c.to
    v.pos = { ...c.toRel }
    v.vel = { ...c.toVel }
    v.angle = Math.atan2(c.toVel.y, c.toVel.x)
    v.angVel = 0
    v.throttle = 0
    v.assist = null
    v.cruise = undefined
    v.autopilotNote = undefined
    if (!v.visited.includes(c.to)) v.visited.push(c.to)
    return 'arrived'
  }
  const e = u * u * (3 - 2 * u)
  const fromAbs = bodyAbsState(c.from, gs.time).r
  const toAbs = bodyAbsState(c.to, gs.time).r
  const p0 = { x: fromAbs.x + c.fromRel.x, y: fromAbs.y + c.fromRel.y }
  const p3 = { x: toAbs.x + c.toRel.x, y: toAbs.y + c.toRel.y }
  // Kübik Bézier: kalkışta gezegenden dışarı, varışta hedefe dışarıdan yaklaşır; yol hiçbir
  // gezegenin içinden geçmez.
  const dist = Math.max(1, len({ x: p3.x - p0.x, y: p3.y - p0.y }))
  const n0 = Math.max(1, len(c.fromRel))
  const n3 = Math.max(1, len(c.toRel))
  const k0 = Math.max(dist * 0.45, BODIES[c.from].radius * 2)
  const k3 = Math.max(dist * 0.3, BODIES[c.to].radius * 2)
  const p1 = { x: p0.x + (c.fromRel.x / n0) * k0, y: p0.y + (c.fromRel.y / n0) * k0 }
  const p2 = { x: p3.x + (c.toRel.x / n3) * k3, y: p3.y + (c.toRel.y / n3) * k3 }
  const bez = (t: number) => {
    const m = 1 - t
    const w0 = m * m * m
    const w1 = 3 * m * m * t
    const w2 = 3 * m * t * t
    const w3 = t * t * t
    return { x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y }
  }
  const p = bez(e)
  const ahead = bez(Math.min(1, e + 0.01))
  const ref = u < 0.5 ? c.from : c.to
  const refAbs = ref === c.from ? fromAbs : toAbs
  v.bodyId = ref
  v.pos = { x: p.x - refAbs.x, y: p.y - refAbs.y }
  const dx = ahead.x - p.x
  const dy = ahead.y - p.y
  const dFwd = len({ x: dx, y: dy })
  if (dFwd > 1) {
    const moveAng = Math.atan2(dy, dx)
    v.angle = u >= 0.74 ? wrapPi(moveAng + Math.PI) : moveAng
  }
  const cruiseSpeed = Math.max(1200, Math.sin(Math.PI * u) * (dist / Math.max(1, c.dur)) * 1.4)
  v.vel = dFwd > 1 ? { x: (dx / dFwd) * cruiseSpeed, y: (dy / dFwd) * cruiseSpeed } : { x: 0, y: 0 }
  v.throttle = u < 0.7 || u > 0.78 ? 0.92 : 0.25
  v.autopilotNote = `Hızlı yolculuk → ${BODIES[c.to].name} (%${Math.round(u * 100)})`
  v.angVel = 0
  return 'cruising'
}

/** Bekleme süresine göre en hızlı güvenli zaman çarpanı: bekleme yaklaşık 3 gerçek saniyede geçer. */
function chooseCoastWarpIdx(waitSec: number, maxCap = WARPS.length - 1): number {
  let idx = 0
  for (let i = 0; i < WARPS.length; i += 1) if (WARPS[i]! <= waitSec / 3) idx = i
  return Math.min(maxCap, idx)
}

function maxAccelEstimate(v: Vessel): number {
  const st = vesselStats(v.parts, v.cargo)
  const s = situation(v, st)
  const p = Math.min(1, Math.max(0, s.altSea < BODIES[v.bodyId].atmoHeight ? 1 - s.altSea / Math.max(1, BODIES[v.bodyId].atmoHeight) : 0))
  const totalF = activeEngines(v.parts).reduce((sum, i) => {
    const d = partDef(v.parts[i]!.def)
    const isp = d.ispVac! + (d.ispSL! - d.ispVac!) * p
    return sum + (d.thrust! * isp) / d.ispVac!
  }, 0)
  return totalF / Math.max(0.1, st.mass)
}

/** Yakıtı bitmiş alt kademeyi otomatik ayırır (otopilotlarda gaz sıfırlansa bile takılmayı önler). */
function autoStageIfSpent(sim: Sim, v: Vessel, events: GameEvent[]) {
  if (v.landed) return
  const next = nextStage(v.parts)
  if (!next.length) return
  const pieces = splitParts(v.parts, next)
  if (pieces.length <= 1) return
  const dropped = pieces.slice(1).flat()
  const hasEngineOrTank = dropped.some((p) => {
    const k = partDef(p.def).kind
    return k === 'tank' || k === 'engine'
  })
  if (!hasEngineOrTank) return
  const hasRemainingFuel = dropped.some((p) => partDef(p.def).kind === 'tank' && (p.fuel ?? 0) > 1e-4)
  if (!hasRemainingFuel) {
    events.push(...stageNext(sim, v))
  }
}

const encounterCache = new WeakMap<
  Vessel,
  { bodyId: BodyId; key: string; tEnd: number | null; throttleWas: number; checkedTick: number }
>()

/** Yaklaşılan SOI karşılaşmasını tahmin eder (süzülmede önbellekli, motor yanarken seyrek günceller). */
function findEncounterEnd(v: Vessel, targets: BodyId[], time: number, tick: number): number | null {
  const key = targets.join(',')
  const prev = encounterCache.get(v)
  const sameCtx = prev && prev.bodyId === v.bodyId && prev.key === key
  if (sameCtx) {
    if (v.throttle === 0 && prev.throttleWas === 0 && prev.tEnd !== null && time < prev.tEnd && tick - prev.checkedTick < 60) {
      return prev.tEnd
    }
    const minInterval = v.throttle > 0 ? 4 : 18
    if (tick - prev.checkedTick < minInterval) return prev.tEnd
  }
  const patches = predictTrajectory(v.bodyId, v.pos, v.vel, time, 2)
  const hit = patches.find((p) => targets.includes(p.bodyId))
  const tEnd = hit ? patches[0]!.tEnd : null
  encounterCache.set(v, { bodyId: v.bodyId, key, tEnd, throttleWas: v.throttle, checkedTick: tick })
  return tEnd
}

/** Hedef gök cismine otomatik transfer hesaplayıcı (Dünya→Ay, Dünya→Gezegen, Güneş→Gezegen). */
function updateTransferAutopilot(
  sim: Sim,
  v: Vessel,
  events: GameEvent[],
  wantedWarpOut?: Map<number, number>,
): number | null {
  const gs = sim.gs
  const targetId = vesselTargetBody(gs, v)
  const target = BODIES[targetId]
  const body = BODIES[v.bodyId]
  // Çok oyunculuda zaman yöneticisine öneri; tek oyunculuda zamanı oyuncu seçer, otopilot yalnızca
  // bir sonraki yanışı kaçırmamak için süzülmeyi o ana kadar keser.
  apHold.delete(v)
  const hold = (sec: number) => {
    wantedWarpOut?.set(v.id, chooseCoastWarpIdx(sec, 9))
    if (!gs.mp) apHold.set(v, gs.time + Math.max(0, sec))
  }
  const clearHighWarp = () => {
    wantedWarpOut?.set(v.id, 0)
    apHold.delete(v)
  }

  if (v.bodyId === targetId) {
    triggerProximityArrival(sim, v, targetId, events)
    return null
  }

  const st = vesselStats(v.parts, v.cargo)
  const s = situation(v, st)
  const el = elementsFromState(v.pos, v.vel, body.mu)
  const r = len(v.pos)
  const shipAngle = Math.atan2(v.pos.y, v.pos.x)
  const safeAlt = body.id === 'sun' ? 0 : safeOrbitAlt(body)

  // Önce güvenli kapalı park yörüngesine otur (iniş/alt-yörüngeyse physics içindeki autoOrbit devralır)
  const safePeri = body.id === 'sun' ? 0 : body.radius + (body.atmoHeight > 0 ? body.atmoHeight + 4000 : Math.max(4000, safeAlt * 0.5))
  const needsParking =
    v.bodyId !== 'sun' &&
    (v.landed ||
      el.rp < safePeri ||
      (el.e < 1 && el.ra < body.radius + safeAlt * 0.78))
  if (needsParking) {
    v.autopilotNote = `${target.name} transferi öncesi park yörüngesine çıkılıyor…`
    // Park yörüngesine çıkarken öte noktaya süzülme de bir sonraki yanışta kesilmeli.
    if (!v.landed && v.throttle <= 0) {
      const wait = orbitCoastWait(v, body, s)
      if (wait !== null) hold(wait)
    }
    return null
  }

  const proAngle = s.speed > 1 ? Math.atan2(v.vel.y, v.vel.x) : s.theta
  const retroAngle = proAngle + Math.PI
  const maxAccel = maxAccelEstimate(v)

  // 1) Ana gövde → uydu transferi (Dünya→Ay, Jüpiter→Ganimed, Satürn→Titan)
  if (target.parentId === v.bodyId && target.orbit) {
    const rTarget = target.orbit.a
    // Önce mevcut rota zaten hedef uydunun SOI'sine giriyor mu kontrol et
    if (el.ra >= rTarget * 0.72 || el.e >= 0.35) {
      const hitEnd = findEncounterEnd(v, [targetId], gs.time, gs.tick ?? 0)
      if (hitEnd !== null) {
        v.throttle = 0
        const rem = Math.max(0, hitEnd - gs.time)
        if (s.altSea >= body.atmoHeight) {
          hold(rem)
        }
        v.autopilotNote = `${target.name}'a süzülme — varış ${Math.max(1, Math.round(rem))} s`
        return proAngle
      }
    }

    const h = hohmann(body.mu, r, rTarget, target.orbit.n)
    const ms = bodyRelState(target, gs.time).r
    const phaseNow = Math.atan2(ms.y, ms.x) - shipAngle
    const nShip = el.dir * Math.sqrt(body.mu / Math.max(1, r) ** 3)
    const rate = target.orbit.n - nShip
    const waitSec = signedWaitSec(h.phase, wrapPi(phaseNow), rate)
    const burnDur = Math.abs(h.dv1) / Math.max(0.5, maxAccel)
    const lead = Math.max(6, Math.min(40, burnDur * 0.45))

    const burningNow = el.e > 0.12 && el.ra < rTarget * 1.05 && el.ra > r * 1.12
    if (!burningNow && waitSec > lead && el.ra < rTarget * 0.94) {
      v.throttle = 0
      if (s.altSea >= body.atmoHeight) {
        hold(Math.max(0, waitSec - lead))
      }
      v.autopilotNote = `${target.name} transfer penceresi bekleniyor (${Math.round(waitSec)} s)…`
      return proAngle
    }

    clearHighWarp()
    if (el.ra >= rTarget * 1.03 || el.e >= 0.94) {
      v.throttle = 0
      v.autopilotNote = `${target.name} transfer yörüngesinde süzülüyor…`
      return proAngle
    }
    const align = Math.cos(wrapPi(v.angle - proAngle))
    const fine = el.ra > rTarget * 0.72 ? 0.35 : 1
    v.throttle = align > 0.6 ? fine : 0
    v.autopilotNote = `${target.name} Hohmann transfer yanışı…`
    return proAngle
  }

  // 1b) Uydudan çıkış (örn. Ay → Dünya/Mars, Ganimed → Jüpiter, Titan → Satürn)
  if (body.parentId && body.parentId !== 'sun' && body.orbit && target.parentId !== v.bodyId) {
    if (el.e > 1.04) {
      v.throttle = 0
      if (s.altSea >= body.atmoHeight && s.vr > 0) hold((body.soi - s.r) / Math.max(1, s.vr))
      v.autopilotNote = `${body.name} çekiminden çıkılıyor…`
      return proAngle
    }
    const parentBody = BODIES[body.parentId]
    const relV = bodyRelState(body, gs.time).v
    const targetPlanet = target.parentId === 'sun' ? target : target.parentId ? BODIES[target.parentId] : null
    const goInward = targetId === body.parentId || (targetPlanet?.orbit && parentBody.orbit && targetPlanet.orbit.a < parentBody.orbit.a)
    const ejectDir = Math.atan2(relV.y, relV.x) + (goInward ? Math.PI : 0)
    const r2 =
      targetId === body.parentId
        ? parentBody.radius + safeOrbitAlt(parentBody)
        : Math.max(parentBody.radius + safeOrbitAlt(parentBody) * 2, body.orbit.a + body.soi * 1.35)
    const hmParent = hohmann(parentBody.mu, body.orbit.a, r2, 0)
    const vInf = Math.max(80, Math.abs(hmParent.dv1))
    const eEst = Math.max(1.06, (r * ((2 * body.mu) / r + vInf * vInf)) / body.mu - 1)
    const nuInf = Math.acos(-1 / eEst)
    const burnPosAngle = wrapPi(ejectDir - el.dir * nuInf)
    const nShip = Math.sqrt(body.mu / Math.max(1, r) ** 3)
    const orbitWait = signedWaitSec(burnPosAngle, shipAngle, el.dir * nShip)
    if (el.e < 0.5 && orbitWait > 14) {
      v.throttle = 0
      if (s.altSea >= body.atmoHeight) hold(orbitWait - 8)
      v.autopilotNote = `${target.name} için ${body.name} çıkış açısına dönülüyor (${Math.round(orbitWait)} s)…`
      return proAngle
    }
    clearHighWarp()
    const align = Math.cos(wrapPi(v.angle - proAngle))
    v.throttle = align > 0.55 ? 1 : 0
    v.autopilotNote = `${body.name}'dan ayrılma yanışı…`
    return proAngle
  }

  // 2) Gezegenler arası kaçış (Güneş etrafındaki herhangi bir gezegenden başka gezegene/uyduya)
  if (body.parentId === 'sun' && target.parentId !== v.bodyId) {
    if (targetId === 'sun' || !target.parentId) return null
    const planet = target.parentId === 'sun' ? target : BODIES[target.parentId]
    if (!planet?.orbit || !body.orbit) return null
    const hm = hohmann(BODIES.sun.mu, body.orbit.a, planet.orbit.a, planet.orbit.n)
    const ea = bodyAbsState(body.id, gs.time)
    const pa = bodyAbsState(planet.id, gs.time)
    const sunPh = wrapPi(Math.atan2(pa.r.y, pa.r.x) - Math.atan2(ea.r.y, ea.r.x))
    const sunRate = planet.orbit.n - body.orbit.n
    const sunWait = signedWaitSec(hm.phase, sunPh, sunRate)
    const vInfNeed = Math.abs(hm.dv1)
    const energyNow = (s.speed * s.speed) / 2 - body.mu / r
    const energyTarget = (vInfNeed * vInfNeed) / 2

    if (el.e > 1.02 && energyNow >= energyTarget * 0.94) {
      v.throttle = 0
      if (s.altSea >= body.atmoHeight && s.vr > 0) hold((body.soi - s.r) / Math.max(1, s.vr))
      v.autopilotNote = `${planet.name}'a doğru ${body.name} çekiminden çıkılıyor…`
      return proAngle
    }

    if (sunWait > 3600 * 12 && el.e < 0.85) {
      v.throttle = 0
      if (s.altSea >= body.atmoHeight) hold(sunWait - 3600 * 6)
      v.autopilotNote = `${planet.name} gezegen penceresi bekleniyor…`
      return proAngle
    }

    const outer = planet.orbit.a > body.orbit.a
    const ejectDir = Math.atan2(ea.v.y, ea.v.x) + (outer ? 0 : Math.PI)
    const eEst = Math.max(1.04, (r * ((2 * body.mu) / r + vInfNeed * vInfNeed)) / body.mu - 1)
    const nuInf = Math.acos(-1 / eEst)
    const burnPosAngle = wrapPi(ejectDir - el.dir * nuInf)
    const nShip = Math.sqrt(body.mu / Math.max(1, r) ** 3)
    const orbitWait = signedWaitSec(burnPosAngle, shipAngle, el.dir * nShip)

    if (el.e < 0.7 && orbitWait > 14) {
      v.throttle = 0
      if (s.altSea >= body.atmoHeight) hold(orbitWait - 8)
      v.autopilotNote = `${planet.name} çıkış açısına dönülüyor (${Math.round(orbitWait)} s)…`
      return proAngle
    }

    clearHighWarp()
    const align = Math.cos(wrapPi(v.angle - proAngle))
    v.throttle = align > 0.55 ? 1 : 0
    v.autopilotNote = `${planet.name} gezegenler arası kaçış yanışı…`
    return proAngle
  }

  // 3) Güneş yörüngesinden hedef gezegene yönelme
  if (v.bodyId === 'sun') {
    const planet = target.parentId === 'sun' ? target : BODIES[target.parentId!]
    if (!planet.orbit) return null
    const crossesBand = el.rp <= planet.orbit.a + planet.soi * 2.5 && (el.e >= 1 || el.ra >= planet.orbit.a - planet.soi * 2.5)
    if (crossesBand) {
      const hitEnd = findEncounterEnd(v, [planet.id, targetId], gs.time, gs.tick ?? 0)
      if (hitEnd !== null) {
        v.throttle = 0
        const rem = Math.max(0, hitEnd - gs.time)
        hold(rem)
        v.autopilotNote = `${planet.name}'a karşılaşma kilitli — varış bekleniyor…`
        return proAngle
      }
    }
    const hm = hohmann(body.mu, r, planet.orbit.a, planet.orbit.n)
    const pa = bodyAbsState(planet.id, gs.time).r
    const ph = wrapPi(Math.atan2(pa.y, pa.x) - shipAngle)
    const nShip = el.dir * Math.sqrt(body.mu / Math.max(1, r) ** 3)
    const waitSec = signedWaitSec(hm.phase, ph, planet.orbit.n - nShip)
    const outer = planet.orbit.a > r
    const reachedRadius = outer ? el.e >= 1 || el.ra >= planet.orbit.a * 0.98 : el.rp <= planet.orbit.a * 1.02

    if (reachedRadius) {
      v.throttle = 0
      hold(Math.max(10_000, waitSec * 0.25))
      v.autopilotNote = `${planet.name} yörünge kesişimi bekleniyor…`
      return proAngle
    }

    if (waitSec > 3600 * 18) {
      v.throttle = 0
      hold(waitSec - 3600 * 6)
      v.autopilotNote = `${planet.name} Güneş transfer penceresi bekleniyor…`
      return proAngle
    }

    clearHighWarp()
    const aim = hm.dv1 >= 0 ? proAngle : retroAngle
    const align = Math.cos(wrapPi(v.angle - aim))
    v.throttle = align > 0.6 ? 1 : 0
    v.autopilotNote = `${planet.name} yörünge transfer yanışı…`
    return aim
  }

  return null
}

function triggerProximityArrival(sim: Sim, v: Vessel, bodyId: BodyId, events: GameEvent[]) {
  const b = BODIES[bodyId]
  // Varışta otopilot kapanmaz: hedefin çevresinde güvenli yörüngeye kendisi girer.
  v.throttle = 0
  v.autopilot = 'orbit'
  v.autoLand = false
  v.autopilotNote = `${b.name} yörüngesine giriliyor…`
  v.sas = 'retrograde'
  v.approachWarn = bodyId
  if (sim.gs.mp && sim.warpIdx > 2) sim.warpIdx = 0
  // Tek oyunculu "hedefe git" yörüngeye oturmadan doğrudan yüzeye iner (1000 m altında 1×).
  const willLand = !sim.gs.mp && b.landable && hasAutoLandTech(sim.gs)
  if (willLand) {
    v.autopilot = 'land'
    v.autoLand = true
    v.sas = 'off'
    v.autopilotNote = `${b.name} yüzeyine iniliyor…`
  }
  events.push({
    type: 'toast',
    ownerId: v.ownerId,
    text: willLand
      ? `✓ ${b.name} hedefine ulaşıldı. Otopilot doğrudan yüzeye iniyor.`
      : b.landable
        ? `✓ ${b.name} hedefine ulaşıldı. Otopilot yörüngeye giriyor; inmek için Oto-İniş'e bas.`
        : `✓ ${b.name} hedefine ulaşıldı. Otopilot yörüngeye giriyor.`,
  })
}

/** Yamalı konikler: araç hangi cismin etki alanındaysa yalnızca onun çekimini hisseder. */
function checkSoi(sim: Sim, v: Vessel, t: number, events: GameEvent[]): boolean {
  const gs = sim.gs
  const body = BODIES[v.bodyId]
  const r = len(v.pos)
  if (body.parentId && r > body.soi) {
    const s = bodyRelState(body, t)
    v.pos = { x: v.pos.x + s.r.x, y: v.pos.y + s.r.y }
    v.vel = { x: v.vel.x + s.v.x, y: v.vel.y + s.v.y }
    v.bodyId = body.parentId
    if (v.assist && v.assist.bodyId === body.id) {
      const gain = len(v.vel) - v.assist.speedIn
      if (v.dvUsed - v.assist.dvIn < 15 && Math.abs(gain) > 25) {
        events.push({ type: 'toast', ownerId: v.ownerId, text: `Yerçekimi sapanı: ${body.name} sayesinde ${gain > 0 ? '+' : ''}${gain.toFixed(0)} m/s` })
        if (gain > 25 && !gs.mp) completeMission(gs, 'grav-assist', events)
      }
    }
    v.assist = null
    v.approachWarn = null
    events.push({ type: 'soi', from: body.id, to: body.parentId })
    return true
  }
  const vTarget = vesselTargetBody(gs, v)
  for (const child of childrenOf(body.id)) {
    const s = bodyRelState(child, t)
    const d = { x: v.pos.x - s.r.x, y: v.pos.y - s.r.y }
    if (len(d) < child.soi) {
      v.assist = { bodyId: child.id, speedIn: len(v.vel), dvIn: v.dvUsed }
      v.pos = d
      v.vel = { x: v.vel.x - s.v.x, y: v.vel.y - s.v.y }
      v.bodyId = child.id
      if (!v.visited.includes(child.id)) v.visited.push(child.id)
      events.push({ type: 'soi', from: body.id, to: child.id })
      if (effectiveAutopilot(v) === 'transfer' && child.id === vTarget) {
        triggerProximityArrival(sim, v, child.id, events)
      } else if (child.id === vTarget && !hasAutoLandTech(gs)) {
        v.approachWarn = child.id
        if (!gs.mp && v.id === gs.activeId) sim.warpIdx = Math.min(sim.warpIdx, 2)
        else if (gs.mp) sim.warpIdx = Math.min(sim.warpIdx, 2)
        events.push({
          type: 'toast',
          ownerId: v.ownerId,
          text: `⚠ ${child.name} hedefine girildi! Otomatik iniş henüz kapalı — yüzeye yaklaşırken dikkat et!`,
        })
      }
      return true
    }
  }
  return false
}

function destroy(sim: Sim, v: Vessel, reason: string, events: GameEvent[]) {
  const gs = sim.gs
  const wasActive = gs.activeId === v.id
  if (damageNearbyColoniesOnCrash(gs, v, len(v.vel), sim.clock ?? 0, (sim.fx ??= []), events)) {
    sim.colonyDirty = true
  }
  gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
  sim.firing.delete(v.id)
  if (wasActive) gs.activeId = null
  if (gs.mp && v.ownerId) {
    const owner = gs.mp.players[v.ownerId]
    if (owner && owner.activeVesselId === v.id) owner.activeVesselId = null
  }
  boom(sim, v.bodyId, v.pos.x, v.pos.y, 9, events)
  events.push({ type: 'crash', name: v.name, wasActive, reason, ownerId: v.ownerId, vesselId: v.id })
}

function boom(sim: Sim, bodyId: BodyId, x: number, y: number, size: number, events: GameEvent[]) {
  const fx = (sim.fx ??= [])
  fx.push({ kind: 'boom', bodyId, x, y, born: sim.clock ?? 0, size })
  if (fx.length > 60) fx.splice(0, fx.length - 60)
  events.push({ type: 'explosion', size, bodyId, x, y })
}

function grant(gs: GameState, id: string, title: string, text: string, events: GameEvent[], bonus = 0) {
  if (gs.mp) return false
  const list = (gs.achievements ??= [])
  if (list.includes(id)) return false
  list.push(id)
  gs.money += bonus
  events.push({ type: 'achievement', id, title, text })
  return true
}

/** Parçanın gök cismi çerçevesindeki konumu. */
function partWorldPos(v: Vessel, st: ReturnType<typeof vesselStats>, p: PartInst) {
  const d = partDef(p.def)
  const lx = p.x + d.w / 2 - st.comX
  const lf = -(p.y + d.h / 2 - st.comY)
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  return { x: v.pos.x + fwd.y * lx + fwd.x * lf, y: v.pos.y - fwd.x * lx + fwd.y * lf }
}

/**
 * Çarpışma: araç parçalarına ayrılır. Kopan her parça kendi hızı ve dönüşüyle bağımsız bir
 * enkaz olur, yerçekimiyle savrulur ve yere değdiği yerde patlar. Hafif çarpmada yalnızca
 * alt parçalar kopar, komuta modülünü taşıyan gövde hasarlı iner.
 */
function shatter(sim: Sim, v: Vessel, speed: number, reason: string, events: GameEvent[]) {
  const gs = sim.gs
  if (damageNearbyColoniesOnCrash(gs, v, speed, sim.clock ?? 0, (sim.fx ??= []), events)) {
    sim.colonyDirty = true
  }
  const st = vesselStats(v.parts)
  const severity = speed / Math.max(1, landingTolerance(st))
  const total = v.parts.length
  const breakCount = severity >= 2.6 || total <= 1 ? total : Math.max(1, Math.min(total - 1, Math.round(total * 0.3 * (severity - 0.6))))
  // Alttan başlayarak kopacak parçalar
  const order = v.parts.map((_, i) => i).sort((a, b) => v.parts[b]!.y + partDef(v.parts[b]!.def).h - (v.parts[a]!.y + partDef(v.parts[a]!.def).h))
  const lost = new Set(order.slice(0, breakCount))
  // Komuta modülünden kopan parçalar da enkaz olur
  const keep = v.parts.filter((_, i) => !lost.has(i))
  const group = components(keep)
  const cmd = keep.findIndex((p) => partDef(p.def).kind === 'command')
  const survivors = cmd >= 0 ? keep.filter((_, i) => group[i] === group[cmd]) : []
  const debris = v.parts.filter((p) => !survivors.includes(p))
  const up = (() => {
    const r = Math.hypot(v.pos.x, v.pos.y) || 1
    return { x: v.pos.x / r, y: v.pos.y / r }
  })()
  const tan = { x: -up.y, y: up.x }
  const vt = v.vel.x * tan.x + v.vel.y * tan.y
  const kick = Math.min(45, 6 + speed * 0.45)
  debris.forEach((p, k) => {
    const w = partWorldPos(v, st, p)
    const side = (p.x + partDef(p.def).w / 2 - st.comX) / Math.max(1, st.maxX - st.minX)
    const lift = kick * (0.25 + Math.random() * 0.9)
    const sideways = vt * 0.55 + kick * (side * 1.6 + (Math.random() - 0.5) * 1.3)
    const id = gs.nextId
    gs.nextId += 1
    gs.vessels.push({
      id, name: `Enkaz ${id}`, ownerId: v.ownerId, parts: [{ ...p, x: 0, y: 0 }], bodyId: v.bodyId,
      pos: { x: w.x + up.x * 0.6, y: w.y + up.y * 0.6 },
      vel: { x: up.x * lift + tan.x * sideways, y: up.y * lift + tan.y * sideways },
      angle: v.angle, angVel: (Math.random() - 0.5) * 7, landed: false, throttle: 0, ec: 0,
      cargo: { modules: {}, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off', visited: [], assist: null, dvUsed: 0,
      noCollideUntil: gs.time + 0.8,
      debris: { ttl: 5 + Math.random() * 4 },
    })
    // İlk çarpmada birkaç parça hemen patlar
    if (k % 5 === 0) boom(sim, v.bodyId, w.x, w.y, 2 + Math.max(partDef(p.def).w, partDef(p.def).h) * 0.6, events)
  })
  if (!survivors.length) {
    const wasActive = gs.activeId === v.id
    gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
    sim.firing.delete(v.id)
    if (wasActive) gs.activeId = null
    if (gs.mp && v.ownerId) {
      const owner = gs.mp.players[v.ownerId]
      if (owner && owner.activeVesselId === v.id) owner.activeVesselId = null
    }
    events.push({ type: 'crash', name: v.name, wasActive, reason, ownerId: v.ownerId, vesselId: v.id })
    return
  }
  v.parts = survivors
  const body = BODIES[v.bodyId]
  const st2 = vesselStats(v.parts)
  const theta = Math.atan2(v.pos.y, v.pos.x)
  const r = body.radius + terrainHeight(body.id, theta) + (st2.maxY - st2.comY)
  v.pos = { x: Math.cos(theta) * r, y: Math.sin(theta) * r }
  v.angle = theta
  v.landed = true
  v.vel = { x: 0, y: 0 }
  v.angVel = 0
  v.throttle = 0
  v.autopilot = 'off'
  v.autoLand = false
  v.autopilotNote = undefined
  v.approachWarn = null
  v.ec = Math.min(v.ec, st2.ecCap)
  if (v.shield !== undefined) v.shield = Math.min(v.shield, st2.shieldCap)
  if (cargoMass(v.cargo) > st2.cargoCap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
  events.push({ type: 'toast', ownerId: v.ownerId, text: 'Sert iniş! Araç hasar aldı ama komuta modülü kurtuldu.' })
}

/** Enkaz parçası: süresi dolunca ya da yere değince patlayıp yok olur. */
function explodeDebris(sim: Sim, v: Vessel, events: GameEvent[]) {
  const d = partDef(v.parts[0]?.def ?? 'tank-s')
  boom(sim, v.bodyId, v.pos.x, v.pos.y, 1.8 + Math.max(d.w, d.h) * 0.8 + (v.parts[0]?.fuel ?? 0) * 0.25, events)
  sim.gs.vessels = sim.gs.vessels.filter((o) => o.id !== v.id)
  sim.firing.delete(v.id)
}

// ───────────────────────── ISS ─────────────────────────

export const isStationVessel = (v: Vessel) => v.parts.some((p) => p.def === 'iss-core')

/** Dünya yörüngesinde bir ISS yoksa oluşturur. */
export function ensureStation(gs: GameState) {
  if (gs.mp || gs.vessels.some(isStationVessel)) return
  const r = BODIES.earth.radius + ISS_ALTITUDE_M
  const speed = Math.sqrt(BODIES.earth.mu / r)
  const a = 2.2
  const id = gs.nextId
  gs.nextId += 1
  gs.vessels.push({
    id, name: 'ISS', station: true, ownerId: gs.ownerId, parts: freshParts(ISS_DESIGN), bodyId: 'earth',
    pos: { x: Math.cos(a) * r, y: Math.sin(a) * r }, vel: { x: Math.sin(a) * speed, y: -Math.cos(a) * speed },
    angle: a, angVel: 0, landed: false, throttle: 0, ec: 200, cargo: { modules: {}, ore: 0, oreFrom: null },
    rcsOn: false, sas: 'off', visited: ['earth'], assist: null, dvUsed: 0,
  })
}

/**
 * Buluşma otopilotu: araç Dünya çevresinde kararlı yörüngedeyken ISS'in yanına götürür.
 * Gereken Δv (Hohmann + eşleme payı) yakıttan düşülür; son kenetlenme oyuncudadır.
 */
export function rendezvousStation(sim: Sim, v: Vessel): string | null {
  const gs = sim.gs
  const iss = gs.vessels.find((o) => o.id !== v.id && isStationVessel(o))
  if (isStationVessel(v)) return 'Bu araç zaten istasyona kenetli.'
  if (!iss) return 'İstasyon bulunamadı.'
  const earth = BODIES.earth
  if (v.bodyId !== 'earth' || v.landed) return 'Önce Dünya yörüngesine yerleş.'
  const el = elementsFromState(v.pos, v.vel, earth.mu)
  if (el.e >= 1 || el.rp < earth.radius + earth.atmoHeight) return 'Önce kararlı bir Dünya yörüngesine yerleş (enberi 30 km üstünde).'
  if (el.ra > earth.radius + 400_000) return 'İstasyona çok uzaksın: yörüngeni 400 km altına indir.'
  const rIss = Math.hypot(iss.pos.x, iss.pos.y)
  const h = hohmann(earth.mu, el.a, rIss, 0)
  const need = Math.abs(h.dv1) + Math.abs(h.dv2) + el.e * Math.sqrt(earth.mu / el.a) + 25
  const engines = activeEngines(v.parts)
  if (!engines.length) return 'Çalışabilir motor yok.'
  const groups = fuelGroups(v.parts)
  const gset = new Set(engines.map((i) => groups[i]))
  const tanks = v.parts.filter((p, j) => gset.has(groups[j]) && partDef(p.def).kind === 'tank')
  const fuel = tanks.reduce((a, t) => a + (t.fuel ?? 0), 0)
  const thrust = engines.reduce((a, i) => a + partDef(v.parts[i]!.def).thrust!, 0)
  const flow = engines.reduce((a, i) => a + partDef(v.parts[i]!.def).thrust! / partDef(v.parts[i]!.def).ispVac!, 0)
  const ve = (thrust / flow) * 9.80665
  const m0 = vesselStats(v.parts, v.cargo).mass
  const burn = m0 * (1 - Math.exp(-need / ve))
  if (burn > fuel) return `Buluşma için ≈ ${need.toFixed(0)} m/s gerekli; bu kademede yakıt yetmiyor.`
  for (const t of tanks) t.fuel = Math.max(0, (t.fuel ?? 0) - burn * ((t.fuel ?? 0) / fuel))
  // İstasyonun kapı tarafında, 22 m uzakta, aynı hızla dur.
  const fwd = { x: Math.cos(iss.angle), y: Math.sin(iss.angle) }
  v.pos = { x: iss.pos.x - fwd.x * 22, y: iss.pos.y - fwd.y * 22 }
  v.vel = { ...iss.vel }
  v.angle = iss.angle
  v.angVel = 0
  v.throttle = 0
  v.autopilot = 'off'
  v.autopilotNote = undefined
  v.dvUsed += need
  sim.warpIdx = 0
  return null
}

// ───────────────────────── easter egg'ler ─────────────────────────

const padDistance = (v: Vessel) => Math.abs(wrapPi(Math.atan2(v.pos.y, v.pos.x) - PAD_ANGLE)) * BODIES.earth.radius

/** Eski anıt selamı easter egg'i (anıt rampadan kaldırıldı): artık bir şey yapmaz. */
export function noteRcsPulse(_sim: Sim, _v: Vessel): GameEvent[] {
  return []
}

function onTouchdown(sim: Sim, v: Vessel, speed: number, events: GameEvent[]) {
  const gs = sim.gs
  if (gs.mp) return
  const st = vesselStats(v.parts)
  grant(gs, 'hamilton', 'Margaret Hamilton', 'İlk başarılı inişin! Apollo yazılımının mimarına selam.', events, 2000)
  const pct = st.fuelCap > 0 ? Math.round((st.fuel / st.fuelCap) * 100) : -1
  if (pct === 42) {
    const fresh = grant(gs, 'dont-panic', "Don't Panic", 'Tam %42 yakıtla indin. Gökyüzüne bak…', events, 4200)
    if (fresh) (sim.fx ??= []).push({ kind: 'whale', bodyId: v.bodyId, x: v.pos.x, y: v.pos.y, born: sim.clock ?? 0, size: 1 })
  }
  if (gs.teaMode && speed < 2) {
    gs.money += 5000
    if (!grant(gs, 'cay', 'Çaylar Şirketten', 'Çayı dökmeden indin: +5.000 ₡.', events)) events.push({ type: 'toast', text: 'Çaylar şirketten! Çay dökülmedi: +5.000 ₡' })
  }
}

function stepEggs(sim: Sim, active: Vessel | null, real: number, events: GameEvent[]) {
  const gs = sim.gs
  if (gs.mp) {
    setIspBoost(1)
    return
  }
  setIspBoost(gs.buffUntil && Date.now() < gs.buffUntil ? 1.15 : 1)
  // Su kulesi: roket motoru çalışırken rampada 30 sn boyunca 50 m'nin üstüne çıkamazsa kule
  // egzoza dayanamayıp kendisi fırlar. 50 m'yi aşınca, rampadan uzaklaşınca ya da motor 2 sn'den
  // uzun susunca sayaç sıfırlanır.
  if (!sim.towerGone && active && active.bodyId === 'earth' && padDistance(active) < 70) {
    const alt = Math.hypot(active.pos.x, active.pos.y) - BODIES.earth.radius
    const firing = active.throttle > 0 && (sim.firing.get(active.id)?.size ?? 0) > 0
    if (alt > 50) {
      sim.padLinger = 0
      sim.towerHeat = 0
    } else if (firing) {
      sim.padLinger = (sim.padLinger ?? 0) + real
      sim.towerHeat = 0
    } else {
      sim.towerHeat = (sim.towerHeat ?? 0) + real
      if (sim.towerHeat > 2) sim.padLinger = 0
    }
    if ((sim.padLinger ?? 0) >= 30) {
      sim.towerGone = true
      sim.padLinger = 0
      const r = BODIES.earth.radius
      ;(sim.fx ??= []).push({ kind: 'tower', bodyId: 'earth', x: Math.cos(PAD_ANGLE) * r, y: Math.sin(PAD_ANGLE) * r, born: sim.clock ?? 0, size: 1 })
      grant(gs, 'water-tower', 'Su Kulesi Fırlatıldı', 'Rampada 30 saniye oyalandın; su kulesi egzoza dayanamadı ve kendi yoluna gitti.', events, 1500)
    }
  } else {
    sim.padLinger = 0
    sim.towerHeat = 0
  }
}

/** Dünyayı dtReal gerçek saniye ilerletir. */
export function stepWorld(sim: Sim, dtReal: number, ctrl: Controls | Map<string, Controls>): GameEvent[] {
  const gs = sim.gs
  const events: GameEvent[] = []
  const isMp = Boolean(gs.mp)
  const active = activeVessel(gs)
  const ctrlMap = ctrl instanceof Map ? ctrl : null
  const singleCtrl: Controls = ctrl instanceof Map ? (ctrl.get(gs.ownerId ?? 'local') ?? { rotate: 0, tx: 0, ty: 0 }) : ctrl
  const real = Math.min(0.05, Math.max(0, dtReal))
  let transferTargets: Map<number, number | null> | null = null
  const autopilotWanted = isMp ? new Map<number, number>() : undefined
  const prevPos = isMp ? new Map(gs.vessels.map((v) => [v.id, { x: v.pos.x, y: v.pos.y }])) : null
  sim.clock = (sim.clock ?? 0) + real
  if ((gs.tick ?? 0) % 120 === 0) ensureStation(gs)
  stepEggs(sim, active, real, events)

  // İniş ayakları yüzeye yaklaşırken kendiliğinden açılır.
  if (isMp) {
    for (const v of gs.vessels) {
      if (!v.landed && BODIES[v.bodyId].landable && isAnyActivePlayerVessel(gs, v)) {
        const sit = situation(v)
        if (sit.alt < 400 && sit.vr < -0.5) for (const p of v.parts) if (partDef(p.def).kind === 'leg') p.deployed = true
      }
    }
  } else if (active && !active.landed && BODIES[active.bodyId].landable) {
    const sit = situation(active)
    if (sit.alt < 400 && sit.vr < -0.5) for (const p of active.parts) if (partDef(p.def).kind === 'leg') p.deployed = true
  }

  // Çok oyunculuda manuel tuş etkinliğini zaman yöneticisi için kaydet
  const effCtrlMap = isMp ? (ctrlMap ?? new Map<string, Controls>([[gs.ownerId ?? 'local', singleCtrl]])) : null
  if (gs.mp && effCtrlMap) {
    for (const p of Object.values(gs.mp.players)) {
      const pc = effCtrlMap.get(p.id)
      if (pc && (pc.rotate !== 0 || pc.tx !== 0 || pc.ty !== 0)) p.lastManualAt = sim.clock
    }
  }

  // Çok oyunculu: istemcinin kendi aracında anında döndürdüğü burun yönü ev sahibine gelir ve bir kez
  // uygulanır; böylece yüksek pingte bile gemi dönüşü gecikmeden hissedilir (konum ev sahibinde kalır).
  if (gs.mp && effCtrlMap) {
    for (const [pid, pc] of effCtrlMap) {
      if (pc.vid === undefined || pc.angle === undefined || pc.applied) continue
      pc.applied = true
      const v = gs.vessels.find((o) => o.id === pc.vid && o.ownerId === pid)
      if (v && !v.landed && !v.debris && !v.cruise && !v.station && vesselStats(v.parts).hasCommand && effectiveAutopilot(v) === 'off' && Number.isFinite(pc.angle)) {
        v.angle = wrapPi(pc.angle)
        v.angVel = Number.isFinite(pc.angVel) ? Math.max(-3, Math.min(3, pc.angVel!)) : 0
      }
    }
  }

  // Transfer otopilotu ve yakıt bitmiş kademe kontrolü (fizik/ray seçimi öncesi)
  for (const v of [...gs.vessels]) {
    const ap = effectiveAutopilot(v)
    const isOwnedActive = isMp ? isAnyActivePlayerVessel(gs, v) : v === active
    if (v.cruise) continue
    // Çok oyunculu arcade: uzaya çıkınca "hedefe git" hızlı yolculuğa dönüşür.
    if (isMp && ap === 'transfer') {
      if (tryStartCruise(sim, v, events)) continue
    }
    const cruiseWaitNote = isMp && ap === 'transfer' && v.autopilotNote?.includes('uzaya çıkış') ? v.autopilotNote : undefined
    if (ap === 'transfer') {
      const targetAngle = updateTransferAutopilot(sim, v, events, autopilotWanted)
      if (!transferTargets) transferTargets = new Map()
      transferTargets.set(v.id, targetAngle)
      if (cruiseWaitNote) v.autopilotNote = cruiseWaitNote
    }
    if (ap === 'orbit' || ap === 'transfer' || ap === 'land') {
      autoStageIfSpent(sim, v, events)
    }
    if ((ap === 'orbit' || ap === 'transfer') && v.landed) {
      v.throttle = 1
    }
    // Yörünge otopilotu: süzülürken raylarda zamanı, bir sonraki yanışa kalan süreye göre hızlandırır.
    if (ap === 'orbit' && isOwnedActive && !v.landed) {
      const wait = orbitCoastWait(v, BODIES[v.bodyId], situation(v))
      if (wait !== null && !needsPhysics(v, null)) {
        const w = chooseCoastWarpIdx(wait, 9)
        if (autopilotWanted) autopilotWanted.set(v.id, Math.max(autopilotWanted.get(v.id) ?? 0, w))
        else apHold.set(v, gs.time + wait)
      } else if (v.throttle > 0) {
        if (autopilotWanted) autopilotWanted.set(v.id, Math.min(autopilotWanted.get(v.id) ?? 2, 2))
        else apHold.delete(v)
      }
    }
    // Otopilot fizik adımındayken (alçak süzülme / yanış) de zamanı olabildiğince hızlı tutar.
    if (isMp && (ap === 'orbit' || ap === 'transfer') && isOwnedActive && !v.landed && needsPhysics(v, null)) {
      const b = BODIES[v.bodyId]
      const sit = situation(v)
      if (sit.altSea > b.atmoHeight + 500) {
        if (v.throttle > 0) {
          if (autopilotWanted) autopilotWanted.set(v.id, Math.max(Math.min(autopilotWanted.get(v.id) ?? 1, 2), 1))
          else sim.warpIdx = Math.min(Math.max(sim.warpIdx, 1), 2)
        } else {
          const el = elementsFromState(v.pos, v.vel, b.mu)
          const toAp = sit.vr > 0 && el.e < 1 ? (el.ra - sit.r) / Math.max(1, sit.vr) : 0
          const w = toAp > 60 ? 4 : toAp > 15 ? 2 : 0
          if (autopilotWanted) {
            if (w > 0) autopilotWanted.set(v.id, Math.max(autopilotWanted.get(v.id) ?? 0, w))
          } else {
            sim.warpIdx = Math.max(sim.warpIdx, toAp > 60 ? 4 : toAp > 15 ? 2 : sim.warpIdx)
          }
        }
      }
    }
  }

  if (gs.mp && effCtrlMap && autopilotWanted) {
    const dyn = computeDynamicWarp(
      gs,
      sim.warpIdx,
      sim.warpRampTimer ?? 0,
      real,
      sim.clock ?? 0,
      effCtrlMap,
      autopilotWanted,
    )
    sim.warpIdx = dyn.warpIdx
    sim.warpRampTimer = dyn.rampTimer
  } else if (!isMp && active) {
    // "Hedefe git" hedefte yörüngeye oturdu: kısa bir 1× molası ve ardından otomatik iniş.
    if (active.landAt && effectiveAutopilot(active) === 'off' && !active.landed) {
      const target = active.landAt
      active.landAt = undefined
      if (active.bodyId === target && !setVesselAutopilot(sim, active, 'land')) {
        active.landAt = undefined
        events.push({ type: 'toast', text: `${BODIES[target].name} yörüngesine oturuldu; otomatik iniş başlıyor.` })
      }
      sim.warpIdx = 0
      sim.warpHoldUntil = (sim.clock ?? 0) + 5
    }
    const ap = effectiveAutopilot(active)
    const prevAp = apLastMode.get(active)
    if (ap === 'off') {
      sim.apWarpPinned = undefined
      if (prevAp !== undefined) apLastMode.delete(active)
    } else if (prevAp !== ap) {
      apLastMode.set(active, ap)
    }
    if (ap === 'land') {
      sim.warpLockPrev = undefined
      const cap = landingWarpCap(active)
      if (prevAp !== 'land' && sim.warpIdx > cap.maxIdx) {
        sim.warpIdx = cap.maxIdx
        if (cap.maxIdx === 0) events.push({ type: 'toast', text: "Oto-İniş yaklaşımı: hız 1×'e düşürüldü." })
      } else if (!sim.apWarpPinned && sim.warpIdx < cap.autoIdx) {
        // Yüksekten inişte zaman kendiliğinden hızlanır; yere yaklaştıkça kademeli yavaşlar.
        sim.warpIdx = cap.autoIdx
      } else if (sim.warpIdx > cap.maxIdx) {
        sim.warpIdx = cap.maxIdx
        events.push({
          type: 'toast',
          text: cap.maxIdx === 0 ? "Oto-İniş yaklaşımı: hız 1×'e düşürüldü." : `Oto-İniş: hız en fazla ${WARPS[cap.maxIdx]}× ile sınırlandı.`,
        })
      }
    } else if (ap === 'orbit' || ap === 'transfer') {
      // Uzun süzülmelerde (transfer penceresi, Ay'a yolculuk) otopilot hızı kendiliğinden yükseltir;
      // oyuncu daha yüksek seçebilir, düşürürse seçimi korunur.
      const until = apHold.get(active)
      if (!sim.apWarpPinned && until !== undefined && apFree(gs, active) && !needsPhysics(active, singleCtrl)) {
        const want = chooseCoastWarpIdx(until - gs.time, 9)
        if (want > sim.warpIdx) sim.warpIdx = want
      } else if (!sim.apWarpPinned && apFree(gs, active) && sim.warpIdx < 3) {
        // Motorlu tırmanış/yanış evrelerinde de en az 10× (fizik alt adımları doğruluğu korur).
        sim.warpIdx = 3
      }
      // Otopilot: 500 m altında 1×, üstünde oyuncunun seçtiği hız (seçimi hatırlanır).
      if (!apFree(gs, active)) {
        if (sim.warpIdx > 0) {
          sim.warpLockPrev = sim.warpIdx
          sim.warpIdx = 0
        }
      } else if (sim.warpLockPrev !== undefined) {
        sim.warpIdx = sim.warpLockPrev
        sim.warpLockPrev = undefined
      }
    } else {
      sim.warpLockPrev = undefined
      if (prevAp && sim.warpIdx > 0) {
        sim.warpIdx = 0
        sim.warpHoldUntil = (sim.clock ?? 0) + 5
        events.push({ type: 'toast', text: "Otopilot tamamlandı: hız 5 sn boyunca 1×'te." })
      } else if (sim.warpIdx > 0) {
        const lb = BODIES[active.bodyId]
        const nearSurface = !active.landed && lb.landable && active.pos.x * active.pos.x + active.pos.y * active.pos.y < (lb.radius + 20_000) ** 2
        if (nearSurface) {
          const ls = situation(active)
          if (ls.vr < -8 && ls.alt < Math.max(1200, -15 * ls.vr)) {
            sim.warpIdx = 0
            events.push({ type: 'toast', text: "Yüzeye yakın: hız güvenli iniş için 1×'e düşürüldü." })
          }
        }
        if (sim.warpIdx > PHYSICS_WARP_MAX_IDX && needsPhysics(active, singleCtrl)) {
          sim.warpIdx = PHYSICS_WARP_MAX_IDX
          events.push({ type: 'toast', text: 'Zaman hızlandırma 25×\'e düştü (itki / atmosfer / yüzey).' })
        }
      }
    }
  } else if (active && sim.warpIdx > PHYSICS_WARP_MAX_IDX && needsPhysics(active, singleCtrl)) {
    sim.warpIdx = PHYSICS_WARP_MAX_IDX
    events.push({ type: 'toast', text: 'Zaman hızlandırma 25×\'e düştü (itki / atmosfer / yüzey).' })
  }
  if (!isMp && !(active && isAutopilotOn(active))) sim.warpLockPrev = undefined
  // Yörüngeye oturduktan sonraki 5 sn: hız 1×'te tutulur (yüksek hızda takılı kalıp zaman kaçmasın).
  if (!isMp && sim.warpHoldUntil !== undefined) {
    if ((sim.clock ?? 0) < sim.warpHoldUntil) {
      sim.warpIdx = 0
      sim.warpLockPrev = undefined
    } else sim.warpHoldUntil = undefined
  }
  const warp = WARPS[sim.warpIdx]!
  let simDt = real * warp
  const t0 = gs.time
  const activeFree = apFree(gs, active)
  if (activeFree && active) {
    if (needsPhysics(active, singleCtrl)) {
      // Yüksek hızda fizik: alt adım sayısı bütçeyi aşarsa bu karede daha az zaman ilerlet.
      const h = physStep(active, warp, true)
      simDt = Math.min(simDt, PHYS_STEP_BUDGET * h)
    } else {
      const until = apHold.get(active)
      if (until !== undefined) simDt = Math.min(simDt, Math.max(real, until - gs.time))
    }
  }

  // Aktif araç önce adımlanır: yüksek hızda kareyi erken bitirirse (simDt kısalır) diğerleri buna uyar.
  const chargedVessels = new Set<number>()
  const order = activeFree && active ? [active, ...gs.vessels.filter((o) => o !== active)] : [...gs.vessels]
  for (const v of order) {
    const isActive = isMp ? isAnyActivePlayerVessel(gs, v) : v === active
    const c = isMp
      ? (isActive && v.ownerId ? (effCtrlMap!.get(v.ownerId) ?? null) : null)
      : (isActive ? singleCtrl : null)
    if (v.cruise) {
      if (stepCruise(gs, sim.clock ?? 0, v) === 'arrived') {
        events.push({ type: 'toast', ownerId: v.ownerId, text: `Hedefe varıldı: ${BODIES[v.bodyId].name} — normal hıza dönüldü, inişi sen yap!` })
      }
      sim.firing.delete(v.id)
      continue
    }
    const apBefore = effectiveAutopilot(v)
    const extTarget = transferTargets?.get(v.id) ?? null
    if (v.debris) {
      v.debris.ttl -= real
      if (v.debris.ttl <= 0) {
        explodeDebris(sim, v, events)
        continue
      }
    }
    const needP = needsPhysics(v, c)
    if (!needP && v.landed) {
      sim.firing.delete(v.id)
      continue
    }
    const freeV = isActive && activeFree
    if (needP && (sim.warpIdx <= PHYSICS_WARP_MAX_IDX || freeV || isMp)) {
      const effSimDt = isMp && sim.warpIdx > PHYSICS_WARP_MAX_IDX ? Math.min(simDt, real * (WARPS[PHYSICS_WARP_MAX_IDX] ?? 10)) : simDt
      const effWarp = isMp && sim.warpIdx > PHYSICS_WARP_MAX_IDX ? (WARPS[PHYSICS_WARP_MAX_IDX] ?? 10) : warp
      const n = Math.min(4000, Math.max(1, Math.ceil(effSimDt / physStep(v, effWarp, freeV))))
      const h = effSimDt / n
      const manualScale = 1 / Math.max(1, effWarp)
      // Yüksek hızda transfer otopilotunun kararları kare başına değil, oyun zamanında sık sık yenilenir.
      const refreshEvery = freeV && apBefore === 'transfer' && n > 1 ? Math.max(1, Math.round(0.1 / h)) : 0
      let apTarget = extTarget
      let stCache = vesselStats(v.parts, v.cargo)
      for (let i = 0; i < n; i += 1) {
        if (refreshEvery && i > 0 && i % refreshEvery === 0) {
          if (effectiveAutopilot(v) !== 'transfer') break
          gs.time = t0 + i * h
          apTarget = updateTransferAutopilot(sim, v, events)
          autoStageIfSpent(sim, v, events)
          stCache = vesselStats(v.parts, v.cargo)
          if (!needsPhysics(v, c)) {
            // Süzülmeye geçildi: bu kareyi burada bitir, kalan zaman bir sonraki karede raylarda ilerler.
            simDt = i * h
            break
          }
        }
        chargeBatteries(v, stCache, t0 + i * h, h)
        const res = stepPhysics(v, h, c, manualScale, apTarget)
        sim.firing.set(v.id, res.firing)
        if (res.crash) {
          if (v.debris) explodeDebris(sim, v, events)
          else if (res.crashSpeed && BODIES[v.bodyId].landable) shatter(sim, v, res.crashSpeed, res.crash, events)
          else destroy(sim, v, res.crash, events)
          break
        }
        if (res.touchdown && v.debris) {
          explodeDebris(sim, v, events)
          break
        }
        if (res.touchdown) {
          if (!isMp && v.bodyId !== 'earth' && BODIES[v.bodyId].landable && !gs.bases[v.bodyId]) {
            gs.bases[v.bodyId] = emptyBase(Math.atan2(v.pos.y, v.pos.x), v.ownerId)
          }
          if (isActive) {
            events.push({ type: 'toast', ownerId: v.ownerId, text: `${BODIES[v.bodyId].name} yüzeyine iniş başarılı.` })
            if (!isMp) onTouchdown(sim, v, res.touchdownSpeed ?? 0, events)
          }
          break
        }
      }
      chargedVessels.add(v.id)
      gs.time = t0
      if (isActive && apBefore === 'orbit' && effectiveAutopilot(v) === 'off' && !v.landed) {
        events.push({ type: 'toast', ownerId: v.ownerId, text: `✓ ${BODIES[v.bodyId].name} yörüngesine yerleşildi!` })
      }
      if (gs.vessels.includes(v)) checkSoi(sim, v, t0 + simDt, events)
      continue
    }
    // Raylar üstünde (analitik Kepler) ilerleme, olayları ve küçük SOI'ları (Ceres/Merkür) kaçırmamak için parçalara bölünür.
    sim.firing.delete(v.id)
    const st = vesselStats(v.parts, v.cargo)
    const rotDt = Math.max(real, Math.min(4, simDt))
    rotateVessel(v, st, rotDt, c, extTarget, real / Math.max(rotDt, 1e-6))
    const minChildSoi = childrenOf(v.bodyId).reduce((m, ch) => Math.min(m, ch.soi), Infinity)
    let remaining = simDt
    let guard = 0
    while (remaining > 1e-9 && guard < 4000) {
      guard += 1
      const vLen = Math.max(len(v.vel), 1)
      const soiChunk = Number.isFinite(minChildSoi) ? (0.4 * minChildSoi) / vLen : Infinity
      const chunk = Math.min(remaining, Math.max(0.5, soiChunk), Math.max(0.5, (0.03 * len(v.pos)) / vLen))
      stepRails(v, chunk)
      remaining -= chunk
      const t = t0 + (simDt - remaining)
      if (checkSoi(sim, v, t, events) && isActive && !isMp && sim.warpIdx > 4 && !activeFree) sim.warpIdx = 4
      const body = BODIES[v.bodyId]
      const s = situation(v, st)
      if (s.r < body.radius || (body.landable && s.alt <= 0)) {
        destroy(sim, v, isActive ? 'yüzeye çarptı' : 'yörüngeden düştü', events)
        break
      }
      if (!isActive && !v.station && s.altSea < body.atmoHeight * 0.5) {
        destroy(sim, v, 'atmosferde yandı', events)
        break
      }
      if (!isMp && isActive && sim.warpIdx > PHYSICS_WARP_MAX_IDX && (s.altSea < body.atmoHeight || (body.landable && s.vr < 0 && s.alt < Math.max(4000, -20 * s.vr)))) {
        // Yaklaşma koruması: kalan süreyi at, fizik adımına geç (otopilotta seçilen hız korunur).
        if (activeFree) {
          simDt -= remaining
          remaining = 0
          break
        }
        sim.warpIdx = PHYSICS_WARP_MAX_IDX
        simDt -= remaining
        remaining = 0
        events.push({ type: 'toast', ownerId: v.ownerId, text: 'Yüzeye/atmosfere yaklaşıldı: zaman 25×.' })
      }
    }
  }

  gs.time = t0 + simDt
  gs.tick = (gs.tick ?? 0) + 1

  if (isMp && prevPos) {
    resolveVesselCollisions(gs, prevPos, sim.clock, sim.firing, (sim.fx ??= []), events)
  }

  for (const v of gs.vessels) {
    if (!chargedVessels.has(v.id)) chargeBatteries(v, vesselStats(v.parts, v.cargo), gs.time, simDt)
  }

  for (const v of [...gs.vessels]) {
    const isAct = isMp ? isAnyActivePlayerVessel(gs, v) : v === active
    const vc = isMp ? (isAct && v.ownerId ? (effCtrlMap!.get(v.ownerId) ?? null) : null) : (isAct ? singleCtrl : null)
    if (stepVesselWeapons(gs, v, real, vc, sim.clock, sim.firing, (sim.fx ??= []), events)) {
      sim.colonyDirty = true
    }
  }
  if (stepProjectiles(gs, Math.min(simDt, real * (WARPS[PHYSICS_WARP_MAX_IDX] ?? 10)), sim.clock, sim.firing, (sim.fx ??= []), events)) {
    sim.colonyDirty = true
  }
  if (stepCombatSystems(gs, real, sim.clock, sim.firing, (sim.fx ??= []), events)) {
    sim.colonyDirty = true
  }

  const actualWarp = real > 0 ? simDt / real : 1
  const incomeDt = effectiveIncomeDt(real, actualWarp)
  if (isMp) {
    stepPlanetCaptures(gs, real, events)
    stepMultiplayerIncome(gs, incomeDt)
  } else {
    for (const id of Object.keys(gs.bases) as BodyId[]) {
      const base = gs.bases[id]!
      const mult = baseIncomeMultiplier(gs, id)
      gs.money += tickBase(base, solarFlux(len(bodyAbsState(id, gs.time).r)), incomeDt, mult, id !== 'earth')
    }

    const cur = activeVessel(gs)
    if (cur && !isStationVessel(cur)) {
      for (const m of MISSIONS) {
        if (m.check && !gs.missionsDone.includes(m.id) && m.check(cur, gs)) completeMission(gs, m.id, events)
      }
    }
  }
  return events
}

// ───────────────────────── oyuncu eylemleri ─────────────────────────

export function designCost(design: PartInst[], cargo: Record<string, number>): number {
  let c = design.reduce((s, p) => s + partDef(p.def).cost, 0)
  for (const [id, n] of Object.entries(cargo)) c += (MODULE_BY_ID[id]?.cost ?? 0) * n
  return c
}

export function validateDesign(design: PartInst[], cargo: Record<string, number>, gs?: GameState): string | null {
  if (!design.length) return 'Önce grid\'e parça yerleştir.'
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = []
  for (const p of design) {
    const d = PART_BY_ID[p.def]
    if (!d) return `Bilinmeyen parça: ${p.def}`
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x + d.w > GRID_W || p.y + d.h > GRID_H) {
      return 'Parçalar montaj alanının sınırları içinde olmalıdır.'
    }
    for (const o of occupied) {
      if (p.x < o.x + o.w && p.x + d.w > o.x && p.y < o.y + o.h && p.y + d.h > o.y) {
        return 'Parçalar üst üste binemez.'
      }
    }
    occupied.push({ x: p.x, y: p.y, w: d.w, h: d.h })
  }
  if (gs) {
    for (const p of design) {
      if (gs.mp && !isWarfareMode(gs) && isCombatPart(p.def)) {
        return `"${partDef(p.def).name}" yalnızca Uzay Savaşı modunda veya Tek Oyunculuda kullanılır.`
      }
      if (!isPartUnlocked(gs, p.def)) {
        const tech = requiredTechForPart(p.def)
        return `"${partDef(p.def).name}" için teknoloji gerekli: ${tech?.name ?? 'Araştırma'}.`
      }
    }
    for (const [id, n] of Object.entries(cargo)) {
      if (n > 0 && !isWarfareMode(gs) && MODULE_BY_ID[id]?.warfare) {
        return `"${MODULE_BY_ID[id]?.name ?? id}" yalnızca Uzay Savaşı modunda kullanılır.`
      }
      if (n > 0 && !isModuleUnlocked(gs, id)) {
        const tech = requiredTechForModule(id)
        return `"${MODULE_BY_ID[id]?.name ?? id}" için teknoloji gerekli: ${tech?.name ?? 'Araştırma'}.`
      }
    }
  }
  const st = vesselStats(design)
  if (!st.hasCommand) return 'Bir komuta modülü (kapsül veya sonda çekirdeği) gerekli.'
  if (!isConnected(design)) return 'Tüm parçalar birbirine bağlı olmalı.'
  if (!design.some((p) => partDef(p.def).kind === 'engine')) return 'En az bir motor gerekli.'
  const cm = cargoMass({ modules: cargo, ore: 0, oreFrom: null })
  if (cm > st.cargoCap + 1e-9) return `Kargo ${cm} t, kapasite ${st.cargoCap} t. Kargo gövdesi ekle.`
  return null
}

function getActorBase(gs: GameState, bodyId: BodyId, actorId: string): Base | undefined {
  if (gs.mp) {
    const p = gs.mp.players[actorId]
    if (bodyId === 'earth') return p?.earthBase
    if (isWarfareMode(gs)) return p?.colonies?.[bodyId]
  }
  return gs.bases[bodyId]
}

function setActorBase(gs: GameState, bodyId: BodyId, actorId: string, base: Base) {
  if (gs.mp) {
    const p = gs.mp.players[actorId]
    if (bodyId === 'earth') {
      if (p) p.earthBase = base
      return
    }
    if (isWarfareMode(gs) && p) {
      ;(p.colonies ??= {})[bodyId] = base
      return
    }
  }
  gs.bases[bodyId] = base
}

/** Tasarımı satın alıp Dünya'daki rampaya koyar. Hata varsa mesaj döndürür. */
export function launchDesign(
  sim: Sim,
  ownerId = sim.gs.ownerId ?? 'local',
  customDesign?: PartInst[],
  customCargo?: Record<string, number>,
): string | null {
  const gs = sim.gs
  if (isWarfareMode(gs) && gs.mp?.players[ownerId]?.eliminated) {
    return 'Tüm kolonilerin yok edildi — bu maçta elendin.'
  }
  const design = customDesign ?? gs.design
  const designCargo = customCargo ?? gs.designCargo
  const err = validateDesign(design, designCargo, gs)
  if (err) return err
  const cost = designCost(design, designCargo)
  if (cost > getPlayerMoney(gs, ownerId)) return `Bütçe yetersiz: ${cost.toLocaleString('tr-TR')} ₡ gerekli.`
  const padTheta = playerPadAngle(gs, ownerId)
  const clearance = gs.mp ? 25 : 60
  const onPad = gs.vessels.find(
    (v) => v.bodyId === 'earth' && v.landed && Math.abs(wrapPi(Math.atan2(v.pos.y, v.pos.x) - padTheta)) * BODIES.earth.radius < clearance,
  )
  if (onPad) return 'Rampa dolu: önce rampadaki aracı kurtar veya sil.'
  const parts = freshParts(design)
  const st = vesselStats(parts)
  const r = BODIES.earth.radius + terrainHeight('earth', padTheta) + (st.maxY - st.comY)
  const id = gs.nextId
  gs.nextId += 1
  const ownerName = gs.mp?.players[ownerId]?.username
  const v: Vessel = {
    id,
    name: ownerName ? `${ownerName} #${id}` : `Selene ${id}`,
    ownerId,
    parts,
    bodyId: 'earth',
    pos: { x: Math.cos(padTheta) * r, y: Math.sin(padTheta) * r },
    vel: { x: 0, y: 0 },
    angle: padTheta,
    angVel: 0,
    landed: true,
    throttle: 0,
    ec: st.ecCap,
    cargo: { modules: { ...designCargo }, ore: 0, oreFrom: null },
    rcsOn: false,
    sas: 'off',
    autopilot: 'off',
    targetBody: gs.mp ? (gs.mp.players[ownerId]?.targetBody ?? 'moon') : undefined,
    approachWarn: null,
    visited: ['earth'],
    assist: null,
    dvUsed: 0,
    ...(st.shieldCap > 0 ? { shield: st.shieldCap } : {}),
    ...(isWarfareMode(gs) ? { spawnShieldUntil: (sim.clock ?? 0) + 5 } : {}),
  }
  addPlayerMoney(gs, -cost, ownerId)
  gs.vessels.push(v)
  setActiveVesselForPlayer(gs, ownerId, id)
  if (gs.mp) {
    const p = gs.mp.players[ownerId]
    if (p) p.lastManualAt = sim.clock ?? 0
  } else {
    sim.warpIdx = 0
  }
  return null
}

export function setActive(sim: Sim, id: number, actorId = sim.gs.ownerId ?? 'local') {
  const gs = sim.gs
  const v = gs.vessels.find((o) => o.id === id)
  if (!v || !canControlVessel(v, actorId)) return
  const prev = gs.mp ? getActiveVesselForPlayer(gs, actorId) : activeVessel(gs)
  if (prev && prev.id !== id) prev.throttle = 0
  setActiveVesselForPlayer(gs, actorId, id)
}

/** Kademe adaptör(ler)ini ateşler: araç bağımsız gövdelere ayrılır. */
export function decouple(sim: Sim, v: Vessel, indices: number[]): GameEvent[] {
  if (!indices.length) return []
  const gs = sim.gs
  const old = vesselStats(v.parts)
  const pieces = splitParts(v.parts, indices)
  if (!pieces.length) return []
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  const right = { x: fwd.y, y: -fwd.x }
  const wasLanded = v.landed
  pieces.forEach((parts, i) => {
    const st = vesselStats(parts)
    const lx = st.comX - old.comX
    const lf = -(st.comY - old.comY)
    const off = { x: right.x * lx + fwd.x * lf, y: right.y * lx + fwd.y * lf }
    const d = Math.hypot(lx, lf) || 1
    const push = i === 0 ? 0 : wasLanded ? 0 : 1.6
    const pos = { x: v.pos.x + off.x, y: v.pos.y + off.y }
    const vel = { x: v.vel.x + (off.x / d) * push, y: v.vel.y + (off.y / d) * push }
    if (i === 0) {
      v.parts = parts
      v.pos = pos
      v.landed = false
      v.noCollideUntil = gs.time + 3.0
      const cap = st.cargoCap
      if (cargoMass(v.cargo) > cap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
      v.ec = Math.min(v.ec, st.ecCap)
      if (v.shield !== undefined) v.shield = Math.min(v.shield, st.shieldCap)
    } else {
      const id = gs.nextId
      gs.nextId += 1
      const isIssPiece = parts.some((p) => p.def === 'iss-core') && !st.hasCommand
      gs.vessels.push({
        id, name: isIssPiece ? 'ISS' : st.hasCommand ? `${v.name}-B${id}` : `Kademe ${id}`, station: isIssPiece || undefined, ownerId: v.ownerId, parts, bodyId: v.bodyId, pos, vel,
        angle: v.angle, angVel: v.angVel + (lx > 0 ? -0.15 : lx < 0 ? 0.15 : 0), landed: false, throttle: 0, ec: st.hasCommand ? Math.min(st.ecCap, v.ec * 0.25) : 0,
        cargo: { modules: {}, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off', visited: [...v.visited], assist: null, dvUsed: 0,
        noCollideUntil: gs.time + 3.0,
      })
    }
  })
  sim.firing.delete(v.id)
  return [{ type: 'toast', ownerId: v.ownerId, text: 'Kademe ayrıldı.' }]
}

export const stageNext = (sim: Sim, v: Vessel) => decouple(sim, v, nextStage(v.parts))

/** Dünya'ya inmiş aracı kurtarır: parçaların %80'i iade, maden satılır. */
export function recoverVessel(sim: Sim, v: Vessel): GameEvent[] {
  const gs = sim.gs
  const events: GameEvent[] = []
  if (v.bodyId !== 'earth' || !v.landed) return [{ type: 'toast', ownerId: v.ownerId, text: 'Kurtarma yalnızca Dünya yüzeyinde yapılır.' }]
  if (isStationVessel(v)) return [{ type: 'toast', ownerId: v.ownerId, text: 'İstasyon kurtarılamaz.' }]
  const st = vesselStats(v.parts)
  let refund = st.cost * 0.8
  for (const [id, n] of Object.entries(v.cargo.modules)) refund += (MODULE_BY_ID[id]?.cost ?? 0) * n
  let oreIncome = 0
  if (v.cargo.ore > 0 && v.cargo.oreFrom) {
    oreIncome = v.cargo.ore * BODIES[v.cargo.oreFrom].orePrice * orePriceMultiplier(gs)
    if (!gs.mp) completeMission(gs, 'ore-return', events)
  }
  if (!gs.mp && v.visited.includes('moon') && st.hasCommand) completeMission(gs, 'earth-return', events)
  addPlayerMoney(gs, refund + oreIncome, v.ownerId)
  gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
  sim.firing.delete(v.id)
  if (gs.activeId === v.id) gs.activeId = null
  if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]?.activeVesselId === v.id) {
    gs.mp.players[v.ownerId]!.activeVesselId = null
  }
  events.push({ type: 'toast', ownerId: v.ownerId, text: `Araç kurtarıldı: +${Math.round(refund).toLocaleString('tr-TR')} ₡ parça iadesi${oreIncome ? `, +${Math.round(oreIncome).toLocaleString('tr-TR')} ₡ maden satışı` : ''}.` })
  return events
}

export { getActorBase }

/** İnen aracın kargosundaki yapıları koloniye kurar; boş yuva yoksa koloni deposuna koyar. */
export function deployModules(sim: Sim, v: Vessel, onlyId?: string): string | null {
  if (!v.landed || v.bodyId === 'earth' || !BODIES[v.bodyId].landable) {
    return 'Yapıları indirmek için Dünya dışı bir gezegen veya uydu yüzeyine inmelisin.'
  }
  const warfare = isWarfareMode(sim.gs)
  const actorId = v.ownerId ?? sim.gs.ownerId ?? 'local'
  if (warfare && sim.gs.mp?.players[actorId]?.eliminated) {
    return 'Tüm kolonilerin yok edildi — artık inşa yapılamaz.'
  }
  if (sim.gs.mp && !warfare) {
    const cap = sim.gs.mp.captures[v.bodyId]
    if (cap?.ownerId && cap.ownerId !== v.ownerId) return 'Bu gezegen başka bir oyuncunun kolonisi.'
  }
  const total = Object.entries(v.cargo.modules).reduce((s, [id, n]) => s + (id === 'iss-supplies' || (onlyId && id !== onlyId) ? 0 : n), 0)
  if (!total) return 'Kargoda indirilecek yapı yok.'
  let base = getActorBase(sim.gs, v.bodyId, actorId)
  if (base?.destroyed) return 'İmha edilmiş üsse yeni yapı kurulamaz.'
  if (!base) {
    base = emptyBase(Math.atan2(v.pos.y, v.pos.x), actorId)
    setActorBase(sim.gs, v.bodyId, actorId, base)
  }
  if (v.ownerId && !sim.gs.mp?.captures[v.bodyId]?.ownerId) base.ownerId = v.ownerId
  ensureSites(base)
  if (warfare) ensureSiteHp(base)
  const stock = (base.stock ??= {})
  // Önce elektrik üreticileri (güneş paneli / reaktör) kurulur, ardından Uzay İstasyonu ve diğer yapılar.
  const ordered = Object.entries(v.cargo.modules).filter(([id]) => !onlyId || id === onlyId).sort(([a], [b]) => (MODULE_BY_ID[b]?.power ?? 0) - (MODULE_BY_ID[a]?.power ?? 0))
  for (const [id, n] of ordered) {
    if (!MODULE_BY_ID[id] || id === 'iss-supplies') continue
    // Kargoyla taşınan yapılar önceden üretildiği için boş yuva varsa doğrudan kurulur.
    for (let i = 0; i < n; i += 1) {
      const free = base.sites!.indexOf(null)
      if (free >= 0) {
        base.sites![free] = id
        if (warfare) {
          ensureSiteHp(base)[free] = MODULE_BY_ID[id]?.hp ?? 200
          if (id === 'colony-shield') base.shield = (base.shield ?? 0) + COLONY_SHIELD_PER_GEN
        }
        syncModules(base)
      } else stock[id] = (stock[id] ?? 0) + 1
    }
  }
  sim.colonyDirty = true
  if (onlyId) {
    delete v.cargo.modules[onlyId]
    return null
  }
  const keep = v.cargo.modules['iss-supplies']
  v.cargo.modules = keep ? { 'iss-supplies': keep } : {}
  return null
}

/** Koloni deposundaki (kurulmamış) bir yapıyı yeniden gemiye yükler: başka bir koloniye taşımak için. */
export function pickupModule(sim: Sim, v: Vessel, moduleId: string): string | null {
  const m = MODULE_BY_ID[moduleId]
  if (!m) return 'Bilinmeyen yapı.'
  const actorId = v.ownerId ?? sim.gs.ownerId ?? 'local'
  if (sim.gs.mp && !isWarfareMode(sim.gs) && v.bodyId !== 'earth') {
    const cap = sim.gs.mp.captures[v.bodyId]
    if (cap?.ownerId && cap.ownerId !== actorId) return 'Bu gezegen başka bir oyuncunun kolonisi.'
  }
  const base = getActorBase(sim.gs, v.bodyId, actorId)
  if (!v.landed || !base) return 'Yük almak için koloninin olduğu yüzeye inmelisin.'
  if (base.destroyed) return 'İmha edilmiş üsten yapı alınamaz.'
  if (!(base.stock?.[moduleId] ?? 0)) return 'Depoda bu yapı yok.'
  const free = vesselStats(v.parts).cargoCap - cargoMass(v.cargo)
  if (free + 1e-9 < m.mass) return `Kargoda yer yok (${m.mass} t gerekli).`
  base.stock![moduleId]! -= 1
  v.cargo.modules[moduleId] = (v.cargo.modules[moduleId] ?? 0) + 1
  return null
}

/** Dünya'da aynı yapıdan çoğaldıkça fiyat artar. */
export function earthModuleCost(gs: GameState, moduleId: string, actorId = gs.ownerId ?? 'local'): number {
  const m = MODULE_BY_ID[moduleId]
  if (!m) return 0
  const owned = getActorBase(gs, 'earth', actorId)?.modules[moduleId] ?? 0
  return Math.round(m.cost * (1 + 0.55 * owned))
}

export function modulePrice(gs: GameState, bodyId: BodyId, moduleId: string, actorId = gs.ownerId ?? 'local'): number {
  if ((getActorBase(gs, bodyId, actorId)?.stock?.[moduleId] ?? 0) > 0) return 0
  return bodyId === 'earth' ? earthModuleCost(gs, moduleId, actorId) : (MODULE_BY_ID[moduleId]?.cost ?? 0)
}

function canEditPlanetBase(gs: GameState, bodyId: BodyId, actorId = gs.ownerId ?? 'local'): string | null {
  if (!BODIES[bodyId]?.landable) return 'Bu gök cisminde koloni kurulamaz.'
  if (isWarfareMode(gs) && gs.mp?.players[actorId]?.eliminated) {
    return 'Tüm kolonilerin yok edildi — artık inşa yapılamaz.'
  }
  const existing = getActorBase(gs, bodyId, actorId)
  if (existing?.destroyed) return 'İmha edilmiş üsse yeni yapı kurulamaz.'
  if (bodyId === 'earth') {
    return null
  }
  if (gs.mp) {
    if (isWarfareMode(gs)) {
      if (existing) return null
      const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId && v.ownerId === actorId)
      if (!landed) return 'Önce bu yüzeye bir araç indirmelisin.'
      return null
    }
    const cap = gs.mp.captures[bodyId]
    if (cap?.ownerId === actorId) return null
    if (cap?.ownerId && cap.ownerId !== actorId) return 'Bu gezegen başka bir oyuncunun kolonisi.'
    const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId && v.ownerId === actorId)
    if (!landed) return 'Önce bu gezegene inip yüzey kontrolünü almalısın.'
    return null
  }
  if (existing) return null
  const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId)
  if (!landed) return 'Önce bu yüzeye bir araç indirmelisin.'
  return null
}

/** Seçilen yuvaya yapı kurar. Depoda varsa ücretsiz, yoksa aktif Uzay İstasyonu gerekir. */
export function placePlanetModule(sim: Sim, bodyId: BodyId, slot: number, moduleId: string, ownerId = sim.gs.ownerId ?? 'local'): string | null {
  const gs = sim.gs
  const m = MODULE_BY_ID[moduleId]
  if (!m) return 'Bilinmeyen yapı.'
  const warfare = isWarfareMode(gs)
  const earthAllowed = warfare ? WARFARE_EARTH_MODULES : EARTH_MODULES
  if (bodyId === 'earth' && !earthAllowed.includes(moduleId)) return 'Bu yapı yalnızca uzay kolonilerinde (Ay, Mars…) kurulur.'
  if (m.warfare && !warfare) return 'Savunma yapıları yalnızca Uzay Savaşı modunda kurulur.'
  const gate = canEditPlanetBase(gs, bodyId, ownerId)
  if (gate) return gate
  const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId && (!gs.mp || v.ownerId === ownerId))
  const siteAngle = bodyId === 'earth' ? playerPadAngle(gs, ownerId) : Math.atan2(landed?.pos.y ?? 0, landed?.pos.x ?? 1)
  let base = getActorBase(gs, bodyId, ownerId)
  if (!base) {
    base = emptyBase(siteAngle, ownerId)
    setActorBase(gs, bodyId, ownerId, base)
  } else if (gs.mp && bodyId !== 'earth' && !gs.mp.captures[bodyId]?.ownerId) {
    base.ownerId = ownerId
  }
  const sites = ensureSites(base)
  if (slot < 0 || slot >= sites.length || sites[slot]) return 'Boş bir yuva seç.'
  const inStock = (base.stock?.[moduleId] ?? 0) > 0
  // Uzay kolonilerinde yalnızca Dünya'dan kargo bölmesinde getirilen yapılar kurulur.
  if (bodyId !== 'earth' && !inStock) return "Bu yapı kargoda yok: Dünya'da roketin kargo bölmesine ekleyip buraya getir."
  const price = bodyId === 'earth' ? modulePrice(gs, bodyId, moduleId, ownerId) : 0
  if (getPlayerMoney(gs, ownerId) < price) return `${price.toLocaleString('tr-TR')} ₡ gerekli.`
  if (bodyId !== 'earth' && base.stock?.[moduleId]) base.stock[moduleId]! -= 1
  addPlayerMoney(gs, -price, ownerId)
  sites[slot] = moduleId
  if (warfare) {
    ensureSiteHp(base)[slot] = m.hp
    if (moduleId === 'colony-shield') base.shield = (base.shield ?? 0) + COLONY_SHIELD_PER_GEN
  }
  syncModules(base)
  sim.colonyDirty = true
  return null
}

/** Yuvadaki yapıyı söker (%60 iade). */
export function removePlanetModule(sim: Sim, bodyId: BodyId, slot: number, ownerId = sim.gs.ownerId ?? 'local'): { error?: string; refund?: number } {
  const gs = sim.gs
  const warfare = isWarfareMode(gs)
  if (gs.mp && bodyId !== 'earth' && !warfare) {
    const cap = gs.mp.captures[bodyId]
    if (cap?.ownerId && cap.ownerId !== ownerId) return { error: 'Bu gezegen başka bir oyuncunun kolonisi.' }
    if (!cap?.ownerId) {
      if (cap?.phase === 'contested') return { error: 'Yüzeyde başka bir oyuncu da var.' }
      const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId && v.ownerId === ownerId)
      if (!landed) return { error: 'Sökmek için yüzeye inmelisin.' }
    }
  }
  const base = getActorBase(gs, bodyId, ownerId)
  if (!base) return { error: 'Bu gezegende koloni yok.' }
  const sites = ensureSites(base)
  const id = sites[slot]
  if (!id) return { error: 'Sökülecek yapı yok.' }
  // Dünya'da %60 para iadesi; uzay kolonisinde yapı depoya geri döner (başka yuvaya kurulabilir).
  let refund = 0
  if (bodyId === 'earth') {
    refund = Math.round((MODULE_BY_ID[id]?.cost ?? 0) * 0.6)
    addPlayerMoney(gs, refund, ownerId)
  } else {
    base.stock = { ...(base.stock ?? {}), [id]: (base.stock?.[id] ?? 0) + 1 }
  }
  sites[slot] = null
  if (base.siteHp) base.siteHp[slot] = null
  syncModules(base)
  if (warfare && base.shield !== undefined) {
    const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
    const sCap = colonyShieldCap(base, flux)
    if (base.shield > sCap) base.shield = sCap
  }
  sim.colonyDirty = true
  if (gs.mp && !warfare && bodyId !== 'earth' && id === COLONY_STATION_ID && gs.mp.captures[bodyId]?.ownerId === ownerId) {
    const cap = gs.mp.captures[bodyId]!
    cap.ownerId = null
    cap.phase = 'idle'
    cap.progress = 0
    cap.capturerId = null
  }
  return { refund }
}

/** İlk boş yuvaya yapı kurar. */
export function buyBaseModule(sim: Sim, bodyId: BodyId, moduleId: string, ownerId = sim.gs.ownerId ?? 'local'): string | null {
  const base = getActorBase(sim.gs, bodyId, ownerId)
  const slot = base ? ensureSites(base).indexOf(null) : 0
  if (slot < 0) return 'Kolonide boş yuva kalmadı.'
  return placePlanetModule(sim, bodyId, slot, moduleId, ownerId)
}

export const buyEarthModule = (sim: Sim, moduleId: string): string | null => buyBaseModule(sim, 'earth', moduleId)

export function loadOre(sim: Sim, v: Vessel): string | null {
  const actorId = v.ownerId ?? sim.gs.ownerId ?? 'local'
  const base = getActorBase(sim.gs, v.bodyId, actorId)
  if (!v.landed || !base) return 'Maden yüklemek için üssün olduğu yüzeye inmelisin.'
  if (sim.gs.mp && !isWarfareMode(sim.gs) && v.bodyId !== 'earth') {
    const capOwner = sim.gs.mp.captures[v.bodyId]?.ownerId
    if (capOwner && capOwner !== v.ownerId) return 'Bu koloni başka bir oyuncuya ait.'
  }
  const free = vesselStats(v.parts).cargoCap - cargoMass(v.cargo)
  const amount = Math.min(free, base.ore)
  if (amount < 0.01) return free < 0.01 ? 'Kargo gövdesinde yer yok.' : 'Üste henüz maden birikmedi.'
  base.ore -= amount
  v.cargo.ore += amount
  v.cargo.oreFrom = v.bodyId
  return null
}

/** ISRU: 1 t maden → 4 t yakıt. */
export function refuelAtBase(sim: Sim, v: Vessel): string | null {
  const actorId = v.ownerId ?? sim.gs.ownerId ?? 'local'
  const base = getActorBase(sim.gs, v.bodyId, actorId)
  if (!v.landed || !base) return 'Yakıt ikmali için üssün olduğu yüzeye inmelisin.'
  if (sim.gs.mp && !isWarfareMode(sim.gs) && v.bodyId !== 'earth') {
    const capOwner = sim.gs.mp.captures[v.bodyId]?.ownerId
    if (capOwner && capOwner !== v.ownerId) return 'Bu koloni başka bir oyuncuya ait.'
  }
  if (!(base.modules.isru ?? 0)) return 'Üste ISRU Yakıt Tesisi yok.'
  const tanks = v.parts.filter((p) => partDef(p.def).kind === 'tank')
  const need = tanks.reduce((s, p) => s + (partDef(p.def).fuel! - (p.fuel ?? 0)), 0)
  const give = Math.min(need, base.ore * 4)
  if (give < 0.01) return need < 0.01 ? 'Tanklar zaten dolu.' : 'Yakıt üretmek için maden yok.'
  base.ore -= give / 4
  let left = give
  for (const p of tanks) {
    const room = partDef(p.def).fuel! - (p.fuel ?? 0)
    const add = Math.min(room, left)
    p.fuel = (p.fuel ?? 0) + add
    left -= add
  }
  return null
}

/** Uçuşta tıklanan parçaya göre eylem. */
export function clickPart(sim: Sim, v: Vessel, index: number): GameEvent[] {
  const p = v.parts[index]
  if (!p) return []
  const d = partDef(p.def)
  switch (d.kind) {
    case 'decoupler':
    case 'radialDecoupler':
      return decouple(sim, v, [index])
    case 'solar':
    case 'leg':
    case 'chute':
      if (d.kind === 'leg' && p.deployProgress === undefined) p.deployProgress = p.deployed ? 1 : 0
      p.deployed = !p.deployed
      return [{ type: 'toast', ownerId: v.ownerId, text: `${d.name}: ${p.deployed ? 'açıldı' : 'kapandı'}` }]
    case 'engine':
      p.on = p.on === false
      return [{ type: 'toast', ownerId: v.ownerId, text: `${d.name}: ${p.on ? 'açık' : 'kapalı'}` }]
    default:
      return []
  }
}

export function toggleKind(v: Vessel, kind: 'solar' | 'leg' | 'chute') {
  const items = v.parts.filter((p) => partDef(p.def).kind === kind)
  const open = !items.every((p) => p.deployed)
  for (const p of items) {
    if (kind === 'leg' && p.deployProgress === undefined) p.deployProgress = p.deployed ? 1 : 0
    p.deployed = open
  }
  return items.length ? open : null
}

/** Aracı kalıcı olarak siler (boşta kalan kademeler ve terk edilmiş gemiler için). */
export function deleteVessel(sim: Sim, id: number, actorId = sim.gs.ownerId ?? 'local'): boolean {
  const gs = sim.gs
  const target = gs.vessels.find((v) => v.id === id)
  if (!target || target.station) return false
  if (gs.mp && !canControlVessel(target, actorId)) return false
  const before = gs.vessels.length
  gs.vessels = gs.vessels.filter((v) => v.id !== id)
  sim.firing.delete(id)
  if (gs.mp) {
    for (const p of Object.values(gs.mp.players)) {
      if (p.activeVesselId === id) {
        const next = gs.vessels.find((v) => v.ownerId === p.id && vesselStats(v.parts).hasCommand)
        setActiveVesselForPlayer(gs, p.id, next?.id ?? null)
      }
    }
  } else if (gs.activeId === id) {
    gs.activeId = gs.vessels.find((v) => vesselStats(v.parts).hasCommand)?.id ?? null
  }
  return gs.vessels.length < before
}

export const DOCK_RANGE_M = 30
export const DOCK_SPEED_MPS = 3

/** Kenetlenmeye uygun en yakın araç: aynı gök cisminde, 30 m içinde, 3 m/s altında bağıl hız. */
export function dockCandidate(gs: GameState, v: Vessel): Vessel | null {
  if (v.landed) return null
  let best: Vessel | null = null
  let bestD = DOCK_RANGE_M
  for (const o of gs.vessels) {
    if (o.id === v.id || o.bodyId !== v.bodyId || o.landed) continue
    if (gs.mp && !o.station && o.ownerId && v.ownerId && o.ownerId !== v.ownerId) continue
    const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y)
    const dv = Math.hypot(o.vel.x - v.vel.x, o.vel.y - v.vel.y)
    if (d < bestD && dv < DOCK_SPEED_MPS) {
      best = o
      bestD = d
    }
  }
  return best
}

/**
 * Yörüngede kenetlenme: diğer araç, aktif aracın burnuna bir dikey adaptörle bağlanır.
 * Yakıt ve kargo birleşir; adaptöre tıklayınca araçlar yeniden ayrılır.
 */
export function dockVessels(sim: Sim, v: Vessel, other: Vessel): GameEvent[] {
  const gs = sim.gs
  if (v.id === other.id || v.bodyId !== other.bodyId || v.landed || other.landed || v.debris || other.debris || v.cruise || other.cruise) {
    return [{ type: 'toast', ownerId: v.ownerId, text: 'Bu iki araç şu an kenetlenemez.' }]
  }
  if (gs.mp && !other.station && other.ownerId && v.ownerId && other.ownerId !== v.ownerId) {
    return [{ type: 'toast', ownerId: v.ownerId, text: 'Başka bir oyuncunun gemisine kenetlenemezsin.' }]
  }
  const center = (p: PartInst) => p.x + partDef(p.def).w / 2
  const top = v.parts.reduce((a, p) => (p.y < a.y ? p : a))
  const bottom = other.parts.reduce((a, p) => (p.y + partDef(p.def).h > a.y + partDef(a.def).h ? p : a))
  const decX = Math.round(center(top) - 1)
  const decY = top.y - 1
  const dx = Math.round(decX + 1 - center(bottom))
  const dy = decY - (bottom.y + partDef(bottom.def).h)
  const m1 = vesselStats(v.parts, v.cargo).mass
  const m2 = vesselStats(other.parts, other.cargo).mass
  let parts: PartInst[] = [
    ...v.parts,
    { def: 'decoupler', x: decX, y: decY },
    ...other.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  ]
  const minX = Math.min(...parts.map((p) => p.x))
  const minY = Math.min(...parts.map((p) => p.y))
  parts = parts.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY }))
  if (!isConnected(parts)) return [{ type: 'toast', ownerId: v.ownerId, text: 'Kenetlenme başarısız: gövdeler hizalanamadı.' }]
  const k = m2 / (m1 + m2)
  v.pos = { x: v.pos.x + (other.pos.x - v.pos.x) * k, y: v.pos.y + (other.pos.y - v.pos.y) * k }
  v.vel = { x: v.vel.x + (other.vel.x - v.vel.x) * k, y: v.vel.y + (other.vel.y - v.vel.y) * k }
  v.parts = parts
  const combinedSt = vesselStats(v.parts, v.cargo)
  v.ec = Math.min(combinedSt.ecCap, v.ec + other.ec)
  if (combinedSt.shieldCap > 0) {
    v.shield = Math.min(combinedSt.shieldCap, (v.shield ?? 0) + (other.shield ?? 0))
  }
  for (const [id, n] of Object.entries(other.cargo.modules)) v.cargo.modules[id] = (v.cargo.modules[id] ?? 0) + n
  if (other.cargo.ore > 0) {
    v.cargo.ore += other.cargo.ore
    v.cargo.oreFrom = v.cargo.oreFrom ?? other.cargo.oreFrom
  }
  for (const b of other.visited) if (!v.visited.includes(b)) v.visited.push(b)
  v.throttle = 0
  v.angVel = 0
  v.autopilot = 'off'
  v.autoLand = false
  v.autopilotNote = undefined
  gs.vessels = gs.vessels.filter((o) => o.id !== other.id)
  if (gs.mp) {
    for (const p of Object.values(gs.mp.players)) {
      if (p.activeVesselId === other.id) p.activeVesselId = v.id
    }
  }
  sim.firing.delete(other.id)
  sim.firing.delete(v.id)
  const events: GameEvent[] = [{ type: 'toast', ownerId: v.ownerId, text: `Kenetlenildi: ${other.name}. Ayırmak için aradaki adaptöre tıkla.` }]
  if (isStationVessel(other)) {
    if (!gs.mp) completeMission(gs, 'iss-dock', events)
    const n = v.cargo.modules['iss-supplies'] ?? 0
    if (n > 0) {
      delete v.cargo.modules['iss-supplies']
      addPlayerMoney(gs, n * ISS_SUPPLY_REWARD, v.ownerId)
      gs.issDeliveries = (gs.issDeliveries ?? 0) + n
      events.push({ type: 'toast', ownerId: v.ownerId, text: `ISS'e ${n} ikmal kargosu teslim edildi: +${(n * ISS_SUPPLY_REWARD).toLocaleString('tr-TR')} ₡` })
      if (!gs.mp) completeMission(gs, 'iss-cargo', events)
    }
  }
  return events
}

// ───────────────────────── Çok oyunculu hazırlığı: yetki & komut dağıtıcısı ─────────────────────────

export function canControlVessel(v: Vessel, actorId = 'local'): boolean {
  if (!v.ownerId || v.ownerId === 'local' || actorId === 'local') return true
  return v.ownerId === actorId
}

export function setVesselAutopilot(sim: Sim, v: Vessel, mode: AutopilotMode): string | null {
  if (v.cruise) return 'Hızlı yolculuk sırasında otopilot değiştirilemez.'
  if (mode === 'land' && !hasAutoLandTech(sim.gs)) {
    return 'Otomatik İniş için Teknoloji Ağacından "Gelişmiş İniş" araştırmasını açmalısın.'
  }
  if ((mode === 'land' || mode === 'orbit') && v.bodyId === 'sun') {
    return 'Güneş çevresinde bu otopilot çalışmaz; önce bir gezegene hedef al.'
  }
  if (mode === 'land' && !BODIES[v.bodyId].landable) {
    return 'Bu gök cismine iniş yapılamaz.'
  }
  if (mode === 'transfer') {
    const targetId = vesselTargetBody(sim.gs, v)
    if (v.bodyId === targetId) {
      return v.landed
        ? `Zaten ${BODIES[targetId].name} üzerindesin; başka bir hedef seç ya da "🛰️ Yörünge" kullan.`
        : `Zaten ${BODIES[targetId].name} etki alanındasın. "🛰️ Yörünge" veya manuel kontrol kullan.`
    }
  }
  v.autopilot = mode
  v.autoLand = mode === 'land'
  v.landAt = undefined
  v.approachWarn = null
  if (mode === 'land' && !sim.gs.mp) {
    const cap = landingWarpCap(v)
    const baseIdx = sim.warpIdx <= PHYSICS_WARP_MAX_IDX ? sim.warpIdx : 0
    sim.warpIdx = Math.min(cap.maxIdx, Math.max(baseIdx, cap.autoIdx))
  }
  if ((mode === 'orbit' || mode === 'transfer') && v.landed) {
    v.throttle = 1
  }
  if (mode === 'off') {
    v.throttle = 0
    v.autopilotNote = undefined
    if (sim.gs.mp && v.ownerId && sim.gs.mp.players[v.ownerId]) {
      sim.gs.mp.players[v.ownerId]!.lastManualAt = sim.clock ?? 0
    }
  }
  return null
}

/**
 * Serileştirilebilir oyun komutunu doğrular ve uygular (ev sahibi & istemci tek giriş noktası).
 */
export function dispatchCommand(
  sim: Sim,
  cmd: GameCommand,
  actorId = sim.gs.ownerId ?? 'local',
): { events: GameEvent[]; error?: string } {
  const gs = sim.gs
  const events: GameEvent[] = []
  const getVessel = (id: number) => gs.vessels.find((v) => v.id === id)

  switch (cmd.type) {
    case 'launch': {
      const err = launchDesign(sim, actorId, cmd.design, cmd.designCargo)
      return err ? { events, error: err } : { events }
    }
    case 'setTarget': {
      if (!BODIES[cmd.bodyId] || cmd.bodyId === 'sun') {
        return { events, error: 'Geçersiz hedef gök cismi.' }
      }
      if (gs.mp) {
        const p = gs.mp.players[actorId]
        if (p) p.targetBody = cmd.bodyId
        const av = getActiveVesselForPlayer(gs, actorId)
        if (av) av.targetBody = cmd.bodyId
        if (actorId === gs.ownerId) gs.targetBody = cmd.bodyId
      } else {
        gs.targetBody = cmd.bodyId
      }
      return { events }
    }
    case 'buyModule': {
      const err = buyBaseModule(sim, cmd.bodyId, cmd.moduleId, actorId)
      return err ? { events, error: err } : { events }
    }
    case 'placeGridModule': {
      const err = placePlanetModule(sim, cmd.bodyId, cmd.x, cmd.moduleId, actorId)
      return err ? { events, error: err } : { events }
    }
    case 'removeGridModule': {
      const res = removePlanetModule(sim, cmd.bodyId, cmd.x, actorId)
      if (res.error) return { events, error: res.error }
      if (res.refund) events.push({ type: 'toast', ownerId: actorId, text: `Yapı söküldü: +${res.refund.toLocaleString('tr-TR')} ₡ iade.` })
      return { events }
    }
    case 'setActive': {
      setActive(sim, cmd.vesselId, actorId)
      return { events }
    }
    case 'setWarpPref': {
      if (gs.mp) {
        const p = gs.mp.players[actorId]
        if (p) {
          p.wantsWarpIdx = cmd.warpIdx
          if (cmd.anchor !== undefined) p.warpAnchor = cmd.anchor
        }
      }
      return { events }
    }
    default: {
      const v = 'vesselId' in cmd ? getVessel(cmd.vesselId) : undefined
      if (!v) return { events, error: 'Araç bulunamadı.' }
      if (!canControlVessel(v, actorId)) return { events, error: 'Bu araç başka bir oyuncuya ait.' }
      switch (cmd.type) {
        case 'stage':
          events.push(...stageNext(sim, v))
          if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]) gs.mp.players[v.ownerId]!.lastManualAt = sim.clock ?? 0
          return { events }
        case 'dock': {
          const other = getVessel(cmd.targetId)
          if (!other) return { events, error: 'Kenetlenecek araç yok.' }
          events.push(...dockVessels(sim, v, other))
          return { events }
        }
        case 'deleteVessel': {
          if (!deleteVessel(sim, v.id, actorId)) return { events, error: 'İstasyon silinemez.' }
          return { events }
        }
        case 'recoverVessel':
          events.push(...recoverVessel(sim, v))
          return { events }
        case 'setAutopilot': {
          const err = setVesselAutopilot(sim, v, cmd.mode)
          return err ? { events, error: err } : { events }
        }
        case 'setSas':
          v.sas = cmd.sas
          return { events }
        case 'toggleRcs':
          v.rcsOn = !v.rcsOn
          if (!gs.mp) events.push(...noteRcsPulse(sim, v))
          return { events }
        case 'rendezvous': {
          const err = rendezvousStation(sim, v)
          return err
            ? { events, error: err }
            : { events: [{ type: 'toast', ownerId: v.ownerId, text: 'Buluşma tamamlandı: ISS 22 m önünde. Kenetlen düğmesine bas.' }] }
        }
        case 'repairVessel': {
          if (!v.landed) return { events, error: 'Onarım için yüzeye inmelisin.' }
          const b = getActorBase(gs, v.bodyId, actorId)
          if (!b || b.destroyed) return { events, error: `${BODIES[v.bodyId].name} üzerinde çalışan dost üs yok.` }
          const hasBay = v.bodyId === 'earth' || (b.modules['repair-bay'] ?? 0) > 0 || (b.modules[COLONY_STATION_ID] ?? 0) > 0
          if (!hasBay) return { events, error: 'Gezegende Onarım Hangarı veya Uzay İstasyonu gerekir.' }
          const damagedCount = v.parts.filter((p) => (p.hp ?? partMaxHp(p.def)) < partMaxHp(p.def)).length
          const vst = vesselStats(v.parts, v.cargo)
          const shieldNeedsRepair = vst.shieldCap > 0 && (v.shield ?? vst.shieldCap) < vst.shieldCap - 0.1
          if (!damagedCount && !v.burnUntil && !v.empUntil && !shieldNeedsRepair) {
            return { events, error: 'Roket zaten tam hasarsız.' }
          }
          for (const p of v.parts) p.hp = partMaxHp(p.def)
          v.burnUntil = undefined
          v.empUntil = undefined
          if (vst.shieldCap > 0) v.shield = vst.shieldCap
          events.push({ type: 'toast', ownerId: v.ownerId, text: `🔧 ${v.name} tamir edildi (${damagedCount} parça onarıldı)!` })
          return { events }
        }
        case 'togglePartKind': {
          const o = toggleKind(v, cmd.kind)
          if (o !== null) {
            const label =
              cmd.kind === 'solar' ? 'Güneş panelleri' : cmd.kind === 'leg' ? 'İniş ayakları' : 'Paraşütler'
            events.push({ type: 'toast', ownerId: v.ownerId, text: `${label} ${o ? 'açıldı' : 'kapandı'}.` })
          }
          return { events }
        }
        case 'pickupModule': {
          const err = pickupModule(sim, v, cmd.moduleId)
          return err ? { events, error: err } : { events }
        }
        case 'deployModules': {
          const err = deployModules(sim, v, cmd.moduleId)
          if (err) return { events, error: err }
          const flux = solarFlux(len(bodyAbsState(v.bodyId, gs.time).r))
          const st = colonyStationStatus(getActorBase(gs, v.bodyId, actorId), flux)
          const text =
            st === 'active'
              ? `${BODIES[v.bodyId].name} kolonileştirildi! Uzay İstasyonu çalışıyor.`
              : st === 'unpowered'
                ? 'Kargolar indirildi! Uzay İstasyonu için 7 ⚡ elektrik sağla.'
                : 'Kargodaki yapılar koloniye indirildi.'
          events.push({ type: 'toast', ownerId: v.ownerId, text })
          return { events }
        }
        case 'loadOre': {
          const err = loadOre(sim, v)
          return err ? { events, error: err } : { events }
        }
        case 'refuelAtBase': {
          const err = refuelAtBase(sim, v)
          return err ? { events, error: err } : { events }
        }
        case 'setThrottle': {
          const thr = Number.isFinite(cmd.throttle) ? Math.max(0, Math.min(1, cmd.throttle)) : 0
          if (Math.abs(v.throttle - thr) > 0.01 && effectiveAutopilot(v) !== 'off') {
            v.autopilot = 'off'
            v.autoLand = false
            v.autopilotNote = undefined
          }
          v.throttle = thr
          if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]) gs.mp.players[v.ownerId]!.lastManualAt = sim.clock ?? 0
          return { events }
        }
        case 'emergencyStop':
          v.autopilot = 'off'
          v.autoLand = false
          v.autopilotNote = undefined
          v.throttle = 0
          if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]) gs.mp.players[v.ownerId]!.lastManualAt = sim.clock ?? 0
          return { events }
        case 'clickPart':
          events.push(...clickPart(sim, v, cmd.index))
          return { events }
      }
    }
  }
}
