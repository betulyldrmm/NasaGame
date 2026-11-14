import { useCallback, useEffect, useRef, useState } from 'react'
import { MODULE_BY_ID } from '../game/base'
import { MISSIONS } from '../game/missions'
import { bump, saveGame, sim, useAuthState } from '../game/store'
import { hasAffordableTech, hasAutoLandTech } from '../game/tech'
import type { AutopilotMode, GameEvent, SasMode, Vessel } from '../game/types'
import { activeEngines, cargoMass, estimateDeltaV, fuelGroups, vesselStats } from '../game/vessel'
import { partDef } from '../game/data'
import { bodyAbsState, bodyRelState, elementsFromState, hohmann, len, wrapPi } from '../flight/orbit'
import { type Controls, effectiveAutopilot, landingTolerance, pressureRatio, situation } from '../flight/physics'
import { type Patch, predictTrajectory } from '../flight/predict'
import {
  activeVessel,
  clickPart,
  deployModules,
  launchDesign,
  loadOre,
  recoverVessel,
  refuelAtBase,
  setActive,
  setVesselAutopilot,
  deleteVessel,
  dockCandidate,
  dockVessels,
  stepWorld,
  toggleKind,
  totalPassiveIncomePerHour,
  WARPS,
} from '../flight/world'
import { BODIES, type BodyId, gameDate } from '../nasa/bodies'
import { createView, type FlightFrame, type MapFrame, pickPart, pickVesselFlight, renderFlight, renderMap } from '../render/renderer'
import PlanetGridPanel from './PlanetGridPanel'
import TechTreeModal from './TechTreeModal'

const DESTINATIONS: BodyId[] = ['moon', 'earth', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']
const QUICK_WARPS = [
  { label: '1×', idx: 0 },
  { label: '25×', idx: 4 },
]

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const km = (m: number) => (Math.abs(m) >= 1e7 ? `${(m / 1e6).toFixed(2)} Mm` : Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`)
const dur = (s: number) => (s >= 7200 ? `${(s / 3600).toFixed(1)} sa` : s >= 120 ? `${(s / 60).toFixed(0)} dk` : `${s.toFixed(0)} sn`)

interface Hud {
  has: boolean
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
  missionNext: string
  hasLegs: boolean
  legsOpen: boolean
  hasChutes: boolean
  chutesOpen: boolean
  hasSolar: boolean
  solarOpen: boolean
  canTech: boolean
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
  const gs = sim.gs
  const v = activeVessel(gs)
  const targetBody = (gs.targetBody ?? 'moon') as BodyId
  const base: Hud = {
    has: false,
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
    hasAutoLand: hasAutoLandTech(gs),
    sas: 'off',
    warp: WARPS[sim.warpIdx]!,
    warpIdx: sim.warpIdx,
    money: gs.money,
    passivePerHr: totalPassiveIncomePerHour(gs),
    date: gameDate(gs.time).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }),
    dv: 0,
    tol: 7,
    vessels: gs.vessels.map((o) => ({ id: o.id, name: o.name, body: BODIES[o.bodyId].name + (o.landed ? ' (yüzeyde)' : ''), active: o.id === gs.activeId })),
    plan: [],
    targetBody,
    cargo: '',
    twr: 0,
    dockName: null,
    missionNext: MISSIONS.find((m) => !gs.missionsDone.includes(m.id))?.title ?? 'Tüm görevler tamamlandı',
    hasLegs: false,
    legsOpen: false,
    hasChutes: false,
    chutesOpen: false,
    hasSolar: false,
    solarOpen: false,
    canTech: hasAffordableTech(gs),
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
    hasLegs: st.legs > 0,
    legsOpen: st.legs > 0 && st.legsDeployed >= st.legs,
    hasChutes: st.chutes > 0,
    chutesOpen: st.chutes > 0 && st.chutesDeployed >= st.chutes,
    hasSolar: v.parts.some((p) => partDef(p.def).kind === 'solar'),
    solarOpen: v.parts.some((p) => partDef(p.def).kind === 'solar' && p.deployed),
  }
}

interface Props {
  onBuilder: () => void
}

export default function FlightScreen({ onBuilder }: Props) {
  const auth = useAuthState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef(createView())
  const keys = useRef(new Set<string>())
  const flightFrame = useRef<FlightFrame>({ cam: null, hits: [] })
  const mapFrame = useRef<MapFrame>({ vessels: [], bodies: [] })
  const patchesRef = useRef<Patch[]>([])
  const [hud, setHud] = useState<Hud>(snapshot)
  const [isMap, setIsMap] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([])
  const [lost, setLost] = useState<string | null>(null)
  const [panel, setPanel] = useState<'missions' | 'base' | 'help' | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ id: number; name: string } | null>(null)
  const [showTech, setShowTech] = useState(false)
  const toastId = useRef(0)
  const spaceThrottle = useRef<{ vesselId: number; previousThrottle: number } | null>(null)

  const toast = useCallback((text: string, kind = 'info') => {
    const id = (toastId.current += 1)
    setToasts((t) => [...t.slice(-4), { id, text, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'mission' ? 7000 : 4200)
  }, [])

  const handle = useCallback((events: GameEvent[]) => {
    for (const e of events) {
      if (e.type === 'toast') toast(e.text)
      else if (e.type === 'mission') toast(`Görev tamamlandı: ${e.title}  +${fmt(e.reward)} ₡`, 'mission')
      else if (e.type === 'soi') toast(`${BODIES[e.to].name} etki alanına girildi (${BODIES[e.from].name} → ${BODIES[e.to].name}).`)
      else if (e.type === 'crash') {
        if (e.wasActive) setLost(`${e.name} ${e.reason}.`)
        else toast(`${e.name} ${e.reason}.`, 'warn')
      }
    }
  }, [toast])

  const toggleMap = useCallback(() => {
    const view = viewRef.current
    view.map = !view.map
    if (view.map) {
      const v = activeVessel(sim.gs)
      view.mapFocus = v ? (v.bodyId === 'sun' ? 'ship' : v.bodyId) : 'earth'
      view.mapPan = { x: 0, y: 0 }
      const b = v ? BODIES[v.bodyId] : BODIES.earth
      const span = v ? Math.max(len(v.pos) * 1.6, b.radius * 2.5) : b.radius * 3
      const sunSpan = v ? Math.max(len(v.pos) * 1.4, BODIES.mars.orbit!.a * 1.2) : BODIES.mars.orbit!.a * 1.2
      view.mapZoom = Math.min(view.w, view.h) / 2 / (v?.bodyId === 'sun' ? sunSpan : span)
    }
    setIsMap(view.map)
  }, [])

  const act = useCallback((fn: (v: Vessel) => GameEvent[] | string | null | void) => {
    const v = activeVessel(sim.gs)
    if (!v) return
    const res = fn(v)
    if (typeof res === 'string') toast(res, 'warn')
    else if (Array.isArray(res)) handle(res)
    setHud(snapshot())
    bump()
  }, [handle, toast])

  const switchTo = useCallback((id: number) => {
    setActive(sim, id)
    const view = viewRef.current
    view.map = false
    view.zoom = 5
    setIsMap(false)
    setLost(null)
    setHud(snapshot())
  }, [])

  const toggleAutopilot = useCallback(
    (mode: 'orbit' | 'transfer' | 'land') => {
      if (mode === 'land' && !hasAutoLandTech(sim.gs)) {
        setShowTech(true)
        toast('Otomatik İniş Bilgisayarı için "Gelişmiş İniş" araştırmasını açmalısın.', 'warn')
        return
      }
      const v = activeVessel(sim.gs)
      if (!v) return
      const cur = effectiveAutopilot(v)
      const next: AutopilotMode = cur === mode ? 'off' : mode
      const err = setVesselAutopilot(sim, v, next)
      if (err) {
        toast(err, 'warn')
        return
      }
      if (next === 'off') v.throttle = 0
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

  // klavye
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) e.preventDefault()
      if (e.repeat) return
      keys.current.add(k)
      const v = activeVessel(sim.gs)
      if (k === 'm') toggleMap()
      else if (k === '.') sim.warpIdx = Math.min(WARPS.length - 1, sim.warpIdx + 1)
      else if (k === ',') sim.warpIdx = Math.max(0, sim.warpIdx - 1)
      else if (!v) return
      else if (k === ' ') {
        if (!spaceThrottle.current) {
          spaceThrottle.current = { vesselId: v.id, previousThrottle: v.throttle }
          v.autoLand = false
          v.throttle = 1
        }
      }
      else if (k === 'z') v.throttle = 1
      else if (k === 'x') { spaceThrottle.current = null; v.throttle = 0; v.autoLand = false; v.autopilot = 'off'; v.autopilotNote = undefined }
      else if (k === 'r') v.rcsOn = !v.rcsOn
      else if (k === 't') v.sas = (['off', 'prograde', 'retrograde', 'radial'] as SasMode[])[((['off', 'prograde', 'retrograde', 'radial'] as SasMode[]).indexOf(v.sas) + 1) % 4]!
      else if (k === 'p') { const o = toggleKind(v, 'chute'); if (o !== null) toast(`Paraşütler ${o ? 'açıldı' : 'kapandı'}`) }
      else if (k === 'g') { const o = toggleKind(v, 'leg'); if (o !== null) toast(`İniş ayakları ${o ? 'açıldı' : 'kapandı'}`) }
      else if (k === 'o') { const o = toggleKind(v, 'solar'); if (o !== null) toast(`Güneş panelleri ${o ? 'açıldı' : 'kapandı'}`) }
      else if (k === 'l' && !v.rcsOn) toggleAutoLand()
      else if (k === 'Tab') {
        const list = sim.gs.vessels
        if (list.length > 1) switchTo(list[(list.findIndex((o) => o.id === v.id) + 1) % list.length]!.id)
      }
    }
    const releaseSpace = () => {
      const pulse = spaceThrottle.current
      if (!pulse) return
      const vessel = sim.gs.vessels.find((ship) => ship.id === pulse.vesselId)
      if (vessel) vessel.throttle = pulse.previousThrottle
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
  }, [handle, switchTo, toast, toggleAutoLand, toggleMap])

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
      const v = activeVessel(sim.gs)
      const ctrl: Controls = {
        rotate: (k.has('d') || k.has('ArrowRight') ? 1 : 0) - (k.has('a') || k.has('ArrowLeft') ? 1 : 0),
        tx: (k.has('l') ? 1 : 0) - (k.has('j') ? 1 : 0),
        ty: (k.has('i') ? 1 : 0) - (k.has('k') ? 1 : 0),
      }
      if (v) {
        if (k.has('w') || k.has('ArrowUp') || k.has('Shift')) {
          v.autoLand = false
          v.autopilot = 'off'
          v.autopilotNote = undefined
          v.throttle = Math.min(1, v.throttle + dt * 0.8)
        }
        if (k.has('s') || k.has('ArrowDown') || k.has('Control')) {
          v.autoLand = false
          v.autopilot = 'off'
          v.autopilotNote = undefined
          v.throttle = Math.max(0, v.throttle - dt * 0.8)
        }
      }
      for (const ship of sim.gs.vessels) {
        for (const part of ship.parts) {
          if (partDef(part.def).kind !== 'leg') continue
          const target = part.deployed ? 1 : 0
          if (part.deployProgress === undefined) part.deployProgress = target
          else part.deployProgress += Math.sign(target - part.deployProgress) * Math.min(Math.abs(target - part.deployProgress), dt * 2.2)
        }
      }
      view.rcsTx = v?.rcsOn ? ctrl.tx : 0
      const events = stepWorld(sim, dt, ctrl)
      if (events.length) handle(events)
      const cur = activeVessel(sim.gs)
      if (n % 3 === 0) patchesRef.current = cur && !cur.landed ? predictTrajectory(cur.bodyId, cur.pos, cur.vel, sim.gs.time) : []
      if (view.map) mapFrame.current = renderMap(ctx, sim, view, patchesRef.current)
      else flightFrame.current = renderFlight(ctx, sim, view, patchesRef.current)
      if (n % 6 === 0) setHud(snapshot())
      if (now - lastSave > 4000) {
        lastSave = now
        void saveGame()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      void saveGame(true)
      bump()
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
    if (!d || !view.map) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) {
      view.mapPan = { x: view.mapPan.x - dx / view.mapZoom, y: view.mapPan.y + dy / view.mapZoom }
      d.x = e.clientX
      d.y = e.clientY
    }
  }
  const onUp = (e: React.MouseEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const view = viewRef.current
    const x = e.clientX
    const y = e.clientY
    if (view.map) {
      const hitV = mapFrame.current.vessels.find((o) => Math.hypot(o.x - x, o.y - y) < 16)
      if (hitV) {
        if (hitV.id !== sim.gs.activeId) switchTo(hitV.id)
        return
      }
      const hitB = [...mapFrame.current.bodies].reverse().find((b) => Math.hypot(b.x - x, b.y - y) < Math.max(b.r, 12))
      if (hitB) {
        view.mapFocus = hitB.id
        view.mapPan = { x: 0, y: 0 }
      }
      return
    }
    const other = pickVesselFlight(flightFrame.current, sim, x, y)
    if (other !== null) {
      switchTo(other)
      return
    }
    const v = activeVessel(sim.gs)
    if (v) {
      const i = pickPart(flightFrame.current, v, x, y)
      if (i >= 0) handle(clickPart(sim, v, i))
    }
  }

  const base = sim.gs.bases[hud.body]
  const baseBody = BODIES[hud.body]
  const pct = (a: number, b: number) => `${b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0}%`

  const focusMapOn = (target: BodyId | 'ship') => {
    const view = viewRef.current
    if (!view.map) return
    view.mapFocus = target
    view.mapPan = { x: 0, y: 0 }
    if (target === 'ship') {
      const cur = activeVessel(sim.gs)
      if (cur) view.mapZoom = Math.min(view.w, view.h) / 2 / Math.max(len(cur.pos) * 1.8, BODIES[cur.bodyId].radius * 2.8)
    } else {
      const b = BODIES[target]
      view.mapZoom = Math.min(view.w, view.h) / 2 / Math.max(b.soi * 1.4, b.radius * 4)
    }
  }

  const quickLaunch = () => {
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
    act((v) => {
      v.autoLand = false
      v.autopilot = 'off'
      v.autopilotNote = undefined
      v.throttle = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    })
  }

  return (
    <main className="flight">
      <canvas ref={canvasRef} className="flight-canvas" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => (drag.current = null)} />

      <div className="hud hud-tl">
        <button className="hud-btn" onClick={onBuilder}>☰ Montaj</button>
        <button className={`hud-btn${isMap ? ' is-on' : ''}`} onClick={toggleMap}>{isMap ? 'Uçuş (M)' : 'Harita (M)'}</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'missions' ? null : 'missions')}>🎯 Görevler</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'base' ? null : 'base')}>🪐 Koloni Gridi</button>
        <button className={`hud-btn${hud.canTech ? ' has-ready' : ''}`} onClick={() => setShowTech(true)}>🧬 Ar-Ge{hud.canTech ? ' •' : ''}</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'help' ? null : 'help')}>?</button>
        <span className="hud-money" title="Saatlik toplam pasif gelir (zaman hızlandırmada gelir en fazla 5× artar)">
          {fmt(hud.money)} ₡ <small className="income-sub">+{fmt(hud.passivePerHr)}/sa</small>
        </span>
        <button className="hud-btn" title="Geçici test kredisi" onClick={() => { sim.gs.money += 100_000; setHud(snapshot()); bump(); void saveGame(true) }}>+100.000 ₡</button>
        {auth.user && <span className="hud-user">👤 {auth.user.username}</span>}
      </div>

      <div className="hud hud-tr">
        <div className="warp" title="Zaman hızlandırma (, / .) — pasif gelir en fazla 5× hızlanır">
          {QUICK_WARPS.map((w) => (
            <button
              key={w.label}
              className={`mini-warp-btn${hud.warpIdx === w.idx ? ' is-on' : ''}`}
              onClick={() => {
                sim.warpIdx = w.idx
                setHud(snapshot())
              }}
            >
              {w.label}
            </button>
          ))}
          <button className="hud-btn" onClick={() => { sim.warpIdx = Math.max(0, sim.warpIdx - 1); setHud(snapshot()) }} aria-label="Yavaşlat">◀◀</button>
          <b>{hud.warp.toLocaleString('tr-TR')}×</b>
          <button className="hud-btn" onClick={() => { sim.warpIdx = Math.min(WARPS.length - 1, sim.warpIdx + 1); setHud(snapshot()) }} aria-label="Hızlandır">▶▶</button>
        </div>
        <div className="readout">
          <span>{hud.date}</span>
          {hud.has && (
            <>
              <span className="big">{BODIES[hud.body].name}</span>
              <span>Yükseklik</span><b>{km(hud.alt)}</b>
              <span>Hız</span><b>{hud.speed.toFixed(1)} m/s</b>
              <span>Dikey</span><b className={hud.vr < -hud.tol && hud.alt < 2000 ? 'bad' : ''}>{hud.vr.toFixed(1)} m/s</b>
              {hud.apo !== null && <><span>Öte nokta</span><b>{km(hud.apo)}</b></>}
              {hud.peri !== null && <><span>Enberi</span><b className={hud.peri < 0 ? 'warn' : ''}>{km(hud.peri)}</b></>}
              <span>Kalan Δv</span><b>{fmt(hud.dv)} m/s</b>
              <span>TWR</span><b className={hud.twr >= 1.2 ? 'ok' : hud.twr >= 1 ? 'warn' : hud.landed ? 'bad' : ''}>{hud.twr.toFixed(2)}</b>
            </>
          )}
        </div>
        <div className="next-mission">Sıradaki görev: <b>{hud.missionNext}</b></div>
      </div>

      {hud.has && (
        <>
          <div className="hud hud-bl">
            <div className="gauge"><span>Kademe yakıtı</span><i><em style={{ width: pct(hud.stageFuel, hud.stageCap) }} /></i><small>{hud.stageFuel.toFixed(1)} t</small></div>
            <div className="gauge"><span>Toplam yakıt</span><i><em style={{ width: pct(hud.fuel, hud.fuelCap) }} /></i><small>{hud.fuel.toFixed(1)} t</small></div>
            <div className="gauge ec"><span>Elektrik</span><i><em style={{ width: pct(hud.ec, hud.ecCap) }} /></i><small>{hud.ec.toFixed(0)}</small></div>
            {hud.cargo && <div className="cargo-line">Kargo: {hud.cargo}</div>}
            <div className="vessel-list">
              {hud.vessels.map((o) => (
                <div key={o.id} className="vessel-row">
                  <button className={o.active ? 'is-on' : ''} onClick={() => switchTo(o.id)}>{o.name}<small>{o.body}</small></button>
                  <button className="vessel-del" title={`${o.name} aracını sil`} aria-label={`${o.name} aracını sil`} onClick={() => setConfirmDel({ id: o.id, name: o.name })}>🗑</button>
                </div>
              ))}
            </div>
          </div>

          <div className="hud hud-bc">
            <div className="target-bar">
              <span>Hedef:</span>
              <select
                value={hud.targetBody}
                onChange={(e) => {
                  sim.gs.targetBody = e.target.value as BodyId
                  setHud(snapshot())
                  void saveGame()
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
            {hud.autopilot !== 'off' && hud.autopilotNote && (
              <div className="autopilot-note">{hud.autopilotNote}</div>
            )}
            {isMap && hud.plan.map((p) => <div key={p} className="plan">{p}</div>)}
            {!hud.landed && ((hud.approachWarn && !hud.hasAutoLand) || (hud.landable && hud.vr < -12 && hud.alt < 25000 && !hud.hasAutoLand && hud.autopilot !== 'orbit')) && (
              <div className="approach-warn">
                <span>
                  ⚠ <b>{BODIES[hud.approachWarn ?? hud.body].name} yaklaşma uyarısı</b> ({km(hud.alt)} · {hud.speed.toFixed(0)} m/s) — Otomatik iniş henüz kapalı!
                </span>
                <button type="button" className="mini-warp-btn" onClick={() => act((v) => { v.autopilot = 'off'; v.sas = 'retrograde'; v.approachWarn = null })}>
                  T: Geri Dön
                </button>
                <button type="button" className="mini-warp-btn" onClick={() => toggleAutopilot('orbit')}>
                  🛰️ Yörüngeye Gir
                </button>
              </div>
            )}
            {!isMap && !hud.landed && hud.landable && hud.alt < 1200 && hud.vr < -4 && (
              <div className="land-alert">
                {hud.hasLegs && !hud.legsOpen
                  ? 'İniş yaklaşıyor: ayakları aç (G)!'
                  : hud.speed > hud.tol
                    ? `İniş hızı ${hud.speed.toFixed(0)} m/s (güvenli ≤ ${hud.tol} m/s)`
                    : `İnişe hazır (${hud.speed.toFixed(1)} m/s)`}
              </div>
            )}
            <div className="row">
              {(['off', 'prograde', 'retrograde'] as SasMode[]).map((m) => (
                <button
                  key={m}
                  className={`hud-btn${hud.sas === m ? ' is-on' : ''}`}
                  onClick={() => act((v) => { v.autopilot = 'off'; v.autoLand = false; v.autopilotNote = undefined; v.sas = m })}
                >
                  {m === 'off' ? 'Serbest' : m === 'prograde' ? 'İleri ▲' : 'Geri ▼'}
                </button>
              ))}
              {hud.hasLegs && (
                <button className={`hud-btn${hud.legsOpen ? ' is-on' : ''}`} onClick={() => act((v) => { toggleKind(v, 'leg') })}>
                  🦵 Ayaklar
                </button>
              )}
              {hud.hasChutes && (
                <button className={`hud-btn${hud.chutesOpen ? ' is-on' : ''}`} onClick={() => act((v) => { toggleKind(v, 'chute') })}>
                  🪂 Paraşüt
                </button>
              )}
              {hud.hasSolar && (
                <button className={`hud-btn${hud.solarOpen ? ' is-on' : ''}`} onClick={() => act((v) => { toggleKind(v, 'solar') })}>
                  ☀️ Panel
                </button>
              )}
              {hud.dockName && (
                <button
                  className="hud-btn recover"
                  onClick={() => act((v) => {
                    const target = dockCandidate(sim.gs, v)
                    return target ? dockVessels(sim, v, target) : null
                  })}
                >
                  Kenetlen: {hud.dockName}
                </button>
              )}
              {hud.landed && hud.body === 'earth' && <button className="hud-btn recover" onClick={() => act((v) => recoverVessel(sim, v))}>Aracı kurtar</button>}
              {hud.landed && hud.body !== 'earth' && <button className="hud-btn recover" onClick={() => setPanel('base')}>{baseBody.name} gridi</button>}
            </div>
          </div>

          <div className="hud hud-br">
            <button className={`hud-btn${hud.throttle > 0 ? ' is-on' : ''}`} onClick={() => act((v) => { v.autoLand = false; v.autopilot = 'off'; v.autopilotNote = undefined; v.throttle = v.throttle > 0 ? 0 : 1 })}>{hud.throttle > 0 ? 'Açık' : 'Kapalı'}</button>
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

      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>

      {panel === 'missions' && (
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
          <header><h2>🪐 Koloni Gridi</h2><button onClick={() => setPanel(null)}>×</button></header>
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
              <p>İnen araç: <b>{hud.name}</b>{hud.cargo ? ` — ${hud.cargo}` : ''}</p>
              {hud.cargo && <button className="hud-btn" onClick={() => act((v) => deployModules(sim, v))}>Kargodaki modülleri kur</button>}
              {base && <button className="hud-btn" onClick={() => act((v) => loadOre(sim, v))}>Madeni araca yükle</button>}
              {base && <button className="hud-btn" onClick={() => act((v) => refuelAtBase(sim, v))}>Yakıt ikmali (ISRU: 1 t maden → 4 t yakıt)</button>}
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
            <li><kbd>L</kbd> Otomatik İniş Bilgisayarı (Teknoloji Ağacıyla açılır)</li>
            <li><kbd>Boşluk</kbd> basılı tut: motor itkisi · kademeyi ayırmak için adaptöre tıkla</li>
            <li><kbd>M</kbd> uzay haritası · tekerlek: yakınlaş/uzaklaş · sürükle: kaydır</li>
            <li><kbd>,</kbd>/<kbd>.</kbd> zamanı yavaşlat / hızlandır (fizikte 25×, yörüngede 100.000×)</li>
            <li><kbd>P</kbd> paraşüt · <kbd>G</kbd> iniş ayakları · <kbd>O</kbd> güneş panelleri</li>
            <li><kbd>R</kbd> RCS'yi aç · <kbd>I</kbd>/<kbd>K</kbd> ileri/geri · <kbd>J</kbd>/<kbd>L</kbd> sola/sağa</li>
            <li><kbd>Tab</kbd> ya da araca tıkla: başka gemiye geç</li>
          </ul>
          <p className="base-note">Gezegen ipucu: Haritada hedef seç (Venüs, Merkür, Mars, Ceres, Ganimed, Titan), transfer penceresinde yak ve iniş öncesi Oto-İniş veya paraşüt/ayakları aç!</p>
        </aside>
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
                  deleteVessel(sim, confirmDel.id)
                  setConfirmDel(null)
                  setHud(snapshot())
                  void saveGame(true)
                  bump()
                  toast(`${confirmDel.name} silindi.`)
                }}
              >
                Evet, sil
              </button>
              <button className="button button-secondary" onClick={() => setConfirmDel(null)}>Vazgeç</button>
            </div>
          </section>
        </div>
      )}

      {!confirmDel && (lost || !hud.has) && (
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
              <button className="button button-secondary" onClick={() => setShowTech(true)}>Ar-Ge</button>
              {hud.vessels.map((o) => <button key={o.id} className="button button-secondary" onClick={() => switchTo(o.id)}>{o.name} · {o.body}</button>)}
            </div>
          </section>
        </div>
      )}

      {showTech && <TechTreeModal onClose={() => setShowTech(false)} />}
    </main>
  )
}
