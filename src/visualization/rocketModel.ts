import type { FuelTank, Payload, RocketBody, RocketEngine } from '../game/types'

export interface RocketModelSpec {
  bodyRadius: number
  bodyLength: number
  bodyColor: string
  tankRadius: number
  tankLength: number
  engineRadius: number
  engineLength: number
  payloads: Array<{ id: Payload['id']; color: string; index: number }>
}

const bodyProfiles: Record<number, Pick<RocketModelSpec, 'bodyRadius' | 'bodyLength' | 'bodyColor'>> = {
  1: { bodyRadius: 0.42, bodyLength: 2.4, bodyColor: '#c7d6e8' },
  2: { bodyRadius: 0.57, bodyLength: 3.5, bodyColor: '#b7d1e8' },
  4: { bodyRadius: 0.73, bodyLength: 4.6, bodyColor: '#c7c5e8' },
}

const engineProfiles: Record<string, Pick<RocketModelSpec, 'engineRadius' | 'engineLength'>> = {
  'engine-spark': { engineRadius: 0.36, engineLength: 0.48 },
  'engine-voyager': { engineRadius: 0.48, engineLength: 0.64 },
  'engine-titan': { engineRadius: 0.62, engineLength: 0.82 },
}

const payloadColors: Record<Payload['id'], string> = {
  'solar-panel': '#38d9e8',
  rover: '#ffad57',
  greenhouse: '#4ade80',
  habitat: '#c4a7ff',
}

/** Converts the existing assembly selection into visual dimensions only; no gameplay math lives here. */
export function getRocketModelSpec(
  body: RocketBody,
  engine: RocketEngine,
  tank: FuelTank | null,
  payloads: Payload[],
): RocketModelSpec {
  const bodyProfile = bodyProfiles[body.cargoSlots] ?? bodyProfiles[2]!
  const engineProfile = engineProfiles[engine.id] ?? {
    engineRadius: Math.max(0.34, Math.min(0.64, engine.thrustN / 240_000)),
    engineLength: Math.max(0.46, Math.min(0.84, engine.thrustN / 180_000)),
  }
  const tankRatio = tank ? Math.max(0, Math.min(1, tank.fuelMassKg / 1_200)) : 0

  return {
    ...bodyProfile,
    ...engineProfile,
    tankRadius: tank ? bodyProfile.bodyRadius * 0.88 : 0,
    tankLength: tank ? 0.38 + tankRatio * 0.74 : 0,
    payloads: payloads.slice(0, body.cargoSlots).map((payload, index) => ({
      id: payload.id,
      color: payloadColors[payload.id],
      index,
    })),
  }
}
