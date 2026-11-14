import { describe, expect, it } from 'vitest'
import { applyColonyTurn, calculatePadCancellation } from './economy'

describe('economy rules', () => {
  it('deducts a 15% loss on launch-pad cancellation', () => {
    expect(calculatePadCancellation(500)).toEqual({ penaltyCredits: 75, refundCredits: 425 })
  })

  it('produces module resources only on a completed colony turn', () => {
    const result = applyColonyTurn([], { energy: 0, minerals: 0, food: 0 }, ['solar-panel', 'rover', 'greenhouse'], 0, 'mars')
    expect(result.deliveredModules).toEqual(['solar-panel', 'rover', 'greenhouse'])
    expect(result.lastTurnEnergyProduced).toBeCloseTo(20 * 586.2 / 1361)
    expect(result.lastTurnEnergyDemand).toBe(10)
    expect(result.lastTurnEnergyShortfall).toBeCloseTo(10 - 20 * 586.2 / 1361)
    expect(result.resources).toEqual({ energy: 0, minerals: 0, food: 0 })
    expect(result.turns).toBe(1)
  })

  it('includes installed modules in later turns', () => {
    const result = applyColonyTurn(['solar-panel'], { energy: 20, minerals: 0, food: 0 }, ['greenhouse'], 1, 'moon')
    expect(result.resources).toEqual({ energy: 34, minerals: 0, food: 8 })
    expect(result.turns).toBe(2)
    expect(result.lastTurnEnergyShortfall).toBe(0)
  })
})
