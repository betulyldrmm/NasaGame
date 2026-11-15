/**
 * Açık dünya simülasyonu: tüm araçlar, zaman hızlandırma, etki alanı (SOI) geçişleri,
 * otopilotlar (yörünge & hedef transferi), gezegen gridi ve komut dağıtıcısı. React'ten bağımsızdır.
 */
import { baseReport, colonyTier, emptyBase, ensureSites, ISS_SUPPLY_REWARD, MODULE_BY_ID, STARTER_EARTH_SITES, syncModules, tickBase, TIER_HINT, EARTH_MODULES } from '../game/base'
import { DEFAULT_DESIGN, INITIAL_MONEY, ISS_ALTITUDE_M, ISS_DESIGN, partDef } from '../game/data'
import { MISSION_BY_ID, MISSIONS } from '../game/missions'
import { baseIncomeMultiplier, hasAutoLandTech, INITIAL_TECH, isModuleUnlocked, isPartUnlocked, orePriceMultiplier, requiredTechForModule, requiredTechForPart } from '../game/tech'
import type { AutopilotMode, Base, GameCommand, GameEvent, GameState, PartInst, Vessel } from '../game/types'
import { activeEngines, cargoMass, components, freshParts, fuelGroups, isConnected, nextStage, setIspBoost, splitParts, vesselStats } from '../game/vessel'
import { BODIES, childrenOf, solarFlux, type BodyId } from '../nasa/bodies'
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
  kind: 'boom' | 'whale' | 'tower'
  bodyId: BodyId
  x: number
  y: number
  born: number
  size: number
}

export interface Sim {
  gs: GameState
  warpIdx: number
  warpRampTimer?: number
  /** araç id → (parça indeksi → motor gücü) ; yalnızca çizim için */
  firing: Map<number, Map<number, number>>
  /** görsel efektler (patlama, balina, su kulesi…); kayda girmez */
  fx?: Fx[]
  /** efekt saati (gerçek saniye) */
  clock?: number
  towerHeat?: number
  towerGone?: boolean
  /** Rampada 50 m altında geçen süre (su kulesi easter egg'i). */
  padLinger?: number
  /** Otopilot 500 m altında 1×'e kilitlediğinde oyuncunun seçtiği hız. */
  warpLockPrev?: number
  rcsPulses?: number[]
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

/** Tek oyunculu otopilot: raylarda en fazla bu oyun zamanına kadar güvenle süzülünür (bir sonraki yanış). */
const apHold = new WeakMap<Vessel, number>()
function isAutopilotOn(v: Vessel): boolean {
  const ap = effectiveAutopilot(v)
  return ap === 'orbit' || ap === 'transfer' || ap === 'land'
}
/** Otopilot alçakta değilse oyuncu istediği hızı seçebilir. */
export const AP_LOCK_ALT = 500
function apFree(gs: GameState, v: Vessel | null): boolean {
  if (!v || gs.mp || v.id !== gs.activeId || v.landed) return false
  const ap = effectiveAutopilot(v)
  if (ap !== 'orbit' && ap !== 'transfer' && ap !== 'land') return false
  return situation(v).alt >= AP_LOCK_ALT
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
    if (!burningNow && (waitSec > lead || el.ra >= rTarget * 0.94)) {
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
      if (s.altSea >= body.atmoHeight) hold((body.soi - s.r) / Math.max(1, s.vr))
      v.autopilotNote = `${body.name} çekiminden çıkılıyor…`
      return proAngle
    }
    const parentBody = BODIES[body.parentId]
    const relV = bodyRelState(body, gs.time).v
    const targetPlanet = target.parentId === 'sun' ? target : target.parentId ? BODIES[target.parentId] : null
    const goInward = targetId === body.parentId || (targetPlanet?.orbit && parentBody.orbit && targetPlanet.orbit.a < parentBody.orbit.a)
    const ejectDir = Math.atan2(relV.y, relV.x) + (goInward ? Math.PI : 0)
    const r2 = targetId === body.parentId ? parentBody.radius + safeOrbitAlt(parentBody) : body.soi * 1.15
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
    const planet = target.parentId === 'sun' ? target : BODIES[target.parentId!]
    if (!planet.orbit || !body.orbit) return null
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
      if (s.altSea >= body.atmoHeight) hold((body.soi - s.r) / Math.max(1, s.vr))
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
  events.push({ type: 'toast', text: `✓ ${b.name} hedefine ulaşıldı. Otopilot yörüngeye giriyor; inmek için Oto-İniş'e bas.` })
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
        events.push({ type: 'toast', text: `Yerçekimi sapanı: ${body.name} sayesinde ${gain > 0 ? '+' : ''}${gain.toFixed(0)} m/s` })
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
  gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
  sim.firing.delete(v.id)
  if (wasActive) gs.activeId = null
  if (gs.mp && v.ownerId) {
    const owner = gs.mp.players[v.ownerId]
    if (owner && owner.activeVesselId === v.id) owner.activeVesselId = null
  }
  boom(sim, v.bodyId, v.pos.x, v.pos.y, 9, events)
  events.push({ type: 'crash', name: v.name, wasActive, reason })
}

function boom(sim: Sim, bodyId: BodyId, x: number, y: number, size: number, events: GameEvent[]) {
  const fx = (sim.fx ??= [])
  fx.push({ kind: 'boom', bodyId, x, y, born: sim.clock ?? 0, size })
  if (fx.length > 60) fx.splice(0, fx.length - 60)
  events.push({ type: 'explosion', size })
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
  const st = vesselStats(v.parts)
  const severity = speed / Math.max(1, landingTolerance(st))
  const total = v.parts.length
  const breakCount = severity >= 2.6 ? total : Math.max(1, Math.min(total - 1, Math.round(total * 0.3 * (severity - 0.6))))
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
  v.ec = Math.min(v.ec, st2.ecCap)
  if (cargoMass(v.cargo) > st2.cargoCap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
  events.push({ type: 'toast', text: 'Sert iniş! Araç hasar aldı ama komuta modülü kurtuldu.' })
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

/** RCS üç kez yakılırsa (anıtın yanında, yerde) geçici yakıt verimi bonusu. */
export function noteRcsPulse(sim: Sim, v: Vessel): GameEvent[] {
  const events: GameEvent[] = []
  if (v.bodyId !== 'earth' || !v.landed || padDistance(v) > 150) return events
  const now = Date.now()
  const pulses = (sim.rcsPulses = [...(sim.rcsPulses ?? []).filter((t) => now - t < 4000), now])
  if (pulses.length >= 3) {
    sim.rcsPulses = []
    sim.gs.buffUntil = now + 180_000
    if (!grant(sim.gs, 'istikbal', 'İstikbal Göklerdedir', 'Anıtı selamladın: 3 dakika boyunca %15 yakıt verimi.', events)) {
      events.push({ type: 'toast', text: 'Anıt selamlandı: 3 dakika boyunca %15 yakıt verimi.' })
    }
  }
  return events
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

  // Transfer otopilotu ve yakıt bitmiş kademe kontrolü (fizik/ray seçimi öncesi)
  for (const v of [...gs.vessels]) {
    const ap = effectiveAutopilot(v)
    const isOwnedActive = isMp ? isAnyActivePlayerVessel(gs, v) : v === active
    if (ap === 'transfer') {
      const targetAngle = updateTransferAutopilot(sim, v, events, autopilotWanted)
      if (!transferTargets) transferTargets = new Map()
      transferTargets.set(v.id, targetAngle)
    }
    if (ap === 'orbit' || ap === 'transfer') {
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
      sim.clock,
      effCtrlMap,
      autopilotWanted,
    )
    sim.warpIdx = dyn.warpIdx
    sim.warpRampTimer = dyn.rampTimer
  } else if (!isMp && active && isAutopilotOn(active)) {
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
  } else if (active && sim.warpIdx > PHYSICS_WARP_MAX_IDX && needsPhysics(active, singleCtrl)) {
    sim.warpIdx = PHYSICS_WARP_MAX_IDX
    events.push({ type: 'toast', text: 'Zaman hızlandırma 25×\'e düştü (itki / atmosfer / yüzey).' })
  }
  if (!isMp && !(active && isAutopilotOn(active))) sim.warpLockPrev = undefined
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
  const order = activeFree && active ? [active, ...gs.vessels.filter((o) => o !== active)] : [...gs.vessels]
  for (const v of order) {
    const isActive = isMp ? isAnyActivePlayerVessel(gs, v) : v === active
    const c = isMp
      ? (isActive && v.ownerId ? (effCtrlMap!.get(v.ownerId) ?? null) : null)
      : (isActive ? singleCtrl : null)
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
    if (needP && (sim.warpIdx <= PHYSICS_WARP_MAX_IDX || freeV)) {
      const n = Math.min(4000, Math.max(1, Math.ceil(simDt / physStep(v, warp, freeV))))
      const h = simDt / n
      const manualScale = 1 / Math.max(1, warp)
      // Yüksek hızda transfer otopilotunun kararları kare başına değil, oyun zamanında sık sık yenilenir.
      const refreshEvery = freeV && apBefore === 'transfer' && n > 1 ? Math.max(1, Math.round(0.1 / h)) : 0
      let apTarget = extTarget
      for (let i = 0; i < n; i += 1) {
        if (refreshEvery && i > 0 && i % refreshEvery === 0) {
          if (effectiveAutopilot(v) !== 'transfer') break
          gs.time = t0 + i * h
          apTarget = updateTransferAutopilot(sim, v, events)
          autoStageIfSpent(sim, v, events)
          if (!needsPhysics(v, c)) {
            // Süzülmeye geçildi: bu kareyi burada bitir, kalan zaman bir sonraki karede raylarda ilerler.
            simDt = i * h
            break
          }
        }
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
            events.push({ type: 'toast', text: `${BODIES[v.bodyId].name} yüzeyine iniş başarılı.` })
            if (!isMp) onTouchdown(sim, v, res.touchdownSpeed ?? 0, events)
          }
          break
        }
      }
      if (isActive && apBefore === 'orbit' && effectiveAutopilot(v) === 'off' && !v.landed) {
        events.push({ type: 'toast', text: `✓ ${BODIES[v.bodyId].name} yörüngesine yerleşildi!` })
      }
      if (gs.vessels.includes(v)) checkSoi(sim, v, t0 + simDt, events)
      continue
    }
    // Raylar üstünde (analitik Kepler) ilerleme, olayları kaçırmamak için parçalara bölünür.
    sim.firing.delete(v.id)
    const st = vesselStats(v.parts, v.cargo)
    const rotDt = Math.max(real, Math.min(4, simDt))
    rotateVessel(v, st, rotDt, c, extTarget, real / Math.max(rotDt, 1e-6))
    let remaining = simDt
    let guard = 0
    while (remaining > 1e-9 && guard < 4000) {
      guard += 1
      const chunk = Math.min(remaining, Math.max(0.5, (0.03 * len(v.pos)) / Math.max(len(v.vel), 1)))
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
        events.push({ type: 'toast', text: 'Yüzeye/atmosfere yaklaşıldı: zaman 25×.' })
      }
    }
  }

  gs.time = t0 + simDt
  gs.tick = (gs.tick ?? 0) + 1

  if (isMp && prevPos) {
    resolveVesselCollisions(gs, prevPos, sim.clock, sim.firing, (sim.fx ??= []), events)
  }

  for (const v of gs.vessels) chargeBatteries(v, vesselStats(v.parts, v.cargo), gs.time, simDt)

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
  if (gs) {
    for (const p of design) {
      if (!isPartUnlocked(gs, p.def)) {
        const tech = requiredTechForPart(p.def)
        return `"${partDef(p.def).name}" için teknoloji gerekli: ${tech?.name ?? 'Araştırma'}.`
      }
    }
    for (const [id, n] of Object.entries(cargo)) {
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
  if (gs.mp && bodyId === 'earth') return gs.mp.players[actorId]?.earthBase
  return gs.bases[bodyId]
}

function setActorBase(gs: GameState, bodyId: BodyId, actorId: string, base: Base) {
  if (gs.mp && bodyId === 'earth') {
    const p = gs.mp.players[actorId]
    if (p) p.earthBase = base
    return
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
      v.noCollideUntil = gs.time + 1.2
      const cap = st.cargoCap
      if (cargoMass(v.cargo) > cap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
      v.ec = Math.min(v.ec, st.ecCap)
    } else {
      const id = gs.nextId
      gs.nextId += 1
      gs.vessels.push({
        id, name: parts.some((p) => p.def === 'iss-core') ? 'ISS' : st.hasCommand ? `${v.name}-B${id}` : `Kademe ${id}`, station: parts.some((p) => p.def === 'iss-core') || undefined, ownerId: v.ownerId, parts, bodyId: v.bodyId, pos, vel,
        angle: v.angle, angVel: v.angVel + (lx > 0 ? -0.15 : lx < 0 ? 0.15 : 0), landed: false, throttle: 0, ec: 0,
        cargo: { modules: {}, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off', visited: [...v.visited], assist: null, dvUsed: 0,
        noCollideUntil: gs.time + 1.2,
      })
    }
  })
  sim.firing.delete(v.id)
  return [{ type: 'toast', text: 'Kademe ayrıldı.' }]
}

export const stageNext = (sim: Sim, v: Vessel) => decouple(sim, v, nextStage(v.parts))

/** Dünya'ya inmiş aracı kurtarır: parçaların %80'i iade, maden satılır. */
export function recoverVessel(sim: Sim, v: Vessel): GameEvent[] {
  const gs = sim.gs
  const events: GameEvent[] = []
  if (v.bodyId !== 'earth' || !v.landed) return [{ type: 'toast', text: 'Kurtarma yalnızca Dünya yüzeyinde yapılır.' }]
  if (isStationVessel(v)) return [{ type: 'toast', text: 'İstasyon kurtarılamaz.' }]
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
  events.push({ type: 'toast', text: `Araç kurtarıldı: +${Math.round(refund).toLocaleString('tr-TR')} ₡ parça iadesi${oreIncome ? `, +${Math.round(oreIncome).toLocaleString('tr-TR')} ₡ maden satışı` : ''}.` })
  return events
}

/** İnen aracın kargosundaki yapıları koloni deposuna indirir; oradan yuvalara kurulur. */
export function deployModules(sim: Sim, v: Vessel): string | null {
  if (!v.landed || v.bodyId === 'earth' || !BODIES[v.bodyId].landable) {
    return 'Yapıları indirmek için Dünya dışı bir gezegen veya uydu yüzeyine inmelisin.'
  }
  if (sim.gs.mp) {
    const capOwner = sim.gs.mp.captures[v.bodyId]?.ownerId
    if (capOwner && capOwner !== v.ownerId) return 'Bu gezegen rakip kontrolünde: önce bayrağı ele geçir.'
  }
  const total = Object.values(v.cargo.modules).reduce((s, n) => s + n, 0)
  if (!total) return 'Kargoda indirilecek yapı yok.'
  const base = (sim.gs.bases[v.bodyId] ??= emptyBase(Math.atan2(v.pos.y, v.pos.x), v.ownerId))
  ensureSites(base)
  const stock = (base.stock ??= {})
  for (const [id, n] of Object.entries(v.cargo.modules)) {
    if (!MODULE_BY_ID[id] || id === 'iss-supplies') continue
    // Boş yuva varsa ve kademe uygunsa doğrudan kur, kalanı depoya koy.
    for (let i = 0; i < n; i += 1) {
      const free = base.sites!.indexOf(null)
      if (free >= 0 && MODULE_BY_ID[id]!.tier <= colonyTier(base)) {
        base.sites![free] = id
        syncModules(base)
      } else stock[id] = (stock[id] ?? 0) + 1
    }
  }
  const keep = v.cargo.modules['iss-supplies']
  v.cargo.modules = keep ? { 'iss-supplies': keep } : {}
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
  if (bodyId === 'earth') return null
  if (gs.mp) {
    const capOwner = gs.mp.captures[bodyId]?.ownerId
    if (capOwner === actorId) return null
    if (capOwner && capOwner !== actorId) return 'Bu gezegen rakip kontrolünde: önce bayrağı ele geçir.'
    const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId && v.ownerId === actorId)
    if (!landed) return 'Önce bu gezegene inip bayrağı ele geçirmelisin.'
    return null
  }
  if (gs.bases[bodyId]) return null
  const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId)
  if (!landed) return 'Önce bu yüzeye bir araç indirmelisin.'
  return null
}

/** Seçilen yuvaya yapı kurar. Depoda varsa ücretsiz, yoksa bütçeden ödenir. */
export function placePlanetModule(sim: Sim, bodyId: BodyId, slot: number, moduleId: string, ownerId = sim.gs.ownerId ?? 'local'): string | null {
  const gs = sim.gs
  const m = MODULE_BY_ID[moduleId]
  if (!m) return 'Bilinmeyen yapı.'
  if (bodyId === 'earth' && !EARTH_MODULES.includes(moduleId)) return 'Bu yapı yalnızca uzay kolonilerinde (Ay, Mars…) kurulur.'
  const gate = canEditPlanetBase(gs, bodyId, ownerId)
  if (gate) return gate
  const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId && (!gs.mp || v.ownerId === ownerId))
  const siteAngle = bodyId === 'earth' ? PAD_ANGLE : Math.atan2(landed?.pos.y ?? 0, landed?.pos.x ?? 1)
  let base = getActorBase(gs, bodyId, ownerId)
  if (!base) {
    base = emptyBase(siteAngle, ownerId)
    setActorBase(gs, bodyId, ownerId, base)
  }
  const sites = ensureSites(base)
  if (bodyId !== 'earth' && m.tier > colonyTier(base)) return TIER_HINT[m.tier] ?? 'Bu yapı henüz açılmadı.'
  if (slot < 0 || slot >= sites.length || sites[slot]) return 'Boş bir yuva seç.'
  const price = modulePrice(gs, bodyId, moduleId, ownerId)
  if (getPlayerMoney(gs, ownerId) < price) return `${price.toLocaleString('tr-TR')} ₡ gerekli.`
  if (price === 0 && base.stock?.[moduleId]) base.stock[moduleId]! -= 1
  addPlayerMoney(gs, -price, ownerId)
  sites[slot] = moduleId
  syncModules(base)
  return null
}

/** Yuvadaki yapıyı söker (%60 iade). */
export function removePlanetModule(sim: Sim, bodyId: BodyId, slot: number, ownerId = sim.gs.ownerId ?? 'local'): { error?: string; refund?: number } {
  const gs = sim.gs
  if (gs.mp && bodyId !== 'earth') {
    const capOwner = gs.mp.captures[bodyId]?.ownerId
    if (capOwner && capOwner !== ownerId) return { error: 'Bu gezegen rakip kontrolünde.' }
  }
  const base = getActorBase(gs, bodyId, ownerId)
  if (!base) return { error: 'Bu gezegende koloni yok.' }
  const sites = ensureSites(base)
  const id = sites[slot]
  if (!id) return { error: 'Sökülecek yapı yok.' }
  const refund = Math.round((MODULE_BY_ID[id]?.cost ?? 0) * 0.6)
  addPlayerMoney(gs, refund, ownerId)
  sites[slot] = null
  syncModules(base)
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
  const base = sim.gs.bases[v.bodyId]
  if (!v.landed || !base) return 'Maden yüklemek için üssün olduğu yüzeye inmelisin.'
  if (sim.gs.mp && v.bodyId !== 'earth') {
    const capOwner = sim.gs.mp.captures[v.bodyId]?.ownerId
    if (capOwner && capOwner !== v.ownerId) return 'Bu koloni rakip kontrolünde!'
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
  const base = sim.gs.bases[v.bodyId]
  if (!v.landed || !base) return 'Yakıt ikmali için üssün olduğu yüzeye inmelisin.'
  if (sim.gs.mp && v.bodyId !== 'earth') {
    const capOwner = sim.gs.mp.captures[v.bodyId]?.ownerId
    if (capOwner && capOwner !== v.ownerId) return 'Bu koloni rakip kontrolünde!'
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
      return [{ type: 'toast', text: `${d.name}: ${p.deployed ? 'açıldı' : 'kapandı'}` }]
    case 'engine':
      p.on = p.on === false
      return [{ type: 'toast', text: `${d.name}: ${p.on ? 'açık' : 'kapalı'}` }]
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
  if (gs.mp && !other.station && other.ownerId && v.ownerId && other.ownerId !== v.ownerId) {
    return [{ type: 'toast', text: 'Rakip oyuncunun gemisine kenetlenemezsin!' }]
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
  if (!isConnected(parts)) return [{ type: 'toast', text: 'Kenetlenme başarısız: gövdeler hizalanamadı.' }]
  const k = m2 / (m1 + m2)
  v.pos = { x: v.pos.x + (other.pos.x - v.pos.x) * k, y: v.pos.y + (other.pos.y - v.pos.y) * k }
  v.vel = { x: v.vel.x + (other.vel.x - v.vel.x) * k, y: v.vel.y + (other.vel.y - v.vel.y) * k }
  v.parts = parts
  v.ec += other.ec
  for (const [id, n] of Object.entries(other.cargo.modules)) v.cargo.modules[id] = (v.cargo.modules[id] ?? 0) + n
  if (other.cargo.ore > 0) {
    v.cargo.ore += other.cargo.ore
    v.cargo.oreFrom = v.cargo.oreFrom ?? other.cargo.oreFrom
  }
  for (const b of other.visited) if (!v.visited.includes(b)) v.visited.push(b)
  v.throttle = 0
  v.angVel = 0
  gs.vessels = gs.vessels.filter((o) => o.id !== other.id)
  if (gs.mp) {
    for (const p of Object.values(gs.mp.players)) {
      if (p.activeVesselId === other.id) p.activeVesselId = v.id
    }
  }
  sim.firing.delete(other.id)
  sim.firing.delete(v.id)
  const events: GameEvent[] = [{ type: 'toast', text: `Kenetlenildi: ${other.name}. Ayırmak için aradaki adaptöre tıkla.` }]
  if (isStationVessel(other)) {
    if (!gs.mp) completeMission(gs, 'iss-dock', events)
    const n = v.cargo.modules['iss-supplies'] ?? 0
    if (n > 0) {
      delete v.cargo.modules['iss-supplies']
      addPlayerMoney(gs, n * ISS_SUPPLY_REWARD, v.ownerId)
      gs.issDeliveries = (gs.issDeliveries ?? 0) + n
      events.push({ type: 'toast', text: `ISS'e ${n} ikmal kargosu teslim edildi: +${(n * ISS_SUPPLY_REWARD).toLocaleString('tr-TR')} ₡` })
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
  if (mode === 'land' && !hasAutoLandTech(sim.gs)) {
    return 'Otomatik İniş için Teknoloji Ağacından "Gelişmiş İniş" araştırmasını açmalısın.'
  }
  if ((mode === 'land' || mode === 'orbit') && v.bodyId === 'sun') {
    return 'Güneş çevresinde bu otopilot çalışmaz; önce bir gezegene hedef al.'
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
  v.approachWarn = null
  if ((mode === 'orbit' || mode === 'transfer') && v.landed) {
    v.throttle = 1
  }
  if (mode === 'off') {
    v.autopilotNote = undefined
    if (sim.gs.mp && v.ownerId && sim.gs.mp.players[v.ownerId]) {
      sim.gs.mp.players[v.ownerId]!.lastManualAt = sim.clock ?? 0
    }
  }
  return null
}

/**
 * Serileştirilebilir oyun komutunu doğrular ve uygular (gelecekteki çok oyunculu sunucu/istemci
 * mimarisine hazır tek giriş noktası).
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
      if (res.refund) events.push({ type: 'toast', text: `Yapı söküldü: +${res.refund.toLocaleString('tr-TR')} ₡ iade.` })
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
        case 'deleteVessel':
          deleteVessel(sim, v.id, actorId)
          return { events }
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
          return err ? { events, error: err } : { events: [{ type: 'toast', text: 'Buluşma tamamlandı: ISS 22 m önünde. Kenetlen düğmesine bas.' }] }
        }
        case 'togglePartKind': {
          const o = toggleKind(v, cmd.kind)
          if (o !== null) events.push({ type: 'toast', text: `${cmd.kind}: ${o ? 'açık' : 'kapalı'}` })
          return { events }
        }
        case 'deployModules': {
          const err = deployModules(sim, v)
          return err ? { events, error: err } : { events }
        }
        case 'loadOre': {
          const err = loadOre(sim, v)
          return err ? { events, error: err } : { events }
        }
        case 'refuelAtBase': {
          const err = refuelAtBase(sim, v)
          return err ? { events, error: err } : { events }
        }
        case 'setThrottle':
          v.throttle = Math.max(0, Math.min(1, cmd.throttle))
          if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]) gs.mp.players[v.ownerId]!.lastManualAt = sim.clock ?? 0
          return { events }
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
