import { useMemo, useState } from 'react'
import { QUADRANT_SHORT, quadrantOfAngle } from '../game/base'
import { runCommand } from '../game/store'
import type { GameCommand, GameState, Vessel } from '../game/types'
import { cargoMass, estimateDeltaV, vesselStats } from '../game/vessel'
import { lang, T } from '../i18n'
import { BODIES, type BodyId } from '../nasa/bodies'
import { isLootMode } from '../flight/combat'
import { effectiveAutopilot, situation } from '../flight/physics'
import { createsFollowCycle, type Sim } from '../flight/world'

const DESTINATIONS: BodyId[] = ['moon', 'earth', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']

interface Props {
  gs: GameState
  curSim: Sim
  myActor: string
  active: Vessel | null
  onClose: () => void
  onSwitch: (vesselId: number) => void
  onToast: (text: string, kind?: 'info' | 'warn') => void
  onRefresh: () => void
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)

export default function FleetWindow({
  gs,
  curSim,
  myActor,
  active,
  onClose,
  onSwitch,
  onToast,
  onRefresh,
}: Props) {
  const W = (tr: string, en: string) => (lang === 'en' ? en : tr)
  const bodyName = (id: BodyId) => (lang === 'en' ? T(BODIES[id].name) : BODIES[id].name)
  const loot = isLootMode(gs)

  const ships = useMemo(() => {
    const list = curSim.gs.vessels.filter(
      (o) => !o.debris && !o.station && !o.outpost && (!gs.mp || o.ownerId === myActor),
    )
    // Liderler önce, ardından takipçiler ve serbest gemiler
    const hasFollowers = (id: number) => list.some((o) => o.autopilot === 'follow' && o.followId === id)
    return [...list].sort((a, b) => {
      const aScore = a.id === active?.id ? 0 : hasFollowers(a.id) ? 1 : a.autopilot === 'follow' ? 2 : 3
      const bScore = b.id === active?.id ? 0 : hasFollowers(b.id) ? 1 : b.autopilot === 'follow' ? 2 : 3
      return aScore - bScore || a.id - b.id
    })
  }, [curSim.gs.vessels, gs.mp, myActor, active?.id])

  const followerCounts = useMemo(() => {
    const map = new Map<number, number>()
    for (const s of ships) {
      if (effectiveAutopilot(s) === 'follow' && s.followId) {
        map.set(s.followId, (map.get(s.followId) ?? 0) + 1)
      }
    }
    return map
  }, [ships])

  const defaultLeader = useMemo(() => {
    if (active && !active.debris && !active.station && !active.outpost) {
      if (active.autopilot === 'follow' && active.followId) {
        const up = ships.find((s) => s.id === active.followId)
        if (up) return up.id
      }
      return active.id
    }
    const existingLeader = ships.find((s) => (followerCounts.get(s.id) ?? 0) > 0)
    return existingLeader?.id ?? ships[0]?.id ?? 0
  }, [active, ships, followerCounts])

  const [leaderId, setLeaderId] = useState<number>(defaultLeader)
  const [targetBody, setTargetBody] = useState<BodyId>(() => {
    const t = gs.targetBody
    return t && DESTINATIONS.includes(t) ? t : 'moon'
  })
  const [pickByShip, setPickByShip] = useState<Record<number, number>>({})

  const activeLeader = ships.find((s) => s.id === leaderId) ?? ships[0] ?? null
  const activeLeaderFollowers = activeLeader ? followerCounts.get(activeLeader.id) ?? 0 : 0

  const exec = (cmd: GameCommand): boolean => {
    const res = runCommand(cmd)
    if (res.error) {
      onToast(res.error, 'warn')
      onRefresh()
      return false
    }
    onRefresh()
    return true
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="drone-window fleet-window panel-card"
        role="dialog"
        aria-modal="true"
        aria-label={W('Filo & Takip Merkezi', 'Fleet & Follow Command')}
        data-no-i18n
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drone-win-head">
          <div>
            <p className="eyebrow"><span /> {W('OTONOM FORMASYON & FİLO KOMUTASI', 'AUTONOMOUS FORMATION & FLEET COMMAND')}</p>
            <h2>🚢 {W('Filo Merkezi', 'Fleet Command')}</h2>
          </div>
          <div className="drone-win-head-r">
            <span className="tech-budget">
              {W('Araç:', 'Ships:')} <b>{ships.length}</b> · {W('Takipte:', 'Following:')} <b>{ships.filter((s) => effectiveAutopilot(s) === 'follow').length}</b>
            </span>
            <button type="button" className="hud-btn" onClick={onClose} aria-label={W('Kapat', 'Close')}>×</button>
          </div>
        </header>

        {ships.length === 0 ? (
          <div className="drone-empty-box">
            <p>
              {W(
                'Henüz yönetilecek roketin yok. Montajdan veya rampadan bir roket fırlattıktan sonra diğer gemilerin onu takip etmesini sağlayabilirsin.',
                'No active ships launched yet. Launch two or more rockets and assign followers here to fly them as a fleet.',
              )}
            </p>
          </div>
        ) : (
          <div className="drone-pane">
            <div className="fleet-cmd-box">
              <div className="fleet-cmd-row">
                <label className="drone-field">
                  <span>👑 {W('Filo Lideri', 'Fleet Leader')}</span>
                  <select
                    value={activeLeader?.id ?? 0}
                    onChange={(e) => setLeaderId(Number(e.target.value))}
                  >
                    {ships.map((s) => {
                      const fc = followerCounts.get(s.id) ?? 0
                      return (
                        <option key={s.id} value={s.id}>
                          {s.drone ? '🛸 ' : '🚀 '}{s.name} ({bodyName(s.bodyId)}){fc > 0 ? ` · ${fc} ${W('takipçi', 'followers')}` : ''}
                        </option>
                      )
                    })}
                  </select>
                </label>

                {!loot && (
                  <label className="drone-field">
                    <span>🎯 {W('Filo Hedefi', 'Fleet Destination')}</span>
                    <select value={targetBody} onChange={(e) => setTargetBody(e.target.value as BodyId)}>
                      {DESTINATIONS.map((b) => (
                        <option key={b} value={b}>{bodyName(b)}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {activeLeader && (
                <div className="fleet-order-btns">
                  <button
                    type="button"
                    className="hud-btn recover"
                    disabled={ships.length < 2}
                    onClick={() => exec({ type: 'fleetOrder', leaderId: activeLeader.id, order: 'followAll' })}
                  >
                    📡 {W('Diğer Gemileri Takibe Al', 'All Ships Follow Leader')} ({Math.max(0, ships.length - 1)})
                  </button>
                  {!loot && !activeLeader.drone && (
                    <>
                      <button
                        type="button"
                        className="mini-warp-btn"
                        onClick={() => exec({ type: 'fleetOrder', leaderId: activeLeader.id, order: 'orbit' })}
                      >
                        🛰️ {W('Filoyla Yörünge', 'Fleet Orbit')}
                      </button>
                      <button
                        type="button"
                        className="mini-warp-btn"
                        disabled={activeLeader.bodyId === targetBody}
                        onClick={() => exec({ type: 'fleetOrder', leaderId: activeLeader.id, order: 'transfer', bodyId: targetBody })}
                      >
                        🎯 {W('Filoyla Hedefe Git', 'Fleet Transfer')}
                      </button>
                      {BODIES[activeLeader.bodyId].landable && !activeLeader.landed && (
                        <button
                          type="button"
                          className="mini-warp-btn"
                          onClick={() => exec({ type: 'fleetOrder', leaderId: activeLeader.id, order: 'land' })}
                        >
                          🛬 {W('Filoyla İniş', 'Fleet Land')}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="mini-warp-btn"
                    onClick={() => exec({ type: 'fleetOrder', leaderId: activeLeader.id, order: 'stop' })}
                  >
                    🛑 {W('Filoyu Durdur', 'Stop Fleet')}
                  </button>
                  {activeLeaderFollowers > 0 && (
                    <button
                      type="button"
                      className="mini-warp-btn"
                      onClick={() => exec({ type: 'fleetOrder', leaderId: activeLeader.id, order: 'disband' })}
                    >
                      🔓 {W('Filoyu Dağıt', 'Disband')} ({activeLeaderFollowers})
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="drone-list">
              {ships.map((s) => {
                const st = vesselStats(s.parts, s.cargo)
                const sit = situation(s, st)
                const sq = quadrantOfAngle(sit.theta)
                const ap = effectiveAutopilot(s)
                const fCount = followerCounts.get(s.id) ?? 0
                const leader = ap === 'follow' && s.followId ? ships.find((o) => o.id === s.followId) : undefined
                const hs = { hp: st.hp, maxHp: st.maxHp }
                const dv = Math.round(estimateDeltaV(s.parts, cargoMass(s.cargo), 9.8).reduce((sum, x) => sum + x.dv, 0))
                const distToLeader =
                  leader && leader.bodyId === s.bodyId
                    ? fmtDist(Math.hypot(leader.pos.x - s.pos.x, leader.pos.y - s.pos.y))
                    : leader
                      ? `${bodyName(s.bodyId)} → ${bodyName(leader.bodyId)}`
                      : ''
                const candidates = ships.filter(
                  (cand) =>
                    cand.id !== s.id &&
                    (!s.drone || (cand.cruise ? cand.cruise.to : cand.bodyId) === s.bodyId) &&
                    !createsFollowCycle(curSim.gs, s.id, cand.id),
                )
                const selectedPick =
                  pickByShip[s.id] && candidates.some((c) => c.id === pickByShip[s.id])
                    ? pickByShip[s.id]!
                    : s.followId && candidates.some((c) => c.id === s.followId)
                      ? s.followId
                      : activeLeader && activeLeader.id !== s.id && candidates.some((c) => c.id === activeLeader.id)
                        ? activeLeader.id
                        : candidates[0]?.id ?? 0
                const isCur = active?.id === s.id
                return (
                  <article key={s.id} className={`drone-card${isCur ? ' is-cur' : ap === 'follow' ? ' is-follow' : ''}`}>
                    <div className="drone-card-head">
                      <div>
                        <b>
                          {fCount > 0 ? '👑 ' : ap === 'follow' ? '📡 ' : s.drone ? '🛸 ' : '🚀 '}
                          {s.name}
                          {fCount > 0 && (
                            <span className="fleet-badge is-leader">
                              {' '}{W(`Lider (${fCount})`, `Leader (${fCount})`)}
                            </span>
                          )}
                          {leader && (
                            <span className="fleet-badge is-follow">
                              {' '}→ {leader.name} ({distToLeader})
                            </span>
                          )}
                        </b>
                        <small>
                          {bodyName(s.bodyId)} · {QUADRANT_SHORT[sq]} ·{' '}
                          {s.cruise
                            ? W('Hızlı Yolculuk', 'Cruising')
                            : s.landed
                              ? W('Yüzeyde', 'Landed')
                              : fmtDist(Math.max(0, sit.alt))}{' '}
                          · {s.drone ? `🔋 ${Math.round(s.ec)}/${st.ecCap}` : `⛽ ${st.fuelCap > 0 ? Math.round((st.fuel / st.fuelCap) * 100) : 0}% · Δv ${dv} m/s`}{' '}
                          · ❤️ {Math.round(hs.hp)}/{hs.maxHp}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="hud-btn recover"
                        onClick={() => {
                          onSwitch(s.id)
                          onClose()
                        }}
                      >
                        🎮 {isCur ? W('Kontrolde', 'Active') : W('Kontrol Et', 'Control')}
                      </button>
                    </div>

                    {s.autopilotNote && (
                      <div className="fleet-note">{lang === 'en' ? T(s.autopilotNote) : s.autopilotNote}</div>
                    )}

                    <div className="drone-nav-row">
                      {candidates.length > 0 ? (
                        <>
                          <span>📡 {W('Takip:', 'Follow:')}</span>
                          <select
                            className="fleet-inline-select"
                            value={selectedPick}
                            onChange={(e) => setPickByShip((prev) => ({ ...prev, [s.id]: Number(e.target.value) }))}
                          >
                            {candidates.map((c) => {
                              const dLabel = c.bodyId === s.bodyId
                                ? fmtDist(Math.hypot(c.pos.x - s.pos.x, c.pos.y - s.pos.y))
                                : bodyName(c.bodyId)
                              return (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({dLabel})
                                </option>
                              )
                            })}
                          </select>
                          <button
                            type="button"
                            className={`mini-warp-btn${ap === 'follow' && s.followId === selectedPick ? ' is-on' : ''}`}
                            disabled={!selectedPick || Boolean(s.cruise)}
                            onClick={() =>
                              exec({
                                type: 'setAutopilot',
                                vesselId: s.id,
                                mode: ap === 'follow' && s.followId === selectedPick ? 'off' : 'follow',
                                followId: selectedPick,
                              })
                            }
                          >
                            {ap === 'follow' && s.followId === selectedPick
                              ? `✕ ${W('Takibi Bırak', 'Unfollow')}`
                              : `📡 ${W('Takip Et', 'Follow')}`}
                          </button>
                        </>
                      ) : (
                        <small className="fleet-muted">
                          {W('Takip edilecek başka araç yok — ikinci bir roket fırlat.', 'No other ship to follow yet — launch another rocket.')}
                        </small>
                      )}

                      {ap === 'follow' && (
                        <button
                          type="button"
                          className="mini-warp-btn"
                          onClick={() => exec({ type: 'setAutopilot', vesselId: s.id, mode: 'off' })}
                        >
                          🛑 {W('Dur', 'Stop')}
                        </button>
                      )}
                      {!loot && !s.drone && ap !== 'follow' && (
                        <>
                          <button
                            type="button"
                            className={`mini-warp-btn${ap === 'orbit' ? ' is-on' : ''}`}
                            onClick={() => exec({ type: 'setAutopilot', vesselId: s.id, mode: ap === 'orbit' ? 'off' : 'orbit' })}
                          >
                            🛰️ {W('Yörünge', 'Orbit')}
                          </button>
                          {BODIES[s.bodyId].landable && !s.landed && (
                            <button
                              type="button"
                              className={`mini-warp-btn${ap === 'land' ? ' is-on' : ''}`}
                              onClick={() => exec({ type: 'setAutopilot', vesselId: s.id, mode: ap === 'land' ? 'off' : 'land' })}
                            >
                              🛬 {W('İn', 'Land')}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
