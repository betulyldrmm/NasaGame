import { PLANETS } from '../game/data'
import { calculateRocketCost, calculateTWR } from '../game/calculations'
import { calculateAssemblyTWR } from '../game/assemblyStore'
import type { Planet, RocketConfiguration } from '../game/types'
import { calculateDeltaVCapacityMps, type FlightState } from './physics'

export type MissionDestination = Planet & {
  atmosphere: 'none' | 'thin'
  /** Simplified game target in metres per second, not a real transfer requirement. */
  requiredDeltaVms: number
}

export interface LandingEquipment {
  parachute: boolean
  heatShield: boolean
  poweredDescent: boolean
}

export interface MissionPayload {
  landingEquipment: LandingEquipment
}

export interface MissionLearningCard {
  title: string
  explanation: string
}

export interface MissionEvaluation {
  success: boolean
  metrics: {
    launchTwr: number
    deltaVCapacityMps: number
    deltaVRequiredMps: number
    destinationGravityMps2: number
    landingTwr: number
    maximumAltitudeM: number | null
    maximumSpeedMps: number | null
    remainingFuelKg: number
    rocketCostCredits: number
  }
  failureReasons: string[]
  learningCards: MissionLearningCard[]
}

/** NASA surface gravity and qualitative atmosphere facts; delta-v thresholds are game assumptions. */
export const GAME_DELTA_V_REQUIREMENTS_MS = {
  moon: 600,
  mars: 1_000,
} as const

export const MISSION_DESTINATIONS: MissionDestination[] = [
  {
    ...PLANETS.find((planet) => planet.id === 'moon')!,
    atmosphere: 'none',
    requiredDeltaVms: GAME_DELTA_V_REQUIREMENTS_MS.moon,
  },
  {
    ...PLANETS.find((planet) => planet.id === 'mars')!,
    atmosphere: 'thin',
    requiredDeltaVms: GAME_DELTA_V_REQUIREMENTS_MS.mars,
  },
]

export function evaluateMission(
  rocket: RocketConfiguration,
  destination: MissionDestination,
  payload: MissionPayload,
  flight: FlightState | null = null,
): MissionEvaluation {
  const launchTwr = calculateAssemblyTWR(rocket)
  const deltaVCapacityMps = calculateDeltaVCapacityMps(rocket)
  const landingTwr = calculateTWR(rocket.engine.thrustN, rocket.totalMassKg, destination.gravityMps2)
  const equipment = payload.landingEquipment
  const failureReasons: string[] = []

  if (launchTwr < 1) {
    failureReasons.push('Motor itkin, roketin Dünya yüzeyindeki ağırlığını yenemedi; roket rampadan kalkamadı.')
  }
  if (deltaVCapacityMps < destination.requiredDeltaVms) {
    failureReasons.push('Mevcut yakıt ve motor, bu oyun senaryosunun manevra kapasitesi hedefini karşılamıyor.')
  }
  if (landingTwr < 1 && equipment.poweredDescent) {
    failureReasons.push('Seçilen motor, hedefte roket ağırlığını denetimli alçalma için yenemiyor.')
  }

  if (destination.atmosphere === 'none') {
    if (!equipment.poweredDescent) {
      failureReasons.push(
        equipment.parachute
          ? 'Ay’da anlamlı bir atmosfer olmadığı için paraşüt yavaşlatma sağlayamaz; motorlu iniş sistemi gerekir.'
          : 'Ay’da anlamlı bir atmosfer olmadığı için iniş paraşütle yapılamaz; motorlu iniş sistemi gerekir.',
      )
    }
  } else {
    if (!equipment.heatShield) failureReasons.push('Mars atmosferine girişte ısı kalkanı gerekir.')
    if (!equipment.poweredDescent) {
      failureReasons.push('Mars’ın ince atmosferinde paraşüt tek başına inişi tamamlayamaz; motorlu frenleme gerekir.')
    }
  }

  if (flight?.status === 'liftoff-failed' && launchTwr >= 1) {
    failureReasons.push('Uçuş modeli kalkış koşulunu sağlayamadı; motor, kütle ve yerçekimi değerlerini yeniden incele.')
  }
  if (flight?.status === 'impact') {
    failureReasons.push(
      'Roket yükseliş sırasında yeniden yüzeye indi; bu görev modeli hedefe erişim için yeterli uçuş kapasitesi göstermedi.',
    )
  }

  const learningCards: MissionLearningCard[] = [
    {
      title: 'İtki / ağırlık oranı',
      explanation:
        launchTwr < 1
          ? 'TWR 1’in altındaysa başlangıç itkisi ağırlığı dengeleyemez. 1’in üzerinde olması da tek başına yörünge veya görev başarısı garantisi değildir.'
          : 'Başlangıç TWR değerin 1’in üzerinde. Bu yalnızca ilk dikey kalkış koşulunu anlatır; yörüngeye ulaşmayı garanti etmez.',
    },
    {
      title: 'Delta‑V bir kapasite ölçüsüdür',
      explanation: `Bu oyun senaryosu ${Math.round(deltaVCapacityMps)} m/s kapasiteyi ${destination.requiredDeltaVms} m/s hedefiyle karşılaştırır. Hedef değeri gerçek bir transfer yörüngesi hesabı değildir.`,
    },
    {
      title: 'Atmosfer iniş tasarımını değiştirir',
      explanation:
        destination.atmosphere === 'none'
          ? 'Ay’da paraşütü çalıştıracak anlamlı bir atmosfer yoktur; alçalmayı motorlu sistemle denetlemek gerekir.'
          : 'Mars’ın atmosferi paraşüte katkı sağlayabilir ama tek başına güvenli iniş için yeterli değildir; ısı kalkanı ve motorlu frenleme gerekir.',
    },
  ]

  return {
    success: failureReasons.length === 0,
    metrics: {
      launchTwr,
      deltaVCapacityMps,
      deltaVRequiredMps: destination.requiredDeltaVms,
      destinationGravityMps2: destination.gravityMps2,
      landingTwr,
      maximumAltitudeM: flight?.maxAltitudeM ?? null,
      maximumSpeedMps: flight?.maxSpeedMps ?? null,
      remainingFuelKg: flight?.fuelRemainingKg ?? rocket.fuelTank?.fuelMassKg ?? 0,
      rocketCostCredits: calculateRocketCost(rocket),
    },
    failureReasons,
    learningCards,
  }
}
