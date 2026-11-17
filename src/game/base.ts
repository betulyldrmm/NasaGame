/**
 * Yüzey kolonisi: yapılar bir sıra yuvaya kurulur ve koloninin elektriğiyle çalışır.
 * Güneş panelinin üretimi Güneş'e uzaklığın karesiyle azalır (ters kare yasası, 1/r²):
 * Ay'da tek panel bir maden aracını çalıştırır, Mars'ta (%43 ışık) yetmez.
 */
import type { Base } from './types'

export const COLONY_SLOTS = 12

export type QuadrantId = 0 | 1 | 2 | 3
export const QUADRANTS: QuadrantId[] = [0, 1, 2, 3]
export const QUADRANT_NAMES = ['Kuzey (Q1)', 'Doğu (Q2)', 'Güney (Q3)', 'Batı (Q4)'] as const
export const QUADRANT_SHORT = ['Q1 Kuzey', 'Q2 Doğu', 'Q3 Güney', 'Q4 Batı'] as const
const QUAD_CENTERS = [Math.PI / 2, 0, -Math.PI / 2, Math.PI] as const

export function quadrantCenterAngle(q: QuadrantId): number {
  return QUAD_CENTERS[q]
}

/** Açı değerini en yakın gezegen çeyreğine (0: Kuzey, 1: Doğu, 2: Güney, 3: Batı) eşler. */
export function quadrantOfAngle(theta: number): QuadrantId {
  let t = (theta + Math.PI) % (2 * Math.PI)
  if (t < 0) t += 2 * Math.PI
  t -= Math.PI
  if (t >= Math.PI / 4 && t < (3 * Math.PI) / 4) return 0
  if (t >= -Math.PI / 4 && t < Math.PI / 4) return 1
  if (t >= -(3 * Math.PI) / 4 && t < -Math.PI / 4) return 2
  return 3
}

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
  /** Savaş modunda yapı canı */
  hp: number
  /** true: yalnızca Uzay Savaşı modunda görünür */
  warfare?: boolean
}

/** Gelir ve üretim oranları gerçek zamanlı dakika başınadır; güç dengesi 1/r² dersini verecek şekilde seçildi. */
export const MODULES: ModuleDef[] = [
  { id: 'solar-farm', name: 'Güneş Paneli', icon: '🔆', sprite: 'solar', mass: 1, cost: 1200, power: 4, income: 0, ore: 0, tier: 1, hp: 140, desc: 'Koloniye elektrik sağlar. Güneş\'ten uzaklaştıkça üretimi düşer.' },
  { id: 'battery', name: 'Batarya', icon: '🔋', sprite: 'battery', mass: 1, cost: 900, power: 1, income: 0, ore: 0, constantPower: true, tier: 1, hp: 180, desc: 'Enerji depolar: Güneş\'ten bağımsız küçük bir yedek güç verir.' },
  { id: 'telemetry', name: 'Telemetri İstasyonu', icon: '📡', sprite: 'telemetry', mass: 1, cost: 1600, power: -1, income: 1500, ore: 0, tier: 1, hp: 200, desc: 'Uydu takibiyle dakikada +1.500 ₡ düzenli gelir üretir.' },
  { id: 'habitat', name: 'Yaşam Küresi', icon: '🏠', sprite: 'habitat', mass: 2, cost: 2600, power: -1, income: 2600, ore: 0, tier: 1, hp: 320, desc: 'Kolonicilerin evi. Araştırma sözleşmelerinden dakikada +2.600 ₡ gelir getirir.' },
  { id: 'drill', name: 'Maden Aracı', icon: '⛏️', sprite: 'rover', mass: 2, cost: 3200, power: -2, income: 1400, ore: 1.2, tier: 2, hp: 280, desc: 'Yüzeyi kazıp dakikada 1.2 t maden çıkarır ve +1.400 ₡/dk gelir sağlar.' },
  { id: 'sampler', name: 'Örnek Toplayıcı', icon: '🧪', sprite: 'sampler', mass: 1, cost: 3000, power: -1, income: 3600, ore: 0, tier: 2, hp: 240, desc: 'Kaya ve toprak örneği toplar; dakikada +3.600 ₡ yüksek verim sağlar.' },
  { id: 'biodome', name: 'Uzay Tarlası', icon: '🌱', sprite: 'farm', mass: 2, cost: 4600, power: -2, income: 6200, ore: 0, tier: 2, hp: 300, desc: 'Kapalı serada yiyecek yetiştirir; dakikada +6.200 ₡ düzenli gelir sağlar.' },
  { id: 'lab', name: 'Bilim Lab', icon: '🔬', sprite: 'lab', mass: 2, cost: 6000, power: -3, income: 10000, ore: 0, tier: 2, hp: 340, desc: 'İleri deneyler yapar; Dünya\'da dakikada +10.000 ₡ yüksek bilimsel gelir getirir.' },
  { id: 'rtg-reactor', name: 'Reaktör', icon: '☢️', sprite: 'reactor', mass: 2, cost: 5800, power: 14, income: 0, ore: 0, constantPower: true, tier: 3, hp: 440, desc: 'Güneş\'ten bağımsız bol elektrik. Mars ve ötesi için ideal.' },
  { id: 'isru', name: 'Yakıt Tesisi', icon: '⛽', sprite: 'isru', mass: 2, cost: 4500, power: -2, income: 1600, ore: 0, tier: 3, hp: 320, desc: 'Madenden roket yakıtı üretir (1 t maden → 4 t yakıt) ve +1.600 ₡/dk getirir.' },
  { id: 'colony-station', name: 'Uzay İstasyonu', icon: '🛰️', sprite: 'station', mass: 4, cost: 7500, power: -5, income: 6000, ore: 0, tier: 1, hp: 850, desc: 'Bulunduğu çeyreği (-5 ⚡) kolonileştirir, doğrudan inşayı açar ve yüksek gelir üretir.' },
  { id: 'launch-pad', name: 'Fırlatma Rampası', icon: '🗼', sprite: 'launch-pad', mass: 3.5, cost: 5200, power: -1, income: 1500, ore: 0, tier: 1, hp: 580, desc: 'Aktif Uzay İstasyonu ile aynı çeyrekteyken roketlerin doğrudan buradan fırlatılmasını sağlar.' },
  // Uzay Savaşı savunma yapıları
  { id: 'aa-turret', name: 'Uçaksavar Lazer Taret', icon: '🔫', sprite: 'turret', mass: 2, cost: 4200, power: -2, income: 0, ore: 0, tier: 1, hp: 420, warfare: true, desc: '1.600 m menzilde düşman roketlerine otomatik lazer ateşi açar.' },
  { id: 'sam-battery', name: 'SAM Füze Bataryası', icon: '🚀', sprite: 'sam', mass: 2, cost: 6500, power: -2, income: 0, ore: 0, tier: 1, hp: 440, warfare: true, desc: '2.800 m menzilde yaklaşan düşman roketlerine güdümlü savunma füzesi atar.' },
  { id: 'colony-shield', name: 'Koloni Kalkan Kubbesi', icon: '🛡️', sprite: 'shield', mass: 3, cost: 8000, power: -4, income: 0, ore: 0, tier: 1, hp: 520, warfare: true, desc: 'Tüm çeyreği koruyan +900 HP yenilenen enerji kubbesi oluşturur.' },
  { id: 'repair-bay', name: 'Onarım Hangarı', icon: '🔧', sprite: 'repair', mass: 2, cost: 4200, power: -2, income: 0, ore: 0, tier: 1, hp: 340, warfare: true, desc: 'Çalışırken hasarlı koloni binalarını saniyede +10 HP onarır.' },
]

export const COLONY_STATION_ID = 'colony-station'
export const LAUNCH_PAD_ID = 'launch-pad'
export const WARFARE_EARTH_MODULES = ['solar-farm', 'battery', 'telemetry', 'lab', 'aa-turret', 'sam-battery', 'colony-shield', 'repair-bay']
export const WARFARE_STARTER_EARTH_SITES: (string | null)[] = ['solar-farm', 'solar-farm', 'telemetry', 'battery', 'aa-turret', null, null, null, null, null, null, null]

/** Yalnızca kargo olarak taşınan, koloniye kurulmayan yük: ISS ikmal paketi. */
export const ISS_SUPPLY: ModuleDef = { id: 'iss-supplies', name: 'ISS İkmal Kargosu', icon: '📦', sprite: 'battery', mass: 1, cost: 800, power: 0, income: 0, ore: 0, tier: 1, hp: 100, desc: 'ISS\'e kenetlenip teslim et: paket başına 4.500 ₡ kazandırır.' }
export const ISS_SUPPLY_REWARD = 4500

export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries([...MODULES, ISS_SUPPLY].map((m) => [m.id, m]))

/** Eski kayıtlardaki kaldırılmış yapı kimlikleri. */
const LEGACY_IDS: Record<string, string> = { datacenter: 'lab', 'quantum-relay': 'lab' }

/** Dünya ana üssünde yalnızca yer tesisleri kurulur; uzay kolonisi yapıları (ve diğer Dünya çeyrekleri) istasyonla kurulabilir. */
export const EARTH_MODULES = ['solar-farm', 'battery', 'telemetry', 'lab']

export const STARTER_EARTH_SITES: (string | null)[] = ['solar-farm', 'telemetry', 'telemetry', null, null, null, null, null, null, null, null, null]

export const COLONY_SHIELD_PER_GEN = 900

export function syncModules(base: Base) {
  const counts: Record<string, number> = {}
  const sites = base.sites ?? []
  for (let i = 0; i < sites.length; i += 1) {
    const id = sites[i]
    if (id) {
      counts[id] = (counts[id] ?? 0) + 1
      if (base.siteHp && (base.siteHp[i] === undefined || base.siteHp[i] === null)) {
        base.siteHp[i] = MODULE_BY_ID[id]?.hp ?? 200
      }
    } else if (base.siteHp) {
      base.siteHp[i] = null
    }
  }
  base.modules = counts
  if (Object.keys(counts).length > 0) base.destroyed = false
}

export function ensureSiteHp(base: Base): (number | null)[] {
  const sites = ensureSites(base)
  if (!Array.isArray(base.siteHp) || base.siteHp.length !== COLONY_SLOTS) {
    const oldHp = Array.isArray(base.siteHp) ? base.siteHp : []
    base.siteHp = sites.map((id, i) => (id ? (oldHp[i] ?? MODULE_BY_ID[id]?.hp ?? 200) : null))
  } else {
    for (let i = 0; i < COLONY_SLOTS; i += 1) {
      const id = sites[i]
      if (!id) base.siteHp[i] = null
      else if (base.siteHp[i] === null || base.siteHp[i] === undefined) base.siteHp[i] = MODULE_BY_ID[id]?.hp ?? 200
    }
  }
  return base.siteHp
}

export function colonyBuildingCount(base: Base | undefined): number {
  if (!base) return 0
  return (base.sites ?? []).filter(Boolean).length
}

export function colonyHealthSummary(base: Base | undefined): { hp: number; maxHp: number; buildings: number } {
  if (!base) return { hp: 0, maxHp: 0, buildings: 0 }
  const sites = ensureSites(base)
  let hp = 0
  let maxHp = 0
  let buildings = 0
  for (let i = 0; i < sites.length; i += 1) {
    const id = sites[i]
    if (!id) continue
    buildings += 1
    const m = MODULE_BY_ID[id]?.hp ?? 200
    maxHp += m
    hp += Math.max(0, Math.min(m, base.siteHp?.[i] ?? m))
  }
  return { hp, maxHp, buildings }
}

export function colonyShieldCap(base: Base | undefined, solarFactor: number): number {
  if (!base) return 0
  const rep = baseReport(base, solarFactor)
  let cap = 0
  for (const s of rep.sites) {
    if (s.id === 'colony-shield' && s.powered) cap += COLONY_SHIELD_PER_GEN
  }
  return cap
}

/** Eski (sayaç / 4×4 grid) kayıtları yuva düzenine çevirir. */
export function ensureSites(base: Base): (string | null)[] {
  if (Array.isArray(base.sites) && base.sites.length === COLONY_SLOTS) return base.sites
  if (Array.isArray(base.sites) && base.sites.length > 0 && base.sites.length < COLONY_SLOTS) {
    while (base.sites.length < COLONY_SLOTS) base.sites.push(null)
    base.stock ??= {}
    syncModules(base)
    return base.sites
  }
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
  incomePerMin: number
  orePerMin: number
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
    incomePerMin: income, orePerMin: ore, sites: out, unpowered: consumers - running,
  }
}

/** Üssü dt gerçek saniyesi ilerletir (dakika bazlı); kazanılan parayı döndürür. */
export function tickBase(base: Base, solarFactor: number, dtS: number, incomeMult = 1, canMine = true): number {
  const rep = baseReport(base, solarFactor, incomeMult)
  const minutes = dtS / 60
  if (canMine) base.ore += rep.orePerMin * minutes
  const earned = rep.incomePerMin * minutes
  base.earned += earned
  return earned
}

export type StationStatus = 'none' | 'unpowered' | 'active'

/** Gezegen çeyreğinde elektriği yeten aktif bir Uzay İstasyonu varsa o çeyrek kolonileşmiştir. */
export function isQuadrantColonized(base: Base | undefined, solarFactor: number): boolean {
  if (!base) return false
  if (!(base.modules[COLONY_STATION_ID] ?? 0)) return false
  const rep = baseReport(base, solarFactor)
  return rep.sites.some((s) => s.id === COLONY_STATION_ID && s.powered)
}

export const isBodyColonized = isQuadrantColonized

/** Aktif Fırlatma Rampası + aktif Uzay İstasyonu varsa o çeyrekten roket fırlatılabilir. */
export function hasActiveLaunchPad(base: Base | undefined, solarFactor: number): boolean {
  if (!base || !isQuadrantColonized(base, solarFactor)) return false
  if (!(base.modules[LAUNCH_PAD_ID] ?? 0)) return false
  const rep = baseReport(base, solarFactor)
  return rep.sites.some((s) => s.id === LAUNCH_PAD_ID && s.powered)
}

export function colonyStationStatus(base: Base | undefined, solarFactor: number): StationStatus {
  if (!base || !(base.modules[COLONY_STATION_ID] ?? 0)) return 'none'
  return isQuadrantColonized(base, solarFactor) ? 'active' : 'unpowered'
}
