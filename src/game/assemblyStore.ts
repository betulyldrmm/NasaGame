import { create } from 'zustand'
import { FUEL_TANKS, INITIAL_BUDGET_CREDITS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from './data'
import { calculateRocketCost, calculateTotalMass, calculateTWR } from './calculations'
import type { FuelTank, Payload, PayloadId, RocketBody, RocketConfiguration, RocketEngine } from './types'

export type ColonyTileType = 'empty' | 'hull' | 'solar' | 'rtg' | 'greenhouse' | 'habitat' | 'drill'

export const COLONY_TILE_COSTS: Record<ColonyTileType, number> = {
  empty: 0,
  hull: 20,
  solar: 60,
  rtg: 140,
  greenhouse: 90,
  habitat: 110,
  drill: 100,
}

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
  placeColonyTile: (
    planetId: 'moon' | 'mars',
    row: number,
    col: number,
    tile: ColonyTileType,
    cost?: number,
  ) => { ok: boolean; message?: string }
  rewardMission: (credits: number, science: number, landedPayloads: PayloadId[], planetId: 'moon' | 'mars') => void
  spendFuelAbort: (cost: number) => void
  claimEmergencyGrant: () => void
}

function createInitialGrid(): ColonyTileType[][] {
  const grid = Array.from({ length: 6 }, () => Array.from({ length: 10 }, () => 'empty' as ColonyTileType))
  // Starter surface outpost on row 2 (Surface Horizon) next to Rocket Pad at [2][1]:
  // Solar (+100W Moon / +43W Mars) + Pressurized Corridor + Habitat (-25W) -> net positive even on Mars!
  grid[2]![2] = 'solar'
  grid[2]![3] = 'hull'
  grid[2]![4] = 'habitat'
  // Starter vertical elevator shaft on row 3 toward underground ore veins
  grid[3]![3] = 'hull'
  return grid
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
  placeColonyTile: (planetId, row, col, tile, costOverride) => {
    const state = get()
    const currentCell = state.colonyGrids[planetId][row]?.[col]
    if (currentCell === undefined) return { ok: false, message: 'Geçersiz karo konumu.' }

    // Protect landed rocket pad at (row 2, col 1)
    if (row === 2 && col === 1) {
      return { ok: false, message: '🚀 Komuta roketi iniş pistinin üzeri kapatılamaz!' }
    }

    // Demolish / salvage existing module for 50% credit refund
    if (tile === 'empty') {
      if (currentCell === 'empty') {
        return { ok: false, message: 'Bu alan zaten boş!' }
      }
      const refund = Math.round(COLONY_TILE_COSTS[currentCell] * 0.5)
      const grid = state.colonyGrids[planetId].map((r) => [...r])
      grid[row]![col] = 'empty'
      set({
        budgetCredits: state.budgetCredits + refund,
        colonyGrids: { ...state.colonyGrids, [planetId]: grid },
      })
      return { ok: true, message: `Modül söküldü (+${refund} cr hurda iadesi).` }
    }

    if (currentCell === tile) {
      return { ok: false, message: 'Bu karoda zaten aynı modül kurulu.' }
    }

    // Layer placement physics rules:
    if (tile === 'solar' && row >= 3) {
      return { ok: false, message: '⚠ Güneş Paneli yeraltına kurulamaz! Yüzeye veya üst güverteye (Satır 1-3) yerleştirin.' }
    }
    if (tile === 'greenhouse' && row >= 3) {
      return { ok: false, message: '⚠ Biyo-Sera güneş ışığı için yüzey katmanına (Satır 1-3) kurulmalıdır!' }
    }
    if (tile === 'drill' && row < 2) {
      return { ok: false, message: '⚠ Lazer Sondaj gökyüzüne kurulamaz! Yüzey veya yeraltı cevher damarlarına (Satır 3-6) kurun.' }
    }

    const buildCost = costOverride ?? COLONY_TILE_COSTS[tile]
    if (state.budgetCredits < buildCost) {
      return { ok: false, message: `⚠ Yetersiz bütçe! (${buildCost} cr gerekli)` }
    }

    // Refund 50% if replacing another non-empty module cleanly
    const salvageBonus = currentCell !== 'empty' ? Math.round(COLONY_TILE_COSTS[currentCell] * 0.5) : 0
    const grid = state.colonyGrids[planetId].map((r) => [...r])
    grid[row]![col] = tile
    set({
      budgetCredits: state.budgetCredits - buildCost + salvageBonus,
      colonyGrids: { ...state.colonyGrids, [planetId]: grid },
    })
    return { ok: true }
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
        const targetRow = pid === 'rover' ? 3 : 2
        let emptyCol = grid[targetRow]!.findIndex((cell, cIdx) => cell === 'empty' && cIdx >= 2)
        if (emptyCol === -1) {
          emptyCol = grid[targetRow]!.findIndex(
            (cell, cIdx) => cell === 'empty' && !(targetRow === 2 && cIdx === 1),
          )
        }
        if (emptyCol !== -1) {
          grid[targetRow]![emptyCol] = targetTile
        }
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
