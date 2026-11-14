import { create } from 'zustand'
import { FUEL_TANKS, INITIAL_BUDGET_CREDITS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from './data'
import { calculateRocketCost, calculateTotalMass, calculateTWR } from './calculations'
import type { FuelTank, Payload, PayloadId, RocketBody, RocketConfiguration, RocketEngine } from './types'

export type ColonyTileType = 'empty' | 'hull' | 'solar' | 'rtg' | 'greenhouse' | 'habitat' | 'drill'

export interface RocketAssemblyState {
  bodyId: RocketBody['id']
  engineId: RocketEngine['id']
  fuelTankId: FuelTank['id'] | null
  payloadIds: PayloadId[]
  hasFins: boolean
  destinationId: 'moon' | 'mars'
  parachute: boolean
  heatShield: boolean
  poweredDescent: boolean
  budgetCredits: number
  sciencePoints: number
  colonyGrids: Record<'moon' | 'mars', ColonyTileType[][]>
  selectBody: (bodyId: RocketBody['id']) => void
  selectEngine: (engineId: RocketEngine['id']) => void
  selectFuelTank: (fuelTankId: FuelTank['id'] | null) => void
  addPayload: (payloadId: PayloadId) => boolean
  removePayload: (index: number) => void
  toggleFins: () => void
  setDestinationId: (id: 'moon' | 'mars') => void
  toggleEquipment: (key: 'parachute' | 'heatShield' | 'poweredDescent') => void
  placeColonyTile: (planetId: 'moon' | 'mars', row: number, col: number, tile: ColonyTileType, cost: number) => boolean
  rewardMission: (credits: number, science: number, landedPayloads: PayloadId[], planetId: 'moon' | 'mars') => void
  spendFuelAbort: (cost: number) => void
  claimEmergencyGrant: () => void
}

function createInitialGrid(): ColonyTileType[][] {
  return Array.from({ length: 6 }, () => Array.from({ length: 10 }, () => 'empty' as ColonyTileType))
}

export const useRocketAssembly = create<RocketAssemblyState>((set, get) => ({
  bodyId: ROCKET_BODIES[1]!.id,
  engineId: ROCKET_ENGINES[1]!.id,
  fuelTankId: FUEL_TANKS[1]!.id,
  payloadIds: [],
  hasFins: true,
  destinationId: 'moon',
  parachute: false,
  heatShield: false,
  poweredDescent: true,
  budgetCredits: INITIAL_BUDGET_CREDITS,
  sciencePoints: 0,
  colonyGrids: {
    moon: createInitialGrid(),
    mars: createInitialGrid(),
  },
  selectBody: (bodyId) =>
    set((state) => ({
      bodyId,
      payloadIds: state.payloadIds.slice(0, ROCKET_BODIES.find((body) => body.id === bodyId)!.cargoSlots),
    })),
  selectEngine: (engineId) => set({ engineId }),
  selectFuelTank: (fuelTankId) => set({ fuelTankId }),
  addPayload: (payloadId) => {
    const state = get()
    const body = ROCKET_BODIES.find((item) => item.id === state.bodyId)!
    if (state.payloadIds.length >= body.cargoSlots) return false
    set({ payloadIds: [...state.payloadIds, payloadId] })
    return true
  },
  removePayload: (index) =>
    set((state) => ({ payloadIds: state.payloadIds.filter((_, itemIndex) => itemIndex !== index) })),
  toggleFins: () => set((state) => ({ hasFins: !state.hasFins })),
  setDestinationId: (destinationId) =>
    set({
      destinationId,
      parachute: destinationId === 'mars',
      heatShield: destinationId === 'mars',
      poweredDescent: true,
    }),
  toggleEquipment: (key) => set((state) => ({ [key]: !state[key] })),
  placeColonyTile: (planetId, row, col, tile, cost) => {
    const state = get()
    if (tile !== 'empty' && state.budgetCredits < cost) return false
    const grid = state.colonyGrids[planetId].map((r) => [...r])
    grid[row]![col] = tile
    set({
      budgetCredits: tile === 'empty' ? state.budgetCredits + 15 : state.budgetCredits - cost,
      colonyGrids: { ...state.colonyGrids, [planetId]: grid },
    })
    return true
  },
  rewardMission: (credits, science, landedPayloads, planetId) =>
    set((state) => {
      const grid = state.colonyGrids[planetId].map((r) => [...r])
      const mapPayloadToTile: Record<PayloadId, ColonyTileType> = {
        'solar-panel': 'solar',
        rover: 'drill',
        greenhouse: 'greenhouse',
        habitat: 'habitat',
      }
      landedPayloads.forEach((pid) => {
        const targetTile = mapPayloadToTile[pid]
        const targetRow = pid === 'rover' ? 4 : pid === 'solar-panel' ? 1 : 2
        const emptyCol = grid[targetRow]!.findIndex((cell) => cell === 'empty')
        if (emptyCol !== -1) grid[targetRow]![emptyCol] = targetTile
      })
      return {
        budgetCredits: Math.max(0, state.budgetCredits + credits),
        sciencePoints: state.sciencePoints + science,
        colonyGrids: { ...state.colonyGrids, [planetId]: grid },
      }
    }),
  spendFuelAbort: (cost) =>
    set((state) => ({
      budgetCredits: Math.max(0, state.budgetCredits - cost),
      sciencePoints: state.sciencePoints + 15,
    })),
  claimEmergencyGrant: () =>
    set((state) => ({
      budgetCredits: state.budgetCredits + 500,
    })),
}))

export function getRocketConfiguration(
  state: Pick<RocketAssemblyState, 'bodyId' | 'engineId' | 'fuelTankId' | 'payloadIds'>,
): RocketConfiguration {
  const body = ROCKET_BODIES.find((item) => item.id === state.bodyId)!
  const engine = ROCKET_ENGINES.find((item) => item.id === state.engineId)!
  const fuelTank = state.fuelTankId ? FUEL_TANKS.find((item) => item.id === state.fuelTankId) ?? null : null
  const payloads = state.payloadIds.map((id) => PAYLOADS.find((item) => item.id === id)!)
  return {
    body,
    engine,
    fuelTank,
    payloads,
    totalMassKg: calculateTotalMass({ body, engine, fuelTank, payloads }),
    budgetCredits: INITIAL_BUDGET_CREDITS,
  }
}

export function calculateAssemblyTWR(configuration: RocketConfiguration): number {
  return calculateTWR(configuration.engine.thrustN, configuration.totalMassKg, 9.81)
}

export function isOverBudget(configuration: RocketConfiguration): boolean {
  return calculateRocketCost(configuration) > configuration.budgetCredits
}

export function getPayload(payloadId: PayloadId): Payload {
  return PAYLOADS.find((payload) => payload.id === payloadId)!
}
