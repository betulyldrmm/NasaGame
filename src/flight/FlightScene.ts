import Phaser from 'phaser'
import type { RocketConfiguration } from '../game/types'
import { createFlightParameters, createFlightState, stepFlight, type FlightState } from './physics'

export interface FlightSceneCallbacks {
  onUpdate: (state: FlightState) => void
  onComplete: (state: FlightState) => void
}

/** Procedural 2D placeholder scene; generated shapes can be replaced with external sprites later. */
export class FlightScene extends Phaser.Scene {
  private configuration: RocketConfiguration | null = null
  private callbacks: FlightSceneCallbacks | null = null
  private flightState: FlightState | null = null
  private parameters: ReturnType<typeof createFlightParameters> | null = null
  private rocket: Phaser.GameObjects.Container | null = null
  private rocketGraphic: Phaser.GameObjects.Graphics | null = null
  private flameGraphic: Phaser.GameObjects.Graphics | null = null
  private stars: Phaser.GameObjects.Graphics | null = null
  private farHills: Phaser.GameObjects.Graphics | null = null
  private nearHills: Phaser.GameObjects.Graphics | null = null
  private cloudLayer: Phaser.GameObjects.Graphics | null = null
  private launchPad: Phaser.GameObjects.Graphics | null = null
  private particles: Phaser.GameObjects.Rectangle[] = []
  private fixedAccumulator = 0
  private hudAccumulator = 0
  private flightActive = false
  private baseRocketY = 0
  private engineHeight = 22
  private bodyHeight = 110
  private readonly fixedStepSeconds = 1 / 60
  private readonly timeScale = 4

  constructor() {
    super({ key: 'FlightScene' })
  }

  create() {
    this.drawBackground()
    this.drawLaunchPad()
    this.drawVehicle()
    this.createParticles()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this)
  }

  configure(configuration: RocketConfiguration, callbacks: FlightSceneCallbacks, restoredState?: FlightState | null) {
    this.configuration = configuration
    this.callbacks = callbacks
    this.parameters = createFlightParameters(configuration)
    this.flightState = restoredState ?? createFlightState(configuration)
    this.flightActive = false
    this.drawVehicle()
    this.positionVehicle()
    this.callbacks.onUpdate(this.flightState)
  }

  startFlight(): boolean {
    if (!this.configuration || !this.parameters || this.flightActive) return false
    this.flightState = createFlightState(this.configuration)
    this.fixedAccumulator = 0
    this.hudAccumulator = 1
    this.flightActive = true
    this.callbacks?.onUpdate(this.flightState)
    return true
  }

  resumeFlight(): boolean {
    if (!this.configuration || !this.parameters || !this.flightState || this.flightState.status === 'apogee' || this.flightState.status === 'impact' || this.flightState.status === 'liftoff-failed') return false
    this.flightActive = true
    this.callbacks?.onUpdate(this.flightState)
    return true
  }

  resetFlight() {
    this.flightActive = false
    this.fixedAccumulator = 0
    if (this.configuration) this.flightState = createFlightState(this.configuration)
    this.flameGraphic?.setVisible(false)
    this.particles.forEach((particle) => particle.setVisible(false))
    this.positionVehicle()
    if (this.flightState) this.callbacks?.onUpdate(this.flightState)
  }

  update(_time: number, deltaMs: number) {
    if (!this.flightActive || !this.flightState || !this.parameters) return
    this.fixedAccumulator += Math.min(deltaMs, 100) / 1_000 * this.timeScale
    while (this.fixedAccumulator >= this.fixedStepSeconds && this.flightActive) {
      this.flightState = stepFlight(this.flightState, this.parameters, this.fixedStepSeconds)
      this.fixedAccumulator -= this.fixedStepSeconds
      this.positionVehicle()
      this.updateFlame()
      if (this.flightState.status === 'liftoff-failed' || this.flightState.status === 'impact' || this.flightState.status === 'apogee') {
        this.flightActive = false
        this.callbacks?.onUpdate(this.flightState)
        this.callbacks?.onComplete(this.flightState)
        break
      }
      this.hudAccumulator += this.fixedStepSeconds
      if (this.hudAccumulator >= 0.1) {
        this.hudAccumulator = 0
        this.callbacks?.onUpdate(this.flightState)
      }
    }
  }

  private drawBackground() {
    const width = this.scale.width
    const height = this.scale.height
    this.stars?.destroy()
    this.farHills?.destroy()
    this.nearHills?.destroy()
    this.cloudLayer?.destroy()

    const sky = this.add.graphics().setDepth(-8)
    sky.fillGradientStyle(0x0a1223, 0x0a1223, 0x263e68, 0x263e68, 1)
    sky.fillRect(0, 0, width, height)
    this.stars = sky
    let seed = 34_567
    const random = () => { seed = (seed * 16_807) % 2_147_483_647; return seed / 2_147_483_647 }
    for (let index = 0; index < 70; index += 1) {
      const x = random() * width
      const y = random() * height * 0.75
      sky.fillStyle(0xd7e7ff, 0.35 + random() * 0.55)
      sky.fillRect(x, y, random() > 0.82 ? 2 : 1, random() > 0.82 ? 2 : 1)
    }

    this.farHills = this.add.graphics().setDepth(-6)
    this.farHills.fillStyle(0x35486c, 1)
    this.farHills.fillPoints([
      new Phaser.Math.Vector2(0, height * 0.47), new Phaser.Math.Vector2(width * 0.12, height * 0.35),
      new Phaser.Math.Vector2(width * 0.25, height * 0.46), new Phaser.Math.Vector2(width * 0.39, height * 0.31),
      new Phaser.Math.Vector2(width * 0.53, height * 0.45), new Phaser.Math.Vector2(width * 0.69, height * 0.34),
      new Phaser.Math.Vector2(width * 0.84, height * 0.47), new Phaser.Math.Vector2(width, height * 0.37),
      new Phaser.Math.Vector2(width, height), new Phaser.Math.Vector2(0, height),
    ], true)
    this.nearHills = this.add.graphics().setDepth(-4)
    this.nearHills.fillStyle(0x1b2b47, 1)
    this.nearHills.fillPoints([
      new Phaser.Math.Vector2(0, height * 0.67), new Phaser.Math.Vector2(width * 0.16, height * 0.57),
      new Phaser.Math.Vector2(width * 0.32, height * 0.69), new Phaser.Math.Vector2(width * 0.48, height * 0.58),
      new Phaser.Math.Vector2(width * 0.68, height * 0.7), new Phaser.Math.Vector2(width * 0.86, height * 0.59),
      new Phaser.Math.Vector2(width, height * 0.66), new Phaser.Math.Vector2(width, height), new Phaser.Math.Vector2(0, height),
    ], true)
    this.cloudLayer = this.add.graphics().setDepth(-3)
    this.cloudLayer.fillStyle(0x8197b5, 0.34)
    for (let index = 0; index < 9; index += 1) {
      const x = (index * 157) % Math.max(width, 1)
      const y = height * (0.34 + (index % 3) * 0.08)
      this.cloudLayer.fillRect(x, y, 34 + index % 3 * 12, 5)
      this.cloudLayer.fillRect(x + 8, y - 5, 19 + index % 4 * 3, 5)
    }
  }

  private drawLaunchPad() {
    this.launchPad?.destroy()
    const width = this.scale.width
    const height = this.scale.height
    this.launchPad = this.add.graphics().setDepth(1)
    this.launchPad.fillStyle(0x0e1727, 1).fillRect(0, height * 0.84, width, height * 0.16)
    this.launchPad.fillStyle(0x4ade80, 1).fillRect(0, height * 0.84, width, 4)
    this.launchPad.fillStyle(0x283d5c, 1).fillRect(width * 0.5 - 105, height * 0.78, 210, 9)
    this.launchPad.fillStyle(0x8da3bf, 1).fillRect(width * 0.5 - 3, height * 0.72, 6, height * 0.06)
    this.launchPad.fillStyle(0x233752, 1).fillRect(width * 0.5 - 63, height * 0.77, 12, height * 0.07)
    this.launchPad.fillStyle(0x233752, 1).fillRect(width * 0.5 + 51, height * 0.77, 12, height * 0.07)
    this.launchPad.lineStyle(2, 0x38d9e8, 0.65).lineBetween(width * 0.5 - 132, height * 0.84, width * 0.5 + 132, height * 0.84)
  }

  private drawVehicle() {
    this.rocket?.destroy(true)
    this.flameGraphic?.destroy()
    this.rocket = this.add.container(this.scale.width * 0.5, this.scale.height * 0.68).setDepth(3)
    this.rocketGraphic = this.add.graphics()
    this.flameGraphic = this.add.graphics().setDepth(2).setVisible(false)
    const graphics = this.rocketGraphic
    const config = this.configuration
    const slots = config?.body.cargoSlots ?? 2
    const bodyW = 36 + slots * 7
    const bodyH = 82 + slots * 15
    const engineW = config?.engine.id === 'engine-titan' ? 32 : config?.engine.id === 'engine-voyager' ? 25 : 19
    const engineH = config?.engine.id === 'engine-titan' ? 28 : config?.engine.id === 'engine-voyager' ? 24 : 19
    this.bodyHeight = bodyH
    this.engineHeight = engineH
    const top = -bodyH / 2

    graphics.fillStyle(0x667a99, 1).fillTriangle(-bodyW * 0.32, bodyH / 2 - 8, -bodyW * 0.76, bodyH / 2 + 22, -bodyW * 0.16, bodyH / 2 + 17)
    graphics.fillStyle(0x667a99, 1).fillTriangle(bodyW * 0.32, bodyH / 2 - 8, bodyW * 0.76, bodyH / 2 + 22, bodyW * 0.16, bodyH / 2 + 17)
    graphics.fillStyle(0xc7d6e8, 1).fillRect(-bodyW / 2, top, bodyW, bodyH)
    graphics.fillStyle(0x8197b5, 1).fillRect(-bodyW / 2, top + 6, bodyW, 6)
    graphics.fillStyle(0xffad57, 1).fillRect(-bodyW / 2, top + 12, 5, bodyH - 22)
    graphics.fillRect(bodyW / 2 - 5, top + 12, 5, bodyH - 22)
    graphics.fillStyle(0x172a49, 1).fillRect(-bodyW * 0.28, top + 25, bodyW * 0.56, 25)
    graphics.fillStyle(0x38d9e8, 1).fillRect(-bodyW * 0.18, top + 30, bodyW * 0.36, 15)
    graphics.fillStyle(0xffad57, 1).fillTriangle(0, top - 30, bodyW * 0.42, top + 2, -bodyW * 0.42, top + 2)
    graphics.fillStyle(0xf3f7ff, 1).fillRect(-3, top - 9, 6, 10)

    const bodyColors: Record<string, number> = { 'solar-panel': 0x38d9e8, rover: 0xffad57, greenhouse: 0x4ade80, habitat: 0xc4a7ff }
    const payloads = config?.payloads.slice(0, slots) ?? []
    payloads.forEach((payload, index) => {
      const side = index % 2 === 0 ? -1 : 1
      const cargoY = top + 59 + Math.floor(index / 2) * 29 + (index % 2) * 10
      graphics.fillStyle(0x1b2b47, 1).fillRect(side < 0 ? -bodyW / 2 - 37 : bodyW / 2 + 4, cargoY, 33, 22)
      graphics.fillStyle(bodyColors[payload.id] ?? 0x38d9e8, 1).fillRect(side < 0 ? -bodyW / 2 - 31 : bodyW / 2 + 10, cargoY + 5, 11, 12)
      graphics.fillStyle(0xf3f7ff, 0.8).fillRect(side < 0 ? -bodyW / 2 - 15 : bodyW / 2 + 24, cargoY + 8, 7, 4)
    })

    const engineColor = config?.engine.id === 'engine-titan' ? 0xffad57 : config?.engine.id === 'engine-voyager' ? 0x8298b8 : 0x38d9e8
    graphics.fillStyle(engineColor, 1).fillTriangle(-engineW / 2, bodyH / 2 - 1, engineW / 2, bodyH / 2 - 1, 0, bodyH / 2 + engineH)
    graphics.fillStyle(0x20314b, 1).fillRect(-engineW * 0.24, bodyH / 2 + 2, engineW * 0.48, Math.max(5, engineH * 0.35))
    this.rocket.add(graphics)
    this.baseRocketY = this.scale.height * 0.68
  }

  private createParticles() {
    this.particles.forEach((particle) => particle.destroy())
    this.particles = Array.from({ length: 12 }, (_, index) => this.add.rectangle(0, 0, index % 3 === 0 ? 4 : 3, index % 2 === 0 ? 5 : 3,
      index % 2 === 0 ? 0xffad57 : 0x38d9e8, 0.65).setDepth(2).setVisible(false))
  }

  private positionVehicle() {
    if (!this.rocket || !this.flightState) return
    const altitudeOffset = Math.min(this.flightState.altitudeM * 0.075, this.scale.height * 0.44)
    this.rocket.setPosition(this.scale.width * 0.5, this.baseRocketY - altitudeOffset)
    const parallax = Math.min(this.flightState.altitudeM, 60_000)
    this.farHills?.setY((parallax * 0.002) % 48)
    this.nearHills?.setY((parallax * 0.006) % 70)
    this.cloudLayer?.setY((parallax * 0.012) % 90)
    this.cloudLayer?.setVisible(this.flightState.altitudeM < 28_000)
    this.launchPad?.setY(Math.min(parallax * 0.018, this.scale.height * 0.5))
  }

  private updateFlame() {
    if (!this.flightState || !this.rocket || !this.flameGraphic) return
    const burning = this.flightState.fuelRemainingKg > 0
    this.flameGraphic.setVisible(burning)
    this.flameGraphic.clear()
    if (burning) {
      const x = this.rocket.x
      const y = this.rocket.y + this.bodyHeight / 2 + this.engineHeight + 3
      const flicker = Math.sin(this.flightState.elapsedTimeS * 39) * 4
      this.flameGraphic.fillStyle(0x38d9e8, 0.75).fillTriangle(x - 9, y, x + 9, y, x, y + 23 + flicker)
      this.flameGraphic.fillStyle(0xffad57, 0.9).fillTriangle(x - 5, y + 1, x + 5, y + 1, x, y + 16 + flicker * 0.5)
      this.particles.forEach((particle, index) => {
        const phase = this.flightState!.elapsedTimeS * 5 + index * 1.7
        particle.setPosition(x + Math.sin(phase) * (7 + index % 4 * 2), y + 10 + ((phase * 11) % 27))
        particle.setAlpha(0.35 + (Math.sin(phase) + 1) * 0.3).setVisible(index % 3 !== Math.floor(phase) % 3)
      })
    } else {
      this.particles.forEach((particle) => particle.setVisible(false))
    }
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    this.drawBackground()
    this.drawLaunchPad()
    this.drawVehicle()
    this.baseRocketY = gameSize.height * 0.68
    this.positionVehicle()
  }

  private handleShutdown() {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this)
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this)
    this.particles.forEach((particle) => particle.destroy())
    this.particles = []
    this.callbacks = null
  }
}
