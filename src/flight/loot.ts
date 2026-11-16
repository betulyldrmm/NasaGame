/**
 * Yağma modu (çevrim içi PvP + ganimet): saf oyun kuralları.
 *  - Her oyuncunun uzayda bir üssü vardır; gemiler üsten doğar, üste ikmal alır.
 *  - Kaynak sahaları zamanla ganimet sandığı üretir: gidip kargoya al, üssüne dönüp teslim et.
 *  - Vurulan gemi kargosunu saçar; çekirdeği yok edilen üs kasasının bir kısmını bırakır.
 *  - Uçuş arcade'dir: yerçekimi yok, uzay sürtünmesi var (bkz. `arcade` — game/vessel.ts).
 */
import { OUTPOST_MAX_LEVEL, OUTPOST_UPGRADE_COST, outpostDesign, partDef, partMaxHp } from '../game/data'
import type { GameEvent, GameState, LootState, MultiplayerPlayer, Vessel } from '../game/types'
import { cargoMass, freshParts, partAlive, vesselStats } from '../game/vessel'
import { BODIES } from '../nasa/bodies'
import { dropLoot, isLootMode, LOOT_VALUE_PER_TON, pushFeed } from './combat'
import type { Controls } from './physics'
import type { Fx } from './world'

type Vec = { x: number; y: number }

/** Arena ölçüleri (m). Üsler halkaya dizilir, kaynak sahaları ortadadır. */
export const ARENA_ALT = 500_000
export const ARENA_RADIUS = 8_500
export const OUTPOST_RING = 6_000
export const PICKUP_RANGE = 55
export const SERVICE_RANGE = 320
export const TURRET_RANGE = 1_250
export const OUTPOST_REBUILD_SEC = 45
/** Çekirdeği yok edilen üsten saçılan kasa oranı. */
export const BREACH_LOOT_SHARE = 0.3
export const LOOT_START_MONEY = 40_000
const WRECK_CRATE_TTL = 240
/** 16 yuva: ilk gelen oyuncular halkada birbirinden en uzak noktalara yerleşir. */
const SLOT_ORDER = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]

export function arenaCenter(): Vec {
  return { x: 0, y: BODIES.earth.radius + ARENA_ALT }
}

export function outpostPos(slot: number): Vec {
  const c = arenaCenter()
  const a = Math.PI / 2 + (SLOT_ORDER[((slot % 16) + 16) % 16]! / 16) * Math.PI * 2
  return { x: c.x + Math.cos(a) * OUTPOST_RING, y: c.y + Math.sin(a) * OUTPOST_RING }
}

export function newLootState(): LootState {
  const c = arenaCenter()
  const mid = (k: number): Vec => {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    return { x: c.x + Math.cos(a) * 3000, y: c.y + Math.sin(a) * 3000 }
  }
  return {
    center: c,
    radius: ARENA_RADIUS,
    sites: [
      { pos: { ...c }, name: 'Çekirdek Enkazı', rate: 0.06, max: 9, acc: 2 },
      { pos: mid(0), name: 'Kuzey Hurdalığı', rate: 0.028, max: 5, acc: 1.2 },
      { pos: mid(1), name: 'Batı Hurdalığı', rate: 0.028, max: 5, acc: 1.2 },
      { pos: mid(2), name: 'Güney Hurdalığı', rate: 0.028, max: 5, acc: 1.2 },
      { pos: mid(3), name: 'Doğu Hurdalığı', rate: 0.028, max: 5, acc: 1.2 },
    ],
    crates: [],
    nextCrateId: 1,
  }
}

export function findOutpost(gs: GameState, ownerId: string): Vessel | undefined {
  return gs.vessels.find((v) => v.outpost && v.ownerId === ownerId)
}

/** Oyuncunun kontrol edebildiği (enkaz/üs olmayan, komutası sağlam) gemisi. */
export function findLootShip(gs: GameState, ownerId: string): Vessel | undefined {
  return gs.vessels.find((v) => v.ownerId === ownerId && !v.outpost && !v.debris && vesselStats(v.parts).hasCommand)
}

function spawnOutpost(gs: GameState, p: MultiplayerPlayer): Vessel {
  const level = Math.max(1, Math.min(OUTPOST_MAX_LEVEL, p.outpostLevel ?? 1))
  p.outpostLevel = level
  const parts = freshParts(outpostDesign(level))
  const st = vesselStats(parts)
  const pos = outpostPos(p.slot)
  const c = arenaCenter()
  const id = gs.nextId
  gs.nextId += 1
  const v: Vessel = {
    id,
    name: `${p.username} Üssü`,
    ownerId: p.id,
    parts,
    bodyId: 'earth',
    pos,
    vel: { x: 0, y: 0 },
    // Zırhlı sırt dışarıya, taretler ve rıhtım arena merkezine bakar.
    angle: Math.atan2(pos.y - c.y, pos.x - c.x),
    angVel: 0,
    landed: false,
    throttle: 0,
    ec: st.ecCap,
    cargo: { modules: {}, ore: 0, oreFrom: null },
    rcsOn: false,
    sas: 'off',
    visited: [],
    assist: null,
    dvUsed: 0,
    outpost: { level },
    ...(st.shieldCap > 0 ? { shield: st.shieldCap } : {}),
  }
  gs.vessels.push(v)
  return v
}

/** Maç başında ve yeni oyuncu katıldığında: arena durumunu ve eksik üsleri kurar. */
export function ensureLootSetup(gs: GameState, clock = 0) {
  const mp = gs.mp
  if (!mp || !isLootMode(gs)) return
  mp.loot ??= newLootState()
  for (const p of Object.values(mp.players)) {
    if (findOutpost(gs, p.id)) continue
    const at = mp.loot.rebuild?.[p.id]
    if (at !== undefined) {
      if (clock < at) continue
      delete mp.loot.rebuild![p.id]
      pushFeed(gs, `🛠️ ${p.username} üssünü yeniden kurdu.`, p.color)
    }
    spawnOutpost(gs, p)
  }
}

/** Yeni geminin doğacağı nokta: üssün arena merkezine bakan rıhtımının önü. */
export function lootSpawn(gs: GameState, ownerId: string): { pos: Vec; angle: number } {
  const p = gs.mp?.players[ownerId]
  const base = outpostPos(p?.slot ?? 0)
  const c = arenaCenter()
  const d = Math.hypot(c.x - base.x, c.y - base.y) || 1
  const dir = { x: (c.x - base.x) / d, y: (c.y - base.y) / d }
  return { pos: { x: base.x + dir.x * 150, y: base.y + dir.y * 150 }, angle: Math.atan2(dir.y, dir.x) }
}

/** Üste bekleyen eski gemi yeni gemi alınırken hurdaya verilir: sağlam parçaların %80'i iade. */
export function tradeInValue(v: Vessel): number {
  return Math.round(v.parts.reduce((s, p) => s + (partAlive(p) ? partDef(p.def).cost : 0), 0) * 0.8)
}

export function nearOwnOutpost(gs: GameState, v: Vessel, range = SERVICE_RANGE): boolean {
  if (!v.ownerId) return false
  const base = findOutpost(gs, v.ownerId)
  return !!base && Math.hypot(base.pos.x - v.pos.x, base.pos.y - v.pos.y) <= range
}

export function upgradeOutpost(gs: GameState, actorId: string): string | null {
  const mp = gs.mp
  const p = mp?.players[actorId]
  if (!mp || !p || !isLootMode(gs)) return 'Üs yalnızca Yağma modunda geliştirilir.'
  const base = findOutpost(gs, actorId)
  if (!base) return 'Üssün yeniden kurulana kadar geliştirilemez.'
  const level = p.outpostLevel ?? 1
  if (level >= OUTPOST_MAX_LEVEL) return 'Üs zaten en yüksek seviyede.'
  const cost = OUTPOST_UPGRADE_COST[level]!
  if (p.money < cost) return `Bütçe yetersiz: ${cost.toLocaleString('tr-TR')} ₡ gerekli.`
  p.money -= cost
  if (gs.ownerId === p.id) gs.money = p.money
  p.outpostLevel = level + 1
  // Eski parçaların hasarı korunur; yeni seviye parçaları sağlam eklenir.
  const old = new Map(base.parts.map((q) => [`${q.def}@${q.x},${q.y}`, q]))
  base.parts = freshParts(outpostDesign(level + 1)).map((q) => {
    const prev = old.get(`${q.def}@${q.x},${q.y}`)
    return prev ? { ...q, hp: prev.hp } : q
  })
  base.outpost = { level: level + 1 }
  const st = vesselStats(base.parts)
  base.ec = st.ecCap
  if (st.shieldCap > 0) base.shield = st.shieldCap
  pushFeed(gs, `🏗️ ${p.username} üssünü Seviye ${level + 1}'e yükseltti.`, p.color)
  return null
}

/** Kargodaki ganimeti uzaya bırakır (kaçarken hafiflemek ya da takım arkadaşına vermek için). */
export function jettisonCargo(gs: GameState, v: Vessel, clock: number): string | null {
  if (!isLootMode(gs)) return 'Kargo yalnızca Yağma modunda bırakılır.'
  if (v.cargo.ore <= 0.01) return 'Kargoda ganimet yok.'
  const back = { x: v.pos.x - Math.cos(v.angle) * 70, y: v.pos.y - Math.sin(v.angle) * 70 }
  dropLoot(gs, back, v.vel, v.cargo.ore, clock)
  v.cargo.ore = 0
  v.cargo.oreFrom = null
  return null
}

/** Üs taretlerinin kendiliğinden nişan alıp ateş etmesi için sanal kontrol girdisi. */
export function outpostControls(gs: GameState, base: Vessel, clock: number): Controls | null {
  if (!base.outpost) return null
  let target: Vessel | null = null
  let best = TURRET_RANGE
  for (const o of gs.vessels) {
    if (o.outpost || o.debris || o.bodyId !== base.bodyId || !o.ownerId || o.ownerId === base.ownerId) continue
    if (o.spawnShieldUntil && clock < o.spawnShieldUntil) continue
    const d = Math.hypot(o.pos.x - base.pos.x, o.pos.y - base.pos.y)
    if (d < best) {
      best = d
      target = o
    }
  }
  if (!target) return null
  // Hedefin hızına göre önleme: mermi hızı ~850 m/s.
  const lead = best / 850
  const ax = target.pos.x + target.vel.x * lead - base.pos.x
  const ay = target.pos.y + target.vel.y * lead - base.pos.y
  return { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'base-turret', aimAngle: Math.atan2(ay, ax), aimDist: Math.hypot(ax, ay) }
}

function breachOutpost(gs: GameState, base: Vessel, clock: number, fxOut: Fx[] | undefined, events: GameEvent[]) {
  const mp = gs.mp!
  const loot = mp.loot!
  const owner = base.ownerId ? mp.players[base.ownerId] : undefined
  const atk = base.lastAttackerId ? mp.players[base.lastAttackerId] : undefined
  let tons = 0
  if (owner) {
    const stolen = Math.floor(owner.money * BREACH_LOOT_SHARE)
    owner.money -= stolen
    if (gs.ownerId === owner.id) gs.money = owner.money
    tons = stolen / LOOT_VALUE_PER_TON
    ;(loot.rebuild ??= {})[owner.id] = clock + OUTPOST_REBUILD_SEC
  }
  dropLoot(gs, base.pos, { x: 0, y: 0 }, tons, clock)
  if (atk) {
    atk.coloniesDestroyed = (atk.coloniesDestroyed ?? 0) + 1
    atk.score = (atk.score ?? 0) + 5
  }
  const text = `🏴‍☠️ ${atk?.username ?? 'Bir oyuncu'}, ${owner?.username ?? '?'} üssünü yağmaladı: ${tons.toFixed(1)} t ganimet uzaya saçıldı!`
  pushFeed(gs, text, atk?.color)
  if (owner && atk) events.push({ type: 'colonyDestroyed', bodyId: 'earth', victimId: owner.id, attackerId: atk.id, text })
  fxOut?.push({ kind: 'boom', bodyId: base.bodyId, x: base.pos.x, y: base.pos.y, born: clock, size: 14 })
  events.push({ type: 'explosion', size: 14, bodyId: base.bodyId, x: base.pos.x, y: base.pos.y })
  gs.vessels = gs.vessels.filter((o) => o !== base)
}

/** İkmal: yakıt, onarım (devre dışı parçalar dahil), cephane ve elektrik. */
function serviceShip(v: Vessel, real: number, tickSecond: boolean) {
  let fuelLeft = 1.5 * real
  for (const p of v.parts) {
    const d = partDef(p.def)
    const max = partMaxHp(p.def)
    if (p.hp !== undefined && p.hp < max) p.hp = Math.min(max, Math.max(p.hp, -max * 0.5) + 45 * real)
    if (d.kind === 'tank' && partAlive(p) && fuelLeft > 0) {
      const add = Math.min(fuelLeft, (d.fuel ?? 0) - (p.fuel ?? 0))
      if (add > 0) {
        p.fuel = (p.fuel ?? 0) + add
        fuelLeft -= add
      }
    }
    if (tickSecond && d.weapon?.ammo !== undefined && partAlive(p)) {
      p.ammo = Math.min(d.weapon.ammo, (p.ammo ?? 0) + Math.ceil(d.weapon.ammo * 0.2))
    }
  }
  const st = vesselStats(v.parts, v.cargo)
  v.ec = Math.min(st.ecCap, v.ec + 60 * real)
  v.burnUntil = undefined
}

/** Yağma modunun kare başına kuralları. Değişiklik olduysa `true` döner. */
export function stepLoot(gs: GameState, real: number, clock: number, fxOut: Fx[] | undefined, events: GameEvent[]) {
  const mp = gs.mp
  if (!mp || !isLootMode(gs) || !mp.started) return
  ensureLootSetup(gs, clock)
  const loot = mp.loot!
  const tickSecond = Math.floor(clock) !== Math.floor(clock - real)

  // 1) Kaynak sahaları sandık üretir.
  loot.sites.forEach((site, idx) => {
    site.acc = Math.min(site.acc + site.rate * real, 3)
    const count = loot.crates.reduce((n, c) => n + (c.site === idx ? 1 : 0), 0)
    const size = 0.6 + ((loot.nextCrateId * 37) % 11) / 10
    if (count < site.max && site.acc >= size) {
      site.acc -= size
      const a = Math.random() * Math.PI * 2
      const r = 60 + Math.random() * (idx === 0 ? 420 : 300)
      dropLoot(gs, { x: site.pos.x + Math.cos(a) * r, y: site.pos.y + Math.sin(a) * r }, { x: 0, y: 0 }, size, clock, idx)
    }
  })

  // 2) Sandıklar süzülür; enkaz sandıkları bir süre sonra kaybolur.
  const damp = Math.exp(-0.6 * real)
  for (const c of loot.crates) {
    c.pos.x += c.vel.x * real
    c.pos.y += c.vel.y * real
    c.vel.x *= damp
    c.vel.y *= damp
  }
  loot.crates = loot.crates.filter((c) => c.tons > 0.005 && (c.site >= 0 || clock - c.born < WRECK_CRATE_TTL))

  // 3) Üsler: enerji, yavaş onarım, çekirdek düşerse yağma.
  for (const base of gs.vessels.filter((v) => v.outpost)) {
    const core = base.parts.find((p) => p.def === 'base-core')
    if (!core || !partAlive(core)) {
      breachOutpost(gs, base, clock, fxOut, events)
      continue
    }
    base.vel = { x: 0, y: 0 }
    base.angVel = 0
    base.ec = vesselStats(base.parts).ecCap
    for (const p of base.parts) {
      const max = partMaxHp(p.def)
      if (p.hp !== undefined && p.hp > 0 && p.hp < max) p.hp = Math.min(max, p.hp + 4 * real)
    }
  }

  // 4) Gemiler: arena sınırı, sandık toplama, üste teslim ve ikmal.
  for (const v of gs.vessels) {
    if (v.outpost || !v.ownerId) continue
    const dx = v.pos.x - loot.center.x
    const dy = v.pos.y - loot.center.y
    const dist = Math.hypot(dx, dy)
    if (dist > loot.radius && v.bodyId === 'earth') {
      // Görünmez duvar: dışarı çıkan her şey merkeze doğru itilir.
      const push = Math.min(60, 12 + (dist - loot.radius) * 0.08) * real
      v.vel = { x: v.vel.x - (dx / dist) * push, y: v.vel.y - (dy / dist) * push }
    }
    if (v.debris) continue
    const st = vesselStats(v.parts, v.cargo)
    if (!st.hasCommand) continue
    const player = mp.players[v.ownerId]
    if (!player) continue

    let free = st.cargoCap - cargoMass(v.cargo)
    if (free > 0.01) {
      const reach = PICKUP_RANGE + Math.max(st.maxX - st.minX, st.maxY - st.minY) * 0.5
      let got = 0
      for (const c of loot.crates) {
        if (free <= 0.01) break
        if (Math.hypot(c.pos.x - v.pos.x, c.pos.y - v.pos.y) > reach) continue
        const take = Math.min(free, c.tons)
        c.tons -= take
        free -= take
        got += take
      }
      if (got > 0) {
        v.cargo.ore += got
        v.cargo.oreFrom = 'earth'
        events.push({ type: 'toast', ownerId: v.ownerId, text: `📦 +${got.toFixed(1)} t ganimet (${cargoMass(v.cargo).toFixed(1)}/${st.cargoCap} t) — üssüne götür!` })
      }
    }

    if (nearOwnOutpost(gs, v)) {
      if (v.cargo.ore > 0.01) {
        const tons = v.cargo.ore
        const pay = Math.round(tons * LOOT_VALUE_PER_TON)
        v.cargo.ore = 0
        v.cargo.oreFrom = null
        player.money += pay
        player.looted = (player.looted ?? 0) + tons
        if (gs.ownerId === player.id) gs.money = player.money
        events.push({ type: 'toast', ownerId: v.ownerId, text: `💰 ${tons.toFixed(1)} t ganimet teslim edildi: +${pay.toLocaleString('tr-TR')} ₡` })
        pushFeed(gs, `💰 ${player.username} üssüne ${tons.toFixed(1)} t ganimet taşıdı.`, player.color)
      }
      serviceShip(v, real, tickSecond)
    }
  }
  loot.crates = loot.crates.filter((c) => c.tons > 0.005)

  // 5) Zafer: hedef ganimete ilk ulaşan kazanır.
  const goal = mp.config.lootGoal ?? 60
  if (goal > 0 && !mp.winnerId) {
    const winner = Object.values(mp.players).find((p) => (p.looted ?? 0) >= goal)
    if (winner) {
      mp.winnerId = winner.id
      pushFeed(gs, `🏆 ${winner.username}, ${goal} t ganimeti üssüne taşıyarak kazandı!`, winner.color)
      events.push({ type: 'victory', winnerId: winner.id, winnerName: winner.username })
    }
  }
}
