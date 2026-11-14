import { useEffect, useMemo, useRef, useState } from 'react'
import { MODULES } from '../game/base'
import { DEFAULT_DESIGN, GRID_H, GRID_W, partDef, PARTS } from '../game/data'
import { bump, saveGame, setIdleWarp, sim, useAuthState, useGame } from '../game/store'
import { isModuleUnlocked, isPartUnlocked, requiredTechForModule, requiredTechForPart } from '../game/tech'
import type { PartCategory, PartInst } from '../game/types'
import { canPlace, cargoMass, estimateDeltaV, partAt, vesselStats } from '../game/vessel'
import { designCost, launchDesign, totalPassiveIncomePerHour, validateDesign } from '../flight/world'
import { drawPart } from '../render/partArt'
import PartIcon from './PartIcon'
import TechTreeModal from './TechTreeModal'

const CATEGORIES: PartCategory[] = ['Komuta', 'Yakıt', 'Motorlar', 'Kademe', 'Güç', 'İniş', 'Kargo']
const IDLE_WARPS = [1, 4, 10, 25]
const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

interface Props {
  onBack: () => void
  onFly: () => void
}

export default function BuilderScreen({ onBack, onFly }: Props) {
  const gs = useGame()
  const auth = useAuthState()
  const [selected, setSelected] = useState<string | null>(null)
  const [mirror, setMirror] = useState(true)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTech, setShowTech] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cell, setCell] = useState(24)

  const design = gs.design
  const setDesign = (next: PartInst[]) => {
    sim.gs.design = next
    setError(null)
    void saveGame()
    bump()
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => setCell(Math.max(12, Math.floor(Math.min(el.clientHeight / GRID_H, el.clientWidth / GRID_W))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const stats = useMemo(() => vesselStats(design), [design])
  const cargoT = cargoMass({ modules: gs.designCargo, ore: 0, oreFrom: null })
  const stages = useMemo(() => estimateDeltaV(design, cargoT), [design, cargoT])
  const totalDv = stages.reduce((s, x) => s + x.dv, 0)
  const cost = designCost(design, gs.designCargo)
  const problem = validateDesign(design, gs.designCargo, gs)
  const twr = stages[0]?.twr ?? 0
  const passivePerHr = totalPassiveIncomePerHour(gs)

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
    const mid = (stats.minX + stats.maxX) / 2
    const order = [...design].sort((a, b) => (partDef(a.def).kind === 'chute' ? 1 : 0) - (partDef(b.def).kind === 'chute' ? 1 : 0))
    for (const p of order) {
      const d = partDef(p.def)
      ctx.save()
      ctx.translate(p.x * cell, p.y * cell)
      ctx.shadowColor = 'rgba(0,0,0,.35)'
      ctx.shadowBlur = cell * 0.25
      ctx.shadowOffsetY = cell * 0.08
      drawPart(ctx, p, cell, { flip: p.x + d.w / 2 < mid })
      ctx.restore()
    }
    if (selected && hover) {
      const d = partDef(selected)
      const spots = [{ x: hover.x, y: hover.y }]
      const mx = mirrorX(hover.x, d.w)
      if (mirror && mx !== hover.x) spots.push({ x: mx, y: hover.y })
      let acc = design
      for (const s of spots) {
        const ok = canPlace(acc, d, s.x, s.y)
        ctx.save()
        ctx.globalAlpha = 0.6
        ctx.translate(s.x * cell, s.y * cell)
        drawPart(ctx, { def: selected, x: s.x, y: s.y }, cell, { flip: s.x + d.w / 2 < GRID_W / 2 })
        ctx.globalAlpha = 1
        ctx.strokeStyle = ok ? '#4ade80' : '#fb7185'
        ctx.lineWidth = 2
        ctx.strokeRect(1, 1, d.w * cell - 2, d.h * cell - 2)
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
  }, [design, cell, selected, hover, mirror, stats])

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

  const onClick = (e: React.MouseEvent) => {
    const c = cellFromEvent(e)
    if (!selected) {
      const p = removeAt(c.x, c.y)
      if (p) setSelected(p.def)
      return
    }
    const d = partDef(selected)
    let next = design
    const spots = [{ x: c.x, y: c.y }]
    const mx = mirrorX(c.x, d.w)
    if (mirror && mx !== c.x) spots.push({ x: mx, y: c.y })
    for (const s of spots) if (canPlace(next, d, s.x, s.y)) next = [...next, { def: selected, x: s.x, y: s.y }]
    if (next !== design) setDesign(next)
  }

  const changeCargo = (id: string, delta: number) => {
    if (delta > 0 && !isModuleUnlocked(gs, id)) {
      const req = requiredTechForModule(id)
      setError(`"${id}" modülü için teknoloji gerekli: ${req?.name ?? 'Teknoloji Ağacı'}.`)
      return
    }
    const cur = sim.gs.designCargo[id] ?? 0
    const n = Math.max(0, cur + delta)
    const next = { ...sim.gs.designCargo, [id]: n }
    if (!n) delete next[id]
    sim.gs.designCargo = next
    setError(null)
    void saveGame()
    bump()
  }

  const launch = () => {
    const err = launchDesign(sim)
    if (err) {
      setError(err)
      return
    }
    void saveGame(true)
    bump()
    onFly()
  }

  const sel = selected ? partDef(selected) : null

  return (
    <main className="builder">
      <header className="builder-top">
        <button className="hud-btn" onClick={onBack}>← Ana menü</button>
        <h1>Roket Montaj Binası</h1>
        <div className="idle-warp-group" title="Pasif gelir zaman hızı">
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
        <button className="hud-btn" onClick={() => setShowTech(true)}>🧬 Teknoloji ({gs.techDone.length})</button>
        <div className="builder-money">
          Bütçe <b>{fmt(gs.money)} ₡</b> <small className="income-sub">+{fmt(passivePerHr)} ₡/sa</small>
        </div>
        <button className="hud-btn" onClick={onFly}>
          {gs.vessels.length > 0 ? `Uçuşa dön (${gs.vessels.length} araç) →` : 'Uzay & Üs Ekranı →'}
        </button>
      </header>

      <div className="builder-body">
        <aside className="palette">
          {CATEGORIES.map((cat) => (
            <section key={cat}>
              <h3>{cat}</h3>
              <div className="palette-grid">
                {PARTS.filter((p) => p.category === cat).map((p) => {
                  const unlocked = isPartUnlocked(gs, p.id)
                  const req = unlocked ? null : requiredTechForPart(p.id)
                  return (
                    <button
                      key={p.id}
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
            <button className="hud-btn" onClick={() => setSelected(null)} disabled={!selected}>✋ Taşı / sil modu</button>
            <button className="hud-btn" onClick={() => setDesign(DEFAULT_DESIGN.map((p) => ({ ...p })))}>Selene I (hazır)</button>
            <button className="hud-btn" onClick={() => setDesign([])}>Temizle</button>
          </div>
          <div className="grid-wrap" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              className="grid-canvas"
              onMouseMove={(e) => setHover(cellFromEvent(e))}
              onMouseLeave={() => setHover(null)}
              onClick={onClick}
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
            {sel ? <><b>{sel.name}</b> — {sel.desc} Yerleştirmek için kareye tıkla, bırakmak için sağ tık.</> : 'Paletten parça seç ve kare grid\'e yerleştir. Kilitli parçalar için Teknoloji Ağacını aç.'}
          </p>
        </section>

        <aside className="builder-stats">
          <h3>Araç</h3>
          <dl>
            <div><dt>Kütle</dt><dd>{(stats.mass + cargoT).toFixed(2)} t</dd></div>
            <div><dt>Kalkış itkisi</dt><dd>{fmt(stages[0]?.thrust ?? 0)} kN</dd></div>
            <div><dt>İtki / Ağırlık (Dünya)</dt><dd className={twr >= 1.2 ? 'ok' : twr >= 1 ? 'warn' : 'bad'}>{twr.toFixed(2)}</dd></div>
            <div><dt>Toplam Δv</dt><dd>{fmt(totalDv)} m/s</dd></div>
            <div><dt>Maliyet</dt><dd className={cost > gs.money ? 'bad' : ''}>{fmt(cost)} ₡</dd></div>
          </dl>
          <h3>Kademeler</h3>
          <ol className="stage-list">
            {stages.map((s, i) => (
              <li key={i}><span>Kademe {i + 1}</span><span>{fmt(s.dv)} m/s</span><span>TWR {s.twr.toFixed(2)}</span></li>
            ))}
            {!stages.length && <li><span>Motor + yakıt ekle</span></li>}
          </ol>
          <p className="dv-guide">
            Gereken Δv: Dünya yörüngesi <b>2.400</b> · Ay <b>+1.300</b> · Venüs/Mars <b>+1.100</b> · Merkür/Ceres <b>+2.200</b> · Jüpiter/Satürn <b>+3.400</b> m/s
          </p>
          <h3>Kargo <small>{cargoT.toFixed(1)} / {stats.cargoCap} t</small></h3>
          <ul className="cargo-list">
            {MODULES.map((m) => {
              const unlocked = isModuleUnlocked(gs, m.id)
              const req = unlocked ? null : requiredTechForModule(m.id)
              return (
                <li key={m.id} className={unlocked ? '' : 'is-locked'} title={unlocked ? m.desc : `Kilitli: ${req?.name ?? 'Teknoloji'}`}>
                  <span>
                    {m.icon} {m.name}
                    <small>{unlocked ? `${m.mass} t · ${fmt(m.cost)} ₡` : `🔒 ${req?.name ?? 'Teknoloji'}`}</small>
                  </span>
                  <span className="stepper">
                    <button onClick={() => changeCargo(m.id, -1)} disabled={!gs.designCargo[m.id]}>−</button>
                    <b>{gs.designCargo[m.id] ?? 0}</b>
                    <button onClick={() => changeCargo(m.id, 1)} disabled={!unlocked || cargoT + m.mass > stats.cargoCap + 1e-9}>＋</button>
                  </span>
                </li>
              )
            })}
          </ul>
          {(error ?? problem) && <p className="builder-error">{error ?? problem}</p>}
          <button className="launch-btn" onClick={launch} disabled={!!problem}>Rampaya çıkar — {fmt(cost)} ₡</button>
        </aside>
      </div>

      {showTech && <TechTreeModal onClose={() => setShowTech(false)} />}
    </main>
  )
}
