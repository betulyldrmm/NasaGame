import { PLANETS } from '../game/data'
import { calculateTWR } from '../game/calculations'
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

export function createFlightParameters(rocket: RocketConfiguration): FlightParameters {
  const fuelKg = rocket.fuelTank?.fuelMassKg ?? 0
  return {
    thrustN: rocket.engine.thrustN,
    fuelFlowKgPerSecond: rocket.engine.fuelConsumptionKgPerSecond,
    dryMassKg: rocket.totalMassKg - fuelKg,
    initialFuelKg: fuelKg,
    gravityMps2: EARTH_LAUNCH_GRAVITY_MPS2,
    dragCoefficient: FLIGHT_GAME_ASSUMPTIONS.dragCoefficient,
    referenceAreaM2: FLIGHT_GAME_ASSUMPTIONS.referenceAreaByCargoSlotsM2[rocket.body.cargoSlots] ?? 0.82,
    seaLevelAirDensityKgM3: FLIGHT_GAME_ASSUMPTIONS.seaLevelAirDensityKgM3,
    atmosphereScaleHeightM: FLIGHT_GAME_ASSUMPTIONS.atmosphereScaleHeightM,
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

/** Ideal rocket-equation capacity using effective exhaust velocity = thrust / assumed mass flow. */
export function calculateDeltaVCapacityMps(rocket: RocketConfiguration): number {
  const fuelKg = rocket.fuelTank?.fuelMassKg ?? 0
  const dryMassKg = rocket.totalMassKg - fuelKg
  if (fuelKg <= 0 || dryMassKg <= 0 || rocket.engine.fuelConsumptionKgPerSecond <= 0) return 0
  const effectiveExhaustVelocityMps = rocket.engine.thrustN / rocket.engine.fuelConsumptionKgPerSecond
  return effectiveExhaustVelocityMps * Math.log(rocket.totalMassKg / dryMassKg)
}

/** Semi-implicit Euler step for 1D vertical ascent. dt is seconds; distances, speeds and forces are SI. */
export function stepFlight(state: FlightState, parameters: FlightParameters, dtSeconds: number): FlightState {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) throw new RangeError('Time step must be a finite positive number of seconds.')
  if (state.status === 'apogee' || state.status === 'impact' || state.status === 'liftoff-failed') return state

  if (state.status === 'ready' && calculateTWR(parameters.thrustN, state.massKg, parameters.gravityMps2) < 1) {
    return { ...state, status: 'liftoff-failed' }
  }

  const fuelToUseKg = Math.min(state.fuelRemainingKg, parameters.fuelFlowKgPerSecond * dtSeconds)
  const thrustFraction = parameters.fuelFlowKgPerSecond > 0
    ? fuelToUseKg / (parameters.fuelFlowKgPerSecond * dtSeconds)
    : 0
  const massKg = Math.max(parameters.dryMassKg, state.massKg - fuelToUseKg)
  const thrustN = parameters.thrustN * thrustFraction
  const densityKgM3 = parameters.seaLevelAirDensityKgM3 * Math.exp(-Math.max(state.altitudeM, 0) / parameters.atmosphereScaleHeightM)
  const signedDragN = 0.5 * densityKgM3 * parameters.dragCoefficient * parameters.referenceAreaM2
    * state.velocityMps * Math.abs(state.velocityMps)
  const accelerationMps2 = (thrustN - signedDragN) / massKg - parameters.gravityMps2
  const velocityMps = state.velocityMps + accelerationMps2 * dtSeconds
  const rawAltitudeM = state.altitudeM + velocityMps * dtSeconds
  const altitudeM = Math.max(0, rawAltitudeM)
  const fuelRemainingKg = Math.max(0, state.fuelRemainingKg - fuelToUseKg)
  const status: FlightStatus = rawAltitudeM < 0 && velocityMps < 0
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
