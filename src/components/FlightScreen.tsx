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
  const [autoPilot, setAutoPilot] = useState(false)
  const [evaluation, setEvaluation] = useState<MissionEvaluation | null>(null)
  const [customCrashReason, setCustomCrashReason] = useState<string | null>(null)
  const [mode, setMode] = useState<FlightScreenMode>('ready')
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneError, setSceneError] = useState('')
  const flightRef = useRef<PhaserFlightHandle>(null)
  const destination = MISSION_DESTINATIONS.find((item) => item.id === assembly.destinationId)!

  const applyManualThrottle = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)))
    setThrottle(clamped)
    if (autoPilot && phase === 'landing') {
      setAutoPilot(false)
    }
    flightRef.current?.setThrottle(clamped / 100)
  }

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
      landedSafely ? { ...finalState, status: 'flying' } : finalState,
    )
    const finalSuccess = landedSafely && !crashReason && evalResult.success
    setCustomCrashReason(crashReason ?? null)
    setEvaluation({
      ...evalResult,
      success: finalSuccess,
      failureReasons: crashReason
        ? [crashReason, ...evalResult.failureReasons.filter((r) => r !== crashReason)]
        : evalResult.failureReasons,
    })

    const rocketCost = calculateRocketCost(configuration)
    if (finalSuccess) {
      const reward = assembly.destinationId === 'mars' ? 850 : 520
      assembly.rewardMission(reward, 40, assembly.payloadIds, assembly.destinationId)
    } else if (finalState.status === 'liftoff-failed') {
      assembly.spendFuelAbort(Math.round(rocketCost * 0.15))
    } else {
      assembly.spendFuelAbort(Math.round(rocketCost * 0.5))
    }
    setMode('result')
  }

  const startFlight = () => {
    setSceneError('')
    setEvaluation(null)
    setCustomCrashReason(null)
    setThrottle(100)
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
    setThrottle(100)
    setMode('ready')
  }

  const bindSteerEvents = (dir: -1 | 1) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      flightRef.current?.setSteer(dir)
      e.currentTarget.blur()
    },
    onPointerUp: () => flightRef.current?.setSteer(0),
    onPointerLeave: () => flightRef.current?.setSteer(0),
    onPointerCancel: () => flightRef.current?.setSteer(0),
  })

  return (
    <div className="flight-page">
      <header className="flight-topbar">
        <button className="back-button" onClick={onBack}>
          ← <span>{messages.backToAssembly}</span>
        </button>
        <a className="wordmark" href="#flight">
          <span className="wordmark-icon">✦</span>
          <span>SPACEFLIGHT SIMULATOR · UÇUŞ KONTROL</span>
        </a>
        <div className="topbar-right-pills">
          <button type="button" className="mini-nav-btn" onClick={onOpenColony}>
            🏗️ Gezegen Kolonisi
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
              onChange={(event) => {
                assembly.setDestinationId(event.target.value as 'moon' | 'mars')
                event.currentTarget.blur()
              }}
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
                    onChange={(e) => {
                      assembly.toggleEquipment(key)
                      e.currentTarget.blur()
                    }}
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
                <span>🔥 GAZ KOLU ([W/S] · [Z/X])</span>
                <b>%{throttle}</b>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={throttle}
                className="sfs-slider"
                onKeyDown={(e) => e.preventDefault()}
                onChange={(e) => {
                  applyManualThrottle(Number(e.target.value))
                  e.currentTarget.blur()
                }}
              />
              <div className="sfs-preset-row">
                <button
                  type="button"
                  className="sfs-preset-btn"
                  onClick={(e) => {
                    applyManualThrottle(0)
                    e.currentTarget.blur()
                  }}
                >
                  %0 KES [X]
                </button>
                <button
                  type="button"
                  className="sfs-preset-btn hover-preset"
                  onClick={(e) => {
                    applyManualThrottle(38)
                    e.currentTarget.blur()
                  }}
                >
                  %38 ASKI
                </button>
                <button
                  type="button"
                  className="sfs-preset-btn"
                  onClick={(e) => {
                    applyManualThrottle(70)
                    e.currentTarget.blur()
                  }}
                >
                  %70 FREN
                </button>
                <button
                  type="button"
                  className="sfs-preset-btn"
                  onClick={(e) => {
                    applyManualThrottle(100)
                    e.currentTarget.blur()
                  }}
                >
                  %100 [Z]
                </button>
              </div>
              <div className="sfs-steer-row">
                <button type="button" className="sfs-steer-btn" {...bindSteerEvents(-1)}>
                  ◀ SOL (A)
                </button>
                <button
                  type="button"
                  className={`sfs-autopilot-btn ${autoPilot ? 'active' : ''}`}
                  onClick={(e) => {
                    setAutoPilot((a) => !a)
                    e.currentTarget.blur()
                  }}
                >
                  🤖 {autoPilot ? 'OTO-İNİŞ: AÇIK' : 'MANUEL PİLOT'}
                </button>
                <button type="button" className="sfs-steer-btn" {...bindSteerEvents(1)}>
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
                onClick={(e) => {
                  startFlight()
                  e.currentTarget.blur()
                }}
              >
                <span>▲</span> {sceneReady ? messages.launchButton : messages.sceneLoading}
              </button>
            )}
            {mode === 'flying' && phase === 'launch' && (
              <button
                type="button"
                className="button button-secondary launch-button"
                onClick={(e) => {
                  abortOnPad()
                  e.currentTarget.blur()
                }}
              >
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
                <h2>
                  {phase === 'landing'
                    ? `${destination.name} SFS Yüzey İniş Kamerası`
                    : phase === 'space'
                      ? 'Kademe Ayrılması & Transfer Yörüngesi'
                      : messages.flightSceneTitle}
                </h2>
              </div>
              <span className="live-tag">
                <i className={mode === 'flying' ? 'flight-dot-live' : ''} />
                {phase === 'landing'
                  ? 'SFS İNİŞ (< 8.5 m/s)'
                  : phase === 'space'
                    ? 'YÖRÜNGE TRANSFERİ'
                    : '2D RİJİT FİZİK'}
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
                onUpdate={(st, ph, lSpeed, activeThrPct) => {
                  setFlightState(st)
                  setPhase(ph)
                  setLandingSpeed(lSpeed)
                  setThrottle(activeThrPct)
                }}
                onManualOverride={() => setAutoPilot(false)}
                onComplete={finishMission}
              />
            </Suspense>

            {/* Direct Under-Canvas SFS Flight Deck Bar */}
            <div className="sfs-deck-bar">
              <button type="button" className="sfs-deck-btn" {...bindSteerEvents(-1)}>
                ◀ SOLA YATIR [A]
              </button>
              <button
                type="button"
                className="sfs-deck-btn"
                onClick={(e) => {
                  applyManualThrottle(throttle - 12)
                  e.currentTarget.blur()
                }}
              >
                ▼ GAZ AZALT [S]
              </button>
              <button
                type="button"
                className="sfs-deck-btn hover-btn"
                onClick={(e) => {
                  applyManualThrottle(38)
                  e.currentTarget.blur()
                }}
              >
                🎯 ASKIDA KAL (%38)
              </button>
              <button
                type="button"
                className="sfs-deck-btn"
                onClick={(e) => {
                  applyManualThrottle(throttle + 12)
                  e.currentTarget.blur()
                }}
              >
                ▲ GAZ ARTIR [W]
              </button>
              <button type="button" className="sfs-deck-btn" {...bindSteerEvents(1)}>
                SAĞA YATIR [D] ▶
              </button>
            </div>

            <div className="flight-hud" aria-live="polite">
              <div>
                <span>{messages.altitudeLabel}</span>
                <b>{formatAltitude(flightState.altitudeM)}</b>
              </div>
              <div>
                <span>{phase === 'landing' ? 'İNİŞ HIZI (GÜVENLİ < 8.5)' : messages.speedLabel}</span>
                <b style={{ color: phase === 'landing' && landingSpeed > 8.5 ? '#FB7185' : '#4ADE80' }}>
                  {phase === 'landing' ? `${landingSpeed.toFixed(1)} m/s` : `${flightState.velocityMps.toFixed(1)} m/s`}
                </b>
              </div>
              <div>
                <span>{messages.fuelLabel}</span>
                <b>{flightState.fuelRemainingKg.toFixed(0)} kg</b>
              </div>
              <div>
                <span>HEDEF YERÇEKİMİ</span>
                <b>
                  {destination.name} ({destination.gravityMps2} m/s²)
                </b>
              </div>
            </div>

            {/* Fail-Forward NASA Learning Cards on Result */}
            {mode === 'result' && evaluation && (
              <div className="learning-cards-strip">
                {evaluation.learningCards.map((card) => (
                  <div key={card.title} className="learning-card-mini">
                    <strong>💡 {card.title}</strong>
                    <p>{card.explanation}</p>
                  </div>
                ))}
              </div>
            )}
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
