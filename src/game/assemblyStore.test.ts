import { afterEach, describe, expect, it } from 'vitest'
import { INITIAL_BUDGET_CREDITS, ROCKET_BODIES, ROCKET_ENGINES } from './data'
import { calculateRocketCost } from './calculations'
import { calculateAssemblyTWR, getRocketConfiguration, isOverBudget, useRocketAssembly } from './assemblyStore'

const initialState = {
  bodyId: ROCKET_BODIES[1]!.id,
  engineId: ROCKET_ENGINES[1]!.id,
  fuelTankId: 'tank-standard',
  payloadIds: [] as ('solar-panel' | 'rover' | 'greenhouse' | 'habitat')[],
}

afterEach(() => {
  useRocketAssembly.setState(initialState)
})

describe('rocket assembly', () => {
  it('adds cargo and increases total mass', () => {
    useRocketAssembly.setState(initialState)
    const before = getRocketConfiguration(useRocketAssembly.getState()).totalMassKg
    expect(useRocketAssembly.getState().addPayload('solar-panel')).toBe(true)
    const after = getRocketConfiguration(useRocketAssembly.getState()).totalMassKg
    expect(after).toBeGreaterThan(before)
    expect(after - before).toBe(180)
  })

  it('updates TWR when the engine changes', () => {
    useRocketAssembly.setState(initialState)
    const before = calculateAssemblyTWR(getRocketConfiguration(useRocketAssembly.getState()))
    useRocketAssembly.getState().selectEngine(ROCKET_ENGINES[2]!.id)
    const after = calculateAssemblyTWR(getRocketConfiguration(useRocketAssembly.getState()))
    expect(after).toBeGreaterThan(before)
  })

  it('does not allow cargo beyond body capacity and trims when choosing a smaller body', () => {
    useRocketAssembly.setState({ ...initialState, bodyId: ROCKET_BODIES[2]!.id })
    const { addPayload, selectBody } = useRocketAssembly.getState()
    expect(addPayload('solar-panel')).toBe(true)
    expect(addPayload('rover')).toBe(true)
    expect(addPayload('greenhouse')).toBe(true)
    expect(addPayload('habitat')).toBe(true)
    expect(addPayload('solar-panel')).toBe(false)
    selectBody(ROCKET_BODIES[0]!.id)
    expect(useRocketAssembly.getState().payloadIds).toHaveLength(1)
  })

  it('detects when the assembly cost exceeds the starting budget without spending it', () => {
    useRocketAssembly.setState({ ...initialState, bodyId: ROCKET_BODIES[2]!.id, engineId: ROCKET_ENGINES[2]!.id, payloadIds: ['rover', 'greenhouse', 'habitat'] })
    const configuration = getRocketConfiguration(useRocketAssembly.getState())
    expect(calculateRocketCost(configuration)).toBeGreaterThan(INITIAL_BUDGET_CREDITS)
    expect(isOverBudget(configuration)).toBe(true)
    expect(configuration.budgetCredits).toBe(INITIAL_BUDGET_CREDITS)
  })

  it('calculates the selected part costs correctly', () => {
    useRocketAssembly.setState(initialState)
    const configuration = getRocketConfiguration(useRocketAssembly.getState())
    expect(calculateRocketCost(configuration)).toBe(540)
  })
})
