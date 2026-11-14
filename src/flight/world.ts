/**
 * Açık dünya simülasyonu: tüm araçlar, zaman hızlandırma, etki alanı (SOI) geçişleri,
 * otopilotlar (yörünge & hedef transferi), gezegen gridi ve komut dağıtıcısı. React'ten bağımsızdır.
 */
import { baseReport, colonyTier, emptyBase, ensureSites, MODULE_BY_ID, STARTER_EARTH_SITES, syncModules, tickBase, TIER_HINT } from '../game/base'
import { DEFAULT_DESIGN, INITIAL_MONEY, partDef } from '../game/data'
import { MISSION_BY_ID, MISSIONS } from '../game/missions'
import { baseIncomeMultiplier, hasAutoLandTech, INITIAL_TECH, isModuleUnlocked, isPartUnlocked, orePriceMultiplier, requiredTechForModule, requiredTechForPart } from '../game/tech'
import type { AutopilotMode, GameCommand, GameEvent, GameState, PartInst, Vessel } from '../game/types'
import { activeEngines, cargoMass, freshParts, isConnected, nextStage, splitParts, vesselStats } from '../game/vessel'
import { BODIES, childrenOf, solarFlux, type BodyId } from '../nasa/bodies'
import { bodyAbsState, bodyRelState, elementsFromState, hohmann, len, wrapPi } from './orbit'
import {
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

export const WARPS = [1, 2, 4, 10, 25, 100, 500, 2500, 10000, 50000, 100000]
export const PHYSICS_WARP_MAX_IDX = 4
const PHYSICS_DT = 0.02

export interface Sim {
  gs: GameState
  warpIdx: number
  /** araç id → (parça indeksi → motor gücü) ; yalnızca çizim için */
  firing: Map<number, Map<number, number>>
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

function chooseCoastWarpIdx(waitSec: number, maxCap = 9): number {
  let idx = 0
  if (waitSec > 250_000) idx = 9
  else if (waitSec > 35_000) idx = 7
  else if (waitSec > 4_000) idx = 6
  else if (waitSec > 550) idx = 5
  else if (waitSec > 120) idx = 4
  else if (waitSec > 45) idx = 2
  else idx = 0
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
function updateTransferAutopilot(sim: Sim, v: Vessel, events: GameEvent[]): number | null {
  const gs = sim.gs
  const targetId = (gs.targetBody ?? 'moon') as BodyId
  const target = BODIES[targetId]
  const body = BODIES[v.bodyId]

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
        if (v.id === gs.activeId && s.altSea >= body.atmoHeight) {
          sim.warpIdx = chooseCoastWarpIdx(rem, 7)
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
      if (v.id === gs.activeId && s.altSea >= body.atmoHeight) {
        sim.warpIdx = chooseCoastWarpIdx(Math.max(0, waitSec - lead), 6)
      }
      v.autopilotNote = `${target.name} transfer penceresi bekleniyor (${Math.round(waitSec)} s)…`
      return proAngle
    }

    if (v.id === gs.activeId && sim.warpIdx > PHYSICS_WARP_MAX_IDX) sim.warpIdx = 0
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
      if (v.id === gs.activeId && s.altSea >= body.atmoHeight) sim.warpIdx = Math.min(sim.warpIdx || 6, 7)
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
      if (v.id === gs.activeId && s.altSea >= body.atmoHeight) sim.warpIdx = chooseCoastWarpIdx(orbitWait - 8, 4)
      v.autopilotNote = `${target.name} için ${body.name} çıkış açısına dönülüyor (${Math.round(orbitWait)} s)…`
      return proAngle
    }
    if (v.id === gs.activeId && sim.warpIdx > PHYSICS_WARP_MAX_IDX) sim.warpIdx = 0
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
      if (v.id === gs.activeId && s.altSea >= body.atmoHeight) sim.warpIdx = Math.min(sim.warpIdx || 6, 7)
      v.autopilotNote = `${planet.name}'a doğru ${body.name} çekiminden çıkılıyor…`
      return proAngle
    }

    if (sunWait > 3600 * 12 && el.e < 0.85) {
      v.throttle = 0
      if (v.id === gs.activeId && s.altSea >= body.atmoHeight) sim.warpIdx = chooseCoastWarpIdx(sunWait - 3600 * 6, 9)
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
      if (v.id === gs.activeId && s.altSea >= body.atmoHeight) sim.warpIdx = chooseCoastWarpIdx(orbitWait - 8, 4)
      v.autopilotNote = `${planet.name} çıkış açısına dönülüyor (${Math.round(orbitWait)} s)…`
      return proAngle
    }

    if (v.id === gs.activeId && sim.warpIdx > PHYSICS_WARP_MAX_IDX) sim.warpIdx = 0
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
        if (v.id === gs.activeId) sim.warpIdx = chooseCoastWarpIdx(rem, 9)
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
      if (v.id === gs.activeId) sim.warpIdx = chooseCoastWarpIdx(Math.max(10_000, waitSec * 0.25), 9)
      v.autopilotNote = `${planet.name} yörünge kesişimi bekleniyor…`
      return proAngle
    }

    if (waitSec > 3600 * 18) {
      v.throttle = 0
      if (v.id === gs.activeId) sim.warpIdx = chooseCoastWarpIdx(waitSec - 3600 * 6, 9)
      v.autopilotNote = `${planet.name} Güneş transfer penceresi bekleniyor…`
      return proAngle
    }

    if (v.id === gs.activeId && sim.warpIdx > PHYSICS_WARP_MAX_IDX) sim.warpIdx = 0
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
  if (v.id === sim.gs.activeId) sim.warpIdx = 0
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
        if (gain > 25) completeMission(gs, 'grav-assist', events)
      }
    }
    v.assist = null
    v.approachWarn = null
    events.push({ type: 'soi', from: body.id, to: body.parentId })
    return true
  }
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
      if (effectiveAutopilot(v) === 'transfer' && child.id === gs.targetBody) {
        triggerProximityArrival(sim, v, child.id, events)
      } else if (child.id === gs.targetBody && !hasAutoLandTech(gs)) {
        v.approachWarn = child.id
        if (v.id === gs.activeId) sim.warpIdx = Math.min(sim.warpIdx, 2)
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
  events.push({ type: 'crash', name: v.name, wasActive, reason })
}

/** Dünyayı dtReal gerçek saniye ilerletir. */
export function stepWorld(sim: Sim, dtReal: number, ctrl: Controls): GameEvent[] {
  const gs = sim.gs
  const events: GameEvent[] = []
  const active = activeVessel(gs)
  const real = Math.min(0.05, Math.max(0, dtReal))
  const transferTargets = new Map<number, number | null>()

  // Transfer otopilotu ve yakıt bitmiş kademe kontrolü (fizik/ray seçimi öncesi)
  for (const v of [...gs.vessels]) {
    const ap = effectiveAutopilot(v)
    if (ap === 'transfer') {
      const targetAngle = updateTransferAutopilot(sim, v, events)
      transferTargets.set(v.id, targetAngle)
    }
    if (ap === 'orbit' || ap === 'transfer') {
      autoStageIfSpent(sim, v, events)
    }
    if ((ap === 'orbit' || ap === 'transfer') && v.landed) {
      v.throttle = 1
    }
    // Yörünge otopilotu süzülürken zamanı kendisi hızlandırır, yanışta yavaşlatır.
    if (ap === 'orbit' && v === active && !v.landed) {
      const b = BODIES[v.bodyId]
      const coasting = v.throttle === 0 && Math.hypot(v.pos.x, v.pos.y) - b.radius > b.atmoHeight + 500
      if (coasting) sim.warpIdx = Math.max(sim.warpIdx, PHYSICS_WARP_MAX_IDX)
      else if (sim.warpIdx > 2) sim.warpIdx = 2
    }
  }

  if (active && sim.warpIdx > PHYSICS_WARP_MAX_IDX && needsPhysics(active, ctrl)) {
    sim.warpIdx = PHYSICS_WARP_MAX_IDX
    events.push({ type: 'toast', text: 'Zaman hızlandırma 25×\'e düştü (itki / atmosfer / yüzey).' })
  }
  const warp = WARPS[sim.warpIdx]!
  let simDt = real * warp
  const t0 = gs.time

  for (const v of [...gs.vessels]) {
    const isActive = v === active
    const c = isActive ? ctrl : null
    const apBefore = effectiveAutopilot(v)
    const extTarget = transferTargets.get(v.id) ?? null
    if (!needsPhysics(v, c) && v.landed) {
      sim.firing.delete(v.id)
      continue
    }
    if (needsPhysics(v, c) && sim.warpIdx <= PHYSICS_WARP_MAX_IDX) {
      const n = Math.max(1, Math.ceil(simDt / PHYSICS_DT))
      const h = simDt / n
      const manualScale = 1 / Math.max(1, warp)
      for (let i = 0; i < n; i += 1) {
        const res = stepPhysics(v, h, c, manualScale, extTarget)
        sim.firing.set(v.id, res.firing)
        if (res.crash) {
          destroy(sim, v, res.crash, events)
          break
        }
        if (res.touchdown) {
          if (v.bodyId !== 'earth' && BODIES[v.bodyId].landable && !gs.bases[v.bodyId]) {
            gs.bases[v.bodyId] = emptyBase(Math.atan2(v.pos.y, v.pos.x), v.ownerId)
          }
          if (isActive) events.push({ type: 'toast', text: `${BODIES[v.bodyId].name} yüzeyine iniş başarılı.` })
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
      if (checkSoi(sim, v, t, events) && isActive && sim.warpIdx > 4) sim.warpIdx = 4
      const body = BODIES[v.bodyId]
      const s = situation(v, st)
      if (s.r < body.radius || (body.landable && s.alt <= 0)) {
        destroy(sim, v, isActive ? 'yüzeye çarptı' : 'yörüngeden düştü', events)
        break
      }
      if (!isActive && s.altSea < body.atmoHeight * 0.5) {
        destroy(sim, v, 'atmosferde yandı', events)
        break
      }
      if (isActive && sim.warpIdx > PHYSICS_WARP_MAX_IDX && (s.altSea < body.atmoHeight || (body.landable && s.vr < 0 && s.alt < Math.max(4000, -20 * s.vr)))) {
        // Yaklaşma koruması: kalan süreyi at, fizik adımına geç.
        sim.warpIdx = PHYSICS_WARP_MAX_IDX
        simDt -= remaining
        remaining = 0
        events.push({ type: 'toast', text: 'Yüzeye/atmosfere yaklaşıldı: zaman 25×.' })
      }
    }
  }

  gs.time = t0 + simDt
  gs.tick = (gs.tick ?? 0) + 1

  for (const v of gs.vessels) chargeBatteries(v, vesselStats(v.parts, v.cargo), gs.time, simDt)

  const actualWarp = real > 0 ? simDt / real : 1
  const incomeDt = effectiveIncomeDt(real, actualWarp)
  for (const id of Object.keys(gs.bases) as BodyId[]) {
    const base = gs.bases[id]!
    const mult = baseIncomeMultiplier(gs, id)
    gs.money += tickBase(base, solarFlux(len(bodyAbsState(id, gs.time).r)), incomeDt, mult, id !== 'earth')
  }

  const cur = activeVessel(gs)
  if (cur) {
    for (const m of MISSIONS) {
      if (m.check && !gs.missionsDone.includes(m.id) && m.check(cur, gs)) completeMission(gs, m.id, events)
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

/** Tasarımı satın alıp Dünya'daki rampaya koyar. Hata varsa mesaj döndürür. */
export function launchDesign(sim: Sim, ownerId = sim.gs.ownerId ?? 'local'): string | null {
  const gs = sim.gs
  const err = validateDesign(gs.design, gs.designCargo, gs)
  if (err) return err
  const cost = designCost(gs.design, gs.designCargo)
  if (cost > gs.money) return `Bütçe yetersiz: ${cost.toLocaleString('tr-TR')} ₡ gerekli.`
  const onPad = gs.vessels.find((v) => v.bodyId === 'earth' && v.landed && Math.abs(wrapPi(Math.atan2(v.pos.y, v.pos.x) - PAD_ANGLE)) * BODIES.earth.radius < 60)
  if (onPad) return `Rampa dolu: önce "${onPad.name}" aracını kurtar veya kaldır.`
  const parts = freshParts(gs.design)
  const st = vesselStats(parts)
  const r = BODIES.earth.radius + terrainHeight('earth', PAD_ANGLE) + (st.maxY - st.comY)
  const id = gs.nextId
  gs.nextId += 1
  const v: Vessel = {
    id,
    name: `Selene ${id}`,
    ownerId,
    parts,
    bodyId: 'earth',
    pos: { x: Math.cos(PAD_ANGLE) * r, y: Math.sin(PAD_ANGLE) * r },
    vel: { x: 0, y: 0 },
    angle: PAD_ANGLE,
    angVel: 0,
    landed: true,
    throttle: 0,
    ec: st.ecCap,
    cargo: { modules: { ...gs.designCargo }, ore: 0, oreFrom: null },
    rcsOn: false,
    sas: 'off',
    autopilot: 'off',
    approachWarn: null,
    visited: ['earth'],
    assist: null,
    dvUsed: 0,
  }
  gs.money -= cost
  gs.vessels.push(v)
  gs.activeId = id
  sim.warpIdx = 0
  return null
}

export function setActive(sim: Sim, id: number) {
  const prev = activeVessel(sim.gs)
  if (prev && prev.id !== id) prev.throttle = 0
  if (sim.gs.vessels.some((v) => v.id === id)) sim.gs.activeId = id
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
      const cap = st.cargoCap
      if (cargoMass(v.cargo) > cap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
      v.ec = Math.min(v.ec, st.ecCap)
    } else {
      const id = gs.nextId
      gs.nextId += 1
      gs.vessels.push({
        id, name: st.hasCommand ? `${v.name}-B${id}` : `Kademe ${id}`, parts, bodyId: v.bodyId, pos, vel,
        angle: v.angle, angVel: v.angVel + (lx > 0 ? -0.15 : lx < 0 ? 0.15 : 0), landed: false, throttle: 0, ec: 0,
        cargo: { modules: {}, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off', visited: [...v.visited], assist: null, dvUsed: 0,
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
  const st = vesselStats(v.parts)
  let refund = st.cost * 0.8
  for (const [id, n] of Object.entries(v.cargo.modules)) refund += (MODULE_BY_ID[id]?.cost ?? 0) * n
  let oreIncome = 0
  if (v.cargo.ore > 0 && v.cargo.oreFrom) {
    oreIncome = v.cargo.ore * BODIES[v.cargo.oreFrom].orePrice * orePriceMultiplier(gs)
    completeMission(gs, 'ore-return', events)
  }
  if (v.visited.includes('moon') && st.hasCommand) completeMission(gs, 'earth-return', events)
  gs.money += refund + oreIncome
  gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
  if (gs.activeId === v.id) gs.activeId = null
  events.push({ type: 'toast', text: `Araç kurtarıldı: +${Math.round(refund).toLocaleString('tr-TR')} ₡ parça iadesi${oreIncome ? `, +${Math.round(oreIncome).toLocaleString('tr-TR')} ₡ maden satışı` : ''}.` })
  return events
}

/** İnen aracın kargosundaki yapıları koloni deposuna indirir; oradan yuvalara kurulur. */
export function deployModules(sim: Sim, v: Vessel): string | null {
  if (!v.landed || v.bodyId === 'earth' || !BODIES[v.bodyId].landable) {
    return 'Yapıları indirmek için Dünya dışı bir gezegen veya uydu yüzeyine inmelisin.'
  }
  const total = Object.values(v.cargo.modules).reduce((s, n) => s + n, 0)
  if (!total) return 'Kargoda indirilecek yapı yok.'
  const base = (sim.gs.bases[v.bodyId] ??= emptyBase(Math.atan2(v.pos.y, v.pos.x), v.ownerId))
  ensureSites(base)
  const stock = (base.stock ??= {})
  for (const [id, n] of Object.entries(v.cargo.modules)) {
    if (!MODULE_BY_ID[id]) continue
    // Boş yuva varsa ve kademe uygunsa doğrudan kur, kalanı depoya koy.
    for (let i = 0; i < n; i += 1) {
      const free = base.sites!.indexOf(null)
      if (free >= 0 && MODULE_BY_ID[id]!.tier <= colonyTier(base)) {
        base.sites![free] = id
        syncModules(base)
      } else stock[id] = (stock[id] ?? 0) + 1
    }
  }
  v.cargo.modules = {}
  return null
}

/** Dünya'da aynı yapıdan çoğaldıkça fiyat artar. */
export function earthModuleCost(gs: GameState, moduleId: string): number {
  const m = MODULE_BY_ID[moduleId]
  if (!m) return 0
  const owned = gs.bases.earth?.modules[moduleId] ?? 0
  return Math.round(m.cost * (1 + 0.55 * owned))
}

export function modulePrice(gs: GameState, bodyId: BodyId, moduleId: string): number {
  if ((gs.bases[bodyId]?.stock?.[moduleId] ?? 0) > 0) return 0
  return bodyId === 'earth' ? earthModuleCost(gs, moduleId) : (MODULE_BY_ID[moduleId]?.cost ?? 0)
}

function canEditPlanetBase(gs: GameState, bodyId: BodyId): string | null {
  if (!BODIES[bodyId]?.landable) return 'Bu gök cisminde koloni kurulamaz.'
  if (bodyId === 'earth') return null
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
  if (bodyId === 'earth' && (moduleId === 'drill' || moduleId === 'isru')) return 'Maden Aracı ve Yakıt Tesisi yalnızca Dünya dışında kurulur.'
  const gate = canEditPlanetBase(gs, bodyId)
  if (gate) return gate
  const landed = gs.vessels.find((v) => v.landed && v.bodyId === bodyId)
  const siteAngle = bodyId === 'earth' ? PAD_ANGLE : Math.atan2(landed?.pos.y ?? 0, landed?.pos.x ?? 1)
  const base = (gs.bases[bodyId] ??= emptyBase(siteAngle, ownerId))
  const sites = ensureSites(base)
  if (m.tier > colonyTier(base)) return TIER_HINT[m.tier] ?? 'Bu yapı henüz açılmadı.'
  if (slot < 0 || slot >= sites.length || sites[slot]) return 'Boş bir yuva seç.'
  const price = modulePrice(gs, bodyId, moduleId)
  if (gs.money < price) return `${price.toLocaleString('tr-TR')} ₡ gerekli.`
  if (price === 0 && base.stock?.[moduleId]) base.stock[moduleId]! -= 1
  gs.money -= price
  sites[slot] = moduleId
  syncModules(base)
  return null
}

/** Yuvadaki yapıyı söker (%60 iade). */
export function removePlanetModule(sim: Sim, bodyId: BodyId, slot: number): { error?: string; refund?: number } {
  const gs = sim.gs
  const base = gs.bases[bodyId]
  if (!base) return { error: 'Bu gezegende koloni yok.' }
  const sites = ensureSites(base)
  const id = sites[slot]
  if (!id) return { error: 'Sökülecek yapı yok.' }
  const refund = Math.round((MODULE_BY_ID[id]?.cost ?? 0) * 0.6)
  gs.money += refund
  sites[slot] = null
  syncModules(base)
  return { refund }
}

/** İlk boş yuvaya yapı kurar. */
export function buyBaseModule(sim: Sim, bodyId: BodyId, moduleId: string): string | null {
  const base = sim.gs.bases[bodyId]
  const slot = base ? ensureSites(base).indexOf(null) : 0
  if (slot < 0) return 'Kolonide boş yuva kalmadı.'
  return placePlanetModule(sim, bodyId, slot, moduleId)
}

export const buyEarthModule = (sim: Sim, moduleId: string): string | null => buyBaseModule(sim, 'earth', moduleId)

export function loadOre(sim: Sim, v: Vessel): string | null {
  const base = sim.gs.bases[v.bodyId]
  if (!v.landed || !base) return 'Maden yüklemek için üssün olduğu yüzeye inmelisin.'
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
export function deleteVessel(sim: Sim, id: number): boolean {
  const gs = sim.gs
  const before = gs.vessels.length
  gs.vessels = gs.vessels.filter((v) => v.id !== id)
  sim.firing.delete(id)
  if (gs.activeId === id) gs.activeId = gs.vessels.find((v) => vesselStats(v.parts).hasCommand)?.id ?? null
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
  sim.firing.delete(other.id)
  sim.firing.delete(v.id)
  return [{ type: 'toast', text: `${other.name} ile kenetlenildi. Ayırmak için aradaki adaptöre tıkla.` }]
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
    const targetId = (sim.gs.targetBody ?? 'moon') as BodyId
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
      const err = launchDesign(sim, actorId)
      return err ? { events, error: err } : { events }
    }
    case 'setTarget': {
      gs.targetBody = cmd.bodyId
      return { events }
    }
    case 'buyModule': {
      const err = buyBaseModule(sim, cmd.bodyId, cmd.moduleId)
      return err ? { events, error: err } : { events }
    }
    case 'placeGridModule': {
      const err = placePlanetModule(sim, cmd.bodyId, cmd.x, cmd.moduleId, actorId)
      return err ? { events, error: err } : { events }
    }
    case 'removeGridModule': {
      const res = removePlanetModule(sim, cmd.bodyId, cmd.x)
      if (res.error) return { events, error: res.error }
      if (res.refund) events.push({ type: 'toast', text: `Yapı söküldü: +${res.refund.toLocaleString('tr-TR')} ₡ iade.` })
      return { events }
    }
    default: {
      const v = 'vesselId' in cmd ? getVessel(cmd.vesselId) : undefined
      if (!v) return { events, error: 'Araç bulunamadı.' }
      if (!canControlVessel(v, actorId)) return { events, error: 'Bu araç başka bir oyuncuya ait.' }
      switch (cmd.type) {
        case 'stage':
          events.push(...stageNext(sim, v))
          return { events }
        case 'dock': {
          const other = getVessel(cmd.targetId)
          if (!other) return { events, error: 'Kenetlenecek araç yok.' }
          events.push(...dockVessels(sim, v, other))
          return { events }
        }
        case 'deleteVessel':
          deleteVessel(sim, v.id)
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
          return { events }
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
      }
    }
  }
}
