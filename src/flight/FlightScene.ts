import Phaser from 'phaser'
import type { RocketConfiguration } from '../game/types'
import { createFlightParameters, createFlightState, stepFlight, type FlightState } from './physics'

export interface FlightSceneCallbacks {
  onUpdate: (state: FlightState, phase: 'launch' | 'space' | 'landing', landingSpeedMps: number) => void
  onComplete: (state: FlightState, landedSafely: boolean, crashReason?: string) => void
}

export interface FlightSceneOptions {
  destinationId: 'moon' | 'mars'
  hasFins: boolean
  parachute: boolean
  heatShield: boolean
  poweredDescent: boolean
  autoPilot: boolean
}

/**
 * Pixel-Art Phaser 3 Flight & Spaceflight Simulator (SFS) Landing Scene.
 * Combines `origin/feature/flight`'s pixel-art launchpad with interactive SFS planetary landing!
 */
export class FlightScene extends Phaser.Scene {
  private configuration: RocketConfiguration | null = null
  private callbacks: FlightSceneCallbacks | null = null
  private options: FlightSceneOptions = {
    destinationId: 'moon',
    hasFins: true,
    parachute: false,
    heatShield: false,
    poweredDescent: true,
    autoPilot: true,
  }
  private flightState: FlightState | null = null
  private parameters: ReturnType<typeof createFlightParameters> | null = null
  private rocket: Phaser.GameObjects.Container | null = null
  private rocketGraphic: Phaser.GameObjects.Graphics | null = null
  private flameGraphic: Phaser.GameObjects.Graphics | null = null
  private chuteGraphic: Phaser.GameObjects.Graphics | null = null
  private shieldGraphic: Phaser.GameObjects.Graphics | null = null
  private stars: Phaser.GameObjects.Graphics | null = null
  private farHills: Phaser.GameObjects.Graphics | null = null
  private nearHills: Phaser.GameObjects.Graphics | null = null
  private cloudLayer: Phaser.GameObjects.Graphics | null = null
  private launchPad: Phaser.GameObjects.Graphics | null = null
  private planetSurface: Phaser.GameObjects.Graphics | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private particles: Phaser.GameObjects.Rectangle[] = []
  private fixedAccumulator = 0
  private hudAccumulator = 0
  private flightActive = false
  private phase: 'launch' | 'space' | 'landing' = 'launch'
  private baseRocketY = 0
  private engineHeight = 22
  private bodyHeight = 110
  private throttle = 1.0
  private steerInput = 0
  private landingY = 80
  private landingX = 480
  private landingVy = 18
  private landingVx = 0
  private readonly fixedStepSeconds = 1 / 60
  private readonly timeScale = 4

  constructor() {
    super({ key: 'FlightScene' })
  }

  create() {
    this.drawBackground()
    this.drawLaunchPad()
    this.drawPlanetSurface()
    this.drawVehicle()
    this.createParticles()

    this.statusText = this.add
      .text(this.scale.width * 0.5, 36, '', {
        fontFamily: '"DM Mono", monospace',
        fontSize: '13px',
        color: '#38D9E8',
        backgroundColor: '#080F20CC',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(10)

    this.input.keyboard?.on('keydown-A', () => {
      this.steerInput = -1
    })
    this.input.keyboard?.on('keydown-LEFT', () => {
      this.steerInput = -1
    })
    this.input.keyboard?.on('keydown-D', () => {
      this.steerInput = 1
    })
    this.input.keyboard?.on('keydown-RIGHT', () => {
      this.steerInput = 1
    })
    this.input.keyboard?.on('keyup', () => {
      this.steerInput = 0
    })

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this)
  }

  configure(configuration: RocketConfiguration, callbacks: FlightSceneCallbacks, options?: Partial<FlightSceneOptions>) {
    this.configuration = configuration
    this.callbacks = callbacks
    if (options) this.options = { ...this.options, ...options }
    this.parameters = createFlightParameters(configuration)
    this.flightState = createFlightState(configuration)
    this.phase = 'launch'
    this.drawVehicle()
    this.positionVehicle()
    this.callbacks.onUpdate(this.flightState, this.phase, 0)
  }

  setOptions(options: Partial<FlightSceneOptions>) {
    this.options = { ...this.options, ...options }
  }

  setThrottle(value: number) {
    this.throttle = Math.max(0, Math.min(1, value))
  }

  setSteer(dir: -1 | 0 | 1) {
    this.steerInput = dir
  }

  startFlight(): boolean {
    if (!this.configuration || !this.parameters || this.flightActive) return false
    this.flightState = createFlightState(this.configuration)
    this.fixedAccumulator = 0
    this.hudAccumulator = 1
    this.flightActive = true
    this.phase = 'launch'
    this.landingX = this.scale.width * 0.5 + (Math.random() - 0.5) * 90
    this.landingY = 70
    this.landingVy = 22
    this.landingVx = 0
    this.planetSurface?.setVisible(false)
    this.launchPad?.setVisible(true)
    this.farHills?.setVisible(true)
    this.nearHills?.setVisible(true)
    if (this.rocket) this.rocket.rotation = 0
    this.statusText?.setText('AŞAMA 1: DÜNYA KALKIŞI')
    this.callbacks?.onUpdate(this.flightState, this.phase, 0)
    return true
  }

  resetFlight() {
    this.flightActive = false
    this.fixedAccumulator = 0
    this.phase = 'launch'
    if (this.configuration) this.flightState = createFlightState(this.configuration)
    this.flameGraphic?.setVisible(false)
    this.chuteGraphic?.setVisible(false)
    this.shieldGraphic?.setVisible(false)
    this.planetSurface?.setVisible(false)
    this.launchPad?.setVisible(true)
    this.farHills?.setVisible(true)
    this.nearHills?.setVisible(true)
    this.particles.forEach((particle) => particle.setVisible(false))
    if (this.rocket) this.rocket.rotation = 0
    this.statusText?.setText('')
    this.positionVehicle()
    if (this.flightState) this.callbacks?.onUpdate(this.flightState, this.phase, 0)
  }

  update(_time: number, deltaMs: number) {
    if (!this.flightActive || !this.flightState || !this.parameters) return

    if (this.phase === 'launch') {
      this.fixedAccumulator += (Math.min(deltaMs, 100) / 1_000) * this.timeScale
      while (this.fixedAccumulator >= this.fixedStepSeconds && this.flightActive) {
        this.flightState = stepFlight(this.flightState, this.parameters, this.fixedStepSeconds)
        this.fixedAccumulator -= this.fixedStepSeconds

        // Check aerodynamic spin if fins are disabled!
        if (!this.options.hasFins && this.flightState.elapsedTimeS > 2.2) {
          if (this.rocket) this.rocket.rotation += 0.25
          this.statusText?.setText('⚠ KANATÇIK YOK (CoP ÖNDE) — ROKET TAKLA ATIYOR!')
          if (this.flightState.elapsedTimeS > 3.6) {
            this.flightActive = false
            this.spawnExplosion(this.rocket?.x ?? this.scale.width * 0.5, this.rocket?.y ?? 240)
            this.callbacks?.onComplete(
              this.flightState,
              false,
              'Kanatçık takılmadığı için Basınç Merkezi (CoP) Ağırlık Merkezinin (CoM) önüne geçti ve roket atmosferde takla atarak infilak etti!',
            )
            return
          }
        }

        this.positionVehicle()
        this.updateFlame(this.throttle > 0.1 && this.flightState.fuelRemainingKg > 0)

        if (this.flightState.status === 'liftoff-failed') {
          this.flightActive = false
          this.statusText?.setText('⚠ TWR < 1.0 — ROKET RAMPADAN KALKAMADI!')
          this.callbacks?.onUpdate(this.flightState, this.phase, 0)
          this.callbacks?.onComplete(this.flightState, false)
          return
        }

        // Transition to Spaceflight Simulator Planetary Landing once altitude reaches 2,800m+
        if (this.flightState.altitudeM >= 2_800) {
          this.phase = 'landing'
          this.launchPad?.setVisible(false)
          this.farHills?.setVisible(false)
          this.nearHills?.setVisible(false)
          this.cloudLayer?.setVisible(false)
          this.drawPlanetSurface()
          this.planetSurface?.setVisible(true)
          const targetName = this.options.destinationId === 'moon' ? 'AY (VAKUM)' : 'MARS (İNCE ATMOSFER)'
          this.statusText?.setText(`AŞAMA 2: ${targetName} YÜZEY İNİŞİ — HIZI < 8 m/s DÜŞÜR!`)
          break
        }

        if (this.flightState.status === 'impact' || this.flightState.status === 'apogee') {
          this.flightActive = false
          this.callbacks?.onUpdate(this.flightState, this.phase, 0)
          this.callbacks?.onComplete(this.flightState, false)
          break
        }

        this.hudAccumulator += this.fixedStepSeconds
        if (this.hudAccumulator >= 0.1) {
          this.hudAccumulator = 0
          this.callbacks?.onUpdate(this.flightState, this.phase, 0)
        }
      }
    } else if (this.phase === 'landing') {
      // Interactive Spaceflight Simulator (SFS) Planetary Landing Loop
      const dt = Math.min(deltaMs, 50) / 1000
      const planetG = this.options.destinationId === 'moon' ? 1.62 : 3.71
      const padX = this.scale.width * 0.5
      const groundY = this.scale.height * 0.82 - this.bodyHeight * 0.5

      // Auto-pilot assist if enabled
      let activeThrottle = this.throttle
      let activeSteer = this.steerInput
      if (this.options.autoPilot) {
        if (Math.abs(this.landingX - padX) > 6) {
          activeSteer = this.landingX > padX ? -1 : 1
        } else {
          activeSteer = 0
        }
        activeThrottle = this.landingVy > 5.2 ? 0.95 : 0.2
      }

      // Parachute effect
      const chuteOpen = this.options.parachute && this.landingY < groundY - 20
      this.chuteGraphic?.setVisible(chuteOpen)
      if (chuteOpen) {
        this.chuteGraphic?.setPosition(this.landingX, this.landingY - this.bodyHeight * 0.65)
        if (this.options.destinationId === 'moon') {
          this.statusText?.setText('⚠ AY’DA ATMOSFER YOK — PARAŞÜT ÇALIŞMIYOR!')
        }
      }

      // Heat shield visual on Mars entry
      const showShield = this.options.destinationId === 'mars' && this.landingY < this.scale.height * 0.45
      this.shieldGraphic?.setVisible(showShield)
      if (showShield) {
        this.shieldGraphic?.setPosition(this.landingX, this.landingY + this.bodyHeight * 0.52)
      }

      const canThrust = this.options.poweredDescent && this.flightState.fuelRemainingKg > 0 && activeThrottle > 0.05
      const retroAccel = canThrust ? activeThrottle * (planetG * 3.1) : 0
      const marsChuteDrag = this.options.destinationId === 'mars' && this.options.parachute ? 1.6 : 0

      this.landingVy = Math.max(1.5, this.landingVy + (planetG * 2.2 - retroAccel - marsChuteDrag) * dt)
      this.landingVx = this.landingVx * 0.92 + activeSteer * 48 * dt
      this.landingX = Math.max(80, Math.min(this.scale.width - 80, this.landingX + this.landingVx * dt))
      this.landingY += this.landingVy * 3.2 * dt

      if (canThrust) {
        this.flightState.fuelRemainingKg = Math.max(0, this.flightState.fuelRemainingKg - dt * 12)
      }

      if (this.rocket) {
        this.rocket.setPosition(this.landingX, this.landingY)
        this.rocket.rotation = activeSteer * 0.14
      }
      this.updateFlame(canThrust)

      const remainingAlt = Math.max(0, Math.round((groundY - this.landingY) * 4))
      this.flightState.altitudeM = remainingAlt
      this.flightState.velocityMps = -this.landingVy
      this.callbacks?.onUpdate({ ...this.flightState }, 'landing', this.landingVy)

      // Check Touchdown!
      if (this.landingY >= groundY) {
        this.flightActive = false
        this.flameGraphic?.setVisible(false)
        this.chuteGraphic?.setVisible(false)
        this.shieldGraphic?.setVisible(false)
        if (this.rocket) {
          this.rocket.setPosition(this.landingX, groundY)
          this.rocket.rotation = 0
        }

        const marsMissingShield = this.options.destinationId === 'mars' && !this.options.heatShield
        const noRetro = !this.options.poweredDescent
        const tooFast = this.landingVy > 9.5

        if (marsMissingShield || noRetro || tooFast) {
          this.spawnExplosion(this.landingX, groundY)
          this.statusText?.setText(`💥 SERT ÇARPMA (${this.landingVy.toFixed(1)} m/s)!`)
          this.callbacks?.onComplete(this.flightState, false)
        } else {
          this.statusText?.setText(`✓ MÜKEMMEL İNİŞ (${this.landingVy.toFixed(1)} m/s)! KOLONİ HAZIR!`)
          this.callbacks?.onComplete(this.flightState, true)
        }
      }
    }
  }

  private spawnExplosion(x: number, y: number) {
    this.particles.forEach((p, idx) => {
      const angle = (idx / this.particles.length) * Math.PI * 2
      p.setPosition(x + Math.cos(angle) * 18, y + Math.sin(angle) * 18)
      p.setFillStyle(idx % 2 === 0 ? 0xfb7185 : 0xffad57, 1)
      p.setScale(2.5)
      p.setVisible(true)
    })
  }

  private drawBackground() {
    const width = this.scale.width
    const height = this.scale.height
    this.stars?.destroy()
    this.farHills?.destroy()
    this.nearHills?.destroy()
    this.cloudLayer?.destroy()

    const sky = this.add.graphics().setDepth(-8)
    sky.fillGradientStyle(0x0a1223, 0x0a1223, 0x182b49, 0x182b49, 1)
    sky.fillRect(0, 0, width, height)
    this.stars = sky
    let seed = 34_567
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647
      return seed / 2_147_483_647
    }
    for (let index = 0; index < 75; index += 1) {
      const x = random() * width
      const y = random() * height * 0.78
      sky.fillStyle(index % 5 === 0 ? 0x38d9e8 : 0xd7e7ff, 0.4 + random() * 0.55)
      sky.fillRect(Math.round(x), Math.round(y), random() > 0.8 ? 3 : 2, random() > 0.8 ? 3 : 2)
    }

    this.farHills = this.add.graphics().setDepth(-6)
    this.farHills.fillStyle(0x35486c, 1)
    this.farHills.fillPoints(
      [
        new Phaser.Math.Vector2(0, height * 0.47),
        new Phaser.Math.Vector2(width * 0.12, height * 0.35),
        new Phaser.Math.Vector2(width * 0.25, height * 0.46),
        new Phaser.Math.Vector2(width * 0.39, height * 0.31),
        new Phaser.Math.Vector2(width * 0.53, height * 0.45),
        new Phaser.Math.Vector2(width * 0.69, height * 0.34),
        new Phaser.Math.Vector2(width * 0.84, height * 0.47),
        new Phaser.Math.Vector2(width, height * 0.37),
        new Phaser.Math.Vector2(width, height),
        new Phaser.Math.Vector2(0, height),
      ],
      true,
    )
    this.nearHills = this.add.graphics().setDepth(-4)
    this.nearHills.fillStyle(0x1b2b47, 1)
    this.nearHills.fillPoints(
      [
        new Phaser.Math.Vector2(0, height * 0.67),
        new Phaser.Math.Vector2(width * 0.16, height * 0.57),
        new Phaser.Math.Vector2(width * 0.32, height * 0.69),
        new Phaser.Math.Vector2(width * 0.48, height * 0.58),
        new Phaser.Math.Vector2(width * 0.68, height * 0.7),
        new Phaser.Math.Vector2(width * 0.86, height * 0.59),
        new Phaser.Math.Vector2(width, height * 0.66),
        new Phaser.Math.Vector2(width, height),
        new Phaser.Math.Vector2(0, height),
      ],
      true,
    )
    this.cloudLayer = this.add.graphics().setDepth(-3)
    this.cloudLayer.fillStyle(0x8197b5, 0.34)
    for (let index = 0; index < 9; index += 1) {
      const x = (index * 157) % Math.max(width, 1)
      const y = height * (0.34 + (index % 3) * 0.08)
      this.cloudLayer.fillRect(x, y, 34 + (index % 3) * 12, 5)
      this.cloudLayer.fillRect(x + 8, y - 5, 19 + (index % 4) * 3, 5)
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

  private drawPlanetSurface() {
    this.planetSurface?.destroy()
    const width = this.scale.width
    const height = this.scale.height
    const isMars = this.options.destinationId === 'mars'
    this.planetSurface = this.add.graphics().setDepth(1).setVisible(this.phase === 'landing')

    // Pixel terrain & craters
    this.planetSurface
      .fillStyle(isMars ? 0x9a3412 : 0x475569, 1)
      .fillRect(0, height * 0.82, width, height * 0.18)
    this.planetSurface
      .fillStyle(isMars ? 0x7c2d12 : 0x334155, 1)
      .fillRect(0, height * 0.88, width, height * 0.12)

    // Pixel craters
    this.planetSurface.fillStyle(isMars ? 0x431407 : 0x1e293b, 1)
    this.planetSurface.fillRect(width * 0.18, height * 0.84, 56, 12)
    this.planetSurface.fillRect(width * 0.74, height * 0.85, 68, 14)

    // Glowing SFS Target Landing Pad in center
    this.planetSurface.fillStyle(0x38d9e8, 1).fillRect(width * 0.5 - 64, height * 0.82 - 4, 128, 6)
    this.planetSurface.fillStyle(0x4ade80, 1).fillRect(width * 0.5 - 44, height * 0.82 - 6, 88, 4)
  }

  private drawVehicle() {
    this.rocket?.destroy(true)
    this.flameGraphic?.destroy()
    this.chuteGraphic?.destroy()
    this.shieldGraphic?.destroy()
    this.rocket = this.add.container(this.scale.width * 0.5, this.scale.height * 0.68).setDepth(3)
    this.rocketGraphic = this.add.graphics()
    this.flameGraphic = this.add.graphics().setDepth(2).setVisible(false)
    this.chuteGraphic = this.add.graphics().setDepth(2).setVisible(false)
    this.shieldGraphic = this.add.graphics().setDepth(4).setVisible(false)

    // Draw pixel parachute graphic
    this.chuteGraphic.fillStyle(0xfb7185, 1).fillRect(-22, -26, 44, 12)
    this.chuteGraphic.fillStyle(0xffad57, 1).fillRect(-16, -32, 32, 6)
    this.chuteGraphic.lineStyle(2, 0xf3f7ff, 0.9)
    this.chuteGraphic.lineBetween(-18, -14, -6, 0)
    this.chuteGraphic.lineBetween(18, -14, 6, 0)

    // Draw pixel heat shield graphic
    this.shieldGraphic.fillStyle(0xffad57, 1).fillRect(-28, 0, 56, 6)
    this.shieldGraphic.fillStyle(0xfb7185, 0.85).fillRect(-34, 6, 68, 5)

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

    if (this.options.hasFins) {
      graphics
        .fillStyle(0xe45b69, 1)
        .fillTriangle(-bodyW * 0.32, bodyH / 2 - 8, -bodyW * 0.76, bodyH / 2 + 22, -bodyW * 0.16, bodyH / 2 + 17)
      graphics
        .fillStyle(0xe45b69, 1)
        .fillTriangle(bodyW * 0.32, bodyH / 2 - 8, bodyW * 0.76, bodyH / 2 + 22, bodyW * 0.16, bodyH / 2 + 17)
    }

    graphics.fillStyle(0xc7d6e8, 1).fillRect(-bodyW / 2, top, bodyW, bodyH)
    graphics.fillStyle(0x8197b5, 1).fillRect(-bodyW / 2, top + 6, bodyW, 6)
    graphics.fillStyle(0xffad57, 1).fillRect(-bodyW / 2, top + 12, 5, bodyH - 22)
    graphics.fillRect(bodyW / 2 - 5, top + 12, 5, bodyH - 22)
    graphics.fillStyle(0x172a49, 1).fillRect(-bodyW * 0.28, top + 25, bodyW * 0.56, 25)
    graphics.fillStyle(0x38d9e8, 1).fillRect(-bodyW * 0.18, top + 30, bodyW * 0.36, 15)
    graphics.fillStyle(0xffad57, 1).fillTriangle(0, top - 30, bodyW * 0.42, top + 2, -bodyW * 0.42, top + 2)
    graphics.fillStyle(0xf3f7ff, 1).fillRect(-3, top - 9, 6, 10)

    const bodyColors: Record<string, number> = {
      'solar-panel': 0x38d9e8,
      rover: 0xffad57,
      greenhouse: 0x4ade80,
      habitat: 0xc4a7ff,
    }
    const payloads = config?.payloads.slice(0, slots) ?? []
    payloads.forEach((payload, index) => {
      const side = index % 2 === 0 ? -1 : 1
      const cargoY = top + 59 + Math.floor(index / 2) * 29 + (index % 2) * 10
      graphics.fillStyle(0x1b2b47, 1).fillRect(side < 0 ? -bodyW / 2 - 37 : bodyW / 2 + 4, cargoY, 33, 22)
      graphics
        .fillStyle(bodyColors[payload.id] ?? 0x38d9e8, 1)
        .fillRect(side < 0 ? -bodyW / 2 - 31 : bodyW / 2 + 10, cargoY + 5, 11, 12)
      graphics.fillStyle(0xf3f7ff, 0.8).fillRect(side < 0 ? -bodyW / 2 - 15 : bodyW / 2 + 24, cargoY + 8, 7, 4)
    })

    const engineColor =
      config?.engine.id === 'engine-titan' ? 0xffad57 : config?.engine.id === 'engine-voyager' ? 0x8298b8 : 0x38d9e8
    graphics
      .fillStyle(engineColor, 1)
      .fillTriangle(-engineW / 2, bodyH / 2 - 1, engineW / 2, bodyH / 2 - 1, 0, bodyH / 2 + engineH)
    graphics.fillStyle(0x20314b, 1).fillRect(-engineW * 0.24, bodyH / 2 + 2, engineW * 0.48, Math.max(5, engineH * 0.35))
    this.rocket.add(graphics)
    this.baseRocketY = this.scale.height * 0.68
  }

  private createParticles() {
    this.particles.forEach((particle) => particle.destroy())
    this.particles = Array.from({ length: 14 }, (_, index) =>
      this.add
        .rectangle(
          0,
          0,
          index % 3 === 0 ? 5 : 4,
          index % 2 === 0 ? 6 : 4,
          index % 2 === 0 ? 0xffad57 : 0x38d9e8,
          0.75,
        )
        .setDepth(2)
        .setVisible(false),
    )
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

  private updateFlame(active = true) {
    if (!this.flameGraphic || !this.rocket || !this.flightState) return
    if (!active) {
      this.flameGraphic.setVisible(false)
      this.particles.forEach((particle) => particle.setVisible(false))
      return
    }
    const flameTopY = this.rocket.y + this.bodyHeight / 2 + this.engineHeight - 2
    const flicker = 16 + Math.sin(this.flightState.elapsedTimeS * 38) * 6
    this.flameGraphic.clear().setVisible(true)
    this.flameGraphic
      .fillStyle(0xffad57, 0.92)
      .fillTriangle(this.rocket.x - 10, flameTopY, this.rocket.x + 10, flameTopY, this.rocket.x, flameTopY + flicker + 9)
    this.flameGraphic
      .fillStyle(0x38d9e8, 0.85)
      .fillTriangle(this.rocket.x - 5, flameTopY, this.rocket.x + 5, flameTopY, this.rocket.x, flameTopY + flicker)
    this.particles.forEach((particle, index) => {
      const phase = (this.flightState!.elapsedTimeS * 24 + index * 2.3) % 10
      particle.setPosition(this.rocket!.x + ((index % 5) - 2) * 5, flameTopY + phase * 3.1).setVisible(true)
    })
  }

  private handleResize() {
    this.drawBackground()
    this.drawLaunchPad()
    this.drawPlanetSurface()
    this.drawVehicle()
    this.positionVehicle()
  }

  private handleShutdown() {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this)
  }
}
