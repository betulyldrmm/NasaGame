import type { FuelTank, Payload, Planet, RocketBody, RocketEngine } from './types'

/** Component masses, thrust values, costs, and budget are illustrative game assumptions. */
export const INITIAL_BUDGET_CREDITS = 1_000

export const ROCKET_BODIES: RocketBody[] = [
  { id: 'body-scout', name: 'Hafif Keşif', cargoSlots: 1, dryMassKg: 800, costCredits: 120 },
  { id: 'body-explorer', name: 'Orta Görev', cargoSlots: 2, dryMassKg: 1_600, costCredits: 220 },
  { id: 'body-carrier', name: 'Ağır Koloni', cargoSlots: 4, dryMassKg: 3_000, costCredits: 350 },
]

export const ROCKET_ENGINES: RocketEngine[] = [
  { id: 'engine-spark', name: 'Spark', thrustN: 30_000, fuelConsumptionKgPerSecond: 10.2, dryMassKg: 250, costCredits: 100 },
  { id: 'engine-voyager', name: 'Voyager', thrustN: 75_000, fuelConsumptionKgPerSecond: 25.5, dryMassKg: 500, costCredits: 210 },
  { id: 'engine-titan', name: 'Titan', thrustN: 150_000, fuelConsumptionKgPerSecond: 51, dryMassKg: 900, costCredits: 380 },
]

export const FUEL_TANKS: FuelTank[] = [
  { id: 'tank-compact', name: 'Kompakt tank', fuelMassKg: 300, dryMassKg: 100, costCredits: 60 },
  { id: 'tank-standard', name: 'Standart tank', fuelMassKg: 700, dryMassKg: 180, costCredits: 110 },
  { id: 'tank-extended', name: 'Genişletilmiş tank', fuelMassKg: 1_200, dryMassKg: 280, costCredits: 170 },
]

export const PAYLOADS: Payload[] = [
  { id: 'solar-panel', name: 'Güneş paneli', massKg: 180, costCredits: 90 },
  { id: 'rover', name: 'Maden aracı', massKg: 420, costCredits: 180 },
  { id: 'greenhouse', name: 'Sera modülü', massKg: 650, costCredits: 240 },
  { id: 'habitat', name: 'Yaşam modülü', massKg: 900, costCredits: 300 },
]

/** Mean/representative surface gravity, rounded for gameplay; see docs/nasa-data-usage.md. */
export const PLANETS: Planet[] = [
  { id: 'earth', name: 'Dünya', gravityMps2: 9.81, distanceAU: 1.0 },
  { id: 'moon', name: 'Ay', gravityMps2: 1.62, distanceAU: 1.0 },
  { id: 'mars', name: 'Mars', gravityMps2: 3.71, distanceAU: 1.52 },
]
