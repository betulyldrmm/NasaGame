/** Teknoloji ağacı: 6 sade araştırma düğümüyle roket parçaları, Oto-İniş ve koloni bonusları. */
import { BODIES, type BodyId } from '../nasa/bodies'
import type { GameState } from './types'

export interface TechNode {
  id: string
  tier: number
  name: string
  icon: string
  cost: number
  requires: string[]
  desc: string
  effects: string[]
  parts?: string[]
  modules?: string[]
}

export const INITIAL_TECH = 'basic-rocketry'

export const TECH_MIGRATION: Record<string, string> = {
  'auto-land': 'adv-landing',
  'heavy-cargo': 'adv-landing',
  'mining-isru': 'idle-ops',
  'nuclear-prop': 'ion-power',
}

export const TECHS: TechNode[] = [
  {
    id: 'basic-rocketry',
    tier: 0,
    name: 'Temel Roketçilik',
    icon: '🚀',
    cost: 0,
    requires: [],
    desc: 'Üç hazır roket, temel parçalar ve Dünya başlangıç üssü.',
    effects: ['Selene I, Pioneer ve Atlas Kargo', 'Dünya Telemetri İstasyonu & Yaşam Modülü'],
    parts: [
      'capsule', 'probe', 'nose',
      'tank-s', 'tank-m', 'tank-l', 'tank-xl', 'tank-slim',
      'titan', 'hawk', 'frontier', 'kolibri',
      'decoupler', 'radial',
      'solar', 'battery', 'rcs',
      'chute', 'leg', 'cargo',
    ],
    modules: ['solar-farm', 'telemetry', 'habitat'],
  },
  {
    id: 'idle-ops',
    tier: 1,
    name: 'Otomatik Üs & Maden',
    icon: '📡',
    cost: 3500,
    requires: ['basic-rocketry'],
    desc: 'Pasif gelir tesislerini, bilim laboratuvarını ve madenciliği açar.',
    effects: ['+%25 tüm pasif gelir & +%25 maden değeri', 'Veri Merkezi, Bilim Lab, Sondaj & ISRU'],
    modules: ['datacenter', 'lab', 'drill', 'isru'],
  },
  {
    id: 'adv-landing',
    tier: 1,
    name: 'Oto-İniş & Ağır Gövde',
    icon: '🤖',
    cost: 4000,
    requires: ['basic-rocketry'],
    desc: 'Otomatik İniş Bilgisayarı ve yüksek kapasiteli iniş/kargo donanımları.',
    effects: ['Oto-İniş (L) asistanı açılır', 'Aerospike, Ağır Ayak, Tank XXL, Büyük Kargo & YZ Sonda'],
    parts: ['aerospike', 'heavy-leg', 'tank-xxl', 'cargo-lg', 'probe-ai'],
  },
  {
    id: 'ion-power',
    tier: 2,
    name: 'Derin Uzay & Nükleer İtki',
    icon: '☢️',
    cost: 14000,
    requires: ['adv-landing'],
    desc: 'Ceres, Ganimed ve Titan seferleri için yüksek verimli motor ve nükleer güç.',
    effects: ['İyon Motoru & NERVA Nükleer Motor (760 s Isp)', 'RTG Nükleer Pil & Geniş Güneş Paneli'],
    parts: ['ion', 'nerva', 'solar-xl', 'rtg'],
  },
  {
    id: 'deep-colonies',
    tier: 2,
    name: 'Dış Gezegen Kolonileri',
    icon: '🌱',
    cost: 16000,
    requires: ['idle-ops'],
    desc: 'Güneş ışığının az olduğu gezegenlerde kendi kendine yeten büyük koloniler.',
    effects: ['+%50 Dünya dışı koloni pasif geliri', 'RTG Üs Reaktörü (+20 güç) & Biyodom'],
    modules: ['rtg-reactor', 'biodome'],
  },
  {
    id: 'interplanetary-net',
    tier: 3,
    name: 'Kuantum Uzay Ağı',
    icon: '💎',
    cost: 45000,
    requires: ['ion-power', 'deep-colonies'],
    desc: 'Tüm Güneş Sistemi kolonilerini bağlayan nihai ticaret ve telemetri ağı.',
    effects: ['+%60 tüm pasif gelirler & +%50 maden değeri', 'Kuantum Ticaret Rölesi açılır'],
    modules: ['quantum-relay'],
  },
]

export const TECH_BY_ID: Record<string, TechNode> = Object.fromEntries(TECHS.map((t) => [t.id, t]))

const PART_TECH = new Map<string, string>()
const MODULE_TECH = new Map<string, string>()
for (const t of TECHS) {
  for (const p of t.parts ?? []) PART_TECH.set(p, t.id)
  for (const m of t.modules ?? []) MODULE_TECH.set(m, t.id)
}

export function isTechDone(gs: GameState, techId: string): boolean {
  const target = TECH_MIGRATION[techId] ?? techId
  return gs.techDone.some((id) => (TECH_MIGRATION[id] ?? id) === target)
}

export function requiredTechForPart(partId: string): TechNode | null {
  const tid = PART_TECH.get(partId)
  return tid ? TECH_BY_ID[tid] ?? null : null
}

export function requiredTechForModule(moduleId: string): TechNode | null {
  const tid = MODULE_TECH.get(moduleId)
  return tid ? TECH_BY_ID[tid] ?? null : null
}

export function isPartUnlocked(gs: GameState, partId: string): boolean {
  const tid = PART_TECH.get(partId)
  return !tid || isTechDone(gs, tid)
}

export function isModuleUnlocked(gs: GameState, moduleId: string): boolean {
  const tid = MODULE_TECH.get(moduleId)
  return !tid || isTechDone(gs, tid)
}

export function hasAutoLandTech(gs: GameState): boolean {
  return isTechDone(gs, 'adv-landing')
}

export function baseIncomeMultiplier(gs: GameState, bodyId: BodyId): number {
  let mult = BODIES[bodyId].incomeMult || 1
  if (isTechDone(gs, 'idle-ops')) mult *= 1.25
  if (bodyId !== 'earth' && isTechDone(gs, 'deep-colonies')) mult *= 1.5
  if (isTechDone(gs, 'interplanetary-net')) mult *= 1.6
  return mult
}

export function orePriceMultiplier(gs: GameState): number {
  let mult = 1
  if (isTechDone(gs, 'idle-ops')) mult *= 1.25
  if (isTechDone(gs, 'interplanetary-net')) mult *= 1.5
  return mult
}

export function canUnlockTech(gs: GameState, techId: string): { ok: boolean; reason?: string } {
  const node = TECH_BY_ID[techId]
  if (!node) return { ok: false, reason: 'Bilinmeyen teknoloji.' }
  if (isTechDone(gs, techId)) return { ok: false, reason: 'Zaten araştırıldı.' }
  for (const req of node.requires) {
    if (!isTechDone(gs, req)) {
      return { ok: false, reason: `Önce "${TECH_BY_ID[req]?.name ?? req}" açılmalı.` }
    }
  }
  if (gs.money < node.cost) {
    return { ok: false, reason: `${node.cost.toLocaleString('tr-TR')} ₡ gerekli.` }
  }
  return { ok: true }
}

export function hasAffordableTech(gs: GameState): boolean {
  return TECHS.some((t) => canUnlockTech(gs, t.id).ok)
}

export function unlockTech(gs: GameState, techId: string): string | null {
  const check = canUnlockTech(gs, techId)
  if (!check.ok) return check.reason ?? 'Araştırma açılamadı.'
  const node = TECH_BY_ID[techId]!
  gs.money -= node.cost
  gs.techDone = [...new Set([...gs.techDone, techId])]
  return null
}
