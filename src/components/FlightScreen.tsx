import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { getRocketConfiguration, useRocketAssembly } from '../game/assemblyStore'
import { messages } from '../i18n/tr'
import { MISSION_DESTINATIONS, evaluateMission, type LandingEquipment, type MissionEvaluation } from '../flight/mission'
import { createFlightState, type FlightState } from '../flight/physics'
import type { PhaserFlightHandle } from './PhaserFlightView'

const PhaserFlightView = lazy(() => import('./PhaserFlightView'))

interface FlightScreenProps {
  onBack: () => void
}

type FlightScreenMode = 'ready' | 'flying' | 'result'

function formatAltitude(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function FlightScreen({ onBack }: FlightScreenProps) {
  const assembly = useRocketAssembly()
  const configuration = useMemo(() => getRocketConfiguration(assembly), [assembly.bodyId, assembly.engineId, assembly.fuelTankId, assembly.payloadIds])
  const [destinationId, setDestinationId] = useState<'moon' | 'mars'>('moon')
  const [landingEquipment, setLandingEquipment] = useState<LandingEquipment>({ parachute: false, heatShield: false, poweredDescent: true })
  const [flightState, setFlightState] = useState<FlightState>(() => createFlightState(configuration))
  const [evaluation, setEvaluation] = useState<MissionEvaluation | null>(null)
  const [mode, setMode] = useState<FlightScreenMode>('ready')
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneError, setSceneError] = useState('')
  const flightRef = useRef<PhaserFlightHandle>(null)
  const destination = MISSION_DESTINATIONS.find((item) => item.id === destinationId)!

  const finishMission = (finalState: FlightState) => {
    setFlightState(finalState)
    setEvaluation(evaluateMission(configuration, destination, { landingEquipment }, finalState))
    setMode('result')
  }

  const startFlight = () => {
    setSceneError('')
    setEvaluation(null)
    setMode('flying')
    if (!flightRef.current?.launch()) {
      setSceneError(messages.flightNotReady)
      setMode('ready')
    }
  }

  const restart = () => {
    flightRef.current?.reset()
    setEvaluation(null)
    setMode('ready')
  }

  const toggleEquipment = (key: keyof LandingEquipment) => {
    setLandingEquipment((current) => ({ ...current, [key]: !current[key] }))
  }

  return <div className="flight-page">
    <header className="flight-topbar">
      <button className="back-button" onClick={onBack}>← <span>{messages.backToAssembly}</span></button>
      <a className="wordmark" href="#flight"><span className="wordmark-icon">✦</span><span>MISSION CONTROL</span></a>
      <span className="flight-phase">FAZ 03 · DİKEY UÇUŞ</span>
    </header>

    <main className="flight-layout">
      <section className="flight-heading">
        <p className="eyebrow"><span /> {messages.flightEyebrow}</p>
        <h1>{mode === 'result' ? (evaluation?.success ? messages.missionSuccess : messages.missionIncomplete) : messages.flightTitle}<span>.</span></h1>
        <p>{messages.flightIntro}</p>
      </section>

      <div className="flight-columns">
        <section className="mission-panel panel-card">
          <div className="panel-heading"><div><span className="section-index">01</span><h2>{messages.missionSetup}</h2></div><span className="flight-status-pill"><i className={mode === 'flying' ? 'is-live' : ''}/>{mode === 'flying' ? messages.flightLive : mode === 'result' ? messages.flightComplete : messages.flightReady}</span></div>

          <label className="mission-select-label" htmlFor="destination">{messages.destinationLabel}</label>
          <select id="destination" className="mission-select" value={destinationId} disabled={mode !== 'ready'} onChange={(event) => {
            const value = event.target.value as 'moon' | 'mars'
            setDestinationId(value)
            setLandingEquipment(value === 'mars'
              ? { parachute: true, heatShield: true, poweredDescent: true }
              : { parachute: false, heatShield: false, poweredDescent: true })
          }}>
            {MISSION_DESTINATIONS.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.gravityMps2.toFixed(2)} m/s²</option>)}
          </select>

          <div className="landing-block">
            <h3>{messages.landingSystems}</h3>
            <p>{destination.atmosphere === 'none' ? messages.moonAtmosphere : messages.marsAtmosphere}</p>
            {([
              ['parachute', messages.parachute],
              ['heatShield', messages.heatShield],
              ['poweredDescent', messages.poweredDescent],
            ] as const).map(([key, label]) => <label className={`equipment-option ${mode !== 'ready' ? 'disabled' : ''}`} key={key}>
              <input type="checkbox" checked={landingEquipment[key]} disabled={mode !== 'ready'} onChange={() => toggleEquipment(key)}/>
              <span className="custom-check" aria-hidden="true">✓</span><span>{label}</span>
            </label>)}
          </div>

          {mode === 'ready' && <div className="launch-explainer"><span>i</span><p>{messages.launchModelNote}</p></div>}
          {mode === 'result' && evaluation && <div className={`mission-verdict ${evaluation.success ? 'success' : 'failure'}`}>
            <b>{evaluation.success ? messages.missionSuccess : messages.missionNeedsWork}</b>
            {evaluation.failureReasons.length > 0 ? <ul>{evaluation.failureReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>{messages.resultSuccessText}</p>}
          </div>}
          {sceneError && <p className="flight-error" role="alert">{sceneError}</p>}

          {mode === 'ready' && <button className="button button-primary launch-button" disabled={!sceneReady} onClick={startFlight}><span>▲</span> {sceneReady ? messages.launchButton : messages.sceneLoading}</button>}
          {mode === 'flying' && <p className="flight-running" role="status"><i /> {messages.flightInProgress}</p>}
          {mode === 'result' && <div className="result-actions"><button className="button button-secondary" onClick={restart}>{messages.retryFlight}</button><button className="button button-primary" onClick={onBack}>{messages.returnToAssembly}</button></div>}
        </section>

        <section className="flight-view-panel panel-card">
          <div className="panel-heading"><div><span className="section-index">02</span><h2>{messages.flightSceneTitle}</h2></div><span className="live-tag"><i className={mode === 'flying' ? 'flight-dot-live' : ''}/>{mode === 'flying' ? 'LIVE' : '2D SIM'}</span></div>
          <Suspense fallback={<div className="phaser-loading">{messages.sceneLoading}</div>}>
            <PhaserFlightView
              ref={flightRef}
              configuration={configuration}
              onReady={() => setSceneReady(true)}
              onUpdate={setFlightState}
              onComplete={finishMission}
            />
          </Suspense>
          <div className="flight-hud" aria-live="polite">
            <div><span>{messages.altitudeLabel}</span><b>{formatAltitude(flightState.altitudeM)}</b></div>
            <div><span>{messages.speedLabel}</span><b>{flightState.velocityMps.toFixed(1)} m/s</b></div>
            <div><span>{messages.fuelLabel}</span><b>{flightState.fuelRemainingKg.toFixed(0)} kg</b></div>
            <div><span>{messages.maxAltitudeLabel}</span><b>{formatAltitude(flightState.maxAltitudeM)}</b></div>
          </div>
          <div className="flight-rocket-label">{configuration.body.name} <span>·</span> {configuration.engine.name} <span>·</span> {configuration.fuelTank?.name ?? messages.noTank}</div>
          {evaluation && <div className="mission-metrics">
            <div><span>TWR</span><b>{evaluation.metrics.launchTwr.toFixed(2)}</b></div>
            <div><span>{messages.deltaVCapacity}</span><b>{evaluation.metrics.deltaVCapacityMps.toFixed(0)} m/s</b></div>
            <div><span>{messages.deltaVRequirement}</span><b>{evaluation.metrics.deltaVRequiredMps} m/s</b></div>
            <div><span>{messages.targetGravity}</span><b>{evaluation.metrics.destinationGravityMps2.toFixed(2)} m/s²</b></div>
          </div>}
          {evaluation && <div className="learning-cards">{evaluation.learningCards.map((card) => <article key={card.title}><h3>{card.title}</h3><p>{card.explanation}</p></article>)}</div>}
        </section>
      </div>
      <footer className="flight-footer"><span>SPACE MISSION DESIGN GAME</span><span>{messages.flightFooter}</span></footer>
    </main>
  </div>
}

export default FlightScreen
