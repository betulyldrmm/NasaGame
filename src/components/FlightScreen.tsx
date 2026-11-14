import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { getRocketConfiguration, useRocketAssembly } from '../game/assemblyStore'
import { calculateRocketCost } from '../game/calculations'
import { messages } from '../i18n/tr'
import { MISSION_DESTINATIONS, evaluateMission, type MissionEvaluation } from '../flight/mission'
import { createFlightState, type FlightState } from '../flight/physics'
import type { PhaserFlightHandle } from './PhaserFlightView'

const PhaserFlightView = lazy(() => import('./PhaserFlightView'))

interface FlightScreenProps {
  onBack: () => void
  onOpenColony: () => void
}

type FlightScreenMode = 'ready' | 'flying' | 'result'

function formatAltitude(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function FlightScreen({ onBack, onOpenColony }: FlightScreenProps) {
  const assembly = useRocketAssembly()
  const configuration = useMemo(
    () => getRocketConfiguration(assembly),
    [assembly.bodyId, assembly.engineId, assembly.fuelTankId, assembly.payloadIds],
  )
  const [flightState, setFlightState] = useState<FlightState>(() => createFlightState(configuration))
  const [phase, setPhase] = useState<'launch' | 'space' | 'landing'>('launch')
  const [landingSpeed, setLandingSpeed] = useState(0)
  const [throttle, setThrottle] = useState(100)
  const [autoPilot, setAutoPilot] = useState(true)
  const [evaluation, setEvaluation] = useState<MissionEvaluation | null>(null)
  const [customCrashReason, setCustomCrashReason] = useState<string | null>(null)
  const [mode, setMode] = useState<FlightScreenMode>('ready')
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneError, setSceneError] = useState('')
  const flightRef = useRef<PhaserFlightHandle>(null)
  const destination = MISSION_DESTINATIONS.find((item) => item.id === assembly.destinationId)!

  const finishMission = (finalState: FlightState, landedSafely: boolean, crashReason?: string) => {
    setFlightState(finalState)
    const evalResult = evaluateMission(
      configuration,
      destination,
      {
        landingEquipment: {
          parachute: assembly.parachute,
          heatShield: assembly.heatShield,
          poweredDescent: assembly.poweredDescent,
        },
      },
      finalState,
    )
    const finalSuccess = evalResult.success && landedSafely && !crashReason
    setCustomCrashReason(crashReason ?? null)
    setEvaluation({
      ...evalResult,
      success: finalSuccess,
      failureReasons: crashReason ? [crashReason, ...evalResult.failureReasons] : evalResult.failureReasons,
    })

    const rocketCost = calculateRocketCost(configuration)
    if (finalSuccess) {
      const reward = assembly.destinationId === 'mars' ? 850 : 520
      assembly.rewardMission(reward, 40, assembly.payloadIds, assembly.destinationId)
    } else if (finalState.status === 'liftoff-failed') {
      // Progressive Cost Loss: Only 15% fuel cost lost on pad failure!
      assembly.spendFuelAbort(Math.round(rocketCost * 0.15))
    } else {
      assembly.spendFuelAbort(rocketCost)
    }
    setMode('result')
  }

  const startFlight = () => {
    setSceneError('')
    setEvaluation(null)
    setCustomCrashReason(null)
    setMode('flying')
    if (!flightRef.current?.launch()) {
      setSceneError(messages.flightNotReady)
      setMode('ready')
    }
  }

  const abortOnPad = () => {
    flightRef.current?.reset()
    const padCost = Math.round(calculateRocketCost(configuration) * 0.15)
    assembly.spendFuelAbort(padCost)
    setCustomCrashReason(`Rampada iptal edildi: Yalnızca %15 yakıt parası (-${padCost} cr) harcandı, roket kurtarıldı!`)
    setMode('ready')
  }

  const restart = () => {
    flightRef.current?.reset()
    setEvaluation(null)
    setCustomCrashReason(null)
    setMode('ready')
  }

  return (
    <div className="flight-page">
      <header className="flight-topbar">
        <button className="back-button" onClick={onBack}>
          ← <span>{messages.backToAssembly}</span>
        </button>
        <a className="wordmark" href="#flight">
          <span className="wordmark-icon">✦</span>
          <span>SPACEFLIGHT SIMULATOR</span>
        </a>
        <div className="topbar-right-pills">
          <button type="button" className="mini-nav-btn" onClick={onOpenColony}>
            🏗️ Koloni Üssü
          </button>
          <span className="flight-phase">BÜTÇE: {assembly.budgetCredits} cr</span>
        </div>
      </header>

      <main className="flight-layout">
        <div className="flight-columns">
          <section className="mission-panel panel-card">
            <div className="panel-heading">
              <div>
                <span className="section-index">01</span>
                <h2>{messages.missionSetup}</h2>
              </div>
              <span className="flight-status-pill">
                <i className={mode === 'flying' ? 'is-live' : ''} />
                {mode === 'flying' ? messages.flightLive : mode === 'result' ? messages.flightComplete : messages.flightReady}
              </span>
            </div>

            <label className="mission-select-label" htmlFor="destination">
              {messages.destinationLabel}
            </label>
            <select
              id="destination"
              className="mission-select"
              value={assembly.destinationId}
              disabled={mode !== 'ready'}
              onChange={(event) => assembly.setDestinationId(event.target.value as 'moon' | 'mars')}
            >
              {MISSION_DESTINATIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.gravityMps2.toFixed(2)} m/s²
                </option>
              ))}
            </select>

            <div className="landing-block">
              <h3>{messages.landingSystems}</h3>
              <p>{destination.atmosphere === 'none' ? messages.moonAtmosphere : messages.marsAtmosphere}</p>
              {(
                [
                  ['parachute', messages.parachute],
                  ['heatShield', messages.heatShield],
                  ['poweredDescent', messages.poweredDescent],
                ] as const
              ).map(([key, label]) => (
                <label className="equipment-option" key={key}>
                  <input
                    type="checkbox"
                    checked={assembly[key]}
                    onChange={() => assembly.toggleEquipment(key)}
                  />
                  <span className="custom-check" aria-hidden="true">
                    ✓
                  </span>
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {/* Interactive SFS Throttle & Steering Controls */}
            <div className="sfs-controls-box">
              <div className="sfs-throttle-head">
                <span>🔥 GAZ KOLU (THROTTLE)</span>
                <b>%{throttle}</b>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={throttle}
                className="sfs-slider"
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setThrottle(val)
                  flightRef.current?.setThrottle(val / 100)
                }}
              />
              <div className="sfs-steer-row">
                <button
                  type="button"
                  className="sfs-steer-btn"
                  onMouseDown={() => flightRef.current?.setSteer(-1)}
                  onMouseUp={() => flightRef.current?.setSteer(0)}
                >
                  ◀ SOL (A)
                </button>
                <button
                  type="button"
                  className={`sfs-autopilot-btn ${autoPilot ? 'active' : ''}`}
                  onClick={() => setAutoPilot((a) => !a)}
                >
                  🤖 OTO-PİLOT: {autoPilot ? 'AÇIK' : 'MANUEL'}
                </button>
                <button
                  type="button"
                  className="sfs-steer-btn"
                  onMouseDown={() => flightRef.current?.setSteer(1)}
                  onMouseUp={() => flightRef.current?.setSteer(0)}
                >
                  SAĞ (D) ▶
                </button>
              </div>
            </div>

            {customCrashReason && (
              <div className="alert-box budget-alert">
                <span>!</span>
                <p>{customCrashReason}</p>
              </div>
            )}

            {mode === 'result' && evaluation && (
              <div className={`mission-verdict ${evaluation.success ? 'success' : 'failure'}`}>
                <b>{evaluation.success ? messages.missionSuccess : messages.missionNeedsWork}</b>
                {evaluation.failureReasons.length > 0 ? (
                  <ul>
                    {evaluation.failureReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{messages.resultSuccessText}</p>
                )}
              </div>
            )}
            {sceneError && (
              <p className="flight-error" role="alert">
                {sceneError}
              </p>
            )}

            {mode === 'ready' && (
              <button
                className="button button-primary launch-button"
                disabled={!sceneReady}
                onClick={startFlight}
              >
                <span>▲</span> {sceneReady ? messages.launchButton : messages.sceneLoading}
              </button>
            )}
            {mode === 'flying' && phase === 'launch' && (
              <button type="button" className="button button-secondary launch-button" onClick={abortOnPad}>
                🛑 Rampada İptal Et (%15 Yakıt Cezası)
              </button>
            )}
            {mode === 'result' && (
              <div className="result-actions">
                {evaluation?.success && (
                  <button className="button button-primary" onClick={onOpenColony}>
                    🏗️ Gezegende Koloni İnşa Et (Space Engineers)
                  </button>
                )}
                <button className="button button-secondary" onClick={restart}>
                  {messages.retryFlight}
                </button>
                <button className="button button-secondary" onClick={onBack}>
                  {messages.returnToAssembly}
                </button>
              </div>
            )}
          </section>

          <section className="flight-view-panel panel-card">
            <div className="panel-heading">
              <div>
                <span className="section-index">02</span>
                <h2>{phase === 'landing' ? `${destination.name} Yüzey İniş Kamerası` : messages.flightSceneTitle}</h2>
              </div>
              <span className="live-tag">
                <i className={mode === 'flying' ? 'flight-dot-live' : ''} />
                {phase === 'landing' ? 'SFS İNİŞ MODU' : 'PİKSEL SİM'}
              </span>
            </div>
            <Suspense fallback={<div className="phaser-loading">{messages.sceneLoading}</div>}>
              <PhaserFlightView
                ref={flightRef}
                configuration={configuration}
                options={{
                  destinationId: assembly.destinationId,
                  hasFins: assembly.hasFins,
                  parachute: assembly.parachute,
                  heatShield: assembly.heatShield,
                  poweredDescent: assembly.poweredDescent,
                  autoPilot,
                }}
                onReady={() => setSceneReady(true)}
                onUpdate={(st, ph, lSpeed) => {
                  setFlightState(st)
                  setPhase(ph)
                  setLandingSpeed(lSpeed)
                }}
                onComplete={finishMission}
              />
            </Suspense>
            <div className="flight-hud" aria-live="polite">
              <div>
                <span>{messages.altitudeLabel}</span>
                <b>{formatAltitude(flightState.altitudeM)}</b>
              </div>
              <div>
                <span>{phase === 'landing' ? 'İNİŞ HIZI (<8 m/s)' : messages.speedLabel}</span>
                <b style={{ color: phase === 'landing' && landingSpeed > 8.5 ? '#FB7185' : '#4ADE80' }}>
                  {phase === 'landing' ? `${landingSpeed.toFixed(1)} m/s` : `${flightState.velocityMps.toFixed(1)} m/s`}
                </b>
              </div>
              <div>
                <span>{messages.fuelLabel}</span>
                <b>{flightState.fuelRemainingKg.toFixed(0)} kg</b>
              </div>
              <div>
                <span>{messages.maxAltitudeLabel}</span>
                <b>{destination.name} ({destination.gravityMps2} m/s²)</b>
              </div>
            </div>
          </section>
        </div>
        <footer className="flight-footer">
          <span>SPACE MISSION DESIGN GAME · KAYNAK: NASA NSSDC FACT SHEET</span>
          <span>{messages.flightFooter}</span>
        </footer>
      </main>
    </div>
  )
}

export default FlightScreen
