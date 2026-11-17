import { useEffect, useMemo, useRef, useState } from 'react'
import { audio } from '../audio'
import { MODULES, ISS_SUPPLY, quadrantCenterAngle, type QuadrantId } from '../game/base'
import { COMBAT_PRESETS, LOOT_PRESETS, GRID_H, GRID_W, partDef, PARTS, SHIP_PRESETS, SHIP_SLOT_COUNT } from '../game/data'
import { bump, saveGame, setIdleWarp, sim, useActiveGame, useAuthState } from '../game/store'
import { isModuleUnlocked, isPartUnlocked, requiredTechForModule, requiredTechForPart } from '../game/tech'
import type { PartCategory, PartInst } from '../game/types'
import { canPlace, cargoMass, estimateDeltaV, modulesMass, partAt, vesselStats, centerDesign } from '../game/vessel'
import { wrapPi } from '../flight/orbit'
import { BODIES, type BodyId } from '../nasa/bodies'
import { getLocalMpDesign, sendMpCommand, setLocalMpDesign, useMultiplayer } from '../flight/mpClient'
import { LOOT_VALUE_PER_TON } from '../flight/combat'
import { playerPadAngle, playerPassiveIncomePerMin } from '../flight/multiplayerSim'
import { availableLaunchSites, designCost, getActorBase, launchDesign, totalPassiveIncomePerMin, validateDesign } from '../flight/world'
import { drawPart } from '../render/partArt'
import PartIcon from './PartIcon'
import PlanetGridPanel from './ColonyPanel'

const CATEGORIES: PartCategory[] = ['Komuta', 'Dron', 'Silahlar', 'Savunma', 'Yakıt', 'Motorlar', 'Kademe', 'Güç', 'İniş', 'Kargo']
const IDLE_WARPS = [1, 5, 25]
const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

interface Props {
  onBack: () => void
  onFly: () => void
}

export default function BuilderScreen({ onBack, onFly }: Props) {
  const gs = useActiveGame()
  const auth = useAuthState()
  const mp = useMultiplayer()
  const inMp = mp.active && mp.inMatch
  const isLoot = inMp && (mp.room?.config.mode === 'loot-raid' || (mp.room?.config.mode === 'orbital-warfare' && mp.room?.config.warfareGoal === 'raid'))
  const isWarfare = inMp && (mp.room?.config.mode === 'orbital-warfare' || isLoot)
  const isColonyRace = inMp && !isWarfare
  const categories = isColonyRace ? CATEGORIES.filter((c) => c !== 'Silahlar' && c !== 'Savunma') : CATEGORIES
  const presets = isLoot ? LOOT_PRESETS : isWarfare ? [...COMBAT_PRESETS, ...SHIP_PRESETS] : isColonyRace ? SHIP_PRESETS : [...SHIP_PRESETS, ...COMBAT_PRESETS]
  const launchSites = useMemo(() => availableLaunchSites(gs, gs.ownerId ?? 'local'), [gs])
  const [siteKey, setSiteKey] = useState<string>(() => {
    const ls = gs.launchSite
    return ls ? `${ls.bodyId}:${ls.quadrant}` : 'earth:0'
  })
  const activeSite = launchSites.find((s) => `${s.bodyId}:${s.quadrant}` === siteKey) ?? launchSites[0]!
  const [selected, setSelected] = useState<string | null>(null)
  const [mirror, setMirror] = useState(true)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setShowTech = (_open: boolean) => undefined
  const [showGrid, setShowGrid] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    audio.music('build')
  }, [])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cell, setCell] = useState(24)
  const [animTick, setAnimTick] = useState(0)
  const placeFxRef = useRef<{ x: number; y: number; w: number; h: number; born: number; color: string; label: string }[]>([])

  const triggerPlaceFx = (spots: { x: number; y: number }[], def: string) => {
    const d = partDef(def)
    const now = performance.now()
    const col = d.kind === 'weapon' ? '#f59e0b' : d.kind === 'droneBay' ? '#38bdf8' : d.kind === 'engine' ? '#fb923c' : '#4ade80'
    for (const sp of spots) {
      placeFxRef.current.push({ x: sp.x, y: sp.y, w: d.w, h: d.h, born: now, color: col, label: d.name })
    }
    if (placeFxRef.current.length > 10) placeFxRef.current.splice(0, placeFxRef.current.length - 10)
    setAnimTick((n) => n + 1)
  }

  const localMp = inMp ? getLocalMpDesign() : null
  const design = localMp ? localMp.design : gs.design
  const designCargo = localMp ? localMp.cargo : gs.designCargo
  const designDroneCargo = localMp ? localMp.droneCargo : (gs.designDroneCargo ?? {})
  const setDesign = (next: PartInst[]) => {
    setError(null)
    const hasDroneBay = next.some((p) => partDef(p.def).kind === 'droneBay')
    const nextDroneCargo = hasDroneBay ? designDroneCargo : {}
    if (inMp) {
      setLocalMpDesign(next, designCargo, nextDroneCargo)
      return
    }
    sim.gs.design = next
    if (!hasDroneBay) sim.gs.designDroneCargo = {}
    void saveGame()
    bump()
  }

  useEffect(() => {
    if (!placeFxRef.current.length) return
    let raf = 0
    const step = () => {
      const now = performance.now()
      placeFxRef.current = placeFxRef.current.filter((fx) => now - fx.born < 520)
      if (placeFxRef.current.length > 0) {
        setAnimTick((n) => (n + 1) % 100000)
        raf = requestAnimationFrame(step)
      } else {
        setAnimTick(0)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [design.length, animTick > 0 ? 1 : 0])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Hücre boyu eski 30 satırlık ızgaraya göre kalır (parçalar küçülmez); büyüyen alan kaydırılarak gezilir.
    const fit = () => setCell(Math.max(14, Math.floor(Math.min(el.clientHeight / 30, (el.clientWidth - 16) / GRID_W))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Izgara büyüdü: eski/hazır tasarımlar ortalanır (simetri ekseni ızgaranın ortasıdır).
  useEffect(() => {
    const c = centerDesign(design)
    if (c !== design) setDesign(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hangar açılınca ızgaranın altına (roketin durduğu yere) kaydır.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const t = window.setTimeout(() => {
      el.scrollTop = el.scrollHeight
    }, 60)
    return () => window.clearTimeout(t)
  }, [cell])

  const stats = useMemo(() => vesselStats(design), [design])
  const effectiveDroneCargo = useMemo(() => (stats.droneCargoCap > 0 ? designDroneCargo : {}), [stats.droneCargoCap, designDroneCargo])
  const cargoT = cargoMass({ modules: designCargo, ore: 0, oreFrom: null })
  const droneCargoT = modulesMass(effectiveDroneCargo)
  const stages = useMemo(() => estimateDeltaV(design, cargoT + droneCargoT), [design, cargoT, droneCargoT])
  const totalDv = stages.reduce((s, x) => s + x.dv, 0)
  const cost = designCost(design, designCargo, effectiveDroneCargo)
  const problem = validateDesign(design, designCargo, gs, effectiveDroneCargo)
  const twr = stages[0]?.twr ?? 0
  const passivePerMin = inMp && gs.ownerId ? playerPassiveIncomePerMin(gs, gs.ownerId) : totalPassiveIncomePerMin(gs)

  const mirrorX = (x: number, w: number) => GRID_W - x - w

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const W = GRID_W * cell
    const H = GRID_H * cell
    cv.width = W * dpr
    cv.height = H * dpr
    cv.style.width = `${W}px`
    cv.style.height = `${H}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#2d5596')
    bg.addColorStop(1, '#1f3f78')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(255,255,255,.09)'
    ctx.lineWidth = 1
    for (let x = 0; x <= GRID_W; x += 1) {
      ctx.beginPath()
      ctx.moveTo(x * cell + 0.5, 0)
      ctx.lineTo(x * cell + 0.5, H)
      ctx.stroke()
    }
    for (let y = 0; y <= GRID_H; y += 1) {
      ctx.beginPath()
      ctx.moveTo(0, y * cell + 0.5)
      ctx.lineTo(W, y * cell + 0.5)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,.22)'
    ctx.setLineDash([4, 6])
    ctx.beginPath()
    ctx.moveTo((GRID_W / 2) * cell, 0)
    ctx.lineTo((GRID_W / 2) * cell, H)
    ctx.stroke()
    ctx.setLineDash([])
    const now = performance.now()
    const mid = (stats.minX + stats.maxX) / 2
    const order = [...design].sort((a, b) => (partDef(a.def).kind === 'chute' ? 1 : 0) - (partDef(b.def).kind === 'chute' ? 1 : 0))
    for (const p of order) {
      const d = partDef(p.def)
      const fx = placeFxRef.current.find((f) => f.x === p.x && f.y === p.y && now - f.born < 320)
      const pop = fx ? 1 + 0.14 * Math.sin(((now - fx.born) / 320) * Math.PI) : 1
      ctx.save()
      ctx.translate((p.x + (d.w * (1 - pop)) / 2) * cell, (p.y + (d.h * (1 - pop)) / 2) * cell)
      ctx.scale(pop, pop)
      ctx.shadowColor = fx ? fx.color : 'rgba(0,0,0,.35)'
      ctx.shadowBlur = fx ? cell * 0.65 : cell * 0.25
      ctx.shadowOffsetY = fx ? 0 : cell * 0.08
      drawPart(ctx, p, cell, { flip: p.x + d.w / 2 < mid })
      ctx.restore()
    }
    // Yeni parça yerleştirme şok halkası + kıvılcım animasyonu
    for (const fx of placeFxRef.current) {
      const age = (now - fx.born) / 520
      if (age < 0 || age >= 1) continue
      const cx = (fx.x + fx.w / 2) * cell
      const cy = (fx.y + fx.h / 2) * cell
      const rw = (fx.w * 0.55 + age * 0.9) * cell
      const rh = (fx.h * 0.55 + age * 0.9) * cell
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - age)
      ctx.strokeStyle = fx.color
      ctx.lineWidth = Math.max(1.5, 3 * (1 - age))
      ctx.strokeRect(cx - rw, cy - rh, rw * 2, rh * 2)
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2 + fx.x * 0.7
        const dist = age * cell * (1.2 + (i % 3) * 0.45)
        ctx.fillStyle = i % 2 ? '#ffffff' : fx.color
        ctx.fillRect(cx + Math.cos(a) * dist - 1.5, cy + Math.sin(a) * dist - 1.5, 3, 3)
      }
      ctx.restore()
    }
    if (selected && hover) {
      const d = partDef(selected)
      const spots = [{ x: hover.x, y: hover.y }]
      const mx = mirrorX(hover.x, d.w)
      if (mirror && mx !== hover.x && d.kind !== 'droneBay') spots.push({ x: mx, y: hover.y })
      let acc = design
      const droneLimitHit = d.kind === 'droneBay' && design.some((q) => partDef(q.def).kind === 'droneBay')
      for (const s of spots) {
        const ok = !droneLimitHit && canPlace(acc, d, s.x, s.y)
        ctx.save()
        ctx.fillStyle = ok ? 'rgba(74,222,128,.12)' : 'rgba(251,113,133,.16)'
        ctx.fillRect(s.x * cell, s.y * cell, d.w * cell, d.h * cell)
        ctx.globalAlpha = 0.7
        ctx.translate(s.x * cell, s.y * cell)
        drawPart(ctx, { def: selected, x: s.x, y: s.y }, cell, { flip: s.x + d.w / 2 < GRID_W / 2 })
        ctx.globalAlpha = 1
        ctx.strokeStyle = ok ? '#4ade80' : '#fb7185'
        ctx.lineWidth = 2
        ctx.strokeRect(1, 1, d.w * cell - 2, d.h * cell - 2)
        // Kilitli köşe nişangah tırnakları
        const br = Math.min(8, cell * 0.35)
        ctx.lineWidth = 2.6
        ctx.beginPath()
        ctx.moveTo(0, br); ctx.lineTo(0, 0); ctx.lineTo(br, 0)
        ctx.moveTo(d.w * cell - br, 0); ctx.lineTo(d.w * cell, 0); ctx.lineTo(d.w * cell, br)
        ctx.moveTo(0, d.h * cell - br); ctx.lineTo(0, d.h * cell); ctx.lineTo(br, d.h * cell)
        ctx.moveTo(d.w * cell - br, d.h * cell); ctx.lineTo(d.w * cell, d.h * cell); ctx.lineTo(d.w * cell, d.h * cell - br)
        ctx.stroke()
        ctx.restore()
        if (ok) acc = [...acc, { def: selected, x: s.x, y: s.y }]
      }
    } else if (hover) {
      const i = partAt(design, hover.x, hover.y)
      if (i >= 0) {
        const p = design[i]!
        const d = partDef(p.def)
        ctx.strokeStyle = '#ffad57'
        ctx.lineWidth = 2
        ctx.strokeRect(p.x * cell + 1, p.y * cell + 1, d.w * cell - 2, d.h * cell - 2)
      }
    }
  }, [design, cell, selected, hover, mirror, stats, animTick])

  const cellFromEvent = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const fx = (e.clientX - rect.left) / cell
    const fy = (e.clientY - rect.top) / cell
    if (selected) {
      const d = partDef(selected)
      return { x: Math.round(fx - d.w / 2), y: Math.round(fy - d.h / 2) }
    }
    return { x: Math.floor(fx), y: Math.floor(fy) }
  }

  const removeAt = (x: number, y: number) => {
    const i = partAt(design, x, y)
    if (i < 0) return null
    const p = design[i]!
    let next = design.filter((_, j) => j !== i)
    if (mirror) {
      const d = partDef(p.def)
      const mx = mirrorX(p.x, d.w)
      next = next.filter((q) => !(q.def === p.def && q.x === mx && q.y === p.y))
    }
    setDesign(next)
    return p
  }

  /** Seçili parçayı (simetriyle birlikte) verilen hücreye yerleştirir; yerleşti mi? */
  const placeAt = (base: PartInst[], def: string, c: { x: number; y: number }): PartInst[] | null => {
    const d = partDef(def)
    if (d.kind === 'droneBay' && base.some((q) => partDef(q.def).kind === 'droneBay')) {
      setError('Bir rokette yalnızca 1 Dron Fırlatıcı olabilir (1 dron taşır).')
      return null
    }
    let next = base
    const spots = [{ x: c.x, y: c.y }]
    const mx = mirrorX(c.x, d.w)
    if (mirror && mx !== c.x && d.kind !== 'droneBay') spots.push({ x: mx, y: c.y })
    const placed: { x: number; y: number }[] = []
    for (const sp of spots) {
      if (canPlace(next, d, sp.x, sp.y)) {
        next = [...next, { def, x: sp.x, y: sp.y }]
        placed.push(sp)
      }
    }
    if (placed.length > 0) {
      triggerPlaceFx(placed, def)
      return next
    }
    return null
  }

  // Yerleşik parçayı tutup sürükleme: basılı tutup kaydırınca parça kalkar ve imleçle gelir.
  const press = useRef<{ x: number; y: number; cell: { x: number; y: number } } | null>(null)
  const carry = useRef<{ def: string; original: PartInst[] } | null>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    press.current = { x: e.clientX, y: e.clientY, cell: cellFromEvent(e) }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const pr = press.current
    if (pr && !carry.current && !selected && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 5) {
      const i = partAt(design, pr.cell.x, pr.cell.y)
      if (i >= 0) {
        const p = design[i]!
        let rest = design.filter((_, j) => j !== i)
        if (mirror) {
          const mx = mirrorX(p.x, partDef(p.def).w)
          rest = rest.filter((q) => !(q.def === p.def && q.x === mx && q.y === p.y))
        }
        carry.current = { def: p.def, original: design }
        setDesign(rest)
        setSelected(p.def)
      }
    }
    setHover(cellFromEvent(e))
  }
  const onMouseUp = (e: React.MouseEvent) => {
    const pr = press.current
    press.current = null
    if (e.button !== 0) return
    const c = cellFromEvent(e)
    if (carry.current) {
      const { def, original } = carry.current
      carry.current = null
      const next = placeAt(design, def, c)
      setDesign(next ?? original)
      setSelected(null)
      return
    }
    if (selected && pr) {
      // Paletten seçilen parça bir kez yerleşir; Shift basılıysa seçili kalır (art arda koymak için).
      const next = placeAt(design, selected, c)
      if (next) setDesign(next)
      if (!e.shiftKey) setSelected(null)
    }
  }
  const cancelCarry = () => {
    press.current = null
    if (carry.current) {
      setDesign(carry.current.original)
      carry.current = null
      setSelected(null)
    }
  }

  const changeCargo = (id: string, delta: number) => {
    if (delta > 0 && !isModuleUnlocked(gs, id)) {
      const req = requiredTechForModule(id)
      setError(`"${id}" modülü için teknoloji gerekli: ${req?.name ?? 'Teknoloji Ağacı'}.`)
      return
    }
    const cur = designCargo[id] ?? 0
    const n = Math.max(0, cur + delta)
    const next = { ...designCargo, [id]: n }
    if (!n) delete next[id]
    setError(null)
    if (inMp) {
      setLocalMpDesign(design, next)
      return
    }
    sim.gs.designCargo = next
    void saveGame()
    bump()
  }

  const applyCargoPreset = (preset: Record<string, number>) => {
    setError(null)
    if (inMp) {
      setLocalMpDesign(design, { ...preset })
      return
    }
    sim.gs.designCargo = { ...preset }
    void saveGame()
    bump()
  }

  const changeDroneCargo = (id: string, delta: number) => {
    const cur = designDroneCargo[id] ?? 0
    const n = Math.max(0, cur + delta)
    const next = { ...designDroneCargo, [id]: n }
    if (!n) delete next[id]
    setError(null)
    if (inMp) {
      setLocalMpDesign(design, designCargo, next)
      return
    }
    sim.gs.designDroneCargo = next
    void saveGame()
    bump()
  }

  const applyDronePreset = (preset: Record<string, number>) => {
    setError(null)
    if (inMp) {
      setLocalMpDesign(design, designCargo, { ...preset })
      return
    }
    sim.gs.designDroneCargo = { ...preset }
    void saveGame()
    bump()
  }

  const launch = () => {
    const targetBody: BodyId = activeSite.bodyId
    const targetQuad: QuadrantId = activeSite.quadrant
    if (!inMp) {
      sim.gs.launchSite = { bodyId: targetBody, quadrant: targetQuad }
    }
    if (inMp) {
      if (!isLoot && cost > gs.money) {
        setError(`Bütçe yetersiz: ${fmt(cost)} ₡ gerekli.`)
        return
      }
      const qBase = getActorBase(gs, targetBody, gs.ownerId ?? 'local', targetQuad)
      const padTheta =
        targetBody === 'earth' && targetQuad === 0
          ? playerPadAngle(gs, gs.ownerId)
          : qBase?.siteAngle ?? quadrantCenterAngle(targetQuad)
      const onPad = gs.vessels.find(
        (v) => v.bodyId === targetBody && v.landed && Math.abs(wrapPi(Math.atan2(v.pos.y, v.pos.x) - padTheta)) * BODIES[targetBody].radius < 25,
      )
      if (onPad && !isLoot) {
        setError('Rampa dolu: önce rampadaki aracı kurtar veya sil.')
        return
      }
      const res = sendMpCommand({ type: 'launch', design, designCargo, designDroneCargo: effectiveDroneCargo, bodyId: targetBody, quadrant: targetQuad })
      if (res.error) {
        setError(res.error)
        return
      }
      onFly()
      return
    }
    const err = launchDesign(sim, gs.ownerId ?? 'local', undefined, undefined, targetBody, targetQuad, effectiveDroneCargo)
    if (err) {
      setError(err)
      return
    }
    void saveGame(true)
    bump()
    onFly()
  }

  const slots = Array.from({ length: SHIP_SLOT_COUNT }, (_, i) => sim.gs.shipSlots?.[i] ?? null)
  const writeSlots = (next: typeof slots) => {
    sim.gs.shipSlots = next
    void saveGame(true)
    bump()
  }
  const loadShip = (d: PartInst[], cargo: Record<string, number>, dCargo: Record<string, number> = {}) => {
    setSelected(null)
    const cloned = centerDesign(d.map((p) => ({ def: p.def, x: p.x, y: p.y })))
    if (inMp) {
      setLocalMpDesign(cloned, { ...cargo }, { ...dCargo })
      return
    }
    sim.gs.designCargo = { ...cargo }
    sim.gs.designDroneCargo = { ...dCargo }
    setDesign(cloned)
  }
  const saveSlot = (i: number) => {
    const name = window.prompt('Gemi adı:', slots[i]?.name ?? `Gemim ${i + 1}`)?.trim()
    if (!name) return
    writeSlots(
      slots.map((s, j) =>
        j === i
          ? {
              name: name.slice(0, 18),
              design: design.map((p) => ({ def: p.def, x: p.x, y: p.y })),
              cargo: { ...designCargo },
              ...(Object.keys(effectiveDroneCargo).length ? { droneCargo: { ...effectiveDroneCargo } } : {}),
            }
          : s,
      ),
    )
  }
  const clearSlot = (i: number) => {
    if (window.confirm('Bu slot boşaltılsın mı?')) writeSlots(slots.map((s, j) => (j === i ? null : s)))
  }
  const sel = selected ? partDef(selected) : null
  const myVesselCount = inMp ? gs.vessels.filter((v) => v.ownerId === gs.ownerId && !v.debris && !v.station && !v.outpost).length : gs.vessels.length

  return (
    <main className="builder">
      <header className="builder-top">
        {!inMp ? (
          <button className="hud-btn" onClick={onBack}>← Ana menü</button>
        ) : (
          <button className="hud-btn" onClick={onFly}>← Uçuşa dön</button>
        )}
        <h1>Roket Montaj Binası</h1>
        {!inMp ? (
          <div className="idle-warp-group" title="Oyun hızı (pasif gelir en fazla 5× artar)">
            {IDLE_WARPS.map((w) => (
              <button
                key={w}
                type="button"
                className={`mini-warp-btn${auth.idleWarp === w ? ' is-on' : ''}`}
                onClick={() => setIdleWarp(w)}
              >
                {w}×
              </button>
            ))}
          </div>
        ) : (
          <span className="mp-warp-chip" title={gs.mp?.warpInfo?.reason ?? ''}>
            ⏱ {(gs.mp?.warpInfo?.warp ?? 1).toLocaleString('tr-TR')}×
          </span>
        )}
        <button className="hud-btn" onClick={() => setShowGrid(true)}>
          🏗️ Koloni
        </button>
        <div className="builder-money">
          Bütçe <b>{fmt(gs.money)} ₡</b> <small className="income-sub">+{fmt(passivePerMin)} ₡/dk</small>
        </div>
        <button className="hud-btn" onClick={onFly}>
          {myVesselCount > 0 ? `Uçuşa dön (${myVesselCount} araç) →` : 'Uzay & Üs Ekranı →'}
        </button>
      </header>

      <div className="builder-body">
        <aside className="palette">
          {categories.map((cat) => (
            <section key={cat}>
              <h3>{cat}</h3>
              <div className="palette-grid">
                {PARTS.filter((p) => p.category === cat).map((p) => {
                  const unlocked = isPartUnlocked(gs, p.id)
                  const req = unlocked ? null : requiredTechForPart(p.id)
                  return (
                    <button
                      key={p.id}
                      draggable={unlocked}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', p.id)
                        e.dataTransfer.effectAllowed = 'copy'
                        setSelected(p.id)
                      }}
                      onDragEnd={() => setSelected(null)}
                      className={`palette-item${selected === p.id ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}`}
                      onClick={() => {
                        if (!unlocked) {
                          setShowTech(true)
                          return
                        }
                        setSelected(selected === p.id ? null : p.id)
                      }}
                      title={unlocked ? p.desc : `Kilitli — Teknoloji gerekli: ${req?.name ?? 'Araştırma'}`}
                    >
                      <PartIcon id={p.id} />
                      <span>{p.name}</span>
                      <small>{unlocked ? `${fmt(p.cost)} ₡` : `🔒 ${req?.name.split(' ')[0] ?? 'Ar-Ge'}`}</small>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </aside>

        <section className="grid-area">
          <div className="grid-tools">
            <button className={`hud-btn${mirror ? ' is-on' : ''}`} onClick={() => setMirror(!mirror)}>⇄ Simetri {mirror ? 'açık' : 'kapalı'}</button>
            <button className="hud-btn" onClick={() => setSelected(null)} disabled={!selected}>✋ Seçimi bırak</button>
            <button className="hud-btn" onClick={() => setDesign([])}>Temizle</button>
          </div>
          <div className="ship-bar">
            <span className="ship-bar-label">Hazır gemiler</span>
            {presets.map((s) => (
              <button key={s.id} className="hud-btn" title={s.desc} onClick={() => loadShip(s.design, {})}>{s.name}</button>
            ))}
            <span className="ship-bar-label">Gemilerim</span>
            {slots.map((slot, i) => (
              <span key={i} className={`ship-slot${slot ? ' is-filled' : ''}`}>
                <button className="ship-slot-load" disabled={!slot} title={slot ? 'Tasarımı yükle' : 'Boş slot'} onClick={() => slot && loadShip(slot.design, slot.cargo, slot.droneCargo)}>
                  {slot ? slot.name : `Slot ${i + 1}`}
                </button>
                <button title="Şu anki tasarımı bu slota kaydet" aria-label={`Slot ${i + 1}: kaydet`} disabled={!design.length} onClick={() => saveSlot(i)}>💾</button>
                {slot && <button title="Slotu boşalt" aria-label={`Slot ${i + 1}: sil`} onClick={() => clearSlot(i)}>✕</button>}
              </span>
            ))}
          </div>
          <div className="grid-wrap" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              className="grid-canvas"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                setHover(null)
                cancelCarry()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setHover(cellFromEvent(e))
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain') || selected
                if (!id || !PARTS.some((q) => q.id === id)) return
                const next = placeAt(design, id, cellFromEvent(e))
                if (next) setDesign(next)
                setSelected(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                if (selected) setSelected(null)
                else {
                  const c = cellFromEvent(e)
                  removeAt(c.x, c.y)
                }
              }}
            />
          </div>
          <p className="grid-hint">
            {sel ? <><b>{sel.name}</b> — {sel.desc} Yerleştirmek için kareye tıkla (Shift: art arda koy), vazgeçmek için sağ tık.</> : 'Parçayı paletten sürükleyip ızgaraya bırak ya da seçip kareye tıkla. Yerleşik parçayı tutup sürükleyerek taşı, sağ tıkla sil.'}
          </p>
        </section>

        <aside className="builder-stats">
          <h3>Araç</h3>
          <dl>
            <div><dt>Kütle</dt><dd>{(stats.mass + cargoT + droneCargoT).toFixed(2)} t</dd></div>
            <div><dt>TWR</dt><dd className={twr >= 1.2 ? 'ok' : twr >= 1 ? 'warn' : 'bad'}>{twr.toFixed(2)}</dd></div>
            <div><dt>Toplam Δv</dt><dd>{fmt(totalDv)} m/s</dd></div>
            <div><dt>Maliyet</dt><dd className={cost > gs.money ? 'bad' : ''}>{fmt(cost)} ₡</dd></div>
            {(stats.hasCombatParts || isWarfare || stats.droneCount > 0) && (
              <>
                {(stats.hasCombatParts || isWarfare) && (
                  <>
                    <div><dt>Silah / DPS</dt><dd className={stats.weaponCount > 0 ? 'ok' : 'warn'}>{stats.weaponCount} · {fmt(stats.weaponDps)}</dd></div>
                    <div><dt>Gövde / Kalkan</dt><dd>{fmt(stats.maxHp)} / {fmt(stats.shieldCap)}</dd></div>
                  </>
                )}
                {stats.droneCount > 0 && (
                  <div><dt>Dron Fırlatıcı</dt><dd className="ok">{stats.droneCount} hangar</dd></div>
                )}
              </>
            )}
          </dl>
          {!isLoot && (
            <div className="launch-site-picker">
              <label>
                <span>📍 Fırlatma Rampası</span>
                <select value={`${activeSite.bodyId}:${activeSite.quadrant}`} onChange={(e) => setSiteKey(e.target.value)}>
                  {launchSites.map((s) => (
                    <option key={`${s.bodyId}:${s.quadrant}`} value={`${s.bodyId}:${s.quadrant}`}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {isLoot ? (
            <p className="dv-guide">Yağma modu: gemi uzayda üssünden doğar, gezegen yolculuğu ve yerçekimi yok. Kargo, zırh, dron ve silaha yatırım yap. Üssünü Koloni menüsünden Sv.5&apos;e yükselt!</p>
          ) : (
          <div className="twr-meter" title="1,0 altı kalkamaz · 1,2 ve üstü güvenli">
            <i><em className={twr >= 1.2 ? 'ok' : twr >= 1 ? 'warn' : 'bad'} style={{ width: `${Math.min(100, (twr / 2.4) * 100)}%` }} /></i>
            <small>{twr < 1 ? 'Kalkamaz: daha güçlü motor ekle veya kütleyi azalt' : twr < 1.2 ? 'Yavaş kalkar (önerilen TWR ≥ 1,2)' : 'Kalkış için yeterli itki'}</small>
          </div>
          )}
          <h3>Kademeler</h3>
          <ol className="stage-list">
            {stages.map((s, i) => (
              <li key={i}><span>Kademe {i + 1}</span><span>{fmt(s.dv)} m/s</span><span>TWR {s.twr.toFixed(2)}</span></li>
            ))}
            {!stages.length && <li><span>Motor + yakıt ekle</span></li>}
          </ol>
          {!isLoot && (
            <p className="dv-guide">
              Hedef Δv: Yörünge <b>2.400</b> · Ay <b>+1.300</b> · Mars/Venüs <b>+1.100</b> · Uzak gezegenler <b>+2.200+</b> m/s
            </p>
          )}
          {isLoot ? (
            <p className="dv-guide">Kargo kapasitesi: <b>{stats.cargoCap} t</b> ganimet (taban değer {fmt(stats.cargoCap * LOOT_VALUE_PER_TON)} ₡; üs seviyesiyle artar).</p>
          ) : (stats.cargoCap > 0 || cargoT > 0) ? (
            <>
              <h3>Kargo <small>{cargoT.toFixed(1)} / {stats.cargoCap} t</small></h3>
              {stats.cargoCap >= 4 && (
                <div className="cargo-presets">
                  {stats.cargoCap >= 6 ? (
                    <>
                      <button type="button" className="mini-warp-btn" onClick={() => applyCargoPreset({ 'colony-station': 1, 'solar-farm': 2 })} title="Ay / iç gezegenler için tam koloni paketi (6 t)">
                        🛰️ Ay Koloni Kiti
                      </button>
                      <button type="button" className="mini-warp-btn" onClick={() => applyCargoPreset({ 'colony-station': 1, 'rtg-reactor': 1 })} title="Mars ve uzak dünyalar için nükleer koloni paketi (6 t)">
                        ☢️ Uzak Dünya Kiti
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="mini-warp-btn" onClick={() => applyCargoPreset({ 'colony-station': 1 })} title="Uzay İstasyonu (4 t, 5 ⚡ ister)">
                        🛰️ İstasyon (4t)
                      </button>
                      <button type="button" className="mini-warp-btn" onClick={() => applyCargoPreset({ 'solar-farm': 2 })} title="2× Güneş Paneli (2 t, +8 ⚡)">
                        🔆 2× Panel (2t)
                      </button>
                    </>
                  )}
                  {cargoT > 0 && (
                    <button type="button" className="mini-warp-btn" onClick={() => applyCargoPreset({})}>
                      Temizle
                    </button>
                  )}
                </div>
              )}
              <ul className="cargo-list">
                {[ISS_SUPPLY, ...MODULES].filter((m) => !m.warfare || !isColonyRace).map((m) => {
                  const unlocked = isModuleUnlocked(gs, m.id)
                  const req = unlocked ? null : requiredTechForModule(m.id)
                  return (
                    <li key={m.id} className={unlocked ? '' : 'is-locked'} title={unlocked ? m.desc : `Kilitli: ${req?.name ?? 'Teknoloji'}`}>
                      <span>
                        {m.icon} {m.name}
                        <small>{unlocked ? `${m.mass} t · ${fmt(m.cost)} ₡` : `🔒 ${req?.name ?? 'Teknoloji'}`}</small>
                      </span>
                      <span className="stepper">
                        <button onClick={() => changeCargo(m.id, -1)} disabled={!designCargo[m.id]}>−</button>
                        <b>{designCargo[m.id] ?? 0}</b>
                        <button onClick={() => changeCargo(m.id, 1)} disabled={!unlocked || cargoT + m.mass > stats.cargoCap + 1e-9}>＋</button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="dv-guide">Dünya dışına modül götürmek için <b>Kargo Gövdesi</b> ya da <b>Dron Fırlatıcı</b> ekle; çeyrekte Uzay İstasyonu kurunca oradan doğrudan bina dikebilirsin.</p>
          )}
          {!isLoot && stats.droneCargoCap > 0 && (
            <>
              <h3>🛸 Dron Kargosu <small>{droneCargoT.toFixed(1)} / {stats.droneCargoCap} t</small></h3>
              <div className="cargo-presets">
                {stats.droneCargoCap >= 6 ? (
                  <>
                    <button type="button" className="mini-warp-btn" onClick={() => applyDronePreset({ 'colony-station': 1, 'solar-farm': 2 })} title="Dronla başka çeyreğe koloni kur (6 t)">
                      🛰️ Çeyrek Koloni (6 t)
                    </button>
                    <button type="button" className="mini-warp-btn" onClick={() => applyDronePreset({ 'colony-station': 1, 'rtg-reactor': 1 })} title="Dronla reaktörlü koloni kur (6 t)">
                      ☢️ Uzak Çeyrek (6 t)
                    </button>
                  </>
                ) : (
                  <button type="button" className="mini-warp-btn" onClick={() => applyDronePreset({ 'solar-farm': 2 })} title="2× Güneş Paneli (2 t)">
                    🔆 2× Panel (2t)
                  </button>
                )}
                {droneCargoT > 0 && (
                  <button type="button" className="mini-warp-btn" onClick={() => applyDronePreset({})}>
                    Temizle
                  </button>
                )}
              </div>
              <ul className="cargo-list">
                {MODULES.filter((m) => !m.warfare || !isColonyRace).map((m) => {
                  const unlocked = isModuleUnlocked(gs, m.id)
                  const req = unlocked ? null : requiredTechForModule(m.id)
                  return (
                    <li key={`dc-${m.id}`} className={unlocked ? '' : 'is-locked'} title={unlocked ? m.desc : `Kilitli: ${req?.name ?? 'Teknoloji'}`}>
                      <span>
                        {m.icon} {m.name}
                        <small>{unlocked ? `${m.mass} t · ${fmt(m.cost)} ₡` : `🔒 ${req?.name ?? 'Teknoloji'}`}</small>
                      </span>
                      <span className="stepper">
                        <button onClick={() => changeDroneCargo(m.id, -1)} disabled={!designDroneCargo[m.id]}>−</button>
                        <b>{designDroneCargo[m.id] ?? 0}</b>
                        <button onClick={() => changeDroneCargo(m.id, 1)} disabled={!unlocked || droneCargoT + m.mass > stats.droneCargoCap + 1e-9}>＋</button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {(error ?? problem) && <p className="builder-error">{error ?? problem}</p>}
          <button className="launch-btn" onClick={launch} disabled={!!problem}>{isLoot ? 'Üsten fırlat' : `${activeSite.label} · Çıkar`} — {fmt(cost)} ₡</button>
        </aside>
      </div>


      {showGrid && (
        <div className="dialog-backdrop tech-backdrop" role="presentation" onClick={() => setShowGrid(false)}>
          <section className="tech-modal panel-card grid-modal" role="dialog" aria-modal="true" aria-label="Koloni" onClick={(e) => e.stopPropagation()}>
            <header className="tech-head">
              <div>
                <p className="eyebrow"><span /> YÜZEY KOLONİSİ</p>
                <h2>Koloni</h2>
              </div>
              <div className="tech-head-right">
                <span className="tech-budget">Bütçe: <b>{fmt(gs.money)} ₡</b></span>
                <button type="button" className="hud-btn" onClick={() => setShowGrid(false)}>Kapat ×</button>
              </div>
            </header>
            <PlanetGridPanel
              onOpenTech={() => {
                setShowGrid(false)
                setShowTech(true)
              }}
            />
          </section>
        </div>
      )}
    </main>
  )
}
