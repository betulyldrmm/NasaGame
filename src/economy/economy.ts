import type { PayloadId } from '../game/types'
import type { ColonyDestinationId } from './solarEnergy'
import { calculateColonyEnergyDemand, calculateSolarEnergyPerTurn } from './solarEnergy'

export const ECONOMY_ASSUMPTIONS = {
  startingCredits: 1_000,
  successCredits: 100,
  successScience: 150,
  researchSupportCredits: 250,
  padCancellationLossRate: 0.15,
  productionPerTurn: { minerals: 10, food: 8 },
} as const

export interface ColonyResources {
  energy: number
  minerals: number
  food: number
}

export interface ColonyTurnResult {
  deliveredModules: PayloadId[]
  resources: ColonyResources
  turns: number
  lastTurnEnergyProduced: number
  lastTurnEnergyDemand: number
  lastTurnEnergyShortfall: number
}

export function calculatePadCancellation(costCredits: number) {
  if (!Number.isFinite(costCredits) || costCredits < 0) throw new RangeError('Mission cost must be finite and non-negative.')
  const penaltyCredits = Math.round(costCredits * ECONOMY_ASSUMPTIONS.padCancellationLossRate)
  return { penaltyCredits, refundCredits: costCredits - penaltyCredits }
}

/** A completed mission is one colony turn; existing and newly delivered modules produce together. */
export function applyColonyTurn(
  existingModules: PayloadId[],
  existingResources: ColonyResources,
  deliveredModules: PayloadId[],
  currentTurns: number,
  destinationId: ColonyDestinationId,
): ColonyTurnResult {
  const modules = [...existingModules, ...deliveredModules]
  const count = (id: PayloadId) => modules.filter((moduleId) => moduleId === id).length
  const lastTurnEnergyProduced = calculateSolarEnergyPerTurn(count('solar-panel'), destinationId)
  const lastTurnEnergyDemand = calculateColonyEnergyDemand(modules)
  const availableEnergy = existingResources.energy + lastTurnEnergyProduced
  const lastTurnEnergyShortfall = Math.max(0, lastTurnEnergyDemand - availableEnergy)
  const powered = lastTurnEnergyShortfall === 0
  return {
    deliveredModules: modules,
    turns: currentTurns + 1,
    lastTurnEnergyProduced,
    lastTurnEnergyDemand,
    lastTurnEnergyShortfall,
    resources: {
      energy: Math.max(0, availableEnergy - lastTurnEnergyDemand),
      minerals: existingResources.minerals + (powered ? count('rover') * ECONOMY_ASSUMPTIONS.productionPerTurn.minerals : 0),
      food: existingResources.food + (powered ? count('greenhouse') * ECONOMY_ASSUMPTIONS.productionPerTurn.food : 0),
    },
  }
}
