import { describe, expect, it } from 'vitest'
import {
  calculateAerodynamicStability,
  calculateDeltaV,
  calculateRocketCost,
  calculateSolarEfficiencyPercent,
  calculateTotalMass,
  calculateTWR,
  evaluateColony,
  evaluateMission,
  getTWRStatus,
} from './calculations'
import { AERODYNAMIC_FINS, FUEL_TANKS, LANDING_SYSTEMS, PAYLOADS, PLANETS, ROCKET_BODIES, ROCKET_ENGINES } from './data'
import type { RocketConfiguration } from './types'

const configuration: RocketConfiguration = {
  body: { id: 'body', name: 'Test body', cargoSlots: 1, dryMassKg: 800, costCredits: 120 },
  engine: { id: 'engine', name: 'Test engine', thrustN: 30_000, dryMassKg: 250, costCredits: 100 },
  fuelTank: { id: 'tank', name: 'Test tank', fuelMassKg: 500, dryMassKg: 100, costCredits: 50 },
  payloads: [{ id: 'payload', name: 'Test payload', massKg: 150, costCredits: 75 }],
  totalMassKg: 0,
  budgetCredits: 1_000,
}

describe('rocket calculations (Phase 1 core)', () => {
  it('sums dry mass, fuel, and payload mass in kg', () => {
    expect(calculateTotalMass(configuration)).toBe(1_800)
  })

  it('handles optional components and rejects invalid mass values', () => {
    expect(calculateTotalMass({ ...configuration, fuelTank: null, payloads: [] })).toBe(1_050)
    expect(() => calculateTotalMass({ ...configuration, payloads: [{ ...configuration.payloads[0]!, massKg: -1 }] })).toThrow(RangeError)
    expect(() => calculateTotalMass({ ...configuration, fuelTank: { ...configuration.fuelTank!, fuelMassKg: Number.NaN } })).toThrow(RangeError)
  })

  it('calculates TWR from N, kg, and m/s²', () => {
    expect(calculateTWR(30_000, 1_000, 10)).toBe(3)
  })

  it('returns zero TWR for a zero-thrust engine', () => {
    expect(calculateTWR(0, 1_000, 9.81)).toBe(0)
  })

  it('rejects non-positive mass or gravity, negative thrust, and non-finite values', () => {
    expect(() => calculateTWR(-1, 1, 1)).toThrow(RangeError)
    expect(() => calculateTWR(1, 0, 1)).toThrow(RangeError)
    expect(() => calculateTWR(1, 1, 0)).toThrow(RangeError)
    expect(() => calculateTWR(Number.NaN, 1, 1)).toThrow(RangeError)
  })

  it('sums body, engine, tank, and payload prices in credits', () => {
    expect(calculateRocketCost(configuration)).toBe(345)
  })

  it('handles no tank and no payloads', () => {
    expect(calculateTotalMass({ ...configuration, fuelTank: null, payloads: [] })).toBe(1_050)
    expect(calculateRocketCost({ ...configuration, fuelTank: null, payloads: [] })).toBe(220)
  })

  it('rejects invalid component prices', () => {
    expect(() => calculateRocketCost({ ...configuration, payloads: [{ ...configuration.payloads[0]!, costCredits: -1 }] })).toThrow(RangeError)
  })
})

describe('advanced physics & educational mechanics (Phase 2)', () => {
  it('classifies TWR status into RED (<1.0), YELLOW (1.0-1.19), and GREEN (>=1.2)', () => {
    expect(getTWRStatus(0.85)).toBe('RED')
    expect(getTWRStatus(1.0)).toBe('YELLOW')
    expect(getTWRStatus(1.15)).toBe('YELLOW')
    expect(getTWRStatus(1.2)).toBe('GREEN')
    expect(getTWRStatus(1.85)).toBe('GREEN')
  })

  it('calculates Tsiolkovsky Delta-V and increases with higher Isp or fuel fraction', () => {
    const dvLowIsp = calculateDeltaV(300, 4_000, 1_500)
    const dvHighIsp = calculateDeltaV(450, 4_000, 1_500)
    expect(dvHighIsp).toBeGreaterThan(dvLowIsp)
    expect(calculateDeltaV(350, 1_500, 1_500)).toBe(0)
  })

  it('enforces CoM (Yellow Circle) vs CoP (Blue Triangle) stability with fins', () => {
    const unstableConfig = {
      body: ROCKET_BODIES[1]!,
      engine: ROCKET_ENGINES[1]!,
      fuelTank: FUEL_TANKS[1]!,
      payloads: [PAYLOADS[0]!, PAYLOADS[1]!],
      fin: AERODYNAMIC_FINS[0]!, // fin-none
    }
    const stableConfig = {
      ...unstableConfig,
      fin: AERODYNAMIC_FINS[2]!, // fin-grid
    }
    const resUnstable = calculateAerodynamicStability(unstableConfig)
    const resStable = calculateAerodynamicStability(stableConfig)

    expect(resUnstable.isStable).toBe(false)
    expect(resStable.isStable).toBe(true)
    expect(resStable.copPosition).toBeGreaterThan(resUnstable.copPosition)
  })

  it('computes 1/r² solar irradiance efficiency accurately for Earth/Moon (1 AU), Mars (1.52 AU), and Europa (5.2 AU)', () => {
    expect(calculateSolarEfficiencyPercent(1.0)).toBe(100)
    expect(calculateSolarEfficiencyPercent(1.52)).toBeCloseTo(43.3, 1)
    expect(calculateSolarEfficiencyPercent(5.2)).toBeCloseTo(3.7, 1)
  })

  it('triggers LAUNCHPAD failure (LOW_TWR) with 15% pad abort cost when heavy rocket uses weak engine', () => {
    const moon = PLANETS.find((p) => p.id === 'moon')!
    const heavyRocket = {
      body: ROCKET_BODIES[2]!, // Carrier 3000kg
      engine: ROCKET_ENGINES[0]!, // Spark 30,000N
      fuelTank: FUEL_TANKS[1]!,
      payloads: [PAYLOADS[2]!],
      fin: AERODYNAMIC_FINS[1]!,
      landingSystem: LANDING_SYSTEMS[2]!,
    }
    const evalResult = evaluateMission(heavyRocket, moon)
    expect(evalResult.isSuccess).toBe(false)
    expect(evalResult.failureStage).toBe('LAUNCHPAD')
    expect(evalResult.failureCode).toBe('LOW_TWR')
    expect(evalResult.padAbortCostCredits).toBe(Math.round(evalResult.totalCostCredits * 0.15))
  })

  it('triggers SURFACE failure (PARACHUTE_IN_VACUUM) when landing on Moon with a parachute', () => {
    const moon = PLANETS.find((p) => p.id === 'moon')!
    const moonParachuteRocket = {
      body: ROCKET_BODIES[0]!,
      engine: ROCKET_ENGINES[1]!,
      fuelTank: FUEL_TANKS[1]!,
      payloads: [PAYLOADS[0]!],
      fin: AERODYNAMIC_FINS[1]!,
      landingSystem: LANDING_SYSTEMS[1]!, // Parachute
    }
    const evalResult = evaluateMission(moonParachuteRocket, moon)
    expect(evalResult.isSuccess).toBe(false)
    expect(evalResult.failureStage).toBe('SURFACE')
    expect(evalResult.failureCode).toBe('PARACHUTE_IN_VACUUM')
  })

  it('triggers SURFACE failure on Mars unless Heat Shield + Skycrane is equipped', () => {
    const mars = PLANETS.find((p) => p.id === 'mars')!
    const marsRocketBase = {
      body: ROCKET_BODIES[0]!,
      engine: ROCKET_ENGINES[2]!, // Titan 150kN, Isp 410
      fuelTank: FUEL_TANKS[2]!, // Large tank
      payloads: [PAYLOADS[0]!],
      fin: AERODYNAMIC_FINS[2]!,
    }

    const withParachute = evaluateMission({ ...marsRocketBase, landingSystem: LANDING_SYSTEMS[1]! }, mars)
    expect(withParachute.failureStage).toBe('SURFACE')
    expect(withParachute.failureCode).toBe('MARS_PARACHUTE_ONLY')

    const withBareRetro = evaluateMission({ ...marsRocketBase, landingSystem: LANDING_SYSTEMS[2]! }, mars)
    expect(withBareRetro.failureStage).toBe('SURFACE')
    expect(withBareRetro.failureCode).toBe('MARS_NO_HEATSHIELD')

    const withSkycrane = evaluateMission({ ...marsRocketBase, landingSystem: LANDING_SYSTEMS[3]! }, mars)
    expect(withSkycrane.isSuccess).toBe(true)
    expect(withSkycrane.failureStage).toBe('NONE')
  })

  it('evaluates colony energy balance and triggers Blackout on Europa if using Solar Panel instead of RTG', () => {
    const europa = PLANETS.find((p) => p.id === 'europa')!
    const solarPlusRover = [
      { instanceId: '1', payloadId: 'solar-panel', name: 'Güneş Paneli', category: 'ENERGY_SOLAR' as const, layer: 'SURFACE_ARRAY' as const, slotIndex: 0, installedTurn: 1 },
      { instanceId: '2', payloadId: 'rover', name: 'Maden Aracı', category: 'MINING' as const, layer: 'UNDERGROUND_MINE' as const, slotIndex: 0, installedTurn: 1 },
    ]
    const blackoutSummary = evaluateColony(europa, solarPlusRover)
    // On Europa (5.2 AU), solar panel yields 3.7 energy, rover consumes 30 -> net -26.3 -> BLACKOUT!
    expect(blackoutSummary.isBlackout).toBe(true)
    expect(blackoutSummary.incomeCreditsPerTurn).toBe(0)

    const rtgPlusRover = [
      { instanceId: '1', payloadId: 'rtg-generator', name: 'RTG', category: 'ENERGY_RTG' as const, layer: 'SURFACE_ARRAY' as const, slotIndex: 0, installedTurn: 1 },
      { instanceId: '2', payloadId: 'rover', name: 'Maden Aracı', category: 'MINING' as const, layer: 'UNDERGROUND_MINE' as const, slotIndex: 0, installedTurn: 1 },
    ]
    const poweredSummary = evaluateColony(europa, rtgPlusRover)
    expect(poweredSummary.isBlackout).toBe(false)
    expect(poweredSummary.netEnergy).toBe(100)
    expect(poweredSummary.incomeCreditsPerTurn).toBeGreaterThan(0)
  })
})
