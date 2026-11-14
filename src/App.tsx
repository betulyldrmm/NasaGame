import { AssemblyScreen } from './components/AssemblyScreen'
import { ColonyScreen } from './components/ColonyScreen'
import { EncyclopediaModal } from './components/EncyclopediaModal'
import { FlightSimulator } from './components/FlightSimulator'
import { LearningCardModal } from './components/LearningCardModal'
import { Navbar } from './components/Navbar'
import { TechTreeModal } from './components/TechTreeModal'
import { MISSIONS } from './game/data'
import { useGameStore } from './game/store'
import { messages } from './i18n/tr'

function App() {
  const {
    screen,
    setScreen,
    setActiveModal,
    selectPlanet,
    flightLogs,
    discoveredFailures,
  } = useGameStore()

  return (
    <main className="app-shell">
      <div className="stars" aria-hidden="true" />
      <Navbar />

      {screen === 'HOME' && (
        <>
          <section className="hero" id="home">
            <div className="hero-copy">
              <p className="eyebrow">
                <span /> {messages.eyebrow}
              </p>
              <h1>
                {messages.title}
                <span>.</span>
              </h1>
              <p className="intro">{messages.description}</p>
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setScreen('ASSEMBLY')}
                >
                  <span aria-hidden="true">🚀</span> {messages.newMission}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setScreen('COLONY')}
                >
                  <span aria-hidden="true">🏙️</span> {messages.colonyHub}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setActiveModal('ENCYCLOPEDIA')}
                >
                  <span className="help-icon" aria-hidden="true">
                    ?
                  </span>{' '}
                  {messages.howToPlay}
                </button>
              </div>
              <div className="hero-footnote">
                <span className="line" /> {messages.footnote}
              </div>
            </div>

            <div className="orbit-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="planet">
                <div className="planet-shadow" />
                <div className="planet-ring" />
              </div>
              <div className="moon moon-one" />
              <div className="moon moon-two" />
              <div className="orbit-label label-earth">
                EARTH 1.0 AU <span>●</span>
              </div>
              <div className="orbit-label label-moon">MARS 1.52 AU · EUROPA 5.2 AU</div>
              <div className="coordinate">
                NASA NSSDC
                <br />
                FACT SHEET
                <br />
                <b>9.81 m/s²</b>
              </div>
              <div className="crosshair">＋</div>
            </div>
          </section>

          {/* Visual Showcase & Active NASA Contracts */}
          <section className="home-dashboard">
            <div className="home-Visual-cards">
              <article className="showcase-card" onClick={() => setScreen('ASSEMBLY')}>
                <img src="/assets/rocket-blueprint-showcase.jpg" alt="Modüler Roket Tasarımı" />
                <div className="showcase-body">
                  <span className="eyebrow-tag">MODÜLER ROKET HANGARI (VAB)</span>
                  <h3>TWR, CoM/CoP ve Tsiolkovsky Delta-V</h3>
                  <p>
                    Gövde, motor, yakıt tankı, kanatçık ve iniş sistemini birleştirin. Canlı Sarı Daire (CoM) ve Mavi
                    Üçgen (CoP) göstergesiyle aerodinamik dengeyi sağlayın.
                  </p>
                </div>
              </article>

              <article className="showcase-card" onClick={() => setScreen('COLONY')}>
                <img src="/assets/colony-cross-section.jpg" alt="2D Kesit Uzay Kolonisi" />
                <div className="showcase-body">
                  <span className="eyebrow-tag">2D KESİT KOLONİ ÜSSÜ</span>
                  <h3>1/r² Güneş Yasası, RTG ve Gelir Döngüsü</h3>
                  <p>
                    Gezegene indirdiğiniz Sera, Maden Aracı ve Yaşam Modüllerini yeraltı/yüzey kesitinde yönetin. Net
                    enerjiyi pozitif tutarak her tur Kredi ve Bilim kazanın.
                  </p>
                </div>
              </article>

              <article className="showcase-card" onClick={() => setActiveModal('ENCYCLOPEDIA')}>
                <img src="/assets/solar-system-banner.jpg" alt="Güneş Sistemi Transfer Yörüngeleri" />
                <div className="showcase-body">
                  <span className="eyebrow-tag">FAIL-FORWARD EĞİTİM SİSTEMİ</span>
                  <h3>Hata Yap, Gözlemle, Nedenini Öğren</h3>
                  <p>
                    Rampada iptal (%15 yakıt kaybı), atmosferik takla veya vakumda paraşüt hatası... Her yeni hata türü
                    size Ar-Ge laboratuvarı için +35 Bilim Puanı kazandırır!
                  </p>
                </div>
              </article>
            </div>

            <div className="missions-and-logs-grid">
              <div className="contracts-panel">
                <h3>🎯 Önerilen NASA Görev Kontratları</h3>
                <div className="contracts-list">
                  {MISSIONS.map((m) => (
                    <div key={m.id} className="contract-item">
                      <div>
                        <strong>{m.name}</strong>
                        <p>{m.description}</p>
                      </div>
                      <div className="contract-right">
                        <span className="contract-reward">+{m.rewardCredits} ₡</span>
                        <button
                          type="button"
                          className="chip-btn"
                          onClick={() => {
                            selectPlanet(m.destinationPlanetId)
                            setScreen('ASSEMBLY')
                          }}
                        >
                          Hedefi Seç →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="contracts-panel">
                <h3>
                  📋 Uçuş Telemetri Kayıtları ({flightLogs.length} Uçuş · {discoveredFailures.length} Keşfedilen Hata)
                </h3>
                {flightLogs.length === 0 ? (
                  <p className="empty-log-text">
                    Henüz fırlatma yapılmadı. Roket Montaj (VAB) ekranına geçerek ilk test uçuşunuzu başlatın!
                  </p>
                ) : (
                  <div className="logs-list">
                    {flightLogs.map((log) => (
                      <div key={log.id} className="log-row">
                        <span>
                          <b>Tur #{log.turn}</b> · {log.planetName} ({log.rocketName})
                        </span>
                        <span className={log.isSuccess ? 'log-ok' : 'log-fail'}>
                          {log.isSuccess ? '✓ BAŞARILI' : `✕ ${log.failureStage} (${log.failureCode})`}
                        </span>
                        <span>
                          {log.costDeltaCredits >= 0 ? `+${log.costDeltaCredits}` : log.costDeltaCredits} ₡ · +
                          {log.scienceEarned} XP
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {screen === 'ASSEMBLY' && <AssemblyScreen />}
      {screen === 'FLIGHT' && <FlightSimulator />}
      {screen === 'COLONY' && <ColonyScreen />}

      <LearningCardModal />
      <TechTreeModal />
      <EncyclopediaModal />

      <footer className="footer">
        <span>SPACE MISSION DESIGN GAME · NASA NSSDC & JPL DATA INTEGRATED</span>
        <span>{messages.footer}</span>
      </footer>
    </main>
  )
}

export default App
