import { describe, expect, it } from 'vitest'
import { calculateTotalMass } from '../game/calculations'
import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import type { Payload, RocketConfiguration } from '../game/types'
import { MISSION_DESTINATIONS, evaluateMission, type LandingEquipment } from './mission'
import { calculateDeltaVCapacityMps } from './physics'

function makeRocket(bodyIndex = 1, engineIndex = 2, tankIndex: number | null = 2, payloads: Payload[] = []): RocketConfiguration {
  const body = ROCKET_BODIES[bodyIndex]!
  const engine = ROCKET_ENGINES[engineIndex]!
  const fuelTank = tankIndex === null ? null : FUEL_TANKS[tankIndex]!
  return { body, engine, fuelTank, payloads, totalMassKg: calculateTotalMass({ body, engine, fuelTank, payloads }), budgetCredits: 1_000 }
}

const safeLanding: LandingEquipment = { parachute: true, heatShield: true, poweredDescent: true }

describe('mission evaluation', () => {
  it('fails an underpowered launch', () => {
    const result = evaluateMission(makeRocket(2, 0, 0, [PAYLOADS[3]!]), MISSION_DESTINATIONS[0]!, { landingEquipment: safeLanding })
    expect(result.success).toBe(false)
    expect(result.failureReasons.some((reason) => reason.includes('ağırlığını yenemedi'))).toBe(true)
  })

  it('reports insufficient Delta-V capacity', () => {
    const result = evaluateMission(makeRocket(0, 0, null), MISSION_DESTINATIONS[0]!, { landingEquipment: safeLanding })
    expect(result.metrics.deltaVCapacityMps).toBe(0)
    expect(result.failureReasons.some((reason) => reason.includes('manevra kapasitesi'))).toBe(true)
  })

  it('rejects parachute-only lunar landing and explains the absent atmosphere', () => {
    const result = evaluateMission(makeRocket(), MISSION_DESTINATIONS[0]!, {
      landingEquipment: { parachute: true, heatShield: false, poweredDescent: false },
    })
    expect(result.success).toBe(false)
    expect(result.failureReasons.some((reason) => reason.includes('Ay’da anlamlı bir atmosfer olmadığı'))).toBe(true)
  })

  it('rejects a Mars landing without a heat shield and powered braking', () => {
    const result = evaluateMission(makeRocket(), MISSION_DESTINATIONS[1]!, {
      landingEquipment: { parachute: true, heatShield: false, poweredDescent: false },
    })
    expect(result.failureReasons.some((reason) => reason.includes('ısı kalkanı'))).toBe(true)
    expect(result.failureReasons.some((reason) => reason.includes('motorlu frenleme'))).toBe(true)
  })

  it('returns success for a suitable rocket and landing equipment', () => {
    const rocket = makeRocket()
    expect(calculateDeltaVCapacityMps(rocket)).toBeGreaterThan(MISSION_DESTINATIONS[1]!.requiredDeltaVms)
    const result = evaluateMission(rocket, MISSION_DESTINATIONS[1]!, { landingEquipment: safeLanding })
    expect(result.success).toBe(true)
    expect(result.failureReasons).toHaveLength(0)
    expect(result.metrics.destinationGravityMps2).toBe(MISSION_DESTINATIONS[1]!.gravityMps2)
    expect(result.learningCards).toHaveLength(3)
  })
})
