import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { calculateRocketCost } from '../game/calculations'
import type { PayloadId, RocketConfiguration } from '../game/types'
import type { MissionDestination, MissionEvaluation, LandingEquipment } from '../flight/mission'
import type { FlightState } from '../flight/physics'
import { applyColonyTurn, calculatePadCancellation, ECONOMY_ASSUMPTIONS, type ColonyResources } from './economy'

export type EconomyMissionStatus = 'active' | 'cancelled' | 'failed' | 'succeeded'
export type EconomyMissionStage = 'pad' | 'flight' | 'complete'

export interface EconomyMissionRecord {
  id: string
  destinationId: 'moon' | 'mars'
  status: EconomyMissionStatus
  stage: EconomyMissionStage
  costCredits: number
  payloadIds: PayloadId[]
  rocketConfiguration: RocketConfiguration
  landingEquipment: LandingEquipment
  flightState: FlightState | null
  evaluation: MissionEvaluation | null
  penaltyCredits: number
  refundCredits: number
  rewardCredits: number
  scienceAward: number
  createdAt: number
  settledAt: number | null
}

export interface ColonyBase {
  destinationId: 'moon' | 'mars'
  deliveredModules: PayloadId[]
  resources: ColonyResources
  completedTurns: number
  lastTurnEnergyProduced: number
  lastTurnEnergyDemand: number
  lastTurnEnergyShortfall: number
}

export interface EconomyState {
  balanceCredits: number
  sciencePoints: number
  missions: EconomyMissionRecord[]
  activeMissionId: string | null
  bases: Record<'moon' | 'mars', ColonyBase>
  researchSupportUsed: boolean
  beginMission: (input: {
    id: string
    destination: MissionDestination
    rocket: RocketConfiguration
    landingEquipment: LandingEquipment
  }) => 'started' | 'insufficient-funds' | 'mission-active' | 'duplicate-id'
  markMissionLaunched: (id: string, flightState: FlightState) => boolean
  updateMissionFlight: (id: string, flightState: FlightState) => void
  cancelMissionAtPad: (id: string, evaluation: MissionEvaluation) => boolean
  settleFlightMission: (id: string, evaluation: MissionEvaluation, flightState: FlightState) => boolean
  claimResearchSupport: () => boolean
}

export const ECONOMY_STORAGE_KEY = 'space-mission-economy-v1'

const emptyBase = (destinationId: 'moon' | 'mars'): ColonyBase => ({
  destinationId,
  deliveredModules: [],
  resources: { energy: 0, minerals: 0, food: 0 },
  completedTurns: 0,
  lastTurnEnergyProduced: 0,
  lastTurnEnergyDemand: 0,
  lastTurnEnergyShortfall: 0,
})

export function createEconomyStore(storage?: StateStorage) {
  return create<EconomyState>()(persist((set, get) => ({
    balanceCredits: ECONOMY_ASSUMPTIONS.startingCredits,
    sciencePoints: 0,
    missions: [],
    activeMissionId: null,
    bases: { moon: emptyBase('moon'), mars: emptyBase('mars') },
    researchSupportUsed: false,

    beginMission: ({ id, destination, rocket, landingEquipment }) => {
      const state = get()
      if (state.activeMissionId) return 'mission-active'
      if (state.missions.some((mission) => mission.id === id)) return 'duplicate-id'
      const costCredits = calculateRocketCost(rocket)
      if (costCredits > state.balanceCredits) return 'insufficient-funds'
      const record: EconomyMissionRecord = {
        id,
        destinationId: destination.id as 'moon' | 'mars',
        status: 'active',
        stage: 'pad',
        costCredits,
        payloadIds: rocket.payloads.map((payload) => payload.id),
        rocketConfiguration: rocket,
        landingEquipment,
        flightState: null,
        evaluation: null,
        penaltyCredits: 0,
        refundCredits: 0,
        rewardCredits: 0,
        scienceAward: 0,
        createdAt: Date.now(),
        settledAt: null,
      }
      set({
        balanceCredits: state.balanceCredits - costCredits,
        activeMissionId: id,
        missions: [...state.missions, record],
      })
      return 'started'
    },

    markMissionLaunched: (id, flightState) => {
      const state = get()
      if (state.activeMissionId !== id) return false
      set({ missions: state.missions.map((mission) => mission.id === id
        ? { ...mission, stage: 'flight', flightState }
        : mission) })
      return true
    },

    updateMissionFlight: (id, flightState) => set((state) => {
      if (state.activeMissionId !== id) return state
      return { missions: state.missions.map((mission) => mission.id === id
        ? { ...mission, flightState }
        : mission) }
    }),

    cancelMissionAtPad: (id, evaluation) => {
      const state = get()
      const mission = state.missions.find((item) => item.id === id)
      if (!mission || mission.id !== state.activeMissionId || mission.stage !== 'pad') return false
      const { penaltyCredits, refundCredits } = calculatePadCancellation(mission.costCredits)
      set({
        balanceCredits: state.balanceCredits + refundCredits,
        activeMissionId: null,
        missions: state.missions.map((item) => item.id === id ? {
          ...item, status: 'cancelled', stage: 'complete', evaluation,
          penaltyCredits, refundCredits, settledAt: Date.now(),
        } : item),
      })
      return true
    },

    settleFlightMission: (id, evaluation, flightState) => {
      const state = get()
      const mission = state.missions.find((item) => item.id === id)
      if (!mission || mission.id !== state.activeMissionId || mission.stage !== 'flight') return false
      const succeeded = evaluation.success
      const rewardCredits = succeeded ? ECONOMY_ASSUMPTIONS.successCredits : 0
      const scienceAward = succeeded ? ECONOMY_ASSUMPTIONS.successScience : 0
      let bases = state.bases
      if (succeeded) {
        const destinationId = mission.destinationId
        const base = state.bases[destinationId]
        const turn = applyColonyTurn(base.deliveredModules, base.resources, mission.payloadIds, base.completedTurns, destinationId)
        bases = { ...state.bases, [destinationId]: { ...base, ...turn } }
      }
      set({
        balanceCredits: state.balanceCredits + rewardCredits,
        sciencePoints: state.sciencePoints + scienceAward,
        activeMissionId: null,
        bases,
        missions: state.missions.map((item) => item.id === id ? {
          ...item, status: succeeded ? 'succeeded' : 'failed', stage: 'complete',
          evaluation, flightState, rewardCredits, scienceAward, settledAt: Date.now(),
        } : item),
      })
      return true
    },

    claimResearchSupport: () => {
      const state = get()
      if (state.activeMissionId || state.balanceCredits > 0 || state.researchSupportUsed) return false
      set({ balanceCredits: ECONOMY_ASSUMPTIONS.researchSupportCredits, researchSupportUsed: true })
      return true
    },
  }), {
    name: ECONOMY_STORAGE_KEY,
    ...(storage ? { storage: createJSONStorage(() => storage) } : {}),
    partialize: (state) => ({
      balanceCredits: state.balanceCredits,
      sciencePoints: state.sciencePoints,
      missions: state.missions,
      activeMissionId: state.activeMissionId,
      bases: state.bases,
      researchSupportUsed: state.researchSupportUsed,
    }),
    merge: (persistedState, currentState) => {
      const persisted = persistedState as Partial<EconomyState> | undefined
      return {
        ...currentState,
        ...persisted,
        bases: {
          moon: { ...currentState.bases.moon, ...persisted?.bases?.moon },
          mars: { ...currentState.bases.mars, ...persisted?.bases?.mars },
        },
      }
    },
  }))
}

export const useEconomyStore = createEconomyStore()
