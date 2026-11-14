import { create } from 'zustand'
import { FUEL_TANKS, INITIAL_BUDGET_CREDITS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from './data'
import { calculateRocketCost, calculateTotalMass, calculateTWR } from './calculations'
import type { FuelTank, Payload, PayloadId, RocketBody, RocketConfiguration, RocketEngine } from './types'

export interface RocketAssemblyState {
  bodyId: RocketBody['id']
  engineId: RocketEngine['id']
  fuelTankId: FuelTank['id'] | null
  payloadIds: PayloadId[]
  selectBody: (bodyId: RocketBody['id']) => void
  selectEngine: (engineId: RocketEngine['id']) => void
  selectFuelTank: (fuelTankId: FuelTank['id'] | null) => void
  addPayload: (payloadId: PayloadId) => boolean
  removePayload: (index: number) => void
}

export const useRocketAssembly = create<RocketAssemblyState>((set, get) => ({
  bodyId: ROCKET_BODIES[1]!.id,
  engineId: ROCKET_ENGINES[1]!.id,
  fuelTankId: FUEL_TANKS[1]!.id,
  payloadIds: [],
  selectBody: (bodyId) => set((state) => ({
    bodyId,
    // Keep the assembly valid if the player chooses a body with fewer slots.
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
  removePayload: (index) => set((state) => ({ payloadIds: state.payloadIds.filter((_, itemIndex) => itemIndex !== index) })),
}))

export function getRocketConfiguration(state: Pick<RocketAssemblyState, 'bodyId' | 'engineId' | 'fuelTankId' | 'payloadIds'>): RocketConfiguration {
  const body = ROCKET_BODIES.find((item) => item.id === state.bodyId)!
  const engine = ROCKET_ENGINES.find((item) => item.id === state.engineId)!
  const fuelTank = state.fuelTankId ? FUEL_TANKS.find((item) => item.id === state.fuelTankId) ?? null : null
  const payloads = state.payloadIds.map((id) => PAYLOADS.find((item) => item.id === id)!)
  return { body, engine, fuelTank, payloads, totalMassKg: calculateTotalMass({ body, engine, fuelTank, payloads }), budgetCredits: INITIAL_BUDGET_CREDITS }
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
