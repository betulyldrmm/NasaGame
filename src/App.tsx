import { lazy, Suspense, useState } from 'react'
import AssemblyScreen from './components/AssemblyScreen'
import BaseScreen from './components/BaseScreen'
import { useEconomyStore } from './economy/economyStore'
import { messages } from './i18n/tr'

const FlightScreen = lazy(() => import('./components/FlightScreen'))

type Dialog = 'how-to-play' | null

function App() {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [screen, setScreen] = useState<'home' | 'assembly' | 'flight' | 'base'>('home')
  const balanceCredits = useEconomyStore((state) => state.balanceCredits)
  const sciencePoints = useEconomyStore((state) => state.sciencePoints)
  const activeMission = useEconomyStore((state) => state.missions.find((mission) => mission.id === state.activeMissionId) ?? null)

  if (screen === 'assembly') return <AssemblyScreen onBack={() => setScreen('home')} onLaunch={() => setScreen('flight')} />
  if (screen === 'flight') return <Suspense fallback={<main className="flight-loading">{messages.sceneLoading}</main>}><FlightScreen onBack={() => setScreen('assembly')} onBase={() => setScreen('base')}/></Suspense>
  if (screen === 'base') return <BaseScreen onHome={() => setScreen('home')} onNewMission={() => setScreen('assembly')}/>

  return (
    <main className="app-shell">
      <div className="stars" aria-hidden="true" />
      <header className="topbar">
        <a className="wordmark" href="#home" aria-label={messages.title}>
          <span className="wordmark-icon" aria-hidden="true">✦</span>
          <span>MISSION CONTROL</span>
        </a>
        <span className="status"><span className="status-dot" /> {messages.status}</span>
      </header>

      <div className="home-economy-strip"><span>{messages.currentBudget} <b>{balanceCredits.toLocaleString('tr-TR')} cr</b></span><span>{messages.science} <b>{sciencePoints} SP</b></span><button onClick={() => setScreen('base')}>{messages.bases} →</button></div>
      {activeMission && <div className="resume-mission-card"><span className="status-dot"/><div><b>{messages.activeMission}</b><small>{activeMission.destinationId === 'moon' ? messages.moon : messages.mars} · {activeMission.rocketConfiguration.body.name}</small></div><button className="button button-secondary" onClick={() => setScreen('flight')}>{messages.resumeMission}</button></div>}

      <section className="hero" id="home">
        <div className="hero-copy">
          <p className="eyebrow"><span /> {messages.eyebrow}</p>
          <h1>{messages.title}<span>.</span></h1>
          <p className="intro">{messages.description}</p>
          <div className="actions">
            <button className="button button-primary" onClick={() => setScreen('assembly')}>
              <span aria-hidden="true">＋</span> {messages.newMission}
            </button>
            <button className="button button-secondary" onClick={() => setDialog('how-to-play')}>
              <span className="help-icon" aria-hidden="true">?</span> {messages.howToPlay}
            </button>
          </div>
          <div className="hero-footnote"><span className="line" /> {messages.footnote}</div>
        </div>

        <div className="orbit-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="planet"><div className="planet-shadow" /><div className="planet-ring" /></div>
          <div className="moon moon-one" /><div className="moon moon-two" />
          <div className="orbit-label label-earth">EARTH <span>●</span></div>
          <div className="orbit-label label-moon">LUNAR ORBIT</div>
          <div className="coordinate">MISSION<br />CONTROL<br /><b>37° 34′ N</b></div>
          <div className="crosshair">＋</div>
        </div>
      </section>

      <footer className="footer"><span>SPACE MISSION DESIGN GAME</span><span>{messages.footer}</span></footer>

      {dialog && <div className="dialog-backdrop" role="presentation" onClick={() => setDialog(null)}>
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(event) => event.stopPropagation()}>
          <button className="dialog-close" aria-label={messages.close} onClick={() => setDialog(null)}>×</button>
          <p className="eyebrow"><span /> {messages.dialogEyebrow}</p>
          <h2 id="dialog-title">{messages.howToPlay}</h2>
          <p>{messages.instructions}</p>
          <button className="button button-primary dialog-button" onClick={() => setDialog(null)}>{messages.gotIt}</button>
        </section>
      </div>}
    </main>
  )
}

export default App
