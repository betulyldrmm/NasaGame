import { describe, expect, it } from 'vitest'
import { calculateRocketCost, calculateTotalMass, calculateTWR } from './calculations'
import type { RocketConfiguration } from './types'

const configuration: RocketConfiguration = {
  body: { id: 'body', name: 'Test body', cargoSlots: 1, dryMassKg: 800, costCredits: 120 },
  engine: { id: 'engine', name: 'Test engine', thrustN: 30_000, dryMassKg: 250, costCredits: 100 },
  fuelTank: { id: 'tank', name: 'Test tank', fuelMassKg: 500, dryMassKg: 100, costCredits: 50 },
  payloads: [{ id: 'solar-panel', name: 'Test payload', massKg: 150, costCredits: 75 }],
  totalMassKg: 0,
  budgetCredits: 1_000,
}

describe('rocket calculations', () => {
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
