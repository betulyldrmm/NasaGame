import type { Base } from './types'

export interface ModuleDef {
  id: string
  name: string
  icon: string
  mass: number
  cost: number
  /** + üretir, − tüketir */
  power: number
  /** ₡ / oyun saati */
  income: number
  /** t maden / oyun saati */
  ore: number
  /** true ise Güneş'e uzaklıktan etkilenmeyen nükleer güç */
  constantPower?: boolean
  desc: string
}

/** Yüzey üssü modülleri. Gelir ve üretim oranları oyun varsayımıdır. */
export const MODULES: ModuleDef[] = [
  { id: 'solar-farm', name: 'Güneş Tarlası', icon: '🔆', mass: 1, cost: 1200, power: 4, income: 0, ore: 0, desc: 'Üsse güç sağlar (Mars\'ta %43, Jüpiter\'de %3.7).' },
  { id: 'telemetry', name: 'Telemetri İstasyonu', icon: '📡', mass: 1, cost: 1200, power: -1, income: 900, ore: 0, desc: 'Yörünge takibi ve uydu kiralama ile sürekli pasif gelir üretir.' },
  { id: 'habitat', name: 'Yaşam Modülü', icon: '🏠', mass: 2, cost: 3000, power: -1, income: 300, ore: 0, desc: 'Mürettebat barındırır; araştırma sözleşmesi geliri getirir.' },
  { id: 'datacenter', name: 'Veri Merkezi', icon: '🖥️', mass: 2, cost: 2800, power: -2, income: 1600, ore: 0, desc: 'Otomatik telemetri işleme tesisi; yüksek pasif gelir üretir.' },
  { id: 'lab', name: 'Bilim Laboratuvarı', icon: '🔬', mass: 2, cost: 4500, power: -2, income: 900, ore: 0, desc: 'Yüksek gelir. Her laboratuvar için bir yaşam modülü gerekir.' },
  { id: 'drill', name: 'Maden Sondajı', icon: '⛏️', mass: 2, cost: 3500, power: -2, income: 0, ore: 0.35, desc: 'Regolit/maden çıkarır. Madeni Dünya\'ya götürüp sat.' },
  { id: 'isru', name: 'ISRU Yakıt Tesisi', icon: '⛽', mass: 2, cost: 5000, power: -2, income: 0, ore: 0, desc: 'Madenden yakıt üretir: inen roketleri yeniden doldurur (1 t maden → 2 t yakıt).' },
  { id: 'rtg-reactor', name: 'Nükleer RTG Reaktörü', icon: '☢️', mass: 2, cost: 6500, power: 16, income: 0, ore: 0, constantPower: true, desc: 'Güneş\'ten bağımsız +16 güç üretir (Ganimed & Titan üsleri için şart).' },
  { id: 'biodome', name: 'Biyodom Kolonisi', icon: '🌱', mass: 3, cost: 9000, power: -4, income: 2800, ore: 0.4, desc: 'Kapalı ekosistem: aynı anda yüksek pasif gelir ve maden çıkarır.' },
  { id: 'quantum-relay', name: 'Kuantum Ticaret Rölesi', icon: '💎', mass: 3, cost: 16000, power: -5, income: 6500, ore: 0, desc: 'Gezegenler arası veri/ticaret ağı ile devasa pasif gelir sağlar.' },
]

export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]))

export const STARTER_EARTH_MODULES: Record<string, number> = {
  'solar-farm': 1,
  telemetry: 1,
  habitat: 1,
}

export function emptyBase(siteAngle: number): Base {
  return { modules: {}, ore: 0, siteAngle, earned: 0 }
}

export interface BaseReport {
  powerSupply: number
  powerDemand: number
  /** 0..1: güç yetmezse tüm tesisler bu oranda çalışır */
  efficiency: number
  incomePerHour: number
  orePerHour: number
  activeLabs: number
  rows: { def: ModuleDef; count: number; income: number; ore: number }[]
}

/** solarFactor: gezegenin Güneş'e uzaklığına göre 1/r² (Ay 1.0, Mars ≈ 0.43). */
export function baseReport(base: Base, solarFactor: number, incomeMult = 1): BaseReport {
  const count = (id: string) => base.modules[id] ?? 0
  let supply = 0
  let demand = 0
  for (const m of MODULES) {
    const c = count(m.id)
    if (m.power > 0) supply += m.power * (m.constantPower ? 1 : solarFactor) * c
    else demand += -m.power * c
  }
  const efficiency = demand <= 0 ? 1 : Math.min(1, supply / demand)
  const activeLabs = Math.min(count('lab'), count('habitat'))
  const rows = MODULES.filter((m) => count(m.id) > 0).map((def) => {
    const c = def.id === 'lab' ? activeLabs : count(def.id)
    return {
      def,
      count: count(def.id),
      income: def.income * c * efficiency * incomeMult,
      ore: def.ore * c * efficiency,
    }
  })
  return {
    powerSupply: supply,
    powerDemand: demand,
    efficiency,
    incomePerHour: rows.reduce((s, r) => s + r.income, 0),
    orePerHour: rows.reduce((s, r) => s + r.ore, 0),
    activeLabs,
    rows,
  }
}

/** Üssü dt oyun saniyesi ilerletir; kazanılan parayı döndürür. */
export function tickBase(base: Base, solarFactor: number, dtS: number, incomeMult = 1, canMine = true): number {
  const rep = baseReport(base, solarFactor, incomeMult)
  const hours = dtS / 3600
  if (canMine) base.ore += rep.orePerHour * hours
  const earned = rep.incomePerHour * hours
  base.earned += earned
  return earned
}
