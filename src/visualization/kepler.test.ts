import { describe, expect, it } from 'vitest'
import { PLANETARY_REFERENCE, validatePlanetaryReference } from '../data/planetaryReference'
import { calculateHeliocentricPosition, solveKeplerEquation } from './kepler'

describe('JPL-backed Kepler display data', () => {
  it('validates bundled orbit and irradiance records', () => {
    expect(() => validatePlanetaryReference(PLANETARY_REFERENCE)).not.toThrow()
    expect(PLANETARY_REFERENCE.orbitFrame.origin).toBe('Sun (10)')
    expect(PLANETARY_REFERENCE.orbitEpoch.timeScale).toBe('TDB')
  })

  it('rejects missing scientific units and non-elliptic eccentricity', () => {
    expect(() => validatePlanetaryReference({ schemaVersion: 1 })).toThrow(/retrievedAt/i)
    const invalidReference = structuredClone(PLANETARY_REFERENCE)
    invalidReference.orbitFrame.distanceUnit = 'km' as 'au'
    expect(() => validatePlanetaryReference(invalidReference)).toThrow(/distanceUnit/i)
    expect(() => solveKeplerEquation(0, 1)).toThrow(RangeError)
  })

  it('produces a position within each orbit perihelion and aphelion at the reference epoch', () => {
    for (const orbit of Object.values(PLANETARY_REFERENCE.orbits)) {
      const position = calculateHeliocentricPosition(orbit, 0)
      expect(position.radiusAu).toBeGreaterThanOrEqual(orbit.semiMajorAxisAu * (1 - orbit.eccentricity) - 1e-10)
      expect(position.radiusAu).toBeLessThanOrEqual(orbit.semiMajorAxisAu * (1 + orbit.eccentricity) + 1e-10)
      expect(position.xAu ** 2 + position.yAu ** 2 + position.zAu ** 2).toBeCloseTo(position.radiusAu ** 2, 9)
    }
  })
})
