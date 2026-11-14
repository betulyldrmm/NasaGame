/**
 * Core domain types for Space Mission Design Game.
 *
 * DESIGN PRINCIPLE (Data-Driven & Agent-Friendly):
 * - All physical quantities use SI units (kg, N, m/s, m/s², s, AU, bar) unless noted.
 * - UI components and the HTML5 Canvas flight simulator never hardcode physics rules;
 *   they consume `MissionEvaluation` produced by `evaluateMission(rocket, planet)` in `calculations.ts`.
 */

export type FailureStage = 'NONE' | 'LAUNCHPAD' | 'ATMOSPHERE' | 'ORBIT' | 'SURFACE'

export type FailureCode =
  | 'NONE'
  | 'PAD_ABORT'
  | 'LOW_TWR'
  | 'AERODYNAMIC_INSTABILITY'
  | 'NO_FUEL_TANK'
  | 'INSUFFICIENT_DELTA_V'
  | 'NO_LANDING_SYSTEM'
  | 'PARACHUTE_IN_VACUUM'
  | 'MARS_NO_HEATSHIELD'
  | 'MARS_PARACHUTE_ONLY'
  | 'INSUFFICIENT_LANDING_TWR'

export type TWRStatus = 'RED' | 'YELLOW' | 'GREEN'

export type AtmosphereType = 'ORBITAL' | 'VACUUM' | 'THIN' | 'THICK'

export type LandingSystemType = 'NONE' | 'PARACHUTE' | 'RETROROCKET' | 'HEATSHIELD_SKYCRANE' | 'ORBITAL_RCS'

export type PayloadCategory = 'ENERGY_SOLAR' | 'ENERGY_RTG' | 'MINING' | 'AGRICULTURE' | 'HABITAT' | 'SATELLITE'

export type ColonyLayer = 'SURFACE_ARRAY' | 'UPPER_HABITAT' | 'LOWER_LAB' | 'UNDERGROUND_MINE'

export interface RocketBody {
  id: string
  name: string
  description?: string
  cargoSlots: number
  dryMassKg: number
  costCredits: number
  /** Normalized Center of Mass position (0 = nose tip, 100 = engine mount). */
  baseCoM?: number
  /** Normalized Center of Pressure contribution (0 = nose tip, 100 = engine mount). */
  baseCoP?: number
  /** Science XP required to unlock (0 or undefined = unlocked from start). */
  unlockScienceCost?: number
  /** Visual tier for modular sprite rendering. */
  spriteVariant?: 'scout' | 'explorer' | 'carrier' | 'titan'
}

export interface RocketEngine {
  id: string
  name: string
  description?: string
  thrustN: number
  /** Specific impulse in seconds (s) for Tsiolkovsky Delta-V calculation. */
  ispSeconds?: number
  dryMassKg: number
  costCredits: number
  unlockScienceCost?: number
  spriteVariant?: 'spark' | 'voyager' | 'titan' | 'vulcan' | 'nerva'
}

export interface FuelTank {
  id: string
  name: string
  description?: string
  fuelMassKg: number
  dryMassKg: number
  costCredits: number
  unlockScienceCost?: number
  spriteVariant?: 'small' | 'medium' | 'large' | 'cryo'
}

export interface AerodynamicFin {
  id: string
  name: string
  description: string
  dryMassKg: number
  costCredits: number
  /** How many units this fin shifts the Center of Pressure (CoP) downward toward the tail. */
  copShiftDown: number
  spriteVariant: 'none' | 'standard' | 'grid' | 'delta'
}

export interface LandingSystem {
  id: string
  name: string
  description: string
  type: LandingSystemType
  dryMassKg: number
  costCredits: number
  unlockScienceCost?: number
}

export interface Payload {
  id: string
  name: string
  description?: string
  category?: PayloadCategory
  massKg: number
  costCredits: number
  /** Base electrical power generated at 1 AU (for solar) or constant (for RTG). */
  energyOutputAt1AU?: number
  /** Whether energy output scales with 1/r² solar distance law. */
  scalesWithSolarDistance?: boolean
  /** Electrical power consumed in colony operation. */
  energyConsumption?: number
  /** Credits produced per mission turn when colony net energy >= 0. */
  incomeCreditsPerTurn?: number
  /** Science XP produced per mission turn when colony net energy >= 0. */
  sciencePerTurn?: number
  /** Preferred layer in the 2D cross-section colony view. */
  colonyLayer?: ColonyLayer
  unlockScienceCost?: number
}

export interface Planet {
  id: string
  name: string
  subtitle?: string
  description?: string
  /** Surface gravitational acceleration in metres per second squared (m/s²). */
  gravityMps2: number
  /** Distance from the Sun in Astronomical Units (AU) for 1/r² solar flux calculation. */
  distanceAU?: number
  /** Mean atmospheric surface pressure in bar (0 = vacuum). */
  atmosphereBar?: number
  atmosphereType?: AtmosphereType
  /** Minimum Delta-V (m/s, gamified educational scale) required from Earth launch to reach target. */
  requiredDeltaVMps?: number
  /** Reward credits for first successful mission / standard delivery to this destination. */
  baseRewardCredits?: number
  /** Science XP awarded on successful mission. */
  baseRewardScience?: number
  /** Accent color hex for UI and Canvas rendering. */
  themeColor?: string
  /** Secondary surface color hex for Canvas and Colony terrain. */
  surfaceColor?: string
  /** Official NASA citation string displayed on Learning Cards. */
  nasaCitation?: string
}

export interface Mission {
  id: string
  name: string
  description?: string
  destinationPlanetId: string
  requiredPayloadIds?: string[]
  rewardCredits: number
  rewardScience?: number
  isEmergencyContract?: boolean
}

export interface RocketConfiguration {
  body: RocketBody
  engine: RocketEngine
  fuelTank: FuelTank | null
  payloads: Payload[]
  fin?: AerodynamicFin
  landingSystem?: LandingSystem
  /** Total mass including structure, engine, fuel and payload, in kilograms (kg). */
  totalMassKg: number
  budgetCredits: number
}

export interface AerodynamicStabilityResult {
  /** Center of Mass position from nose (0) to tail (100). Lower number = higher up toward nose. */
  comPosition: number
  /** Center of Pressure position from nose (0) to tail (100). Higher number = lower toward tail. */
  copPosition: number
  /** Positive margin means CoM is safely above/ahead of CoP (stable like a dart). */
  stabilityMargin: number
  isStable: boolean
}

export interface MissionEvaluation {
  isSuccess: boolean
  failureStage: FailureStage
  failureCode: FailureCode
  /** Total wet mass at liftoff (kg). */
  totalMassKg: number
  /** Dry mass after fuel burn (kg). */
  dryMassKg: number
  /** Fuel mass (kg). */
  fuelMassKg: number
  /** Total build cost in credits. */
  totalCostCredits: number
  /** Fuel/test cost lost on launchpad abort or pad failure (15% of total cost). */
  padAbortCostCredits: number
  /** Earth liftoff Thrust-to-Weight Ratio. */
  earthTWR: number
  twrStatus: TWRStatus
  /** Target planet landing Thrust-to-Weight Ratio (using dry mass at arrival). */
  targetLandingTWR: number
  /** Calculated Tsiolkovsky Delta-V (m/s). */
  deltaVMps: number
  /** Required Delta-V for target planet (m/s). */
  requiredDeltaVMps: number
  /** Aerodynamic stability metrics (CoM vs CoP). */
  stability: AerodynamicStabilityResult
  /** Solar efficiency percentage at target planet based on 1/r² law (e.g. 100% at 1 AU, 43.3% at Mars, 3.7% at Europa). */
  solarEfficiencyPercent: number
  /** Projected net energy delta of the payloads being sent if landed at destination. */
  payloadNetEnergyAtTarget: number
  /** Educational feedback card key and summary. */
  learningCard: LearningCard
}

export interface LearningCard {
  code: FailureCode | 'SUCCESS'
  stage: FailureStage
  title: string
  badge: string
  whatHappened: string
  physicsPrinciple: string
  howToFix: string
  formulaText: string
  nasaSource: string
}

export interface ColonyModuleInstance {
  instanceId: string
  payloadId: string
  name: string
  category: PayloadCategory
  layer: ColonyLayer
  slotIndex: number
  installedTurn: number
}

export interface PlanetColony {
  planetId: string
  modules: ColonyModuleInstance[]
}

export interface ColonySummary {
  planetId: string
  solarEfficiencyPercent: number
  energyProduced: number
  energyConsumed: number
  netEnergy: number
  isBlackout: boolean
  incomeCreditsPerTurn: number
  sciencePerTurn: number
  moduleCount: number
}

export interface FlightLogEntry {
  id: string
  turn: number
  planetId: string
  planetName: string
  rocketName: string
  isSuccess: boolean
  failureStage: FailureStage
  failureCode: FailureCode
  costDeltaCredits: number
  scienceEarned: number
}
