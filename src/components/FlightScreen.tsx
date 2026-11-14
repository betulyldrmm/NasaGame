import { useCallback, useEffect, useRef, useState } from 'react'
import { baseReport, MODULE_BY_ID, MODULES } from '../game/base'
import { MISSIONS } from '../game/missions'
import { bump, saveGame, sim, useAuthState } from '../game/store'
import { baseIncomeMultiplier, hasAutoLandTech, isModuleUnlocked, orePriceMultiplier, requiredTechForModule } from '../game/tech'
import type { GameEvent, SasMode, Vessel } from '../game/types'
import { activeEngines, cargoMass, estimateDeltaV, fuelGroups, nextStage, vesselStats } from '../game/vessel'
import { partDef } from '../game/data'
import { bodyAbsState, bodyRelState, elementsFromState, hohmann, len, wrapPi } from '../flight/orbit'
import { type Controls, landingTolerance, pressureRatio, situation } from '../flight/physics'
import { type Patch, predictTrajectory } from '../flight/predict'
import {
  activeVessel,
  buyEarthModule,
  clickPart,
  deployModules,
  loadOre,
  recoverVessel,
  refuelAtBase,
  setActive,
  deleteVessel,
  dockCandidate,
  dockVessels,
  stageNext,
  stepWorld,
  toggleKind,
  totalPassiveIncomePerHour,
  WARPS,
} from '../flight/world'
import { BODIES, type BodyId, gameDate, solarFlux } from '../nasa/bodies'
import { createView, type FlightFrame, type MapFrame, pickPart, pickVesselFlight, renderFlight, renderMap } from '../render/renderer'
import TechTreeModal from './TechTreeModal'

const DESTINATIONS: BodyId[] = ['moon', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']
const QUICK_WARPS = [
  { label: '1×', idx: 0 },
  { label: '4×', idx: 2 },
  { label: '10×', idx: 3 },
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
  sas: SasMode
  rcs: boolean
  hasRcs: boolean
  warp: number
  warpIdx: number
  money: number
  passivePerHr: number
  date: string
  dv: number
  mass: number
  tol: number
  vessels: { id: number; name: string; body: string; active: boolean }[]
  plan: string[]
  targetBody: BodyId
  cargo: string
  stageLeft: number
  twr: number
  dockName: string | null
  missionNext: string
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
      out.push(`Ay transferi: ileri yönde ≈ ${h.dv1.toFixed(0)} m/s · pencere ${dur(wait)} sonra (faz ${(phase * 57.3).toFixed(0)}° → ${(h.phase * 57.3).toFixed(0)}°)`)
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
        const dirText = p.a < e.a ? 'Dünya hareketinin tersi' : 'Dünya hareketi yönünde'
        out.push(`${label} transferi: ≈ ${eject.toFixed(0)} m/s (${dirText}) · faz ${(ph * 57.3).toFixed(0)}° (ideal ${(hm.phase * 57.3).toFixed(0)}°) · pencere ${dur(d / Math.max(1e-9, Math.abs(rate)))} sonra`)
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
      out.push(`${target.name} güneş transferi: ${hm.dv1 >= 0 ? 'ileri' : 'geri'} ≈ ${Math.abs(hm.dv1).toFixed(0)} m/s · pencere ${dur(d / Math.max(1e-9, Math.abs(rate)))} sonra`)
    }
  } else {
    const vEsc = Math.sqrt((2 * body.mu) / r)
    out.push(`${body.name} kaçış hızı burada ${vEsc.toFixed(0)} m/s (şu an ${len(v.vel).toFixed(0)} m/s)`)
    if ((v.bodyId === 'jupiter' && targetBody === 'ganymede') || (v.bodyId === 'saturn' && targetBody === 'titan')) {
      const m = BODIES[targetBody]
      const hm = hohmann(body.mu, r, m.orbit!.a, m.orbit!.n)
      const ms = bodyRelState(m, t).r
      const phase = wrapPi(Math.atan2(ms.y, ms.x) - shipAngle)
      let diff = wrapPi(phase - hm.phase) * el.dir
      if (diff < 0) diff += 2 * Math.PI
      out.push(`${m.name} yakalama: ≈ ${Math.abs(hm.dv1).toFixed(0)} m/s · pencere ${dur(diff / Math.max(1e-9, Math.abs(nShip - m.orbit!.n)))} sonra`)
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
    sas: 'off',
    rcs: false,
    hasRcs: false,
    warp: WARPS[sim.warpIdx]!,
    warpIdx: sim.warpIdx,
    money: gs.money,
    passivePerHr: totalPassiveIncomePerHour(gs),
    date: gameDate(gs.time).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }),
    dv: 0,
    mass: 0,
    tol: 7,
    vessels: gs.vessels.map((o) => ({ id: o.id, name: o.name, body: BODIES[o.bodyId].name + (o.landed ? ' (yüzeyde)' : ''), active: o.id === gs.activeId })),
    plan: [],
    targetBody,
    cargo: '',
    stageLeft: 0,
    twr: 0,
    dockName: null,
    missionNext: MISSIONS.find((m) => !gs.missionsDone.includes(m.id))?.title ?? 'Tüm görevler tamamlandı',
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
    sas: v.sas,
    rcs: v.rcsOn,
    hasRcs: st.rcs > 0,
    dv: estimateDeltaV(v.parts, cargoMass(v.cargo)).reduce((a, x) => a + x.dv, 0),
    mass: st.mass,
    tol: landingTolerance(st),
    plan: transferPlan(v, gs.time, targetBody),
    cargo: mods.join(', '),
    stageLeft: nextStage(v.parts).length,
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

  const toggleAutoLand = useCallback(() => {
    if (!hasAutoLandTech(sim.gs)) {
      setShowTech(true)
      toast('Otomatik İniş Bilgisayarı için Teknoloji Ağacından araştırma açmalısın.', 'warn')
      return
    }
    const v = activeVessel(sim.gs)
    if (!v || v.landed || !BODIES[v.bodyId].landable) return
    v.autoLand = !v.autoLand
    toast(v.autoLand ? 'Otomatik İniş Asistanı devrede.' : 'Otomatik İniş Asistanı kapatıldı.')
    setHud(snapshot())
  }, [toast])

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
      else if (k === ' ') handle(stageNext(sim, v))
      else if (k === 'z') v.throttle = 1
      else if (k === 'x') { v.throttle = 0; v.autoLand = false }
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
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key)
    const blur = () => keys.current.clear()
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
        tx: (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0),
        ty: 0,
      }
      if (v) {
        if (k.has('w') || k.has('ArrowUp') || k.has('Shift')) {
          v.autoLand = false
          v.throttle = Math.min(1, v.throttle + dt * 0.8)
        }
        if (k.has('s') || k.has('ArrowDown') || k.has('Control')) {
          v.autoLand = false
          v.throttle = Math.max(0, v.throttle - dt * 0.8)
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
  const bodyMult = baseIncomeMultiplier(sim.gs, hud.body)
  const report = base ? baseReport(base, solarFlux(len(bodyAbsState(hud.body, sim.gs.time).r)), bodyMult) : null
  const pct = (a: number, b: number) => `${b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0}%`

  const buyEarthMod = (id: string) => {
    const err = buyEarthModule(sim, id)
    if (err) {
      toast(err, 'warn')
      return
    }
    toast(`Dünya üssüne "${MODULE_BY_ID[id]?.name ?? id}" eklendi.`)
    void saveGame(true)
    setHud(snapshot())
    bump()
  }

  return (
    <main className="flight">
      <canvas ref={canvasRef} className="flight-canvas" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => (drag.current = null)} />

      <div className="hud hud-tl">
        <button className="hud-btn" onClick={onBuilder}>☰ Montaj</button>
        <button className={`hud-btn${isMap ? ' is-on' : ''}`} onClick={toggleMap}>{isMap ? 'Uçuş (M)' : 'Harita (M)'}</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'missions' ? null : 'missions')}>Görevler</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'base' ? null : 'base')}>Üs & Pasif Gelir</button>
        <button className="hud-btn" onClick={() => setShowTech(true)}>🧬 Teknoloji</button>
        <button className="hud-btn" onClick={() => setPanel(panel === 'help' ? null : 'help')}>?</button>
        <span className="hud-money">
          {fmt(hud.money)} ₡ <small className="income-sub">+{fmt(hud.passivePerHr)}/sa</small>
        </span>
        {auth.user && <span className="hud-user">👤 {auth.user.username}</span>}
      </div>

      <div className="hud hud-tr">
        <div className="warp">
          <button className="hud-btn" onClick={() => (sim.warpIdx = Math.max(0, sim.warpIdx - 1))} aria-label="Yavaşlat">◀◀</button>
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
          <b>{hud.warp.toLocaleString('tr-TR')}×</b>
          <button className="hud-btn" onClick={() => (sim.warpIdx = Math.min(WARPS.length - 1, sim.warpIdx + 1))} aria-label="Hızlandır">▶▶</button>
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
              <span>İtki/Ağırlık</span><b className={hud.twr >= 1.2 ? 'ok' : hud.twr >= 1 ? 'warn' : hud.landed ? 'bad' : ''}>{hud.twr.toFixed(2)}</b>
              <span>Kütle</span><b>{hud.mass.toFixed(1)} t</b>
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
            {isMap && (
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
              </div>
            )}
            {isMap && hud.plan.map((p) => <div key={p} className="plan">{p}</div>)}
            <div className="row">
              {(['off', 'prograde', 'retrograde', 'radial'] as SasMode[]).map((m) => (
                <button key={m} className={`hud-btn${hud.sas === m ? ' is-on' : ''}`} onClick={() => act((v) => { v.sas = m })}>
                  {m === 'off' ? 'Serbest' : m === 'prograde' ? 'İleri ▲' : m === 'retrograde' ? 'Geri ▼' : 'Radyal'}
                </button>
              ))}
              {hud.hasRcs && <button className={`hud-btn${hud.rcs ? ' is-on' : ''}`} onClick={() => act((v) => { v.rcsOn = !v.rcsOn })}>RCS</button>}
              {!hud.landed && hud.landable && (
                <button className={`hud-btn${hud.autoLand ? ' is-on' : ''}`} onClick={toggleAutoLand}>
                  {hasAutoLandTech(sim.gs) ? `🤖 Oto-İniş ${hud.autoLand ? 'AÇIK' : '(L)'}` : '🤖 Oto-İniş 🔒'}
                </button>
              )}
              {hud.dockName && <button className="hud-btn recover" onClick={() => act((v) => { const o = dockCandidate(sim.gs, v); return o ? dockVessels(sim, v, o) : null })}>Kenetlen: {hud.dockName}</button>}
              <button className="hud-btn stage" disabled={!hud.stageLeft} onClick={() => act((v) => stageNext(sim, v))}>Kademe ayır (Boşluk)</button>
              {hud.landed && hud.body === 'earth' && <button className="hud-btn recover" onClick={() => act((v) => recoverVessel(sim, v))}>Aracı kurtar</button>}
              {hud.landed && hud.body !== 'earth' && <button className="hud-btn recover" onClick={() => setPanel('base')}>{baseBody.name} üssü</button>}
            </div>
          </div>

          <div className="hud hud-br">
            <button className={`hud-btn${hud.throttle > 0 ? ' is-on' : ''}`} onClick={() => act((v) => { v.autoLand = false; v.throttle = v.throttle > 0 ? 0 : 1 })}>{hud.throttle > 0 ? 'Açık' : 'Kapalı'}</button>
            <b>{Math.round(hud.throttle * 100)}%</b>
            <div
              className="throttle"
              onMouseDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                act((v) => {
                  v.autoLand = false
                  v.throttle = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
                })
              }}
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
          <header><h2>{`${baseBody.name} Üssü`}</h2><button onClick={() => setPanel(null)}>×</button></header>
          <div className="base-summary-strip">
            {(Object.keys(sim.gs.bases) as BodyId[]).map((id) => {
              const b = sim.gs.bases[id]!
              const mult = baseIncomeMultiplier(sim.gs, id)
              const r = baseReport(b, solarFlux(len(bodyAbsState(id, sim.gs.time).r)), mult)
              return (
                <div key={id} className="base-summary-item">
                  <b>{BODIES[id].name}</b>
                  <span>+{fmt(r.incomePerHour)} ₡/sa</span>
                  {id !== 'earth' && <small>{b.ore.toFixed(1)} t maden</small>}
                </div>
              )
            })}
          </div>

          {!report || !base ? (
            <div className="base-empty">
              <p>{baseBody.name} yüzeyinde henüz üs yok. Kargo gövdesiyle modül getirip inince buradan kurabilirsin (gelir çarpanı ×{baseBody.incomeMult}).</p>
            </div>
          ) : (
            <>
              <table className="base-table">
                <thead><tr><th>Modül</th><th>Adet</th><th>Gelir</th><th>Maden</th></tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.def.id} title={r.def.desc}>
                      <td>{r.def.icon} {r.def.name}</td>
                      <td>{r.count}</td>
                      <td>{r.income ? `${fmt(r.income)} ₡/sa` : '—'}</td>
                      <td>{r.ore ? `${r.ore.toFixed(2)} t/sa` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="base-stats">
                <div><dt>Güç</dt><dd className={report.efficiency < 1 ? 'warn' : 'ok'}>{report.powerSupply.toFixed(1)} / {report.powerDemand.toFixed(1)} (%{Math.round(report.efficiency * 100)} verim)</dd></div>
                <div><dt>Gezegen & Ar-Ge çarpanı</dt><dd>×{bodyMult.toFixed(2)}</dd></div>
                <div><dt>Toplam pasif gelir</dt><dd className="ok">+{fmt(report.incomePerHour)} ₡ / oyun saati</dd></div>
                {hud.body !== 'earth' && (
                  <div><dt>Maden stoğu</dt><dd>{base.ore.toFixed(2)} t ({fmt(base.ore * baseBody.orePrice * orePriceMultiplier(sim.gs))} ₡)</dd></div>
                )}
                <div><dt>Bugüne dek kazanç</dt><dd>{fmt(base.earned)} ₡</dd></div>
              </dl>
              {report.efficiency < 1 && <p className="base-note">Güç yetersiz: tesisler yavaş çalışıyor. Güneş Tarlası veya RTG Reaktörü ekle.</p>}
            </>
          )}

          {hud.body === 'earth' && (
            <div className="earth-build-box">
              <h3>Dünya Pasif Gelir Modülü Ekle</h3>
              <div className="earth-mod-list">
                {MODULES.filter((m) => m.id !== 'drill' && m.id !== 'isru').map((m) => {
                  const unlocked = isModuleUnlocked(sim.gs, m.id)
                  const req = unlocked ? null : requiredTechForModule(m.id)
                  return (
                    <button
                      key={m.id}
                      className="earth-mod-btn"
                      disabled={!unlocked || hud.money < m.cost}
                      onClick={() => buyEarthMod(m.id)}
                      title={unlocked ? m.desc : `Kilitli: ${req?.name}`}
                    >
                      <span>{m.icon} {m.name}</span>
                      <small>{unlocked ? `${fmt(m.cost)} ₡` : `🔒 ${req?.name}`}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {hud.has && hud.landed && hud.body !== 'earth' && (
            <div className="base-actions">
              <p>İnen araç: <b>{hud.name}</b>{hud.cargo ? ` — ${hud.cargo}` : ' — kargo boş'}</p>
              <button className="hud-btn" onClick={() => act((v) => deployModules(sim, v))}>Kargodaki modülleri kur</button>
              <button className="hud-btn" onClick={() => act((v) => loadOre(sim, v))}>Madeni araca yükle</button>
              <button className="hud-btn" onClick={() => act((v) => refuelAtBase(sim, v))}>Yakıt ikmali (ISRU)</button>
            </div>
          )}
        </aside>
      )}

      {panel === 'help' && (
        <aside className="side-panel">
          <header><h2>Kontroller</h2><button onClick={() => setPanel(null)}>×</button></header>
          <ul className="help-list">
            <li><kbd>W</kbd>/<kbd>S</kbd> gaz ±, <kbd>Z</kbd> tam gaz, <kbd>X</kbd> motoru kes</li>
            <li><kbd>A</kbd>/<kbd>D</kbd> döndür · <kbd>T</kbd> yön kilidi (ileri / geri / radyal)</li>
            <li><kbd>L</kbd> Otomatik İniş Bilgisayarı (Teknoloji Ağacıyla açılır)</li>
            <li><kbd>Boşluk</kbd> sıradaki kademeyi ayır — ya da adaptöre tıkla</li>
            <li><kbd>M</kbd> uzay haritası · tekerlek: yakınlaş/uzaklaş · sürükle: kaydır</li>
            <li><kbd>,</kbd>/<kbd>.</kbd> zamanı yavaşlat / hızlandır (fizikte 25×, yörüngede 100.000×)</li>
            <li><kbd>P</kbd> paraşüt · <kbd>G</kbd> iniş ayakları · <kbd>O</kbd> güneş panelleri</li>
            <li><kbd>R</kbd> RCS'yi aç · <kbd>Q</kbd>/<kbd>E</kbd> ile sola/sağa kay (RCS parçası gerekir)</li>
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
              <button className="button button-primary" onClick={onBuilder}>Montaj binası</button>
              <button className="button button-secondary" onClick={() => setPanel('base')}>Üs & Pasif Gelir</button>
              <button className="button button-secondary" onClick={() => setShowTech(true)}>Teknoloji Ağacı</button>
              {hud.vessels.map((o) => <button key={o.id} className="button button-secondary" onClick={() => switchTo(o.id)}>{o.name} · {o.body}</button>)}
            </div>
          </section>
        </div>
      )}

      {showTech && <TechTreeModal onClose={() => setShowTech(false)} />}
    </main>
  )
}
