import { describe, expect, it } from 'vitest'
import { calculateTotalMass } from '../game/calculations'
import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import type { Payload, RocketConfiguration } from '../game/types'
import {
  computeLandingGuidance,
  createFlightParameters,
  createFlightState,
  createRigidBody2DState,
  predictBallisticArc2D,
  stepFlight,
  stepRigidBody2D,
} from './physics'

function makeRocket(
  bodyIndex = 1,
  engineIndex = 1,
  tankIndex: number | null = 1,
  payloads: Payload[] = [],
): RocketConfiguration {
  const body = ROCKET_BODIES[bodyIndex]!
  const engine = ROCKET_ENGINES[engineIndex]!
  const fuelTank = tankIndex === null ? null : FUEL_TANKS[tankIndex]!
  return {
    body,
    engine,
    fuelTank,
    payloads,
    totalMassKg: calculateTotalMass({ body, engine, fuelTank, payloads }),
    budgetCredits: 1_000,
  }
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

describe('2D rigid-body physics engine (SFS launch & landing)', () => {
  it('applies rotational torque and thrust vectoring when steering left or right', () => {
    const rocket = makeRocket()
    const params = createFlightParameters(rocket, { hasFins: true, planetId: 'moon' })
    let rb = createRigidBody2DState(rocket, { status: 'flying', yM: 300, vyMps: -10 })
    for (let i = 0; i < 30; i += 1) {
      rb = stepRigidBody2D(rb, params, { throttle: 0.8, steerInput: 1 }, 1 / 60)
    }
    expect(rb.angleRad).toBeGreaterThan(0.02)
    expect(rb.vxMps).toBeGreaterThan(0)
  })

  it('induces aerodynamic instability and breakup when stabilizer fins are missing', () => {
    const rocket = makeRocket(1, 2, 1) // High thrust engine without fins
    const paramsNoFins = createFlightParameters(rocket, { hasFins: false, planetId: 'earth' })
    expect(paramsNoFins.staticMargin).toBeLessThan(0)
    let rb = createRigidBody2DState(rocket)
    for (let i = 0; i < 600 && rb.status === 'flying' || rb.status === 'ready'; i += 1) {
      rb = stepRigidBody2D(rb, paramsNoFins, { throttle: 1, steerInput: 0 }, 1 / 60)
      if (rb.status === 'aerodynamic-breakup') break
    }
    expect(rb.status).toBe('aerodynamic-breakup')
  })

  it('guides the lander smoothly to a soft touchdown (< 8.5 m/s) with the PD auto-pilot', () => {
    const rocket = makeRocket(1, 1, 1)
    const params = createFlightParameters(rocket, { hasFins: true, planetId: 'moon' })
    let rb = createRigidBody2DState(rocket, {
      status: 'flying',
      xM: 42,
      yM: 360,
      vxMps: -4,
      vyMps: -22,
      angleRad: -0.1,
    })
    for (let i = 0; i < 3600 && rb.status === 'flying'; i += 1) {
      const guidance = computeLandingGuidance(rb, params)
      rb = stepRigidBody2D(
        rb,
        params,
        {
          throttle: guidance.throttle,
          steerInput: guidance.steerInput,
          poweredDescentEnabled: true,
        },
        1 / 60,
      )
    }
    expect(rb.status).toBe('landed')
    expect(Math.abs(rb.xM)).toBeLessThan(20)
  })

  it('computes a valid 2D ballistic trajectory arc to the ground', () => {
    const rocket = makeRocket()
    const rb = createRigidBody2DState(rocket, { status: 'flying', xM: 20, yM: 200, vxMps: -5, vyMps: -15 })
    const arc = predictBallisticArc2D(rb, 1.62, 16)
    expect(arc.length).toBeGreaterThan(2)
    expect(arc[arc.length - 1]!.yM).toBe(0)
  })
})
