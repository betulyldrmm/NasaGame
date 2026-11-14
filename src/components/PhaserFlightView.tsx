import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Phaser from 'phaser'
import type { RocketConfiguration } from '../game/types'
import { FlightScene, type FlightSceneCallbacks } from '../flight/FlightScene'
import type { FlightState } from '../flight/physics'

export interface PhaserFlightHandle {
  launch: () => boolean
  resume: () => boolean
  reset: () => void
}

interface PhaserFlightViewProps {
  configuration: RocketConfiguration
  initialState?: FlightState | null
  onReady: () => void
  onUpdate: (state: FlightState) => void
  onComplete: (state: FlightState) => void
}

const PhaserFlightView = forwardRef<PhaserFlightHandle, PhaserFlightViewProps>(function PhaserFlightView(
  { configuration, initialState, onReady, onUpdate, onComplete }, ref,
) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<FlightScene | null>(null)
  const callbacksRef = useRef({ onReady, onUpdate, onComplete })
  callbacksRef.current = { onReady, onUpdate, onComplete }

  useImperativeHandle(ref, () => ({
    launch: () => sceneRef.current?.startFlight() ?? false,
    resume: () => sceneRef.current?.resumeFlight() ?? false,
    reset: () => sceneRef.current?.resetFlight(),
  }), [])

  useEffect(() => {
    if (!mountRef.current) return
    const scene = new FlightScene()
    let bootGame: Phaser.Game | null = null
    const configureScene = () => {
      if (!bootGame) return
      const activeScene = bootGame.scene.getScene('FlightScene') as FlightScene
      sceneRef.current = activeScene
      const callbacks: FlightSceneCallbacks = {
        onUpdate: (state) => callbacksRef.current.onUpdate(state),
        onComplete: (state) => callbacksRef.current.onComplete(state),
      }
      activeScene.configure(configuration, callbacks, initialState)
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
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      callbacks: { preBoot: (instance) => {
        bootGame = instance
        instance.events.once(Phaser.Core.Events.READY, configureScene)
      } },
      scene: [scene],
    })

    return () => {
      game.events.off(Phaser.Core.Events.READY, configureScene)
      sceneRef.current = null
      bootGame = null
      game.destroy(true)
    }
  }, [configuration, initialState])

  return <div className="phaser-flight-canvas" ref={mountRef} aria-label="Dikey roket uçuş simülasyonu" />
})

export default PhaserFlightView
