import type { BodyId } from '../nasa/bodies'
import type { Base, PlanetTile } from './types'

export const PLANET_GRID_SIZE = 4
export const MAX_TILE_LEVEL = 5

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
  { id: 'solar-farm', name: 'Güneş Tarlası', icon: '🔆', mass: 1, cost: 1200, power: 6, income: 0, ore: 0, desc: 'Üsse +6 güç sağlar; komşu yapıları +%25 hızlandırır.' },
  { id: 'telemetry', name: 'Telemetri İstasyonu', icon: '📡', mass: 1, cost: 1800, power: -1, income: 650, ore: 0, desc: 'Yörünge takibi ve uydu kiralama ile sürekli pasif gelir üretir.' },
  { id: 'habitat', name: 'Yaşam Modülü', icon: '🏠', mass: 2, cost: 3000, power: -1, income: 400, ore: 0, desc: 'Mürettebat barındırır; araştırma sözleşmesi geliri getirir.' },
  { id: 'datacenter', name: 'Veri Merkezi', icon: '🖥️', mass: 2, cost: 3800, power: -2, income: 1100, ore: 0, desc: 'Otomatik telemetri işleme tesisi; bilim/telemetri komşuluğundan bonus alır.' },
  { id: 'lab', name: 'Bilim Laboratuvarı', icon: '🔬', mass: 2, cost: 4800, power: -2, income: 1200, ore: 0, desc: 'Uzay deneyleriyle yüksek pasif gelir sağlar; damar üstünde +%50 verir.' },
  { id: 'drill', name: 'Maden Sondajı', icon: '⛏️', mass: 2, cost: 3500, power: -2, income: 0, ore: 0.6, desc: 'Regolit/maden çıkarır; 💎 Maden Damarı karesinde +%50 kazım yapar.' },
  { id: 'isru', name: 'ISRU Yakıt Tesisi', icon: '⛽', mass: 2, cost: 5000, power: -2, income: 0, ore: 0, desc: 'Madenden yakıt üretir (1 t maden → 4 t yakıt).' },
  { id: 'rtg-reactor', name: 'Nükleer RTG Reaktörü', icon: '☢️', mass: 2, cost: 6500, power: 20, income: 0, ore: 0, constantPower: true, desc: 'Güneş\'ten bağımsız +20 güç ve komşu yapılara +%25 destek verir.' },
  { id: 'biodome', name: 'Biyodom Kolonisi', icon: '🌱', mass: 3, cost: 10500, power: -4, income: 2200, ore: 0.45, desc: 'Kapalı ekosistem: aynı anda yüksek pasif gelir ve maden çıkarır.' },
  { id: 'quantum-relay', name: 'Kuantum Ticaret Rölesi', icon: '💎', mass: 3, cost: 22000, power: -5, income: 4200, ore: 0, desc: 'Gezegenler arası ticaret ağı ile en yüksek pasif geliri sağlar.' },
]

export const MODULE_BY_ID: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]))

export const STARTER_EARTH_MODULES: Record<string, number> = {
  'solar-farm': 1,
  telemetry: 1,
  habitat: 1,
}

export const levelOutputMult = (level = 1) => 1 + (Math.max(1, level) - 1) * 0.65
export const levelPowerMult = (level = 1) => 1 + (Math.max(1, level) - 1) * 0.45

export function tileUpgradeCost(def: ModuleDef, level: number): number {
  return Math.round(def.cost * 0.45 * Math.max(1, level))
}

export function tileRefund(def: ModuleDef, level: number): number {
  let invested = def.cost
  for (let l = 1; l < level; l += 1) invested += tileUpgradeCost(def, l)
  return Math.round(invested * 0.6)
}

function tileHash(bodyId: BodyId, sector: number, x: number, y: number): number {
  let h = (sector + 1) * 73856093 ^ (x + 11) * 19349663 ^ (y + 29) * 83492791
  for (let i = 0; i < bodyId.length; i += 1) h = ((h << 5) - h + bodyId.charCodeAt(i)) | 0
  return Math.abs(h)
}

function rollUnder(bodyId: BodyId, sector: number, x: number, y: number): 'clear' | 'crater' | 'vein' {
  const m = tileHash(bodyId, sector, x, y) % 10
  if (m < 3) return 'vein'
  if (m < 7) return 'crater'
  return 'clear'
}

export function tileAt(grid: PlanetTile[], x: number, y: number): PlanetTile | undefined {
  return grid.find((t) => t.x === x && t.y === y)
}

/** İki kareden oluşan güç/bilim/üretim komşuluk bonusu (0..1.25 arası ek oran). */
export function tileSynergyBonus(grid: PlanetTile[], tile: PlanetTile): { bonus: number; reason: string } {
  if (tile.kind !== 'built' || !tile.moduleId) return { bonus: 0, reason: '' }
  const def = MODULE_BY_ID[tile.moduleId]
  if (!def) return { bonus: 0, reason: '' }
  let bonus = 0
  const tags: string[] = []
  if (tile.under === 'vein') {
    const veinBonus = ['drill', 'isru', 'lab', 'rtg-reactor', 'biodome'].includes(def.id) ? 0.5 : 0.25
    bonus += veinBonus
    tags.push(`💎 Damar +%${Math.round(veinBonus * 100)}`)
  }
  const neighbors = [
    tileAt(grid, tile.x - 1, tile.y),
    tileAt(grid, tile.x + 1, tile.y),
    tileAt(grid, tile.x, tile.y - 1),
    tileAt(grid, tile.x, tile.y + 1),
  ].filter((n): n is PlanetTile => !!n && n.kind === 'built' && !!n.moduleId)

  const hasPowerNeighbor = neighbors.some((n) => n.moduleId === 'solar-farm' || n.moduleId === 'rtg-reactor')
  if (def.power < 0 && hasPowerNeighbor) {
    bonus += 0.25
    tags.push('⚡ Güç komşusu +%25')
  }
  const isIndustry = ['drill', 'isru', 'biodome'].includes(def.id)
  if (isIndustry && neighbors.some((n) => n.moduleId !== def.id && ['drill', 'isru', 'biodome', 'lab'].includes(n.moduleId!))) {
    bonus += 0.3
    tags.push('⚙️ Sanayi bağı +%30')
  }
  const isScience = ['telemetry', 'datacenter', 'lab', 'quantum-relay'].includes(def.id)
  if (isScience && neighbors.some((n) => ['telemetry', 'datacenter', 'lab', 'quantum-relay'].includes(n.moduleId!))) {
    bonus += 0.2
    tags.push('📡 Veri ağı +%20')
  }
  return { bonus, reason: tags.join(' · ') }
}

export function canSweepTile(grid: PlanetTile[], x: number, y: number): boolean {
  const t = tileAt(grid, x, y)
  if (!t) return false
  if (t.kind === 'crater') return true
  if (t.kind !== 'fog') return false
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue
      const n = tileAt(grid, x + dx, y + dy)
      if (n && n.kind !== 'fog') return true
    }
  }
  return false
}

export function syncBaseModulesFromGrid(base: Base) {
  if (!base.grid) return
  const counts: Record<string, number> = {}
  for (const t of base.grid) {
    if (t.kind === 'built' && t.moduleId) {
      counts[t.moduleId] = (counts[t.moduleId] ?? 0) + (t.level ?? 1)
    }
  }
  base.modules = counts
}

export function createBaseGrid(bodyId: BodyId, sectorLevel = 0, existingModules?: Record<string, number>, ownerId?: string): PlanetTile[] {
  const grid: PlanetTile[] = []
  for (let y = 0; y < PLANET_GRID_SIZE; y += 1) {
    for (let x = 0; x < PLANET_GRID_SIZE; x += 1) {
      const center = x >= 1 && x <= 2 && y >= 1 && y <= 2
      const under = center ? ((x + y) % 2 === 0 ? 'clear' : 'vein') : rollUnder(bodyId, sectorLevel, x, y)
      grid.push({
        x,
        y,
        kind: center ? (under === 'crater' ? 'clear' : under) : 'fog',
        under,
      })
    }
  }
  if (existingModules) {
    // Mevcut modülleri merkeze yakın karelere deterministik yerleştir
    const order = [...grid].sort((a, b) => {
      const da = Math.abs(a.x - 1.5) + Math.abs(a.y - 1.5)
      const db = Math.abs(b.x - 1.5) + Math.abs(b.y - 1.5)
      return da - db
    })
    let idx = 0
    for (const m of MODULES) {
      let rem = existingModules[m.id] ?? 0
      while (rem > 0 && idx < order.length) {
        const slot = order[idx++]!
        const lvl = Math.min(MAX_TILE_LEVEL, rem)
        slot.kind = 'built'
        if (slot.under === 'crater') slot.under = 'clear'
        slot.moduleId = m.id
        slot.level = lvl
        if (ownerId) slot.ownerId = ownerId
        rem -= lvl
      }
    }
  }
  return grid
}

export function ensureBaseGrid(base: Base, bodyId: BodyId): PlanetTile[] {
  if (!base.grid || base.grid.length !== PLANET_GRID_SIZE * PLANET_GRID_SIZE) {
    base.grid = createBaseGrid(bodyId, base.sectorLevel ?? 0, base.modules, base.ownerId)
  }
  if (typeof base.sectorLevel !== 'number') base.sectorLevel = 0
  return base.grid
}

export function addModuleToBaseGrid(base: Base, bodyId: BodyId, moduleId: string, ownerId?: string): boolean {
  const grid = ensureBaseGrid(base, bodyId)
  const open = grid.find((t) => t.kind === 'clear' || t.kind === 'vein')
  if (open) {
    open.kind = 'built'
    open.moduleId = moduleId
    open.level = 1
    if (ownerId) open.ownerId = ownerId
    syncBaseModulesFromGrid(base)
    return true
  }
  const hidden = grid.find((t) => t.kind === 'fog' || t.kind === 'crater')
  if (hidden) {
    if (hidden.under === 'crater') hidden.under = 'clear'
    hidden.kind = 'built'
    hidden.moduleId = moduleId
    hidden.level = 1
    if (ownerId) hidden.ownerId = ownerId
    syncBaseModulesFromGrid(base)
    return true
  }
  const same = grid.find((t) => t.kind === 'built' && t.moduleId === moduleId && (t.level ?? 1) < MAX_TILE_LEVEL)
  if (same) {
    same.level = (same.level ?? 1) + 1
    syncBaseModulesFromGrid(base)
    return true
  }
  return false
}

export function emptyBase(siteAngle: number, bodyId?: BodyId, ownerId?: string): Base {
  const base: Base = { modules: {}, ore: 0, siteAngle, earned: 0, sectorLevel: 0, ownerId }
  if (bodyId) base.grid = createBaseGrid(bodyId, 0, undefined, ownerId)
  return base
}

export function isSectorReadyToScan(base: Base, bodyId: BodyId): boolean {
  const grid = ensureBaseGrid(base, bodyId)
  return grid.every((t) => t.kind !== 'fog' && t.kind !== 'crater')
}

export function sweepGridTile(
  base: Base,
  bodyId: BodyId,
  x: number,
  y: number,
  incomeMult = 1,
): { ok: boolean; reward: number; oreFound: number; text: string } {
  const grid = ensureBaseGrid(base, bodyId)
  const t = tileAt(grid, x, y)
  if (!t) return { ok: false, reward: 0, oreFound: 0, text: 'Geçersiz kare.' }
  if (!canSweepTile(grid, x, y)) return { ok: false, reward: 0, oreFound: 0, text: 'Önce açılmış bir kareye komşu alanı tara.' }
  const mult = Math.max(1, incomeMult)
  if (t.kind === 'fog') {
    const revealed = t.under ?? rollUnder(bodyId, base.sectorLevel ?? 0, x, y)
    t.under = revealed
    t.kind = revealed
    const reward = Math.round((revealed === 'vein' ? 220 : revealed === 'crater' ? 140 : 90) * mult)
    const msg =
      revealed === 'vein'
        ? `💎 Zengin damar keşfedildi! +${reward.toLocaleString('tr-TR')} ₡`
        : revealed === 'crater'
          ? `🪨 Enkaz/krater bulundu (+${reward.toLocaleString('tr-TR')} ₡) — temizlemek için tekrar tıkla!`
          : `⬜ Düz arazi açıldı! +${reward.toLocaleString('tr-TR')} ₡`
    return { ok: true, reward, oreFound: 0, text: msg }
  }
  if (t.kind === 'crater') {
    t.kind = 'clear'
    t.under = 'clear'
    const reward = Math.round(180 * mult)
    const oreFound = bodyId === 'earth' ? 0 : 0.25
    base.ore += oreFound
    const msg = oreFound > 0
      ? `⛏️ Krater temizlendi: +${reward.toLocaleString('tr-TR')} ₡ ve +${oreFound.toFixed(2)} t maden!`
      : `🧹 Alan temizlendi: +${reward.toLocaleString('tr-TR')} ₡`
    return { ok: true, reward, oreFound, text: msg }
  }
  return { ok: false, reward: 0, oreFound: 0, text: 'Bu kare zaten temiz.' }
}

export function scanNextSector(base: Base, bodyId: BodyId, incomeMult = 1): { ok: boolean; reward: number; text: string } {
  if (!isSectorReadyToScan(base, bodyId)) {
    return { ok: false, reward: 0, text: 'Önce bu sektördeki tüm kapalı kareleri ve kraterleri temizle.' }
  }
  const grid = ensureBaseGrid(base, bodyId)
  const nextSec = (base.sectorLevel ?? 0) + 1
  base.sectorLevel = nextSec
  for (const t of grid) {
    if (t.kind === 'built') continue
    const under = rollUnder(bodyId, nextSec, t.x, t.y)
    t.kind = 'fog'
    t.under = under
  }
  // Mevcut yapıların yanındaki yeni sis kareleri hemen taranabilir olur; en az 1 açık merkez yoksa köşeden bir açık nokta garantile
  if (!grid.some((t) => t.kind !== 'fog')) {
    const first = grid[5]!
    first.under = 'clear'
    first.kind = 'clear'
  }
  const reward = Math.round(350 * Math.max(1, incomeMult) * nextSec)
  return {
    ok: true,
    reward,
    text: `🛰️ Sektör ${nextSec + 1} tarandı! Tüm üs +%12 kalıcı bonus kazandı ve +${reward.toLocaleString('tr-TR')} ₡ ödül verildi.`,
  }
}

export interface BaseReport {
  powerSupply: number
  powerDemand: number
  /** 0..1: güç yetmezse tüm tesisler bu oranda çalışır */
  efficiency: number
  incomePerHour: number
  orePerHour: number
  activeLabs: number
  sectorMult: number
  rows: { def: ModuleDef; count: number; income: number; ore: number }[]
}

/** solarFactor: gezegenin Güneş'e uzaklığına göre 1/r² (Ay 1.0, Mars ≈ 0.43). */
export function baseReport(base: Base, solarFactor: number, incomeMult = 1): BaseReport {
  const sectorMult = 1 + 0.12 * (base.sectorLevel ?? 0)
  if (base.grid && base.grid.length > 0) {
    let supply = 0
    let demand = 0
    const agg = new Map<string, { count: number; rawIncome: number; rawOre: number }>()
    for (const t of base.grid) {
      if (t.kind !== 'built' || !t.moduleId) continue
      const def = MODULE_BY_ID[t.moduleId]
      if (!def) continue
      const lvl = t.level ?? 1
      const { bonus } = tileSynergyBonus(base.grid, t)
      const outMult = levelOutputMult(lvl) * (1 + bonus) * sectorMult
      if (def.power > 0) supply += def.power * (def.constantPower ? 1 : solarFactor) * levelOutputMult(lvl) * (t.under === 'vein' && def.id === 'rtg-reactor' ? 1.5 : 1)
      else demand += -def.power * levelPowerMult(lvl)
      const prev = agg.get(def.id) ?? { count: 0, rawIncome: 0, rawOre: 0 }
      prev.count += lvl
      prev.rawIncome += def.income * outMult
      prev.rawOre += def.ore * outMult
      agg.set(def.id, prev)
    }
    const efficiency = demand <= 0 ? 1 : Math.min(1, supply / demand)
    const rows = MODULES.filter((m) => agg.has(m.id)).map((def) => {
      const a = agg.get(def.id)!
      return {
        def,
        count: a.count,
        income: a.rawIncome * efficiency * incomeMult,
        ore: a.rawOre * efficiency,
      }
    })
    return {
      powerSupply: supply,
      powerDemand: demand,
      efficiency,
      incomePerHour: rows.reduce((s, r) => s + r.income, 0),
      orePerHour: rows.reduce((s, r) => s + r.ore, 0),
      activeLabs: agg.get('lab')?.count ?? 0,
      sectorMult,
      rows,
    }
  }

  const count = (id: string) => base.modules[id] ?? 0
  let supply = 0
  let demand = 0
  for (const m of MODULES) {
    const c = count(m.id)
    if (m.power > 0) supply += m.power * (m.constantPower ? 1 : solarFactor) * c
    else demand += -m.power * c
  }
  const efficiency = demand <= 0 ? 1 : Math.min(1, supply / demand)
  const activeLabs = count('lab')
  const rows = MODULES.filter((m) => count(m.id) > 0).map((def) => {
    const c = count(def.id)
    return {
      def,
      count: c,
      income: def.income * c * efficiency * incomeMult * sectorMult,
      ore: def.ore * c * efficiency * sectorMult,
    }
  })
  return {
    powerSupply: supply,
    powerDemand: demand,
    efficiency,
    incomePerHour: rows.reduce((s, r) => s + r.income, 0),
    orePerHour: rows.reduce((s, r) => s + r.ore, 0),
    activeLabs,
    sectorMult,
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
