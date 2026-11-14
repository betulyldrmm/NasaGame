import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Phaser from 'phaser'
import type { RocketConfiguration } from '../game/types'
import { FlightScene, type FlightSceneCallbacks, type FlightSceneOptions } from '../flight/FlightScene'
import type { FlightState } from '../flight/physics'

export interface PhaserFlightHandle {
  launch: () => boolean
  reset: () => void
  setThrottle: (val: number) => void
  setSteer: (dir: -1 | 0 | 1) => void
  setOptions: (opts: Partial<FlightSceneOptions>) => void
}

interface PhaserFlightViewProps {
  configuration: RocketConfiguration
  options: FlightSceneOptions
  onReady: () => void
  onUpdate: (
    state: FlightState,
    phase: 'launch' | 'space' | 'landing',
    landingSpeedMps: number,
    activeThrottlePct: number,
  ) => void
  onManualOverride?: () => void
  onComplete: (state: FlightState, landedSafely: boolean, crashReason?: string) => void
}

const PhaserFlightView = forwardRef<PhaserFlightHandle, PhaserFlightViewProps>(function PhaserFlightView(
  { configuration, options, onReady, onUpdate, onManualOverride, onComplete },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<FlightScene | null>(null)
  const callbacksRef = useRef({ onReady, onUpdate, onManualOverride, onComplete })
  callbacksRef.current = { onReady, onUpdate, onManualOverride, onComplete }

  useImperativeHandle(
    ref,
    () => ({
      launch: () => sceneRef.current?.startFlight() ?? false,
      reset: () => sceneRef.current?.resetFlight(),
      setThrottle: (val) => sceneRef.current?.setThrottle(val),
      setSteer: (dir) => sceneRef.current?.setSteer(dir),
      setOptions: (opts) => sceneRef.current?.setOptions(opts),
    }),
    [],
  )

  useEffect(() => {
    sceneRef.current?.setOptions(options)
  }, [
    options.destinationId,
    options.hasFins,
    options.parachute,
    options.heatShield,
    options.poweredDescent,
    options.autoPilot,
  ])

  useEffect(() => {
    if (!mountRef.current) return
    const scene = new FlightScene()
    let bootGame: Phaser.Game | null = null
    const configureScene = () => {
      if (!bootGame) return
      const activeScene = bootGame.scene.getScene('FlightScene') as FlightScene
      sceneRef.current = activeScene
      const callbacks: FlightSceneCallbacks = {
        onUpdate: (state, phase, landingSpeed, activeThrottlePct) =>
          callbacksRef.current.onUpdate(state, phase, landingSpeed, activeThrottlePct),
        onManualOverride: () => callbacksRef.current.onManualOverride?.(),
        onComplete: (state, landedSafely, crashReason) =>
          callbacksRef.current.onComplete(state, landedSafely, crashReason),
      }
      activeScene.configure(configuration, callbacks, options)
      callbacksRef.current.onReady()
    }
    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: mountRef.current,
      width: 960,
      height: 540,
      backgroundColor: '#080F20',
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      render: { roundPixels: true },
      physics: {
        default: 'matter',
        matter: {
          gravity: { x: 0, y: 0.45 },
          enableSleeping: false,
        },
      },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      callbacks: {
        preBoot: (instance) => {
          bootGame = instance
          instance.events.once(Phaser.Core.Events.READY, configureScene)
        },
      },
      scene: [scene],
    })

    return () => {
      game.events.off(Phaser.Core.Events.READY, configureScene)
      sceneRef.current = null
      bootGame = null
      game.destroy(true)
    }
  }, [configuration])

  return <div className="phaser-flight-canvas" ref={mountRef} aria-label="Dikey roket uçuş ve iniş simülasyonu" />
})

export default PhaserFlightView
