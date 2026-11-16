/** Grid tabanlı roket yapısı: bağlantı, kademe, kütle ve motor hesapları (saf fonksiyonlar). */
import { G0 } from '../nasa/bodies'
import { MODULE_BY_ID } from './base'
import { GRID_H, GRID_W, partDef, partMaxHp } from './data'
import type { Cargo, PartDef, PartInst } from './types'

const key = (x: number, y: number) => x * 1000 + y

export function cellMap(parts: PartInst[]): Map<number, number> {
  const map = new Map<number, number>()
  parts.forEach((p, i) => {
    const d = partDef(p.def)
    for (let dx = 0; dx < d.w; dx += 1) for (let dy = 0; dy < d.h; dy += 1) map.set(key(p.x + dx, p.y + dy), i)
  })
  return map
}

export function partAt(parts: PartInst[], x: number, y: number): number {
  return cellMap(parts).get(key(x, y)) ?? -1
}

export function canPlace(parts: PartInst[], def: PartDef, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + def.w > GRID_W || y + def.h > GRID_H) return false
  const map = cellMap(parts)
  for (let dx = 0; dx < def.w; dx += 1) for (let dy = 0; dy < def.h; dy += 1) if (map.has(key(x + dx, y + dy))) return false
  return true
}

/** Kenar paylaşan parçalar birbirine bağlıdır. */
export function adjacency(parts: PartInst[]): number[][] {
  const map = cellMap(parts)
  const adj: Set<number>[] = parts.map(() => new Set<number>())
  parts.forEach((p, i) => {
    const d = partDef(p.def)
    for (let dx = 0; dx < d.w; dx += 1)
      for (let dy = 0; dy < d.h; dy += 1) {
        const cx = p.x + dx
        const cy = p.y + dy
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
          const j = map.get(key(nx, ny))
          if (j !== undefined && j !== i) adj[i]!.add(j)
        }
      }
  })
  return adj.map((s) => [...s])
}

/** Bağlı bileşenler; `skip` true dönen parçalar grafikten çıkarılır (grup −1). */
export function components(parts: PartInst[], skip: (p: PartInst, i: number) => boolean = () => false): number[] {
  const adj = adjacency(parts)
  const group = parts.map(() => -1)
  let g = 0
  for (let i = 0; i < parts.length; i += 1) {
    if (group[i] !== -1 || skip(parts[i]!, i)) continue
    const stack = [i]
    group[i] = g
    while (stack.length) {
      const c = stack.pop()!
      for (const n of adj[c]!) {
        if (group[n] === -1 && !skip(parts[n]!, n)) {
          group[n] = g
          stack.push(n)
        }
      }
    }
    g += 1
  }
  return group
}

const isDecoupler = (p: PartInst) => {
  const k = partDef(p.def).kind
  return k === 'decoupler' || k === 'radialDecoupler'
}

/** Yakıt grupları: kademe adaptörleri yakıt geçirmez. */
export const fuelGroups = (parts: PartInst[]) => components(parts, isDecoupler)

export function isConnected(parts: PartInst[]): boolean {
  if (parts.length === 0) return false
  return components(parts).every((g) => g === 0)
}

export function cargoMass(cargo: Cargo | null | undefined): number {
  if (!cargo) return 0
  let m = cargo.ore
  for (const [id, n] of Object.entries(cargo.modules)) m += (MODULE_BY_ID[id]?.mass ?? 0) * n
  return m
}

export interface VesselStats {
  mass: number
  dryMass: number
  fuel: number
  fuelCap: number
  comX: number
  comY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  cost: number
  ecCap: number
  cargoCap: number
  hasCommand: boolean
  rcs: number
  legs: number
  legsDeployed: number
  legTolerance: number
  chutes: number
  chutesDeployed: number
  hasNose: boolean
  hp: number
  maxHp: number
  shieldCap: number
  weaponCount: number
  weaponDps: number
  ammoTotal: number
  hasCombatParts: boolean
}

export function vesselStats(parts: PartInst[], cargo?: Cargo | null): VesselStats {
  let mass = 0
  let fuel = 0
  let fuelCap = 0
  let mx = 0
  let my = 0
  let cost = 0
  let ecCap = 0
  let cargoCap = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let hasCommand = false
  let rcs = 0
  let legs = 0
  let legsDeployed = 0
  let legTolSum = 0
  let chutes = 0
  let chutesDeployed = 0
  let hasNose = false
  let hp = 0
  let maxHp = 0
  let shieldCap = 0
  let weaponCount = 0
  let weaponDps = 0
  let ammoTotal = 0
  let hasCombatParts = false
  for (const p of parts) {
    const d = partDef(p.def)
    const f = d.kind === 'tank' ? (p.fuel ?? d.fuel ?? 0) : 0
    const m = d.mass + f
    mass += m
    fuel += f
    fuelCap += d.fuel ?? 0
    mx += m * (p.x + d.w / 2)
    my += m * (p.y + d.h / 2)
    cost += d.cost
    ecCap += d.ecCap ?? 0
    cargoCap += d.cargoCap ?? 0
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x + d.w)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y + d.h)
    const pMax = partMaxHp(d.id)
    maxHp += pMax
    hp += Math.max(0, Math.min(pMax, p.hp ?? pMax))
    shieldCap += d.shieldCap ?? 0
    if (d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'shield') hasCombatParts = true
    if (d.weapon) {
      weaponCount += 1
      weaponDps += (d.weapon.dmg * (d.weapon.pellets ?? 1)) / Math.max(0.05, d.weapon.cooldown)
      if (d.weapon.ammo !== undefined) ammoTotal += p.ammo ?? d.weapon.ammo
    }
    if (d.kind === 'command') hasCommand = true
    if (d.kind === 'rcs') rcs += 1
    if (d.kind === 'leg') {
      legs += 1
      if (p.deployed) {
        legsDeployed += 1
        legTolSum += d.legTolerance ?? 14
      }
    }
    if (d.kind === 'chute') {
      chutes += 1
      if (p.deployed) chutesDeployed += 1
    }
    if (d.kind === 'nose' || d.kind === 'command' || d.kind === 'chute') hasNose = true
  }
  const cm = cargoMass(cargo)
  const comX = mass > 0 ? mx / mass : 0
  const comY = mass > 0 ? my / mass : 0
  const legTolerance = legsDeployed >= 2 ? legTolSum / legsDeployed : 9
  return {
    mass: mass + cm, dryMass: mass - fuel + cm, fuel, fuelCap, comX, comY, minX, maxX, minY, maxY, cost, ecCap, cargoCap,
    hasCommand, rcs, legs, legsDeployed, legTolerance, chutes, chutesDeployed, hasNose,
    hp, maxHp, shieldCap, weaponCount, weaponDps, ammoTotal, hasCombatParts,
  }
}

/** Açık, yakıtı olan ve nozülünün altı boş olan motorlar çalışabilir. */
export function activeEngines(parts: PartInst[]): number[] {
  const map = cellMap(parts)
  const out: number[] = []
  parts.forEach((p, i) => {
    const d = partDef(p.def)
    if (d.kind !== 'engine' || p.on === false) return
    for (let dx = 0; dx < d.w; dx += 1) if (map.has(key(p.x + dx, p.y + d.h))) return
    out.push(i)
  })
  return out
}

export interface EngineOutput {
  /** toplam itki (kN) */
  thrust: number
  /** çalışan motor indeksleri → 0..1 güç oranı */
  firing: Map<number, number>
  ecUsed: number
}

/**
 * Motorları dt saniye çalıştırır ve tanklardan yakıtı düşer (parts mutasyona uğrar).
 * Yakıt akışı sabittir: ṁ = F_vak / (Isp_vak · g0). Atmosferde Isp düşer → itki düşer.
 * Bu yüzden vakum motorları uzayda verimli ama kalkışta güçsüzdür.
 */
/** Geçici yakıt verimi bonusu ("İstikbal Göklerdedir" selamı): Isp çarpanı. */
let ispBoost = 1
export function setIspBoost(mult: number) {
  ispBoost = mult
}

export function runEngines(parts: PartInst[], throttle: number, pressure: number, dt: number, ecAvailable: number): EngineOutput {
  const firing = new Map<number, number>()
  let thrust = 0
  let ecUsed = 0
  if (throttle <= 0) return { thrust, firing, ecUsed }
  const groups = fuelGroups(parts)
  for (const i of activeEngines(parts)) {
    const d = partDef(parts[i]!.def)
    const flow = (d.thrust! / (d.ispVac! * ispBoost * G0)) * throttle
    const tanks = parts.filter((p, j) => groups[j] === groups[i] && partDef(p.def).kind === 'tank' && (p.fuel ?? 0) > 0)
    const avail = tanks.reduce((s, t) => s + (t.fuel ?? 0), 0)
    if (avail <= 0) continue
    let frac = 1
    if (d.ecUse) {
      const needEc = d.ecUse * throttle * dt
      const got = Math.min(needEc, Math.max(0, ecAvailable - ecUsed))
      frac = needEc > 0 ? got / needEc : 0
      ecUsed += got
    }
    const need = flow * dt * frac
    if (need <= 0) continue
    const used = Math.min(need, avail)
    for (const t of tanks) t.fuel = Math.max(0, (t.fuel ?? 0) - used * ((t.fuel ?? 0) / avail))
    const power = (used / (flow * dt)) * throttle
    const isp = d.ispVac! + (d.ispSL! - d.ispVac!) * Math.min(1, Math.max(0, pressure))
    thrust += (used / dt) * isp * ispBoost * G0
    firing.set(i, power)
  }
  return { thrust, firing, ecUsed }
}

/** Sıradaki kademe: önce tüm yatay adaptörler, yoksa en alttaki dikey adaptör. */
export function nextStage(parts: PartInst[]): number[] {
  const radial = parts.map((p, i) => (partDef(p.def).kind === 'radialDecoupler' ? i : -1)).filter((i) => i >= 0)
  if (radial.length) return radial
  let best = -1
  parts.forEach((p, i) => {
    if (partDef(p.def).kind === 'decoupler' && (best === -1 || p.y > parts[best]!.y)) best = i
  })
  return best >= 0 ? [best] : []
}

/** Verilen parçalar sökülünce ortaya çıkan bağımsız gövdeler. İlki komuta modülünü taşıyandır. */
export function splitParts(parts: PartInst[], remove: number[]): PartInst[][] {
  const rest = parts.filter((_, i) => !remove.includes(i))
  const group = components(rest)
  const count = Math.max(-1, ...group) + 1
  const out: PartInst[][] = Array.from({ length: count }, () => [])
  rest.forEach((p, i) => out[group[i]!]!.push(p))
  const score = (ps: PartInst[]) => {
    const cmd = ps.filter((p) => partDef(p.def).kind === 'command')
    return cmd.length ? -Math.min(...cmd.map((p) => p.y)) + 1000 : -1e6
  }
  return out.sort((a, b) => score(b) - score(a))
}

export interface StageEstimate {
  dv: number
  twr: number
  thrust: number
  mass: number
}

/** Tsiolkovsky: Δv = Isp·g0·ln(m0/m1), kademeleri sırayla yakıp ayırarak. */
export function estimateDeltaV(design: PartInst[], extraMass = 0, gravity = 9.8): StageEstimate[] {
  let parts: PartInst[] = design.map((p) => ({ ...p, fuel: p.fuel ?? partDef(p.def).fuel }))
  const stages: StageEstimate[] = []
  for (let guard = 0; guard < 12; guard += 1) {
    const engines = activeEngines(parts)
    if (engines.length) {
      const groups = fuelGroups(parts)
      const gset = new Set(engines.map((i) => groups[i]))
      const tanks = parts.filter((p, j) => gset.has(groups[j]) && partDef(p.def).kind === 'tank')
      const fuel = tanks.reduce((s, t) => s + (t.fuel ?? 0), 0)
      const thrust = engines.reduce((s, i) => s + partDef(parts[i]!.def).thrust!, 0)
      const flow = engines.reduce((s, i) => s + partDef(parts[i]!.def).thrust! / (partDef(parts[i]!.def).ispVac! * G0), 0)
      const m0 = vesselStats(parts).mass + extraMass
      if (fuel > 0 && flow > 0) {
        const slThrust = stages.length === 0
          ? engines.reduce((s, i) => { const d = partDef(parts[i]!.def); return s + (d.thrust! * d.ispSL!) / d.ispVac! }, 0)
          : thrust
        stages.push({ dv: (thrust / flow) * Math.log(m0 / (m0 - fuel)), twr: slThrust / (m0 * gravity), thrust: slThrust, mass: m0 })
        for (const t of tanks) t.fuel = 0
      }
    }
    const stage = nextStage(parts)
    if (!stage.length) break
    parts = splitParts(parts, stage)[0] ?? []
    if (!parts.length) break
  }
  return stages
}

export function freshParts(design: PartInst[]): PartInst[] {
  return design.map((p) => {
    const d = partDef(p.def)
    return {
      def: p.def,
      x: p.x,
      y: p.y,
      fuel: d.fuel,
      on: d.kind === 'engine' ? true : undefined,
      deployed: false,
      ...(d.weapon?.ammo !== undefined ? { ammo: d.weapon.ammo } : {}),
    }
  })
}

export function isCombatPart(defId: string): boolean {
  const k = partDef(defId).kind
  return k === 'weapon' || k === 'armor' || k === 'shield'
}

/** Tasarımı hangar ızgarasında yatayda ortalar ve altını alttan 1 kare yukarıya hizalar (büyük ızgara için). */
export function centerDesign(parts: PartInst[]): PartInst[] {
  if (!parts.length) return parts
  let x0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let y0 = Infinity
  for (const p of parts) {
    const d = partDef(p.def)
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x + d.w)
    y0 = Math.min(y0, p.y)
    y1 = Math.max(y1, p.y + d.h)
  }
  const dx = Math.round((GRID_W - (x1 - x0)) / 2 - x0)
  let dy = GRID_H - 1 - y1
  if (y0 + dy < 0) dy = -y0
  if (!dx && !dy) return parts
  return parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
}
