import { useCallback, useEffect, useRef, useState } from 'react'
import { isQuadrantColonized, MODULE_BY_ID, MODULES, QUADRANT_SHORT, quadrantCenterAngle, quadrantOfAngle, type QuadrantId } from '../game/base'
import { MISSIONS } from '../game/missions'
import { audio } from '../audio'
import { lang, T } from '../i18n'
import { bump, getActiveSim, runCommand, saveGame, sim, useAuthState } from '../game/store'
import { isModuleUnlocked } from '../game/tech'
import type {
  AutopilotMode,
  DynamicWarpInfo,
  GameCommand,
  GameEvent,
  GameState,
  MultiplayerFeedItem,
  MultiplayerPlayer,
  PlanetCapture,
  SasMode,
  Vessel,
  WarfareGoal,
  WeaponKind,
} from '../game/types'
import { activeEngines, cargoMass, estimateDeltaV, fuelGroups, vesselStats } from '../game/vessel'
import { OUTPOST_MAX_LEVEL, OUTPOST_UPGRADE_COST, partDef, partMaxHp } from '../game/data'
import { bodyAbsState, bodyRelState, elementsFromState, hohmann, len, wrapPi } from '../flight/orbit'
import { type Controls, effectiveAutopilot, landingTolerance, pressureRatio, situation } from '../flight/physics'
import { type Patch, predictTrajectory } from '../flight/predict'
import { allColoniesOnBody, getPlayerQuadrantColonies, isLootMode, isWarfareMode } from '../flight/combat'
import { findOutpost, SERVICE_RANGE } from '../flight/loot'
import {
  activeVessel,
  availableLaunchSites,
  canTransferCargoBetween,
  clickPart,
  deployModules,
  getActorBase,
  pickupModule,
  launchDesign,
  loadOre,
  recoverVessel,
  refuelAtBase,
  setActive,
  setVesselAutopilot,
  deleteVessel,
  dockCandidate,
  dockVessels,
  stageNext,
  stepWorld,
  toggleKind,
  totalPassiveIncomePerMin,
  WARPS,
  isStationVessel,
  rendezvousStation,
} from '../flight/world'
import {
  exitMpMode,
  getLocalMpDesign,
  isMpPendingLaunch,
  leaveMpRoom,
  onMpEvents,
  sendMpChat,
  sendMpControls,
  useMultiplayer,
} from '../flight/mpClient'
import { CONQUERABLE_BODIES, playerPadAngle, playerPassiveIncomePerMin } from '../flight/multiplayerSim'
import { BODIES, type BodyId, gameDate, solarFlux } from '../nasa/bodies'
import DroneWindow from './DroneWindow'
import FleetWindow from './FleetWindow'
import { aimInfoFromScreen, clampCamPan, createView, type FlightFrame, type MapFrame, pickPart, pickVesselFlight, renderFlight, renderMap, resetViewCache } from '../render/renderer'
import PartIcon from './PartIcon'
import PlanetGridPanel from './ColonyPanel'

const DESTINATIONS: BodyId[] = ['moon', 'earth', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']
const QUICK_WARPS = [1, 4, 10, 25]
  .map((w) => ({ label: `${w}×`, idx: WARPS.indexOf(w) }))
  .filter((w) => w.idx >= 0)


const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const km = (m: number) => (Math.abs(m) >= 1e7 ? `${(m / 1e6).toFixed(2)} Mm` : Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`)
const dur = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)} sa` : s >= 120 ? `${(s / 60).toFixed(0)} dk` : `${s.toFixed(0)} sn`)

interface Hud {
  has: boolean
  vesselId: number | null
  name: string
  body: BodyId
  quadrant: QuadrantId
  isDrone: boolean
  droneWarn: boolean
  droneMaxAlt: number | null
  alt: number
  speed: number
  vr: number
  throttle: number
  fuel: number
  fuelCap: number
  stageFuel: number
  stageCap: number
  ec: number
  ecCap: number
  apo: number | null
  peri: number | null
  landed: boolean
  landable: boolean
  autoLand: boolean
  autopilot: AutopilotMode
  autopilotNote: string
  followId: number | null
  followName: string | null
  followerCount: number
  fleetFollowersTotal: number
  approachWarn: BodyId | null
  hasAutoLand: boolean
  sas: SasMode
  warp: number
  warpIdx: number
  money: number
  passivePerMin: number
  date: string
  dv: number
  tol: number
  vessels: { id: number; name: string; body: string; bodyId: BodyId; landed: boolean; isDrone: boolean; isStation: boolean; followId: number | null; followers: number; active: boolean }[]
  plan: string[]
  targetBody: BodyId
  cargo: string
  twr: number
  dockName: string | null
  issDist: number | null
  issRel: number
  canRendezvous: boolean
  missionNext: string
  hasLegs: boolean
  legsOpen: boolean
  hasChutes: boolean
  chutesOpen: boolean
  hasSolar: boolean
  solarOpen: boolean
  hasDecoupler: boolean
  canTech: boolean
  isMp: boolean
  myId: string
  mpTargetPlanets: number
  mpWinnerId: string | null
  mpWarpInfo: DynamicWarpInfo | null
  mpWantWarpIdx: number
  mpWarpAnchor: boolean
  mpPlayers: MultiplayerPlayer[]
  mpCaptures: Partial<Record<BodyId, PlanetCapture>>
  mpQuadCaptures: Partial<Record<BodyId, (PlanetCapture | undefined)[]>>
  mpFeed: MultiplayerFeedItem[]
  mpNearestRival: { username: string; color: string; dist: number } | null
  mpNearestEnemyColony: { username: string; color: string; dist: number } | null
  isWarfare: boolean
  /** Yağma modu göstergeleri (mod kapalıysa null) */
  loot: LootHud | null
  warfareGoal: WarfareGoal
  mpEliminated: boolean
  hp: number
  maxHp: number
  shield: number
  shieldCap: number
  weaponCount: number
  ammoTotal: number
  empStunned: boolean
  burning: boolean
  weapons: {
    defId: string
    name: string
    kind: WeaponKind | 'drone'
    isDrone?: boolean
    count: number
    ready: number
    charge: number
    beaming: boolean
    cdRem: number
    cooldown: number
    ammo: number | null
    ammoCap: number | null
    ecUse: number
    color: string
    desc: string
  }[]
  nearbyTransfer: boolean
  droneBayReady: boolean
  liveDroneCount: number
  hasCargoBay: boolean
}

function transferPlan(v: Vessel, t: number, targetBody: BodyId): string[] {
  const out: string[] = []
  if (v.landed) return out
  const body = BODIES[v.bodyId]
  const el = elementsFromState(v.pos, v.vel, body.mu)
  if (el.e >= 1) return out
  const r = len(v.pos)
  const shipAngle = Math.atan2(v.pos.y, v.pos.x)
  const nShip = el.dir * Math.sqrt(body.mu / el.a ** 3)
  const target = BODIES[targetBody]

  if (v.bodyId === 'earth') {
    if (targetBody === 'moon') {
      const moon = BODIES.moon
      const h = hohmann(body.mu, r, moon.orbit!.a, moon.orbit!.n)
      const ms = bodyRelState(moon, t).r
      const phase = wrapPi(Math.atan2(ms.y, ms.x) - shipAngle)
      let diff = wrapPi(phase - h.phase) * el.dir
      if (diff < 0) diff += 2 * Math.PI
      const wait = diff / Math.abs(nShip - moon.orbit!.n)
      out.push(`Ay transferi: ileri ≈ ${h.dv1.toFixed(0)} m/s · pencere ${dur(wait)} sonra`)
    } else {
      const planet = target.parentId === 'sun' ? target : BODIES[target.parentId!]
      if (planet.orbit && planet.id !== 'earth') {
        const e = BODIES.earth.orbit!
        const p = planet.orbit
        const hm = hohmann(BODIES.sun.mu, e.a, p.a, p.n)
        const ea = bodyAbsState('earth', t).r
        const pa = bodyAbsState(planet.id, t).r
        const ph = wrapPi(Math.atan2(pa.y, pa.x) - Math.atan2(ea.y, ea.x))
        const rate = p.n - e.n
        let d = wrapPi((hm.phase - ph) * Math.sign(rate || 1))
        if (d < 0) d += 2 * Math.PI
        const vInf = Math.abs(hm.dv1)
        const eject = Math.sqrt(vInf * vInf + (2 * body.mu) / r) - Math.sqrt(body.mu / r)
        const label = target.id === planet.id ? planet.name : `${target.name} (${planet.name})`
        const dirText = p.a < e.a ? 'ters yön' : 'ileri'
        out.push(`${label}: ≈ ${eject.toFixed(0)} m/s (${dirText}) · pencere ${dur(d / Math.max(1e-9, Math.abs(rate)))} sonra`)
      }
    }
  } else if (v.bodyId === 'sun') {
    const planet = target.parentId === 'sun' ? target : BODIES[target.parentId!]
    if (planet.orbit) {
      const hm = hohmann(BODIES.sun.mu, r, planet.orbit.a, planet.orbit.n)
      const pa = bodyAbsState(planet.id, t).r
      const ph = wrapPi(Math.atan2(pa.y, pa.x) - shipAngle)
      const rate = planet.orbit.n - nShip
      let d = wrapPi((hm.phase - ph) * Math.sign(rate || 1))
      if (d < 0) d += 2 * Math.PI
      out.push(`${target.name}: ${hm.dv1 >= 0 ? 'ileri' : 'geri'} ≈ ${Math.abs(hm.dv1).toFixed(0)} m/s · pencere ${dur(d / Math.max(1e-9, Math.abs(rate)))} sonra`)
    }
  } else {
    const vEsc = Math.sqrt((2 * body.mu) / r)
    out.push(`${body.name} kaçış hızı ${vEsc.toFixed(0)} m/s (şu an ${len(v.vel).toFixed(0)} m/s)`)
    if ((v.bodyId === 'jupiter' && targetBody === 'ganymede') || (v.bodyId === 'saturn' && targetBody === 'titan')) {
      const m = BODIES[targetBody]
      const hm = hohmann(body.mu, r, m.orbit!.a, m.orbit!.n)
      const ms = bodyRelState(m, t).r
      const phase = wrapPi(Math.atan2(ms.y, ms.x) - shipAngle)
      let diff = wrapPi(phase - hm.phase) * el.dir
      if (diff < 0) diff += 2 * Math.PI
      out.push(`${m.name}: ≈ ${Math.abs(hm.dv1).toFixed(0)} m/s · pencere ${dur(diff / Math.max(1e-9, Math.abs(nShip - m.orbit!.n)))} sonra`)
    }
  }
  return out
}

interface LootHud {
  goal: number
  cargo: number
  cargoCap: number
  homeDist: number | null
  nearHome: boolean
  outside: boolean
  level: number
  upgradeCost: number | null
  rebuildIn: number | null
  site: { name: string; dist: number; crates: number } | null
}

function lootSnapshot(gs: GameState, v: Vessel | null, myId: string, clock: number): LootHud | null {
  const loot = gs.mp?.loot
  if (!loot || !isLootMode(gs)) return null
  const me = gs.mp!.players[myId]
  const home = findOutpost(gs, myId)
  const level = me?.outpostLevel ?? 1
  const st = v ? vesselStats(v.parts, v.cargo) : null
  const homeDist = v && home ? Math.hypot(home.pos.x - v.pos.x, home.pos.y - v.pos.y) : null
  let site: LootHud['site'] = null
  if (v) {
    loot.sites.forEach((sdef, idx) => {
      const crates = loot.crates.filter((c) => c.site === idx).length
      if (!crates) return
      const dist = Math.hypot(sdef.pos.x - v.pos.x, sdef.pos.y - v.pos.y)
      if (!site || dist < site.dist) site = { name: sdef.name, dist, crates }
    })
  }
  const rebuildAt = loot.rebuild?.[myId]
  return {
    goal: gs.mp!.config.lootGoal ?? 60,
    cargo: v ? v.cargo.ore : 0,
    cargoCap: st?.cargoCap ?? 0,
    homeDist,
    nearHome: homeDist !== null && homeDist <= SERVICE_RANGE,
    outside: !!v && Math.hypot(v.pos.x - loot.center.x, v.pos.y - loot.center.y) > loot.radius,
    level,
    upgradeCost: home && level < OUTPOST_MAX_LEVEL ? OUTPOST_UPGRADE_COST[level]! : null,
    rebuildIn: !home && rebuildAt !== undefined ? Math.max(0, rebuildAt - clock) : null,
    site,
  }
}

function snapshot(): Hud {
  const curSim = getActiveSim()
  const gs = curSim.gs
  const isMp = Boolean(gs.mp)
  const isWarfare = isWarfareMode(gs)
  const warfareGoal: WarfareGoal = gs.mp?.config.warfareGoal ?? 'siege'
  const myId = gs.ownerId ?? 'local'
  const v = activeVessel(gs)
  const meMp = gs.mp?.players[myId]
  const targetBody = ((isMp ? meMp?.targetBody : gs.targetBody) ?? gs.targetBody ?? 'moon') as BodyId
  const isLoot = isLootMode(gs)
  const mpPlayers = gs.mp
    ? Object.values(gs.mp.players).sort((a, b) =>
        isLoot
          ? (b.looted ?? 0) - (a.looted ?? 0) || b.kills - a.kills
          : isWarfare
          ? (a.eliminated ? 1 : 0) - (b.eliminated ? 1 : 0) ||
            (b.score ?? 0) - (a.score ?? 0) ||
            (b.coloniesDestroyed ?? 0) - (a.coloniesDestroyed ?? 0)
          : b.planetsHeld - a.planetsHeld || b.captures - a.captures,
      )
    : []
  let mpNearestRival: { username: string; color: string; dist: number } | null = null
  let mpNearestEnemyColony: { username: string; color: string; dist: number } | null = null
  if (gs.mp && v && !v.debris) {
    for (const o of gs.vessels) {
      if (o.id === v.id || o.bodyId !== v.bodyId || o.debris || o.station || o.outpost || !o.ownerId || o.ownerId === myId) continue
      const p = gs.mp.players[o.ownerId]
      if (!p) continue
      const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y)
      if (!mpNearestRival || d < mpNearestRival.dist) {
        mpNearestRival = { username: p.username, color: p.color, dist: d }
      }
    }
    if (isWarfare && !isLoot) {
      for (const col of allColoniesOnBody(gs, v.bodyId)) {
        if (col.ownerId === myId || col.base.destroyed) continue
        const p = gs.mp.players[col.ownerId]
        if (!p) continue
        const th = col.base.siteAngle ?? playerPadAngle(gs, col.ownerId)
        const rB = BODIES[v.bodyId].radius
        const cx = Math.cos(th) * rB
        const cy = Math.sin(th) * rB
        const d = Math.hypot(cx - v.pos.x, cy - v.pos.y)
        if (!mpNearestEnemyColony || d < mpNearestEnemyColony.dist) {
          mpNearestEnemyColony = { username: p.username, color: p.color, dist: d }
        }
      }
    }
  }
  const base: Hud = {
    has: false,
    vesselId: null,
    name: '',
    body: 'earth',
    quadrant: 0,
    isDrone: false,
    droneWarn: false,
    droneMaxAlt: null,
    alt: 0,
    speed: 0,
    vr: 0,
    throttle: 0,
    fuel: 0,
    fuelCap: 0,
    stageFuel: 0,
    stageCap: 0,
    ec: 0,
    ecCap: 0,
    apo: null,
    peri: null,
    landed: false,
    landable: true,
    autoLand: false,
    autopilot: 'off',
    autopilotNote: '',
    followId: null,
    followName: null,
    followerCount: 0,
    fleetFollowersTotal: gs.vessels.filter((o) => !o.debris && effectiveAutopilot(o) === 'follow' && (!isMp || o.ownerId === myId)).length,
    approachWarn: null,
    hasAutoLand: true,
    sas: 'off',
    warp: WARPS[curSim.warpIdx]!,
    warpIdx: curSim.warpIdx,
    money: isMp && meMp ? meMp.money : gs.money,
    passivePerMin: isMp ? playerPassiveIncomePerMin(gs, myId) : totalPassiveIncomePerMin(gs),
    date: gameDate(gs.time).toLocaleDateString(lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }),
    dv: 0,
    tol: 7,
    vessels: gs.vessels
      .filter((o) => !o.debris && !o.outpost && (!isMp || (!o.station && o.ownerId === myId)))
      .map((o) => ({
        id: o.id,
        name: o.name,
        body: BODIES[o.bodyId].name + (o.landed ? ' (yüzeyde)' : ''),
        bodyId: o.bodyId,
        landed: o.landed,
        isDrone: Boolean(o.drone),
        isStation: Boolean(o.station || isStationVessel(o)),
        followId: effectiveAutopilot(o) === 'follow' ? (o.followId ?? null) : null,
        followers: gs.vessels.filter((f) => !f.debris && effectiveAutopilot(f) === 'follow' && f.followId === o.id).length,
        active: o.id === gs.activeId,
      })),
    plan: [],
    targetBody,
    cargo: '',
    twr: 0,
    dockName: null,
    issDist: null,
    issRel: 0,
    canRendezvous: false,
    missionNext: MISSIONS.find((m) => !gs.missionsDone.includes(m.id))?.title ?? 'Tüm görevler tamamlandı',
    hasLegs: false,
    legsOpen: false,
    hasChutes: false,
    chutesOpen: false,
    hasSolar: false,
    solarOpen: false,
    hasDecoupler: false,
    canTech: false,
    isMp,
    myId,
    mpTargetPlanets: gs.mp?.config.targetPlanets ?? 4,
    mpWinnerId: gs.mp?.winnerId ?? null,
    mpWarpInfo: gs.mp?.warpInfo ?? null,
    mpWantWarpIdx: meMp?.wantsWarpIdx ?? -1,
    mpWarpAnchor: meMp?.warpAnchor ?? false,
    mpPlayers,
    mpCaptures: gs.mp?.captures ?? {},
    mpQuadCaptures: gs.mp?.quadrantCaptures ?? {},
    mpFeed: gs.mp?.feed ?? [],
    mpNearestRival,
    mpNearestEnemyColony,
    isWarfare,
    loot: lootSnapshot(gs, v, myId, curSim.clock ?? 0),
    warfareGoal,
    mpEliminated: Boolean(meMp?.eliminated),
    hp: 0,
    maxHp: 0,
    shield: 0,
    shieldCap: 0,
    weaponCount: 0,
    ammoTotal: 0,
    empStunned: false,
    burning: false,
    weapons: [],
    nearbyTransfer: false,
    droneBayReady: false,
    liveDroneCount: gs.vessels.filter((o) => !o.debris && Boolean(o.drone) && (!isMp || o.ownerId === myId)).length,
    hasCargoBay: false,
  }
  if (!v) return base
  const st = vesselStats(v.parts, v.cargo)
  const s = situation(v, st)
  const body = BODIES[v.bodyId]
  const el = elementsFromState(v.pos, v.vel, body.mu)
  const groups = fuelGroups(v.parts)
  const engineGroups = new Set(v.parts.map((p, i) => (partDef(p.def).kind === 'engine' && p.on !== false ? groups[i] : -2)))
  let stageFuel = 0
  let stageCap = 0
  let lowest = -1
  let lowestY = -1
  v.parts.forEach((p, i) => {
    if (partDef(p.def).kind === 'engine' && engineGroups.has(groups[i]) && p.y > lowestY) {
      lowestY = p.y
      lowest = groups[i]!
    }
  })
  v.parts.forEach((p, i) => {
    const d = partDef(p.def)
    if (d.kind === 'tank' && groups[i] === lowest) {
      stageFuel += p.fuel ?? 0
      stageCap += d.fuel ?? 0
    }
  })
  const mods = Object.entries(v.cargo.modules).map(([id, n]) => `${n}× ${MODULE_BY_ID[id]?.name ?? id}`)
  if (v.cargo.ore > 0.005) mods.push(`${v.cargo.ore.toFixed(2)} t maden`)
  const vQuad = quadrantOfAngle(Math.atan2(v.pos.y, v.pos.x))
  const nearbyTransfer = gs.vessels.some((o) => (!gs.mp || o.ownerId === myId) && canTransferCargoBetween(v, o))
  return {
    ...base,
    has: true,
    vesselId: v.id,
    name: v.name,
    body: v.bodyId,
    quadrant: vQuad,
    isDrone: Boolean(v.drone),
    droneWarn: Boolean(v.drone?.warn),
    droneMaxAlt: v.drone?.maxAlt ?? null,
    nearbyTransfer,
    droneBayReady: v.parts.some((p) => {
      const d = partDef(p.def)
      return d.kind === 'droneBay' && (p.hp === undefined || p.hp > 0) && (p.ammo ?? 1) > 0
    }),
    hasCargoBay: st.cargoCap > 0,
    alt: s.alt,
    speed: s.speed,
    vr: s.vr,
    throttle: v.throttle,
    fuel: st.fuel,
    fuelCap: st.fuelCap,
    stageFuel,
    stageCap,
    ec: v.ec,
    ecCap: st.ecCap,
    apo: !v.landed && el.e < 1 ? el.ra - body.radius : null,
    peri: !v.landed ? el.rp - body.radius : null,
    landed: v.landed,
    landable: body.landable,
    autoLand: !!v.autoLand,
    autopilot: effectiveAutopilot(v),
    autopilotNote: v.autopilotNote ?? '',
    followId: effectiveAutopilot(v) === 'follow' ? (v.followId ?? null) : null,
    followName: effectiveAutopilot(v) === 'follow' && v.followId ? (gs.vessels.find((o) => o.id === v.followId)?.name ?? null) : null,
    followerCount: gs.vessels.filter((o) => !o.debris && effectiveAutopilot(o) === 'follow' && o.followId === v.id).length,
    approachWarn: v.approachWarn ?? null,
    sas: v.sas,
    dv: estimateDeltaV(v.parts, cargoMass(v.cargo)).reduce((a, x) => a + x.dv, 0),
    tol: landingTolerance(st),
    plan: transferPlan(v, gs.time, targetBody),
    cargo: mods.join(', '),
    twr: (() => {
      // anlık itki/ağırlık: çalışabilir motorların bu basınçtaki itkisi ÷ (kütle × yerel çekim)
      const p = Math.min(1, Math.max(0, pressureRatio(body, s.altSea)))
      const thrust = activeEngines(v.parts).reduce((a, i) => {
        const d = partDef(v.parts[i]!.def)
        if (d.electricFan) {
          if (v.ec <= 0.1) return a
          const airBoost = p > 0.05 ? 1 + Math.min(0.4, p * 0.35) : 0.92
          return a + d.thrust! * airBoost
        }
        return a + (d.thrust! * (d.ispVac! + (d.ispSL! - d.ispVac!) * p)) / d.ispVac!
      }, 0)
      return thrust / (st.mass * (body.mu / (s.r * s.r)))
    })(),
    dockName: dockCandidate(gs, v)?.name ?? null,
    ...(() => {
      const iss = gs.vessels.find((o) => o.id !== v.id && isStationVessel(o))
      if (!iss || iss.bodyId !== v.bodyId || v.landed || isStationVessel(v)) return { issDist: null, issRel: 0, canRendezvous: false }
      return {
        issDist: Math.hypot(iss.pos.x - v.pos.x, iss.pos.y - v.pos.y),
        issRel: Math.hypot(iss.vel.x - v.vel.x, iss.vel.y - v.vel.y),
        canRendezvous: el.e < 1 && el.rp > body.radius + body.atmoHeight,
      }
    })(),
    hasLegs: st.legs > 0,
    legsOpen: st.legs > 0 && st.legsDeployed >= st.legs,
    hasChutes: st.chutes > 0,
    chutesOpen: st.chutes > 0 && st.chutesDeployed >= st.chutes,
    hasSolar: v.parts.some((p) => partDef(p.def).kind === 'solar'),
    solarOpen: v.parts.some((p) => partDef(p.def).kind === 'solar' && p.deployed),
    hasDecoupler: v.parts.some((p) => {
      const k = partDef(p.def).kind
      return k === 'decoupler' || k === 'radialDecoupler'
    }),
    ...(() => {
      const curClock = curSim.clock ?? 0
      let hp = 0
      let maxHp = 0
      for (const p of v.parts) {
        const m = partMaxHp(p.def)
        maxHp += m
        hp += Math.max(0, p.hp ?? m)
      }
      const mapW = new Map<
        string,
        {
          defId: string
          name: string
          kind: WeaponKind | 'drone'
          isDrone?: boolean
          count: number
          ready: number
          charge: number
          beaming: boolean
          cdRem: number
          cooldown: number
          ammo: number | null
          ammoCap: number | null
          ecUse: number
          color: string
          desc: string
        }
      >()
      const allowGuns = !isMp || isWarfare
      for (const p of v.parts) {
        const d = partDef(p.def)
        const w = allowGuns ? d.weapon : undefined
        if (!w) continue
        const beaming = Boolean(p.beamUntil && curClock < p.beamUntil)
        const cdRem = Math.max(0, p.cd ?? 0)
        const ch = Math.max(0, Math.min(1, p.charge ?? 0))
        const maxAmmo = w.ammo
        const cd = w.cooldown
        const ecUse = w.ecUse ?? 0
        const color = w.color
        let row = mapW.get(d.id)
        if (!row) {
          row = {
            defId: d.id,
            name: d.name,
            kind: w.kind,
            isDrone: false,
            count: 0,
            ready: 0,
            charge: 0,
            beaming: false,
            cdRem: 999,
            cooldown: cd,
            ammo: maxAmmo !== undefined ? 0 : null,
            ammoCap: maxAmmo !== undefined ? 0 : null,
            ecUse,
            color,
            desc: d.desc,
          }
          mapW.set(d.id, row)
        }
        row.count += 1
        if (cdRem <= 0.02 || (w?.minCooldown && w?.spinRate)) row.ready += 1
        if (ch > row.charge) row.charge = ch
        if (beaming) row.beaming = true
        row.cdRem = Math.min(row.cdRem, cdRem)
        if (maxAmmo !== undefined) {
          row.ammo = (row.ammo ?? 0) + (p.ammo ?? maxAmmo)
          row.ammoCap = (row.ammoCap ?? 0) + maxAmmo
        }
      }
      const weapons = [...mapW.values()].map((r) => ({ ...r, cdRem: r.cdRem >= 900 ? 0 : r.cdRem }))
      return {
        hp,
        maxHp,
        shield: v.shield ?? 0,
        shieldCap: st.shieldCap,
        weaponCount: st.weaponCount,
        ammoTotal: st.ammoTotal,
        empStunned: Boolean(v.empUntil && curClock < v.empUntil),
        burning: Boolean(v.burnUntil && curClock < v.burnUntil),
        weapons,
      }
    })(),
  }
}

interface Props {
  onBuilder: () => void
}

export default function FlightScreen({ onBuilder }: Props) {
  const auth = useAuthState()
  const mp = useMultiplayer()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef(createView())
  const keys = useRef(new Set<string>())
  const flightFrame = useRef<FlightFrame>({ cam: null, hits: [] })
  const mapFrame = useRef<MapFrame>({ vessels: [], bodies: [] })
  const patchesRef = useRef<Patch[]>([])
  const [hud, setHud] = useState<Hud>(snapshot)
  const [noVesselReady, setNoVesselReady] = useState(false)
  const hadVesselRef = useRef(hud.has)
  if (hud.has) hadVesselRef.current = true
  useEffect(() => {
    if (hud.has || (hud.isMp && isMpPendingLaunch())) {
      setNoVesselReady(false)
      return
    }
    const waitMs = hud.isMp && !hadVesselRef.current ? 1500 : 850
    const id = window.setTimeout(() => setNoVesselReady(true), waitMs)
    return () => window.clearTimeout(id)
  }, [hud.has, hud.isMp])
  const [isMap, setIsMap] = useState(false)
  const [showApproachWarn, setShowApproachWarn] = useState(false)
  const approachHideAt = useRef(0)
  const isCruising = hud.autopilotNote.startsWith('Hızlı yolculuk')
  const rawApproach =
    !hud.landed &&
    !isCruising &&
    ((Boolean(hud.approachWarn) && !hud.hasAutoLand) ||
      (hud.landable && hud.vr < -14 && hud.alt < 25000 && !hud.hasAutoLand && hud.autopilot !== 'orbit'))
  useEffect(() => {
    if (hud.landed || hud.hasAutoLand || hud.autopilot === 'orbit' || isCruising) {
      setShowApproachWarn(false)
      return
    }
    if (rawApproach) {
      const id = window.setTimeout(() => {
        approachHideAt.current = performance.now() + 1400
        setShowApproachWarn(true)
      }, 180)
      return () => window.clearTimeout(id)
    }
    const rem = Math.max(0, approachHideAt.current - performance.now())
    const id = window.setTimeout(() => setShowApproachWarn(false), Math.max(250, rem))
    return () => window.clearTimeout(id)
  }, [rawApproach, hud.landed, hud.hasAutoLand, hud.autopilot, isCruising])

  const [showLandAlert, setShowLandAlert] = useState(false)
  const landHideAt = useRef(0)
  const rawLandAlert = !isMap && !hud.landed && hud.landable && hud.alt < 1200 && hud.vr < -4.5 && !isCruising
  useEffect(() => {
    if (isMap || hud.landed || !hud.landable || hud.alt > 1350 || isCruising) {
      setShowLandAlert(false)
      return
    }
    if (rawLandAlert) {
      const id = window.setTimeout(() => {
        landHideAt.current = performance.now() + 1200
        setShowLandAlert(true)
      }, 150)
      return () => window.clearTimeout(id)
    }
    if (hud.vr > -2.5) {
      const rem = Math.max(0, landHideAt.current - performance.now())
      const id = window.setTimeout(() => setShowLandAlert(false), Math.max(250, rem))
      return () => window.clearTimeout(id)
    }
  }, [rawLandAlert, isMap, hud.landed, hud.landable, hud.alt, hud.vr, isCruising])
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([])
  const [lost, setLost] = useState<string | null>(null)
  const [spectating, setSpectating] = useState(false)
  const [wreck, setWreck] = useState(false)
  const [showCargo, setShowCargo] = useState(false)
  const [showDrone, setShowDrone] = useState(false)
  const [showFleet, setShowFleet] = useState(false)
  const [followPick, setFollowPick] = useState<number>(0)
  const [droneSite, setDroneSite] = useState<{ bodyId: BodyId; quadrant: QuadrantId } | null>(null)
  const [panel, setPanel] = useState<'missions' | 'base' | 'help' | 'chat' | 'health' | null>(null)
  const [inspectIdx, setInspectIdx] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ id: number; name: string } | null>(null)
  const [chatText, setChatText] = useState('')
  const setShowTech = (_open: boolean) => undefined
  const toastId = useRef(0)
  const lastMyVesselId = useRef<number | null>(null)
  const lastThrottleSentAt = useRef(0)
  const thDirty = useRef(false)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const mouseFire = useRef(false)
  const manualFire = useRef(false)
  const leftClickFireRef = useRef(true)
  const [leftClickFire, setLeftClickFire] = useState(true)
  const selectedWeaponRef = useRef<string | null>(null)
  const [selectedWeapon, setSelectedWeapon] = useState<string | null>(null)
  const chooseWeapon = useCallback((defId: string | null) => {
    selectedWeaponRef.current = defId
    setSelectedWeapon(defId)
  }, [])
  useEffect(() => {
    if (!hud.weapons.length) {
      if (selectedWeaponRef.current !== null) chooseWeapon(null)
      return
    }
    if (!selectedWeaponRef.current || !hud.weapons.some((w) => w.defId === selectedWeaponRef.current)) {
      chooseWeapon(hud.weapons[0]!.defId)
    }
  }, [hud.weapons, chooseWeapon])
  useEffect(() => {
  }, [hud.landed])
  useEffect(() => {
    if (hud.vesselId) lastMyVesselId.current = hud.vesselId
  }, [hud.vesselId])
  useEffect(() => {
    if (mp.inMatch) setHud(snapshot())
  }, [mp.inMatch, mp.version])
  useEffect(() => {
    audio.music(null)
  }, [])
  const spaceThrottle = useRef<{ vesselId: number; previousThrottle: number } | null>(null)

  const toast = useCallback((text: string, kind = 'info') => {
    const id = (toastId.current += 1)
    setToasts((t) => [...t.slice(-4), { id, text, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'mission' ? 7000 : 4200)
  }, [])

  const handle = useCallback((events: GameEvent[]) => {
    const curSim = getActiveSim()
    const isMp = Boolean(curSim.gs.mp)
    for (const e of events) {
      if (e.type === 'toast') toast(e.text)
      else if (e.type === 'mission') toast(`Görev tamamlandı: ${e.title}  +${fmt(e.reward)} ₡`, 'mission')
      else if (e.type === 'capture') toast(e.text, 'mission')
      else if (e.type === 'colonyDestroyed') toast(e.text, 'mission')
      else if (e.type === 'weaponFire') {
        const me = activeVessel(curSim.gs)
        let gain = 0.7
        if (me) {
          if (me.bodyId !== e.bodyId) gain = 0
          else {
            const d = Math.hypot(me.pos.x - e.x, me.pos.y - e.y)
            gain = d >= 3000 ? 0 : 1 / (1 + (d / 300) ** 2)
          }
        }
        if (gain > 0.03) audio.weapon(e.kind as WeaponKind, 0.5 * gain, e.pitch ?? 1)
      } else if (e.type === 'shieldHit') {
        const me = activeVessel(curSim.gs)
        let gain = 0.7
        if (me) {
          if (me.bodyId !== e.bodyId) gain = 0
          else {
            const d = Math.hypot(me.pos.x - e.x, me.pos.y - e.y)
            gain = d >= 3000 ? 0 : 1 / (1 + (d / 300) ** 2)
          }
        }
        if (gain > 0.04) audio.shieldHit(0.38 * gain)
      }
      else if (e.type === 'victory') toast(`🏆 ${e.winnerName} zaferi kazandı!`, 'mission')
      else if (e.type === 'soi') toast(`${BODIES[e.to].name} etki alanına girildi (${BODIES[e.from].name} → ${BODIES[e.to].name}).`)
      else if (e.type === 'explosion') {
        // Patlama sesi mesafeyle azalır: kendi geminden (yoksa kameranın baktığı yerden) uzaktaki
        // patlamalar kısık, 3 km'den ötesi ve başka gök cismindekiler hiç duyulmaz.
        let gain = 1
        if (e.bodyId !== undefined && e.x !== undefined && e.y !== undefined) {
          const me = activeVessel(curSim.gs)
          if (me) {
            if (me.bodyId !== e.bodyId) gain = 0
            else {
              const d = Math.hypot(me.pos.x - e.x, me.pos.y - e.y)
              gain = d >= 3000 ? 0 : 1 / (1 + (d / 250) ** 2)
            }
          } else if (isMp) gain = 0.25
        }
        const vol = Math.min(0.9, 0.35 + e.size * 0.05) * gain
        if (vol > 0.02) audio.sfx('explosion', vol)
      }
      else if (e.type === 'crash') {
        const isMine = isMp
          ? e.ownerId === curSim.gs.ownerId && (e.vesselId === lastMyVesselId.current || !curSim.gs.activeId)
          : e.wasActive
        if (isMine) {
          // Patlamalar görünsün diye kayıp ekranı biraz gecikir.
          setWreck(true)
          window.setTimeout(() => {
            audio.sfx('lose', 0.5)
            setWreck(false)
            setLost(`${e.name}: ${e.reason}.`)
          }, 3800)
        } else toast(`${e.name}: ${e.reason}.`, 'warn')
      }
    }
  }, [toast])

  useEffect(() => onMpEvents(handle), [handle])

  const toggleMap = useCallback(() => {
    const view = viewRef.current
    const curSim = getActiveSim()
    view.map = !view.map
    if (view.map) {
      const v = activeVessel(curSim.gs)
      view.mapFocus = v ? (v.bodyId === 'sun' ? 'ship' : v.bodyId) : 'earth'
      view.mapPan = { x: 0, y: 0 }
      const b = v ? BODIES[v.bodyId] : BODIES.earth
      const span = v ? Math.max(len(v.pos) * 1.6, b.radius * 2.5) : b.radius * 3
      const sunSpan = v ? Math.max(len(v.pos) * 1.4, BODIES.mars.orbit!.a * 1.2) : BODIES.mars.orbit!.a * 1.2
      view.mapZoom = Math.min(view.w, view.h) / 2 / (v?.bodyId === 'sun' ? sunSpan : span)
    }
    setIsMap(view.map)
  }, [])

  const hudCmd = useCallback((cmd: GameCommand) => {
    const res = runCommand(cmd)
    if (res.error) toast(res.error, 'warn')
    if (res.events.length) handle(res.events)
    setHud(snapshot())
    return res
  }, [handle, toast])

  const act = useCallback((fn: (v: Vessel) => GameEvent[] | string | null | void) => {
    const curSim = getActiveSim()
    const v = activeVessel(curSim.gs)
    if (!v) return
    const res = fn(v)
    if (typeof res === 'string') toast(res, 'warn')
    else if (Array.isArray(res)) handle(res)
    setHud(snapshot())
    if (!curSim.gs.mp) bump()
  }, [handle, toast])

  const switchTo = useCallback((id: number) => {
    viewRef.current.camPan = undefined
    const curSim = getActiveSim()
    if (curSim.gs.mp) {
      const target = curSim.gs.vessels.find((o) => o.id === id)
      if (!target || target.ownerId !== curSim.gs.ownerId) return
      runCommand({ type: 'setActive', vesselId: id })
    } else {
      setActive(sim, id)
    }
    lastMyVesselId.current = id
    const view = viewRef.current
    view.map = false
    view.zoom = 5
    setIsMap(false)
    setLost(null)
    setHud(snapshot())
  }, [])

  const toggleAutopilot = useCallback(
    (mode: 'orbit' | 'transfer' | 'land' | 'nextQuad' | 'follow', followTargetId?: number) => {
      const curSim = getActiveSim()
      const v = activeVessel(curSim.gs)
      if (!v) return
      const cur = effectiveAutopilot(v)
      const switchLeader = mode === 'follow' && followTargetId !== undefined && followTargetId !== v.followId
      const next: AutopilotMode = cur === mode && mode !== 'nextQuad' && !switchLeader ? 'off' : mode
      if (curSim.gs.mp) {
        const res = runCommand({ type: 'setAutopilot', vesselId: v.id, mode: next, ...(next === 'follow' ? { followId: followTargetId } : {}) })
        if (res.error) {
          toast(res.error, 'warn')
          return
        }
        v.autopilot = next
        v.autoLand = next === 'land'
        if (next === 'follow' && followTargetId !== undefined) v.followId = followTargetId
        if (next === 'off') {
          v.throttle = 0
          v.followId = undefined
        }
        const myTgt = (curSim.gs.mp.players[curSim.gs.ownerId ?? '']?.targetBody ?? curSim.gs.targetBody ?? 'moon') as BodyId
        const lidName = followTargetId ? (curSim.gs.vessels.find((o) => o.id === followTargetId)?.name ?? '') : ''
        const labels: Record<AutopilotMode, string> = {
          off: 'Otopilot kapatıldı.',
          orbit: '🛰️ Yörüngeye Yerleş otopilotu başlatıldı.',
          transfer: `🎯 Hızlı yolculuk → ${BODIES[myTgt].name}: uzaya çıkınca başlar, yakıtı yol kadar düşülür.`,
          land: '🛬 Otomatik İniş Asistanı devrede.',
          nextQuad: '🧭 Dron sonraki gezegen çeyreğine otonom yönlendirildi.',
          follow: `📡 ${lidName ? `${lidName} ` : ''}filo takibi başlatıldı.`,
        }
        toast(labels[next])
        setHud(snapshot())
        return
      }
      const err = setVesselAutopilot(sim, v, next, undefined, next === 'follow' ? followTargetId : undefined)
      if (err) {
        toast(err, 'warn')
        return
      }
      if (next === 'off') {
        v.throttle = 0
        v.followId = undefined
      }
      if (next === 'land') {
        sim.warpLockPrev = undefined
      }
      const lName = v.followId ? (sim.gs.vessels.find((o) => o.id === v.followId)?.name ?? '') : ''
      const labels: Record<AutopilotMode, string> = {
        off: 'Otopilot kapatıldı.',
        orbit: '🛰️ Yörüngeye Yerleş otopilotu başlatıldı.',
        transfer: `🎯 ${BODIES[(sim.gs.targetBody ?? 'moon') as BodyId].name} oto-transferi başlatıldı.`,
        land: '🛬 Otomatik İniş Asistanı devrede.',
        nextQuad: `🧭 Dron ${QUADRANT_SHORT[v.targetQuad ?? 0]} çeyreğine uçuyor.`,
        follow: `📡 ${lName ? `${lName} ` : ''}filo takibi başlatıldı.`,
      }
      toast(labels[next])
      setHud(snapshot())
      bump()
    },
    [toast],
  )

  const toggleAutoLand = useCallback(() => toggleAutopilot('land'), [toggleAutopilot])


  // klavye
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) e.preventDefault()
      if (e.repeat) return
      keys.current.add(k)
      const curSim = getActiveSim()
      const isMp = Boolean(curSim.gs.mp)
      const v = activeVessel(curSim.gs)
      if (k >= '1' && k <= '9') {
        const curV = activeVessel(curSim.gs)
        if (curV) {
          const allowGuns = !isMp || isWarfareMode(curSim.gs)
          const seen: string[] = []
          for (const p of curV.parts) {
            const pd = partDef(p.def)
            if (allowGuns && pd.weapon && !seen.includes(p.def)) seen.push(p.def)
          }
          const idx = Number(k) - 1
          if (seen[idx]) chooseWeapon(seen[idx]!)
        }
      } else if (k === 'h') {
        setPanel((p) => (p === 'health' ? null : 'health'))
      } else if (k === 'm') toggleMap()
      else if (k === '.' && !isMp) {
        sim.warpIdx = Math.min(WARPS.length - 1, sim.warpIdx + 1)
      } else if (k === ',' && !isMp) {
        {
          sim.warpIdx = Math.max(0, sim.warpIdx - 1)
          sim.apWarpPinned = true
        }
      } else if (!v) return
      else if (k === ' ') {
        if (!spaceThrottle.current) {
          spaceThrottle.current = { vesselId: v.id, previousThrottle: v.throttle }
          v.autoLand = false
          v.autopilot = 'off'
          v.followId = undefined
          v.throttle = 1
          if (isMp) runCommand({ type: 'setThrottle', vesselId: v.id, throttle: 1 })
        }
      } else if (k === 'z') {
        v.throttle = 1
        if (isMp) runCommand({ type: 'setThrottle', vesselId: v.id, throttle: 1 })
      } else if (k === 'x') {
        spaceThrottle.current = null
        v.throttle = 0
        v.autoLand = false
        v.autopilot = 'off'
        v.followId = undefined
        v.autopilotNote = undefined
        if (isMp) runCommand({ type: 'emergencyStop', vesselId: v.id })
      } else if (k === 'r') {
        if (isMp) hudCmd({ type: 'toggleRcs', vesselId: v.id })
        else {
          v.rcsOn = !v.rcsOn
        }
      } else if (k === 't') {
        const order: SasMode[] = ['off', 'prograde', 'retrograde', 'radial']
        const nextSas = order[(order.indexOf(v.sas) + 1) % 4]!
        v.sas = nextSas
        if (isMp) runCommand({ type: 'setSas', vesselId: v.id, sas: nextSas })
      } else if (k === 'p') {
        if (isMp) hudCmd({ type: 'togglePartKind', vesselId: v.id, kind: 'chute' })
        else { const o = toggleKind(v, 'chute'); if (o !== null) toast(`Paraşütler ${o ? 'açıldı' : 'kapandı'}`) }
      } else if (k === 'g') {
        if (isMp) hudCmd({ type: 'togglePartKind', vesselId: v.id, kind: 'leg' })
        else { const o = toggleKind(v, 'leg'); if (o !== null) toast(`İniş ayakları ${o ? 'açıldı' : 'kapandı'}`) }
      } else if (k === 'o') {
        if (isMp) hudCmd({ type: 'togglePartKind', vesselId: v.id, kind: 'solar' })
        else { const o = toggleKind(v, 'solar'); if (o !== null) toast(`Güneş panelleri ${o ? 'açıldı' : 'kapandı'}`) }
      } else if (k === 'l' && !v.rcsOn) toggleAutoLand()
      else if (k === 'Tab') {
        const list = isMp
          ? curSim.gs.vessels.filter((o) => o.ownerId === curSim.gs.ownerId && !o.debris && !o.station && !o.outpost)
          : curSim.gs.vessels
        if (list.length > 1) switchTo(list[(list.findIndex((o) => o.id === v.id) + 1) % list.length]!.id)
      }
    }
    const releaseSpace = () => {
      const pulse = spaceThrottle.current
      if (!pulse) return
      const curSim = getActiveSim()
      const vessel = curSim.gs.vessels.find((ship) => ship.id === pulse.vesselId)
      if (vessel) vessel.throttle = pulse.previousThrottle
      if (curSim.gs.mp) runCommand({ type: 'setThrottle', vesselId: pulse.vesselId, throttle: pulse.previousThrottle })
      spaceThrottle.current = null
    }
    const up = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      keys.current.delete(key)
      if (key === ' ') releaseSpace()
    }
    const blur = () => {
      keys.current.clear()
      mouseFire.current = false
      manualFire.current = false
      releaseSpace()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [chooseWeapon, handle, hudCmd, switchTo, toast, toggleAutoLand, toggleMap])

  // ana döngü
  useEffect(() => {
    const cv = canvasRef.current!
    const ctx = cv.getContext('2d')!
    const view = viewRef.current
    let raf = 0
    let last = performance.now()
    let n = 0
    let lastSave = last
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      view.w = window.innerWidth
      view.h = window.innerHeight
      cv.width = view.w * dpr
      cv.height = view.h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      n += 1
      view.clock += dt
      const k = keys.current
      const curSim = getActiveSim()
      const isMp = Boolean(curSim.gs.mp)
      const v = activeVessel(curSim.gs)
      if (v) lastMyVesselId.current = v.id
      const ptr = pointerRef.current
      const aimInfo = !view.map && v && ptr ? aimInfoFromScreen(flightFrame.current, v, ptr.x, ptr.y) : undefined
      view.aimScreen = !view.map && ptr ? ptr : undefined
      let activeWeaponKey = selectedWeaponRef.current ?? undefined
      if (v) {
        const allowGuns = !isMp || isWarfareMode(curSim.gs)
        const wParts = v.parts.filter((p) => {
          const pd = partDef(p.def)
          return allowGuns && !!pd.weapon
        })
        if (!activeWeaponKey || !wParts.some((p) => p.def === activeWeaponKey)) {
          activeWeaponKey = wParts[0]?.def
        }
      }
      view.selectedWeapon = activeWeaponKey
      const wantFire = !view.map && (k.has('f') || mouseFire.current || manualFire.current)
      if (wantFire && v && activeWeaponKey) {
        const chPart = v.parts.find((p) => p.def === activeWeaponKey && (p.charge ?? 0) > 0.05 && (p.charge ?? 0) < 0.99 && !p.beamUntil)
        if (chPart && partDef(activeWeaponKey).weapon?.chargeTime) {
          audio.chargeHum(chPart.charge ?? 0, activeWeaponKey === 'gun-beam')
        }
      }
      const ctrl: Controls = {
        rotate: (k.has('d') || k.has('ArrowRight') ? 1 : 0) - (k.has('a') || k.has('ArrowLeft') ? 1 : 0),
        tx: (k.has('l') ? 1 : 0) - (k.has('j') ? 1 : 0),
        ty: (k.has('i') ? 1 : 0) - (k.has('k') ? 1 : 0),
        fire: wantFire,
        weaponKey: activeWeaponKey,
        aimAngle: aimInfo?.angle,
        aimDist: aimInfo?.dist,
      }
      if (v) {
        let thChanged = false
        if (k.has('w') || k.has('ArrowUp') || k.has('Shift')) {
          v.autoLand = false
          v.autopilot = 'off'
          v.followId = undefined
          v.autopilotNote = undefined
          v.throttle = Math.min(1, v.throttle + dt * 0.8)
          thChanged = true
        }
        if (k.has('s') || k.has('ArrowDown') || k.has('Control')) {
          v.autoLand = false
          v.autopilot = 'off'
          v.followId = undefined
          v.autopilotNote = undefined
          v.throttle = Math.max(0, v.throttle - dt * 0.8)
          thChanged = true
        }
        if (isMp && thChanged && (now - lastThrottleSentAt.current >= 60 || v.throttle === 0 || v.throttle === 1)) {
          lastThrottleSentAt.current = now
          thDirty.current = false
          runCommand({ type: 'setThrottle', vesselId: v.id, throttle: v.throttle })
        } else if (isMp && thChanged) thDirty.current = true
        else if (isMp && thDirty.current) {
          // Tuş bırakıldı: son gaz değeri mutlaka ev sahibine gider (yoksa gaz geri sıçrar).
          thDirty.current = false
          lastThrottleSentAt.current = now
          runCommand({ type: 'setThrottle', vesselId: v.id, throttle: v.throttle })
        }
      }
      for (const ship of curSim.gs.vessels) {
        for (const part of ship.parts) {
          if (partDef(part.def).kind !== 'leg') continue
          const target = part.deployed ? 1 : 0
          if (part.deployProgress === undefined) part.deployProgress = target
          else part.deployProgress += Math.sign(target - part.deployProgress) * Math.min(Math.abs(target - part.deployProgress), dt * 2.2)
        }
      }
      view.rcsTx = v?.rcsOn ? ctrl.tx : 0
      if (isMp) {
        sendMpControls(ctrl)
      } else {
        const events = stepWorld(sim, dt, ctrl)
        if (events.length) handle(events)
      }
      {
        const av = activeVessel(curSim.gs)
        audio.rocket(av && (curSim.firing.get(av.id)?.size ?? 0) > 0 ? av.throttle : 0)
      }
      const cur = activeVessel(curSim.gs)
      if (n % 3 === 0) patchesRef.current = cur && !cur.landed && !cur.cruise ? predictTrajectory(cur.bodyId, cur.pos, cur.vel, curSim.gs.time) : []
      if (view.map) mapFrame.current = renderMap(ctx, curSim, view, patchesRef.current)
      else flightFrame.current = renderFlight(ctx, curSim, view, patchesRef.current)
      if (n % 6 === 0) setHud(snapshot())
      if (!isMp && now - lastSave > 4000) {
        lastSave = now
        void saveGame()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      audio.rocket(0)
      window.removeEventListener('resize', resize)
      if (!getActiveSim().gs.mp) {
        void saveGame(true)
        bump()
      }
    }
  }, [handle])

  // fare
  const drag = useRef<{ x: number; y: number; moved: boolean; button: number } | null>(null)
  const onWheel = (e: React.WheelEvent) => {
    const view = viewRef.current
    const f = Math.exp(-e.deltaY * 0.0012)
    if (view.map) view.mapZoom = Math.max(3e-9, Math.min(0.02, view.mapZoom * f))
    else view.zoom = Math.max(0.00012, Math.min(26, view.zoom * f))
  }
  const hasArmedVessel = () => {
    const s = getActiveSim()
    const cur = activeVessel(s.gs)
    if (!cur || cur.drone) return false
    const st = vesselStats(cur.parts)
    const allowGuns = !s.gs.mp || isWarfareMode(s.gs)
    return allowGuns && st.weaponCount > 0
  }
  const onDown = (e: React.MouseEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY }
    const armed = !viewRef.current.map && hasArmedVessel()
    const useLeftFire = armed && leftClickFireRef.current
    if (e.button === 0 && useLeftFire) {
      mouseFire.current = true
      return
    }
    if (e.button === 2 && !viewRef.current.map && !useLeftFire) {
      mouseFire.current = true
      return
    }
    if (e.button === 0 || (e.button === 2 && useLeftFire) || e.button === 1) {
      drag.current = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
    }
  }
  const onMove = (e: React.MouseEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY }
    const d = drag.current
    const view = viewRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) {
      if (view.map) view.mapPan = { x: view.mapPan.x - dx / view.mapZoom, y: view.mapPan.y + dy / view.mapZoom }
      else {
        // Uçuş kamerası: sürükleyerek kaydır (roket ekranda kalır)
        const cur = view.camPan ?? { x: 0, y: 0 }
        view.camPan = clampCamPan(view, { x: cur.x + dx, y: cur.y + dy })
      }
      d.x = e.clientX
      d.y = e.clientY
    }
  }
  const onUp = (e: React.MouseEvent) => {
    const armed = !viewRef.current.map && hasArmedVessel()
    const useLeftFire = armed && leftClickFireRef.current
    if ((e.button === 0 && useLeftFire) || (e.button === 2 && !useLeftFire)) {
      mouseFire.current = false
      return
    }
    const d = drag.current
    drag.current = null
    if (!d || d.moved || d.button !== 0) return
    const view = viewRef.current
    const curSim = getActiveSim()
    const x = e.clientX
    const y = e.clientY
    if (view.map) {
      const hitV = mapFrame.current.vessels.find((o) => Math.hypot(o.x - x, o.y - y) < 16)
      if (hitV) {
        if (hitV.id !== curSim.gs.activeId) switchTo(hitV.id)
        return
      }
      const hitB = [...mapFrame.current.bodies].reverse().find((b) => Math.hypot(b.x - x, b.y - y) < Math.max(b.r, 12))
      if (hitB) {
        view.mapFocus = hitB.id
        view.mapPan = { x: 0, y: 0 }
      }
      return
    }
    const other = pickVesselFlight(flightFrame.current, curSim, x, y)
    if (other !== null) {
      switchTo(other)
      return
    }
    const v = activeVessel(curSim.gs)
    if (v) {
      const i = pickPart(flightFrame.current, v, x, y)
      if (i >= 0) {
        if (curSim.gs.mp) hudCmd({ type: 'clickPart', vesselId: v.id, index: i })
        else handle(clickPart(sim, v, i))
      }
    }
  }

  const curSim = getActiveSim()
  const baseBody = BODIES[hud.body]
  const pct = (a: number, b: number) => `${b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0}%`

  const focusMapOn = (target: BodyId | 'ship') => {
    const view = viewRef.current
    if (!view.map) return
    const s = getActiveSim()
    view.mapFocus = target
    view.mapPan = { x: 0, y: 0 }
    if (target === 'ship') {
      const cur = activeVessel(s.gs)
      if (cur) view.mapZoom = Math.min(view.w, view.h) / 2 / Math.max(len(cur.pos) * 1.8, BODIES[cur.bodyId].radius * 2.8)
    } else {
      const b = BODIES[target]
      view.mapZoom = Math.min(view.w, view.h) / 2 / Math.max(b.soi * 1.4, b.radius * 4)
    }
  }

  const quickLaunch = () => {
    const s = getActiveSim()
    if (s.gs.mp) {
      const local = getLocalMpDesign()
      const sites = availableLaunchSites(s.gs, s.gs.ownerId ?? 'local')
      const ls = s.gs.launchSite
      const site = (ls && sites.find((o) => o.bodyId === ls.bodyId && o.quadrant === ls.quadrant)) ?? sites[0]!
      const qBase = getActorBase(s.gs, site.bodyId, s.gs.ownerId ?? 'local', site.quadrant)
      const padTheta =
        site.bodyId === 'earth' && site.quadrant === 0
          ? playerPadAngle(s.gs, s.gs.ownerId)
          : qBase?.siteAngle ?? quadrantCenterAngle(site.quadrant)
      const onPad = s.gs.vessels.find(
        (o) => o.bodyId === site.bodyId && o.landed && Math.abs(wrapPi(Math.atan2(o.pos.y, o.pos.x) - padTheta)) * BODIES[site.bodyId].radius < 25,
      )
      if (onPad && !s.gs.mp.config.mode?.includes('loot')) {
        toast('Rampa dolu: önce rampadaki aracı kurtar veya sil.', 'warn')
        return
      }
      const res = runCommand({ type: 'launch', design: local.design, designCargo: local.cargo, designDroneCargo: local.droneCargo, bodyId: site.bodyId, quadrant: site.quadrant })
      if (res.error) {
        toast(res.error, 'warn')
        return
      }
      setLost(null)
      viewRef.current.map = false
      setIsMap(false)
      setHud(snapshot())
      return
    }
    const err = launchDesign(sim)
    if (err) {
      toast(err, 'warn')
      return
    }
    setLost(null)
    viewRef.current.map = false
    setIsMap(false)
    void saveGame(true)
    setHud(snapshot())
    bump()
  }

  const setThrottleFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const next = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    const s = getActiveSim()
    const v = activeVessel(s.gs)
    if (!v) return
    v.autoLand = false
    v.autopilot = 'off'
    v.followId = undefined
    v.autopilotNote = undefined
    v.throttle = next
    if (s.gs.mp) {
      const now = performance.now()
      if (now - lastThrottleSentAt.current >= 60 || next === 0 || next === 1) {
        lastThrottleSentAt.current = now
        runCommand({ type: 'setThrottle', vesselId: v.id, throttle: next })
      }
    } else {
      bump()
    }
    setHud(snapshot())
  }

  return (
    <main className="flight">
      <canvas
        ref={canvasRef}
        className="flight-canvas"
        title={hud.weapons.length > 0 && leftClickFire ? 'Sol tık basılı: ateş · Sağ sürükle: kamera · Çift tık: ortala' : 'Sol sürükle: kamera · Sağ tık veya F: ateş · Çift tık: ortala'}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => (viewRef.current.camPan = undefined)}
        onMouseLeave={() => {
          drag.current = null
          mouseFire.current = false
        }}
      />

      <div className="hud hud-tl">
        <button className="hud-btn" onClick={onBuilder}>☰ Montaj</button>
        <button className={`hud-btn${isMap ? ' is-on' : ''}`} onClick={toggleMap}>{isMap ? 'Uçuş (M)' : 'Harita (M)'}</button>
        {!hud.isMp ? (
          <button className="hud-btn" onClick={() => setPanel(panel === 'missions' ? null : 'missions')}>🎯 Görevler</button>
        ) : (
          <button className={`hud-btn${panel === 'chat' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}>
            💬 Sohbet{mp.chat.length ? ` (${mp.chat.length})` : ''}
          </button>
        )}
        <button className={`hud-btn${panel === 'base' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'base' ? null : 'base')}>
          {hud.loot ? `🏰 Üs (${hud.loot.level}/${OUTPOST_MAX_LEVEL})` : '🏗️ Koloni'}
        </button>
        {!hud.loot && (
          <button
            className={`hud-btn${showDrone ? ' is-on' : hud.droneBayReady || hud.liveDroneCount > 0 ? ' has-ready' : ''}`}
            title="Dron yükle, rampadan veya roketten fırlat ve otonom çeyrek uçuşunu yönet"
            onClick={() => {
              setDroneSite(null)
              setShowCargo(false)
              setShowFleet(false)
              setShowDrone((x) => !x)
            }}
          >
            🛸 Dron{hud.liveDroneCount > 0 ? ` (${hud.liveDroneCount})` : hud.droneBayReady ? ' · Hazır' : ''}
          </button>
        )}
        <button
          className={`hud-btn${showFleet ? ' is-on' : hud.followerCount > 0 || hud.followId ? ' has-ready' : ''}`}
          title="Filo penceresi: gemileri birbirini takip ettir ve filoyu tek yerden yönet"
          onClick={() => {
            setShowDrone(false)
            setShowCargo(false)
            setShowFleet((x) => !x)
          }}
        >
          🚢 Filo{hud.followerCount > 0 ? ` (${hud.followerCount})` : hud.followName ? ` · Takip` : ''}
        </button>
        {hud.has && (
          <button
            className={`hud-btn${panel === 'health' ? ' is-on' : ''}`}
            title="Roket parça canı ve silah sistemleri (H)"
            onClick={() => setPanel(panel === 'health' ? null : 'health')}
          >
            ❤️ Gemi (%{hud.maxHp > 0 ? Math.round((hud.hp / hud.maxHp) * 100) : 100})
          </button>
        )}
        <button className="hud-btn" onClick={() => setPanel(panel === 'help' ? null : 'help')}>?</button>
        <span className="hud-money" title="Dakikalık toplam pasif gelir (zaman hızlandırmada gelir en fazla 5× artar)">
          {fmt(hud.money)} ₡ <small className="income-sub">+{fmt(hud.passivePerMin)}/dk</small>
        </span>
        {!hud.isMp && (
          <button className="hud-btn" title="Geçici test kredisi" onClick={() => { sim.gs.money += 100_000; setHud(snapshot()); bump(); void saveGame(true) }}>+100.000 ₡</button>
        )}
        {hud.isMp ? (
          <>
            <span className="hud-user" style={{ color: mp.you?.color }}>● {mp.you?.username ?? hud.myId}</span>
            <button
              className="hud-btn danger"
              onClick={() => {
                if (window.confirm('Çok oyunculu maçtan ayrılmak istiyor musun?')) {
                  resetViewCache()
                  leaveMpRoom(false)
                }
              }}
            >
              🚪 Lobiye Dön
            </button>
          </>
        ) : (
          auth.user && <span className="hud-user">👤 {auth.user.username}</span>
        )}
      </div>

      {hud.isMp && (
        <div className="mp-top-strip">
          {hud.loot && (
            <div className="mp-warfare-strip">
              <span className="mp-war-pill">🏴‍☠️ YAĞMA</span>
              <span className={`mp-war-pill is-loot${hud.loot.cargoCap > 0 && hud.loot.cargo >= hud.loot.cargoCap - 0.01 ? ' is-full' : ''}`} title="Kargodaki ganimet: üssüne götürünce paraya çevrilir">
                📦 {hud.loot.cargo.toFixed(1)} / {hud.loot.cargoCap} t
              </span>
              {hud.loot.homeDist !== null ? (
                <span className={`mp-war-pill is-loot${hud.loot.nearHome ? ' is-full' : ''}`}>
                  {hud.loot.nearHome ? '🔧 Üste: ikmal ve onarım' : `🏠 Üs ${km(hud.loot.homeDist)}`}
                </span>
              ) : hud.loot.rebuildIn !== null ? (
                <span className="mp-war-pill is-elim">🛠️ Üs yeniden kuruluyor: {Math.ceil(hud.loot.rebuildIn)} sn</span>
              ) : null}
              {hud.loot.site && !hud.loot.nearHome && (
                <span className="mp-war-pill is-loot">🧭 {hud.loot.site.name} {km(hud.loot.site.dist)} · {hud.loot.site.crates} sandık</span>
              )}
              {hud.loot.outside && <span className="mp-war-pill is-elim">⚠ Arena dışı — geri dön!</span>}
              {hud.empStunned && <span className="mp-war-pill is-emp">⚡ EMP ŞOKU!</span>}
              {hud.burning && <span className="mp-war-pill is-emp">🔥 PLAZMA YANIĞI!</span>}
              {hud.loot.cargo > 0.05 && !hud.loot.nearHome && hud.vesselId !== null && (
                <button type="button" className="hud-btn" title="Kargodaki ganimeti uzaya bırak" onClick={() => hudCmd({ type: 'jettisonCargo', vesselId: hud.vesselId! })}>
                  Kargoyu bırak
                </button>
              )}
              {hud.loot.upgradeCost !== null && (
                <button
                  type="button"
                  className="hud-btn"
                  disabled={hud.money < hud.loot.upgradeCost}
                  title="Üssüne taret, kalkan ve zırh ekler"
                  onClick={() => hudCmd({ type: 'upgradeOutpost' })}
                >
                  ⬆️ Üs Sv.{hud.loot.level + 1} — {hud.loot.upgradeCost.toLocaleString('tr-TR')} ₡
                </button>
              )}
              <button
                type="button"
                className="hud-btn"
                title="Detaylı Uzay Üssü yükseltme penceresini aç"
                onClick={() => setPanel(panel === 'base' ? null : 'base')}
              >
                🛠️ Üs Geliştir (Sv.{hud.loot.level}/{OUTPOST_MAX_LEVEL})
              </button>
            </div>
          )}
          {!hud.loot && (
          <div className="mp-conquest-bar" title="Hedef seçmek için gezegene tıkla">
            {CONQUERABLE_BODIES.map((bid) => {
              const cap = hud.isWarfare ? undefined : hud.mpCaptures[bid]
              const owner = cap?.ownerId ? hud.mpPlayers.find((p) => p.id === cap.ownerId) : null
              const capturer = cap?.capturerId ? hud.mpPlayers.find((p) => p.id === cap.capturerId) : null
              const col = owner?.color ?? capturer?.color
              const qCaps = hud.mpQuadCaptures[bid]
              const qOwned = !hud.isWarfare && qCaps ? qCaps.filter((c) => c?.ownerId).length : 0
              return (
                <button
                  key={bid}
                  type="button"
                  className={`mp-planet-pill${hud.targetBody === bid ? ' is-target' : ''}${cap?.phase === 'contested' ? ' is-contested' : ''}`}
                  style={col ? { borderColor: col } : undefined}
                  onClick={() => {
                    hudCmd({ type: 'setTarget', bodyId: bid })
                    if (isMap) focusMapOn(bid)
                  }}
                >
                  <i className="mp-dot" style={{ background: col ?? '#64748b' }} />
                  <span>{BODIES[bid].name}</span>
                  {qOwned > 0 && <small className="q-count">{qOwned}/4</small>}
                  {cap?.phase === 'contested' ? (
                    <small style={{ color: '#fbbf24' }}>⇄</small>
                  ) : cap?.phase === 'neutralizing' ? (
                    <small style={{ color: col }}>{Math.round(cap.progress * 100)}%</small>
                  ) : cap?.phase === 'claiming' ? (
                    <small style={{ color: col }}>📍</small>
                  ) : owner ? (
                    <small style={{ color: owner.color }}>🛰️</small>
                  ) : null}
                </button>
              )
            })}
          </div>
          )}
          {hud.isWarfare && !hud.loot && (
            <div className="mp-warfare-strip">
              <span className="mp-war-pill">⚔️ UZAY SAVAŞI</span>
              {hud.mpEliminated && <span className="mp-war-pill is-elim">💀 Üssün yıkıldı — izleyici modundasın</span>}
              {hud.empStunned && <span className="mp-war-pill is-emp">⚡ EMP ŞOKU!</span>}
              {hud.burning && <span className="mp-war-pill is-emp">🔥 PLAZMA YANIĞI!</span>}
              {hud.mpNearestEnemyColony && hud.mpNearestEnemyColony.dist < 60_000 && (
                <span className="mp-rival-alert" style={{ borderColor: hud.mpNearestEnemyColony.color }}>
                  🏰 Düşman üssü (<b style={{ color: hud.mpNearestEnemyColony.color }}>{hud.mpNearestEnemyColony.username}</b>): {km(hud.mpNearestEnemyColony.dist)}
                </span>
              )}
            </div>
          )}
          {!hud.isWarfare && (() => {
            const qCap = hud.mpQuadCaptures[hud.body]?.[hud.quadrant] ?? hud.mpCaptures[hud.body]
            if (!qCap || (qCap.phase !== 'claiming' && qCap.phase !== 'neutralizing' && qCap.phase !== 'contested')) return null
            return (
              <div className="mp-capture-banner">
                {qCap.phase === 'contested' ? (
                  <span>⇄ <b>{BODIES[hud.body].name} · {QUADRANT_SHORT[hud.quadrant]}</b> çeyreğinde birden fazla oyuncu var — ilk çalışan Uzay İstasyonunu kuran alır.</span>
                ) : qCap.phase === 'claiming' ? (
                  <span>
                    📍 <b>{BODIES[hud.body].name} · {QUADRANT_SHORT[hud.quadrant]}</b> kontrolü — kolonileştirmek için kargodan <b>Uzay İstasyonu + 5 ⚡</b> kur!
                  </span>
                ) : (
                  <>
                    <span>
                      🛰️ <b>{BODIES[hud.body].name} · {QUADRANT_SHORT[hud.quadrant]}</b> el değiştiriyor…{' '}
                      {Math.round(qCap.progress * 100)}%
                    </span>
                    <div className="mp-cap-bar">
                      <em
                        style={{
                          width: `${Math.round(qCap.progress * 100)}%`,
                          background:
                            hud.mpPlayers.find((p) => p.id === (qCap.capturerId ?? qCap.ownerId))?.color ??
                            '#38d9e8',
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })()}
          {hud.mpNearestRival && hud.mpNearestRival.dist < 25_000 && (
            <div className="mp-rival-alert" style={{ borderColor: hud.mpNearestRival.color }}>
              🛰️ Yakındaki oyuncu: <b style={{ color: hud.mpNearestRival.color }}>{hud.mpNearestRival.username}</b> · {km(hud.mpNearestRival.dist)}
            </div>
          )}
        </div>
      )}

      <div className="hud hud-tr">
        {!hud.isMp ? (
          <div className="warp" title="Zaman hızlandırma (, / .) — pasif gelir en fazla 5× hızlanır">
            {QUICK_WARPS.map((w) => (
              <button
                key={w.label}
                className={`mini-warp-btn${hud.warpIdx === w.idx ? ' is-on' : ''}`}
                onClick={() => {
                  if (w.idx < sim.warpIdx) sim.apWarpPinned = true
                  sim.warpIdx = w.idx
                  setHud(snapshot())
                }}
              >
                {w.label}
              </button>
            ))}
            <button className="hud-btn" onClick={() => { sim.warpIdx = Math.max(0, sim.warpIdx - 1); sim.apWarpPinned = true; setHud(snapshot()) }} aria-label="Yavaşlat">◀◀</button>
            <b>{hud.warp.toLocaleString('tr-TR')}×</b>
            <button className="hud-btn" onClick={() => { sim.warpIdx = Math.min(WARPS.length - 1, sim.warpIdx + 1); setHud(snapshot()) }} aria-label="Hızlandır">▶▶</button>
          </div>
        ) : (
          <div className="mp-warp-card">
            <div className="mp-warp-meta">
              {mp.pingMs !== null && (
                <span className={`mp-ping-pill ${mp.pingMs < 60 ? 'is-good' : mp.pingMs < 140 ? 'is-mid' : 'is-bad'}`}>
                  📶 {mp.pingMs} ms
                </span>
              )}
            </div>
          </div>
        )}
        <div className="readout">
          <span>{hud.date}</span>
          {hud.has && (
            <>
              <span className="big">{BODIES[hud.body].name} · {QUADRANT_SHORT[hud.quadrant]}</span>
              <span>Yükseklik</span><b className={hud.droneWarn ? 'warn' : ''}>{hud.isDrone && hud.droneMaxAlt ? `${km(hud.alt)} / ${km(hud.droneMaxAlt)}` : km(hud.alt)}</b>
              <span>Hız</span><b>{hud.speed.toFixed(1)} m/s</b>
              <span>Dikey</span><b className={hud.vr < -hud.tol && hud.alt < 2000 ? 'bad' : ''}>{hud.vr.toFixed(1)} m/s</b>
              {hud.apo !== null && <><span>Öte nokta</span><b>{km(hud.apo)}</b></>}
              {hud.peri !== null && <><span>Enberi</span><b className={hud.peri < 0 ? 'warn' : ''}>{km(hud.peri)}</b></>}
              <span>Kalan Δv</span><b>{fmt(hud.dv)} m/s</b>
              <span>TWR</span><b className={hud.twr >= 1.2 ? 'ok' : hud.twr >= 1 ? 'warn' : hud.landed ? 'bad' : ''}>{hud.twr.toFixed(2)}</b>
              {hud.issDist !== null && <><span>ISS</span><b>{km(hud.issDist)} · {hud.issRel.toFixed(0)} m/s</b></>}
            </>
          )}
        </div>
        {!hud.isMp ? (
          <div className="next-mission">Sıradaki görev: <b>{hud.missionNext}</b></div>
        ) : hud.loot ? (
          <div className="mp-scoreboard">
            <div className="mp-score-head">
              <span>🏴‍☠️ Yağma ({hud.loot.goal === 0 ? 'Sonsuz' : `Hedef ${hud.loot.goal} t`})</span>
            </div>
            {hud.mpPlayers.map((p) => (
              <div key={p.id} className={`mp-score-row${p.id === hud.myId ? ' is-me' : ''}`}>
                <i className="mp-dot" style={{ background: p.color }} />
                <span className="mp-s-name">{p.username}</span>
                <span className="mp-s-flags" title="Taşınan ganimet · Üs seviyesi · İmha">
                  📦 {(p.looted ?? 0).toFixed(1)} t · 🏠{p.outpostLevel ?? 1} · 💀{p.kills}
                </span>
              </div>
            ))}
            {hud.mpFeed.length > 0 && (
              <div className="mp-feed">
                {hud.mpFeed.slice(-3).reverse().map((item) => (
                  <div key={item.id} className="mp-feed-line" style={item.color ? { borderLeftColor: item.color } : undefined}>
                    {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : hud.isWarfare ? (
          <div className="mp-scoreboard">
            <div className="mp-score-head">
              <span>
                ⚔️ Savaş ({hud.warfareGoal === 'siege' ? 'Son Sağ Kalan' : hud.warfareGoal === 'score15' ? '15 Puan' : hud.warfareGoal === 'score30' ? '30 Puan' : 'Sonsuz'})
              </span>
            </div>
            {hud.mpPlayers.map((p) => {
              const colCount = (['earth', 'moon', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan'] as BodyId[])
                .reduce((acc, bid) => acc + getPlayerQuadrantColonies(p, bid).filter((c) => !c.base.destroyed).length, 0)
              return (
                <div key={p.id} className={`mp-score-row${p.id === hud.myId ? ' is-me' : ''}${p.eliminated ? ' is-elim' : ''}`}>
                  <i className="mp-dot" style={{ background: p.color }} />
                  <span className="mp-s-name">{p.username}</span>
                  <span className="mp-s-flags" title="Puan · Kalan Koloni · İmha">
                    {p.score ?? 0}p · 🏰{colCount} · 💀{p.kills}
                  </span>
                </div>
              )
            })}
            {hud.mpFeed.length > 0 && (
              <div className="mp-feed">
                {hud.mpFeed.slice(-3).reverse().map((item) => (
                  <div key={item.id} className="mp-feed-line" style={item.color ? { borderLeftColor: item.color } : undefined}>
                    {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mp-scoreboard">
            <div className="mp-score-head">
              <span>🏆 Liderlik ({hud.mpTargetPlanets === 0 ? 'Sonsuz' : `Hedef ${hud.mpTargetPlanets} 🚩`})</span>
            </div>
            {hud.mpPlayers.map((p) => (
              <div key={p.id} className={`mp-score-row${p.id === hud.myId ? ' is-me' : ''}`}>
                <i className="mp-dot" style={{ background: p.color }} />
                <span className="mp-s-name">{p.username}</span>
                <span className="mp-s-flags">🚩 {p.planetsHeld}</span>
              </div>
            ))}
            {hud.mpFeed.length > 0 && (
              <div className="mp-feed">
                {hud.mpFeed.slice(-3).reverse().map((item) => (
                  <div key={item.id} className="mp-feed-line" style={item.color ? { borderLeftColor: item.color } : undefined}>
                    {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {hud.has && (
        <>
          <div className="hud hud-bl">
            {(hud.isWarfare || hud.weaponCount > 0 || hud.shieldCap > 0) && (
              <>
                <div
                  className="gauge hull is-clickable"
                  role="button"
                  tabIndex={0}
                  title="Tıkla: Parça bazlı Gemi Sağlığı ekranını aç (H)"
                  onClick={() => setPanel(panel === 'health' ? null : 'health')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPanel(panel === 'health' ? null : 'health') }}
                >
                  <span>❤️ Gövde</span><i><em style={{ width: pct(hud.hp, hud.maxHp) }} /></i><small>{Math.round(hud.hp)}/{hud.maxHp}</small>
                </div>
                {hud.shieldCap > 0 && (
                  <div className="gauge shield"><span>Kalkan</span><i><em style={{ width: pct(hud.shield, hud.shieldCap) }} /></i><small>{Math.round(hud.shield)}/{hud.shieldCap}</small></div>
                )}
              </>
            )}
            {!hud.isDrone ? (
              <>
                <div className="gauge"><span>Kademe yakıtı</span><i><em style={{ width: pct(hud.stageFuel, hud.stageCap) }} /></i><small>{hud.stageFuel.toFixed(1)} t</small></div>
                <div className="gauge"><span>Toplam yakıt</span><i><em style={{ width: pct(hud.fuel, hud.fuelCap) }} /></i><small>{hud.fuel.toFixed(1)} t</small></div>
              </>
            ) : (
              <div className="gauge"><span>🌬️ Fan İtkisi</span><i><em style={{ width: `${Math.round(hud.throttle * 100)}%` }} /></i><small>{Math.round(hud.throttle * 100)}%</small></div>
            )}
            <div className="gauge ec"><span>{hud.isDrone ? '🔋 Fan Gücü' : 'Elektrik'}</span><i><em style={{ width: pct(hud.ec, hud.ecCap) }} /></i><small>{hud.ec.toFixed(0)}</small></div>
            {hud.cargo && <div className="cargo-line"><b>Kargo</b> {hud.cargo}</div>}
            <div className="vessel-list">
              {hud.vessels.map((o) => (
                <div key={o.id} className="vessel-row">
                  <button className={o.active ? 'is-on' : ''} onClick={() => switchTo(o.id)}>
                    {o.followers > 0 ? '👑 ' : o.followId ? '📡 ' : ''}{o.name}
                    <small>{o.body}{o.followers > 0 ? ` · ${o.followers} filo` : ''}</small>
                  </button>
                  {o.name !== 'ISS' && <button className="vessel-del" title="Aracı sil" aria-label="Aracı sil" onClick={() => setConfirmDel({ id: o.id, name: o.name })}>🗑</button>}
                </div>
              ))}
            </div>
          </div>

          <div className="hud hud-bc">
            {/* Bildirimler alt paneldeki diğer yazıların üstünde sıralanır; üst üste binmez. */}
            {toasts.length > 0 && (
              <div className="toasts in-stack">
                {toasts.slice(-3).map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
              </div>
            )}
            {hud.isDrone && hud.droneWarn && (
              <div className="drone-limit-banner" role="alert">
                ⚠ DRON UZAY SINIRI UYARISI — Hemen alçal, aşarsan dron parçalanır!
              </div>
            )}
            {hud.weapons.length > 0 && (
              <div className="weapon-rack ftl-rack" role="group" aria-label="Silah ve Dron Paneli">
                {hud.weapons.map((w, idx) => {
                  const sel = selectedWeapon === w.defId || (!selectedWeapon && idx === 0)
                  const empty = w.ammo !== null && w.ammo <= 0
                  const fillPct = w.beaming
                    ? 100
                    : w.charge > 0
                      ? Math.round(w.charge * 100)
                      : w.cdRem > 0
                        ? Math.max(0, Math.min(100, Math.round((1 - w.cdRem / Math.max(0.1, w.cooldown)) * 100)))
                        : 100
                  return (
                    <button
                      key={w.defId}
                      type="button"
                      className={`ftl-weapon-card${sel ? ' is-selected' : ''}${w.beaming ? ' is-beaming' : ''}${empty ? ' is-empty' : ''}`}
                      style={{ borderColor: sel ? w.color : undefined }}
                      title={`${w.name} — ${w.desc}`}
                      onClick={() => chooseWeapon(w.defId)}
                    >
                      <span className="ftl-w-top">
                        <kbd>{idx + 1}</kbd>
                        <PartIcon id={w.defId} />
                        <b className="ftl-w-name">{w.isDrone ? `🛸 ${w.name}` : w.name}{w.count > 1 ? ` ×${w.count}` : ''}</b>
                        <span className={`ftl-w-ammo${empty ? ' is-out' : ''}`}>
                          {w.ammo !== null ? `${w.ammo}/${w.ammoCap}` : `∞ · ${w.ecUse.toFixed(0)}⚡`}
                        </span>
                      </span>
                      <span className="ftl-w-bar">
                        <i style={{ width: `${fillPct}%`, background: w.beaming ? '#ffffff' : w.color }} />
                        <em>
                          {empty
                            ? (w.isDrone ? 'DRON TÜKENDİ' : 'CEPHANE BİTTİ')
                            : w.beaming
                              ? '🔥 IŞIN AKTİF'
                              : w.charge > 0.02
                                ? w.kind === 'ballistic'
                                  ? `⚡ ZİNCİR %${fillPct}`
                                  : `⚡ ŞARJ %${fillPct}`
                                : w.cdRem > 0.05
                                  ? `${w.cdRem.toFixed(1)} sn`
                                  : (w.isDrone ? 'FIRLATMAYA HAZIR' : 'HAZIR')}
                        </em>
                      </span>
                    </button>
                  )
                })}
                <div className="ftl-fire-controls">
                  <button
                    type="button"
                    className="hud-btn weapon-fire-btn"
                    title="Basılı tut: seçili silahı veya dron fırlatıcıyı çalıştır (F veya Sol Tık)"
                    onMouseDown={() => (manualFire.current = true)}
                    onMouseUp={() => (manualFire.current = false)}
                    onMouseLeave={() => (manualFire.current = false)}
                  >
                    {hud.weapons.every((w) => w.isDrone) ? '🛸 DRON FIRLAT (F)' : '🔥 ATEŞ (F)'}
                  </button>
                  <button
                    type="button"
                    className={`mini-warp-btn${leftClickFire ? ' is-on' : ''}`}
                    title="Açıkken Sol Tık basılı tutmak ateş/dron fırlatır (Sağ sürükle kamera); kapalıyken Sağ Tık ateş eder"
                    onClick={() => {
                      const next = !leftClickFire
                      leftClickFireRef.current = next
                      mouseFire.current = false
                      setLeftClickFire(next)
                    }}
                  >
                    {leftClickFire ? '🎯 Sol Tık=Ateş' : '📷 Sol=Kamera'}
                  </button>
                </div>
              </div>
            )}
            {(() => {
              const followCands = hud.vessels.filter(
                (o) => !o.active && !o.isStation && (!hud.isDrone || o.bodyId === hud.body),
              )
              const chosenFollowId =
                hud.followId && followCands.some((o) => o.id === hud.followId)
                  ? hud.followId
                  : followPick && followCands.some((o) => o.id === followPick)
                    ? followPick
                    : followCands[0]?.id ?? 0
              if (hud.loot && followCands.length === 0) return null
              return (
            <div className="target-bar">
              {!hud.loot && (
              <>
              <span>Hedef:</span>
              <select
                value={hud.targetBody}
                onChange={(e) => {
                  const bodyId = e.target.value as BodyId
                  if (hud.isMp) {
                    hudCmd({ type: 'setTarget', bodyId })
                  } else {
                    sim.gs.targetBody = bodyId
                    setHud(snapshot())
                    void saveGame()
                  }
                }}
              >
                {DESTINATIONS.map((id) => (
                  <option key={id} value={id}>{BODIES[id].name}</option>
                ))}
              </select>
              {!hud.isDrone ? (
                <button
                  type="button"
                  className={`mini-warp-btn${hud.autopilot === 'transfer' ? ' is-on' : ''}`}
                  onClick={() => toggleAutopilot('transfer')}
                  title="Seçili hedefe otomatik transfer başlat (yaklaşınca uyarı verir)"
                >
                  🎯 Hedefe Git
                </button>
              ) : hud.landable && (
                <button
                  type="button"
                  className={`mini-warp-btn${hud.autopilot === 'nextQuad' ? ' is-on' : ''}`}
                  onClick={() => toggleAutopilot('nextQuad')}
                  title="Dronu gezegenin bir sonraki çeyreğine otonom uçur (uzay sınırını aşmaz)"
                >
                  🧭 Sonraki Çeyrek ({QUADRANT_SHORT[((hud.quadrant + 1) % 4) as QuadrantId]})
                </button>
              )}
              {!hud.isDrone && (
                <button
                  type="button"
                  className={`mini-warp-btn${hud.autopilot === 'orbit' ? ' is-on' : ''}`}
                  onClick={() => toggleAutopilot('orbit')}
                  title="Bulunulan gezegen çevresinde güvenli yörüngeye yerleş veya yakala"
                >
                  🛰️ Yörünge
                </button>
              )}
              {!hud.landed && hud.landable && (
                <button
                  type="button"
                  className={`mini-warp-btn${hud.autopilot === 'land' ? ' is-on' : ''}`}
                  onClick={toggleAutoLand}
                  title={hud.hasAutoLand ? 'Otomatik iniş asistanı (L)' : 'Teknoloji: Gelişmiş İniş ile açılır'}
                >
                  {hud.hasAutoLand ? '🛬 Oto-İniş' : '🛬 Oto-İniş 🔒'}
                </button>
              )}
              </>
              )}
              {followCands.length > 0 && (
                <>
                  <select
                    aria-label="Takip edilecek roket"
                    value={chosenFollowId}
                    onChange={(e) => {
                      const nextId = Number(e.target.value)
                      setFollowPick(nextId)
                      if (hud.autopilot === 'follow') toggleAutopilot('follow', nextId)
                    }}
                  >
                    {followCands.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.body})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`mini-warp-btn${hud.autopilot === 'follow' ? ' is-on' : ''}`}
                    onClick={() => toggleAutopilot('follow', chosenFollowId)}
                    title="Seçili roketi formasyonda takip et (filo)"
                  >
                    📡 Takip Et
                  </button>
                </>
              )}
              {isMap && !hud.loot && (
                <>
                  <button type="button" className="mini-warp-btn" onClick={() => focusMapOn('ship')}>Gemi</button>
                  <button type="button" className="mini-warp-btn" onClick={() => focusMapOn(hud.targetBody)}>Hedef</button>
                </>
              )}
            </div>
              )
            })()}
            {(hud.autopilot !== 'off' || hud.autopilotNote.startsWith('Hızlı yolculuk')) && hud.autopilotNote && (
              <div className="autopilot-note">{hud.autopilotNote}</div>
            )}
            {isMap && hud.plan.map((p) => <div key={p} className="plan">{p}</div>)}
            {showApproachWarn && (
              <div className="approach-warn">
                <span>
                  ⚠ <b>{BODIES[hud.approachWarn ?? hud.body].name} yaklaşma uyarısı</b> ({km(hud.alt)} · {hud.speed.toFixed(0)} m/s) — Otomatik iniş henüz kapalı!
                </span>
                <button
                  type="button"
                  className="mini-warp-btn"
                  onClick={() => {
                    setShowApproachWarn(false)
                    if (hud.isMp && hud.vesselId) {
                      hudCmd({ type: 'setAutopilot', vesselId: hud.vesselId, mode: 'off' })
                      hudCmd({ type: 'setSas', vesselId: hud.vesselId, sas: 'retrograde' })
                    } else {
                      act((v) => { v.autopilot = 'off'; v.followId = undefined; v.sas = 'retrograde'; v.approachWarn = null })
                    }
                  }}
                >
                  T: Geri Dön
                </button>
                <button type="button" className="mini-warp-btn" onClick={() => toggleAutopilot('orbit')}>
                  🛰️ Yörüngeye Gir
                </button>
              </div>
            )}
            {showLandAlert && (
              <div className="land-alert">
                {hud.hasLegs && !hud.legsOpen
                  ? 'İniş yaklaşıyor: ayakları aç (G)!'
                  : hud.speed > hud.tol
                    ? `İniş hızı ${hud.speed.toFixed(0)} m/s (güvenli ≤ ${hud.tol} m/s)`
                    : `İnişe hazır (${hud.speed.toFixed(1)} m/s)`}
              </div>
            )}
            <div className="row">
              {(['off'] as SasMode[]).map((m) => (
                <button
                  key={m}
                  className={`hud-btn${hud.sas === m ? ' is-on' : ''}`}
                  onClick={() => {
                    if (hud.isMp && hud.vesselId) {
                      hudCmd({ type: 'setAutopilot', vesselId: hud.vesselId, mode: 'off' })
                      hudCmd({ type: 'setSas', vesselId: hud.vesselId, sas: m })
                    } else {
                      act((v) => { v.autopilot = 'off'; v.followId = undefined; v.autoLand = false; v.autopilotNote = undefined; v.sas = m })
                    }
                  }}
                >
                  {m === 'off' ? 'Serbest' : ''}
                </button>
              ))}
              {hud.hasDecoupler && (
                <button
                  className="hud-btn"
                  title="Alt kademeyi ayır"
                  onClick={() => (hud.isMp && hud.vesselId ? hudCmd({ type: 'stage', vesselId: hud.vesselId }) : act((v) => stageNext(sim, v)))}
                >
                  ✂ Kademe
                </button>
              )}
              {hud.hasChutes && (
                <button
                  className={`hud-btn${hud.chutesOpen ? ' is-on' : ''}`}
                  onClick={() => (hud.isMp && hud.vesselId ? hudCmd({ type: 'togglePartKind', vesselId: hud.vesselId, kind: 'chute' }) : act((v) => { toggleKind(v, 'chute') }))}
                >
                  🪂 Paraşüt
                </button>
              )}
              {hud.hasSolar && (
                <button
                  className={`hud-btn${hud.solarOpen ? ' is-on' : ''}`}
                  onClick={() => (hud.isMp && hud.vesselId ? hudCmd({ type: 'togglePartKind', vesselId: hud.vesselId, kind: 'solar' }) : act((v) => { toggleKind(v, 'solar') }))}
                >
                  ☀️ Panel
                </button>
              )}
              {hud.canRendezvous && !hud.dockName && (
                <button
                  className="hud-btn"
                  title="Yakıt harcayarak ISS'in yanına gider; son kenetlenme sende."
                  onClick={() => (hud.isMp && hud.vesselId
                    ? hudCmd({ type: 'rendezvous', vesselId: hud.vesselId })
                    : act((v) => { const err = rendezvousStation(sim, v); return err ?? [{ type: 'toast', text: 'Buluşma tamamlandı: ISS 22 m önünde. Kenetlen düğmesine bas.' }] }))}
                >
                  🛰️ ISS&apos;e git
                </button>
              )}
              {hud.dockName && (
                <button
                  className="hud-btn recover"
                  onClick={() => {
                    const target = dockCandidate(curSim.gs, activeVessel(curSim.gs)!)
                    if (!target) return
                    if (hud.isMp && hud.vesselId) hudCmd({ type: 'dock', vesselId: hud.vesselId, targetId: target.id })
                    else act((v) => dockVessels(sim, v, target))
                  }}
                >
                  Kenetlen: {hud.dockName}
                </button>
              )}
              {hud.landed && hud.body === 'earth' && (
                <button
                  className="hud-btn recover"
                  onClick={() => (hud.isMp && hud.vesselId ? hudCmd({ type: 'recoverVessel', vesselId: hud.vesselId }) : act((v) => recoverVessel(sim, v)))}
                >
                  Aracı kurtar
                </button>
              )}
              {hud.landed && !(hud.body === 'earth' && hud.quadrant === 0) && (
                <button className="hud-btn recover" onClick={() => setPanel('base')}>
                  {`🏗️ ${baseBody.name} · ${QUADRANT_SHORT[hud.quadrant]}`}
                </button>
              )}
              {((hud.landed && (hud.hasCargoBay || !(hud.body === 'earth' && hud.quadrant === 0))) || hud.nearbyTransfer) && (
                <button
                  className={`hud-btn recover${showCargo ? ' is-on' : ''}`}
                  onClick={() => {
                    setShowDrone(false)
                    setShowCargo((x) => !x)
                  }}
                >
                  🚚 Kargo
                </button>
              )}
              {(hud.droneBayReady || hud.liveDroneCount > 0) && !hud.loot && (
                <button
                  className={`hud-btn${showDrone ? ' is-on' : ''}`}
                  onClick={() => {
                    setDroneSite(null)
                    setShowCargo(false)
                    setShowDrone((x) => !x)
                  }}
                >
                  🛸 Dron
                </button>
              )}
            </div>
          </div>

          <div className="hud hud-br">
            <button
              className={`hud-btn${hud.throttle > 0 ? ' is-on' : ''}`}
              onClick={() => {
                if (hud.isMp && hud.vesselId) {
                  hudCmd({ type: 'setThrottle', vesselId: hud.vesselId, throttle: hud.throttle > 0 ? 0 : 1 })
                } else {
                  act((v) => { v.autoLand = false; v.autopilot = 'off'; v.followId = undefined; v.autopilotNote = undefined; v.throttle = v.throttle > 0 ? 0 : 1 })
                }
              }}
            >
              {hud.throttle > 0 ? 'Açık' : 'Kapalı'}
            </button>
            <b>{Math.round(hud.throttle * 100)}%</b>
            <div
              className="throttle"
              onMouseDown={setThrottleFromEvent}
              onMouseMove={(e) => { if (e.buttons === 1) setThrottleFromEvent(e) }}
            >
              <em style={{ height: `${hud.throttle * 100}%` }} />
            </div>
          </div>
        </>
      )}

      {!hud.has && (
        <div className="toasts">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
        </div>
      )}

      {panel === 'chat' && hud.isMp && (
        <aside className="side-panel">
          <header><h2>💬 Oda Sohbeti</h2><button onClick={() => setPanel(null)}>×</button></header>
          <div className="mp-chat-log flight-chat-log">
            {mp.chat.length === 0 ? (
              <span className="mp-chat-empty">Takım ve rakiplerle yazış…</span>
            ) : (
              mp.chat.map((c) => (
                <div key={c.id} className="mp-chat-line">
                  <b style={{ color: c.color }}>{c.username}:</b> <span>{c.text}</span>
                </div>
              ))
            )}
          </div>
          <form
            className="mp-chat-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!chatText.trim()) return
              sendMpChat(chatText)
              setChatText('')
            }}
          >
            <input
              type="text"
              maxLength={140}
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="Mesaj yaz…"
            />
            <button type="submit" className="hud-btn">Gönder</button>
          </form>
        </aside>
      )}

      {panel === 'missions' && !hud.isMp && (
        <aside className="side-panel">
          <header><h2>Görevler</h2><button onClick={() => setPanel(null)}>×</button></header>
          <ul className="mission-list">
            {MISSIONS.map((m) => {
              const done = sim.gs.missionsDone.includes(m.id)
              return (
                <li key={m.id} className={done ? 'done' : ''}>
                  <span className="check">{done ? '✓' : '○'}</span>
                  <div><b>{m.title}</b><p>{m.desc}</p></div>
                  <span className="reward">{fmt(m.reward)} ₡</span>
                </li>
              )
            })}
          </ul>
        </aside>
      )}

      {panel === 'base' && (
        <aside className="side-panel">
          <header><h2>{hud.loot ? '🏰 Uzay Üssü Geliştirme' : '🏗️ Koloni'}</h2><button onClick={() => setPanel(null)}>×</button></header>
          <PlanetGridPanel
            initialBody={hud.body}
            initialQuadrant={hud.quadrant}
            onNotify={(msg, kind) => toast(msg, kind)}
            onOpenTech={() => {
              setPanel(null)
              setShowTech(true)
            }}
            onOpenDronePad={(bId, qId) => {
              setPanel(null)
              setShowCargo(false)
              setDroneSite({ bodyId: bId, quadrant: qId })
              setShowDrone(true)
            }}
          />

          {hud.has && hud.landed && !(hud.body === 'earth' && hud.quadrant === 0) && !hud.loot && (
            <div className="base-actions">
              <button
                className="hud-btn"
                onClick={() => {
                  setShowDrone(false)
                  setShowCargo(true)
                }}
              >
                🚚 Kargo penceresini aç
              </button>
            </div>
          )}
        </aside>
      )}

      {panel === 'help' && (
        <aside className="side-panel">
          <header><h2>Kontroller</h2><button onClick={() => setPanel(null)}>×</button></header>
          <ul className="help-list">
            <li><kbd>W</kbd>/<kbd>S</kbd> itki ±, <kbd>Z</kbd> tam itki, <kbd>X</kbd> motoru kes</li>
            <li><kbd>A</kbd>/<kbd>D</kbd> döndür · <kbd>T</kbd> yön kilidi (ileri / geri / radyal)</li>
            <li><kbd>L</kbd> Otomatik İniş Bilgisayarı</li>
            <li><kbd>Boşluk</kbd> basılı tut: motor itkisi · kademeyi ayırmak için adaptöre tıkla</li>
            <li><kbd>M</kbd> uzay haritası · tekerlek: yakınlaş/uzaklaş · sürükle: kamerayı kaydır · çift tık: rokete ortala</li>
            <li><kbd>,</kbd>/<kbd>.</kbd> zamanı yavaşlat / hızlandır (fizikte 25×, yörüngede 100.000×)</li>
            <li><kbd>P</kbd> paraşüt · <kbd>G</kbd> iniş ayakları · <kbd>O</kbd> güneş panelleri</li>
            <li><kbd>R</kbd> RCS&apos;yi aç · <kbd>I</kbd>/<kbd>K</kbd> ileri/geri · <kbd>J</kbd>/<kbd>L</kbd> sola/sağa</li>
            <li><kbd>Tab</kbd> ya da araca tıkla: başka gemiye geç</li>
            <li><kbd>1</kbd>–<kbd>9</kbd> silah seç · <b>Sol Tık / F</b> (basılı): nişan al &amp; ateşle · <kbd>H</kbd> Gemi Sağlığı</li>
          </ul>
          <p className="base-note">Gezegen ipucu: Haritada hedef seç (Venüs, Merkür, Mars, Ceres, Ganimed, Titan), transfer penceresinde yak ve iniş öncesi Oto-İniş veya paraşüt/ayakları aç!</p>
        </aside>
      )}

      {panel === 'health' && hud.has && (() => {
        const hv = activeVessel(curSim.gs)
        if (!hv) return null
        const st = vesselStats(hv.parts, hv.cargo)
        const minX = Math.floor(st.minX)
        const maxX = Math.ceil(st.maxX)
        const minY = Math.floor(st.minY)
        const maxY = Math.ceil(st.maxY)
        const cols = Math.max(2, maxX - minX)
        const rows = Math.max(2, maxY - minY)
        const damagedCount = hv.parts.filter((p) => (p.hp ?? partMaxHp(p.def)) < partMaxHp(p.def)).length
        const pickedPart = inspectIdx !== null && hv.parts[inspectIdx] ? hv.parts[inspectIdx] : null
        const pickedDef = pickedPart ? partDef(pickedPart.def) : null
        const pickedMaxHp = pickedPart ? partMaxHp(pickedPart.def) : 0
        const pickedHp = pickedPart ? Math.max(0, Math.round(pickedPart.hp ?? pickedMaxHp)) : 0
        return (
          <aside className="side-panel ship-health-panel" role="dialog" aria-label="Gemi Sağlığı ve Sistemler">
            <header>
              <h2>❤️ {hv.name} · Gemi Durumu</h2>
              <button onClick={() => setPanel(null)}>×</button>
            </header>
            <div className="sh-summary">
              <div className="sh-stat">
                <span>Gövde Bütünlüğü</span>
                <b className={hud.hp < hud.maxHp * 0.4 ? 'bad' : hud.hp < hud.maxHp * 0.75 ? 'warn' : 'ok'}>
                  {Math.round(hud.hp)} / {hud.maxHp} HP (%{hud.maxHp > 0 ? Math.round((hud.hp / hud.maxHp) * 100) : 100})
                </b>
              </div>
              {hud.shieldCap > 0 && (
                <div className="sh-stat">
                  <span>Enerji Kalkanı</span>
                  <b className="ok">{Math.round(hud.shield)} / {hud.shieldCap} HP</b>
                </div>
              )}
              <div className="sh-stat">
                <span>Hasarlı Parça</span>
                <b className={damagedCount > 0 ? 'warn' : 'ok'}>{damagedCount} / {hv.parts.length}</b>
              </div>
              <div className="sh-stat">
                <span>Elektrik · Δv</span>
                <b>{hud.ec.toFixed(0)} ⚡ · {fmt(hud.dv)} m/s</b>
              </div>
            </div>
            {(hud.empStunned || hud.burning) && (
              <div className="sh-alerts">
                {hud.empStunned && <span className="mp-war-pill is-emp">⚡ EMP Kilitli: Silah &amp; Kalkan Geçici Kapalı</span>}
                {hud.burning && <span className="mp-war-pill is-elim">🔥 Plazma Yanığı Aktif (-12 HP/sn)</span>}
              </div>
            )}
            <div className="sh-blueprint-wrap">
              <div
                className="sh-blueprint-grid"
                style={{
                  gridTemplateColumns: `repeat(${cols}, 26px)`,
                  gridTemplateRows: `repeat(${rows}, 26px)`,
                }}
              >
                {hv.parts.map((pt, i) => {
                  const d = partDef(pt.def)
                  const mh = partMaxHp(pt.def)
                  const chp = Math.max(0, pt.hp ?? mh)
                  const frac = mh > 0 ? chp / mh : 1
                  const tone = frac >= 0.78 ? 'is-ok' : frac >= 0.4 ? 'is-warn' : 'is-crit'
                  return (
                    <button
                      key={`${pt.def}-${i}`}
                      type="button"
                      className={`sh-part ${tone}${inspectIdx === i ? ' is-sel' : ''}`}
                      style={{
                        gridColumn: `${Math.floor(pt.x) - minX + 1} / span ${d.w}`,
                        gridRow: `${Math.floor(pt.y) - minY + 1} / span ${d.h}`,
                      }}
                      title={`${d.name}: ${Math.round(chp)} / ${mh} HP`}
                      onClick={() => setInspectIdx(inspectIdx === i ? null : i)}
                    >
                      <PartIcon id={d.id} />
                      <span className="sh-part-pct">%{Math.round(frac * 100)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="sh-inspector">
              {pickedPart && pickedDef ? (
                <>
                  <div className="sh-insp-head">
                    <b>{pickedDef.name}</b>
                    <span>{pickedHp} / {pickedMaxHp} HP</span>
                  </div>
                  <small>
                    Kütle: {pickedDef.mass} t
                    {pickedDef.fuel !== undefined ? ` · Yakıt: ${(pickedPart.fuel ?? pickedDef.fuel).toFixed(2)}/${pickedDef.fuel} t` : ''}
                    {pickedDef.weapon?.ammo !== undefined ? ` · Cephane: ${pickedPart.ammo ?? pickedDef.weapon.ammo}/${pickedDef.weapon.ammo}` : ''}
                    {pickedDef.weapon ? ` · Hasar: ${pickedDef.weapon.dmg}` : ''}
                  </small>
                </>
              ) : (
                <small>Detay ve kalan can/cephane görmek için şemadaki bir parçaya tıkla.</small>
              )}
            </div>
            {hud.landed && damagedCount > 0 && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => hudCmd({ type: 'repairVessel', vesselId: hv.id })}
              >
                🔧 Üste İniş Onarımı Uygula
              </button>
            )}
          </aside>
        )
      })()}


      {showCargo && hud.has && (hud.nearbyTransfer || (hud.landed && (hud.hasCargoBay || !(hud.body === 'earth' && hud.quadrant === 0)))) && (() => {
        const cv = activeVessel(curSim.gs)
        if (!cv) return null
        const myActor = curSim.gs.ownerId ?? 'local'
        const cq = quadrantOfAngle(Math.atan2(cv.pos.y, cv.pos.x))
        const isHomeEarth = cv.bodyId === 'earth' && cq === 0
        const onOuterSurface = cv.landed && !isHomeEarth
        const cb = cv.landed ? getActorBase(curSim.gs, cv.bodyId, myActor, cq) : undefined
        const flux = solarFlux(len(bodyAbsState(cv.bodyId, curSim.gs.time).r))
        const canBuyToCargo = Boolean(
          cv.landed && (isHomeEarth || (cb && !cb.destroyed && isQuadrantColonized(cb, flux))),
        )
        const cap = vesselStats(cv.parts).cargoCap
        const used = cargoMass(cv.cargo)
        const free = Math.max(0, cap - used)
        const tanks = cv.parts.filter((p) => partDef(p.def).kind === 'tank')
        const fuelNow = tanks.reduce((a, p) => a + (p.fuel ?? 0), 0)
        const fuelCap = tanks.reduce((a, p) => a + (partDef(p.def).fuel ?? 0), 0)
        const hasIsru = (cb?.modules.isru ?? 0) > 0
        const stock = onOuterSurface ? Object.entries(cb?.stock ?? {}).filter(([, n]) => n > 0) : []
        const inCargo = Object.entries(cv.cargo.modules).filter(([id, n]) => n > 0 && id !== 'iss-supplies')
        const partners = curSim.gs.vessels.filter(
          (o) => (!curSim.gs.mp || o.ownerId === myActor) && canTransferCargoBetween(cv, o),
        )
        const run = (cmd: GameCommand, sp: (v: Vessel) => string | null | GameEvent[]) => {
          if (hud.isMp) hudCmd(cmd)
          else act(sp)
        }
        const W = (tr: string, en: string) => (lang === 'en' ? en : tr)
        const modName = (id: string) => { const n = MODULE_BY_ID[id]?.name ?? id; return lang === 'en' ? T(n) : n }
        const bodyName = (id: BodyId) => (lang === 'en' ? T(BODIES[id].name) : BODIES[id].name)
        const img = (id: string) => `/assets/colony/${MODULE_BY_ID[id]?.sprite ?? 'battery'}.png`
        const shopMods = MODULES.filter((m) => (!m.warfare || hud.isWarfare) && isModuleUnlocked(curSim.gs, m.id))
        return (
          <section className="cargo-window" role="dialog" aria-label={W('Kargo', 'Cargo')} data-no-i18n>
            <header>
              <h2>🚚 {bodyName(cv.bodyId)} ({QUADRANT_SHORT[cq]}) · {W('Kargo', 'Cargo')}</h2>
              <div className="cargo-head-r">
                {!hud.loot && (
                  <button
                    type="button"
                    className="hud-btn"
                    onClick={() => {
                      setShowCargo(false)
                      setDroneSite(null)
                      setShowDrone(true)
                    }}
                  >
                    🛸 {W('Dron Penceresi', 'Drone Window')}
                  </button>
                )}
                <button onClick={() => setShowCargo(false)} aria-label={W('Kapat', 'Close')}>×</button>
              </div>
            </header>
            <div className="cargo-capbar" title={W('Kargo gövdesi doluluğu', 'Cargo bay fill')}>
              <span>{cv.name} · {W('Kargo', 'Cargo')}</span>
              <i><em style={{ width: pct(used, cap) }} /></i>
              <small>{used.toFixed(1)} / {cap} t</small>
            </div>
            <div className="cargo-cols">
              <div className="cargo-col">
                <h3>{onOuterSurface ? W('⬆ Koloniden al', '⬆ Take from colony') : isHomeEarth && cv.landed ? W('🏭 Ana Üsten Yükle', '🏭 Load at Home Base') : W('🔁 Yakın araçlardan al', '🔁 Receive from nearby craft')}</h3>
                {onOuterSurface && (
                  <>
                    <div className="cargo-row">
                      <span className="cargo-ico">⛏️</span>
                      <div><b>{W('Maden', 'Ore')}</b><small>{W('Depoda', 'In storage')} {(cb?.ore ?? 0).toFixed(1)} t</small></div>
                      <button
                        className="hud-btn"
                        disabled={!cb || (cb.ore ?? 0) < 0.01 || free < 0.01}
                        onClick={() => run({ type: 'loadOre', vesselId: cv.id, quadrant: cq }, (v) => loadOre(sim, v, cq))}
                      >
                        {W('Yükle', 'Load')}
                      </button>
                    </div>
                    <div className="cargo-row">
                      <span className="cargo-ico">⛽</span>
                      <div>
                        <b>{W('Yakıt', 'Fuel')}</b>
                        <small>{hasIsru ? W(`Tanklar ${fuelNow.toFixed(1)} / ${fuelCap.toFixed(0)} t · 1 t maden → 4 t yakıt`, `Tanks ${fuelNow.toFixed(1)} / ${fuelCap.toFixed(0)} t · 1 t ore → 4 t fuel`) : W('Yakıt Tesisi kurulmamış', 'No Fuel Plant built')}</small>
                      </div>
                      <button
                        className="hud-btn"
                        disabled={!hasIsru || (cb?.ore ?? 0) < 0.01 || fuelNow >= fuelCap - 0.01}
                        onClick={() => run({ type: 'refuelAtBase', vesselId: cv.id, quadrant: cq }, (v) => refuelAtBase(sim, v, cq))}
                      >
                        {W('Doldur', 'Refuel')}
                      </button>
                    </div>
                    {stock.length > 0 && stock.map(([id, n]) => (
                      <div key={id} className="cargo-row">
                        <img className="cargo-ico" src={img(id)} alt="" />
                        <div><b>{modName(id)} ×{n}</b><small>{W('Depoda', 'In storage')} · {MODULE_BY_ID[id]?.mass ?? 0} t</small></div>
                        <button
                          className="hud-btn"
                          disabled={free + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                          onClick={() => run({ type: 'pickupModule', vesselId: cv.id, moduleId: id, quadrant: cq }, (v) => pickupModule(sim, v, id, cq))}
                        >
                          {W('Al', 'Take')}
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {canBuyToCargo && cap > 0 && shopMods.map((m) => (
                  <div key={`shop-${m.id}`} className="cargo-row">
                    <img className="cargo-ico" src={img(m.id)} alt="" />
                    <div><b>{modName(m.id)}</b><small>{m.mass} t · {fmt(m.cost)} ₡</small></div>
                    <button
                      className="hud-btn"
                      disabled={free + 1e-9 < m.mass || hud.money < m.cost}
                      onClick={() => hudCmd({ type: 'buyCargoModule', vesselId: cv.id, moduleId: m.id, delta: 1 })}
                    >
                      ＋ {W('Al', 'Buy')}
                    </button>
                  </div>
                ))}
                {partners.map((other) => {
                  const oMods = Object.entries(other.cargo.modules).filter(([id, n]) => n > 0 && id !== 'iss-supplies')
                  if (!oMods.length) return null
                  return oMods.map(([id, n]) => (
                    <div key={`${other.id}-${id}`} className="cargo-row">
                      <img className="cargo-ico" src={img(id)} alt="" />
                      <div><b>{modName(id)} ×{n}</b><small>{other.name} · {MODULE_BY_ID[id]?.mass ?? 0} t</small></div>
                      <button
                        className="hud-btn"
                        disabled={free + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                        onClick={() => hudCmd({ type: 'transferCargo', fromVesselId: other.id, toVesselId: cv.id, moduleId: id, count: 1 })}
                      >
                        {W('Bu araca al', 'Pull here')}
                      </button>
                    </div>
                  ))
                })}
              </div>
              <div className="cargo-col">
                <h3>{onOuterSurface ? W('⬇ Çeyreğe indir / Aktar', '⬇ Unload to quadrant / Transfer') : isHomeEarth && cv.landed ? W('📦 Araçtaki Modüller', '📦 Onboard Modules') : W('🔁 Yakın araca aktar', '🔁 Send to nearby craft')}</h3>
                {inCargo.length === 0 ? (
                  <p className="cargo-empty">{W('Kargoda modül yok.', 'No buildings in cargo.')}</p>
                ) : (
                  inCargo.map(([id, n]) => (
                    <div key={id} className="cargo-row">
                      <img className="cargo-ico" src={img(id)} alt="" />
                      <div><b>{modName(id)} ×{n}</b><small>{onOuterSurface ? W('Bu çeyreğe kurulur', 'Built in this quadrant') : W('Diğer araca ya da rampaya iade', 'Transfer or refund')}</small></div>
                      {onOuterSurface && (
                        <button
                          className="hud-btn"
                          onClick={() => run({ type: 'deployModules', vesselId: cv.id, moduleId: id, quadrant: cq }, (v) => deployModules(sim, v, id, cq))}
                        >
                          {W('İndir', 'Unload')}
                        </button>
                      )}
                      {isHomeEarth && cv.landed && (
                        <button
                          className="hud-btn"
                          onClick={() => hudCmd({ type: 'buyCargoModule', vesselId: cv.id, moduleId: id, delta: -1 })}
                        >
                          {W('İade', 'Refund')}
                        </button>
                      )}
                      {partners.map((pt) => {
                        const pFree = vesselStats(pt.parts).cargoCap - cargoMass(pt.cargo)
                        return (
                          <button
                            key={pt.id}
                            className="hud-btn"
                            disabled={pFree + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                            onClick={() => hudCmd({ type: 'transferCargo', fromVesselId: cv.id, toVesselId: pt.id, moduleId: id, count: 1 })}
                          >
                            → {pt.name.split(' ')[0]}
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
                {cv.cargo.ore > 0.01 && (
                  <div className="cargo-row">
                    <span className="cargo-ico">⛏️</span>
                    <div><b>{W('Maden', 'Ore')} {cv.cargo.ore.toFixed(1)} t</b><small>{W("Dünya'ya götür, inince satılır", 'Take it to Earth; it sells on landing')}</small></div>
                  </div>
                )}
                {onOuterSurface && inCargo.length > 1 && (
                  <button
                    className="hud-btn cargo-all"
                    onClick={() => run({ type: 'deployModules', vesselId: cv.id, quadrant: cq }, (v) => deployModules(sim, v, undefined, cq))}
                  >
                    {W('Hepsini çeyreğe kur', 'Unload all to quadrant')}
                  </button>
                )}
              </div>
            </div>
          </section>
        )
      })()}

      {showDrone && !hud.loot && (
        <DroneWindow
          gs={curSim.gs}
          curSim={curSim}
          myActor={hud.myId}
          active={activeVessel(curSim.gs)}
          initialSite={droneSite}
          onClose={() => {
            setShowDrone(false)
            setDroneSite(null)
          }}
          onSwitch={switchTo}
          onToast={toast}
          onRefresh={() => setHud(snapshot())}
        />
      )}

      {showFleet && (
        <FleetWindow
          gs={curSim.gs}
          curSim={curSim}
          myActor={hud.myId}
          active={activeVessel(curSim.gs)}
          onClose={() => setShowFleet(false)}
          onSwitch={switchTo}
          onToast={toast}
          onRefresh={() => setHud(snapshot())}
        />
      )}

      {confirmDel && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setConfirmDel(null)}>
          <section className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Aracı sil</h2>
            <p><b>{confirmDel.name}</b> kalıcı olarak silinecek; parça iadesi yapılmaz. Onaylıyor musunuz?</p>
            <div className="row">
              <button
                className="button button-primary danger"
                onClick={() => {
                  if (hud.isMp) {
                    hudCmd({ type: 'deleteVessel', vesselId: confirmDel.id })
                  } else {
                    deleteVessel(sim, confirmDel.id)
                    void saveGame(true)
                    bump()
                  }
                  setConfirmDel(null)
                  setHud(snapshot())
                  toast('Araç silindi.')
                }}
              >
                Evet, sil
              </button>
              <button className="button button-secondary" onClick={() => setConfirmDel(null)}>Vazgeç</button>
            </div>
          </section>
        </div>
      )}

      {hud.isMp && hud.mpWinnerId && (
        <div className="dialog-backdrop">
          <section className="dialog mp-victory-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow"><span /> {hud.loot ? 'YAĞMA SONUCU' : hud.isWarfare ? 'UZAY SAVAŞI SONUCU' : 'GEZEGEN FETİH SONUCU'}</p>
            <h2>
              🏆{' '}
              <span style={{ color: hud.mpPlayers.find((p) => p.id === hud.mpWinnerId)?.color }}>
                {hud.mpPlayers.find((p) => p.id === hud.mpWinnerId)?.username ?? hud.mpWinnerId}
              </span>{' '}
              Kazandı!
            </h2>
            <p>
              {hud.loot
                ? hud.mpWinnerId === hud.myId
                  ? 'Tebrikler! En büyük ganimeti sen topladın!'
                  : 'Rakibin hedef ganimete ulaştı. Daha iyi bir gemiyle rövanş zamanı!'
                : hud.isWarfare
                ? hud.mpWinnerId === hud.myId
                  ? 'Tebrikler! Filoları bozguna uğratıp sistemin hakimi oldun!'
                  : 'Rakibin savaşı kazandı. Daha ağır silahlarla rövanş zamanı!'
                : hud.mpWinnerId === hud.myId
                  ? 'Tebrikler! Güneş Sisteminin yeni hakimi sensin!'
                  : 'Rakibin hedef gezegen sayısına ulaştı. Bir sonraki turda rövanşı alabilirsin!'}
            </p>
            <div className="mp-final-table">
              {hud.mpPlayers.map((p, idx) => (
                <div key={p.id} className="mp-score-row">
                  <span>#{idx + 1}</span>
                  <i className="mp-dot" style={{ background: p.color }} />
                  <span className="mp-s-name">{p.username}</span>
                  <span className="mp-s-flags">
                    {hud.loot ? `📦 ${(p.looted ?? 0).toFixed(1)} t · 🏴‍☠️${p.coloniesDestroyed ?? 0} · 💀${p.kills}` : hud.isWarfare ? `⚔️ ${p.score ?? 0}p · 💥${p.coloniesDestroyed ?? 0} · 💀${p.kills}` : `🚩 ${p.planetsHeld}`}
                  </span>
                  <span>{fmt(p.money)} ₡</span>
                </div>
              ))}
            </div>
            <div className="row">
              <button className="button button-primary" onClick={() => { resetViewCache(); leaveMpRoom(false) }}>
                Lobiye Dön
              </button>
              <button className="button button-secondary" onClick={() => { resetViewCache(); exitMpMode() }}>
                Ana Menüye Çık
              </button>
            </div>
          </section>
        </div>
      )}

      {hud.isMp && !hud.has && !lost && isMpPendingLaunch() && (
        <div className="toast">🚀 Fırlatma hazırlanıyor…</div>
      )}

      {!confirmDel && !wreck && !showDrone && !(hud.isMp && hud.mpWinnerId) && !(hud.mpEliminated && spectating) && (lost || (noVesselReady && !hud.has && !(hud.isMp && isMpPendingLaunch()))) && (
        <div className="dialog-backdrop">
          <section className="dialog">
            <h2>{hud.mpEliminated ? 'Elendin — Üssün Yok Edildi' : lost ? 'Araç kaybedildi' : 'Aktif araç yok'}</h2>
            <p>
              {hud.mpEliminated
                ? 'Tüm kolonilerin veya Dünya ana üssün düşman saldırısında imha edildi. Savaşı izleyebilir ya da lobiye dönebilirsin.'
                : lost ?? `Kontrol edilecek bir araç seç ya da montaj binasında yeni roket kur. Dünya üssün şu an +${fmt(hud.passivePerMin)} ₡/dk pasif gelir üretiyor!`}
            </p>
            <div className="row">
              {!hud.mpEliminated && (
                <>
                  <button className="button button-primary" onClick={quickLaunch}>🚀 Tasarımı Fırlat</button>
                  {!hud.loot && (
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setLost(null)
                        setDroneSite(null)
                        setShowDrone(true)
                      }}
                    >
                      🛸 Rampadan Dron Fırlat
                    </button>
                  )}
                  <button className="button button-secondary" onClick={onBuilder}>Montaj binası</button>
                  <button className="button button-secondary" onClick={() => setPanel('base')}>Üsler</button>
                </>
              )}
              {hud.mpEliminated && (
                <>
                  <button className="button button-secondary" onClick={() => setSpectating(true)}>👁️ Savaşı İzle</button>
                  <button className="button button-primary" onClick={() => { resetViewCache(); leaveMpRoom(false) }}>
                    Lobiye Dön
                  </button>
                </>
              )}
              {hud.vessels.map((o) => <button key={o.id} className="button button-secondary" onClick={() => switchTo(o.id)}>{o.name} · {o.body}</button>)}
            </div>
          </section>
        </div>
      )}

    </main>
  )
}
