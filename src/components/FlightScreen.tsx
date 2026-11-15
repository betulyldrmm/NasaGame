import { useCallback, useEffect, useRef, useState } from 'react'
import { MODULE_BY_ID } from '../game/base'
import { MISSIONS } from '../game/missions'
import { audio } from '../audio'
import { lang, T } from '../i18n'
import { bump, getActiveSim, runCommand, saveGame, sim, useAuthState } from '../game/store'
import type {
  AutopilotMode,
  DynamicWarpInfo,
  GameCommand,
  GameEvent,
  MultiplayerFeedItem,
  MultiplayerPlayer,
  PlanetCapture,
  SasMode,
  Vessel,
} from '../game/types'
import { activeEngines, cargoMass, estimateDeltaV, fuelGroups, vesselStats } from '../game/vessel'
import { partDef } from '../game/data'
import { bodyAbsState, bodyRelState, elementsFromState, hohmann, len, wrapPi } from '../flight/orbit'
import { type Controls, effectiveAutopilot, landingTolerance, pressureRatio, situation } from '../flight/physics'
import { type Patch, predictTrajectory } from '../flight/predict'
import {
  activeVessel,
  clickPart,
  deployModules,
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
  totalPassiveIncomePerHour,
  WARPS,
  isStationVessel,
  noteRcsPulse,
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
import { CONQUERABLE_BODIES, playerPadAngle, playerPassiveIncomePerHour } from '../flight/multiplayerSim'
import { BODIES, type BodyId, gameDate } from '../nasa/bodies'
import HowToPlay from './HowToPlay'
import { clampCamPan, createView, type FlightFrame, type MapFrame, pickPart, pickVesselFlight, renderFlight, renderMap, resetViewCache } from '../render/renderer'
import PlanetGridPanel from './ColonyPanel'

const DESTINATIONS: BodyId[] = ['moon', 'earth', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']
const QUICK_WARPS = [1, 4, 10, 25]
  .map((w) => ({ label: `${w}×`, idx: WARPS.indexOf(w) }))
  .filter((w) => w.idx >= 0)

const ACH_NAMES: Record<string, string> = { hamilton: 'Margaret Hamilton', 'dont-panic': "Don't Panic", 'water-tower': 'Su Kulesi Fırlatıldı', istikbal: 'İstikbal Göklerdedir', cay: 'Çaylar Şirketten' }

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const km = (m: number) => (Math.abs(m) >= 1e7 ? `${(m / 1e6).toFixed(2)} Mm` : Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`)
const dur = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)} sa` : s >= 120 ? `${(s / 60).toFixed(0)} dk` : `${s.toFixed(0)} sn`)

interface Hud {
  has: boolean
  vesselId: number | null
  name: string
  body: BodyId
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
  approachWarn: BodyId | null
  hasAutoLand: boolean
  sas: SasMode
  warp: number
  warpIdx: number
  money: number
  passivePerHr: number
  date: string
  dv: number
  tol: number
  vessels: { id: number; name: string; body: string; active: boolean }[]
  plan: string[]
  targetBody: BodyId
  cargo: string
  twr: number
  dockName: string | null
  issDist: number | null
  issRel: number
  canRendezvous: boolean
  tea: boolean
  buff: boolean
  achievements: string[]
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
  mpFeed: MultiplayerFeedItem[]
  mpNearestRival: { username: string; color: string; dist: number } | null
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

function snapshot(): Hud {
  const curSim = getActiveSim()
  const gs = curSim.gs
  const isMp = Boolean(gs.mp)
  const myId = gs.ownerId ?? 'local'
  const v = activeVessel(gs)
  const meMp = gs.mp?.players[myId]
  const targetBody = ((isMp ? meMp?.targetBody : gs.targetBody) ?? gs.targetBody ?? 'moon') as BodyId
  const mpPlayers = gs.mp
    ? Object.values(gs.mp.players).sort((a, b) => b.planetsHeld - a.planetsHeld || b.captures - a.captures)
    : []
  let mpNearestRival: { username: string; color: string; dist: number } | null = null
  if (gs.mp && v && !v.debris) {
    for (const o of gs.vessels) {
      if (o.id === v.id || o.bodyId !== v.bodyId || o.debris || o.station || !o.ownerId || o.ownerId === myId) continue
      const p = gs.mp.players[o.ownerId]
      if (!p) continue
      const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y)
      if (!mpNearestRival || d < mpNearestRival.dist) {
        mpNearestRival = { username: p.username, color: p.color, dist: d }
      }
    }
  }
  const base: Hud = {
    has: false,
    vesselId: null,
    name: '',
    body: 'earth',
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
    approachWarn: null,
    hasAutoLand: true,
    sas: 'off',
    warp: WARPS[curSim.warpIdx]!,
    warpIdx: curSim.warpIdx,
    money: isMp && meMp ? meMp.money : gs.money,
    passivePerHr: isMp ? playerPassiveIncomePerHour(gs, myId) : totalPassiveIncomePerHour(gs),
    date: gameDate(gs.time).toLocaleDateString(lang === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }),
    dv: 0,
    tol: 7,
    vessels: gs.vessels
      .filter((o) => !o.debris && (!isMp || (!o.station && o.ownerId === myId)))
      .map((o) => ({ id: o.id, name: o.name, body: BODIES[o.bodyId].name + (o.landed ? ' (yüzeyde)' : ''), active: o.id === gs.activeId })),
    plan: [],
    targetBody,
    cargo: '',
    twr: 0,
    dockName: null,
    issDist: null,
    issRel: 0,
    canRendezvous: false,
    tea: !isMp && !!gs.teaMode,
    buff: !isMp && !!gs.buffUntil && Date.now() < gs.buffUntil,
    achievements: gs.achievements ?? [],
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
    mpFeed: gs.mp?.feed ?? [],
    mpNearestRival,
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
  return {
    ...base,
    has: true,
    vesselId: v.id,
    name: v.name,
    body: v.bodyId,
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
  const [wreck, setWreck] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showCargo, setShowCargo] = useState(false)
  const [alarm, setAlarm] = useState(false)
  const spam = useRef<number[]>([])
  const typed = useRef('')
  const [panel, setPanel] = useState<'missions' | 'base' | 'help' | 'chat' | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ id: number; name: string } | null>(null)
  const [chatText, setChatText] = useState('')
  const setShowTech = (_open: boolean) => undefined
  const toastId = useRef(0)
  const lastMyVesselId = useRef<number | null>(null)
  const lastThrottleSentAt = useRef(0)
  const thDirty = useRef(false)
  useEffect(() => {
    if (hud.landed) setAlarm(false)
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
      else if (e.type === 'achievement') toast(`🏆 Başarım: ${e.title} — ${e.text}`, 'mission')
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
    (mode: 'orbit' | 'transfer' | 'land') => {
      const curSim = getActiveSim()
      const v = activeVessel(curSim.gs)
      if (!v) return
      const cur = effectiveAutopilot(v)
      const next: AutopilotMode = cur === mode ? 'off' : mode
      if (curSim.gs.mp) {
        const res = runCommand({ type: 'setAutopilot', vesselId: v.id, mode: next })
        if (res.error) {
          toast(res.error, 'warn')
          return
        }
        v.autopilot = next
        v.autoLand = next === 'land'
        if (next === 'off') v.throttle = 0
        const myTgt = (curSim.gs.mp.players[curSim.gs.ownerId ?? '']?.targetBody ?? curSim.gs.targetBody ?? 'moon') as BodyId
        const labels: Record<AutopilotMode, string> = {
          off: 'Otopilot kapatıldı.',
          orbit: '🛰️ Yörüngeye Yerleş otopilotu başlatıldı.',
          transfer: `🎯 Hızlı yolculuk → ${BODIES[myTgt].name}: uzaya çıkınca başlar, yakıtı yol kadar düşülür.`,
          land: '🛬 Otomatik İniş Asistanı devrede.',
        }
        toast(labels[next])
        setHud(snapshot())
        return
      }
      const err = setVesselAutopilot(sim, v, next)
      if (err) {
        toast(err, 'warn')
        return
      }
      if (next === 'off') v.throttle = 0
      if (next === 'land') {
        sim.warpLockPrev = undefined
      }
      const labels: Record<AutopilotMode, string> = {
        off: 'Otopilot kapatıldı.',
        orbit: '🛰️ Yörüngeye Yerleş otopilotu başlatıldı.',
        transfer: `🎯 ${BODIES[(sim.gs.targetBody ?? 'moon') as BodyId].name} oto-transferi başlatıldı.`,
        land: '🛬 Otomatik İniş Asistanı devrede.',
      }
      toast(labels[next])
      setHud(snapshot())
      bump()
    },
    [toast],
  )

  const toggleAutoLand = useCallback(() => toggleAutopilot('land'), [toggleAutopilot])

  const stepMpWarpReq = useCallback((dir: 1 | -1) => {
    const curSim = getActiveSim()
    if (!curSim.gs.mp) return
    const me = curSim.gs.mp.players[curSim.gs.ownerId ?? '']
    const curReq = me ? me.wantsWarpIdx : -1
    let nextReq: number
    if (dir > 0) {
      const base = curReq >= 0 ? curReq : curSim.warpIdx
      nextReq = Math.min(WARPS.length - 1, base + 1)
    } else {
      if (curReq < 0) nextReq = Math.max(0, curSim.warpIdx - 1)
      else nextReq = curReq - 1
    }
    runCommand({ type: 'setWarpPref', warpIdx: nextReq, anchor: false })
    setHud(snapshot())
  }, [])

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
      // Gizli mod: uçuşta "cay" yaz → Simit & Çay telemetrisi (yalnızca tek oyunculu)
      if (!isMp && k.length === 1) {
        typed.current = (typed.current + k).slice(-3)
        if (typed.current === 'cay' || typed.current === 'çay') {
          sim.gs.teaMode = !sim.gs.teaMode
          typed.current = ''
          toast(sim.gs.teaMode ? '🫖 Gizli mod açıldı: Simit & Çay telemetrisi. Çayı dökmeden (2 m/s altında) in!' : 'Simit & Çay modu kapandı.', 'mission')
        }
      }
      // 1202 alarmı: 100 m altında kontrollere abanırsan iniş bilgisayarı taşar
      if (v && !v.landed && ['a', 'd', 'w', 's', 'z', 'x', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
        const now = performance.now()
        spam.current = [...spam.current.filter((t) => now - t < 2500), now]
        if (spam.current.length >= 12 && situation(v).alt < 100) {
          spam.current = []
          setAlarm(true)
        }
      }
      if (k === 'm') toggleMap()
      else if (k === '.') {
        if (isMp) return
        else sim.warpIdx = Math.min(WARPS.length - 1, sim.warpIdx + 1)
      } else if (k === ',') {
        if (isMp) return
        else {
          sim.warpIdx = Math.max(0, sim.warpIdx - 1)
          sim.apWarpPinned = true
        }
      } else if (!v) return
      else if (k === ' ') {
        if (!spaceThrottle.current) {
          spaceThrottle.current = { vesselId: v.id, previousThrottle: v.throttle }
          v.autoLand = false
          v.autopilot = 'off'
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
        v.autopilotNote = undefined
        if (isMp) runCommand({ type: 'emergencyStop', vesselId: v.id })
      } else if (k === 'r') {
        if (isMp) hudCmd({ type: 'toggleRcs', vesselId: v.id })
        else {
          v.rcsOn = !v.rcsOn
          handle(noteRcsPulse(sim, v))
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
          ? curSim.gs.vessels.filter((o) => o.ownerId === curSim.gs.ownerId && !o.debris && !o.station)
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
    const blur = () => { keys.current.clear(); releaseSpace() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [handle, hudCmd, stepMpWarpReq, switchTo, toast, toggleAutoLand, toggleMap])

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
      const ctrl: Controls = {
        rotate: (k.has('d') || k.has('ArrowRight') ? 1 : 0) - (k.has('a') || k.has('ArrowLeft') ? 1 : 0),
        tx: (k.has('l') ? 1 : 0) - (k.has('j') ? 1 : 0),
        ty: (k.has('i') ? 1 : 0) - (k.has('k') ? 1 : 0),
      }
      if (v) {
        let thChanged = false
        if (k.has('w') || k.has('ArrowUp') || k.has('Shift')) {
          v.autoLand = false
          v.autopilot = 'off'
          v.autopilotNote = undefined
          v.throttle = Math.min(1, v.throttle + dt * 0.8)
          thChanged = true
        }
        if (k.has('s') || k.has('ArrowDown') || k.has('Control')) {
          v.autoLand = false
          v.autopilot = 'off'
          v.autopilotNote = undefined
          v.throttle = Math.max(0, v.throttle - dt * 0.8)
          thChanged = true
        }
        if (isMp && thChanged && (now - lastThrottleSentAt.current >= 33 || v.throttle === 0 || v.throttle === 1)) {
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
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onWheel = (e: React.WheelEvent) => {
    const view = viewRef.current
    const f = Math.exp(-e.deltaY * 0.0012)
    if (view.map) view.mapZoom = Math.max(3e-9, Math.min(0.02, view.mapZoom * f))
    else view.zoom = Math.max(0.00012, Math.min(26, view.zoom * f))
  }
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onMove = (e: React.MouseEvent) => {
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
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
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
      const padTheta = playerPadAngle(s.gs, s.gs.ownerId)
      const onPad = s.gs.vessels.find(
        (o) => o.bodyId === 'earth' && o.landed && Math.abs(wrapPi(Math.atan2(o.pos.y, o.pos.x) - padTheta)) * BODIES.earth.radius < 25,
      )
      if (onPad) {
        toast('Rampa dolu: önce rampadaki aracı kurtar veya sil.', 'warn')
        return
      }
      const res = runCommand({ type: 'launch', design: local.design, designCargo: local.cargo })
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
    v.autopilotNote = undefined
    v.throttle = next
    if (s.gs.mp) {
      const now = performance.now()
      if (now - lastThrottleSentAt.current >= 33 || next === 0 || next === 1) {
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
      {alarm && !hud.landed && <div className="alarm-1202" role="alert">ERR 1202: EXEC OVERFLOW<small>İrtifa göstergesi devre dışı — göz kararı in!</small></div>}
      {hud.tea && <div className="tea-glass" title="Çayı dökme!">🍵</div>}
      <canvas
        ref={canvasRef}
        className="flight-canvas"
        title="Sürükle: kamerayı kaydır · Çift tık: rokete ortala"
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onDoubleClick={() => (viewRef.current.camPan = undefined)}
        onMouseLeave={() => (drag.current = null)}
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
        <button className="hud-btn" onClick={() => setPanel(panel === 'base' ? null : 'base')}>🏗️ Koloni</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'help' ? null : 'help')}>?</button>
        <span className="hud-money" title="Saatlik toplam pasif gelir (zaman hızlandırmada gelir en fazla 5× artar)">
          {fmt(hud.money)} ₡ <small className="income-sub">+{fmt(hud.passivePerHr)}/sa</small>
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
          <div className="mp-conquest-bar" title="Hedef seçmek için gezegene tıkla">
            {CONQUERABLE_BODIES.map((bid) => {
              const cap = hud.mpCaptures[bid]
              const owner = cap?.ownerId ? hud.mpPlayers.find((p) => p.id === cap.ownerId) : null
              const capturer = cap?.capturerId ? hud.mpPlayers.find((p) => p.id === cap.capturerId) : null
              const col = owner?.color ?? capturer?.color
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
          {hud.mpCaptures[hud.body] && (hud.mpCaptures[hud.body]!.phase === 'claiming' || hud.mpCaptures[hud.body]!.phase === 'neutralizing' || hud.mpCaptures[hud.body]!.phase === 'contested') && (
            <div className="mp-capture-banner">
              {hud.mpCaptures[hud.body]!.phase === 'contested' ? (
                <span>⇄ <b>{BODIES[hud.body].name}</b> yüzeyinde birden fazla oyuncu var — ilk çalışan Uzay İstasyonunu kuran koloniyi alır.</span>
              ) : hud.mpCaptures[hud.body]!.phase === 'claiming' ? (
                <span>
                  📍 <b>{BODIES[hud.body].name}</b> yüzey kontrolü — kolonileştirmek için kargodan <b>Uzay İstasyonu + 7 ⚡</b> kur!
                </span>
              ) : (
                <>
                  <span>
                    🛰️ <b>{BODIES[hud.body].name}</b> kolonisi el değiştiriyor…{' '}
                    {Math.round(hud.mpCaptures[hud.body]!.progress * 100)}%
                  </span>
                  <div className="mp-cap-bar">
                    <em
                      style={{
                        width: `${Math.round(hud.mpCaptures[hud.body]!.progress * 100)}%`,
                        background:
                          hud.mpPlayers.find((p) => p.id === (hud.mpCaptures[hud.body]!.capturerId ?? hud.mpCaptures[hud.body]!.ownerId))?.color ??
                          '#38d9e8',
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
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
            <div className="warp" title="Çok oyunculuda zaman herkes için sabit 2×; uzun yolculuklar için Hedefe Git (hızlı yolculuk)">
              <b>⏱ 2× sabit</b>
            </div>
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
              <span className="big">{BODIES[hud.body].name}</span>
              <span>Yükseklik</span><b className={alarm ? 'warn' : ''}>{alarm ? '— — —' : km(hud.alt)}</b>
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
            <div className="gauge"><span>{hud.tea ? '🫖 Dem' : 'Kademe yakıtı'}</span><i><em style={{ width: pct(hud.stageFuel, hud.stageCap) }} /></i><small>{hud.stageFuel.toFixed(1)} t</small></div>
            <div className="gauge"><span>{hud.tea ? '♨️ Sıcak Su' : 'Toplam yakıt'}</span><i><em style={{ width: pct(hud.fuel, hud.fuelCap) }} /></i><small>{hud.fuel.toFixed(1)} t</small></div>
            <div className="gauge ec"><span>Elektrik</span><i><em style={{ width: pct(hud.ec, hud.ecCap) }} /></i><small>{hud.ec.toFixed(0)}</small></div>
            {hud.cargo && <div className="cargo-line">Kargo: {hud.cargo}</div>}
            <div className="vessel-list">
              {hud.vessels.map((o) => (
                <div key={o.id} className="vessel-row">
                  <button className={o.active ? 'is-on' : ''} onClick={() => switchTo(o.id)}>{o.name}<small>{o.body}</small></button>
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
            <div className="target-bar">
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
              <button
                type="button"
                className={`mini-warp-btn${hud.autopilot === 'transfer' ? ' is-on' : ''}`}
                onClick={() => toggleAutopilot('transfer')}
                title="Seçili hedefe otomatik transfer başlat (yaklaşınca uyarı verir)"
              >
                🎯 Hedefe Git
              </button>
              <button
                type="button"
                className={`mini-warp-btn${hud.autopilot === 'orbit' ? ' is-on' : ''}`}
                onClick={() => toggleAutopilot('orbit')}
                title="Bulunulan gezegen çevresinde güvenli yörüngeye yerleş veya yakala"
              >
                🛰️ Yörünge
              </button>
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
              {isMap && (
                <>
                  <button type="button" className="mini-warp-btn" onClick={() => focusMapOn('ship')}>Gemi</button>
                  <button type="button" className="mini-warp-btn" onClick={() => focusMapOn(hud.targetBody)}>Hedef</button>
                </>
              )}
            </div>
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
                      act((v) => { v.autopilot = 'off'; v.sas = 'retrograde'; v.approachWarn = null })
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
                      act((v) => { v.autopilot = 'off'; v.autoLand = false; v.autopilotNote = undefined; v.sas = m })
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
              {hud.landed && hud.body !== 'earth' && <button className="hud-btn recover" onClick={() => setPanel('base')}>{baseBody.name} gridi</button>}
              {hud.landed && hud.body !== 'earth' && (
                <button className={`hud-btn recover${showCargo ? ' is-on' : ''}`} onClick={() => setShowCargo((x) => !x)}>🚚 Yükle / İndir</button>
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
                  act((v) => { v.autoLand = false; v.autopilot = 'off'; v.autopilotNote = undefined; v.throttle = v.throttle > 0 ? 0 : 1 })
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
          <h3 className="ach-title">Başarımlar ({hud.achievements.length})</h3>
          <p className="base-note">{hud.achievements.length ? hud.achievements.map((a) => ACH_NAMES[a] ?? a).join(' · ') : 'Henüz başarım yok. Evrende gizli sürprizler var…'}</p>
        </aside>
      )}

      {panel === 'base' && (
        <aside className="side-panel">
          <header><h2>🏗️ Koloni</h2><button onClick={() => setPanel(null)}>×</button></header>
          <PlanetGridPanel
            initialBody={hud.body}
            onNotify={(msg, kind) => toast(msg, kind)}
            onOpenTech={() => {
              setPanel(null)
              setShowTech(true)
            }}
          />

          {hud.has && hud.landed && hud.body !== 'earth' && (
            <div className="base-actions">
              <button className="hud-btn" onClick={() => setShowCargo(true)}>🚚 Yükle / İndir penceresini aç</button>
            </div>
          )}
        </aside>
      )}

      {panel === 'help' && (
        <aside className="side-panel">
          <header><h2>Kontroller</h2><button onClick={() => setPanel(null)}>×</button></header>
          <button className="button button-primary guide-open" onClick={() => setShowGuide(true)}>📘 Tam rehberi aç (Nasıl Oynanır?)</button>
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
          </ul>
          <p className="base-note">Gezegen ipucu: Haritada hedef seç (Venüs, Merkür, Mars, Ceres, Ganimed, Titan), transfer penceresinde yak ve iniş öncesi Oto-İniş veya paraşüt/ayakları aç!</p>
        </aside>
      )}

      {showGuide && <HowToPlay onClose={() => setShowGuide(false)} />}

      {showCargo && hud.has && hud.landed && hud.body !== 'earth' && (() => {
        const cv = activeVessel(curSim.gs)
        if (!cv) return null
        const cb = curSim.gs.bases[cv.bodyId]
        const cap = vesselStats(cv.parts).cargoCap
        const used = cargoMass(cv.cargo)
        const free = Math.max(0, cap - used)
        const tanks = cv.parts.filter((p) => partDef(p.def).kind === 'tank')
        const fuelNow = tanks.reduce((a, p) => a + (p.fuel ?? 0), 0)
        const fuelCap = tanks.reduce((a, p) => a + (partDef(p.def).fuel ?? 0), 0)
        const hasIsru = (cb?.modules.isru ?? 0) > 0
        const stock = Object.entries(cb?.stock ?? {}).filter(([, n]) => n > 0)
        const inCargo = Object.entries(cv.cargo.modules).filter(([id, n]) => n > 0 && id !== 'iss-supplies')
        const run = (cmd: GameCommand, sp: (v: Vessel) => string | null | GameEvent[]) => {
          if (hud.isMp) hudCmd(cmd)
          else act(sp)
        }
        const W = (tr: string, en: string) => (lang === 'en' ? en : tr)
        const modName = (id: string) => { const n = MODULE_BY_ID[id]?.name ?? id; return lang === 'en' ? T(n) : n }
        const bodyName = (id: BodyId) => (lang === 'en' ? T(BODIES[id].name) : BODIES[id].name)
        const img = (id: string) => `/assets/colony/${MODULE_BY_ID[id]?.sprite ?? 'battery'}.png`
        return (
          <section className="cargo-window" role="dialog" aria-label={W('Yükle / İndir', 'Load / Unload')} data-no-i18n>
            <header>
              <h2>🚚 {bodyName(cv.bodyId)} · {W('Yükle / İndir', 'Load / Unload')}</h2>
              <button onClick={() => setShowCargo(false)} aria-label={W('Kapat', 'Close')}>×</button>
            </header>
            <div className="cargo-capbar" title={W('Kargo gövdesi doluluğu', 'Cargo bay fill')}>
              <span>{W('Kargo', 'Cargo')}</span>
              <i><em style={{ width: pct(used, cap) }} /></i>
              <small>{used.toFixed(1)} / {cap} t</small>
            </div>
            <div className="cargo-cols">
              <div className="cargo-col">
                <h3>{W('⬆ Gemiye al', '⬆ Take on board')}</h3>
                <div className="cargo-row">
                  <span className="cargo-ico">⛏️</span>
                  <div><b>{W('Maden', 'Ore')}</b><small>{W('Depoda', 'In storage')} {(cb?.ore ?? 0).toFixed(1)} t</small></div>
                  <button
                    className="hud-btn"
                    disabled={!cb || (cb.ore ?? 0) < 0.01 || free < 0.01}
                    onClick={() => run({ type: 'loadOre', vesselId: cv.id }, (v) => loadOre(sim, v))}
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
                    onClick={() => run({ type: 'refuelAtBase', vesselId: cv.id }, (v) => refuelAtBase(sim, v))}
                  >
                    {W('Doldur', 'Refuel')}
                  </button>
                </div>
                {stock.length === 0 ? (
                  <p className="cargo-empty">{W('Depoda kurulmamış yapı yok.', 'No unbuilt buildings in storage.')}</p>
                ) : (
                  stock.map(([id, n]) => (
                    <div key={id} className="cargo-row">
                      <img className="cargo-ico" src={img(id)} alt="" />
                      <div><b>{modName(id)} ×{n}</b><small>{W('Depoda', 'In storage')} · {MODULE_BY_ID[id]?.mass ?? 0} t</small></div>
                      <button
                        className="hud-btn"
                        disabled={free + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                        onClick={() => run({ type: 'pickupModule', vesselId: cv.id, moduleId: id }, (v) => pickupModule(sim, v, id))}
                      >
                        {W('Al', 'Take')}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="cargo-col">
                <h3>{W('⬇ İndir', '⬇ Unload')}</h3>
                {inCargo.length === 0 ? (
                  <p className="cargo-empty">{W('Kargoda indirilecek yapı yok.', 'No buildings in cargo to unload.')}</p>
                ) : (
                  inCargo.map(([id, n]) => (
                    <div key={id} className="cargo-row">
                      <img className="cargo-ico" src={img(id)} alt="" />
                      <div><b>{modName(id)} ×{n}</b><small>{W('Boş yuvaya kurulur', 'Built into an empty slot')}</small></div>
                      <button
                        className="hud-btn"
                        onClick={() => run({ type: 'deployModules', vesselId: cv.id, moduleId: id }, (v) => deployModules(sim, v, id))}
                      >
                        {W('İndir', 'Unload')}
                      </button>
                    </div>
                  ))
                )}
                {cv.cargo.ore > 0.01 && (
                  <div className="cargo-row">
                    <span className="cargo-ico">⛏️</span>
                    <div><b>{W('Maden', 'Ore')} {cv.cargo.ore.toFixed(1)} t</b><small>{W("Dünya'ya götür, inince satılır", 'Take it to Earth; it sells on landing')}</small></div>
                  </div>
                )}
                {inCargo.length > 1 && (
                  <button
                    className="hud-btn cargo-all"
                    onClick={() => run({ type: 'deployModules', vesselId: cv.id }, (v) => deployModules(sim, v))}
                  >
                    {W('Hepsini indir ve kur', 'Unload and build all')}
                  </button>
                )}
              </div>
            </div>
          </section>
        )
      })()}

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
            <p className="eyebrow"><span /> GEZEGEN FETİH SONUCU</p>
            <h2>
              🏆{' '}
              <span style={{ color: hud.mpPlayers.find((p) => p.id === hud.mpWinnerId)?.color }}>
                {hud.mpPlayers.find((p) => p.id === hud.mpWinnerId)?.username ?? hud.mpWinnerId}
              </span>{' '}
              Kazandı!
            </h2>
            <p>
              {hud.mpWinnerId === hud.myId
                ? 'Tebrikler! Güneş Sisteminin yeni hakimi sensin!'
                : 'Rakibin hedef gezegen sayısına ulaştı. Bir sonraki turda rövanşı alabilirsin!'}
            </p>
            <div className="mp-final-table">
              {hud.mpPlayers.map((p, idx) => (
                <div key={p.id} className="mp-score-row">
                  <span>#{idx + 1}</span>
                  <i className="mp-dot" style={{ background: p.color }} />
                  <span className="mp-s-name">{p.username}</span>
                  <span className="mp-s-flags">🚩 {p.planetsHeld}</span>
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

      {!confirmDel && !wreck && !(hud.isMp && hud.mpWinnerId) && (lost || (noVesselReady && !hud.has && !(hud.isMp && isMpPendingLaunch()))) && (
        <div className="dialog-backdrop">
          <section className="dialog">
            <h2>{lost ? 'Araç kaybedildi' : 'Aktif araç yok'}</h2>
            <p>
              {lost ?? `Kontrol edilecek bir araç seç ya da montaj binasında yeni roket kur. Dünya üssün şu an +${fmt(hud.passivePerHr)} ₡/sa pasif gelir üretiyor!`}
            </p>
            <div className="row">
              <button className="button button-primary" onClick={quickLaunch}>🚀 Tasarımı Fırlat</button>
              <button className="button button-secondary" onClick={onBuilder}>Montaj binası</button>
              <button className="button button-secondary" onClick={() => setPanel('base')}>Üsler</button>
              {hud.vessels.map((o) => <button key={o.id} className="button button-secondary" onClick={() => switchTo(o.id)}>{o.name} · {o.body}</button>)}
            </div>
          </section>
        </div>
      )}

    </main>
  )
}
