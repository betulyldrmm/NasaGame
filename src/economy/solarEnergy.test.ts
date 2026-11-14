import { describe, expect, it } from 'vitest'
import { PLANETARY_REFERENCE } from '../data/planetaryReference'
import { calculateSolarEnergyPerTurn } from './solarEnergy'

describe('NASA-irradiance-driven colony solar model', () => {
  it('scales the game output by the verified Earth/Mars irradiance ratio', () => {
    const earth = calculateSolarEnergyPerTurn(2, 'moon')
    const mars = calculateSolarEnergyPerTurn(2, 'mars')
    expect(earth).toBe(40)
    expect(mars).toBeCloseTo(40 * PLANETARY_REFERENCE.solarIrradiance.mars.valueWm2 / PLANETARY_REFERENCE.solarIrradiance.earth.valueWm2)
    expect(mars).toBeLessThan(earth)
  })

  it('rejects negative panel counts', () => {
    expect(() => calculateSolarEnergyPerTurn(-1, 'mars')).toThrow(RangeError)
  })
})
