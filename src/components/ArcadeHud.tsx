import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react'
import { LOOT_PRESETS } from '../game/data'
import type { GameCommand, MultiplayerPlayer } from '../game/types'
import { vesselStats } from '../game/vessel'
import { lootShipCost } from '../flight/loot'

/** Yağma modunun sade HUD'u için gereken anlık veriler (FlightScreen her ~100 ms'de bir üretir). */
export interface ArcadeInfo {
  goal: number
  cargo: number
  cargoCap: number
  nearHome: boolean
  outside: boolean
  level: number
  upgradeCost: number | null
  rebuildIn: number | null
  hp: number
  maxHp: number
  shield: number
  shieldCap: number
  fuel: number
  fuelCap: number
  boost: number
  respawnIn: number | null
  hasShip: boolean
  shipId: string
  vesselId: number | null
  money: number
  myLooted: number
  leaderId: string | null
}

export interface ArcadeInput {
  move: MutableRefObject<{ x: number; y: number } | null>
  fire: MutableRefObject<boolean>
  boost: MutableRefObject<boolean>
}

interface Props {
  info: ArcadeInfo
  players: MultiplayerPlayer[]
  feed: { id: number; text: string; color?: string }[]
  myId: string
  pingMs: number | null
  input: ArcadeInput
  onCmd: (cmd: GameCommand) => void
  onLeave: () => void
}

/**
 * Dokunmatik kontroller (sanal çubuk, ATEŞ, BOOST) şimdilik kapalı: oyun önce PC'de geliştiriliyor.
 * Mobile geçerken bunu `true` yap.
 */
const TOUCH_CONTROLS = false

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <div className="ax-bar" title={label}>
      <i style={{ width: `${f * 100}%`, background: color }} />
    </div>
  )
}

/** Sol alt: sürüklenen sanal çubuk. Dokunulan yer merkez olur; dünya ekseninde yön üretir. */
function Joystick({ move }: { move: ArcadeInput['move'] }) {
  const [knob, setKnob] = useState<{ cx: number; cy: number; dx: number; dy: number } | null>(null)
  const pid = useRef<number | null>(null)
  const R = 56
  const update = (cx: number, cy: number, x: number, y: number) => {
    let dx = x - cx
    let dy = y - cy
    const d = Math.hypot(dx, dy)
    if (d > R) {
      dx = (dx / d) * R
      dy = (dy / d) * R
    }
    setKnob({ cx, cy, dx, dy })
    // Ekranda aşağı = dünyada −y
    move.current = { x: dx / R, y: -dy / R }
  }
  const end = () => {
    pid.current = null
    setKnob(null)
    move.current = null
  }
  return (
    <div
      className="ax-stick-zone"
      onPointerDown={(e: RPointerEvent) => {
        if (pid.current !== null) return
        pid.current = e.pointerId
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        update(e.clientX, e.clientY, e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pid.current || !knob) return
        update(knob.cx, knob.cy, e.clientX, e.clientY)
      }}
      onPointerUp={(e) => e.pointerId === pid.current && end()}
      onPointerCancel={(e) => e.pointerId === pid.current && end()}
    >
      {knob ? (
        <div className="ax-stick" style={{ left: knob.cx - R, top: knob.cy - R, width: R * 2, height: R * 2 }}>
          <span style={{ transform: `translate(${knob.dx}px, ${knob.dy}px)` }} />
        </div>
      ) : (
        <div className="ax-stick is-idle">
          <span />
        </div>
      )}
    </div>
  )
}

function HoldButton({ flag, className, children }: { flag: MutableRefObject<boolean>; className: string; children: React.ReactNode }) {
  const [on, setOn] = useState(false)
  const set = (v: boolean) => {
    flag.current = v
    setOn(v)
  }
  return (
    <button
      type="button"
      className={`${className}${on ? ' is-on' : ''}`}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        set(true)
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

export default function ArcadeHud({ info, players, feed, myId, pingMs, input, onCmd, onLeave }: Props) {
  const [touch, setTouch] = useState(() => TOUCH_CONTROLS && typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches)
  const [hangar, setHangar] = useState(false)
  const [hint, setHint] = useState(true)
  useEffect(() => {
    const onTouch = () => setTouch(TOUCH_CONTROLS)
    window.addEventListener('touchstart', onTouch, { once: true })
    const t = window.setTimeout(() => setHint(false), 12_000)
    return () => {
      window.removeEventListener('touchstart', onTouch)
      window.clearTimeout(t)
    }
  }, [])

  const top = [...players].sort((a, b) => (b.looted ?? 0) - (a.looted ?? 0)).slice(0, 4)
  const cargoFull = info.cargoCap > 0 && info.cargo >= info.cargoCap - 0.01
  const goalFrac = info.goal > 0 ? Math.min(1, info.myLooted / info.goal) : 0

  return (
    <div className="ax-root">
      {/* Sol üst: can, kalkan, yakıt, boost */}
      <div className="ax-tl">
        <Bar value={info.hp} max={info.maxHp} color="linear-gradient(90deg,#22c55e,#86efac)" label="Gövde" />
        {info.shieldCap > 0 && <Bar value={info.shield} max={info.shieldCap} color="linear-gradient(90deg,#38bdf8,#a5f3fc)" label="Kalkan" />}
        <div className="ax-mini-row">
          <Bar value={info.fuel} max={info.fuelCap} color="#f59e0b" label="Yakıt" />
          <Bar value={info.boost} max={1} color="#e879f9" label="Boost" />
        </div>
      </div>

      {/* Üst orta: kargo, para, hedef */}
      <div className="ax-top">
        <span className={`ax-pill${cargoFull ? ' is-full' : ''}`}>📦 {info.cargo.toFixed(1)}/{info.cargoCap}</span>
        <span className="ax-pill is-money">₡ {fmt(info.money)}</span>
        {info.goal > 0 && (
          <span className="ax-pill ax-goal" title="Üssüne taşıdığın ganimet / hedef">
            <i style={{ width: `${goalFrac * 100}%` }} />
            <b>🏆 {info.myLooted.toFixed(0)}/{info.goal} t</b>
          </span>
        )}
      </div>
      <div className="ax-board">
        {top.map((p, i) => (
          <span key={p.id} className={`ax-rank${p.id === myId ? ' is-me' : ''}`}>
            <i style={{ background: p.color }} />
            {p.id === info.leaderId ? '👑' : `${i + 1}.`} {p.username} <b>{(p.looted ?? 0).toFixed(0)}</b>
          </span>
        ))}
      </div>

      {/* Sağ üst: menü */}
      <div className="ax-tr">
        {pingMs !== null && <span className={`ax-ping ${pingMs < 80 ? 'ok' : pingMs < 160 ? 'mid' : 'bad'}`}>{pingMs} ms</span>}
        <button type="button" className="ax-icon" title="Hangar" onClick={() => setHangar(true)}>🛠</button>
        <button type="button" className="ax-icon" title="Lobiye dön" onClick={onLeave}>⏏</button>
      </div>

      {/* Olay akışı */}
      <div className="ax-feed">
        {feed.slice(-3).map((f) => (
          <div key={f.id} style={f.color ? { borderLeftColor: f.color } : undefined}>{f.text}</div>
        ))}
      </div>

      {/* Bağlama göre tek bir ipucu */}
      <div className="ax-center-note">
        {info.outside ? (
          <span className="is-bad">⚠ Arena dışı — geri dön!</span>
        ) : info.nearHome ? (
          <span className="is-good">🔧 Üste: ikmal & onarım</span>
        ) : cargoFull ? (
          <span className="is-good">Kargo dolu — üssüne dön!</span>
        ) : null}
      </div>

      {/* Sağ alt: eylemler */}
      <div className="ax-actions">
        {info.nearHome && info.upgradeCost !== null && (
          <button type="button" className="ax-chip" disabled={info.money < info.upgradeCost} onClick={() => onCmd({ type: 'upgradeOutpost' })}>
            🏗️ Üs Sv.{info.level + 1} · ₡{fmt(info.upgradeCost)}
          </button>
        )}
        {info.cargo > 0.05 && !info.nearHome && info.vesselId !== null && (
          <button type="button" className="ax-chip" onClick={() => onCmd({ type: 'jettisonCargo', vesselId: info.vesselId! })}>
            Kargoyu bırak
          </button>
        )}
      </div>
      {touch ? (
        <>
          <Joystick move={input.move} />
          <div className="ax-buttons">
            <HoldButton flag={input.boost} className="ax-btn ax-boost">BOOST</HoldButton>
            <HoldButton flag={input.fire} className="ax-btn ax-fire">ATEŞ</HoldButton>
          </div>
        </>
      ) : (
        hint && <div className="ax-hint">WASD: hareket · Fare: nişan · Sol tık: ateş · Shift: boost · E: kargoyu bırak</div>
      )}

      {/* Yeniden doğma */}
      {!info.hasShip && (
        <div className="ax-respawn">
          <h2>Gemin düştü</h2>
          <p>{info.respawnIn !== null ? `Üssünde yeniden doğuyorsun: ${Math.ceil(info.respawnIn)}` : 'Yeniden doğuyorsun…'}</p>
          <button type="button" className="ax-chip" onClick={() => setHangar(true)}>🛠 Sonraki gemiyi seç</button>
        </div>
      )}

      {hangar && (
        <div className="ax-modal" onClick={() => setHangar(false)}>
          <section onClick={(e) => e.stopPropagation()}>
            <h2>Hangar</h2>
            <p className="ax-sub">
              {info.hasShip && info.nearHome
                ? 'Üssünün yanındasın: seçtiğin gemiye hemen geçersin (eskisi hurdaya verilir).'
                : 'Seçtiğin gemi bir sonraki doğuşunda gelir. Üssünün yanındayken anında değiştirebilirsin.'}
            </p>
            <div className="ax-ships">
              {LOOT_PRESETS.map((pr) => {
                const st = vesselStats(pr.design)
                const cost = lootShipCost(pr.id)
                const sel = info.shipId === pr.id
                return (
                  <button
                    type="button"
                    key={pr.id}
                    className={`ax-ship${sel ? ' is-sel' : ''}`}
                    disabled={cost > info.money && !sel}
                    onClick={() => {
                      onCmd({ type: 'selectLootShip', presetId: pr.id })
                      setHangar(false)
                    }}
                  >
                    <strong>{pr.name}</strong>
                    <small>{pr.desc}</small>
                    <span className="ax-ship-stats">
                      ❤ {fmt(st.maxHp)} · 📦 {st.cargoCap} t{st.shieldCap > 0 ? ` · 🛡 ${fmt(st.shieldCap)}` : ''}
                    </span>
                    <b>{cost === 0 ? 'Bedava' : `₡ ${fmt(cost)}`}</b>
                  </button>
                )
              })}
            </div>
            <button type="button" className="ax-chip" onClick={() => setHangar(false)}>Kapat</button>
          </section>
        </div>
      )}
    </div>
  )
}
