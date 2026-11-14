import { useEffect, useMemo, useState } from 'react'
import {
  baseReport,
  canSweepTile,
  ensureBaseGrid,
  isSectorReadyToScan,
  MAX_TILE_LEVEL,
  MODULE_BY_ID,
  MODULES,
  PLANET_GRID_SIZE,
  tileAt,
  tileRefund,
  tileSynergyBonus,
  tileUpgradeCost,
} from '../game/base'
import { runCommand, sim, useGame } from '../game/store'
import { baseIncomeMultiplier, isModuleUnlocked, orePriceMultiplier, requiredTechForModule } from '../game/tech'
import type { GameCommand } from '../game/types'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import { bodyAbsState, len } from '../flight/orbit'
import { earthModuleCost } from '../flight/world'

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

interface Props {
  initialBody?: BodyId
  onNotify?: (text: string, kind?: 'info' | 'warn') => void
  onOpenTech?: () => void
}

export default function PlanetGridPanel({ initialBody = 'earth', onNotify, onOpenTech }: Props) {
  const gs = useGame()
  const [bodyId, setBodyId] = useState<BodyId>(BODIES[initialBody]?.landable ? initialBody : 'earth')
  const [selected, setSelected] = useState<{ x: number; y: number } | null>({ x: 3, y: 2 })
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (BODIES[initialBody]?.landable) setBodyId(initialBody)
  }, [initialBody])

  // Gösterilecek gezegen listesi: Dünya + üssü/aracı olan gezegenler + hedef gezegen
  const tabs = useMemo(() => {
    const ids = new Set<BodyId>(['earth'])
    for (const id of Object.keys(gs.bases) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
    for (const v of gs.vessels) if (BODIES[v.bodyId]?.landable) ids.add(v.bodyId)
    if (gs.targetBody && BODIES[gs.targetBody]?.landable) ids.add(gs.targetBody)
    return [...ids]
  }, [gs.bases, gs.vessels, gs.targetBody])

  const body = BODIES[bodyId]
  const base = gs.bases[bodyId]
  const landedHere = gs.vessels.some((v) => v.landed && v.bodyId === bodyId)
  const canBuildHere = bodyId === 'earth' || landedHere || !!base

  const grid = useMemo(() => (base ? ensureBaseGrid(base, bodyId) : null), [base, bodyId, gs.time])
  const mult = baseIncomeMultiplier(gs, bodyId)
  const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
  const report = base ? baseReport(base, flux, mult) : null
  const readyScan = base ? isSectorReadyToScan(base, bodyId) : false

  const emit = (text: string, kind: 'info' | 'warn' = 'info') => {
    setFeedback(text)
    onNotify?.(text, kind)
  }

  const exec = (cmd: GameCommand, okMsg?: string) => {
    const res = runCommand(cmd)
    if (res.error) {
      emit(res.error, 'warn')
      return false
    }
    const toast = res.events.find((e) => e.type === 'toast')
    if (toast && toast.type === 'toast') emit(toast.text, 'info')
    else if (okMsg) emit(okMsg, 'info')
    return true
  }

  const selTile = grid && selected ? tileAt(grid, selected.x, selected.y) ?? null : null
  const selDef = selTile?.kind === 'built' && selTile.moduleId ? MODULE_BY_ID[selTile.moduleId] ?? null : null
  const selSyn = grid && selTile?.kind === 'built' ? tileSynergyBonus(grid, selTile) : null

  return (
    <div className="planet-grid-panel">
      <div className="grid-body-tabs">
        {tabs.map((id) => {
          const b = BODIES[id]
          const hasBase = !!gs.bases[id]
          return (
            <button
              key={id}
              type="button"
              className={`mini-warp-btn${bodyId === id ? ' is-on' : ''}`}
              onClick={() => {
                setBodyId(id)
                setSelected(null)
                setFeedback(null)
              }}
            >
              {b.name} {hasBase ? `×${b.incomeMult}` : '🔒'}
            </button>
          )
        })}
      </div>

      {!base || !grid || !report ? (
        <div className="base-empty">
          <p>
            <b>{body.name}</b> yüzeyinde henüz üs gridi açılmadı (Gelir çarpanı <b>×{body.incomeMult}</b>). Bir araç indirdiğinde 4×4 koloni gridi otomatik açılır!
          </p>
        </div>
      ) : (
        <>
          <div className="grid-kpis">
            <span>💰 <b className="ok">+{fmt(report.incomePerHour)}</b> ₡/sa</span>
            <span className={report.efficiency < 1 ? 'bad' : 'ok'}>⚡ {report.powerSupply.toFixed(0)}/{report.powerDemand.toFixed(0)} (%{Math.round(report.efficiency * 100)})</span>
            <span>🛰️ Sektör {(base.sectorLevel ?? 0) + 1} (+{(base.sectorLevel ?? 0) * 12}%)</span>
            {bodyId !== 'earth' && (
              <span>⛏️ {base.ore.toFixed(2)} t ({fmt(base.ore * body.orePrice * orePriceMultiplier(sim.gs))} ₡)</span>
            )}
          </div>

          {report.efficiency < 1 && (
            <p className="base-note warn">⚡ Güç yetersiz: Güneş Tarlası veya RTG ekle/yükselt.</p>
          )}

          <div
            className="surface-grid"
            style={{ gridTemplateColumns: `repeat(${PLANET_GRID_SIZE}, minmax(0, 1fr))` }}
          >
            {grid.map((t) => {
              const isSel = selected?.x === t.x && selected?.y === t.y
              const sweepable = canSweepTile(grid, t.x, t.y)
              const def = t.kind === 'built' && t.moduleId ? MODULE_BY_ID[t.moduleId] : null
              const syn = t.kind === 'built' ? tileSynergyBonus(grid, t) : { bonus: 0, reason: '' }

              let icon = '⬜'
              let sub = t.kind === 'vein' ? 'Damar' : 'Açık'
              if (t.kind === 'fog') {
                icon = sweepable ? '🔍' : '🌫️'
                sub = sweepable ? 'Tara' : 'Sis'
              } else if (t.kind === 'crater') {
                icon = '🪨'
                sub = 'Temizle'
              } else if (t.kind === 'vein') {
                icon = '💎'
                sub = '+%50'
              } else if (def) {
                icon = def.icon
                sub = `Lv.${t.level ?? 1}`
              }

              return (
                <button
                  key={`${t.x}-${t.y}`}
                  type="button"
                  className={`surface-cell is-${t.kind}${sweepable ? ' can-sweep' : ''}${isSel ? ' is-selected' : ''}`}
                  title={
                    def
                      ? `${def.name} Lv.${t.level ?? 1}${syn.reason ? ` (${syn.reason})` : ''}`
                      : sweepable
                        ? 'Taramak / temizlemek için tıkla (+ödül)'
                        : t.kind === 'fog'
                          ? 'Önce komşu kareyi tara'
                          : t.kind === 'vein'
                            ? 'Zengin damar (+%50 bonus): kurmak için seç'
                            : 'Boş arazi: kurmak için seç'
                  }
                  onClick={() => {
                    if (t.kind === 'fog' || t.kind === 'crater') {
                      if (exec({ type: 'sweepTile', bodyId, x: t.x, y: t.y })) {
                        setSelected({ x: t.x, y: t.y })
                      }
                      return
                    }
                    setSelected({ x: t.x, y: t.y })
                  }}
                >
                  <span className="cell-icon">{icon}</span>
                  <span className="cell-sub">{sub}</span>
                  {syn.bonus > 0 && <em className="cell-syn">+{Math.round(syn.bonus * 100)}%</em>}
                </button>
              )
            })}
          </div>

          <div className="grid-actions-bar">
            {readyScan && (
              <button
                type="button"
                className="hud-btn recover"
                onClick={() => exec({ type: 'scanSector', bodyId })}
              >
                📡 Yeni Sektör Tara (+%12 Bonus)
              </button>
            )}
            <small className="grid-tip">
              {feedback ?? '🌫️ Kapalı kareleri tara · 🪨 Krater temizle · ⚡ Güneş/RTG komşularına +%25 verir'}
            </small>
          </div>

          {selTile && selTile.kind === 'built' && selDef && (
            <div className="tile-inspector">
              <div className="tile-inspector-head">
                <b>{selDef.icon} {selDef.name} (Lv.{selTile.level ?? 1}/{MAX_TILE_LEVEL})</b>
                <small>{selSyn?.reason || selDef.desc}</small>
              </div>
              <div className="tile-inspector-btns">
                {(selTile.level ?? 1) < MAX_TILE_LEVEL ? (
                  <button
                    type="button"
                    className="hud-btn is-on"
                    disabled={gs.money < tileUpgradeCost(selDef, selTile.level ?? 1)}
                    onClick={() =>
                      exec(
                        { type: 'upgradeGridModule', bodyId, x: selTile.x, y: selTile.y },
                        `${selDef.name} Lv.${(selTile.level ?? 1) + 1} oldu!`,
                      )
                    }
                  >
                    ⬆ Yükselt → Lv.{(selTile.level ?? 1) + 1} ({fmt(tileUpgradeCost(selDef, selTile.level ?? 1))} ₡)
                  </button>
                ) : (
                  <span className="ok">★ Maksimum Seviye</span>
                )}
                <button
                  type="button"
                  className="hud-btn"
                  onClick={() => exec({ type: 'removeGridModule', bodyId, x: selTile.x, y: selTile.y })}
                >
                  ✕ Sök (+{fmt(tileRefund(selDef, selTile.level ?? 1))} ₡)
                </button>
              </div>
            </div>
          )}

          {selTile && (selTile.kind === 'clear' || selTile.kind === 'vein') && canBuildHere && (
            <div className="tile-inspector">
              <div className="tile-inspector-head">
                <b>
                  {selTile.kind === 'vein' ? '💎 Zengin Damar (+%50 bonus)' : '⬜ Kuruluma Hazır Kare'} ({selTile.x + 1},{selTile.y + 1})
                </b>
                <small>Kurmak için aşağıdan bir tesis seç:</small>
              </div>
              <div className="earth-mod-list">
                {(bodyId === 'earth' ? MODULES.filter((m) => m.id !== 'drill' && m.id !== 'isru') : MODULES).map((m) => {
                  const unlocked = isModuleUnlocked(gs, m.id)
                  const req = unlocked ? null : requiredTechForModule(m.id)
                  const price = bodyId === 'earth' ? earthModuleCost(gs, m.id) : m.cost
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="earth-mod-btn"
                      disabled={!unlocked || gs.money < price}
                      onClick={() => {
                        if (!unlocked) {
                          onOpenTech?.()
                          return
                        }
                        exec({ type: 'placeGridModule', bodyId, x: selTile.x, y: selTile.y, moduleId: m.id }, `${m.name} kuruldu.`)
                      }}
                      title={unlocked ? m.desc : `Kilitli: ${req?.name}`}
                    >
                      <span>{m.icon} {m.name}</span>
                      <small>{unlocked ? `${fmt(price)} ₡` : `🔒 ${req?.name}`}</small>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
