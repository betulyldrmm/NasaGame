import { afterEach, describe, expect, it } from 'vitest'
import { INITIAL_BUDGET_CREDITS, ROCKET_BODIES, ROCKET_ENGINES } from './data'
import { calculateRocketCost } from './calculations'
import { calculateAssemblyTWR, getRocketConfiguration, isOverBudget, useRocketAssembly } from './assemblyStore'

const initialState = {
  bodyId: ROCKET_BODIES[1]!.id,
  engineId: ROCKET_ENGINES[1]!.id,
  fuelTankId: 'tank-standard',
  payloadIds: [] as ('solar-panel' | 'rover' | 'greenhouse' | 'habitat')[],
  budgetCredits: INITIAL_BUDGET_CREDITS,
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
    useRocketAssembly.setState({
      ...initialState,
      bodyId: ROCKET_BODIES[2]!.id,
      engineId: ROCKET_ENGINES[2]!.id,
      payloadIds: ['rover', 'greenhouse', 'habitat'],
    })
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

describe('2D colony sandbox rules', () => {
  it('enforces layer placement rules, protects the rocket pad, and prevents empty demolish exploit', () => {
    const store = useRocketAssembly.getState()
    // Solar cannot be placed underground (row 4)
    expect(store.placeColonyTile('moon', 4, 4, 'solar').ok).toBe(false)
    // Drill cannot be placed in sky (row 0)
    expect(store.placeColonyTile('moon', 0, 5, 'drill').ok).toBe(false)
    // Rocket pad at [2][1] is protected
    expect(store.placeColonyTile('moon', 2, 1, 'hull').ok).toBe(false)
    // Cannot demolish an already empty tile for free credits
    expect(store.placeColonyTile('moon', 0, 0, 'empty').ok).toBe(false)

    // Valid build on surface + 50% salvage demolish refund
    const startBudget = useRocketAssembly.getState().budgetCredits
    expect(useRocketAssembly.getState().placeColonyTile('moon', 1, 5, 'solar').ok).toBe(true)
    expect(useRocketAssembly.getState().budgetCredits).toBe(startBudget - 60)
    expect(useRocketAssembly.getState().placeColonyTile('moon', 1, 5, 'empty').ok).toBe(true)
    expect(useRocketAssembly.getState().budgetCredits).toBe(startBudget - 30)
  })

  it('deploys landed payloads onto the planet colony without overwriting the rocket pad', () => {
    useRocketAssembly.getState().rewardMission(500, 40, ['greenhouse', 'rover'], 'mars')
    const marsGrid = useRocketAssembly.getState().colonyGrids.mars
    expect(marsGrid[2]![1]).toBe('empty') // Protected rocket pad cell
    expect(marsGrid[2]).toContain('greenhouse')
    expect(marsGrid[3]).toContain('drill')
  })
})
