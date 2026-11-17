/**
 * Çok oyunculu "Gezegenleri Ele Geçir" (Capture the Planets) saf oyun kuralları:
 *  - Dinamik akıllı zaman hızlandırma (otomatik yükselme, çarpışma/iniş/yanışta anında fren)
 *  - Süpürmeli (swept) roket-roket çarpışma ve uzayda/havada parçalanma
 *  - Bayrak kapmaca tarzı gezegen ele geçirme ve savunma
 *  - Oyuncu başına bağımsız bütçe, fırlatma rampası ve hedef yönetimi
 */
import {
  baseReport,
  COLONY_STATION_ID,
  emptyBase,
  ensureSiteHp,
  isQuadrantColonized,
  QUADRANTS,
  quadrantCenterAngle,
  quadrantOfAngle,
  STARTER_EARTH_SITES,
  syncModules,
  tickBase,
  WARFARE_STARTER_EARTH_SITES,
} from '../game/base'
import { COMBAT_PRESETS, DEFAULT_DESIGN, LOOT_PRESETS, OUTPOST_INCOME_PER_MIN, partDef } from '../game/data'
import { INITIAL_TECH } from '../game/tech'
import type {
  Base,
  DynamicWarpInfo,
  GameEvent,
  GameState,
  MultiplayerConfig,
  MultiplayerMode,
  MultiplayerPlayer,
  PlanetCapture,
  Vessel,
  WarfareGoal,
} from '../game/types'
import { vesselStats } from '../game/vessel'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import {
  applyImpactDamage,
  getActorQuadrantBase,
  getPlayerQuadrantColonies,
  isLootMode,
  isWarfareMode,
  setActorQuadrantBase,
  stepWarfareRules,
} from './combat'
import type { Fx } from './world'
import { ensureLootSetup, findOutpost, LOOT_START_MONEY } from './loot'
import { bodyAbsState, elementsFromState, len } from './orbit'
import {
  type Controls,
  effectiveAutopilot,
  landingTolerance,
  needsPhysics,
  orbitCoastWait,
  PAD_ANGLE,
  situation,
} from './physics'

export const WARPS = [1, 2, 4, 10, 25, 100, 500, 2500, 10000, 50000, 100000]
export const PHYSICS_WARP_MAX_IDX = 4

export const CONQUERABLE_BODIES: BodyId[] = ['moon', 'mercury', 'venus', 'mars', 'ceres', 'ganymede', 'titan']
export const PLAYER_COLORS = ['#38d9e8', '#fb7185', '#4ade80', '#fbbf24', '#c084fc', '#fb923c', '#60a5fa', '#f472b6', '#a3e635', '#f87171', '#2dd4bf', '#e879f9', '#facc15', '#818cf8', '#fda4af', '#94a3b8']

const CAPTURE_NEUTRALIZE_SEC = 5

export interface FxEventLike {
  kind: 'boom' | 'beam' | 'hit' | 'shield' | 'muzzle' | 'shockwave' | 'debrisBurst' | 'smokePlume'
  bodyId: BodyId
  x: number
  y: number
  x2?: number
  y2?: number
  color?: string
  born: number
  size: number
}

/** Dünya üzerindeki düz rampa bölgesinde her oyuncu yuvası için ayrı açı döndürür. */
export function padAngleForSlot(slot: number, mode: MultiplayerMode = 'colony-race'): number {
  if (slot <= 0) return PAD_ANGLE
  const step = mode === 'orbital-warfare' ? 0.00085 : 0.00045
  const k = Math.ceil(slot / 2)
  const dir = slot % 2 === 1 ? 1 : -1
  return PAD_ANGLE + dir * k * step
}

export function playerPadAngle(gs: GameState, ownerId?: string): number {
  if (!gs.mp || !ownerId) return PAD_ANGLE
  const p = gs.mp.players[ownerId]
  return padAngleForSlot(p?.slot ?? 0, gs.mp.config.mode ?? 'colony-race')
}

export function makeStarterEarthBase(slot: number, ownerId?: string, mode: MultiplayerMode = 'colony-race', isLoot = false): Base {
  const b = emptyBase(padAngleForSlot(slot, mode), ownerId)
  b.quadrant = 0
  b.sites = mode === 'orbital-warfare' || isLoot ? [...WARFARE_STARTER_EARTH_SITES] : [...STARTER_EARTH_SITES]
  syncModules(b)
  if (mode === 'orbital-warfare' || isLoot) ensureSiteHp(b)
  return b
}

export function createMultiplayerPlayer(
  id: string,
  username: string,
  slot: number,
  color: string,
  startingMoney: number,
  mode: MultiplayerMode = 'colony-race',
  isLoot = mode === 'loot-raid',
): MultiplayerPlayer {
  const earthBase = makeStarterEarthBase(slot, id, mode, isLoot)
  return {
    id,
    username,
    color,
    slot,
    money: startingMoney,
    targetBody: 'moon',
    activeVesselId: null,
    wantsWarpIdx: -1,
    warpAnchor: false,
    planetsHeld: 0,
    captures: 0,
    kills: 0,
    score: 0,
    coloniesDestroyed: 0,
    eliminated: false,
    earthBase,
    quadrantColonies: { earth: [earthBase, undefined, undefined, undefined] },
    ...(mode === 'orbital-warfare' || mode === 'loot-raid' ? { colonies: {} } : {}),
  }
}

export function newMultiplayerGame(
  roomId: string,
  hostId: string,
  playersList: { id: string; username: string; color: string; slot: number }[],
  config: Partial<MultiplayerConfig> = {},
): GameState {
  const mode: MultiplayerMode =
    config.mode === 'orbital-warfare' ? 'orbital-warfare' : config.mode === 'loot-raid' ? 'loot-raid' : 'colony-race'
  const warfareGoal: WarfareGoal =
    config.warfareGoal === 'score15' ||
    config.warfareGoal === 'score30' ||
    config.warfareGoal === 'endless' ||
    config.warfareGoal === 'raid'
      ? config.warfareGoal
      : mode === 'loot-raid'
        ? 'raid'
        : 'siege'
  const isLoot = mode === 'loot-raid' || (mode === 'orbital-warfare' && warfareGoal === 'raid')
  const cfg: MultiplayerConfig = {
    mode,
    warfareGoal,
    lootGoal: config.lootGoal ?? 60,
    targetPlanets: config.targetPlanets ?? 4,
    startingMoney: config.startingMoney ?? (isLoot ? LOOT_START_MONEY : mode === 'orbital-warfare' ? 100_000 : 50_000),
    passiveBonusPerPlanet: config.passiveBonusPerPlanet ?? 4_000,
    allowAutoWarp: config.allowAutoWarp ?? true,
  }
  const players: Record<string, MultiplayerPlayer> = {}
  const playerMeta: Record<string, { id: string; username: string; color: string }> = {}
  for (const p of playersList) {
    players[p.id] = createMultiplayerPlayer(p.id, p.username, p.slot, p.color, cfg.startingMoney, mode, isLoot)
    playerMeta[p.id] = { id: p.id, username: p.username, color: p.color }
  }
  if (!players[hostId]) {
    const col = PLAYER_COLORS[0]!
    players[hostId] = createMultiplayerPlayer(hostId, hostId, 0, col, cfg.startingMoney, mode, isLoot)
    playerMeta[hostId] = { id: hostId, username: hostId, color: col }
  }
  const captures: Partial<Record<BodyId, PlanetCapture>> = {}
  const quadrantCaptures: Partial<Record<BodyId, (PlanetCapture | undefined)[]>> = {}
  for (const id of CONQUERABLE_BODIES) {
    captures[id] = {
      bodyId: id,
      ownerId: null,
      flagAngle: Math.PI / 2,
      progress: 0,
      capturerId: null,
      phase: 'idle',
    }
    quadrantCaptures[id] = QUADRANTS.map((q) => ({
      bodyId: id,
      quadrant: q,
      ownerId: null,
      flagAngle: quadrantCenterAngle(q),
      progress: 0,
      capturerId: null,
      phase: 'idle' as const,
    }))
  }
  const earth = makeStarterEarthBase(0, hostId, mode, isLoot)
  const initialDesign = (
    isLoot ? LOOT_PRESETS[0]!.design : mode === 'orbital-warfare' ? COMBAT_PRESETS[0]!.design : DEFAULT_DESIGN
  ).map((p) => ({ ...p }))
  const welcomeText = isLoot
    ? '🏴‍☠️ Uzay Yağması başladı! Arenada ganimet sandığı topla, üssünü Sv 5\'e kadar geliştir, rakipleri yağmala!'
    : mode === 'orbital-warfare'
      ? '⚔️ Uzay Savaşı başladı! Roketine silahlar ekle, rakiplerle çarpış ve düşman kolonilerini yok et!'
      : '🚀 Koloni yarışı başladı! Gezegenlerin 4 çeyreğine Uzay İstasyonu kur; gezegen kontrolü için yarış!'
  const game: GameState = {
    time: 0,
    tick: 0,
    protocolVersion: 1,
    ownerId: hostId,
    players: playerMeta,
    money: players[hostId]!.money,
    vessels: [],
    activeId: null,
    nextId: 1,
    bases: { earth },
    quadrantBases: { earth: [earth, undefined, undefined, undefined] },
    missionsDone: [],
    techDone: [INITIAL_TECH],
    design: initialDesign,
    designCargo: {},
    targetBody: 'moon',
    lastSavedAt: Date.now(),
    mp: {
      roomId,
      hostId,
      started: true,
      winnerId: null,
      config: cfg,
      players,
      captures,
      quadrantCaptures,
      warpInfo: {
        warpIdx: 0,
        warp: 1,
        mode: 'auto',
        reason: 'Akıllı zaman senkronu aktif',
        nearestInterceptM: null,
      },
      feed: [{ id: 1, time: 0, text: welcomeText }],
      ...(mode !== 'colony-race' ? { projectiles: [], nextProjId: 1 } : {}),
    },
  }
  ensureLootSetup(game)
  return game
}

export function addMultiplayerPlayer(gs: GameState, id: string, username: string, color: string, slot: number) {
  if (!gs.mp) return
  if (gs.mp.players[id]) return
  const mode = gs.mp.config.mode ?? 'colony-race'
  gs.mp.players[id] = createMultiplayerPlayer(id, username, slot, color, gs.mp.config.startingMoney, mode, isLootMode(gs))
  gs.players = { ...(gs.players ?? {}), [id]: { id, username, color } }
  pushMpFeed(gs, `🛰️ ${username} göreve katıldı.`, color)
}

export function removeMultiplayerPlayer(gs: GameState, id: string) {
  if (!gs.mp) return
  const p = gs.mp.players[id]
  if (!p) return
  delete gs.mp.players[id]
  // Yağma modu: ayrılan oyuncunun üssü de kaldırılır.
  gs.vessels = gs.vessels.filter((v) => !(v.outpost && v.ownerId === id))
  pushMpFeed(gs, `${p.username} ayrıldı.`, p.color)
}

export function pushMpFeed(gs: GameState, text: string, color?: string) {
  if (!gs.mp) return
  const last = gs.mp.feed[gs.mp.feed.length - 1]
  const id = (last?.id ?? 0) + 1
  gs.mp.feed.push({ id, time: gs.time, text, color })
  if (gs.mp.feed.length > 24) gs.mp.feed.splice(0, gs.mp.feed.length - 24)
}

export function getPlayerMoney(gs: GameState, ownerId?: string): number {
  if (!gs.mp) return gs.money
  const key = ownerId ?? gs.ownerId ?? gs.mp.hostId
  return gs.mp.players[key]?.money ?? gs.money
}

export function addPlayerMoney(gs: GameState, delta: number, ownerId?: string) {
  if (!gs.mp) {
    gs.money += delta
    return
  }
  const key = ownerId ?? gs.ownerId ?? gs.mp.hostId
  const p = gs.mp.players[key]
  if (p) {
    p.money += delta
    if (key === gs.ownerId) gs.money = p.money
  }
}

export function getActiveVesselForPlayer(gs: GameState, ownerId?: string): Vessel | null {
  if (!gs.mp) return gs.vessels.find((v) => v.id === gs.activeId) ?? null
  const key = ownerId ?? gs.ownerId
  if (!key) return null
  const aid = gs.mp.players[key]?.activeVesselId
  return aid ? gs.vessels.find((v) => v.id === aid) ?? null : null
}

export function setActiveVesselForPlayer(gs: GameState, ownerId: string, vesselId: number | null) {
  if (!gs.mp) {
    gs.activeId = vesselId
    return
  }
  const p = gs.mp.players[ownerId]
  if (p) p.activeVesselId = vesselId
  if (ownerId === gs.ownerId) gs.activeId = vesselId
}

export function isAnyActivePlayerVessel(gs: GameState, v: Vessel): boolean {
  if (!gs.mp) return v.id === gs.activeId
  for (const p of Object.values(gs.mp.players)) {
    if (p.activeVesselId === v.id) return true
  }
  return false
}

export function vesselTargetBody(gs: GameState, v: Vessel): BodyId {
  if (v.targetBody) return v.targetBody
  if (gs.mp && v.ownerId && gs.mp.players[v.ownerId]) return gs.mp.players[v.ownerId]!.targetBody
  return (gs.targetBody ?? 'moon') as BodyId
}

export function playerPassiveIncomePerMin(gs: GameState, playerId: string): number {
  if (!gs.mp) return 0
  const p = gs.mp.players[playerId]
  if (!p) return 0
  if (isLootMode(gs)) {
    return findOutpost(gs, p.id) ? (OUTPOST_INCOME_PER_MIN[p.outpostLevel ?? 1] ?? 3000) : 0
  }
  const earthFlux = solarFlux(len(bodyAbsState('earth', gs.time).r))
  let sum = 0
  for (const item of getPlayerQuadrantColonies(p, 'earth')) {
    if (!item.base.destroyed) sum += baseReport(item.base, earthFlux, 1).incomePerMin
  }
  if (isWarfareMode(gs)) {
    for (const bodyId of CONQUERABLE_BODIES) {
      const b = BODIES[bodyId]
      const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
      for (const item of getPlayerQuadrantColonies(p, bodyId)) {
        if (item.base.destroyed) continue
        if (isQuadrantColonized(item.base, flux)) {
          sum += gs.mp.config.passiveBonusPerPlanet * 0.4 * Math.max(1, b.incomeMult * 0.5)
        }
        sum += baseReport(item.base, flux, b.incomeMult).incomePerMin
      }
    }
    return sum
  }
  for (const bodyId of CONQUERABLE_BODIES) {
    const b = BODIES[bodyId]
    const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
    const qCaps = gs.mp.quadrantCaptures?.[bodyId]
    for (const q of QUADRANTS) {
      const qCap = qCaps?.[q] ?? (q === 0 ? gs.mp.captures[bodyId] : undefined)
      if (qCap?.ownerId !== playerId) continue
      const colony = getActorQuadrantBase(gs, bodyId, playerId, q)
      if (isQuadrantColonized(colony, flux)) {
        sum += gs.mp.config.passiveBonusPerPlanet * 0.4 * Math.max(1, b.incomeMult * 0.5)
      }
      if (colony) {
        sum += baseReport(colony, flux, b.incomeMult).incomePerMin
      }
    }
  }
  return sum
}

export function stepMultiplayerIncome(gs: GameState, incomeDt: number) {
  if (!gs.mp) return
  const minutes = incomeDt / 60
  if (isLootMode(gs)) {
    for (const p of Object.values(gs.mp.players)) {
      if (!findOutpost(gs, p.id)) continue
      const rate = OUTPOST_INCOME_PER_MIN[p.outpostLevel ?? 1] ?? 3000
      p.money += rate * minutes
    }
    if (gs.ownerId && gs.mp.players[gs.ownerId]) gs.money = gs.mp.players[gs.ownerId]!.money
    return
  }
  const earthFlux = solarFlux(len(bodyAbsState('earth', gs.time).r))
  for (const p of Object.values(gs.mp.players)) {
    for (const item of getPlayerQuadrantColonies(p, 'earth')) {
      if (!item.base.destroyed) {
        p.money += tickBase(item.base, earthFlux, incomeDt, 1, item.quadrant !== 0)
      }
    }
  }
  if (isWarfareMode(gs)) {
    for (const p of Object.values(gs.mp.players)) {
      for (const bodyId of CONQUERABLE_BODIES) {
        const b = BODIES[bodyId]
        const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
        for (const item of getPlayerQuadrantColonies(p, bodyId)) {
          if (item.base.destroyed) continue
          if (isQuadrantColonized(item.base, flux)) {
            p.money += gs.mp.config.passiveBonusPerPlanet * 0.4 * Math.max(1, b.incomeMult * 0.5) * minutes
          }
          p.money += tickBase(item.base, flux, incomeDt, b.incomeMult, true)
        }
      }
    }
    if (gs.ownerId && gs.mp.players[gs.ownerId]) gs.money = gs.mp.players[gs.ownerId]!.money
    return
  }
  for (const bodyId of CONQUERABLE_BODIES) {
    const b = BODIES[bodyId]
    const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
    const qCaps = gs.mp.quadrantCaptures?.[bodyId]
    for (const q of QUADRANTS) {
      const qCap = qCaps?.[q] ?? (q === 0 ? gs.mp.captures[bodyId] : undefined)
      if (!qCap?.ownerId) continue
      const owner = gs.mp.players[qCap.ownerId]
      if (!owner) continue
      const colony = getActorQuadrantBase(gs, bodyId, owner.id, q)
      if (isQuadrantColonized(colony, flux)) {
        owner.money += gs.mp.config.passiveBonusPerPlanet * 0.4 * Math.max(1, b.incomeMult * 0.5) * minutes
      }
      if (colony) {
        owner.money += tickBase(colony, flux, incomeDt, b.incomeMult, true)
      }
    }
  }
  if (gs.ownerId && gs.mp.players[gs.ownerId]) gs.money = gs.mp.players[gs.ownerId]!.money
}

// ───────────────────────── Roket-Roket Çarpışmaları ─────────────────────────

export function vesselRadius(v: Vessel): number {
  if (v.station) return 4.2
  if (v.outpost) return 5.5
  const st = vesselStats(v.parts)
  return Math.max(1.2, Math.hypot(st.maxX - st.minX, st.maxY - st.minY) * 0.44)
}

function spawnBoomFx(
  fxOut: FxEventLike[] | undefined,
  events: GameEvent[],
  bodyId: BodyId,
  x: number,
  y: number,
  born: number,
  size: number,
) {
  if (fxOut) {
    fxOut.push({ kind: 'boom', bodyId, x, y, born, size })
    if (fxOut.length > 60) fxOut.splice(0, fxOut.length - 60)
  }
  events.push({ type: 'explosion', size, bodyId, x, y })
}

/**
 * Uzayda / havada veya yüzeydeki rakibe çarpışma hasarı:
 * Yüzeydeki `shatter()`'ın aksine aracı yüzeye ışınlamaz — uçuyorsa yörüngede kalır!
 */
function shatterMidAir(
  gs: GameState,
  v: Vessel,
  shockSpeed: number,
  reason: string,
  attackerId: string | undefined,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: FxEventLike[] | undefined,
  events: GameEvent[],
  hitX: number,
  hitY: number,
) {
  if (v.debris) {
    const d = partDef(v.parts[0]?.def ?? 'tank-s')
    spawnBoomFx(fxOut, events, v.bodyId, v.pos.x, v.pos.y, clock, 1.8 + Math.max(d.w, d.h) * 0.8)
    gs.vessels = gs.vessels.filter((o) => o.id !== v.id)
    firing.delete(v.id)
    return
  }

  // Darbe yalnızca temas noktasının çevresini ezer: gemi bütün hâlde parçalanmaz.
  const res = applyImpactDamage(gs, v, hitX, hitY, shockSpeed, { attackerId, clock, firing, fxOut: fxOut as Fx[] | undefined, events })
  if (res.destroyed || !gs.vessels.includes(v)) return
  if (!v.outpost) {
    v.landed = false
    v.autopilot = 'off'
    v.autoLand = false
    v.autopilotNote = undefined
    v.approachWarn = null
  }
  v.noCollideUntil = gs.time + 0.6
  if (attackerId && attackerId !== v.ownerId) v.lastAttackerId = attackerId
  events.push({ type: 'toast', ownerId: v.ownerId, text: `${v.name}: ${reason} (hasarlı)!` })
}

/**
 * Aynı gök cismindeki tüm roket çiftleri arasında süpürmeli (swept) çarpışma kontrolü.
 * Yavaş temaslarda (<3.5 m/s) sadece elastik sekme uygular (kenetlenmeye izin verir);
 * hızlı çarpmalarda gerçekçi kütle oranlı şok ve parçalanma üretir.
 */
export function resolveVesselCollisions(
  gs: GameState,
  prevPos: Map<number, { x: number; y: number }>,
  clock: number,
  firing: Map<number, Map<number, number>>,
  fxOut: FxEventLike[] | undefined,
  events: GameEvent[],
) {
  const snapshot = [...gs.vessels]
  for (let i = 0; i < snapshot.length; i += 1) {
    const a = snapshot[i]!
    if (!gs.vessels.includes(a)) continue
    for (let j = i + 1; j < snapshot.length; j += 1) {
      const b = snapshot[j]!
      if (!gs.vessels.includes(b)) continue
      if (a.bodyId !== b.bodyId) continue
      if (a.debris && b.debris) continue
      if (a.cruise || b.cruise) continue
      if (a.landed && b.landed) continue
      // Kendi üssüne yanaşan gemi çarpışmaz (ikmal için içinden geçebilir).
      if ((a.outpost || b.outpost) && a.ownerId === b.ownerId) continue
      if ((a.spawnShieldUntil && clock < a.spawnShieldUntil) || (b.spawnShieldUntil && clock < b.spawnShieldUntil)) continue
      if (a.ownerId && a.ownerId === b.ownerId && (a.noCollideUntil ?? 0) > gs.time && (b.noCollideUntil ?? 0) > gs.time) {
        continue
      }

      const rA = vesselRadius(a)
      const rB = vesselRadius(b)
      const rSum = rA + rB
      const p0 = prevPos.get(a.id) ?? a.pos
      const q0 = prevPos.get(b.id) ?? b.pos
      const dp0x = p0.x - q0.x
      const dp0y = p0.y - q0.y
      const dp1x = a.pos.x - b.pos.x
      const dp1y = a.pos.y - b.pos.y
      const dx = dp1x - dp0x
      const dy = dp1y - dp0y
      const dd = dx * dx + dy * dy
      const t = dd > 1e-9 ? Math.max(0, Math.min(1, -(dp0x * dx + dp0y * dy) / dd)) : 0
      const cx = dp0x + dx * t
      const cy = dp0y + dy * t
      const dist = Math.hypot(cx, cy)
      if (dist > rSum) continue

      const rvx = a.vel.x - b.vel.x
      const rvy = a.vel.y - b.vel.y
      const vRel = Math.hypot(rvx, rvy)

      // Aynı oyuncunun rampadaki durağan veya birbirine kenetlenmeye çalışan çok yavaş araçlarını koru
      if (a.bodyId === 'earth' && (a.landed || b.landed) && vRel < 5 && len(a.pos) - BODIES.earth.radius < 120) {
        continue
      }

      let nx = dist > 1e-6 ? cx / dist : vRel > 1e-6 ? rvx / vRel : 1
      let ny = dist > 1e-6 ? cy / dist : vRel > 1e-6 ? rvy / vRel : 0
      const mA = Math.max(0.2, vesselStats(a.parts, a.cargo).mass)
      const mB = Math.max(0.2, vesselStats(b.parts, b.cargo).mass)
      // Uzay üsleri yerinden oynamaz: çarpan gemi tüm tepkiyi alır.
      const aFixed = a.landed || !!a.outpost
      const bFixed = b.landed || !!b.outpost
      const kA = b.outpost ? 1 : a.outpost ? 0 : mB / (mA + mB)
      const kB = a.outpost ? 1 : b.outpost ? 0 : mA / (mA + mB)

      // Çarpışma anındaki konuma al + ayır (yerdeki durağan aracı kaydırma)
      const overlap = Math.max(0.15, rSum - dist + 0.15)
      if (!aFixed) a.pos = { x: a.pos.x + nx * overlap * kA, y: a.pos.y + ny * overlap * kA }
      if (!bFixed) b.pos = { x: b.pos.x - nx * overlap * kB, y: b.pos.y - ny * overlap * kB }

      if (vRel < 3.5) {
        // Yavaş temas: kenetlenme için hasarsız yumuşak itme
        const vn = rvx * nx + rvy * ny
        if (vn < 0) {
          const jImp = -1.25 * vn
          if (!aFixed) a.vel = { x: a.vel.x + nx * jImp * kA, y: a.vel.y + ny * jImp * kA }
          if (!bFixed) b.vel = { x: b.vel.x - nx * jImp * kB, y: b.vel.y - ny * jImp * kB }
        }
        continue
      }

      // Yüksek hızlı çarpışma!
      const hitX = (a.pos.x + b.pos.x) / 2
      const hitY = (a.pos.y + b.pos.y) / 2
      spawnBoomFx(fxOut, events, a.bodyId, hitX, hitY, clock, Math.min(12, 4 + vRel * 0.05))

      const vn = rvx * nx + rvy * ny
      const jImp = Math.max(2, -1.35 * vn)
      if (!a.outpost) a.vel = { x: a.vel.x + nx * jImp * kA * 0.55, y: a.vel.y + ny * jImp * kA * 0.55 }
      if (!b.outpost) b.vel = { x: b.vel.x - nx * jImp * kB * 0.55, y: b.vel.y - ny * jImp * kB * 0.55 }

      const shockA = Math.max(vRel * (0.45 + 0.8 * kA), 6)
      const shockB = Math.max(vRel * (0.45 + 0.8 * kB), 6)
      const reasonA = `${b.name} ile çarpıştı (${vRel.toFixed(0)} m/s)`
      const reasonB = `${a.name} ile çarpıştı (${vRel.toFixed(0)} m/s)`

      if (!a.station) {
        const tolA = landingTolerance(vesselStats(a.parts))
        if (shockA >= tolA * 0.85 || a.debris || vRel >= 16) {
          shatterMidAir(gs, a, shockA, reasonA, b.ownerId, clock, firing, fxOut, events, hitX, hitY)
        }
      }
      if (!b.station) {
        const tolB = landingTolerance(vesselStats(b.parts))
        if (shockB >= tolB * 0.85 || b.debris || vRel >= 16) {
          shatterMidAir(gs, b, shockB, reasonB, a.ownerId, clock, firing, fxOut, events, hitX, hitY)
        }
      }
    }
  }
}

// ───────────────────────── Koloni yarışı: gezegen kontrolü ─────────────────────────

export function stepPlanetCaptures(gs: GameState, realDt: number, events: GameEvent[]) {
  const mp = gs.mp
  if (!mp || !mp.started) return
  if (isWarfareMode(gs)) {
    stepWarfareRules(gs, events)
    return
  }

  const counts: Record<string, number> = {}
  const qStore = (mp.quadrantCaptures ??= {})
  for (const bodyId of CONQUERABLE_BODIES) {
    const body = BODIES[bodyId]
    const qArr = (qStore[bodyId] ??= QUADRANTS.map((q) =>
      q === 0 && mp.captures[bodyId]
        ? { ...mp.captures[bodyId]!, flagAngle: mp.captures[bodyId]!.flagAngle }
        : {
            bodyId,
            ownerId: null,
            flagAngle: quadrantCenterAngle(q),
            progress: 0,
            capturerId: null,
            phase: 'idle' as const,
          },
    ))

    const bounty = 4000 + Math.round(body.incomeMult * 1800)
    const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))

    // Gemileri indikleri çeyreğe göre ayır (her çeyrek bağımsız ele geçirilir)
    const landedByQuad: [Map<string, Vessel[]>, Map<string, Vessel[]>, Map<string, Vessel[]>, Map<string, Vessel[]>] = [
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    ]
    for (const v of gs.vessels) {
      if (v.bodyId !== bodyId || !v.landed || v.debris || v.station || !v.ownerId) continue
      if (!vesselStats(v.parts).hasCommand) continue
      const q = quadrantOfAngle(Math.atan2(v.pos.y, v.pos.x))
      const map = landedByQuad[q]
      const arr = map.get(v.ownerId) ?? []
      arr.push(v)
      map.set(v.ownerId, arr)
    }

    const qOwners: Record<string, number> = {}
    for (const q of QUADRANTS) {
      const cap = (qArr[q] ??= {
        bodyId,
        ownerId: null,
        flagAngle: quadrantCenterAngle(q),
        progress: 0,
        capturerId: null,
        phase: 'idle',
      })
      const landedByOwner = landedByQuad[q]
      const activeOwners = [...landedByOwner.keys()]
      const base = getActorQuadrantBase(gs, bodyId, '', q)
      const colonized = isQuadrantColonized(base, flux)
      const hasStation = (base?.modules[COLONY_STATION_ID] ?? 0) > 0

      if (!cap.ownerId) {
        const hasAnyModule = !!(hasStation || base?.sites?.some(Boolean))
        const settler =
          base?.ownerId && hasAnyModule && mp.players[base.ownerId]
            ? base.ownerId
            : (activeOwners.length === 1 ? activeOwners[0]! : null)
        const rivalsAtSite = settler ? activeOwners.filter((id) => id !== settler) : activeOwners
        if (colonized && settler && rivalsAtSite.length === 0) {
          if (base) {
            base.ownerId = settler
            setActorQuadrantBase(gs, bodyId, settler, base, q)
          }
          cap.ownerId = settler
          cap.flagAngle = base?.siteAngle ?? (landedByOwner.get(settler)?.[0] ? Math.atan2(landedByOwner.get(settler)![0]!.pos.y, landedByOwner.get(settler)![0]!.pos.x) : quadrantCenterAngle(q))
          cap.progress = 1
          cap.capturerId = null
          cap.phase = 'captured'
          const payBounty = cap.lastRewardedId !== settler ? bounty : 0
          cap.lastRewardedId = settler
          const p = mp.players[settler]
          if (p) {
            p.captures += 1
            p.money += payBounty
            if (gs.ownerId === p.id) gs.money = p.money
          }
          const rewardTxt = payBounty > 0 ? ` (+${payBounty.toLocaleString('tr-TR')} ₡)` : ''
          const msg = `🛰️ ${p?.username ?? settler}, ${body.name} Q${q + 1} çeyreğine Uzay İstasyonu kurarak kolonileştirdi${rewardTxt}!`
          pushMpFeed(gs, msg, p?.color)
          events.push({ type: 'capture', bodyId, ownerId: settler, previousOwnerId: null, text: msg })
        } else if (activeOwners.length > 1) {
          cap.phase = 'contested'
          cap.capturerId = null
          cap.progress = 0
        } else if (activeOwners.length === 1) {
          const who = activeOwners[0]!
          cap.capturerId = who
          cap.phase = 'claiming'
          cap.progress = hasStation ? 0.65 : 0.25
        } else {
          cap.phase = 'idle'
          cap.progress = 0
          cap.capturerId = null
        }
      } else if (!hasStation) {
        cap.ownerId = null
        cap.phase = 'idle'
        cap.progress = 0
        cap.capturerId = null
      } else {
        const ownerShips = landedByOwner.get(cap.ownerId) ?? []
        const rivals = activeOwners.filter((id) => id !== cap.ownerId)

        if (ownerShips.length > 0) {
          if (rivals.length > 0) {
            cap.phase = 'contested'
          } else {
            cap.phase = 'captured'
            cap.progress = 1
            cap.capturerId = null
          }
        } else if (rivals.length === 1) {
          const challenger = rivals[0]!
          const prevOwner = cap.ownerId
          if (cap.capturerId !== challenger) {
            cap.capturerId = challenger
            cap.progress = 1
            cap.phase = 'neutralizing'
          }
          cap.phase = 'neutralizing'
          cap.progress = Math.max(0, cap.progress - realDt / CAPTURE_NEUTRALIZE_SEC)
          if (cap.progress <= 0) {
            if (base?.sites) {
              for (let i = 0; i < base.sites.length; i += 1) {
                if (base.sites[i] === COLONY_STATION_ID) base.sites[i] = null
              }
              syncModules(base)
              base.ownerId = challenger
            }
            const raidBounty = cap.lastRewardedId !== challenger ? Math.round(bounty * 0.4) : 0
            if (raidBounty > 0) cap.lastRewardedId = challenger
            cap.ownerId = null
            cap.capturerId = challenger
            cap.progress = 0.25
            cap.phase = 'claiming'
            const winner = mp.players[challenger]
            const loser = mp.players[prevOwner]
            if (winner) {
              winner.money += raidBounty
              if (gs.ownerId === winner.id) gs.money = winner.money
            }
            const rewardTxt = raidBounty > 0 ? ` (+${raidBounty.toLocaleString('tr-TR')} ₡)` : ''
            const msg = `💥 ${winner?.username ?? challenger}, ${loser?.username ?? prevOwner} oyuncusundan ${body.name} Q${q + 1} çeyreğini devraldı${rewardTxt}.`
            pushMpFeed(gs, msg, winner?.color)
            events.push({ type: 'capture', bodyId, ownerId: null, previousOwnerId: prevOwner, text: msg })
          }
        } else if (rivals.length > 1) {
          cap.phase = 'contested'
        } else {
          cap.phase = 'captured'
          cap.progress = 1
          cap.capturerId = null
        }
      }

      if (cap.ownerId) qOwners[cap.ownerId] = (qOwners[cap.ownerId] ?? 0) + 1
    }

    // Gezegen özeti (`mp.captures[bodyId]`): en çok çeyreğe sahip olan oyuncu gezegeni yönetir
    const sorted = Object.entries(qOwners).sort((a, b) => b[1] - a[1])
    const q0 = qArr[0]!
    let summaryOwner: string | null = null
    if (sorted.length === 1) {
      summaryOwner = sorted[0]![0]
    } else if (sorted.length > 1) {
      summaryOwner = sorted[0]![1] > sorted[1]![1] ? sorted[0]![0] : q0.ownerId && qOwners[q0.ownerId] === sorted[0]![1] ? q0.ownerId : null
    }
    const summaryCap = (mp.captures[bodyId] ??= {
      bodyId,
      ownerId: null,
      flagAngle: Math.PI / 2,
      progress: 0,
      capturerId: null,
      phase: 'idle',
    })
    summaryCap.ownerId = summaryOwner
    summaryCap.flagAngle = q0.flagAngle
    summaryCap.progress = q0.progress
    summaryCap.capturerId = q0.capturerId
    summaryCap.phase = sorted.length > 1 && !summaryOwner ? 'contested' : q0.ownerId || !summaryOwner ? q0.phase : 'captured'
    if (summaryOwner) counts[summaryOwner] = (counts[summaryOwner] ?? 0) + 1
  }

  for (const p of Object.values(mp.players)) {
    p.planetsHeld = counts[p.id] ?? 0
    if (mp.config.targetPlanets > 0 && p.planetsHeld >= mp.config.targetPlanets && !mp.winnerId) {
      mp.winnerId = p.id
      const msg = `🏆 ${p.username}, ${p.planetsHeld} gezegeni ele geçirerek oyunu kazandı!`
      pushMpFeed(gs, msg, p.color)
      events.push({ type: 'victory', winnerId: p.id, winnerName: p.username })
    }
  }
}

// ───────────────────────── Akıllı Dinamik Zaman Hızlandırma ─────────────────────────

function chooseCoastIdx(waitSec: number, maxCap = 9): number {
  let idx = 0
  for (let i = 0; i < WARPS.length; i += 1) if (WARPS[i]! <= waitSec / 3) idx = i
  return Math.min(maxCap, idx)
}

function closestApproach(a: Vessel, b: Vessel, maxLookSec = 25): { dist: number; tca: number; minAtTca: number } {
  const dpX = a.pos.x - b.pos.x
  const dpY = a.pos.y - b.pos.y
  const dist = Math.hypot(dpX, dpY)
  const dvX = a.vel.x - b.vel.x
  const dvY = a.vel.y - b.vel.y
  const vv = dvX * dvX + dvY * dvY
  const tca = vv > 1e-6 ? Math.max(0, Math.min(maxLookSec, -(dpX * dvX + dpY * dvY) / vv)) : 0
  const minAtTca = Math.hypot(dpX + dvX * tca, dpY + dvY * tca)
  return { dist, tca, minAtTca }
}

/** İniş sırasında irtifa ve çarpma süresine göre güvenli zaman çarpanı tavanını döndürür. */
export function landingWarpCap(v: Vessel, st = vesselStats(v.parts, v.cargo)): { maxIdx: number; autoIdx: number } {
  const s = situation(v, st)
  const tGround = s.vr < -1 ? s.alt / -s.vr : Infinity
  if (s.alt < 100 || tGround < 3.2) return { maxIdx: 0, autoIdx: 0 }
  // Dünya dışındaki gök cisimlerinde 1000 m altında hız 1×'e kilitlenir.
  if (v.bodyId !== 'earth' && s.alt < 1000) return { maxIdx: 0, autoIdx: 0 }
  if (s.alt < 350 || tGround < 7.5) return { maxIdx: 2, autoIdx: 2 }
  if (s.alt < 1500 || tGround < 15) return { maxIdx: 3, autoIdx: 3 }
  if (s.alt < 5000 || tGround < 40) return { maxIdx: PHYSICS_WARP_MAX_IDX, autoIdx: PHYSICS_WARP_MAX_IDX }
  // Yüksekten alçalış: fizik alt adımları doğruluğu korur, zaman daha hızlı akabilir.
  if (s.alt < 20_000 || tGround < 90) return { maxIdx: PHYSICS_WARP_MAX_IDX + 1, autoIdx: PHYSICS_WARP_MAX_IDX + 1 }
  return { maxIdx: PHYSICS_WARP_MAX_IDX + 2, autoIdx: PHYSICS_WARP_MAX_IDX + 2 }
}

/**
 * Tüm oyuncuların anlık uçuş durumunu analiz ederek evrensel zaman hızını dinamik seçer:
 * - İki roket 3 km içine girince (veya 15 sn içinde çarpışma rotasında) ANINDA 1×'e düşer.
 * - Manuel iniş / yoğun atmosfer / manuel yakışta 1×–4× sınırlar.
 * - Herkes güvenli yörüngedeyken veya süzülme otopilotundayken yumuşak biçimde hızlanır.
 * - Yavaşlatma anlık (0 ms), hızlandırma yumuşak kademeli yapılır.
 */
export function computeDynamicWarp(
  gs: GameState,
  curWarpIdx: number,
  rampTimer: number,
  realDt: number,
  realClock: number,
  controlsByPlayer: Map<string, Controls>,
  autopilotWantedByVessel: Map<number, number>,
): { warpIdx: number; rampTimer: number; info: DynamicWarpInfo } {
  const mp = gs.mp
  const maxIdx = WARPS.length - 1
  if (!mp) {
    return {
      warpIdx: curWarpIdx,
      rampTimer: 0,
      info: { warpIdx: curWarpIdx, warp: WARPS[curWarpIdx]!, mode: 'manual', reason: '' },
    }
  }

  let hardCap = maxIdx
  let capMode: DynamicWarpInfo['mode'] = 'auto'
  let capReason = ''
  let throttledBy: string | undefined
  let nearestInterceptM: number | null = null
  let maxAutoCoastWish = 0
  const manualDesires: { who: string; idx: number; active: boolean }[] = []

  const tighten = (limit: number, mode: DynamicWarpInfo['mode'], reason: string, by?: string) => {
    if (limit < hardCap) {
      hardCap = limit
      capMode = mode
      capReason = reason
      throttledBy = by
    }
  }

  // Aktif mermiler veya ateş eden gemi varsa çatışma hızı 1×'e iner (it dalaşında zaman kaçmasın)
  if (isWarfareMode(gs) && (mp.projectiles?.length ?? 0) > 0) {
    tighten(0, 'combat', '⚔️ Çatışma — 1×')
  }

  for (const p of Object.values(mp.players)) {
    if (p.warpAnchor) {
      tighten(0, 'anchor', `${p.username}: 1× sabitledi`, p.username)
    }

    const v = p.activeVesselId ? gs.vessels.find((o) => o.id === p.activeVesselId) ?? null : null
    if (!v || v.debris) {
      continue
    }

    const body = BODIES[v.bodyId]
    const st = vesselStats(v.parts, v.cargo)
    const s = situation(v, st)
    const ap = effectiveAutopilot(v)
    const c = controlsByPlayer.get(p.id) ?? null
    const usingControls = !!(c && (c.rotate !== 0 || c.tx !== 0 || c.ty !== 0 || c.fire))
    const recentManual = usingControls || (p.lastManualAt !== undefined && realClock - p.lastManualAt < 2.2)

    if (c?.fire) {
      tighten(0, 'combat', `${p.username}: silah ateşi — 1×`, p.username)
    }

    // 1) Roket-roket yakın temas / çarpışma algılama (yerdeki rampalı araçlar veya hızlı kalkış hariç)
    const lookAheadSec = Math.max(22, Math.min(300, (WARPS[curWarpIdx] ?? 1) * 0.35))
    for (const o of gs.vessels) {
      if (o.id === v.id || o.bodyId !== v.bodyId || o.debris) continue
      if (aLandedSkip(v, o)) continue
      if (o.landed && v.bodyId === 'earth' && (ap === 'transfer' && !c?.fire)) continue
      if ((o.spawnShieldUntil && realClock < o.spawnShieldUntil) && o.landed) continue
      const ca = closestApproach(v, o, lookAheadSec)
      if (nearestInterceptM === null || ca.dist < nearestInterceptM) nearestInterceptM = ca.dist
      if (ca.dist < 3000 || (ca.tca > 0 && ca.tca < Math.min(lookAheadSec, Math.max(15, (WARPS[curWarpIdx] ?? 1) * 0.2)) && ca.minAtTca < 2500)) {
        const capTo = ca.dist < 3000 ? 0 : 1
        tighten(capTo, 'combat', `🛰️ Yakın geçiş (${Math.round(ca.dist)} m) — ${WARPS[capTo]}×`, p.username)
      } else if (ca.dist < 12000 && ca.minAtTca < 4000) {
        tighten(1, 'combat', `🛰️ Yakın geçiş (${(ca.dist / 1000).toFixed(1)} km)`, p.username)
      }
    }

    if (v.landed && (v.throttle > 0.01 || usingControls || recentManual)) {
      tighten(0, 'burn', `${p.username}: kalkış hazırlığı`, p.username)
    }
    if (!v.landed) {
      if (v.cruise) {
        maxAutoCoastWish = Math.max(maxAutoCoastWish, 1)
      } else if (body.landable && ap === 'land') {
        const cap = landingWarpCap(v, st)
        cap.maxIdx = Math.min(cap.maxIdx, PHYSICS_WARP_MAX_IDX)
        tighten(
          cap.maxIdx,
          'landing',
          cap.maxIdx === 0 ? `${p.username}: ${body.name} oto-iniş yaklaşımı` : `${p.username}: ${body.name} oto-iniş (${WARPS[cap.maxIdx]}×)`,
          p.username,
        )
        maxAutoCoastWish = Math.max(maxAutoCoastWish, cap.autoIdx)
      } else if (ap === 'transfer') {
        // Hedefe Git tırmanışı: yakıt varken/tırmanırken atmosferi hızla aşmak için 4× hıza izin ver
        const climbCap = s.alt < 1200 ? 1 : 2
        tighten(climbCap, 'burn', `${p.username}: ${body.name} transfer tırmanışı`, p.username)
        if (s.alt >= 800 && (v.throttle > 0.05 || s.vr >= -2)) maxAutoCoastWish = Math.max(maxAutoCoastWish, 2)
      } else {
        if (v.throttle > 0.01 || usingControls) {
          tighten(s.alt < 12_000 ? 0 : 2, 'burn', `${p.username}: motor yanışı`, p.username)
        }
        // 2) Manuel iniş / yüzeye tehlikeli yaklaşma
        if (body.landable && s.alt < 3000 && s.vr < -1 && ap === 'off') {
          tighten(s.alt < 1200 ? 0 : 1, 'landing', `${p.username}: ${body.name} manuel inişi`, p.username)
        } else if (body.landable && s.alt < 1200) {
          tighten(1, 'landing', `${p.username}: ${body.name} yüzey yaklaşımı`, p.username)
        } else if (body.atmoHeight > 0 && s.altSea < body.atmoHeight) {
          tighten(recentManual || v.throttle > 0 ? 1 : 2, 'burn', `${p.username}: ${body.name} atmosferi`, p.username)
        } else if (recentManual || (v.throttle > 0 && ap === 'off')) {
          tighten(2, 'burn', `${p.username}: manuel uçuş`, p.username)
        } else if (ap === 'orbit') {
          const autoWish = autopilotWantedByVessel.get(v.id)
          if (v.throttle > 0) {
            tighten(2, 'burn', `${p.username}: otopilot yanışı`, p.username)
          } else if (needsPhysics(v, null)) {
            const el = elementsFromState(v.pos, v.vel, body.mu)
            const wait = orbitCoastWait(v, body, s)
            if (wait !== null && wait > 20) {
              maxAutoCoastWish = Math.max(maxAutoCoastWish, chooseCoastIdx(wait, 4))
            } else {
              const toAp = s.vr > 2 && el.e < 1 ? (el.ra - s.r) / s.vr : 0
              if (toAp > 45) maxAutoCoastWish = Math.max(maxAutoCoastWish, 4)
              else tighten(2, 'burn', `${p.username}: manevra hazırlığı`, p.username)
            }
          } else if (autoWish !== undefined && autoWish > 0) {
            maxAutoCoastWish = Math.max(maxAutoCoastWish, autoWish)
          }
        }
      }
    }

    if (p.wantsWarpIdx >= 0) {
      manualDesires.push({ who: p.username, idx: p.wantsWarpIdx, active: !v.landed && !v.cruise && ap === 'off' && v.throttle > 0 })
    }
  }

  let targetIdx = 0
  if (manualDesires.length > 0) {
    // Manuel tercih veren oyunculardan en temkinlisi belirler; Auto oyuncular güvenli ise engellemez.
    targetIdx = Math.min(...manualDesires.map((m) => m.idx))
    if (maxAutoCoastWish > targetIdx && manualDesires.every((m) => !m.active && m.idx > 0)) {
      targetIdx = Math.max(targetIdx, maxAutoCoastWish)
    }
    if (targetIdx > 0 && capMode === 'auto') {
      const limiter = manualDesires.find((m) => m.idx === targetIdx) ?? manualDesires[0]!
      capMode = 'manual'
      capReason = `${limiter.who}: ${WARPS[Math.min(hardCap, targetIdx)]!.toLocaleString('tr-TR')}× seçildi`
    }
  } else {
    targetIdx = mp.config.allowAutoWarp ? maxAutoCoastWish : 0
    if (targetIdx > 0 && capMode === 'auto') {
      capReason = 'Otopilot transfer süzülmesi — otomatik hızlanma'
    }
  }

  const desiredIdx = Math.max(0, Math.min(hardCap, targetIdx))
  let nextIdx = curWarpIdx
  let nextTimer = rampTimer

  if (desiredIdx < curWarpIdx) {
    // Tehlike/manevra anında anında yavaşla!
    nextIdx = desiredIdx
    nextTimer = 0
  } else if (desiredIdx > curWarpIdx) {
    nextTimer += realDt
    if (nextTimer >= 0.32) {
      nextIdx = Math.min(desiredIdx, curWarpIdx + 1)
      nextTimer = 0
    }
  } else {
    nextTimer = 0
  }

  if (!capReason) {
    capReason = nextIdx === 0 ? 'Akıllı zaman: normal akış (1×)' : `Akıllı zaman: ${WARPS[nextIdx]!.toLocaleString('tr-TR')}×`
  }

  const info: DynamicWarpInfo = {
    warpIdx: nextIdx,
    warp: WARPS[nextIdx]!,
    mode: capMode,
    reason: capReason,
    throttledBy,
    nearestInterceptM: nearestInterceptM !== null ? Math.round(nearestInterceptM) : null,
  }
  mp.warpInfo = info
  return { warpIdx: nextIdx, rampTimer: nextTimer, info }
}

function aLandedSkip(a: Vessel, b: Vessel) {
  return a.landed && b.landed
}
