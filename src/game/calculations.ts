import type { RocketConfiguration } from './types'

/** Sums component masses in kilograms (kg), including fuel and payload. */
export function calculateTotalMass(configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads'>): number {
  const masses = [
    configuration.body.dryMassKg,
    configuration.engine.dryMassKg,
    ...(configuration.fuelTank ? [configuration.fuelTank.dryMassKg, configuration.fuelTank.fuelMassKg] : []),
    ...configuration.payloads.map((payload) => payload.massKg),
  ]
  if (!masses.every((mass) => Number.isFinite(mass) && mass >= 0)) {
    throw new RangeError('Component masses must be finite and non-negative.')
  }
  return masses.reduce((sum, mass) => sum + mass, 0)
}

/** Thrust-to-weight ratio: thrust in newtons (N) / (mass in kg × gravity in m/s²). */
export function calculateTWR(thrustN: number, totalMassKg: number, gravityMps2: number): number {
  if (![thrustN, totalMassKg, gravityMps2].every(Number.isFinite)) {
    throw new RangeError('Thrust, mass, and gravity must be finite numbers.')
  }
  if (thrustN < 0 || totalMassKg <= 0 || gravityMps2 <= 0) {
    throw new RangeError('Thrust must be non-negative; mass and gravity must be positive.')
  }
  return thrustN / (totalMassKg * gravityMps2)
}

/** Sums component prices in game credits; credits are not a real-world currency. */
export function calculateRocketCost(configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads'>): number {
  const costs = [
    configuration.body.costCredits,
    configuration.engine.costCredits,
    ...(configuration.fuelTank ? [configuration.fuelTank.costCredits] : []),
    ...configuration.payloads.map((payload) => payload.costCredits),
  ]
  if (!costs.every((cost) => Number.isFinite(cost) && cost >= 0)) {
    throw new RangeError('Component costs must be finite and non-negative.')
  }
  return costs.reduce((sum, cost) => sum + cost, 0)
}

/**
 * Calculates Center of Mass (CoM - Yellow Circle) and Center of Pressure (CoP - Blue Triangle)
 * normalized from 0 (nose) to 100 (tail).
 */
export function calculateCoMAndCoP(configuration: RocketConfiguration, hasFins: boolean): {
  comPercent: number
  copPercent: number
  isStable: boolean
} {
  const payloadMass = configuration.payloads.reduce((s, p) => s + p.massKg, 0)
  const fuelMass = configuration.fuelTank?.fuelMassKg ?? 0
  const comPercent = Math.min(76, Math.max(28, Math.round(44 + (fuelMass / 600) * 4 + (payloadMass / 500) * 3)))
  const copPercent = hasFins ? Math.min(86, comPercent + 14) : Math.max(30, comPercent - 8)
  return {
    comPercent,
    copPercent,
    isStable: copPercent > comPercent,
  }
}

/** Inverse-square law (1/r²) solar efficiency percentage. */
export function calculateSolarEfficiency(distanceAU = 1.0): number {
  return Math.round((100 / (distanceAU * distanceAU)) * 10) / 10
}
