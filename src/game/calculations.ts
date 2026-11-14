import {
  EARTH_LAUNCH_GRAVITY_MPS2,
  LEARNING_CARDS,
  PAD_ABORT_COST_RATIO,
  PAYLOADS,
  STANDARD_GRAVITY_MPS2,
} from './data'
import type {
  AerodynamicStabilityResult,
  ColonyModuleInstance,
  ColonySummary,
  FailureCode,
  FailureStage,
  MissionEvaluation,
  Payload,
  Planet,
  RocketConfiguration,
  TWRStatus,
} from './types'

/** Sums component masses in kilograms (kg), including fuel, payload, and optional fin/landing gear. */
export function calculateTotalMass(
  configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads' | 'fin' | 'landingSystem'>,
): number {
  const masses = [
    configuration.body.dryMassKg,
    configuration.engine.dryMassKg,
    ...(configuration.fuelTank ? [configuration.fuelTank.dryMassKg, configuration.fuelTank.fuelMassKg] : []),
    ...(configuration.fin ? [configuration.fin.dryMassKg] : []),
    ...(configuration.landingSystem ? [configuration.landingSystem.dryMassKg] : []),
    ...configuration.payloads.map((payload) => payload.massKg),
  ]
  if (!masses.every((mass) => Number.isFinite(mass) && mass >= 0)) {
    throw new RangeError('Component masses must be finite and non-negative.')
  }
  return masses.reduce((sum, mass) => sum + mass, 0)
}

/** Sums dry mass in kilograms (kg) after all propellant is burned. */
export function calculateDryMass(
  configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads' | 'fin' | 'landingSystem'>,
): number {
  const dryMasses = [
    configuration.body.dryMassKg,
    configuration.engine.dryMassKg,
    ...(configuration.fuelTank ? [configuration.fuelTank.dryMassKg] : []),
    ...(configuration.fin ? [configuration.fin.dryMassKg] : []),
    ...(configuration.landingSystem ? [configuration.landingSystem.dryMassKg] : []),
    ...configuration.payloads.map((payload) => payload.massKg),
  ]
  if (!dryMasses.every((mass) => Number.isFinite(mass) && mass >= 0)) {
    throw new RangeError('Component dry masses must be finite and non-negative.')
  }
  return dryMasses.reduce((sum, mass) => sum + mass, 0)
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

/** Classifies TWR into educational gauge colors (< 1.0 RED, 1.0–1.19 YELLOW, >= 1.2 GREEN). */
export function getTWRStatus(twr: number): TWRStatus {
  if (twr < 1.0) return 'RED'
  if (twr < 1.2) return 'YELLOW'
  return 'GREEN'
}

/** Sums component prices in game credits; credits are not a real-world currency. */
export function calculateRocketCost(
  configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads' | 'fin' | 'landingSystem'>,
): number {
  const costs = [
    configuration.body.costCredits,
    configuration.engine.costCredits,
    ...(configuration.fuelTank ? [configuration.fuelTank.costCredits] : []),
    ...(configuration.fin ? [configuration.fin.costCredits] : []),
    ...(configuration.landingSystem ? [configuration.landingSystem.costCredits] : []),
    ...configuration.payloads.map((payload) => payload.costCredits),
  ]
  if (!costs.every((cost) => Number.isFinite(cost) && cost >= 0)) {
    throw new RangeError('Component costs must be finite and non-negative.')
  }
  return costs.reduce((sum, cost) => sum + cost, 0)
}

/**
 * Tsiolkovsky Rocket Equation: Δv = Isp × g₀ × ln(m₀ / mf)
 * Uses an educational scale multiplier (1.45) so game-scaled fuel tanks map intuitively to planetary targets.
 */
export function calculateDeltaV(ispSeconds: number, wetMassKg: number, dryMassKg: number): number {
  if (![ispSeconds, wetMassKg, dryMassKg].every(Number.isFinite)) {
    throw new RangeError('Isp, wet mass, and dry mass must be finite numbers.')
  }
  if (ispSeconds < 0 || wetMassKg <= 0 || dryMassKg <= 0 || wetMassKg < dryMassKg) {
    throw new RangeError('Invalid mass ratio or specific impulse for Delta-V.')
  }
  if (wetMassKg === dryMassKg || ispSeconds === 0) {
    return 0
  }
  return Math.round(ispSeconds * STANDARD_GRAVITY_MPS2 * Math.log(wetMassKg / dryMassKg) * 1.45)
}

/**
 * Calculates normalized Center of Mass (CoM - Yellow Circle) and Center of Pressure (CoP - Blue Triangle)
 * along the rocket axis (0 = nose cone tip, 100 = engine nozzle).
 *
 * Stability Rule: Yellow Circle (CoM) must be above/ahead of Blue Triangle (CoP),
 * i.e. `comPosition < copPosition` with at least 2 units of margin.
 */
export function calculateAerodynamicStability(
  configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads' | 'fin' | 'landingSystem'>,
): AerodynamicStabilityResult {
  const baseCoM = configuration.body.baseCoM ?? 46
  const baseCoP = configuration.body.baseCoP ?? 48

  const payloadMass = configuration.payloads.reduce((sum, p) => sum + p.massKg, 0)
  const engineMass = configuration.engine.dryMassKg
  const fuelMass = configuration.fuelTank ? configuration.fuelTank.fuelMassKg + configuration.fuelTank.dryMassKg : 0

  // Heavy engines and heavy lower fuel tanks pull CoM downward; asymmetric payloads also disturb aerodynamic trim
  const enginePullDown = (engineMass / 250) * 1.8
  const fuelPullDown = (fuelMass / 2000) * 2.1
  const payloadTrimShift = (payloadMass / 400) * 1.6

  const comPosition = Math.min(82, Math.max(24, Math.round((baseCoM + enginePullDown + fuelPullDown + payloadTrimShift) * 10) / 10))

  // Without stabilizer fins, payload fairings pull CoP upward toward the nose, causing tumble at T+5s!
  // Adding tail fins pulls CoP downward toward the tail (`copShiftDown`).
  const payloadAeroDragShiftUp = (configuration.payloads.length * 2.5) + (payloadMass / 500) * 1.8
  const finShiftDown = configuration.fin?.copShiftDown ?? 0

  const copPosition = Math.min(88, Math.max(26, Math.round((baseCoP - payloadAeroDragShiftUp + finShiftDown) * 10) / 10))

  const stabilityMargin = Math.round((copPosition - comPosition) * 10) / 10
  const isStable = stabilityMargin >= 2.0

  return {
    comPosition,
    copPosition,
    stabilityMargin,
    isStable,
  }
}

/**
 * Inverse-square law (1/r²) for solar irradiance at a planet's orbital distance in AU.
 * 1.0 AU (Earth/Moon) -> 100%
 * 1.52 AU (Mars)      -> 43.3%
 * 5.20 AU (Europa)    -> 3.7%
 */
export function calculateSolarEfficiencyPercent(distanceAU = 1.0): number {
  if (!Number.isFinite(distanceAU) || distanceAU <= 0) {
    throw new RangeError('Orbital distance in AU must be a positive finite number.')
  }
  const raw = 100 / (distanceAU * distanceAU)
  return Math.round(raw * 10) / 10
}

/** Calculates electrical power output of a single payload on the target planet. */
export function calculatePayloadEnergyOutput(payload: Payload, planet: Planet): number {
  const baseOutput = payload.energyOutputAt1AU ?? 0
  if (baseOutput <= 0) return 0
  if (payload.scalesWithSolarDistance) {
    const efficiency = calculateSolarEfficiencyPercent(planet.distanceAU ?? 1.0) / 100
    return Math.round(baseOutput * efficiency * 10) / 10
  }
  return baseOutput
}

/** Evaluates a planet colony's power balance, blackout state, and per-turn income. */
export function evaluateColony(
  planet: Planet,
  modules: ColonyModuleInstance[],
  catalogPayloads: Payload[] = PAYLOADS,
): ColonySummary {
  const solarEfficiencyPercent = calculateSolarEfficiencyPercent(planet.distanceAU ?? 1.0)

  let energyProduced = 0
  let energyConsumed = 0
  let potentialCredits = 0
  let potentialScience = 0

  for (const mod of modules) {
    const spec = catalogPayloads.find((p) => p.id === mod.payloadId)
    if (!spec) continue
    energyProduced += calculatePayloadEnergyOutput(spec, planet)
    energyConsumed += spec.energyConsumption ?? 0
    potentialCredits += spec.incomeCreditsPerTurn ?? 0
    potentialScience += spec.sciencePerTurn ?? 0
  }

  energyProduced = Math.round(energyProduced * 10) / 10
  energyConsumed = Math.round(energyConsumed * 10) / 10
  const netEnergy = Math.round((energyProduced - energyConsumed) * 10) / 10
  const isBlackout = modules.length > 0 && netEnergy < 0

  return {
    planetId: planet.id,
    solarEfficiencyPercent,
    energyProduced,
    energyConsumed,
    netEnergy,
    isBlackout,
    incomeCreditsPerTurn: isBlackout ? 0 : potentialCredits,
    sciencePerTurn: isBlackout ? 0 : potentialScience,
    moduleCount: modules.length,
  }
}

/**
 * UI-Independent Pure Mission Evaluation Function (`evaluateMission(rocket, planet)`)
 *
 * Evaluates all four stages of a space mission in chronological order:
 * 1. LAUNCHPAD: Fuel tank presence & Earth liftoff TWR >= 1.0
 * 2. ATMOSPHERE: Aerodynamic stability (CoM above CoP) at T+5s max-Q
 * 3. ORBIT: Tsiolkovsky Delta-V >= Planet required Delta-V
 * 4. SURFACE: Atmosphere/vacuum landing system compatibility & target gravity landing TWR
 */
export function evaluateMission(
  configuration: Pick<RocketConfiguration, 'body' | 'engine' | 'fuelTank' | 'payloads' | 'fin' | 'landingSystem'>,
  targetPlanet: Planet,
): MissionEvaluation {
  const totalMassKg = calculateTotalMass(configuration)
  const dryMassKg = calculateDryMass(configuration)
  const fuelMassKg = configuration.fuelTank ? configuration.fuelTank.fuelMassKg : 0
  const totalCostCredits = calculateRocketCost(configuration)
  const padAbortCostCredits = Math.max(15, Math.round(totalCostCredits * PAD_ABORT_COST_RATIO))

  const earthTWR = Math.round(calculateTWR(configuration.engine.thrustN, totalMassKg, EARTH_LAUNCH_GRAVITY_MPS2) * 100) / 100
  const twrStatus = getTWRStatus(earthTWR)

  const targetLandingTWR =
    Math.round(calculateTWR(configuration.engine.thrustN, dryMassKg, targetPlanet.gravityMps2) * 100) / 100

  const ispSeconds = configuration.engine.ispSeconds ?? 320
  const deltaVMps = calculateDeltaV(ispSeconds, totalMassKg, dryMassKg)
  const requiredDeltaVMps = targetPlanet.requiredDeltaVMps ?? 2_000

  const stability = calculateAerodynamicStability(configuration)
  const solarEfficiencyPercent = calculateSolarEfficiencyPercent(targetPlanet.distanceAU ?? 1.0)

  const payloadNetEnergyAtTarget =
    Math.round(
      configuration.payloads.reduce((sum, p) => {
        const out = calculatePayloadEnergyOutput(p, targetPlanet)
        const cons = p.energyConsumption ?? 0
        return sum + (out - cons)
      }, 0) * 10,
    ) / 10

  let failureStage: FailureStage = 'NONE'
  let failureCode: FailureCode = 'NONE'

  // Stage 1: LAUNCHPAD checks
  if (!configuration.fuelTank || fuelMassKg <= 0) {
    failureStage = 'LAUNCHPAD'
    failureCode = 'NO_FUEL_TANK'
  } else if (earthTWR < 1.0) {
    failureStage = 'LAUNCHPAD'
    failureCode = 'LOW_TWR'
  }
  // Stage 2: ATMOSPHERE checks (CoM vs CoP aerodynamic stability)
  else if (!stability.isStable) {
    failureStage = 'ATMOSPHERE'
    failureCode = 'AERODYNAMIC_INSTABILITY'
  }
  // Stage 3: ORBIT checks (Tsiolkovsky Delta-V budget)
  else if (deltaVMps < requiredDeltaVMps) {
    failureStage = 'ORBIT'
    failureCode = 'INSUFFICIENT_DELTA_V'
  }
  // Stage 4: SURFACE checks (Planet atmosphere & gravity vs Landing System)
  else {
    const landingType = configuration.landingSystem?.type ?? 'NONE'
    const atmo = targetPlanet.atmosphereType ?? 'VACUUM'

    if (atmo === 'VACUUM') {
      if (landingType === 'PARACHUTE') {
        failureStage = 'SURFACE'
        failureCode = 'PARACHUTE_IN_VACUUM'
      } else if (landingType === 'NONE' || landingType === 'ORBITAL_RCS') {
        failureStage = 'SURFACE'
        failureCode = 'NO_LANDING_SYSTEM'
      } else if (targetLandingTWR < 0.85) {
        failureStage = 'SURFACE'
        failureCode = 'INSUFFICIENT_LANDING_TWR'
      }
    } else if (atmo === 'THIN') {
      // Mars (0.006 bar): parachute alone crashes; retrorocket without heatshield burns up
      if (landingType === 'PARACHUTE') {
        failureStage = 'SURFACE'
        failureCode = 'MARS_PARACHUTE_ONLY'
      } else if (landingType === 'RETROROCKET') {
        failureStage = 'SURFACE'
        failureCode = 'MARS_NO_HEATSHIELD'
      } else if (landingType !== 'HEATSHIELD_SKYCRANE') {
        failureStage = 'SURFACE'
        failureCode = 'NO_LANDING_SYSTEM'
      } else if (targetLandingTWR < 0.85) {
        failureStage = 'SURFACE'
        failureCode = 'INSUFFICIENT_LANDING_TWR'
      }
    }
  }

  const isSuccess = failureStage === 'NONE'
  const learningCard = isSuccess ? LEARNING_CARDS.SUCCESS : LEARNING_CARDS[failureCode]

  return {
    isSuccess,
    failureStage,
    failureCode,
    totalMassKg,
    dryMassKg,
    fuelMassKg,
    totalCostCredits,
    padAbortCostCredits,
    earthTWR,
    twrStatus,
    targetLandingTWR,
    deltaVMps,
    requiredDeltaVMps,
    stability,
    solarEfficiencyPercent,
    payloadNetEnergyAtTarget,
    learningCard,
  }
}
