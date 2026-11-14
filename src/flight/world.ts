/**
 * Açık dünya simülasyonu: tüm araçlar, zaman hızlandırma, etki alanı (SOI) geçişleri,
 * kademe ayırma, görevler ve üs ekonomisi. React'ten bağımsızdır.
 */
import { emptyBase, MODULE_BY_ID, STARTER_EARTH_MODULES, tickBase } from '../game/base'
import { DEFAULT_DESIGN, INITIAL_MONEY, partDef } from '../game/data'
import { MISSION_BY_ID, MISSIONS } from '../game/missions'
import { baseIncomeMultiplier, INITIAL_TECH, isModuleUnlocked, isPartUnlocked, orePriceMultiplier, requiredTechForModule, requiredTechForPart } from '../game/tech'
import type { GameEvent, GameState, PartInst, Vessel } from '../game/types'
import { cargoMass, freshParts, isConnected, nextStage, splitParts, vesselStats } from '../game/vessel'
import { BODIES, childrenOf, solarFlux, type BodyId } from '../nasa/bodies'
import { bodyAbsState, bodyRelState, len, wrapPi } from './orbit'
import { chargeBatteries, type Controls, needsPhysics, PAD_ANGLE, rotateVessel, situation, stepPhysics, stepRails, terrainHeight } from './physics'

export const WARPS = [1, 2, 4, 10, 25, 100, 500, 2500, 10000, 50000, 100000]
export const PHYSICS_WARP_MAX_IDX = 4
const PHYSICS_DT = 0.02

export interface Sim {
  gs: GameState
  warpIdx: number
  /** araç id → (parça indeksi → motor gücü) ; yalnızca çizim için */
  firing: Map<number, Map<number, number>>
}

export function newGame(): GameState {
  return {
    time: 0,
    money: INITIAL_MONEY,
    vessels: [],
    activeId: null,
    nextId: 1,
    bases: {
      earth: {
        modules: { ...STARTER_EARTH_MODULES },
        ore: 0,
        siteAngle: PAD_ANGLE,
        earned: 0,
      },
    },
    missionsDone: [],
    techDone: [INITIAL_TECH],
    design: DEFAULT_DESIGN.map((p) => ({ ...p })),
    designCargo: {},
    targetBody: 'moon',
    lastSavedAt: Date.now(),
  }
}

export function tickBasesOnly(gs: GameState, dtS: number): number {
  let total = 0
  for (const id of Object.keys(gs.bases) as BodyId[]) {
    const base = gs.bases[id]
    if (!base) continue
    const flux = solarFlux(len(bodyAbsState(id, gs.time).r))
    const mult = baseIncomeMultiplier(gs, id)
    total += tickBase(base, flux, dtS, mult, id !== 'earth')
  }
  gs.money += total
  gs.time += dtS
  return total
}

export function totalPassiveIncomePerHour(gs: GameState): number {
  let sum = 0
  for (const id of Object.keys(gs.bases) as BodyId[]) {
    const base = gs.bases[id]
    if (!base) continue
    const flux = solarFlux(len(bodyAbsState(id, gs.time).r))
    const mult = baseIncomeMultiplier(gs, id)
    let supply = 0
    let demand = 0
    for (const [mid, count] of Object.entries(base.modules)) {
      const m = MODULE_BY_ID[mid]
      if (!m || !count) continue
      if (m.power > 0) supply += m.power * (m.constantPower ? 1 : flux) * count
      else demand += -m.power * count
    }
    const eff = demand <= 0 ? 1 : Math.min(1, supply / demand)
    const habitats = base.modules.habitat ?? 0
    for (const [mid, count] of Object.entries(base.modules)) {
      const m = MODULE_BY_ID[mid]
      if (!m || !count || !m.income) continue
      const c = mid === 'lab' ? Math.min(count, habitats) : count
      sum += m.income * c * eff * mult
    }
  }
  return sum
}

export const activeVessel = (gs: GameState) => gs.vessels.find((v) => v.id === gs.activeId) ?? null

function completeMission(gs: GameState, id: string, events: GameEvent[]) {
  if (gs.missionsDone.includes(id)) return
  const m = MISSION_BY_ID[id]
  if (!m) return
  gs.missionsDone.push(id)
  gs.money += m.reward
  events.push({ type: 'mission', id, title: m.title, reward: m.reward })
}

/** Yamalı konikler: araç hangi cismin etki alanındaysa yalnızca onun çekimini hisseder. */
function checkSoi(gs: GameState, v: Vessel, t: number, events: GameEvent[]): boolean {
  const body = BODIES[v.bodyId]
  const r = len(v.pos)
  if (body.parentId && r > body.soi) {
    const s = bodyRelState(body, t)
    v.pos = { x: v.pos.x + s.r.x, y: v.pos.y + s.r.y }
    v.vel = { x: v.vel.x + s.v.x, y: v.vel.y + s.v.y }
    v.bodyId = body.parentId
    if (v.assist && v.assist.bodyId === body.id) {
      const gain = len(v.vel) - v.assist.speedIn
      if (v.dvUsed - v.assist.dvIn < 15 && Math.abs(gain) > 25) {
        events.push({ type: 'toast', text: `Yerçekimi sapanı: ${body.name} sayesinde ${gain > 0 ? '+' : ''}${gain.toFixed(0)} m/s` })
        if (gain > 25) completeMission(gs, 'grav-assist', events)
      }
    }
    v.assist = null
    events.push({ type: 'soi', from: body.id, to: body.parentId })
    return true
  }
  for (const child of childrenOf(body.id)) {
    const s = bodyRelState(child, t)
    const d = { x: v.pos.x - s.r.x, y: v.pos.y - s.r.y }
    if (len(d) < child.soi) {
      v.assist = { bodyId: child.id, speedIn: len(v.vel), dvIn: v.dvUsed }
      v.pos = d
      v.vel = { x: v.vel.x - s.v.x, y: v.vel.y - s.v.y }
      v.bodyId = child.id
      if (!v.visited.includes(child.id)) v.visited.push(child.id)
      events.push({ type: 'soi', from: body.id, to: child.id })
      return true
    }
  }
  return false
}

function destroy(sim: Sim, v: Vessel, reason: string, events: GameEvent[]) {
  const gs = sim.gs
  const wasActive = gs.activeId === v.id
  gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
  sim.firing.delete(v.id)
  if (wasActive) gs.activeId = null
  events.push({ type: 'crash', name: v.name, wasActive, reason })
}

/** Dünyayı dtReal gerçek saniye ilerletir. */
export function stepWorld(sim: Sim, dtReal: number, ctrl: Controls): GameEvent[] {
  const gs = sim.gs
  const events: GameEvent[] = []
  const active = activeVessel(gs)
  const real = Math.min(0.05, Math.max(0, dtReal))

  if (active && sim.warpIdx > PHYSICS_WARP_MAX_IDX && needsPhysics(active, ctrl)) {
    sim.warpIdx = PHYSICS_WARP_MAX_IDX
    events.push({ type: 'toast', text: 'Zaman hızlandırma 25×\'e düştü (itki / atmosfer / yüzey).' })
  }
  let simDt = real * WARPS[sim.warpIdx]!
  const t0 = gs.time

  for (const v of [...gs.vessels]) {
    const isActive = v === active
    const c = isActive ? ctrl : null
    if (!needsPhysics(v, c) && v.landed) {
      sim.firing.delete(v.id)
      continue
    }
    if (needsPhysics(v, c) && sim.warpIdx <= PHYSICS_WARP_MAX_IDX) {
      const n = Math.max(1, Math.ceil(simDt / PHYSICS_DT))
      const h = simDt / n
      for (let i = 0; i < n; i += 1) {
        const res = stepPhysics(v, h, c)
        sim.firing.set(v.id, res.firing)
        if (res.crash) {
          destroy(sim, v, res.crash, events)
          break
        }
        if (res.touchdown && isActive) events.push({ type: 'toast', text: `${BODIES[v.bodyId].name} yüzeyine iniş başarılı.` })
        if (res.touchdown) break
      }
      if (gs.vessels.includes(v)) checkSoi(gs, v, t0 + simDt, events)
      continue
    }
    // Raylar üstünde (analitik Kepler) ilerleme, olayları kaçırmamak için parçalara bölünür.
    sim.firing.delete(v.id)
    const st = vesselStats(v.parts, v.cargo)
    rotateVessel(v, st, real, c)
    let remaining = simDt
    let guard = 0
    while (remaining > 1e-9 && guard < 4000) {
      guard += 1
      const chunk = Math.min(remaining, Math.max(0.5, (0.03 * len(v.pos)) / Math.max(len(v.vel), 1)))
      stepRails(v, chunk)
      remaining -= chunk
      const t = t0 + (simDt - remaining)
      if (checkSoi(gs, v, t, events) && isActive && sim.warpIdx > 4) sim.warpIdx = 4
      const body = BODIES[v.bodyId]
      const s = situation(v, st)
      if (s.r < body.radius || (body.landable && s.alt <= 0)) {
        destroy(sim, v, isActive ? 'yüzeye çarptı' : 'yörüngeden düştü', events)
        break
      }
      if (!isActive && s.altSea < body.atmoHeight * 0.5) {
        destroy(sim, v, 'atmosferde yandı', events)
        break
      }
      if (isActive && sim.warpIdx > PHYSICS_WARP_MAX_IDX && (s.altSea < body.atmoHeight || (body.landable && s.vr < 0 && s.alt < Math.max(4000, -20 * s.vr)))) {
        // Yaklaşma koruması: kalan süreyi at, fizik adımına geç.
        sim.warpIdx = PHYSICS_WARP_MAX_IDX
        simDt -= remaining
        remaining = 0
        events.push({ type: 'toast', text: 'Yüzeye/atmosfere yaklaşıldı: zaman 25×.' })
      }
    }
  }

  gs.time = t0 + simDt

  for (const v of gs.vessels) chargeBatteries(v, vesselStats(v.parts, v.cargo), gs.time, simDt)

  for (const id of Object.keys(gs.bases) as BodyId[]) {
    const base = gs.bases[id]!
    const mult = baseIncomeMultiplier(gs, id)
    gs.money += tickBase(base, solarFlux(len(bodyAbsState(id, gs.time).r)), simDt, mult, id !== 'earth')
  }

  const cur = activeVessel(gs)
  if (cur) {
    for (const m of MISSIONS) {
      if (m.check && !gs.missionsDone.includes(m.id) && m.check(cur, gs)) completeMission(gs, m.id, events)
    }
  }
  return events
}

// ───────────────────────── oyuncu eylemleri ─────────────────────────

export function designCost(design: PartInst[], cargo: Record<string, number>): number {
  let c = design.reduce((s, p) => s + partDef(p.def).cost, 0)
  for (const [id, n] of Object.entries(cargo)) c += (MODULE_BY_ID[id]?.cost ?? 0) * n
  return c
}

export function validateDesign(design: PartInst[], cargo: Record<string, number>, gs?: GameState): string | null {
  if (!design.length) return 'Önce grid\'e parça yerleştir.'
  if (gs) {
    for (const p of design) {
      if (!isPartUnlocked(gs, p.def)) {
        const tech = requiredTechForPart(p.def)
        return `"${partDef(p.def).name}" için teknoloji gerekli: ${tech?.name ?? 'Araştırma'}.`
      }
    }
    for (const [id, n] of Object.entries(cargo)) {
      if (n > 0 && !isModuleUnlocked(gs, id)) {
        const tech = requiredTechForModule(id)
        return `"${MODULE_BY_ID[id]?.name ?? id}" için teknoloji gerekli: ${tech?.name ?? 'Araştırma'}.`
      }
    }
  }
  const st = vesselStats(design)
  if (!st.hasCommand) return 'Bir komuta modülü (kapsül veya sonda çekirdeği) gerekli.'
  if (!isConnected(design)) return 'Tüm parçalar birbirine bağlı olmalı.'
  if (!design.some((p) => partDef(p.def).kind === 'engine')) return 'En az bir motor gerekli.'
  const cm = cargoMass({ modules: cargo, ore: 0, oreFrom: null })
  if (cm > st.cargoCap + 1e-9) return `Kargo ${cm} t, kapasite ${st.cargoCap} t. Kargo gövdesi ekle.`
  return null
}

/** Tasarımı satın alıp Dünya'daki rampaya koyar. Hata varsa mesaj döndürür. */
export function launchDesign(sim: Sim): string | null {
  const gs = sim.gs
  const err = validateDesign(gs.design, gs.designCargo, gs)
  if (err) return err
  const cost = designCost(gs.design, gs.designCargo)
  if (cost > gs.money) return `Bütçe yetersiz: ${cost.toLocaleString('tr-TR')} ₡ gerekli.`
  const onPad = gs.vessels.find((v) => v.bodyId === 'earth' && v.landed && Math.abs(wrapPi(Math.atan2(v.pos.y, v.pos.x) - PAD_ANGLE)) * BODIES.earth.radius < 60)
  if (onPad) return `Rampa dolu: önce "${onPad.name}" aracını kurtar veya kaldır.`
  const parts = freshParts(gs.design)
  const st = vesselStats(parts)
  const r = BODIES.earth.radius + terrainHeight('earth', PAD_ANGLE) + (st.maxY - st.comY)
  const id = gs.nextId
  gs.nextId += 1
  const v: Vessel = {
    id, name: `Selene ${id}`, parts, bodyId: 'earth',
    pos: { x: Math.cos(PAD_ANGLE) * r, y: Math.sin(PAD_ANGLE) * r }, vel: { x: 0, y: 0 },
    angle: PAD_ANGLE, angVel: 0, landed: true, throttle: 0, ec: st.ecCap,
    cargo: { modules: { ...gs.designCargo }, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off',
    visited: ['earth'], assist: null, dvUsed: 0,
  }
  gs.money -= cost
  gs.vessels.push(v)
  gs.activeId = id
  sim.warpIdx = 0
  return null
}

export function setActive(sim: Sim, id: number) {
  const prev = activeVessel(sim.gs)
  if (prev && prev.id !== id) prev.throttle = 0
  if (sim.gs.vessels.some((v) => v.id === id)) sim.gs.activeId = id
}

/** Kademe adaptör(ler)ini ateşler: araç bağımsız gövdelere ayrılır. */
export function decouple(sim: Sim, v: Vessel, indices: number[]): GameEvent[] {
  if (!indices.length) return []
  const gs = sim.gs
  const old = vesselStats(v.parts)
  const pieces = splitParts(v.parts, indices)
  if (!pieces.length) return []
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  const right = { x: fwd.y, y: -fwd.x }
  const wasLanded = v.landed
  pieces.forEach((parts, i) => {
    const st = vesselStats(parts)
    const lx = st.comX - old.comX
    const lf = -(st.comY - old.comY)
    const off = { x: right.x * lx + fwd.x * lf, y: right.y * lx + fwd.y * lf }
    const d = Math.hypot(lx, lf) || 1
    const push = i === 0 ? 0 : wasLanded ? 0 : 1.6
    const pos = { x: v.pos.x + off.x, y: v.pos.y + off.y }
    const vel = { x: v.vel.x + (off.x / d) * push, y: v.vel.y + (off.y / d) * push }
    if (i === 0) {
      v.parts = parts
      v.pos = pos
      v.landed = false
      const cap = st.cargoCap
      if (cargoMass(v.cargo) > cap + 1e-9) v.cargo = { modules: {}, ore: 0, oreFrom: null }
      v.ec = Math.min(v.ec, st.ecCap)
    } else {
      const id = gs.nextId
      gs.nextId += 1
      gs.vessels.push({
        id, name: st.hasCommand ? `${v.name}-B${id}` : `Kademe ${id}`, parts, bodyId: v.bodyId, pos, vel,
        angle: v.angle, angVel: v.angVel + (lx > 0 ? -0.15 : lx < 0 ? 0.15 : 0), landed: false, throttle: 0, ec: 0,
        cargo: { modules: {}, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off', visited: [...v.visited], assist: null, dvUsed: 0,
      })
    }
  })
  sim.firing.delete(v.id)
  return [{ type: 'toast', text: 'Kademe ayrıldı.' }]
}

export const stageNext = (sim: Sim, v: Vessel) => decouple(sim, v, nextStage(v.parts))

/** Dünya'ya inmiş aracı kurtarır: parçaların %80'i iade, maden satılır. */
export function recoverVessel(sim: Sim, v: Vessel): GameEvent[] {
  const gs = sim.gs
  const events: GameEvent[] = []
  if (v.bodyId !== 'earth' || !v.landed) return [{ type: 'toast', text: 'Kurtarma yalnızca Dünya yüzeyinde yapılır.' }]
  const st = vesselStats(v.parts)
  let refund = st.cost * 0.8
  for (const [id, n] of Object.entries(v.cargo.modules)) refund += (MODULE_BY_ID[id]?.cost ?? 0) * n
  let oreIncome = 0
  if (v.cargo.ore > 0 && v.cargo.oreFrom) {
    oreIncome = v.cargo.ore * BODIES[v.cargo.oreFrom].orePrice * orePriceMultiplier(gs)
    completeMission(gs, 'ore-return', events)
  }
  if (v.visited.includes('moon') && st.hasCommand) completeMission(gs, 'earth-return', events)
  gs.money += refund + oreIncome
  gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
  if (gs.activeId === v.id) gs.activeId = null
  events.push({ type: 'toast', text: `Araç kurtarıldı: +${Math.round(refund).toLocaleString('tr-TR')} ₡ parça iadesi${oreIncome ? `, +${Math.round(oreIncome).toLocaleString('tr-TR')} ₡ maden satışı` : ''}.` })
  return events
}

/** İnen aracın kargosundaki modülleri yüzey üssüne kurar. */
export function deployModules(sim: Sim, v: Vessel): string | null {
  if (!v.landed || v.bodyId === 'earth' || !BODIES[v.bodyId].landable) {
    return 'Modül kurmak için Dünya dışı bir gezegen veya uydu yüzeyine inmelisin.'
  }
  const total = Object.values(v.cargo.modules).reduce((s, n) => s + n, 0)
  if (!total) return 'Kargoda kurulacak modül yok.'
  const base = (sim.gs.bases[v.bodyId] ??= emptyBase(Math.atan2(v.pos.y, v.pos.x)))
  for (const [id, n] of Object.entries(v.cargo.modules)) base.modules[id] = (base.modules[id] ?? 0) + n
  v.cargo.modules = {}
  return null
}

/** Dünya yer kontrol üssüne doğrudan pasif gelir modülü satın alır. */
export function buyEarthModule(sim: Sim, moduleId: string): string | null {
  const gs = sim.gs
  const m = MODULE_BY_ID[moduleId]
  if (!m) return 'Bilinmeyen modül.'
  if (moduleId === 'drill' || moduleId === 'isru') return 'Sondaj ve ISRU yalnızca Dünya dışı gezegenlerde kurulur.'
  if (!isModuleUnlocked(gs, moduleId)) {
    const t = requiredTechForModule(moduleId)
    return `Önce "${t?.name ?? 'Teknoloji'}" araştırmasını açmalısın.`
  }
  if (gs.money < m.cost) return `${m.cost.toLocaleString('tr-TR')} ₡ gerekli.`
  gs.money -= m.cost
  const base = (gs.bases.earth ??= emptyBase(PAD_ANGLE))
  base.modules[moduleId] = (base.modules[moduleId] ?? 0) + 1
  return null
}

export function loadOre(sim: Sim, v: Vessel): string | null {
  const base = sim.gs.bases[v.bodyId]
  if (!v.landed || !base) return 'Maden yüklemek için üssün olduğu yüzeye inmelisin.'
  const free = vesselStats(v.parts).cargoCap - cargoMass(v.cargo)
  const amount = Math.min(free, base.ore)
  if (amount < 0.01) return free < 0.01 ? 'Kargo gövdesinde yer yok.' : 'Üste henüz maden birikmedi.'
  base.ore -= amount
  v.cargo.ore += amount
  v.cargo.oreFrom = v.bodyId
  return null
}

/** ISRU: 1 t maden → 2 t yakıt. */
export function refuelAtBase(sim: Sim, v: Vessel): string | null {
  const base = sim.gs.bases[v.bodyId]
  if (!v.landed || !base) return 'Yakıt ikmali için üssün olduğu yüzeye inmelisin.'
  if (!(base.modules.isru ?? 0)) return 'Üste ISRU Yakıt Tesisi yok.'
  const tanks = v.parts.filter((p) => partDef(p.def).kind === 'tank')
  const need = tanks.reduce((s, p) => s + (partDef(p.def).fuel! - (p.fuel ?? 0)), 0)
  const give = Math.min(need, base.ore * 2)
  if (give < 0.01) return need < 0.01 ? 'Tanklar zaten dolu.' : 'Yakıt üretmek için maden yok.'
  base.ore -= give / 2
  let left = give
  for (const p of tanks) {
    const room = partDef(p.def).fuel! - (p.fuel ?? 0)
    const add = Math.min(room, left)
    p.fuel = (p.fuel ?? 0) + add
    left -= add
  }
  return null
}

/** Uçuşta tıklanan parçaya göre eylem. */
export function clickPart(sim: Sim, v: Vessel, index: number): GameEvent[] {
  const p = v.parts[index]
  if (!p) return []
  const d = partDef(p.def)
  switch (d.kind) {
    case 'decoupler':
    case 'radialDecoupler':
      return decouple(sim, v, [index])
    case 'solar':
    case 'leg':
    case 'chute':
      p.deployed = !p.deployed
      return [{ type: 'toast', text: `${d.name}: ${p.deployed ? 'açıldı' : 'kapandı'}` }]
    case 'engine':
      p.on = p.on === false
      return [{ type: 'toast', text: `${d.name}: ${p.on ? 'açık' : 'kapalı'}` }]
    default:
      return []
  }
}

export function toggleKind(v: Vessel, kind: 'solar' | 'leg' | 'chute') {
  const items = v.parts.filter((p) => partDef(p.def).kind === kind)
  const open = !items.every((p) => p.deployed)
  for (const p of items) p.deployed = open
  return items.length ? open : null
}

/** Aracı kalıcı olarak siler (boşta kalan kademeler ve terk edilmiş gemiler için). */
export function deleteVessel(sim: Sim, id: number): boolean {
  const gs = sim.gs
  const before = gs.vessels.length
  gs.vessels = gs.vessels.filter((v) => v.id !== id)
  sim.firing.delete(id)
  if (gs.activeId === id) gs.activeId = gs.vessels.find((v) => vesselStats(v.parts).hasCommand)?.id ?? null
  return gs.vessels.length < before
}

export const DOCK_RANGE_M = 30
export const DOCK_SPEED_MPS = 3

/** Kenetlenmeye uygun en yakın araç: aynı gök cisminde, 30 m içinde, 3 m/s altında bağıl hız. */
export function dockCandidate(gs: GameState, v: Vessel): Vessel | null {
  if (v.landed) return null
  let best: Vessel | null = null
  let bestD = DOCK_RANGE_M
  for (const o of gs.vessels) {
    if (o.id === v.id || o.bodyId !== v.bodyId || o.landed) continue
    const d = Math.hypot(o.pos.x - v.pos.x, o.pos.y - v.pos.y)
    const dv = Math.hypot(o.vel.x - v.vel.x, o.vel.y - v.vel.y)
    if (d < bestD && dv < DOCK_SPEED_MPS) {
      best = o
      bestD = d
    }
  }
  return best
}

/**
 * Yörüngede kenetlenme: diğer araç, aktif aracın burnuna bir dikey adaptörle bağlanır.
 * Yakıt ve kargo birleşir; adaptöre tıklayınca araçlar yeniden ayrılır.
 */
export function dockVessels(sim: Sim, v: Vessel, other: Vessel): GameEvent[] {
  const gs = sim.gs
  const center = (p: PartInst) => p.x + partDef(p.def).w / 2
  const top = v.parts.reduce((a, p) => (p.y < a.y ? p : a))
  const bottom = other.parts.reduce((a, p) => (p.y + partDef(p.def).h > a.y + partDef(a.def).h ? p : a))
  const decX = Math.round(center(top) - 1)
  const decY = top.y - 1
  const dx = Math.round(decX + 1 - center(bottom))
  const dy = decY - (bottom.y + partDef(bottom.def).h)
  const m1 = vesselStats(v.parts, v.cargo).mass
  const m2 = vesselStats(other.parts, other.cargo).mass
  let parts: PartInst[] = [
    ...v.parts,
    { def: 'decoupler', x: decX, y: decY },
    ...other.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  ]
  const minX = Math.min(...parts.map((p) => p.x))
  const minY = Math.min(...parts.map((p) => p.y))
  parts = parts.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY }))
  if (!isConnected(parts)) return [{ type: 'toast', text: 'Kenetlenme başarısız: gövdeler hizalanamadı.' }]
  const k = m2 / (m1 + m2)
  v.pos = { x: v.pos.x + (other.pos.x - v.pos.x) * k, y: v.pos.y + (other.pos.y - v.pos.y) * k }
  v.vel = { x: v.vel.x + (other.vel.x - v.vel.x) * k, y: v.vel.y + (other.vel.y - v.vel.y) * k }
  v.parts = parts
  v.ec += other.ec
  for (const [id, n] of Object.entries(other.cargo.modules)) v.cargo.modules[id] = (v.cargo.modules[id] ?? 0) + n
  if (other.cargo.ore > 0) {
    v.cargo.ore += other.cargo.ore
    v.cargo.oreFrom = v.cargo.oreFrom ?? other.cargo.oreFrom
  }
  for (const b of other.visited) if (!v.visited.includes(b)) v.visited.push(b)
  v.throttle = 0
  v.angVel = 0
  gs.vessels = gs.vessels.filter((o) => o.id !== other.id)
  sim.firing.delete(other.id)
  sim.firing.delete(v.id)
  return [{ type: 'toast', text: `${other.name} ile kenetlenildi. Ayırmak için aradaki adaptöre tıkla.` }]
}
