import { describe, expect, it } from 'vitest'
import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import { getRocketModelSpec } from './rocketModel'

describe('2.5D rocket model mapping', () => {
  it('maps body size and cargo capacity to distinct model proportions', () => {
    const scout = getRocketModelSpec(ROCKET_BODIES[0]!, ROCKET_ENGINES[0]!, null, [])
    const carrier = getRocketModelSpec(ROCKET_BODIES[2]!, ROCKET_ENGINES[0]!, null, [])
    expect(carrier.bodyLength).toBeGreaterThan(scout.bodyLength)
    expect(carrier.bodyRadius).toBeGreaterThan(scout.bodyRadius)
  })

  it('updates engine geometry when the selected motor changes', () => {
    const small = getRocketModelSpec(ROCKET_BODIES[0]!, ROCKET_ENGINES[0]!, null, [])
    const large = getRocketModelSpec(ROCKET_BODIES[0]!, ROCKET_ENGINES[2]!, null, [])
    expect(large.engineRadius).toBeGreaterThan(small.engineRadius)
    expect(large.engineLength).toBeGreaterThan(small.engineLength)
  })

  it('scales the fuel section with tank choice and positions no more cargo than available slots', () => {
    const body = ROCKET_BODIES[0]!
    const compact = getRocketModelSpec(body, ROCKET_ENGINES[0]!, FUEL_TANKS[0]!, [PAYLOADS[0]!, PAYLOADS[1]!])
    const extended = getRocketModelSpec(body, ROCKET_ENGINES[0]!, FUEL_TANKS[2]!, [PAYLOADS[0]!, PAYLOADS[1]!])
    expect(extended.tankLength).toBeGreaterThan(compact.tankLength)
    expect(compact.payloads).toHaveLength(body.cargoSlots)
    expect(compact.payloads[0]?.color).toBe('#38d9e8')
  })
})
