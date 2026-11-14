import Phaser from 'phaser'
import type { RocketConfiguration } from '../game/types'
import {
  calculateDeltaVCapacityMps,
  computeLandingGuidance,
  createFlightParameters,
  createFlightState,
  createRigidBody2DState,
  predictBallisticArc2D,
  stepRigidBody2D,
  type FlightParameters,
  type FlightState,
  type RigidBody2DState,
} from './physics'

export interface FlightSceneCallbacks {
  onUpdate: (
    state: FlightState,
    phase: 'launch' | 'space' | 'landing',
    landingSpeedMps: number,
    activeThrottlePct: number,
  ) => void
  onManualOverride?: () => void
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

interface ExhaustParticle {
  sprite: Phaser.GameObjects.Rectangle
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
}

/**
 * Pixel-Art Phaser 3 Flight & Spaceflight Simulator (SFS) Landing Scene
 * powered by a 2D Rigid-Body Vector Physics Engine + Matter.js Debris Collider.
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
    autoPilot: false,
  }
  private flightState: FlightState | null = null
  private rbState: RigidBody2DState | null = null
  private launchParams: FlightParameters | null = null
  private landingParams: FlightParameters | null = null

  // Hierarchical Rocket Container & Sub-parts
  private rocket: Phaser.GameObjects.Container | null = null
  private rocketGraphic: Phaser.GameObjects.Graphics | null = null
  private nozzleContainer: Phaser.GameObjects.Container | null = null
  private nozzleGraphic: Phaser.GameObjects.Graphics | null = null
  private flameGraphic: Phaser.GameObjects.Graphics | null = null
  private leftLegGraphic: Phaser.GameObjects.Graphics | null = null
  private rightLegGraphic: Phaser.GameObjects.Graphics | null = null
  private chuteGraphic: Phaser.GameObjects.Graphics | null = null
  private shieldGraphic: Phaser.GameObjects.Graphics | null = null
  private rcsGraphic: Phaser.GameObjects.Graphics | null = null
  private separatedStageGraphic: Phaser.GameObjects.Graphics | null = null

  // Environment & SFS HUD Layers
  private stars: Phaser.GameObjects.Graphics | null = null
  private atmosphereOverlay: Phaser.GameObjects.Rectangle | null = null
  private farHills: Phaser.GameObjects.Graphics | null = null
  private nearHills: Phaser.GameObjects.Graphics | null = null
  private cloudLayer: Phaser.GameObjects.Graphics | null = null
  private launchPad: Phaser.GameObjects.Graphics | null = null
  private planetSurface: Phaser.GameObjects.Graphics | null = null
  private trajectoryGraphic: Phaser.GameObjects.Graphics | null = null
  private hudGaugesGraphic: Phaser.GameObjects.Graphics | null = null
  private telemetryText: Phaser.GameObjects.Text | null = null
  private statusText: Phaser.GameObjects.Text | null = null
  private checklistText: Phaser.GameObjects.Text | null = null

  // Physical Particle Pool & Matter.js Crash Debris
  private exhaustPool: ExhaustParticle[] = []
  private particleSpawnTimer = 0
  private debrisObjects: Phaser.GameObjects.GameObject[] = []
  private groundBody: MatterJS.BodyType | null = null

  private fixedAccumulator = 0
  private hudAccumulator = 0
  private spacePhaseTimer = 0
  private suspensionBounce = 0
  private flightActive = false
  private phase: 'launch' | 'space' | 'landing' = 'launch'
  private engineHeight = 22
  private bodyHeight = 110
  private bodyWidth = 48
  private legLength = 38
  private throttle = 1.0
  private steerInput = 0
  private throttleKeyDir = 0
  private readonly fixedStepSeconds = 1 / 60

  constructor() {
    super({ key: 'FlightScene' })
  }

  create() {
    this.drawBackground()
    this.drawLaunchPad()
    this.drawPlanetSurface()
    this.trajectoryGraphic = this.add.graphics().setDepth(2)
    this.hudGaugesGraphic = this.add.graphics().setDepth(11)
    this.drawVehicle()
    this.createParticlePool()
    this.setupMatterGroundCollider()

    this.statusText = this.add
      .text(this.scale.width * 0.5, 22, '', {
        fontFamily: '"DM Mono", monospace',
        fontSize: '12px',
        color: '#38D9E8',
        backgroundColor: '#080F20EE',
        padding: { x: 12, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(12)

    this.telemetryText = this.add
      .text(this.scale.width * 0.5, 48, '', {
        fontFamily: '"DM Mono", monospace',
        fontSize: '11px',
        color: '#E2E8F0',
        backgroundColor: '#0C172ACC',
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(12)

    this.checklistText = this.add
      .text(this.scale.width - 48, 84, '', {
        fontFamily: '"DM Mono", monospace',
        fontSize: '10px',
        color: '#CBD5E1',
        backgroundColor: '#080F20DD',
        padding: { x: 9, y: 7 },
        lineSpacing: 4,
      })
      .setOrigin(1, 0)
      .setDepth(12)
      .setVisible(false)

    const triggerManualSteer = (dir: -1 | 1) => {
      this.steerInput = dir
      if (this.phase === 'landing' && this.options.autoPilot) {
        this.options.autoPilot = false
        this.callbacks?.onManualOverride?.()
      }
    }

    const triggerManualThrottle = (dir: -1 | 1) => {
      this.throttleKeyDir = dir
      if (this.phase === 'landing' && this.options.autoPilot) {
        this.options.autoPilot = false
        this.callbacks?.onManualOverride?.()
      }
    }

    this.input.keyboard?.on('keydown-A', () => triggerManualSteer(-1))
    this.input.keyboard?.on('keydown-LEFT', () => triggerManualSteer(-1))
    this.input.keyboard?.on('keydown-D', () => triggerManualSteer(1))
    this.input.keyboard?.on('keydown-RIGHT', () => triggerManualSteer(1))
    this.input.keyboard?.on('keyup-A', () => {
      if (this.steerInput < 0) this.steerInput = 0
    })
    this.input.keyboard?.on('keyup-LEFT', () => {
      if (this.steerInput < 0) this.steerInput = 0
    })
    this.input.keyboard?.on('keyup-D', () => {
      if (this.steerInput > 0) this.steerInput = 0
    })
    this.input.keyboard?.on('keyup-RIGHT', () => {
      if (this.steerInput > 0) this.steerInput = 0
    })

    this.input.keyboard?.on('keydown-W', () => triggerManualThrottle(1))
    this.input.keyboard?.on('keydown-UP', () => triggerManualThrottle(1))
    this.input.keyboard?.on('keydown-S', () => triggerManualThrottle(-1))
    this.input.keyboard?.on('keydown-DOWN', () => triggerManualThrottle(-1))
    this.input.keyboard?.on('keyup-W', () => {
      if (this.throttleKeyDir > 0) this.throttleKeyDir = 0
    })
    this.input.keyboard?.on('keyup-UP', () => {
      if (this.throttleKeyDir > 0) this.throttleKeyDir = 0
    })
    this.input.keyboard?.on('keyup-S', () => {
      if (this.throttleKeyDir < 0) this.throttleKeyDir = 0
    })
    this.input.keyboard?.on('keyup-DOWN', () => {
      if (this.throttleKeyDir < 0) this.throttleKeyDir = 0
    })

    // Classic SFS / KSP Throttle Snap Keys: Z = 100%, X = 0%, SPACE = Full retro / 38% toggle
    this.input.keyboard?.on('keydown-Z', () => {
      if (!this.flightActive) return
      if (this.phase === 'landing' && this.options.autoPilot) {
        this.options.autoPilot = false
        this.callbacks?.onManualOverride?.()
      }
      this.throttle = 1.0
    })
    this.input.keyboard?.on('keydown-X', () => {
      if (!this.flightActive) return
      if (this.phase === 'landing' && this.options.autoPilot) {
        this.options.autoPilot = false
        this.callbacks?.onManualOverride?.()
      }
      this.throttle = 0.0
    })

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this)
  }

  private setupMatterGroundCollider() {
    if (!this.matter?.world) return
    if (this.groundBody) {
      this.matter.world.remove(this.groundBody)
    }
    const width = this.scale.width
    const groundY = this.scale.height * 0.82
    this.groundBody = this.matter.add.rectangle(width * 0.5, groundY + 24, width * 2, 48, {
      isStatic: true,
      friction: 0.7,
      restitution: 0.35,
    })
  }

  configure(configuration: RocketConfiguration, callbacks: FlightSceneCallbacks, options?: Partial<FlightSceneOptions>) {
    this.configuration = configuration
    this.callbacks = callbacks
    if (options) this.options = { ...this.options, ...options }
    this.rebuildPhysicsParameters()
    this.flightState = createFlightState(configuration)
    this.rbState = createRigidBody2DState(configuration)
    this.phase = 'launch'
    this.clearDebris()
    this.drawVehicle()
    this.positionVehicle()
    this.callbacks.onUpdate(this.flightState, this.phase, 0, Math.round(this.throttle * 100))
  }

  private rebuildPhysicsParameters() {
    if (!this.configuration) return
    this.launchParams = createFlightParameters(this.configuration, {
      hasFins: this.options.hasFins,
      planetId: 'earth',
      landingMode: false,
    })
    this.landingParams = createFlightParameters(this.configuration, {
      hasFins: this.options.hasFins,
      planetId: this.options.destinationId,
      landingMode: true,
    })
  }

  setOptions(options: Partial<FlightSceneOptions>) {
    const prevFins = this.options.hasFins
    const prevDest = this.options.destinationId
    this.options = { ...this.options, ...options }
    if (prevFins !== this.options.hasFins || prevDest !== this.options.destinationId) {
      this.rebuildPhysicsParameters()
      if (!this.flightActive) {
        this.drawPlanetSurface()
        this.drawVehicle()
        this.positionVehicle()
      }
    }
  }

  setThrottle(value: number) {
    this.throttle = Math.max(0, Math.min(1, value))
  }

  setSteer(dir: -1 | 0 | 1) {
    this.steerInput = dir
    if (dir !== 0 && this.phase === 'landing' && this.options.autoPilot) {
      this.options.autoPilot = false
      this.callbacks?.onManualOverride?.()
    }
  }

  startFlight(): boolean {
    if (!this.configuration || this.flightActive) return false
    this.rebuildPhysicsParameters()
    this.clearDebris()
    this.throttle = 1.0
    this.suspensionBounce = 0
    this.spacePhaseTimer = 0
    this.flightState = createFlightState(this.configuration)
    this.rbState = createRigidBody2DState(this.configuration)
    this.fixedAccumulator = 0
    this.hudAccumulator = 1
    this.flightActive = true
    this.phase = 'launch'
    this.planetSurface?.setVisible(false)
    this.separatedStageGraphic?.setVisible(false)
    this.checklistText?.setVisible(false)
    this.launchPad?.setVisible(true).setY(0)
    this.farHills?.setVisible(true).setY(0)
    this.nearHills?.setVisible(true).setY(0)
    this.cloudLayer?.setVisible(true).setY(0)
    this.atmosphereOverlay?.setAlpha(0.55)
    this.rocket?.setVisible(true).setRotation(0)
    this.statusText?.setText('AŞAMA 1: DÜNYA KALKIŞI — HEDEF YÖRÜNGEYE TIRMANIŞ')
    this.callbacks?.onUpdate(this.flightState, this.phase, 0, 100)
    return true
  }

  resetFlight() {
    this.flightActive = false
    this.fixedAccumulator = 0
    this.phase = 'launch'
    this.throttle = 1.0
    this.suspensionBounce = 0
    this.spacePhaseTimer = 0
    this.clearDebris()
    if (this.configuration) {
      this.rebuildPhysicsParameters()
      this.flightState = createFlightState(this.configuration)
      this.rbState = createRigidBody2DState(this.configuration)
    }
    this.flameGraphic?.setVisible(false)
    this.chuteGraphic?.setVisible(false)
    this.shieldGraphic?.setVisible(false)
    this.separatedStageGraphic?.setVisible(false)
    this.checklistText?.setVisible(false)
    this.rcsGraphic?.clear()
    this.trajectoryGraphic?.clear()
    this.hudGaugesGraphic?.clear()
    this.planetSurface?.setVisible(false)
    this.launchPad?.setVisible(true).setY(0)
    this.farHills?.setVisible(true).setY(0)
    this.nearHills?.setVisible(true).setY(0)
    this.cloudLayer?.setVisible(true).setY(0)
    this.atmosphereOverlay?.setAlpha(0.55)
    this.exhaustPool.forEach((p) => {
      p.life = 0
      p.sprite.setVisible(false)
    })
    this.rocket?.setVisible(true).setRotation(0)
    this.nozzleContainer?.setRotation(0)
    this.updateLandingLegs(0)
    this.statusText?.setText('')
    this.telemetryText?.setText('')
    this.positionVehicle()
    if (this.flightState) this.callbacks?.onUpdate(this.flightState, this.phase, 0, 100)
  }

  update(_time: number, deltaMs: number) {
    const realDt = Math.min(deltaMs, 50) / 1000
    this.updateParticles(realDt)

    // Smooth landing leg compression settle after touchdown
    if (!this.flightActive && this.suspensionBounce > 0) {
      this.suspensionBounce = Math.max(0, this.suspensionBounce - realDt * 4)
      if (this.rocket && this.rbState?.status === 'landed') {
        const groundLineY = this.scale.height * 0.82
        const restRocketY = groundLineY - (this.bodyHeight * 0.42 + this.legLength * 0.84)
        this.rocket.setY(restRocketY + Math.sin(this.suspensionBounce * Math.PI) * 5)
      }
    }

    if (this.throttleKeyDir !== 0 && this.flightActive && this.phase !== 'space') {
      this.throttle = Math.max(0, Math.min(1, this.throttle + this.throttleKeyDir * 0.55 * realDt))
    }

    if (!this.flightActive || !this.rbState || !this.launchParams || !this.landingParams) return

    if (this.phase === 'space') {
      this.stepSpaceTransferPhase(realDt)
      return
    }

    const simScale = this.phase === 'launch' ? 3.5 : 1.15
    this.fixedAccumulator += realDt * simScale

    while (this.fixedAccumulator >= this.fixedStepSeconds && this.flightActive) {
      this.fixedAccumulator -= this.fixedStepSeconds

      if (this.phase === 'launch') {
        this.stepLaunchPhase(this.fixedStepSeconds)
      } else if (this.phase === 'landing') {
        this.stepLandingPhase(this.fixedStepSeconds)
      }
    }

    this.renderSceneFrame()
  }

  private stepLaunchPhase(dt: number) {
    if (!this.rbState || !this.launchParams || !this.configuration) return

    this.rbState = stepRigidBody2D(
      this.rbState,
      this.launchParams,
      {
        throttle: Math.max(0.35, this.throttle),
        steerInput: this.steerInput,
        poweredDescentEnabled: true,
        sasEnabled: this.options.hasFins,
        autoLevel: false,
      },
      dt,
    )

    this.syncLegacyFlightState()

    if (!this.options.hasFins && this.rbState.yM > 35) {
      this.statusText?.setText('⚠ KANATÇIK YOK (CoP ÖNDE) — AERODİNAMİK TORK ROKETİ TAKLA ATTIRIYOR!')
    }

    if (this.rbState.status === 'liftoff-failed') {
      this.flightActive = false
      this.statusText?.setText('⚠ TWR < 1.0 — MOTOR İTKİSİ YERÇEKİMİNİ YENEMEDİ!')
      this.callbacks?.onUpdate(this.flightState!, this.phase, 0, Math.round(this.throttle * 100))
      this.callbacks?.onComplete(this.flightState!, false)
      return
    }

    if (this.rbState.status === 'aerodynamic-breakup') {
      this.flightActive = false
      const rx = this.rocket?.x ?? this.scale.width * 0.5
      const ry = this.rocket?.y ?? this.scale.height * 0.45
      this.spawnMatterBreakupDebris(rx, ry, this.rbState.vxMps, -this.rbState.vyMps)
      this.statusText?.setText('💥 AERODİNAMİK PARÇALANMA (MAX-Q TAKLASI)!')
      this.callbacks?.onUpdate(this.flightState!, this.phase, 0, Math.round(this.throttle * 100))
      this.callbacks?.onComplete(
        this.flightState!,
        false,
        'Kanatçık takılmadığı için Basınç Merkezi (CoP) Ağırlık Merkezinin (CoM) önüne geçti; aerodinamik tork roketi atmosferde takla attırarak parçaladı!',
      )
      return
    }

    // Check orbital transfer Delta-V threshold before leaving Earth atmosphere
    const requiredDv = this.options.destinationId === 'mars' ? 1_000 : 600
    const totalDvCapacity = calculateDeltaVCapacityMps(this.configuration)
    if (totalDvCapacity < requiredDv && this.rbState.yM >= 1_100) {
      this.flightActive = false
      this.flameGraphic?.setVisible(false)
      this.statusText?.setText(
        `⚠ YETERSİZ DELTA-V (${Math.round(totalDvCapacity)} / ${requiredDv} m/s) — YÖRÜNGEYE ULAŞILAMADI!`,
      )
      this.callbacks?.onUpdate(this.flightState!, this.phase, 0, 0)
      this.callbacks?.onComplete(
        this.flightState!,
        false,
        `Mevcut yakıt tankı ve motor yalnızca ${Math.round(totalDvCapacity)} m/s Delta-V üretebildi (Hedef için gereken: ${requiredDv} m/s). Daha büyük yakıt tankı veya daha verimli motor seçin!`,
      )
      return
    }

    // Enter Space Stage Separation & Orbital Transfer Beat at 2,000m altitude
    if (this.rbState.yM >= 2_000) {
      this.beginSpaceTransferPhase()
      return
    }

    if (this.rbState.status === 'impact' || (this.rbState.fuelRemainingKg <= 0 && this.rbState.vyMps <= 0)) {
      this.flightActive = false
      const rx = this.rocket?.x ?? this.scale.width * 0.5
      const ry = this.rocket?.y ?? this.scale.height * 0.6
      this.spawnMatterBreakupDebris(rx, ry, this.rbState.vxMps, 12)
      this.callbacks?.onUpdate(this.flightState!, this.phase, 0, 0)
      this.callbacks?.onComplete(this.flightState!, false)
      return
    }

    this.hudAccumulator += dt
    if (this.hudAccumulator >= 0.08) {
      this.hudAccumulator = 0
      this.callbacks?.onUpdate(this.flightState!, this.phase, 0, Math.round(this.throttle * 100))
    }
  }

  /**
   * 1.35s smooth Stage Separation & Planetary Approach Cutscene Beat ('space' phase)
   * so transitioning from Earth Ascent to Moon/Mars descent feels seamless.
   */
  private beginSpaceTransferPhase() {
    this.phase = 'space'
    this.spacePhaseTimer = 0
    this.launchPad?.setVisible(false)
    this.farHills?.setVisible(false)
    this.nearHills?.setVisible(false)
    this.cloudLayer?.setVisible(false)
    this.atmosphereOverlay?.setAlpha(0)
    this.flameGraphic?.setVisible(false)

    // Spawn separating lower booster visual right behind the rocket
    if (this.separatedStageGraphic) this.separatedStageGraphic.destroy()
    const rx = this.rocket?.x ?? this.scale.width * 0.5
    const ry = this.rocket?.y ?? this.scale.height * 0.45
    this.separatedStageGraphic = this.add.graphics().setPosition(rx, ry + this.bodyHeight * 0.35).setDepth(3)
    this.separatedStageGraphic.fillStyle(0x475569, 1).fillRect(-this.bodyWidth * 0.45, 0, this.bodyWidth * 0.9, 36)
    this.separatedStageGraphic.fillStyle(0xe45b69, 1).fillRect(-this.bodyWidth * 0.7, 16, 12, 18)
    this.separatedStageGraphic.fillStyle(0xe45b69, 1).fillRect(this.bodyWidth * 0.7 - 12, 16, 12, 18)

    const destLabel = this.options.destinationId === 'moon' ? 'AY YÖRÜNGESİNE' : 'MARS ATMOSFERİNE'
    this.statusText?.setText(`✦ KADEME AYRILDI — ${destLabel} İNİŞ ROTASINA GİRİLİYOR...`)
    if (this.flightState) this.callbacks?.onUpdate(this.flightState, 'space', 0, 0)
  }

  private stepSpaceTransferPhase(dt: number) {
    this.spacePhaseTimer += dt
    const progress = Math.min(1, this.spacePhaseTimer / 1.35)

    // Separated booster drifts smoothly downward & spins away
    if (this.separatedStageGraphic) {
      this.separatedStageGraphic.y += 120 * dt
      this.separatedStageGraphic.rotation += 0.9 * dt
      this.separatedStageGraphic.alpha = Math.max(0, 1 - progress * 1.1)
    }

    // Upper lander glides to the top of the approach corridor while extending landing legs
    if (this.rocket) {
      const targetX = this.scale.width * 0.5
      const targetY = 92
      this.rocket.x += (targetX - this.rocket.x) * Math.min(1, dt * 4)
      this.rocket.y += (targetY - this.rocket.y) * Math.min(1, dt * 3.5)
      this.rocket.rotation += (0 - this.rocket.rotation) * Math.min(1, dt * 6)
    }
    this.updateLandingLegs(progress * 0.7)
    this.drawPlanetSurface()
    this.planetSurface?.setVisible(true)
    if (this.planetSurface) {
      this.planetSurface.setY((1 - progress) * 140)
    }

    if (this.spacePhaseTimer >= 1.35) {
      this.separatedStageGraphic?.destroy()
      this.separatedStageGraphic = null
      this.planetSurface?.setY(0)
      this.enterLandingPhase()
    }
  }

  private enterLandingPhase() {
    if (!this.rbState || !this.configuration) return
    this.phase = 'landing'
    this.atmosphereOverlay?.setAlpha(this.options.destinationId === 'mars' ? 0.2 : 0.0)
    this.planetSurface?.setVisible(true).setY(0)
    this.checklistText?.setVisible(true)

    // Set initial throttle near hover (40%) so player has clean control immediately without plummeting
    this.throttle = 0.42

    const startSign = Math.random() > 0.5 ? 1 : -1
    const fullTankFuel = Math.max(240, this.configuration.fuelTank?.fuelMassKg ?? 260)
    const landingFuel = Math.max(this.rbState.fuelRemainingKg, fullTankFuel * 0.75)

    this.rbState = {
      ...this.rbState,
      status: 'flying',
      xM: startSign * 30,
      yM: 250,
      vxMps: -startSign * 2.2,
      vyMps: -9.5,
      angleRad: startSign * 0.05,
      angularVelocityRadPs: 0,
      gimbalAngleRad: 0,
      throttle: this.throttle,
      fuelRemainingKg: landingFuel,
      massKg: (this.landingParams?.dryMassKg ?? 500) + landingFuel,
      landingGearDeploy: 0.7,
    }

    const targetName =
      this.options.destinationId === 'moon' ? 'AY YÜZEYİ (1.62 m/s²)' : 'MARS YÜZEYİ (3.71 m/s²)'
    this.statusText?.setText(`AŞAMA 2: ${targetName} — [W/S] GAZ · [A/D] YÖN · PİSTE YUMUŞAK İN!`)
    this.syncLegacyFlightState()
    this.callbacks?.onUpdate(this.flightState!, 'landing', 9.8, Math.round(this.throttle * 100))
  }

  private stepLandingPhase(dt: number) {
    if (!this.rbState || !this.landingParams) return

    let activeThrottle = this.throttle
    let activeSteer = this.steerInput

    if (this.options.autoPilot) {
      const guidance = computeLandingGuidance(this.rbState, this.landingParams)
      activeThrottle = guidance.throttle
      activeSteer = guidance.steerInput
      this.throttle = activeThrottle
    }

    const prevVy = this.rbState.vyMps
    const prevVx = this.rbState.vxMps
    const prevAngle = this.rbState.angleRad

    this.rbState = stepRigidBody2D(
      this.rbState,
      this.landingParams,
      {
        throttle: activeThrottle,
        steerInput: activeSteer,
        parachuteDeployed: this.options.parachute,
        poweredDescentEnabled: this.options.poweredDescent,
        sasEnabled: true,
        autoLevel: true,
      },
      dt,
    )

    if (Math.abs(this.rbState.xM) > 135) {
      this.rbState.xM = Math.sign(this.rbState.xM) * 135
      this.rbState.vxMps *= -0.3
    }

    const currentDescentSpeed = Math.hypot(this.rbState.vxMps, this.rbState.vyMps)
    this.syncLegacyFlightState()

    if (this.options.parachute && this.options.destinationId === 'moon' && this.rbState.yM > 40) {
      this.statusText?.setText('⚠ AY’DA ATMOSFER YOK — PARAŞÜT SÜRTÜNME ÜRETMİYOR!')
    }

    if (this.rbState.status === 'landed' || this.rbState.status === 'impact') {
      this.flightActive = false
      const touchdownSpeed = Math.hypot(prevVx, prevVy)
      const touchdownTiltDeg = Math.round((Math.abs(prevAngle) * 180) / Math.PI)
      const marsMissingShield = this.options.destinationId === 'mars' && !this.options.heatShield
      const noRetro = !this.options.poweredDescent
      const offPad = Math.abs(this.rbState.xM) > 48
      const hardImpact = this.rbState.status === 'impact' || touchdownSpeed > 8.5

      this.flameGraphic?.setVisible(false)
      this.chuteGraphic?.setVisible(false)
      this.shieldGraphic?.setVisible(false)
      this.rcsGraphic?.clear()
      this.trajectoryGraphic?.clear()
      this.updateLandingChecklist(touchdownSpeed, touchdownTiltDeg, offPad)

      if (marsMissingShield || noRetro || hardImpact) {
        const rx = this.rocket?.x ?? this.scale.width * 0.5
        const ry = this.rocket?.y ?? this.scale.height * 0.76
        this.spawnMatterBreakupDebris(rx, ry, prevVx * 2, Math.abs(prevVy) * 1.5)
        const crashDetail = marsMissingShield
          ? 'Mars atmosferine ısı kalkanı olmadan girildiği için gövde aşırı ısınarak parçalandı!'
          : noRetro
            ? 'Ters itici motorlar aktif olmadığı için roket yüzeye yüksek hızla çakıldı!'
            : Math.abs(prevAngle) > 0.38
              ? `Roket yüzeye ${touchdownTiltDeg}° eğimle çarparak devrildi (Maksimum güvenli açı: 22°)!`
              : `Yüzeye çok yüksek hızla (${touchdownSpeed.toFixed(1)} m/s > 8.5 m/s) çarpıldı! İnişte gazı %40-%70 arasında tutarak frenleme yapın.`
        this.statusText?.setText(`💥 SERT ÇARPMA (${touchdownSpeed.toFixed(1)} m/s · ${touchdownTiltDeg}°)!`)
        this.callbacks?.onUpdate(this.flightState!, 'landing', touchdownSpeed, Math.round(activeThrottle * 100))
        this.callbacks?.onComplete(this.flightState!, false, crashDetail)
      } else {
        this.positionVehicle()
        if (this.rocket) this.rocket.rotation = 0
        this.nozzleContainer?.setRotation(0)
        this.updateLandingLegs(1)
        this.suspensionBounce = 1.0
        this.spawnSurfaceDustBurst(this.rocket?.x ?? this.scale.width * 0.5)
        const padNote = offPad ? ' (Yüzeye Güvenli İniş!)' : ' (Tam Hedef Pistte!)'
        this.statusText?.setText(`✓ YUMUŞAK İNİŞ BAŞARILI (${touchdownSpeed.toFixed(1)} m/s)${padNote}`)
        this.callbacks?.onUpdate(this.flightState!, 'landing', touchdownSpeed, 0)
        this.callbacks?.onComplete(this.flightState!, true)
      }
      return
    }

    this.hudAccumulator += dt
    if (this.hudAccumulator >= 0.05) {
      this.hudAccumulator = 0
      this.callbacks?.onUpdate(
        this.flightState!,
        'landing',
        currentDescentSpeed,
        Math.round(activeThrottle * 100),
      )
    }
  }

  private syncLegacyFlightState() {
    if (!this.rbState || !this.flightState) return
    this.flightState = {
      status:
        this.rbState.status === 'liftoff-failed'
          ? 'liftoff-failed'
          : this.rbState.status === 'impact' || this.rbState.status === 'aerodynamic-breakup'
            ? 'impact'
            : 'flying',
      altitudeM: this.rbState.yM,
      velocityMps: this.rbState.vyMps,
      fuelRemainingKg: this.rbState.fuelRemainingKg,
      massKg: this.rbState.massKg,
      elapsedTimeS: this.rbState.elapsedTimeS,
      maxAltitudeM: this.rbState.maxAltitudeM,
      maxSpeedMps: this.rbState.maxSpeedMps,
      deltaVUsedMps: this.rbState.deltaVUsedMps,
    }
  }

  private renderSceneFrame() {
    if (!this.rbState || !this.rocket) return
    this.positionVehicle()

    const isThrusting =
      this.flightActive &&
      this.rbState.fuelRemainingKg > 0 &&
      this.rbState.throttle > 0.03 &&
      (this.phase === 'launch' || this.options.poweredDescent)

    this.updateFlameAndNozzle(isThrusting, this.rbState.throttle, this.rbState.gimbalAngleRad)
    this.updateLandingLegs(this.rbState.landingGearDeploy)
    this.updateRcsPuffs()
    this.updateParachuteAndHeatShield()
    this.drawTrajectoryAndVectors()
    this.drawOnCanvasSfsGauges()
    this.updateTelemetryOverlay()
    if (this.phase === 'landing') {
      const spd = Math.hypot(this.rbState.vxMps, this.rbState.vyMps)
      const tilt = Math.round((Math.abs(this.rbState.angleRad) * 180) / Math.PI)
      this.updateLandingChecklist(spd, tilt, Math.abs(this.rbState.xM) > 48)
    }

    if (isThrusting) {
      this.particleSpawnTimer += 1
      if (this.particleSpawnTimer >= 1) {
        this.particleSpawnTimer = 0
        this.emitExhaustParticles(this.rbState.throttle)
      }
    }
  }

  private positionVehicle() {
    if (!this.rocket || !this.rbState) return
    const width = this.scale.width
    const height = this.scale.height

    if (this.phase === 'launch') {
      const groundLineY = height * 0.84
      const restRocketY = groundLineY - (this.bodyHeight * 0.5 + this.engineHeight)
      const climbProgress = 1 - Math.exp(-this.rbState.yM / 140)
      const rocketScreenY = restRocketY - climbProgress * (height * 0.36)
      const rocketScreenX = width * 0.5 + this.rbState.xM * 2.2
      this.rocket.setPosition(rocketScreenX, rocketScreenY)
      this.rocket.setRotation(this.rbState.angleRad)

      const alt = this.rbState.yM
      this.launchPad?.setY(Math.min(height, alt * 2.4))
      this.nearHills?.setY(Math.min(height, alt * 0.42))
      this.farHills?.setY(Math.min(height, alt * 0.18))
      this.cloudLayer?.setY(Math.min(height * 1.2, alt * 0.75))

      const atmoAlpha = Math.max(0, 0.55 * Math.exp(-alt / 900))
      this.atmosphereOverlay?.setAlpha(atmoAlpha)
    } else if (this.phase === 'landing') {
      const groundLineY = height * 0.82
      // Extended landing leg footpads sit flush on top of the landing pad at yM === 0!
      const footOffset = this.bodyHeight * 0.42 + this.legLength * Math.cos(0.55) + 2
      const restRocketY = groundLineY - footOffset
      const effectiveAlt =
        this.rbState.yM <= 260 ? this.rbState.yM : 260 + Math.log1p(this.rbState.yM - 260) * 16
      const pxPerMeter = Math.max(0.55, (restRocketY - 82) / 270)
      const rocketScreenX = Math.max(74, Math.min(width - 74, width * 0.5 + this.rbState.xM * 2.6))
      const rocketScreenY = Math.max(72, restRocketY - effectiveAlt * pxPerMeter)
      this.rocket.setPosition(rocketScreenX, rocketScreenY)
      this.rocket.setRotation(this.rbState.angleRad)
    }
  }

  private drawTrajectoryAndVectors() {
    if (!this.trajectoryGraphic || !this.rbState || !this.rocket) return
    this.trajectoryGraphic.clear()
    if (!this.flightActive || this.phase === 'space') return

    const width = this.scale.width
    const height = this.scale.height

    if (this.phase === 'landing' && this.landingParams) {
      const groundLineY = height * 0.82
      const footOffset = this.bodyHeight * 0.42 + this.legLength * Math.cos(0.55) + 2
      const restRocketY = groundLineY - footOffset
      const pxPerMeter = Math.max(0.55, (restRocketY - 82) / 270)

      // Vertical Radar Altimeter Laser Beam under the rocket
      this.trajectoryGraphic
        .lineStyle(1, 0x38d9e8, 0.32)
        .lineBetween(this.rocket.x, this.rocket.y + this.bodyHeight * 0.45, this.rocket.x, groundLineY)

      // Live SFS Ballistic Trajectory Prediction Curve
      const arcPoints = predictBallisticArc2D(this.rbState, this.landingParams.gravityMps2, 22)
      if (arcPoints.length > 1) {
        const impactX = arcPoints[arcPoints.length - 1]!.xM
        const onPad = Math.abs(impactX) <= 45
        const lineColor = onPad ? 0x38d9e8 : 0xffad57

        for (let i = 0; i < arcPoints.length - 1; i += 1) {
          if (i % 2 === 1) continue
          const p1 = arcPoints[i]!
          const p2 = arcPoints[i + 1]!
          const sx1 = width * 0.5 + p1.xM * 2.6
          const sy1 = groundLineY - Math.min(280, p1.yM) * pxPerMeter
          const sx2 = width * 0.5 + p2.xM * 2.6
          const sy2 = groundLineY - Math.min(280, p2.yM) * pxPerMeter
          this.trajectoryGraphic.lineStyle(2, lineColor, 0.72).lineBetween(sx1, sy1, sx2, sy2)
        }

        const targetScreenX = Math.max(40, Math.min(width - 40, width * 0.5 + impactX * 2.6))
        this.trajectoryGraphic.lineStyle(2, onPad ? 0x4ade80 : 0xfb7185, 0.95)
        this.trajectoryGraphic.strokeCircle(targetScreenX, groundLineY - 2, 7)
        this.trajectoryGraphic.lineBetween(targetScreenX - 11, groundLineY - 2, targetScreenX + 11, groundLineY - 2)
      }
    }

    const speed = Math.hypot(this.rbState.vxMps, this.rbState.vyMps)
    if (speed > 0.8) {
      const vxScreen = this.rbState.vxMps
      const vyScreen = -this.rbState.vyMps
      const len = Math.min(54, 20 + speed * 1.2)
      const ux = (vxScreen / speed) * len
      const uy = (vyScreen / speed) * len
      const rx = this.rocket.x
      const ry = this.rocket.y
      const safeSpeed = speed <= 8.5
      const vecColor = this.phase === 'landing' ? (safeSpeed ? 0x4ade80 : 0xffad57) : 0x38d9e8
      this.trajectoryGraphic.lineStyle(2, vecColor, 0.85)
      this.trajectoryGraphic.lineBetween(rx, ry, rx + ux, ry + uy)
      this.trajectoryGraphic.fillStyle(vecColor, 1).fillRect(rx + ux - 3, ry + uy - 3, 6, 6)
    }
  }

  private drawOnCanvasSfsGauges() {
    if (!this.hudGaugesGraphic || !this.rbState) return
    this.hudGaugesGraphic.clear()

    const width = this.scale.width
    const height = this.scale.height
    const barTop = 86
    const barH = Math.min(260, height - 160)
    if (barH < 80) return

    // 1. Left SFS Vertical Throttle Gauge (with HOVER marker at 38.5%)
    const leftX = 18
    const barW = 14
    this.hudGaugesGraphic.fillStyle(0x080f20, 0.82).fillRect(leftX - 4, barTop - 16, barW + 38, barH + 28)
    this.hudGaugesGraphic.lineStyle(1, 0x38d9e8, 0.4).strokeRect(leftX, barTop, barW, barH)

    const fillH = Math.round(barH * this.rbState.throttle)
    const throttleColor = this.rbState.throttle > 0.75 ? 0xffad57 : 0x38d9e8
    this.hudGaugesGraphic
      .fillStyle(throttleColor, 0.9)
      .fillRect(leftX + 2, barTop + barH - fillH, barW - 4, fillH)

    if (this.phase === 'landing') {
      const hoverY = barTop + barH * (1 - 0.385)
      this.hudGaugesGraphic.fillStyle(0x4ade80, 1).fillRect(leftX - 2, hoverY - 1, barW + 12, 3)
    }

    // 2. Right SFS Radar Altimeter Bar
    const rightX = width - 32
    const maxScaleAlt = this.phase === 'landing' ? 260 : 2_000
    const altRatio = Math.max(0, Math.min(1, this.rbState.yM / maxScaleAlt))
    const altFillH = Math.round(barH * altRatio)
    this.hudGaugesGraphic.fillStyle(0x080f20, 0.82).fillRect(rightX - 8, barTop - 16, barW + 16, barH + 28)
    this.hudGaugesGraphic.lineStyle(1, 0x8197b5, 0.4).strokeRect(rightX, barTop, barW, barH)
    this.hudGaugesGraphic
      .fillStyle(0x4ade80, 0.85)
      .fillRect(rightX + 2, barTop + barH - altFillH, barW - 4, altFillH)
  }

  private updateLandingChecklist(speed: number, tiltDeg: number, offPad: boolean) {
    if (!this.checklistText || !this.rbState) return
    this.checklistText.setPosition(this.scale.width - 48, 84)
    const spdOk = speed <= 8.5
    const tiltOk = tiltDeg <= 20
    const padOk = !offPad
    const equipOk =
      this.options.poweredDescent && (this.options.destinationId === 'moon' || this.options.heatShield)
    this.checklistText.setText(
      `İNİŞ KONTROL LİSTESİ\n` +
        `${spdOk ? '✓' : '⚠'} HIZ < 8.5 (${speed.toFixed(1)} m/s)\n` +
        `${tiltOk ? '✓' : '⚠'} DİK AÇI < 20° (${tiltDeg}°)\n` +
        `${padOk ? '✓' : '·'} PİST HİZASI (${Math.round(this.rbState.xM)}m)\n` +
        `${equipOk ? '✓' : '✗'} İNİŞ DONANIMI`,
    )
    this.checklistText.setColor(spdOk && tiltOk && equipOk ? '#4ADE80' : '#FFAD57')
  }

  private updateTelemetryOverlay() {
    if (!this.telemetryText || !this.rbState) return
    this.telemetryText.setX(this.scale.width * 0.5)
    const pitchDeg = ((this.rbState.angleRad * 180) / Math.PI).toFixed(0)
    const speed = Math.hypot(this.rbState.vxMps, this.rbState.vyMps).toFixed(1)
    const vx = this.rbState.vxMps.toFixed(1)
    const vy = this.rbState.vyMps.toFixed(1)
    const thrPct = Math.round(this.rbState.throttle * 100)
    const modeLabel =
      this.phase === 'landing'
        ? this.options.autoPilot
          ? '🤖 OTO-İNİŞ'
          : '🕹️ MANUEL SFS'
        : '🚀 KALKIŞ'
    this.telemetryText.setText(
      `${modeLabel}  ·  GAZ: %${thrPct} (ASKI: %38)  ·  HIZ: ${speed} m/s (DY: ${vy} | DX: ${vx})  ·  EĞİM: ${pitchDeg}°`,
    )
  }

  private updateFlameAndNozzle(active: boolean, throttle: number, gimbalRad: number) {
    if (!this.nozzleContainer || !this.flameGraphic || !this.rbState) return
    // Negative rotation Visually tilts the nozzle opposite pitch torque for physically accurate gimbal
    this.nozzleContainer.setRotation(-gimbalRad)

    if (!active) {
      this.flameGraphic.setVisible(false)
      return
    }

    const scale = 0.45 + throttle * 0.75
    const flicker = (18 + Math.sin(this.rbState.elapsedTimeS * 44) * 5) * scale
    const w = 8 + throttle * 6
    this.flameGraphic.clear().setVisible(true)
    this.flameGraphic
      .fillStyle(0xffad57, 0.92)
      .fillTriangle(-w, this.engineHeight - 2, w, this.engineHeight - 2, 0, this.engineHeight + flicker + 12)
    this.flameGraphic
      .fillStyle(0x38d9e8, 0.9)
      .fillTriangle(-w * 0.52, this.engineHeight, w * 0.52, this.engineHeight, 0, this.engineHeight + flicker)
    this.flameGraphic.fillStyle(0xf3f7ff, 0.95).fillRect(-w * 0.35, this.engineHeight - 1, w * 0.7, 5)
  }

  private updateLandingLegs(deployRatio: number) {
    if (!this.leftLegGraphic || !this.rightLegGraphic) return
    const angle = deployRatio * 0.55
    this.leftLegGraphic.setRotation(angle)
    this.rightLegGraphic.setRotation(-angle)
  }

  private updateRcsPuffs() {
    if (!this.rcsGraphic || !this.rbState || !this.flightActive) return
    this.rcsGraphic.clear()
    const angularCmd =
      this.phase === 'landing' && this.options.autoPilot
        ? this.rbState.gimbalAngleRad * 4
        : this.steerInput
    if (Math.abs(angularCmd) < 0.08) return

    const topY = -this.bodyHeight * 0.36
    const sideX = this.bodyWidth * 0.52
    this.rcsGraphic.fillStyle(0xf3f7ff, 0.9)
    if (angularCmd > 0) {
      this.rcsGraphic.fillTriangle(-sideX, topY, -sideX - 16, topY - 4, -sideX - 16, topY + 4)
    } else {
      this.rcsGraphic.fillTriangle(sideX, topY, sideX + 16, topY - 4, sideX + 16, topY + 4)
    }
  }

  private updateParachuteAndHeatShield() {
    if (!this.chuteGraphic || !this.shieldGraphic || !this.rbState) return
    const inLanding = this.phase === 'landing' && this.flightActive
    const showChute = inLanding && this.options.parachute && this.rbState.yM > 10
    this.chuteGraphic.setVisible(showChute)
    if (showChute) {
      this.chuteGraphic.setRotation(Math.max(-0.25, Math.min(0.25, -this.rbState.vxMps * 0.02)))
    }

    const showShield =
      inLanding &&
      this.options.destinationId === 'mars' &&
      this.options.heatShield &&
      this.rbState.yM > 125
    this.shieldGraphic.setVisible(showShield)
  }

  private createParticlePool() {
    this.exhaustPool.forEach((p) => p.sprite.destroy())
    this.exhaustPool = Array.from({ length: 72 }, (_, idx) => ({
      sprite: this.add
        .rectangle(0, 0, idx % 2 === 0 ? 5 : 4, idx % 2 === 0 ? 5 : 4, 0xffad57, 0.85)
        .setDepth(2)
        .setVisible(false),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.6,
    }))
  }

  private emitExhaustParticles(throttle: number) {
    if (!this.rocket || !this.rbState) return
    // Matches world nozzle angle: rocket.rotation + nozzleContainer.rotation (= angleRad - gimbalAngleRad)
    const totalAngle = this.rocket.rotation - this.rbState.gimbalAngleRad
    const nozzleDist = this.bodyHeight * 0.5 + this.engineHeight
    const emitX = this.rocket.x - Math.sin(totalAngle) * nozzleDist
    const emitY = this.rocket.y + Math.cos(totalAngle) * nozzleDist

    const jetSpeed = 135 + throttle * 165
    const dirX = -Math.sin(totalAngle)
    const dirY = Math.cos(totalAngle)

    let spawned = 0
    for (const p of this.exhaustPool) {
      if (p.life <= 0) {
        const spread = (Math.random() - 0.5) * 0.42
        const cosS = Math.cos(spread)
        const sinS = Math.sin(spread)
        p.x = emitX
        p.y = emitY
        p.vx = (dirX * cosS - dirY * sinS) * jetSpeed + (Math.random() - 0.5) * 24
        p.vy = (dirX * sinS + dirY * cosS) * jetSpeed + (Math.random() - 0.5) * 24
        p.maxLife = 0.38 + Math.random() * 0.28
        p.life = p.maxLife
        p.sprite.setPosition(p.x, p.y).setScale(1).setAlpha(0.9).setVisible(true)
        p.sprite.setFillStyle(Math.random() > 0.35 ? 0xffad57 : 0x38d9e8, 0.9)
        spawned += 1
        if (spawned >= 2) break
      }
    }
  }

  private spawnSurfaceDustBurst(x: number) {
    const groundY = this.scale.height * 0.82 - 4
    const dustColor = this.options.destinationId === 'mars' ? 0xfb923c : 0x94a3b8
    let spawned = 0
    for (const p of this.exhaustPool) {
      if (p.life <= 0) {
        const side = spawned % 2 === 0 ? -1 : 1
        p.x = x + side * (12 + Math.random() * 14)
        p.y = groundY
        p.vx = side * (60 + Math.random() * 75)
        p.vy = -(15 + Math.random() * 25)
        p.maxLife = 0.7
        p.life = p.maxLife
        p.sprite.setPosition(p.x, p.y).setFillStyle(dustColor, 0.8).setScale(1.6).setVisible(true)
        spawned += 1
        if (spawned >= 12) break
      }
    }
  }

  private updateParticles(dt: number) {
    const groundY = this.scale.height * (this.phase === 'landing' ? 0.82 : 0.84)
    const padVisible = this.phase === 'landing' || (this.rbState?.yM ?? 0) < 90
    const regolithDustColor = this.options.destinationId === 'mars' ? 0xfb923c : 0x93a8c7

    for (const p of this.exhaustPool) {
      if (p.life <= 0) continue
      p.life -= dt
      if (p.life <= 0) {
        p.sprite.setVisible(false)
        continue
      }

      p.vy += 45 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt

      if (padVisible && p.y >= groundY - 3) {
        p.y = groundY - 3
        p.vy = -Math.abs(p.vy) * 0.18 - 10
        p.vx = (p.vx >= 0 ? 1 : -1) * (65 + Math.random() * 95)
        p.sprite.setFillStyle(this.phase === 'landing' ? regolithDustColor : 0x93a8c7, 0.65)
      }

      const progress = 1 - p.life / p.maxLife
      p.sprite.setPosition(Math.round(p.x), Math.round(p.y))
      p.sprite.setScale(1 + progress * 1.4)
      p.sprite.setAlpha(Math.max(0.1, (1 - progress) * 0.85))
    }
  }

  private spawnMatterBreakupDebris(x: number, y: number, baseVx: number, baseVy: number) {
    this.rocket?.setVisible(false)
    this.cameras.main?.shake(340, 0.014)
    this.clearDebris()

    const partSpecs = [
      { w: 22, h: 24, color: 0xffad57, ox: 0, oy: -42 },
      { w: 36, h: 38, color: 0xc7d6e8, ox: -4, oy: -12 },
      { w: 36, h: 38, color: 0x8197b5, ox: 4, oy: 20 },
      { w: 18, h: 22, color: 0xe45b69, ox: -22, oy: 32 },
      { w: 18, h: 22, color: 0xe45b69, ox: 22, oy: 32 },
      { w: 24, h: 20, color: 0x38d9e8, ox: 0, oy: 48 },
    ]

    partSpecs.forEach((spec, idx) => {
      const rect = this.add
        .rectangle(x + spec.ox, y + spec.oy, spec.w, spec.h, spec.color, 1)
        .setStrokeStyle(2, 0x080f20)
        .setDepth(6)

      if (this.matter?.add) {
        const matterObj = this.matter.add.gameObject(rect, {
          restitution: 0.45,
          friction: 0.5,
          density: 0.002,
        }) as Phaser.Physics.Matter.Image
        const angle = (idx / partSpecs.length) * Math.PI * 2
        matterObj.setVelocity(
          baseVx * 0.15 + Math.cos(angle) * (4 + Math.random() * 5),
          -Math.abs(baseVy) * 0.12 - 3 - Math.random() * 5,
        )
        matterObj.setAngularVelocity((Math.random() - 0.5) * 0.28)
      }
      this.debrisObjects.push(rect)
    })

    this.exhaustPool.forEach((p, idx) => {
      const angle = (idx / this.exhaustPool.length) * Math.PI * 2
      const spd = 60 + (idx % 5) * 35
      p.x = x
      p.y = y
      p.vx = Math.cos(angle) * spd
      p.vy = Math.sin(angle) * spd - 30
      p.maxLife = 0.85
      p.life = 0.85
      p.sprite
        .setPosition(x, y)
        .setFillStyle(idx % 2 === 0 ? 0xfb7185 : 0xffad57, 1)
        .setScale(2)
        .setVisible(true)
    })
  }

  private clearDebris() {
    this.debrisObjects.forEach((obj) => obj.destroy())
    this.debrisObjects = []
  }

  private drawBackground() {
    const width = this.scale.width
    const height = this.scale.height
    this.stars?.destroy()
    this.atmosphereOverlay?.destroy()
    this.farHills?.destroy()
    this.nearHills?.destroy()
    this.cloudLayer?.destroy()

    const sky = this.add.graphics().setDepth(-9)
    sky.fillGradientStyle(0x060b16, 0x060b16, 0x0f1e38, 0x0f1e38, 1)
    sky.fillRect(0, 0, width, height)
    this.stars = sky

    let seed = 34_567
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647
      return seed / 2_147_483_647
    }
    for (let index = 0; index < 85; index += 1) {
      const x = random() * width
      const y = random() * height * 0.82
      sky.fillStyle(index % 5 === 0 ? 0x38d9e8 : 0xd7e7ff, 0.35 + random() * 0.6)
      sky.fillRect(Math.round(x), Math.round(y), random() > 0.8 ? 3 : 2, random() > 0.8 ? 3 : 2)
    }

    this.atmosphereOverlay = this.add
      .rectangle(width * 0.5, height * 0.5, width, height, 0x1e3a6e, 0.55)
      .setDepth(-8)

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
        new Phaser.Math.Vector2(width, height * 1.4),
        new Phaser.Math.Vector2(0, height * 1.4),
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
        new Phaser.Math.Vector2(width, height * 1.4),
        new Phaser.Math.Vector2(0, height * 1.4),
      ],
      true,
    )
    this.cloudLayer = this.add.graphics().setDepth(-3)
    this.cloudLayer.fillStyle(0x8197b5, 0.34)
    for (let index = 0; index < 9; index += 1) {
      const x = (index * 157) % Math.max(width, 1)
      const y = height * (0.26 + (index % 3) * 0.09)
      this.cloudLayer.fillRect(x, y, 36 + (index % 3) * 14, 6)
      this.cloudLayer.fillRect(x + 8, y - 5, 22 + (index % 4) * 4, 5)
    }
  }

  private drawLaunchPad() {
    this.launchPad?.destroy()
    const width = this.scale.width
    const height = this.scale.height
    this.launchPad = this.add.graphics().setDepth(1)
    this.launchPad.fillStyle(0x0e1727, 1).fillRect(0, height * 0.84, width, height * 0.25)
    this.launchPad.fillStyle(0x4ade80, 1).fillRect(0, height * 0.84, width, 4)
    this.launchPad.fillStyle(0x283d5c, 1).fillRect(width * 0.5 - 105, height * 0.84 - 8, 210, 10)
    this.launchPad.fillStyle(0x233752, 1).fillRect(width * 0.5 - 78, height * 0.54, 16, height * 0.3)
    this.launchPad.fillStyle(0x38d9e8, 0.65).fillRect(width * 0.5 - 62, height * 0.58, 32, 5)
    this.launchPad.lineStyle(2, 0x38d9e8, 0.65).lineBetween(width * 0.5 - 132, height * 0.84, width * 0.5 + 132, height * 0.84)
  }

  private drawPlanetSurface() {
    this.planetSurface?.destroy()
    const width = this.scale.width
    const height = this.scale.height
    const isMars = this.options.destinationId === 'mars'
    this.planetSurface = this.add.graphics().setDepth(1).setVisible(this.phase === 'landing' || this.phase === 'space')

    if (!isMars) {
      this.planetSurface.fillStyle(0x2563eb, 0.9).fillRect(width * 0.78, height * 0.18, 36, 36)
      this.planetSurface.fillStyle(0x4ade80, 0.85).fillRect(width * 0.78 + 8, height * 0.18 + 8, 14, 12)
      this.planetSurface.fillStyle(0xf8fafc, 0.65).fillRect(width * 0.78 + 4, height * 0.18 + 22, 22, 5)
    } else {
      this.planetSurface.fillStyle(0xfdba74, 0.85).fillRect(width * 0.8, height * 0.2, 20, 16)
      this.planetSurface.fillStyle(0x9a3412, 0.8).fillRect(width * 0.8 + 4, height * 0.2 + 4, 6, 6)
    }

    this.planetSurface.fillStyle(isMars ? 0x5c1d0e : 0x1e293b, 0.9)
    this.planetSurface.fillPoints(
      [
        new Phaser.Math.Vector2(0, height * 0.82),
        new Phaser.Math.Vector2(width * 0.15, height * 0.68),
        new Phaser.Math.Vector2(width * 0.31, height * 0.77),
        new Phaser.Math.Vector2(width * 0.5, height * 0.74),
        new Phaser.Math.Vector2(width * 0.71, height * 0.66),
        new Phaser.Math.Vector2(width * 0.88, height * 0.76),
        new Phaser.Math.Vector2(width, height * 0.7),
        new Phaser.Math.Vector2(width, height * 0.82),
      ],
      true,
    )

    this.planetSurface
      .fillStyle(isMars ? 0x9a3412 : 0x475569, 1)
      .fillRect(0, height * 0.82, width, height * 0.18)
    this.planetSurface
      .fillStyle(isMars ? 0x7c2d12 : 0x334155, 1)
      .fillRect(0, height * 0.88, width, height * 0.12)

    this.planetSurface.fillStyle(isMars ? 0x431407 : 0x1e293b, 1)
    this.planetSurface.fillRect(width * 0.14, height * 0.84, 64, 12)
    this.planetSurface.fillRect(width * 0.74, height * 0.85, 72, 14)

    // Glowing SFS Target Landing Pad in center (xM = 0, +/- 45m)
    const padHalfPx = 45 * 2.6
    this.planetSurface.fillStyle(0x0f172a, 1).fillRect(width * 0.5 - padHalfPx, height * 0.82 - 4, padHalfPx * 2, 10)
    this.planetSurface.fillStyle(0x38d9e8, 1).fillRect(width * 0.5 - padHalfPx, height * 0.82 - 4, padHalfPx * 2, 4)
    this.planetSurface.fillStyle(0x4ade80, 1).fillRect(width * 0.5 - 42, height * 0.82 - 6, 84, 4)
    this.planetSurface.fillStyle(0xffad57, 1).fillRect(width * 0.5 - padHalfPx, height * 0.82 - 14, 6, 10)
    this.planetSurface.fillStyle(0xffad57, 1).fillRect(width * 0.5 + padHalfPx - 6, height * 0.82 - 14, 6, 10)
  }

  private drawVehicle() {
    this.rocket?.destroy(true)
    this.rocket = this.add.container(this.scale.width * 0.5, this.scale.height * 0.68).setDepth(4)

    const config = this.configuration
    const slots = config?.body.cargoSlots ?? 2
    const bodyW = 36 + slots * 7
    const bodyH = 82 + slots * 15
    const engineW = config?.engine.id === 'engine-titan' ? 32 : config?.engine.id === 'engine-voyager' ? 25 : 19
    const engineH = config?.engine.id === 'engine-titan' ? 28 : config?.engine.id === 'engine-voyager' ? 24 : 19
    this.bodyWidth = bodyW
    this.bodyHeight = bodyH
    this.engineHeight = engineH
    this.legLength = engineH + 20
    const top = -bodyH / 2

    // 1. Parachute child graphic
    this.chuteGraphic = this.add.graphics().setPosition(0, top - 28).setVisible(false)
    this.chuteGraphic.fillStyle(0xfb7185, 1).fillRect(-28, -42, 56, 14)
    this.chuteGraphic.fillStyle(0xffad57, 1).fillRect(-20, -50, 40, 8)
    this.chuteGraphic.lineStyle(2, 0xf3f7ff, 0.9)
    this.chuteGraphic.lineBetween(-22, -28, -4, 0)
    this.chuteGraphic.lineBetween(22, -28, 4, 0)
    this.rocket.add(this.chuteGraphic)

    // 2. Gimballing Engine Nozzle + Flame Container
    this.nozzleContainer = this.add.container(0, bodyH / 2 - 2)
    this.flameGraphic = this.add.graphics().setVisible(false)
    this.nozzleGraphic = this.add.graphics()
    const engineColor =
      config?.engine.id === 'engine-titan' ? 0xffad57 : config?.engine.id === 'engine-voyager' ? 0x8298b8 : 0x38d9e8
    this.nozzleGraphic
      .fillStyle(engineColor, 1)
      .fillTriangle(-engineW / 2, 0, engineW / 2, 0, 0, engineH)
    this.nozzleGraphic
      .fillStyle(0x20314b, 1)
      .fillRect(-engineW * 0.26, 2, engineW * 0.52, Math.max(5, engineH * 0.35))
    this.nozzleContainer.add([this.flameGraphic, this.nozzleGraphic])
    this.rocket.add(this.nozzleContainer)

    // 3. Deployable Telescopic SFS Landing Legs (extend BELOW nozzle bell so pad rests cleanly on footpads!)
    this.leftLegGraphic = this.add.graphics().setPosition(-bodyW * 0.44, bodyH * 0.42)
    this.leftLegGraphic.fillStyle(0x93a8c7, 1).fillRect(-3, 0, 5, this.legLength)
    this.leftLegGraphic.fillStyle(0x38d9e8, 1).fillRect(-10, this.legLength - 4, 14, 5)

    this.rightLegGraphic = this.add.graphics().setPosition(bodyW * 0.44, bodyH * 0.42)
    this.rightLegGraphic.fillStyle(0x93a8c7, 1).fillRect(-2, 0, 5, this.legLength)
    this.rightLegGraphic.fillStyle(0x38d9e8, 1).fillRect(-4, this.legLength - 4, 14, 5)
    this.rocket.add([this.leftLegGraphic, this.rightLegGraphic])

    // 4. Main Rocket Fuselage, Fins & Cargo Pods
    this.rocketGraphic = this.add.graphics()
    const graphics = this.rocketGraphic
    if (this.options.hasFins) {
      graphics
        .fillStyle(0xe45b69, 1)
        .fillTriangle(-bodyW * 0.32, bodyH / 2 - 8, -bodyW * 0.78, bodyH / 2 + 22, -bodyW * 0.16, bodyH / 2 + 17)
      graphics
        .fillStyle(0xe45b69, 1)
        .fillTriangle(bodyW * 0.32, bodyH / 2 - 8, bodyW * 0.78, bodyH / 2 + 22, bodyW * 0.16, bodyH / 2 + 17)
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
    this.rocket.add(graphics)

    // 5. RCS Cold-Gas Thruster Puffs & Heatshield Plasma Glow
    this.rcsGraphic = this.add.graphics()
    this.shieldGraphic = this.add.graphics().setPosition(0, bodyH / 2 + engineH + 6).setVisible(false)
    this.shieldGraphic.fillStyle(0xffad57, 0.95).fillRect(-32, 0, 64, 6)
    this.shieldGraphic.fillStyle(0xfb7185, 0.85).fillRect(-40, 6, 80, 5)
    this.rocket.add([this.rcsGraphic, this.shieldGraphic])
  }

  private handleResize() {
    this.drawBackground()
    this.drawLaunchPad()
    this.drawPlanetSurface()
    this.setupMatterGroundCollider()
    this.drawVehicle()
    this.positionVehicle()
  }

  private handleShutdown() {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this)
  }
}
