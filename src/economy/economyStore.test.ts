import { describe, expect, it } from 'vitest'
import { calculateTotalMass } from '../game/calculations'
import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import type { RocketConfiguration } from '../game/types'
import { evaluateMission, MISSION_DESTINATIONS, type MissionEvaluation } from '../flight/mission'
import { createFlightState, stepFlight } from '../flight/physics'
import { createFlightParameters } from '../flight/physics'
import { ECONOMY_ASSUMPTIONS } from './economy'
import { createEconomyStore } from './economyStore'
import type { StateStorage } from 'zustand/middleware'

function makeRocket(payloadIndexes: number[] = []): RocketConfiguration {
  const body = ROCKET_BODIES[1]!
  const engine = ROCKET_ENGINES[1]!
  const fuelTank = FUEL_TANKS[2]!
  const payloads = payloadIndexes.map((index) => PAYLOADS[index]!)
  return { body, engine, fuelTank, payloads, totalMassKg: calculateTotalMass({ body, engine, fuelTank, payloads }), budgetCredits: 1_000 }
}

const successEvaluation = { success: true, metrics: {} } as MissionEvaluation
const failedEvaluation = { success: false, metrics: {}, failureReasons: ['test'], learningCards: [] } as unknown as MissionEvaluation

function simulateFlight(rocket: RocketConfiguration) {
  const parameters = createFlightParameters(rocket)
  let flight = createFlightState(rocket)
  for (let step = 0; step < 10_000 && !['apogee', 'impact', 'liftoff-failed'].includes(flight.status); step += 1) {
    flight = stepFlight(flight, parameters, 1 / 60)
  }
  return flight
}

function createMemoryStorage(): StateStorage {
  const values = new Map<string, string>()
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => { values.set(name, value) },
    removeItem: (name) => { values.delete(name) },
  }
}

describe('persisted mission economy', () => {
  it('charges production cost once and refunds all but 15% for pad cancellation', () => {
    const store = createEconomyStore(createMemoryStorage())
    const rocket = makeRocket()
    const input = { id: 'pad-cancel', destination: MISSION_DESTINATIONS[0]!, rocket, landingEquipment: { parachute: false, heatShield: false, poweredDescent: true } }
    expect(store.getState().beginMission(input)).toBe('started')
    const cost = store.getState().missions[0]!.costCredits
    expect(store.getState().balanceCredits).toBe(1_000 - cost)
    expect(store.getState().cancelMissionAtPad(input.id, failedEvaluation)).toBe(true)
    expect(store.getState().balanceCredits).toBe(1_000 - Math.round(cost * 0.15))
    expect(store.getState().missions[0]?.status).toBe('cancelled')
    expect(store.getState().missions[0]?.refundCredits).toBe(cost - Math.round(cost * 0.15))
    expect(store.getState().cancelMissionAtPad(input.id, failedEvaluation)).toBe(false)
  })

  it('does not refund a failed in-flight rocket or award it success bonuses', () => {
    const store = createEconomyStore(createMemoryStorage())
    const rocket = makeRocket()
    const input = { id: 'lost-flight', destination: MISSION_DESTINATIONS[0]!, rocket, landingEquipment: { parachute: false, heatShield: false, poweredDescent: true } }
    store.getState().beginMission(input)
    const cost = store.getState().missions[0]!.costCredits
    expect(store.getState().markMissionLaunched(input.id, createFlightState(rocket))).toBe(true)
    expect(store.getState().settleFlightMission(input.id, failedEvaluation, { ...createFlightState(rocket), status: 'impact' })).toBe(true)
    expect(store.getState().balanceCredits).toBe(1_000 - cost)
    expect(store.getState().sciencePoints).toBe(0)
    expect(store.getState().missions[0]?.status).toBe('failed')
    expect(store.getState().settleFlightMission(input.id, successEvaluation, createFlightState(rocket))).toBe(false)
  })

  it('awards successful cargo, credits and science once, then produces colony resources', () => {
    const store = createEconomyStore(createMemoryStorage())
    const rocket = makeRocket([0, 2])
    const input = { id: 'success', destination: MISSION_DESTINATIONS[0]!, rocket, landingEquipment: { parachute: false, heatShield: false, poweredDescent: true } }
    expect(store.getState().beginMission(input)).toBe('started')
    store.getState().markMissionLaunched(input.id, createFlightState(rocket))
    const beforeSettle = store.getState().balanceCredits
    const flight = simulateFlight(rocket)
    const evaluation = evaluateMission(rocket, input.destination, { landingEquipment: input.landingEquipment }, flight)
    expect(flight.status).toBe('apogee')
    expect(evaluation.success).toBe(true)
    expect(store.getState().settleFlightMission(input.id, evaluation, flight)).toBe(true)
    expect(store.getState().balanceCredits).toBe(beforeSettle + ECONOMY_ASSUMPTIONS.successCredits)
    expect(store.getState().sciencePoints).toBe(ECONOMY_ASSUMPTIONS.successScience)
    expect(store.getState().bases.moon.resources).toEqual({ energy: 14, minerals: 0, food: 8 })
    expect(store.getState().bases.moon.lastTurnEnergyProduced).toBe(20)
    expect(store.getState().bases.moon.deliveredModules).toEqual(['solar-panel', 'greenhouse'])
    expect(store.getState().settleFlightMission(input.id, evaluation, flight)).toBe(false)
    expect(store.getState().sciencePoints).toBe(150)
  })

  it('blocks unaffordable or overlapping missions and provides one small grant at zero balance', () => {
    const store = createEconomyStore(createMemoryStorage())
    const rocket = makeRocket()
    const input = { id: 'first', destination: MISSION_DESTINATIONS[0]!, rocket, landingEquipment: { parachute: false, heatShield: false, poweredDescent: true } }
    expect(store.getState().beginMission(input)).toBe('started')
    expect(store.getState().beginMission({ ...input, id: 'overlap' })).toBe('mission-active')
    store.setState({ activeMissionId: null, balanceCredits: 0 })
    expect(store.getState().beginMission({ ...input, id: 'poor' })).toBe('insufficient-funds')
    expect(store.getState().claimResearchSupport()).toBe(true)
    expect(store.getState().balanceCredits).toBe(ECONOMY_ASSUMPTIONS.researchSupportCredits)
    expect(store.getState().claimResearchSupport()).toBe(false)
  })

  it('persists balances and mission records between store instances', async () => {
    const storage = createMemoryStorage()
    const first = createEconomyStore(storage)
    const rocket = makeRocket()
    first.getState().beginMission({ id: 'persist', destination: MISSION_DESTINATIONS[1]!, rocket, landingEquipment: { parachute: true, heatShield: true, poweredDescent: true } })
    const reloaded = createEconomyStore(storage)
    await reloaded.persist.rehydrate()
    expect(reloaded.getState().balanceCredits).toBe(1_000 - first.getState().missions[0]!.costCredits)
    expect(reloaded.getState().activeMissionId).toBe('persist')
    expect(reloaded.getState().missions[0]?.rocketConfiguration.body.id).toBe(rocket.body.id)
  })
})
