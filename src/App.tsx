import { menuState } from './components/menuState'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { effectiveIncomeDt, tickBasesOnly, totalPassiveIncomePerMin } from './flight/world'
import { enterMpMode, exitMpMode, useMultiplayer } from './flight/mpClient'
import { resetViewCache } from './render/renderer'
import AuthScreen from './components/AuthScreen'
import BuilderScreen from './components/BuilderScreen'
import MultiplayerLobby from './components/MultiplayerLobby'
import MenuHangarCanvas from './components/MenuHangarCanvas'
import { bump, clearOfflineGain, initAuth, logoutAccount, resetGame, saveGame, setIdleWarp, sim, useAuthState, useGame } from './game/store'
import { audio } from './audio'
import { messages } from './i18n/tr'

const FlightScreen = lazy(() => import('./components/FlightScreen'))

const IDLE_WARPS = [1, 5, 25]
const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')

function App() {
  const gs = useGame()
  const auth = useAuthState()
  const mp = useMultiplayer()
  const [screen, setScreen] = useState<'home' | 'assembly' | 'flight'>('home')
  const prevInMatch = useRef(false)

  useEffect(() => {
    void initAuth()
  }, [])

  useEffect(() => {
    if (mp.inMatch && !prevInMatch.current) {
      resetViewCache()
      setScreen('flight')
    } else if (!mp.inMatch && prevInMatch.current) {
      resetViewCache()
      setScreen('home')
    }
    prevInMatch.current = mp.inMatch
  }, [mp.inMatch])

  useEffect(() => {
    if (screen === 'home' && !mp.active) audio.music('menu')
  }, [screen, mp.active])

  // Çıkış yapılınca çok oyunculu moddan çık ve ana menüye dön
  useEffect(() => {
    if (!auth.user) {
      exitMpMode()
      setScreen('home')
    }
  }, [auth.user])

  // Ana menü ve montaj ekranında da pasif gelir işlesin (takvim 1×–25×, gelir en fazla 5×)
  useEffect(() => {
    if (!auth.user || screen === 'flight' || mp.active) return
    const timer = window.setInterval(() => {
      tickBasesOnly(sim.gs, effectiveIncomeDt(0.25, auth.idleWarp), 0.25 * auth.idleWarp)
      void saveGame()
      bump()
    }, 250)
    return () => clearInterval(timer)
  }, [auth.user, auth.idleWarp, screen, mp.active])

  const showMenu = !auth.user || (screen === 'home' && !mp.active && !mp.inMatch)
  useEffect(() => {
    menuState.set(showMenu)
  }, [showMenu])

  if (!auth.checked) {
    return <main className="flight-loading">Hesap kontrol ediliyor…</main>
  }

  if (!auth.user) {
    return <AuthScreen />
  }

  if (mp.active && !mp.inMatch) {
    return (
      <MultiplayerLobby
        defaultName={auth.user.username}
        onBack={() => {
          exitMpMode()
          setScreen('home')
        }}
      />
    )
  }

  if (screen === 'assembly') {
    return <BuilderScreen onBack={() => setScreen('home')} onFly={() => setScreen('flight')} />
  }

  if (screen === 'flight' || mp.inMatch) {
    return (
      <Suspense fallback={<main className="flight-loading">{messages.sceneLoading}</main>}>
        <FlightScreen onBuilder={() => setScreen('assembly')} />
      </Suspense>
    )
  }

  const passivePerMin = totalPassiveIncomePerMin(gs)

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
          <span className="income-pill" title="Dakikalık pasif gelir">
            💰 {fmt(gs.money)} ₡ <small>(+{fmt(passivePerMin)} ₡/dk)</small>
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
        <MenuHangarCanvas />
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
            <button className="button mp-entry-btn" onClick={() => enterMpMode()}>
              <span aria-hidden="true">🏴‍☠️</span> Çevrim İçi Yağma (PvP)
            </button>
            {sim.gs.vessels.length > 0 && (
              <button className="button button-secondary" onClick={() => setScreen('flight')}>
                Uçuşa devam et
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={() => {
                if (window.confirm('Tüm ilerleme silinip yeni oyuna başlansın mı?')) resetGame()
              }}
            >
              Yeni oyun
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

    </main>
  )
}

export default App
