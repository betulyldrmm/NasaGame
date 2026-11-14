import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { getRocketConfiguration, useRocketAssembly } from '../game/assemblyStore'
import { calculateAssemblyTWR } from '../game/assemblyStore'
import { calculateRocketCost } from '../game/calculations'
import { messages } from '../i18n/tr'
import { MISSION_DESTINATIONS, evaluateMission, type LandingEquipment, type MissionEvaluation } from '../flight/mission'
import { createFlightState, type FlightState } from '../flight/physics'
import { useEconomyStore } from '../economy/economyStore'
import { applyColonyTurn } from '../economy/economy'
import type { PhaserFlightHandle } from './PhaserFlightView'
import { SceneErrorBoundary } from './SceneErrorBoundary'
import { PLANETARY_REFERENCE } from '../data/planetaryReference'
import KeplerOrbitPreview from './KeplerOrbitPreview'

const PhaserFlightView = lazy(() => import('./PhaserFlightView'))

interface FlightScreenProps {
  onBack: () => void
  onBase: () => void
}

type FlightScreenMode = 'ready' | 'pad' | 'flying' | 'result'

function formatAltitude(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function createMissionId(): string {
  return `mission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function FlightScreen({ onBack, onBase }: FlightScreenProps) {
  const assembly = useRocketAssembly()
  const activeMission = useEconomyStore((state) => state.missions.find((mission) => mission.id === state.activeMissionId) ?? null)
  const missions = useEconomyStore((state) => state.missions)
  const balanceCredits = useEconomyStore((state) => state.balanceCredits)
  const beginMissionAction = useEconomyStore((state) => state.beginMission)
  const markMissionLaunched = useEconomyStore((state) => state.markMissionLaunched)
  const updateMissionFlight = useEconomyStore((state) => state.updateMissionFlight)
  const cancelMissionAtPad = useEconomyStore((state) => state.cancelMissionAtPad)
  const settleFlightMission = useEconomyStore((state) => state.settleFlightMission)
  const claimResearchSupport = useEconomyStore((state) => state.claimResearchSupport)

  const [configuration] = useState(() => activeMission?.rocketConfiguration ?? getRocketConfiguration(assembly))
  const [destinationId, setDestinationId] = useState<'moon' | 'mars'>(() => activeMission?.destinationId ?? 'moon')
  const destinationBase = useEconomyStore((state) => state.bases[destinationId])
  const [landingEquipment, setLandingEquipment] = useState<LandingEquipment>(() => activeMission?.landingEquipment ?? { parachute: false, heatShield: false, poweredDescent: true })
  const [missionId, setMissionId] = useState<string | null>(() => activeMission?.id ?? null)
  const [initialFlightState] = useState<FlightState | null>(() => activeMission?.flightState ?? null)
  const [flightState, setFlightState] = useState<FlightState>(() => activeMission?.flightState ?? createFlightState(configuration))
  const [evaluation, setEvaluation] = useState<MissionEvaluation | null>(() => activeMission?.evaluation ?? null)
  const [mode, setMode] = useState<FlightScreenMode>(() => activeMission ? (activeMission.stage === 'flight' ? 'flying' : 'pad') : 'ready')
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneError, setSceneError] = useState('')
  const flightRef = useRef<PhaserFlightHandle>(null)
  const lastPersistedElapsed = useRef(initialFlightState?.elapsedTimeS ?? 0)
  const destination = MISSION_DESTINATIONS.find((item) => item.id === destinationId)!
  const rocketCost = useMemo(() => calculateRocketCost(configuration), [configuration])
  const missionRecord = missions.find((mission) => mission.id === missionId) ?? null
  const colonyForecast = useMemo(() => applyColonyTurn(
    destinationBase.deliveredModules,
    destinationBase.resources,
    configuration.payloads.map((payload) => payload.id),
    destinationBase.completedTurns,
    destinationId,
  ), [configuration.payloads, destinationBase, destinationId])
  const solarIrradiance = PLANETARY_REFERENCE.solarIrradiance[destinationId]
  const canAfford = rocketCost <= balanceCredits
  const completedSuccessfully = missionRecord?.status === 'succeeded'

  const finishMission = (finalState: FlightState) => {
    setFlightState(finalState)
    const result = evaluateMission(configuration, destination, { landingEquipment }, finalState)
    if (missionId) settleFlightMission(missionId, result, finalState)
    setEvaluation(result)
    setMode('result')
  }

  const onFlightUpdate = (state: FlightState) => {
    setFlightState(state)
    if (missionId && mode === 'flying' && state.elapsedTimeS - lastPersistedElapsed.current >= 4) {
      lastPersistedElapsed.current = state.elapsedTimeS
      updateMissionFlight(missionId, state)
    }
  }

  const handleSceneReady = () => {
    setSceneReady(true)
    if (activeMission?.stage === 'flight') {
      if (initialFlightState && ['apogee', 'impact', 'liftoff-failed'].includes(initialFlightState.status)) {
        finishMission(initialFlightState)
      } else {
        flightRef.current?.resume()
      }
    }
  }

  const startMission = () => {
    const id = createMissionId()
    const result = beginMissionAction({ id, destination, rocket: configuration, landingEquipment })
    if (result !== 'started') {
      setSceneError(result === 'insufficient-funds' ? messages.insufficientFunds : messages.activeMissionExists)
      return
    }
    setMissionId(id)
    setMode('pad')
    setSceneError('')
  }

  const finishPadCancellation = (reason?: string) => {
    if (!missionId) return
    const baseEvaluation = evaluateMission(configuration, destination, { landingEquipment })
    const result: MissionEvaluation = {
      ...baseEvaluation,
      success: false,
      failureReasons: reason ? [reason, ...baseEvaluation.failureReasons] : [messages.padCancellationReason],
    }
    if (cancelMissionAtPad(missionId, result)) {
      setEvaluation(result)
      setMode('result')
    }
  }

  const launch = () => {
    setSceneError('')
    if (calculateAssemblyTWR(configuration) < 1) {
      finishPadCancellation(messages.padTwrFailure)
      return
    }
    if ((configuration.fuelTank?.fuelMassKg ?? 0) <= 0) {
      finishPadCancellation(messages.noFuelFailure)
      return
    }
    const initial = createFlightState(configuration)
    if (!flightRef.current?.launch()) {
      setSceneError(messages.flightNotReady)
      return
    }
    if (missionId) markMissionLaunched(missionId, initial)
    lastPersistedElapsed.current = 0
    setMode('flying')
  }

  const handleBack = () => {
    if (mode === 'ready') onBack()
    else if (mode === 'pad') finishPadCancellation()
    else if (mode === 'result') onBase()
  }

  const toggleEquipment = (key: keyof LandingEquipment) => {
    setLandingEquipment((current) => ({ ...current, [key]: !current[key] }))
  }

  const statusLabel = mode === 'flying' ? messages.flightLive : mode === 'result' ? messages.flightComplete : mode === 'pad' ? messages.rocketOnPad : messages.flightReady
  const heading = mode === 'result' ? (completedSuccessfully ? messages.missionSuccess : messages.missionIncomplete) : mode === 'pad' ? messages.rocketOnPad : messages.flightTitle

  return <div className="flight-page">
    <header className="flight-topbar">
      <button className="back-button" onClick={handleBack} disabled={mode === 'flying'}>{mode === 'pad' ? messages.cancelOnPad : mode === 'result' ? messages.openBase : messages.backToAssembly}</button>
      <a className="wordmark" href="#flight"><span className="wordmark-icon">✦</span><span>MISSION CONTROL</span></a>
      <span className="flight-phase">{messages.currentBudget} · {balanceCredits.toLocaleString('tr-TR')} cr</span>
    </header>

    <main className="flight-layout">
      <section className="flight-heading">
        <p className="eyebrow"><span /> {messages.flightEyebrow}</p>
        <h1>{heading}<span>.</span></h1>
        <p>{messages.flightIntro}</p>
      </section>

      <div className="flight-columns">
        <section className="mission-panel panel-card">
          <div className="panel-heading"><div><span className="section-index">01</span><h2>{messages.missionSetup}</h2></div><span className="flight-status-pill"><i className={mode === 'flying' ? 'is-live' : ''}/>{statusLabel}</span></div>

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

          <div className={`energy-forecast ${colonyForecast.lastTurnEnergyShortfall > 0 ? 'energy-insufficient' : ''}`}>
            <h3>{messages.solarForecast}</h3>
            <div><span>{messages.nasaIrradiance}</span><b>{solarIrradiance.valueWm2.toLocaleString('tr-TR')} W/m²</b></div>
            <div><span>{messages.solarProductionForecast}</span><b>{colonyForecast.lastTurnEnergyProduced.toFixed(1)} {messages.energyUnit}</b></div>
            <div><span>{messages.energyDemand}</span><b>{colonyForecast.lastTurnEnergyDemand.toFixed(1)} {messages.energyUnit}</b></div>
            {colonyForecast.lastTurnEnergyShortfall > 0 && <p role="status">{messages.energyShortfallExplain} ({colonyForecast.lastTurnEnergyShortfall.toFixed(1)} {messages.energyUnit})</p>}
            <small>NASA ışınımı, oyun içi enerji birimine panel başına 20 birim/Dünya referansı varsayımıyla ölçeklenir.</small>
          </div>
          <KeplerOrbitPreview destination={destinationId}/>

          {mode === 'ready' && <>
            <div className="mission-cost-card"><span>{messages.rocketProductionCost}</span><b>{rocketCost.toLocaleString('tr-TR')} cr</b></div>
            {rocketCost > balanceCredits && <div className="alert-box budget-alert"><span>!</span><p>{messages.insufficientFunds}</p></div>}
            <div className="launch-explainer"><span>i</span><p>{messages.launchModelNote}</p></div>
            {balanceCredits <= 0 && <div className="research-support"><p>{messages.supportOffer}</p><button className="button button-secondary" onClick={() => claimResearchSupport()}>{messages.claimSupport}</button></div>}
            <button className="button button-primary launch-button" disabled={!sceneReady || !canAfford} onClick={startMission}>{sceneReady ? messages.startMission : messages.sceneLoading}</button>
          </>}

          {mode === 'pad' && <>
            <div className="mission-cost-card"><span>{messages.costCharged}</span><b>{rocketCost.toLocaleString('tr-TR')} cr</b></div>
            <div className="launch-explainer"><span>i</span><p>{messages.cancelLossNote}</p></div>
            {sceneError && <p className="flight-error" role="alert">{sceneError}</p>}
            <button className="button button-primary launch-button" disabled={!sceneReady} onClick={launch}><span>▲</span> {sceneReady ? messages.launchButton : messages.sceneLoading}</button>
            <button className="button button-secondary launch-button" onClick={() => finishPadCancellation()}>{messages.cancelOnPad}</button>
          </>}

          {mode === 'flying' && <p className="flight-running" role="status"><i /> {messages.flightInProgress}</p>}
          {sceneError && mode !== 'pad' && <p className="flight-error" role="alert">{sceneError}</p>}

          {mode === 'result' && evaluation && <div className={`mission-verdict ${completedSuccessfully ? 'success' : 'failure'}`}>
            <b>{completedSuccessfully ? messages.missionSuccess : messages.missionNeedsWork}</b>
            {evaluation.failureReasons.length > 0 ? <ul>{evaluation.failureReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul> : <p>{messages.resultSuccessText}</p>}
            {missionRecord && <p className="economy-outcome">{missionRecord.status === 'succeeded'
              ? `+${missionRecord.rewardCredits} cr · +${missionRecord.scienceAward} SP`
              : missionRecord.status === 'cancelled'
                ? `${messages.padLoss}: ${missionRecord.penaltyCredits} cr · ${messages.refund}: ${missionRecord.refundCredits} cr`
                : `${messages.flightLoss}: ${missionRecord.costCredits} cr`}</p>}
          </div>}

          {mode === 'result' && <div className="result-actions"><button className="button button-secondary" onClick={onBack}>{messages.returnToAssembly}</button><button className="button button-primary" onClick={onBase}>{messages.openBase}</button></div>}
        </section>

        <section className="flight-view-panel panel-card">
          <div className="panel-heading"><div><span className="section-index">02</span><h2>{messages.flightSceneTitle}</h2></div><span className="live-tag"><i className={mode === 'flying' ? 'flight-dot-live' : ''}/>{mode === 'flying' ? 'LIVE' : '2D SIM'}</span></div>
          <SceneErrorBoundary message={messages.sceneLoadError}>
            <Suspense fallback={<div className="phaser-loading">{messages.sceneLoading}</div>}>
              <PhaserFlightView
                ref={flightRef}
                configuration={configuration}
                initialState={initialFlightState}
                onReady={handleSceneReady}
                onUpdate={onFlightUpdate}
                onComplete={finishMission}
              />
            </Suspense>
          </SceneErrorBoundary>
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
