import { useState } from 'react'
import { bump, saveGame, sim, useGame } from '../game/store'
import { canUnlockTech, isTechDone, TECH_BY_ID, TECHS, unlockTech } from '../game/tech'

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

interface Props {
  onClose: () => void
}

export default function TechTreeModal({ onClose }: Props) {
  const gs = useGame()
  const [msg, setMsg] = useState<string | null>(null)
  const tiers = [0, 1, 2, 3, 4]

  const research = (id: string) => {
    const err = unlockTech(sim.gs, id)
    if (err) {
      setMsg(err)
      return
    }
    setMsg(`Araştırma tamamlandı: ${TECH_BY_ID[id]?.name ?? id}`)
    void saveGame(true)
    bump()
  }

  return (
    <div className="dialog-backdrop tech-backdrop" role="presentation" onClick={onClose}>
      <section
        className="tech-modal panel-card"
        role="dialog"
        aria-modal="true"
        aria-label="Teknoloji Ağacı"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tech-head">
          <div>
            <p className="eyebrow"><span /> AR-GE VE TEKNOLOJİ AĞACI</p>
            <h2>Teknoloji Ağacı</h2>
          </div>
          <div className="tech-head-right">
            <span className="tech-budget">Bütçe: <b>{fmt(gs.money)} ₡</b></span>
            <span className="tech-progress">{gs.techDone.length} / {TECHS.length} Açık</span>
            <button type="button" className="hud-btn" onClick={onClose}>Kapat ×</button>
          </div>
        </header>

        {msg && <p className="tech-msg">{msg}</p>}

        <div className="tech-tiers">
          {tiers.map((tier) => {
            const nodes = TECHS.filter((t) => t.tier === tier)
            return (
              <div key={tier} className="tech-tier-col">
                <div className="tech-tier-label">Kademe {tier}</div>
                {nodes.map((node) => {
                  const done = isTechDone(gs, node.id)
                  const check = canUnlockTech(gs, node.id)
                  const reqNames = node.requires.map((r) => TECH_BY_ID[r]?.name ?? r)
                  return (
                    <article
                      key={node.id}
                      className={`tech-node${done ? ' is-done' : check.ok ? ' is-ready' : ' is-locked'}`}
                    >
                      <div className="tech-node-top">
                        <span className="tech-icon">{node.icon}</span>
                        <div>
                          <h3>{node.name}</h3>
                          <small>{node.cost === 0 ? 'Başlangıç' : `${fmt(node.cost)} ₡`}</small>
                        </div>
                      </div>
                      <p className="tech-desc">{node.desc}</p>
                      <ul className="tech-effects">
                        {node.effects.map((ef) => (
                          <li key={ef}>{ef}</li>
                        ))}
                      </ul>
                      {reqNames.length > 0 && !done && (
                        <div className="tech-reqs">Gereksinim: {reqNames.join(' + ')}</div>
                      )}
                      {done ? (
                        <span className="tech-badge-done">✓ Araştırıldı</span>
                      ) : (
                        <button
                          type="button"
                          className="tech-unlock-btn"
                          disabled={!check.ok}
                          onClick={() => research(node.id)}
                          title={check.reason}
                        >
                          {check.ok ? `Araştır — ${fmt(node.cost)} ₡` : check.reason}
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
