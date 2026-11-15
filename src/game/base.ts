/**
 * Yüzey kolonisi: yapılar bir sıra yuvaya kurulur ve koloninin elektriğiyle çalışır.
 * Güneş panelinin üretimi Güneş'e uzaklığın karesiyle azalır (ters kare yasası, 1/r²):
 * Ay'da tek panel bir maden aracını çalıştırır, Mars'ta (%43 ışık) yetmez.
 */
import type { Base } from './types'

export const COLONY_SLOTS = 8

export interface ModuleDef {
  id: string
  name: string
  icon: string
  /** public/assets/colony/<sprite>.png */
  sprite: string
  mass: number
  cost: number
  /** + üretir, − tüketir (güç birimi) */
  power: number
  /** ₡ / oyun saati */
  income: number
  /** t maden / oyun saati */
  ore: number
  /** true: Güneş'e uzaklıktan etkilenmez */
  constantPower?: boolean
  /** 1: başlangıç · 2: panel+yaşam küresi+batarya kurulunca · 3: maden aracı+tarla kurulunca */
  tier: 1 | 2 | 3
  desc: string
}

/** Gelir ve üretim oranları oyun varsayımıdır; güç dengesi 1/r² dersini verecek şekilde seçildi. */
export const MODULES: ModuleDef[] = [
  { id: 'solar-farm', name: 'Güneş Paneli', icon: '🔆', sprite: 'solar', mass: 1, cost: 1200, power: 4, income: 0, ore: 0, tier: 1, desc: 'Koloniye elektrik sağlar. Güneş\'ten uzaklaştıkça üretimi düşer.' },
  { id: 'habitat', name: 'Yaşam Küresi', icon: '🏠', sprite: 'habitat', mass: 2, cost: 3000, power: -1, income: 350, ore: 0, tier: 1, desc: 'Kolonicilerin evi. Araştırma sözleşmelerinden gelir getirir.' },
  { id: 'battery', name: 'Batarya', icon: '🔋', sprite: 'battery', mass: 1, cost: 900, power: 1, income: 0, ore: 0, constantPower: true, tier: 1, desc: 'Enerji depolar: Güneş\'ten bağımsız küçük bir yedek güç verir.' },
  { id: 'telemetry', name: 'Telemetri İstasyonu', icon: '📡', sprite: 'telemetry', mass: 1, cost: 1800, power: -1, income: 650, ore: 0, tier: 1, desc: 'Uydu takibiyle sürekli gelir üretir.' },
  { id: 'drill', name: 'Maden Aracı', icon: '⛏️', sprite: 'rover', mass: 2, cost: 3500, power: -3, income: 0, ore: 0.5, tier: 2, desc: 'Yüzeyi kazıp maden çıkarır. Madeni Dünya\'ya götürüp sat.' },
  { id: 'biodome', name: 'Uzay Tarlası', icon: '🌱', sprite: 'farm', mass: 2, cost: 4200, power: -2, income: 700, ore: 0, tier: 2, desc: 'Kapalı serada yiyecek yetiştirir; koloniye düzenli gelir sağlar.' },
  { id: 'sampler', name: 'Örnek Toplayıcı', icon: '🧪', sprite: 'sampler', mass: 1, cost: 2600, power: -1, income: 450, ore: 0, tier: 2, desc: 'Kaya ve toprak örneği toplar; bilim verisi satar.' },
  { id: 'lab', name: 'Bilim Lab', icon: '🔬', sprite: 'lab', mass: 2, cost: 4800, power: -3, income: 1300, ore: 0, tier: 2, desc: 'Deneyler yapar; en yüksek geliri getirir ama çok elektrik ister.' },
  { id: 'rtg-reactor', name: 'Reaktör', icon: '☢️', sprite: 'reactor', mass: 2, cost: 6500, power: 15, income: 0, ore: 0, constantPower: true, tier: 3, desc: 'Güneş\'ten bağımsız bol elektrik. Mars ve ötesi için ideal.' },
  { id: 'isru', name: 'Yakıt Tesisi', icon: '⛽', sprite: 'isru', mass: 2, cost: 5000, power: -2, income: 0, ore: 0, tier: 3, desc: 'Madenden roket yakıtı üretir (1 t maden → 4 t yakıt).' },
  { id: 'colony-station', name: 'Uzay İstasyonu', icon: '🛰️', sprite: 'station', mass: 4, cost: 8000, power: -7, income: 1600, ore: 0, tier: 1, desc: 'Yüksek elektrik ister (-7 ⚡); çalışırken gezegeni kolonileştirir ve kargo taşımadan yerinde inşaatı açar.' },
]

export const COLONY_STATION_ID = 'colony-station'

/** Yalnızca kargo olarak taşınan, koloniye kurulmayan yük: ISS ikmal paketi. */
export const ISS_SUPPLY: ModuleDef = { id: 'iss-supplies', name: 'ISS İkmal Kargosu', icon: '📦', sprite: 'battery', mass: 1, cost: 800, power: 0, income: 0, ore: 0, tier: 1, desc: 'ISS\'e kenetlenip teslim et: paket başına 4.500 ₡ kazandırır.' }
export const ISS_SUPPLY_REWARD = 4500

export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries([...MODULES, ISS_SUPPLY].map((m) => [m.id, m]))

/** Eski kayıtlardaki kaldırılmış yapı kimlikleri. */
const LEGACY_IDS: Record<string, string> = { datacenter: 'lab', 'quantum-relay': 'lab' }

/** Dünya'da yalnızca yer tesisleri kurulur; yaşam küresi, tarla, maden aracı vb. uzay kolonileri içindir. */
export const EARTH_MODULES = ['solar-farm', 'battery', 'telemetry', 'lab']

export const STARTER_EARTH_SITES: (string | null)[] = ['solar-farm', 'telemetry', 'telemetry', null, null, null, null, null]

export function syncModules(base: Base) {
  const counts: Record<string, number> = {}
  for (const id of base.sites ?? []) if (id) counts[id] = (counts[id] ?? 0) + 1
  base.modules = counts
}

/** Eski (sayaç / 4×4 grid) kayıtları yuva düzenine çevirir. */
export function ensureSites(base: Base): (string | null)[] {
  if (Array.isArray(base.sites) && base.sites.length === COLONY_SLOTS) return base.sites
  const sites: (string | null)[] = Array.from({ length: COLONY_SLOTS }, () => null)
  let i = 0
  const order = MODULES.map((m) => m.id)
  const counts: Record<string, number> = {}
  for (const [rawId, n] of Object.entries(base.modules ?? {})) {
    const id = LEGACY_IDS[rawId] ?? rawId
    if (MODULE_BY_ID[id]) counts[id] = (counts[id] ?? 0) + n
  }
  for (const id of order) {
    for (let k = 0; k < (counts[id] ?? 0) && i < COLONY_SLOTS; k += 1) {
      sites[i] = id
      i += 1
    }
  }
  base.sites = sites
  base.stock ??= {}
  delete base.grid
  syncModules(base)
  return sites
}

export function emptyBase(siteAngle: number, ownerId?: string): Base {
  return { modules: {}, sites: Array.from({ length: COLONY_SLOTS }, () => null), stock: {}, ore: 0, siteAngle, earned: 0, ownerId }
}

/** Koloninin ulaştığı kademe: hangi yapıların kurulabileceğini belirler. */
export function colonyTier(base: Base | undefined): 1 | 2 | 3 {
  const has = (id: string) => (base?.modules[id] ?? 0) > 0
  if (!(has('solar-farm') && has('habitat') && has('battery'))) return 1
  if (!(has('drill') && has('biodome'))) return 2
  return 3
}

export const TIER_HINT: Record<number, string> = {
  2: 'Önce Güneş Paneli, Yaşam Küresi ve Batarya kur.',
  3: 'Önce Maden Aracı ve Uzay Tarlası kur.',
}

export interface SiteReport {
  id: string | null
  /** tüketici ise elektriği yetti mi (üreticiler ve boş yuvalar için true) */
  powered: boolean
}

export interface BaseReport {
  powerSupply: number
  powerDemand: number
  /** çalışan tüketicilerin oranı (0..1) */
  efficiency: number
  incomePerHour: number
  orePerHour: number
  sites: SiteReport[]
  /** elektriksiz kalan yapı sayısı */
  unpowered: number
}

/**
 * solarFactor: Güneş'e uzaklığa göre 1/r² (Dünya/Ay 1.0, Mars ≈ 0.43).
 * Elektrik yuva sırasına göre dağıtılır; yetmeyen yapı durur.
 */
export function baseReport(base: Base, solarFactor: number, incomeMult = 1): BaseReport {
  const sites = ensureSites(base)
  let supply = 0
  let demand = 0
  for (const id of sites) {
    const m = id ? MODULE_BY_ID[id] : null
    if (!m) continue
    if (m.power > 0) supply += m.power * (m.constantPower ? 1 : solarFactor)
    else demand += -m.power
  }
  let left = supply + 1e-9
  let income = 0
  let ore = 0
  let consumers = 0
  let running = 0
  const out: SiteReport[] = sites.map((id) => {
    const m = id ? MODULE_BY_ID[id] : null
    if (!m || m.power >= 0) return { id, powered: true }
    consumers += 1
    const need = -m.power
    if (left < need) return { id, powered: false }
    left -= need
    running += 1
    income += m.income * incomeMult
    ore += m.ore
    return { id, powered: true }
  })
  return {
    powerSupply: supply, powerDemand: demand, efficiency: consumers ? running / consumers : 1,
    incomePerHour: income, orePerHour: ore, sites: out, unpowered: consumers - running,
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

export type StationStatus = 'none' | 'unpowered' | 'active'

/** Gezegen yüzeyinde elektriği yeten aktif bir Uzay İstasyonu varsa gezegen kolonileşmiştir. */
export function isBodyColonized(base: Base | undefined, solarFactor: number): boolean {
  if (!base) return false
  if (!(base.modules[COLONY_STATION_ID] ?? 0)) return false
  const rep = baseReport(base, solarFactor)
  return rep.sites.some((s) => s.id === COLONY_STATION_ID && s.powered)
}

export function colonyStationStatus(base: Base | undefined, solarFactor: number): StationStatus {
  if (!base || !(base.modules[COLONY_STATION_ID] ?? 0)) return 'none'
  return isBodyColonized(base, solarFactor) ? 'active' : 'unpowered'
}
