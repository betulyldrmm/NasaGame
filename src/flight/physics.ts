import { PLANETS } from '../game/data'
import { calculateCoMAndCoP, calculateTWR } from '../game/calculations'
import type { RocketConfiguration } from '../game/types'

export type FlightStatus = 'ready' | 'flying' | 'apogee' | 'impact' | 'liftoff-failed'

export interface FlightState {
  status: FlightStatus
  altitudeM: number
  velocityMps: number
  fuelRemainingKg: number
  massKg: number
  elapsedTimeS: number
  maxAltitudeM: number
  maxSpeedMps: number
  deltaVUsedMps: number
}

export interface FlightParameters {
  thrustN: number
  fuelFlowKgPerSecond: number
  dryMassKg: number
  initialFuelKg: number
  gravityMps2: number
  dragCoefficient: number
  referenceAreaM2: number
  seaLevelAirDensityKgM3: number
  atmosphereScaleHeightM: number
  staticMargin: number
  lengthM: number
  momentOfInertiaKgM2: number
}

/**
 * Full 2D Rigid-Body State for Spaceflight Simulator (SFS) style launch & planetary landing.
 * Coordinates:
 * - xM: horizontal offset from pad center (meters, right is +)
 * - yM: altitude above ground/pad surface (meters, up is +)
 * - vxMps: horizontal velocity (m/s, right is +)
 * - vyMps: vertical velocity (m/s, up is +)
 * - angleRad: pitch angle from vertical (radians, 0 = upright, + = tilted right)
 * - angularVelocityRadPs: pitch rate (rad/s)
 */
export interface RigidBody2DState {
  status: FlightStatus | 'landed' | 'aerodynamic-breakup'
  xM: number
  yM: number
  vxMps: number
  vyMps: number
  angleRad: number
  angularVelocityRadPs: number
  gimbalAngleRad: number
  throttle: number
  fuelRemainingKg: number
  massKg: number
  dynamicPressurePa: number
  gLoad: number
  aerodynamicTorqueNm: number
  landingGearDeploy: number
  elapsedTimeS: number
  maxAltitudeM: number
  maxSpeedMps: number
  deltaVUsedMps: number
}

export interface RigidBodyStepControls {
  throttle: number
  steerInput: number // -1..1
  parachuteDeployed?: boolean
  poweredDescentEnabled?: boolean
  sasEnabled?: boolean
}

export interface TrajectoryPoint2D {
  xM: number
  yM: number
}

/** NASA-sourced Earth surface gravity; the same rounded value used by the assembly TWR calculation. */
export const EARTH_LAUNCH_GRAVITY_MPS2 = PLANETS.find((planet) => planet.id === 'earth')!.gravityMps2

/** Simplified atmosphere/drag and propellant-flow coefficients are gameplay assumptions. */
export const FLIGHT_GAME_ASSUMPTIONS = {
  dragCoefficient: 0.45,
  seaLevelAirDensityKgM3: 1.225,
  atmosphereScaleHeightM: 8_500,
  referenceAreaByCargoSlotsM2: { 1: 0.55, 2: 0.82, 4: 1.2 } as Record<number, number>,
} as const

export function createFlightParameters(
  rocket: RocketConfiguration,
  options?: { hasFins?: boolean; planetId?: 'earth' | 'moon' | 'mars' },
): FlightParameters {
  const fuelKg = rocket.fuelTank?.fuelMassKg ?? 0
  const hasFins = options?.hasFins ?? true
  const planetId = options?.planetId ?? 'earth'
  const planet = PLANETS.find((p) => p.id === planetId) ?? PLANETS[0]!
  const { comPercent, copPercent } = calculateCoMAndCoP(rocket, hasFins)
  // Normalized static margin: > 0 when CoP > CoM (Blue CoP below Yellow CoM -> stable)
  const staticMargin = (copPercent - comPercent) / 100
  const lengthM = 10 + rocket.body.cargoSlots * 2.2
  const radiusM = 0.9 + rocket.body.cargoSlots * 0.2
  const momentOfInertiaKgM2 = (1 / 12) * rocket.totalMassKg * (lengthM * lengthM + 3 * radiusM * radiusM)

  const airDensityByPlanet: Record<string, number> = {
    earth: FLIGHT_GAME_ASSUMPTIONS.seaLevelAirDensityKgM3,
    moon: 0,
    mars: 0.02,
  }
  const scaleHeightByPlanet: Record<string, number> = {
    earth: 8_500,
    moon: 1_000,
    mars: 11_100,
  }

  return {
    thrustN: rocket.engine.thrustN,
    fuelFlowKgPerSecond: rocket.engine.fuelConsumptionKgPerSecond,
    dryMassKg: rocket.totalMassKg - fuelKg,
    initialFuelKg: fuelKg,
    gravityMps2: planet.gravityMps2,
    dragCoefficient: FLIGHT_GAME_ASSUMPTIONS.dragCoefficient,
    referenceAreaM2: FLIGHT_GAME_ASSUMPTIONS.referenceAreaByCargoSlotsM2[rocket.body.cargoSlots] ?? 0.82,
    seaLevelAirDensityKgM3: airDensityByPlanet[planetId] ?? FLIGHT_GAME_ASSUMPTIONS.seaLevelAirDensityKgM3,
    atmosphereScaleHeightM: scaleHeightByPlanet[planetId] ?? FLIGHT_GAME_ASSUMPTIONS.atmosphereScaleHeightM,
    staticMargin,
    lengthM,
    momentOfInertiaKgM2,
  }
}

export function createFlightState(rocket: RocketConfiguration): FlightState {
  return {
    status: 'ready',
    altitudeM: 0,
    velocityMps: 0,
    fuelRemainingKg: rocket.fuelTank?.fuelMassKg ?? 0,
    massKg: rocket.totalMassKg,
    elapsedTimeS: 0,
    maxAltitudeM: 0,
    maxSpeedMps: 0,
    deltaVUsedMps: 0,
  }
}

export function createRigidBody2DState(
  rocket: RocketConfiguration,
  initial?: Partial<RigidBody2DState>,
): RigidBody2DState {
  return {
    status: 'ready',
    xM: 0,
    yM: 0,
    vxMps: 0,
    vyMps: 0,
    angleRad: 0,
    angularVelocityRadPs: 0,
    gimbalAngleRad: 0,
    throttle: 1.0,
    fuelRemainingKg: rocket.fuelTank?.fuelMassKg ?? 0,
    massKg: rocket.totalMassKg,
    dynamicPressurePa: 0,
    gLoad: 1.0,
    aerodynamicTorqueNm: 0,
    landingGearDeploy: 0,
    elapsedTimeS: 0,
    maxAltitudeM: 0,
    maxSpeedMps: 0,
    deltaVUsedMps: 0,
    ...initial,
  }
}

/** Ideal rocket-equation capacity using effective exhaust velocity = thrust / assumed mass flow. */
export function calculateDeltaVCapacityMps(rocket: RocketConfiguration): number {
  const fuelKg = rocket.fuelTank?.fuelMassKg ?? 0
  const dryMassKg = rocket.totalMassKg - fuelKg
  if (fuelKg <= 0 || dryMassKg <= 0 || rocket.engine.fuelConsumptionKgPerSecond <= 0) return 0
  const effectiveExhaustVelocityMps = rocket.engine.thrustN / rocket.engine.fuelConsumptionKgPerSecond
  return effectiveExhaustVelocityMps * Math.log(rocket.totalMassKg / dryMassKg)
}

function wrapAngleRad(angle: number): number {
  let a = (angle + Math.PI) % (2 * Math.PI)
  if (a < 0) a += 2 * Math.PI
  return a - Math.PI
}

/**
 * Pure 2D Rigid-Body Physics Step (Symplectic Euler with rotational inertia, thrust vectoring,
 * quadratic atmospheric drag, parachute drag, and CoM/CoP aerodynamic stability torque).
 */
export function stepRigidBody2D(
  state: RigidBody2DState,
  parameters: FlightParameters,
  controls: RigidBodyStepControls,
  dtSeconds: number,
): RigidBody2DState {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new RangeError('Time step must be a finite positive number of seconds.')
  }
  if (
    state.status === 'apogee' ||
    state.status === 'impact' ||
    state.status === 'liftoff-failed' ||
    state.status === 'landed' ||
    state.status === 'aerodynamic-breakup'
  ) {
    return state
  }

  const throttle = Math.max(0, Math.min(1, controls.throttle))
  const steer = Math.max(-1, Math.min(1, controls.steerInput))
  const engineEnabled = controls.poweredDescentEnabled ?? true

  // Liftoff TWR check when starting on the launchpad
  if (state.status === 'ready' && state.yM <= 0.01) {
    const initialTwr = calculateTWR(parameters.thrustN * throttle, state.massKg, parameters.gravityMps2)
    if (initialTwr < 1 || !engineEnabled || state.fuelRemainingKg <= 0) {
      return { ...state, status: 'liftoff-failed', throttle }
    }
  }

  // Propellant consumption & thrust magnitude
  const requestedFuelKg = engineEnabled ? parameters.fuelFlowKgPerSecond * throttle * dtSeconds : 0
  const fuelUsedKg = Math.min(state.fuelRemainingKg, requestedFuelKg)
  const thrustRatio =
    requestedFuelKg > 0 ? fuelUsedKg / (parameters.fuelFlowKgPerSecond * dtSeconds) : 0
  const fuelRemainingKg = Math.max(0, state.fuelRemainingKg - fuelUsedKg)
  const massKg = Math.max(parameters.dryMassKg, state.massKg - fuelUsedKg)
  const thrustN = engineEnabled ? parameters.thrustN * thrustRatio : 0

  // Smooth nozzle gimbal tracking (-12 deg to +12 deg)
  const maxGimbalRad = 0.21
  const targetGimbalRad = steer * maxGimbalRad
  const gimbalAngleRad = state.gimbalAngleRad + (targetGimbalRad - state.gimbalAngleRad) * Math.min(1, dtSeconds * 18)

  // Thrust vector in 2D world space (angleRad = 0 is straight up +Y)
  const thrustDirRad = state.angleRad + gimbalAngleRad * 0.25
  const thrustFx = thrustN * Math.sin(thrustDirRad)
  const thrustFy = thrustN * Math.cos(thrustDirRad)

  // Atmospheric density & quadratic drag
  const densityKgM3 =
    parameters.seaLevelAirDensityKgM3 > 0
      ? parameters.seaLevelAirDensityKgM3 * Math.exp(-Math.max(state.yM, 0) / parameters.atmosphereScaleHeightM)
      : 0
  const speedMps = Math.hypot(state.vxMps, state.vyMps)
  const dynamicPressurePa = 0.5 * densityKgM3 * speedMps * speedMps

  const chuteAreaM2 = controls.parachuteDeployed && densityKgM3 > 0 ? 32 : 0
  const totalDragArea = parameters.dragCoefficient * parameters.referenceAreaM2 + chuteAreaM2
  const dragMagnitudeN = dynamicPressurePa * totalDragArea
  const dragFx = speedMps > 0.001 ? (-dragMagnitudeN * state.vxMps) / speedMps : 0
  const dragFy = speedMps > 0.001 ? (-dragMagnitudeN * state.vyMps) / speedMps : 0

  // Aerodynamic pitching torque from CoM vs CoP static margin
  let aeroTorqueNm = 0
  const inertia = Math.max(
    400,
    parameters.momentOfInertiaKgM2 * (massKg / Math.max(1, parameters.dryMassKg + parameters.initialFuelKg)),
  )
  if (speedMps > 4 && densityKgM3 > 0.0005) {
    const velocityAngleRad = Math.atan2(state.vxMps, state.vyMps)
    const angleOfAttackRad = wrapAngleRad(state.angleRad - velocityAngleRad)
    // Static margin > 0 (fins attached, CoP behind CoM) creates restoring weathercock torque;
    // Static margin < 0 (no fins, CoP ahead of CoM) creates destabilizing flip torque!
    aeroTorqueNm =
      -dynamicPressurePa *
      parameters.referenceAreaM2 *
      parameters.lengthM *
      (parameters.staticMargin * 28) *
      Math.sin(angleOfAttackRad)

    // Atmospheric buffet/shear triggers divergence when aerodynamically unstable (staticMargin < 0)
    if (parameters.staticMargin < 0 && state.yM > 25) {
      aeroTorqueNm += inertia * 2.2 * Math.max(0.2, dynamicPressurePa / 400)
    }
  }

  // Rotational dynamics (RCS + Gimbal control torque + critical SAS angular velocity damping)
  const controlTorqueNm = steer * inertia * 2.8
  const dampingTorqueNm = -state.angularVelocityRadPs * inertia * 3.4
  const totalTorqueNm = controlTorqueNm + aeroTorqueNm + dampingTorqueNm
  const angularAccelRadPs2 = totalTorqueNm / inertia
  const angularVelocityRadPs = Math.max(
    -4.5,
    Math.min(4.5, state.angularVelocityRadPs + angularAccelRadPs2 * dtSeconds),
  )
  const angleRad = wrapAngleRad(state.angleRad + angularVelocityRadPs * dtSeconds)

  // Linear accelerations
  const axMps2 = (thrustFx + dragFx) / massKg
  const ayMps2 = (thrustFy + dragFy) / massKg - parameters.gravityMps2
  const gLoad = Math.hypot(thrustFx + dragFx, thrustFy + dragFy) / (massKg * 9.81)

  const vxMps = state.vxMps + axMps2 * dtSeconds
  const vyMps = state.vyMps + ayMps2 * dtSeconds
  const xM = state.xM + vxMps * dtSeconds
  const rawYM = state.yM + vyMps * dtSeconds
  const yM = Math.max(0, rawYM)

  // Smooth landing gear deployment below 180m when descending
  const gearTarget = yM < 180 && vyMps < 2 ? 1 : 0
  const landingGearDeploy = state.landingGearDeploy + (gearTarget - state.landingGearDeploy) * Math.min(1, dtSeconds * 4)

  // Check aerodynamic structural breakup (high dynamic pressure + extreme angle of attack when fins are missing)
  if (parameters.staticMargin < 0 && dynamicPressurePa > 180 && Math.abs(angleRad) > 0.95 && yM > 40) {
    return {
      ...state,
      status: 'aerodynamic-breakup',
      xM,
      yM,
      vxMps,
      vyMps,
      angleRad,
      angularVelocityRadPs,
      gimbalAngleRad,
      throttle,
      fuelRemainingKg,
      massKg,
      dynamicPressurePa,
      gLoad,
      aerodynamicTorqueNm: aeroTorqueNm,
      landingGearDeploy,
      elapsedTimeS: state.elapsedTimeS + dtSeconds,
      maxAltitudeM: Math.max(state.maxAltitudeM, yM),
      maxSpeedMps: Math.max(state.maxSpeedMps, speedMps),
      deltaVUsedMps: state.deltaVUsedMps + (thrustN / massKg) * dtSeconds,
    }
  }

  // Check surface contact (touchdown vs impact)
  let status: RigidBody2DState['status'] = 'flying'
  if (rawYM <= 0 && vyMps <= 0 && state.elapsedTimeS > 0.25) {
    const impactSpeed = Math.hypot(vxMps, vyMps)
    const uprightEnough = Math.abs(angleRad) <= 0.38 // ~22 degrees
    status = impactSpeed <= 8.5 && uprightEnough ? 'landed' : 'impact'
  }

  const clampedGround = status === 'landed' || status === 'impact'
  return {
    status,
    xM,
    yM: clampedGround ? 0 : yM,
    vxMps: clampedGround ? 0 : vxMps,
    vyMps: clampedGround ? 0 : vyMps,
    angleRad: status === 'landed' ? 0 : angleRad,
    angularVelocityRadPs: clampedGround ? 0 : angularVelocityRadPs,
    gimbalAngleRad,
    throttle,
    fuelRemainingKg,
    massKg,
    dynamicPressurePa,
    gLoad,
    aerodynamicTorqueNm: aeroTorqueNm,
    landingGearDeploy,
    elapsedTimeS: state.elapsedTimeS + dtSeconds,
    maxAltitudeM: Math.max(state.maxAltitudeM, yM),
    maxSpeedMps: Math.max(state.maxSpeedMps, speedMps),
    deltaVUsedMps: state.deltaVUsedMps + (thrustN / massKg) * dtSeconds,
  }
}

/**
 * Proportional-Derivative (PD) Hover-Slam & Attitude Guidance Controller for SFS Auto-Pilot.
 * Smoothly banks toward xM = 0 (target landing pad), nulls horizontal velocity, and performs
 * a continuous gravity-compensated braking burn to touch down at ~2.0 m/s.
 */
export function computeLandingGuidance(
  state: RigidBody2DState,
  parameters: FlightParameters,
): { throttle: number; steerInput: number } {
  const maxAccel = parameters.thrustN / Math.max(1, state.massKg)
  const netMaxUpwardAccel = Math.max(1.5, maxAccel - parameters.gravityMps2)

  // Target horizontal velocity toward pad (xM = 0)
  const targetVx = Math.max(-10, Math.min(10, -state.xM * 0.22))
  const vxError = targetVx - state.vxMps

  // Above 30m altitude, allow gentle banking up to 16 deg to correct horizontal drift;
  // below 30m, level the vehicle upright (angleRad -> 0) for safe landing leg contact.
  const maxBankRad = state.yM > 30 ? 0.28 : 0.04
  const desiredAngleRad = Math.max(-maxBankRad, Math.min(maxBankRad, vxError * 0.045))

  // PD attitude controller -> smooth steerInput in [-1, 1]
  const angleError = wrapAngleRad(desiredAngleRad - state.angleRad)
  const steerInput = Math.max(-1, Math.min(1, angleError * 4.5 - state.angularVelocityRadPs * 1.6))

  // Suicide-burn / hover-slam descent velocity profile: v_target(y) = -sqrt(2 * a_brake * y)
  const safeBrakeAccel = Math.min(6.0, netMaxUpwardAccel * 0.35)
  const desiredVy =
    state.yM > 18
      ? -Math.min(26, Math.sqrt(2 * safeBrakeAccel * (state.yM - 12)) + 2.4)
      : -Math.max(1.6, 1.6 + (state.yM / 18) * 1.4)
  const vyError = desiredVy - state.vyMps

  // Gravity feedforward + proportional vertical speed control
  const desiredUpwardAccel = Math.max(0, parameters.gravityMps2 + vyError * 2.2)
  const cosTilt = Math.max(0.65, Math.cos(state.angleRad))
  const rawThrottle = (desiredUpwardAccel * state.massKg) / (Math.max(1, parameters.thrustN) * cosTilt)
  const throttle = Math.max(0, Math.min(1, rawThrottle))

  return { throttle, steerInput }
}

/**
 * Computes a predicted ballistic trajectory arc in 2D space (xM, yM) down to the surface (yM = 0)
 * for the Spaceflight Simulator HUD trajectory indicator.
 */
export function predictBallisticArc2D(
  state: RigidBody2DState,
  gravityMps2: number,
  steps = 24,
): TrajectoryPoint2D[] {
  const points: TrajectoryPoint2D[] = [{ xM: state.xM, yM: state.yM }]
  if (state.yM <= 0) return points

  const g = Math.max(0.5, gravityMps2)
  const discriminant = state.vyMps * state.vyMps + 2 * g * state.yM
  const totalTimeS = Math.min(25, Math.max(0.5, (state.vyMps + Math.sqrt(Math.max(0, discriminant))) / g))
  const dt = totalTimeS / steps

  for (let i = 1; i <= steps; i += 1) {
    const t = i * dt
    const px = state.xM + state.vxMps * t
    const py = Math.max(0, state.yM + state.vyMps * t - 0.5 * g * t * t)
    points.push({ xM: px, yM: py })
    if (py <= 0) break
  }
  return points
}

/** Semi-implicit Euler step for 1D vertical ascent. dt is seconds; distances, speeds and forces are SI. */
export function stepFlight(state: FlightState, parameters: FlightParameters, dtSeconds: number): FlightState {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new RangeError('Time step must be a finite positive number of seconds.')
  }
  if (state.status === 'apogee' || state.status === 'impact' || state.status === 'liftoff-failed') return state

  if (state.status === 'ready' && calculateTWR(parameters.thrustN, state.massKg, parameters.gravityMps2) < 1) {
    return { ...state, status: 'liftoff-failed' }
  }

  const fuelToUseKg = Math.min(state.fuelRemainingKg, parameters.fuelFlowKgPerSecond * dtSeconds)
  const thrustFraction =
    parameters.fuelFlowKgPerSecond > 0 ? fuelToUseKg / (parameters.fuelFlowKgPerSecond * dtSeconds) : 0
  const massKg = Math.max(parameters.dryMassKg, state.massKg - fuelToUseKg)
  const thrustN = parameters.thrustN * thrustFraction
  const densityKgM3 =
    parameters.seaLevelAirDensityKgM3 * Math.exp(-Math.max(state.altitudeM, 0) / parameters.atmosphereScaleHeightM)
  const signedDragN =
    0.5 *
    densityKgM3 *
    parameters.dragCoefficient *
    parameters.referenceAreaM2 *
    state.velocityMps *
    Math.abs(state.velocityMps)
  const accelerationMps2 = (thrustN - signedDragN) / massKg - parameters.gravityMps2
  const velocityMps = state.velocityMps + accelerationMps2 * dtSeconds
  const rawAltitudeM = state.altitudeM + velocityMps * dtSeconds
  const altitudeM = Math.max(0, rawAltitudeM)
  const fuelRemainingKg = Math.max(0, state.fuelRemainingKg - fuelToUseKg)
  const status: FlightStatus =
    rawAltitudeM < 0 && velocityMps < 0
      ? 'impact'
      : fuelRemainingKg === 0 && velocityMps <= 0 && altitudeM > 0
        ? 'apogee'
        : 'flying'

  return {
    status,
    altitudeM,
    velocityMps: status === 'impact' || status === 'apogee' ? 0 : velocityMps,
    fuelRemainingKg,
    massKg,
    elapsedTimeS: state.elapsedTimeS + dtSeconds,
    maxAltitudeM: Math.max(state.maxAltitudeM, altitudeM),
    maxSpeedMps: Math.max(state.maxSpeedMps, Math.abs(velocityMps)),
    deltaVUsedMps: state.deltaVUsedMps + (thrustN / massKg) * dtSeconds,
  }
}
