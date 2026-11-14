import type { PayloadId } from '../game/types'
import { PLANETARY_REFERENCE } from '../data/planetaryReference'

export type ColonyDestinationId = 'moon' | 'mars'

/** Abstract colony energy units, not joules or electrical output measurements. */
export const SOLAR_GAME_ASSUMPTIONS = {
  earthReferenceUnitsPerPanelTurn: 20,
  equipmentDemandUnitsPerTurn: { rover: 4, greenhouse: 6, habitat: 12 },
} as const

export function calculateSolarEnergyPerTurn(panelCount: number, destinationId: ColonyDestinationId): number {
  if (!Number.isFinite(panelCount) || panelCount < 0) throw new RangeError('Solar panel count must be finite and non-negative.')
  const earthReference = PLANETARY_REFERENCE.solarIrradiance.earth.valueWm2
  const targetIrradiance = PLANETARY_REFERENCE.solarIrradiance[destinationId].valueWm2
  return panelCount * SOLAR_GAME_ASSUMPTIONS.earthReferenceUnitsPerPanelTurn * targetIrradiance / earthReference
}

export function calculateColonyEnergyDemand(modules: PayloadId[]): number {
  return modules.reduce((total, moduleId) => total + (moduleId === 'rover'
    ? SOLAR_GAME_ASSUMPTIONS.equipmentDemandUnitsPerTurn.rover
    : moduleId === 'greenhouse'
      ? SOLAR_GAME_ASSUMPTIONS.equipmentDemandUnitsPerTurn.greenhouse
      : moduleId === 'habitat'
        ? SOLAR_GAME_ASSUMPTIONS.equipmentDemandUnitsPerTurn.habitat
        : 0), 0)
}
