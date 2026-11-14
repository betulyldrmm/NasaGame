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
  desc: string
}

/** Yüzey üssü modülleri. Gelir ve üretim oranları oyun varsayımıdır. */
export const MODULES: ModuleDef[] = [
  { id: 'solar-farm', name: 'Güneş Tarlası', icon: '🔆', mass: 1, cost: 1200, power: 4, income: 0, ore: 0, desc: 'Üsse güç sağlar (Mars\'ta 1/r² nedeniyle %43).' },
  { id: 'habitat', name: 'Yaşam Modülü', icon: '🏠', mass: 2, cost: 3000, power: -1, income: 45, ore: 0, desc: 'Mürettebat barındırır; araştırma sözleşmesi geliri getirir.' },
  { id: 'lab', name: 'Bilim Laboratuvarı', icon: '🔬', mass: 2, cost: 4500, power: -2, income: 130, ore: 0, desc: 'Yüksek gelir. Her laboratuvar için bir yaşam modülü gerekir.' },
  { id: 'drill', name: 'Maden Sondajı', icon: '⛏️', mass: 2, cost: 3500, power: -2, income: 0, ore: 0.3, desc: 'Regolit/maden çıkarır. Madeni Dünya\'ya götürüp sat.' },
  { id: 'isru', name: 'ISRU Yakıt Tesisi', icon: '⛽', mass: 2, cost: 5000, power: -2, income: 0, ore: 0, desc: 'Madenden yakıt üretir: inen roketleri yeniden doldurur (1 t maden → 2 t yakıt).' },
]

export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]))

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
export function baseReport(base: Base, solarFactor: number): BaseReport {
  const count = (id: string) => base.modules[id] ?? 0
  let supply = 0
  let demand = 0
  for (const m of MODULES) {
    const c = count(m.id)
    if (m.power > 0) supply += m.power * solarFactor * c
    else demand += -m.power * c
  }
  const efficiency = demand <= 0 ? 1 : Math.min(1, supply / demand)
  const activeLabs = Math.min(count('lab'), count('habitat'))
  const rows = MODULES.filter((m) => count(m.id) > 0).map((def) => {
    const c = def.id === 'lab' ? activeLabs : count(def.id)
    return { def, count: count(def.id), income: def.income * c * efficiency, ore: def.ore * c * efficiency }
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
export function tickBase(base: Base, solarFactor: number, dtS: number): number {
  const rep = baseReport(base, solarFactor)
  const hours = dtS / 3600
  base.ore += rep.orePerHour * hours
  const earned = rep.incomePerHour * hours
  base.earned += earned
  return earned
}
