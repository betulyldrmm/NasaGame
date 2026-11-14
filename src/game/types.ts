/** Game-facing quantities use SI units unless the property name says otherwise. */
export interface RocketBody {
  id: string
  name: string
  cargoSlots: number
  dryMassKg: number
  costCredits: number
}

export interface RocketEngine {
  id: string
  name: string
  thrustN: number
  /** Assumed propellant mass flow in kilograms per second (kg/s); a game input, not measured engine data. */
  fuelConsumptionKgPerSecond: number
  dryMassKg: number
  costCredits: number
}

export interface FuelTank {
  id: string
  name: string
  fuelMassKg: number
  dryMassKg: number
  costCredits: number
}

export type PayloadId = 'solar-panel' | 'rover' | 'greenhouse' | 'habitat'

export interface Payload {
  id: PayloadId
  name: string
  massKg: number
  costCredits: number
}

export interface Planet {
  id: string
  name: string
  /** Surface gravitational acceleration in metres per second squared (m/s²). */
  gravityMps2: number
  /** Distance from Sun in AU (for 1/r² solar power). */
  distanceAU?: number
}

export interface Mission {
  id: string
  name: string
  destinationPlanetId: string
  rewardCredits: number
}

export interface RocketConfiguration {
  body: RocketBody
  engine: RocketEngine
  fuelTank: FuelTank | null
  payloads: Payload[]
  /** Total mass including structure, engine, fuel and payload, in kilograms (kg). */
  totalMassKg: number
  budgetCredits: number
}
