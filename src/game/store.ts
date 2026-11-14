import { create } from 'zustand'
import { evaluateColony, evaluateMission } from './calculations'
import {
  AERODYNAMIC_FINS,
  EMERGENCY_GRANT_AMOUNT_CREDITS,
  EMERGENCY_GRANT_THRESHOLD_CREDITS,
  FUEL_TANKS,
  INITIAL_BUDGET_CREDITS,
  INITIAL_SCIENCE_XP,
  LANDING_SYSTEMS,
  LEARNING_CARDS,
  PAYLOADS,
  PLANETS,
  ROCKET_BODIES,
  ROCKET_ENGINES,
} from './data'
import type {
  AerodynamicFin,
  ColonyLayer,
  ColonyModuleInstance,
  FailureCode,
  FlightLogEntry,
  FuelTank,
  LandingSystem,
  LearningCard,
  MissionEvaluation,
  Payload,
  Planet,
  RocketBody,
  RocketEngine,
} from './types'

export type ScreenMode = 'HOME' | 'ASSEMBLY' | 'FLIGHT' | 'COLONY'
export type ModalMode = 'TECH_TREE' | 'ENCYCLOPEDIA' | 'HOW_TO_PLAY' | null

export interface LastFlightReport {
  evaluation: MissionEvaluation
  learningCard: LearningCard
  planet: Planet
  costDeducted: number
  rewardCreditsEarned: number
  colonyIncomeCredits: number
  scienceEarned: number
  isNewFailureDiscovery: boolean
  emergencyGrantTriggered: boolean
  landedModulesCount: number
}

export interface GameState {
  screen: ScreenMode
  activeModal: ModalMode
  turn: number
  budgetCredits: number
  scienceXP: number
  unlockedIds: string[]
  discoveredFailures: FailureCode[]
  emergencyGrantCount: number

  // Rocket Assembly selections
  selectedPlanetId: string
  selectedBodyId: string
  selectedEngineId: string
  selectedTankId: string | null
  selectedFinId: string
  selectedLandingId: string
  selectedPayloadIds: string[]

  // Planetary Colonies (planetId -> modules)
  colonies: Record<string, ColonyModuleInstance[]>

  // Flight & Mission History
  lastFlightReport: LastFlightReport | null
  flightLogs: FlightLogEntry[]

  // Actions
  setScreen: (screen: ScreenMode) => void
  setActiveModal: (modal: ModalMode) => void
  selectPlanet: (planetId: string) => void
  selectBody: (bodyId: string) => void
  selectEngine: (engineId: string) => void
  selectTank: (tankId: string | null) => void
  selectFin: (finId: string) => void
  selectLanding: (landingId: string) => void
  addPayload: (payloadId: string) => void
  removePayloadAt: (index: number) => void
  clearPayloads: () => void
  unlockTechItem: (itemId: string, scienceCost: number) => boolean
  applyPreset: (presetKey: 'MOON_READY' | 'MARS_READY' | 'LOW_TWR_DEMO' | 'SPIN_DEMO' | 'VACUUM_PARACHUTE_DEMO') => void
  startLaunchSimulation: () => void
  completeFlight: (abortedOnPad?: boolean) => void
  dismissFlightReport: (goToColony?: boolean) => void
  claimEmergencyGrant: () => void
  advanceColonyTurn: () => { totalCredits: number; totalScience: number }
  removeColonyModule: (planetId: string, instanceId: string) => void
  resetGame: () => void
}

const DEFAULT_UNLOCKED_IDS = [
  ...ROCKET_BODIES.filter((b) => !b.unlockScienceCost).map((b) => b.id),
  ...ROCKET_ENGINES.filter((e) => !e.unlockScienceCost).map((e) => e.id),
  ...FUEL_TANKS.filter((t) => !t.unlockScienceCost).map((t) => t.id),
  ...PAYLOADS.filter((p) => !p.unlockScienceCost).map((p) => p.id),
]

export function getSelectedRocketParts(state: Pick<
  GameState,
  'selectedBodyId' | 'selectedEngineId' | 'selectedTankId' | 'selectedFinId' | 'selectedLandingId' | 'selectedPayloadIds' | 'selectedPlanetId'
>): {
  planet: Planet
  body: RocketBody
  engine: RocketEngine
  fuelTank: FuelTank | null
  fin: AerodynamicFin
  landingSystem: LandingSystem
  payloads: Payload[]
} {
  const planet = PLANETS.find((p) => p.id === state.selectedPlanetId) ?? PLANETS[1]!
  const body = ROCKET_BODIES.find((b) => b.id === state.selectedBodyId) ?? ROCKET_BODIES[0]!
  const engine = ROCKET_ENGINES.find((e) => e.id === state.selectedEngineId) ?? ROCKET_ENGINES[1]!
  const fuelTank = state.selectedTankId ? (FUEL_TANKS.find((t) => t.id === state.selectedTankId) ?? null) : null
  const fin = AERODYNAMIC_FINS.find((f) => f.id === state.selectedFinId) ?? AERODYNAMIC_FINS[1]!
  const landingSystem = LANDING_SYSTEMS.find((l) => l.id === state.selectedLandingId) ?? LANDING_SYSTEMS[2]!
  const payloads = state.selectedPayloadIds
    .map((id) => PAYLOADS.find((p) => p.id === id))
    .filter((p): p is Payload => Boolean(p))

  return { planet, body, engine, fuelTank, fin, landingSystem, payloads }
}

export const useGameStore = create<GameState>((set, get) => ({
  screen: 'HOME',
  activeModal: null,
  turn: 1,
  budgetCredits: INITIAL_BUDGET_CREDITS,
  scienceXP: INITIAL_SCIENCE_XP,
  unlockedIds: DEFAULT_UNLOCKED_IDS,
  discoveredFailures: [],
  emergencyGrantCount: 0,

  selectedPlanetId: 'moon',
  selectedBodyId: 'body-explorer',
  selectedEngineId: 'engine-voyager',
  selectedTankId: 'tank-medium',
  selectedFinId: 'fin-standard',
  selectedLandingId: 'landing-retrorocket',
  selectedPayloadIds: ['solar-panel', 'rover'],

  colonies: {
    earth: [],
    moon: [],
    mars: [],
    europa: [],
  },

  lastFlightReport: null,
  flightLogs: [],

  setScreen: (screen) => set({ screen }),
  setActiveModal: (activeModal) => set({ activeModal }),

  selectPlanet: (planetId) => set({ selectedPlanetId: planetId }),

  selectBody: (bodyId) =>
    set((state) => {
      const body = ROCKET_BODIES.find((b) => b.id === bodyId) ?? ROCKET_BODIES[0]!
      return {
        selectedBodyId: bodyId,
        selectedPayloadIds: state.selectedPayloadIds.slice(0, body.cargoSlots),
      }
    }),

  selectEngine: (engineId) => set({ selectedEngineId: engineId }),
  selectTank: (tankId) => set({ selectedTankId: tankId }),
  selectFin: (finId) => set({ selectedFinId: finId }),
  selectLanding: (landingId) => set({ selectedLandingId: landingId }),

  addPayload: (payloadId) =>
    set((state) => {
      const body = ROCKET_BODIES.find((b) => b.id === state.selectedBodyId) ?? ROCKET_BODIES[0]!
      if (state.selectedPayloadIds.length >= body.cargoSlots) return state
      return { selectedPayloadIds: [...state.selectedPayloadIds, payloadId] }
    }),

  removePayloadAt: (index) =>
    set((state) => ({
      selectedPayloadIds: state.selectedPayloadIds.filter((_, idx) => idx !== index),
    })),

  clearPayloads: () => set({ selectedPayloadIds: [] }),

  unlockTechItem: (itemId, scienceCost) => {
    const state = get()
    if (state.unlockedIds.includes(itemId) || state.scienceXP < scienceCost) {
      return false
    }
    set({
      scienceXP: state.scienceXP - scienceCost,
      unlockedIds: [...state.unlockedIds, itemId],
    })
    return true
  },

  applyPreset: (presetKey) => {
    if (presetKey === 'MOON_READY') {
      set({
        selectedPlanetId: 'moon',
        selectedBodyId: 'body-explorer',
        selectedEngineId: 'engine-voyager',
        selectedTankId: 'tank-medium',
        selectedFinId: 'fin-standard',
        selectedLandingId: 'landing-retrorocket',
        selectedPayloadIds: ['solar-panel', 'rover'],
      })
    } else if (presetKey === 'MARS_READY') {
      set({
        selectedPlanetId: 'mars',
        selectedBodyId: 'body-explorer',
        selectedEngineId: 'engine-titan',
        selectedTankId: 'tank-large',
        selectedFinId: 'fin-grid',
        selectedLandingId: 'landing-mars-skycrane',
        selectedPayloadIds: ['solar-panel', 'greenhouse'],
      })
    } else if (presetKey === 'LOW_TWR_DEMO') {
      // Heavy Carrier body + weak Spark engine -> TWR < 1.0 (Fails on Launchpad, 15% fuel cost)
      set({
        selectedPlanetId: 'moon',
        selectedBodyId: 'body-carrier',
        selectedEngineId: 'engine-spark',
        selectedTankId: 'tank-medium',
        selectedFinId: 'fin-standard',
        selectedLandingId: 'landing-retrorocket',
        selectedPayloadIds: ['solar-panel', 'rover', 'greenhouse'],
      })
    } else if (presetKey === 'SPIN_DEMO') {
      // No fins -> CoM behind CoP -> Spins out at T+5s in atmosphere
      set({
        selectedPlanetId: 'moon',
        selectedBodyId: 'body-explorer',
        selectedEngineId: 'engine-voyager',
        selectedTankId: 'tank-medium',
        selectedFinId: 'fin-none',
        selectedLandingId: 'landing-retrorocket',
        selectedPayloadIds: ['greenhouse', 'rover'],
      })
    } else if (presetKey === 'VACUUM_PARACHUTE_DEMO') {
      // Moon mission with Parachute -> crashes on lunar surface due to vacuum
      set({
        selectedPlanetId: 'moon',
        selectedBodyId: 'body-scout',
        selectedEngineId: 'engine-voyager',
        selectedTankId: 'tank-medium',
        selectedFinId: 'fin-standard',
        selectedLandingId: 'landing-parachute',
        selectedPayloadIds: ['solar-panel'],
      })
    }
  },

  startLaunchSimulation: () => {
    set({ screen: 'FLIGHT', lastFlightReport: null })
  },

  completeFlight: (abortedOnPad = false) => {
    const state = get()
    const parts = getSelectedRocketParts(state)
    const rawEval = evaluateMission(parts, parts.planet)

    const evaluation: MissionEvaluation = abortedOnPad
      ? {
          ...rawEval,
          isSuccess: false,
          failureStage: 'LAUNCHPAD',
          failureCode: 'PAD_ABORT',
          learningCard: LEARNING_CARDS.PAD_ABORT,
        }
      : rawEval

    // Progressive Cost Loss: 15% on LAUNCHPAD failure/abort, 100% on in-flight/success
    const isPadOnlyLoss = evaluation.failureStage === 'LAUNCHPAD'
    const costDeducted = isPadOnlyLoss ? evaluation.padAbortCostCredits : evaluation.totalCostCredits

    let rewardCreditsEarned = 0
    let scienceEarned = 0
    let isNewFailureDiscovery = false
    const updatedDiscovered = [...state.discoveredFailures]
    const updatedColonies = { ...state.colonies }
    let landedModulesCount = 0

    if (evaluation.isSuccess) {
      const payloadBonus = parts.payloads.reduce((sum, p) => sum + Math.round(p.costCredits * 0.55), 0)
      rewardCreditsEarned = (parts.planet.baseRewardCredits ?? 400) + payloadBonus
      scienceEarned = (parts.planet.baseRewardScience ?? 25) + parts.payloads.length * 10

      // Land payloads into target planet's colony
      const existingModules = [...(updatedColonies[parts.planet.id] ?? [])]
      for (const payload of parts.payloads) {
        const layer: ColonyLayer = payload.colonyLayer ?? 'UPPER_HABITAT'
        const layerCount = existingModules.filter((m) => m.layer === layer).length
        existingModules.push({
          instanceId: `${parts.planet.id}-${payload.id}-${state.turn}-${Math.random().toString(36).slice(2, 7)}`,
          payloadId: payload.id,
          name: payload.name,
          category: payload.category ?? 'HABITAT',
          layer,
          slotIndex: layerCount,
          installedTurn: state.turn,
        })
        landedModulesCount += 1
      }
      updatedColonies[parts.planet.id] = existingModules
    } else {
      // Fail-Forward Science XP reward
      if (!updatedDiscovered.includes(evaluation.failureCode)) {
        isNewFailureDiscovery = true
        updatedDiscovered.push(evaluation.failureCode)
        scienceEarned = 35
      } else {
        scienceEarned = 15
      }
    }

    // Calculate passive colony income for this mission turn across all planets
    let colonyIncomeCredits = 0
    let colonyScienceBonus = 0
    for (const planet of PLANETS) {
      const mods = updatedColonies[planet.id] ?? []
      if (mods.length > 0) {
        const summary = evaluateColony(planet, mods)
        colonyIncomeCredits += summary.incomeCreditsPerTurn
        colonyScienceBonus += summary.sciencePerTurn
      }
    }

    scienceEarned += colonyScienceBonus
    let nextBudget = state.budgetCredits - costDeducted + rewardCreditsEarned + colonyIncomeCredits
    let emergencyGrantTriggered = false
    let nextGrantCount = state.emergencyGrantCount

    // Anti-Softlock: NASA Emergency Grant if player cannot afford a basic rocket
    if (nextBudget < EMERGENCY_GRANT_THRESHOLD_CREDITS) {
      nextBudget += EMERGENCY_GRANT_AMOUNT_CREDITS
      emergencyGrantTriggered = true
      nextGrantCount += 1
    }

    const logEntry: FlightLogEntry = {
      id: `log-${state.turn}-${Date.now()}`,
      turn: state.turn,
      planetId: parts.planet.id,
      planetName: parts.planet.name,
      rocketName: `${parts.body.name.split(' ')[0]} / ${parts.engine.name.split(' ')[0]}`,
      isSuccess: evaluation.isSuccess,
      failureStage: evaluation.failureStage,
      failureCode: evaluation.failureCode,
      costDeltaCredits: rewardCreditsEarned + colonyIncomeCredits - costDeducted,
      scienceEarned,
    }

    set({
      turn: state.turn + 1,
      budgetCredits: Math.max(0, nextBudget),
      scienceXP: state.scienceXP + scienceEarned,
      discoveredFailures: updatedDiscovered,
      emergencyGrantCount: nextGrantCount,
      colonies: updatedColonies,
      flightLogs: [logEntry, ...state.flightLogs].slice(0, 20),
      lastFlightReport: {
        evaluation,
        learningCard: evaluation.learningCard,
        planet: parts.planet,
        costDeducted,
        rewardCreditsEarned,
        colonyIncomeCredits,
        scienceEarned,
        isNewFailureDiscovery,
        emergencyGrantTriggered,
        landedModulesCount,
      },
    })
  },

  dismissFlightReport: (goToColony = false) =>
    set({
      lastFlightReport: null,
      screen: goToColony ? 'COLONY' : 'ASSEMBLY',
    }),

  claimEmergencyGrant: () =>
    set((state) => ({
      budgetCredits: state.budgetCredits + EMERGENCY_GRANT_AMOUNT_CREDITS,
      emergencyGrantCount: state.emergencyGrantCount + 1,
      selectedPlanetId: 'earth',
      selectedBodyId: 'body-scout',
      selectedEngineId: 'engine-voyager',
      selectedTankId: 'tank-small',
      selectedFinId: 'fin-standard',
      selectedLandingId: 'landing-orbital',
      selectedPayloadIds: ['comm-sat'],
    })),

  advanceColonyTurn: () => {
    const state = get()
    let totalCredits = 0
    let totalScience = 0

    for (const planet of PLANETS) {
      const mods = state.colonies[planet.id] ?? []
      if (mods.length > 0) {
        const summary = evaluateColony(planet, mods)
        totalCredits += summary.incomeCreditsPerTurn
        totalScience += summary.sciencePerTurn
      }
    }

    set({
      turn: state.turn + 1,
      budgetCredits: state.budgetCredits + totalCredits,
      scienceXP: state.scienceXP + totalScience,
    })

    return { totalCredits, totalScience }
  },

  removeColonyModule: (planetId, instanceId) =>
    set((state) => ({
      colonies: {
        ...state.colonies,
        [planetId]: (state.colonies[planetId] ?? []).filter((m) => m.instanceId !== instanceId),
      },
    })),

  resetGame: () =>
    set({
      screen: 'HOME',
      activeModal: null,
      turn: 1,
      budgetCredits: INITIAL_BUDGET_CREDITS,
      scienceXP: INITIAL_SCIENCE_XP,
      unlockedIds: DEFAULT_UNLOCKED_IDS,
      discoveredFailures: [],
      emergencyGrantCount: 0,
      selectedPlanetId: 'moon',
      selectedBodyId: 'body-explorer',
      selectedEngineId: 'engine-voyager',
      selectedTankId: 'tank-medium',
      selectedFinId: 'fin-standard',
      selectedLandingId: 'landing-retrorocket',
      selectedPayloadIds: ['solar-panel', 'rover'],
      colonies: { earth: [], moon: [], mars: [], europa: [] },
      lastFlightReport: null,
      flightLogs: [],
    }),
}))
