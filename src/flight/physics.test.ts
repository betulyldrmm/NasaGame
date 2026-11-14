import { describe, expect, it } from 'vitest'
import { calculateTotalMass } from '../game/calculations'
import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import type { Payload, RocketConfiguration } from '../game/types'
import { createFlightParameters, createFlightState, stepFlight } from './physics'

function makeRocket(bodyIndex = 1, engineIndex = 1, tankIndex: number | null = 1, payloads: Payload[] = []): RocketConfiguration {
  const body = ROCKET_BODIES[bodyIndex]!
  const engine = ROCKET_ENGINES[engineIndex]!
  const fuelTank = tankIndex === null ? null : FUEL_TANKS[tankIndex]!
  return { body, engine, fuelTank, payloads, totalMassKg: calculateTotalMass({ body, engine, fuelTank, payloads }), budgetCredits: 1_000 }
}

describe('vertical flight physics', () => {
  it('cannot lift off when initial TWR is below 1', () => {
    const rocket = makeRocket(2, 0, 0, [PAYLOADS[3]!])
    const next = stepFlight(createFlightState(rocket), createFlightParameters(rocket), 1 / 60)
    expect(next.status).toBe('liftoff-failed')
    expect(next.altitudeM).toBe(0)
  })

  it('accelerates upward when TWR is sufficient', () => {
    const rocket = makeRocket()
    const next = stepFlight(createFlightState(rocket), createFlightParameters(rocket), 1 / 30)
    expect(next.status).toBe('flying')
    expect(next.velocityMps).toBeGreaterThan(0)
    expect(next.altitudeM).toBeGreaterThan(0)
  })

  it('consumes propellant and reduces rocket mass each step', () => {
    const rocket = makeRocket()
    const initial = createFlightState(rocket)
    const next = stepFlight(initial, createFlightParameters(rocket), 0.1)
    expect(next.fuelRemainingKg).toBeLessThan(initial.fuelRemainingKg)
    expect(next.massKg).toBeLessThan(initial.massKg)
    expect(initial.massKg - next.massKg).toBeCloseTo(initial.fuelRemainingKg - next.fuelRemainingKg)
  })

  it('continues through powered ascent and ends at apogee or impact', () => {
    const rocket = makeRocket()
    const parameters = createFlightParameters(rocket)
    let state = createFlightState(rocket)
    for (let frame = 0; frame < 12_000 && (state.status === 'ready' || state.status === 'flying'); frame += 1) {
      state = stepFlight(state, parameters, 1 / 60)
    }
    expect(['apogee', 'impact']).toContain(state.status)
    expect(state.maxAltitudeM).toBeGreaterThan(0)
  })

  it('rejects invalid time steps', () => {
    const rocket = makeRocket()
    expect(() => stepFlight(createFlightState(rocket), createFlightParameters(rocket), 0)).toThrow(RangeError)
  })
})
