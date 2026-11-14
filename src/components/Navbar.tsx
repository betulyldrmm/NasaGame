import { EMERGENCY_GRANT_THRESHOLD_CREDITS, PLANETS } from '../game/data'
import { evaluateColony } from '../game/calculations'
import { useGameStore } from '../game/store'

export function Navbar() {
  const {
    screen,
    setScreen,
    setActiveModal,
    budgetCredits,
    scienceXP,
    turn,
    colonies,
    claimEmergencyGrant,
  } = useGameStore()

  const totalColonyModules = Object.values(colonies).reduce((sum, list) => sum + list.length, 0)
  const hasBlackout = PLANETS.some((p) => {
    const mods = colonies[p.id] ?? []
    return mods.length > 0 && evaluateColony(p, mods).isBlackout
  })

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="wordmark-btn"
          onClick={() => setScreen('HOME')}
          aria-label="Ana ekrana dön"
        >
          <span className="wordmark-icon" aria-hidden="true">✦</span>
          <span>NASA MISSION CONTROL</span>
        </button>

        <nav className="nav-tabs" aria-label="Oyun Ekranları">
          <button
            type="button"
            className={`nav-tab ${screen === 'HOME' ? 'active' : ''}`}
            onClick={() => setScreen('HOME')}
          >
            Üs Merkezi
          </button>
          <button
            type="button"
            className={`nav-tab ${screen === 'ASSEMBLY' ? 'active' : ''}`}
            onClick={() => setScreen('ASSEMBLY')}
          >
            🚀 Roket Montaj (VAB)
          </button>
          <button
            type="button"
            className={`nav-tab ${screen === 'COLONY' ? 'active' : ''} ${hasBlackout ? 'alert-pulse' : ''}`}
            onClick={() => setScreen('COLONY')}
          >
            🏙️ Koloni Üssü ({totalColonyModules})
            {hasBlackout && <span className="badge-danger">⚡ ŞALTER!</span>}
          </button>
          <button
            type="button"
            className="nav-tab"
            onClick={() => setActiveModal('TECH_TREE')}
          >
            🔬 Ar-Ge ({scienceXP} XP)
          </button>
          <button
            type="button"
            className="nav-tab"
            onClick={() => setActiveModal('ENCYCLOPEDIA')}
          >
            📡 NASA Veri Rehberi
          </button>
        </nav>
      </div>

      <div className="hud-stats">
        {budgetCredits < EMERGENCY_GRANT_THRESHOLD_CREDITS + 90 && (
          <button
            type="button"
            className="grant-btn"
            onClick={claimEmergencyGrant}
            title="Kasada roket yapacak kredi azaldığında NASA Acil Araştırma Fonu ve LEO uydu görevi verir"
          >
            🆘 NASA Acil Hibe (+450 ₡)
          </button>
        )}
        <div className="hud-pill hud-credits" title="Mevcut Görev Bütçesi (Kredi)">
          <span className="hud-label">BÜTÇE</span>
          <strong className="hud-value">{budgetCredits.toLocaleString('tr-TR')} ₡</strong>
        </div>
        <div className="hud-pill hud-science" title="Hatalardan ve görevlerden kazanılan Telemetri / Bilim Puanı">
          <span className="hud-label">TELEMETRİ BİLİM</span>
          <strong className="hud-value">{scienceXP} XP</strong>
        </div>
        <div className="hud-pill hud-turn" title="Görev Turu">
          <span className="hud-label">GÖREV TURU</span>
          <strong className="hud-value">#{turn}</strong>
        </div>
      </div>
    </header>
  )
}
