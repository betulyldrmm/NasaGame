import { lazy, Suspense, useEffect, useState } from 'react'
import { effectiveIncomeDt, tickBasesOnly, totalPassiveIncomePerHour } from './flight/world'
import AuthScreen from './components/AuthScreen'
import BuilderScreen from './components/BuilderScreen'
import IntroCutscene from './components/IntroCutscene'
import PlanetGridPanel from './components/ColonyPanel'
import { bump, clearOfflineGain, initAuth, logoutAccount, resetGame, saveGame, setIdleWarp, sim, useAuthState, useGame } from './game/store'
import { audio } from './audio'
import { messages } from './i18n/tr'

const FlightScreen = lazy(() => import('./components/FlightScreen'))

type Dialog = 'how-to-play' | null
const IDLE_WARPS = [1, 5, 25]
const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

function App() {
  const gs = useGame()
  const auth = useAuthState()
  const [dialog, setDialog] = useState<Dialog>(null)
  const setShowTech = (_open: boolean) => undefined
  const [showGrid, setShowGrid] = useState(false)
  const [showCutscene, setShowCutscene] = useState(false)
  const [screen, setScreen] = useState<'home' | 'assembly' | 'flight'>('home')

  useEffect(() => {
    void initAuth()
  }, [])

  useEffect(() => {
    if (screen === 'home') audio.music('menu')
  }, [screen])

  // Yeni girişte tamamen yeni hesapsa intro sinematiğini aç
  useEffect(() => {
    if (auth.user && gs.vessels.length === 0 && gs.missionsDone.length === 0 && gs.time < 1) {
      setShowCutscene(true)
    } else if (!auth.user) {
      setShowCutscene(false)
      setScreen('home')
    }
  }, [auth.user])

  // Ana menü ve montaj ekranında da pasif gelir işlesin (takvim 1×–25×, gelir en fazla 5×)
  useEffect(() => {
    if (!auth.user || screen === 'flight') return
    const timer = window.setInterval(() => {
      tickBasesOnly(sim.gs, effectiveIncomeDt(0.25, auth.idleWarp), 0.25 * auth.idleWarp)
      void saveGame()
      bump()
    }, 250)
    return () => clearInterval(timer)
  }, [auth.user, auth.idleWarp, screen])

  if (!auth.checked) {
    return <main className="flight-loading">Hesap kontrol ediliyor…</main>
  }

  if (!auth.user) {
    return <AuthScreen />
  }

  if (screen === 'assembly') {
    return <BuilderScreen onBack={() => setScreen('home')} onFly={() => setScreen('flight')} />
  }

  if (screen === 'flight') {
    return (
      <Suspense fallback={<main className="flight-loading">{messages.sceneLoading}</main>}>
        <FlightScreen onBuilder={() => setScreen('assembly')} />
      </Suspense>
    )
  }

  const passivePerHr = totalPassiveIncomePerHour(gs)

  return (
    <main className="app-shell">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <a className="wordmark" href="#home" aria-label={messages.title}>
          <span className="wordmark-icon" aria-hidden="true">
            ✦
          </span>
          <span>MISSION CONTROL</span>
        </a>
        <div className="topbar-account">
          <span className="account-pill" title="Aktif hesap">
            👤 {auth.user.username}
          </span>
          <span className="income-pill" title="Saatlik pasif gelir">
            💰 {fmt(gs.money)} ₡ <small>(+{fmt(passivePerHr)} ₡/sa)</small>
          </span>
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
          <button type="button" className="hud-btn" onClick={() => void logoutAccount()}>
            Çıkış
          </button>
        </div>
      </header>

      {auth.offlineGain && (
        <div className="offline-banner">
          <span>
            Hoş geldin <b>{auth.user.username}</b>! Yokluğunda ({Math.round(auth.offlineGain.seconds / 60)} dk) üslerin{' '}
            <b>+{fmt(auth.offlineGain.money)} ₡</b> pasif gelir kazandırdı.
          </span>
          <button type="button" className="hud-btn" onClick={clearOfflineGain}>Tamam</button>
        </div>
      )}

      <section className="hero" id="home">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> {messages.eyebrow}
          </p>
          <h1>
            {messages.title}
            <span>.</span>
          </h1>
          <p className="intro">
            Kare grid üzerinde roketini kur, Dünya'dan kalk ve yörüngeye yerleş. ISS'e kargo götür, Ay'a ve Mars'a in, güneş enerjisiyle çalışan koloniler kur.
            </p>
          <div className="actions">
            <button className="button button-primary" onClick={() => setScreen('assembly')}>
              <span aria-hidden="true">＋</span> {messages.newMission}
            </button>
            {sim.gs.vessels.length > 0 && (
              <button className="button button-secondary" onClick={() => setScreen('flight')}>
                Uçuşa devam et
              </button>
            )}
            <button className="button button-secondary" onClick={() => setShowGrid(true)}>
              🏗️ Koloni
            </button>
            <button
              className="button button-secondary"
              onClick={() => {
                if (window.confirm('Tüm ilerleme silinip yeni oyuna başlansın mı?')) resetGame()
              }}
            >
              Yeni oyun
            </button>
            <button className="button button-secondary" onClick={() => setShowCutscene(true)}>
              🎬 İntroyu İzle
            </button>
            <button className="button button-secondary" onClick={() => setDialog('how-to-play')}>
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
            EARTH <span>●</span>
          </div>
          <div className="orbit-label label-moon">SOLAR SYSTEM</div>
          <div className="coordinate">
            MISSION
            <br />
            CONTROL
            <br />
            <b>37° 34′ N</b>
          </div>
          <div className="crosshair">＋</div>
        </div>
      </section>

      <footer className="footer">
        <span>SPACE MISSION DESIGN GAME</span>
        <span>{messages.footer}</span>
      </footer>

      {showCutscene && (
        <IntroCutscene
          onFinish={() => {
            setShowCutscene(false)
            setScreen('assembly')
          }}
        />
      )}


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

      {dialog && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setDialog(null)}>
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="dialog-close" aria-label={messages.close} onClick={() => setDialog(null)}>
              ×
            </button>
            <p className="eyebrow">
              <span /> {messages.dialogEyebrow}
            </p>
            <h2 id="dialog-title">{messages.howToPlay}</h2>
            <p>{messages.instructions}</p>
            <button className="button button-primary dialog-button" onClick={() => setDialog(null)}>
              {messages.gotIt}
            </button>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
