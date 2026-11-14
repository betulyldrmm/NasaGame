/** Teknoloji ağacı: yeni roket parçaları, üs modülleri, iniş asistanı ve pasif gelir çarpanları. */
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

export const TECHS: TechNode[] = [
  {
    id: 'basic-rocketry',
    tier: 0,
    name: 'Temel Uzay Mühendisliği',
    icon: '🚀',
    cost: 0,
    requires: [],
    desc: 'Standart üç kademeli roket parçaları ve Dünya başlangıç telemetri üssü.',
    effects: ['Selene I roket parçaları', 'Dünya Telemetri İstasyonu & Yaşam Modülü'],
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
    name: 'Otomatik Yer Operasyonları',
    icon: '📡',
    cost: 4500,
    requires: ['basic-rocketry'],
    desc: 'Dünya ve gezegen üslerindeki pasif gelir akışını otomatikleştirir.',
    effects: ['+%35 tüm üslerde pasif gelir', 'Veri Merkezi modülü açılır'],
    modules: ['datacenter'],
  },
  {
    id: 'adv-landing',
    tier: 1,
    name: 'Gelişmiş İniş ve Atmosfer',
    icon: '🛸',
    cost: 6500,
    requires: ['basic-rocketry'],
    desc: 'Venüs, Mars ve kayalık dünyalara iniş ve geri kalkış için güçlendirilmiş donanım.',
    effects: ['Aerospike Motor (yoğun atmosferde güçlü)', 'Ağır İniş Ayağı (24 m/s)', 'Süper Tank XXL (14 t)'],
    parts: ['aerospike', 'heavy-leg', 'tank-xxl'],
  },
  {
    id: 'auto-land',
    tier: 2,
    name: 'Otomatik İniş Bilgisayarı',
    icon: '🤖',
    cost: 8000,
    requires: ['adv-landing'],
    desc: 'Yörüngeden alçalırken aracı dikey tutup gazı ayarlayarak güvenli iniş yapar.',
    effects: ['Uçuş HUD\'ında Oto-İniş (L) modu açılır'],
  },
  {
    id: 'mining-isru',
    tier: 2,
    name: 'Derin Madencilik ve ISRU',
    icon: '⛏️',
    cost: 12000,
    requires: ['idle-ops'],
    desc: 'Diğer gezegenlerde maden çıkarma, yerinde yakıt üretimi ve bilim laboratuvarları.',
    effects: ['Maden Sondajı, ISRU & Bilim Lab açılır', '+%25 maden satış fiyatı'],
    modules: ['lab', 'drill', 'isru'],
  },
  {
    id: 'ion-power',
    tier: 2,
    name: 'İyon İtkisi ve RTG Gücü',
    icon: '⚡',
    cost: 16000,
    requires: ['adv-landing'],
    desc: 'Dış gezegenlerde güneş ışığı azaldığında bile çalışan nükleer pil ve iyon motoru.',
    effects: ['İyon Motoru & Geniş Güneş Paneli', 'RTG Nükleer Pil (Güneş\'siz güç)'],
    parts: ['ion', 'solar-xl', 'rtg'],
  },
  {
    id: 'heavy-cargo',
    tier: 2,
    name: 'Ağır Kargo Lojistiği',
    icon: '📦',
    cost: 20000,
    requires: ['adv-landing'],
    desc: 'Büyük üs modüllerini ve bol maden yüklerini tek seferde taşıyın.',
    effects: ['Büyük Kargo Gövdesi (10 t)', 'Yapay Zeka Sondası'],
    parts: ['cargo-lg', 'probe-ai'],
  },
  {
    id: 'nuclear-prop',
    tier: 3,
    name: 'NERVA Nükleer İtki',
    icon: '☢️',
    cost: 38000,
    requires: ['ion-power', 'heavy-cargo'],
    desc: 'Yüksek vakum özgül itkisi (760 s) ile Ceres, Ganimed ve Titan seferlerini kolaylaştırır.',
    effects: ['NERVA Nükleer Motor (140 kN, 760 s Isp)'],
    parts: ['nerva'],
  },
  {
    id: 'deep-colonies',
    tier: 3,
    name: 'Dış Gezegen Kolonizasyonu',
    icon: '🌱',
    cost: 48000,
    requires: ['mining-isru', 'ion-power'],
    desc: 'Jüpiter ve Satürn uydularında güneşsiz yaşayabilen kendi kendine yeterli koloniler.',
    effects: ['Nükleer Üs Reaktörü (+16 sabit güç) & Biyodom', '+%50 Dünya dışı üs pasif geliri'],
    modules: ['rtg-reactor', 'biodome'],
  },
  {
    id: 'interplanetary-net',
    tier: 4,
    name: 'Gezegenler Arası Ticaret Ağı',
    icon: '💎',
    cost: 95000,
    requires: ['nuclear-prop', 'deep-colonies'],
    desc: 'Tüm Güneş Sistemi üslerini birbirine bağlayan kuantum ekonomi ağı.',
    effects: ['Kuantum Ticaret Rölesi açılır', '+%100 tüm pasif gelirler & +%50 maden değeri'],
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
  return gs.techDone.includes(techId)
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
  return !tid || gs.techDone.includes(tid)
}

export function isModuleUnlocked(gs: GameState, moduleId: string): boolean {
  const tid = MODULE_TECH.get(moduleId)
  return !tid || gs.techDone.includes(tid)
}

export function hasAutoLandTech(gs: GameState): boolean {
  return gs.techDone.includes('auto-land')
}

export function baseIncomeMultiplier(gs: GameState, bodyId: BodyId): number {
  let mult = BODIES[bodyId].incomeMult || 1
  if (gs.techDone.includes('idle-ops')) mult *= 1.35
  if (bodyId !== 'earth' && gs.techDone.includes('deep-colonies')) mult *= 1.5
  if (gs.techDone.includes('interplanetary-net')) mult *= 2.0
  return mult
}

export function orePriceMultiplier(gs: GameState): number {
  let mult = 1
  if (gs.techDone.includes('mining-isru')) mult *= 1.25
  if (gs.techDone.includes('interplanetary-net')) mult *= 1.5
  return mult
}

export function canUnlockTech(gs: GameState, techId: string): { ok: boolean; reason?: string } {
  const node = TECH_BY_ID[techId]
  if (!node) return { ok: false, reason: 'Bilinmeyen teknoloji.' }
  if (gs.techDone.includes(techId)) return { ok: false, reason: 'Zaten araştırıldı.' }
  for (const req of node.requires) {
    if (!gs.techDone.includes(req)) {
      return { ok: false, reason: `Önce "${TECH_BY_ID[req]?.name ?? req}" açılmalı.` }
    }
  }
  if (gs.money < node.cost) {
    return { ok: false, reason: `${node.cost.toLocaleString('tr-TR')} ₡ gerekli.` }
  }
  return { ok: true }
}

export function unlockTech(gs: GameState, techId: string): string | null {
  const check = canUnlockTech(gs, techId)
  if (!check.ok) return check.reason ?? 'Araştırma açılamadı.'
  const node = TECH_BY_ID[techId]!
  gs.money -= node.cost
  gs.techDone = [...gs.techDone, techId]
  return null
}
