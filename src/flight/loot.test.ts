import { describe, expect, it } from 'vitest'
import { LOOT_PRESETS, OUTPOST_UPGRADE_COST, PARTS, outpostDesign, partDef, partMaxHp } from '../game/data'
import type { GameEvent, PartInst, Vessel } from '../game/types'
import { arcade, freshParts, isConnected, partAlive, runEngines, vesselStats } from '../game/vessel'
import { applyVesselDamage, BREAKOFF_RATIO, dropLoot, isLootMode, isWarfareMode, LOOT_VALUE_PER_TON } from './combat'
import { ARENA_RADIUS, arenaCenter, findLootShip, findOutpost, outpostPos, TURRET_RANGE } from './loot'
import { buildCompactSnapshot, hydrateCompactSnapshot } from './mpClient'
import { newMultiplayerGame } from './multiplayerSim'
import { dispatchCommand, stepWorld, validateDesign, type Sim } from './world'

function makeLootSim(lootGoal = 60, money = 100_000): Sim {
  const gs = newMultiplayerGame(
    'LOOT1',
    'p1',
    [
      { id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 },
      { id: 'p2', username: 'Vega', color: '#ff8a3d', slot: 1 },
    ],
    { mode: 'loot-raid', lootGoal, startingMoney: money },
  )
  return { gs, warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
}

function launch(sim: Sim, pid: string, preset = 0): Vessel {
  const res = dispatchCommand(sim, { type: 'launch', design: LOOT_PRESETS[preset]!.design.map((p) => ({ ...p })), designCargo: {} }, pid)
  expect(res.error).toBeUndefined()
  return findLootShip(sim.gs, pid)!
}

const dmgOpts = (sim: Sim, events: GameEvent[], attackerId = 'p1') => ({ attackerId, clock: sim.clock ?? 0, firing: sim.firing, fxOut: sim.fx, events })

function shipOf(design: PartInst[]): Vessel {
  const parts = freshParts(design)
  return {
    id: 99, name: 'T', ownerId: 'p2', parts, bodyId: 'earth', pos: { x: 0, y: 7e5 }, vel: { x: 0, y: 0 }, angle: Math.PI / 2, angVel: 0,
    landed: false, throttle: 0, ec: 100, cargo: { modules: {}, ore: 0, oreFrom: null }, rcsOn: false, sas: 'off', visited: [], assist: null, dvUsed: 0,
  }
}

describe('Yağma modu: kurulum, arcade uçuş ve ganimet döngüsü', () => {
  it('her oyuncuya uzay üssü kurar; mod hem muharebe hem yağma modudur', () => {
    const sim = makeLootSim()
    expect(isLootMode(sim.gs)).toBe(true)
    expect(isWarfareMode(sim.gs)).toBe(true)
    const b1 = findOutpost(sim.gs, 'p1')!
    const b2 = findOutpost(sim.gs, 'p2')!
    expect(b1.outpost?.level).toBe(1)
    expect(Math.hypot(b1.pos.x - b2.pos.x, b1.pos.y - b2.pos.y)).toBeGreaterThan(TURRET_RANGE * 4)
    expect(sim.gs.mp!.loot!.sites.length).toBe(5)
    for (let lvl = 1; lvl <= 3; lvl += 1) expect(isConnected(outpostDesign(lvl))).toBe(true)
    for (const pr of LOOT_PRESETS) {
      expect(validateDesign(pr.design, {}, sim.gs), pr.id).toBeNull()
      expect(vesselStats(pr.design).cargoCap, pr.id).toBeGreaterThan(0)
    }
  })

  it('gemi üssün önünde uzayda doğar; yerçekimi yoktur, itki hızlandırır, sürtünme durdurur', () => {
    const sim = makeLootSim()
    const v = launch(sim, 'p1')
    const base = outpostPos(0)
    expect(v.landed).toBe(false)
    expect(Math.hypot(v.pos.x - base.x, v.pos.y - base.y)).toBeLessThan(200)
    v.spawnShieldUntil = 0
    const start = { ...v.pos }
    for (let i = 0; i < 100; i += 1) stepWorld(sim, 0.05, new Map())
    expect(arcade.on).toBe(true)
    expect(Math.hypot(v.pos.x - start.x, v.pos.y - start.y)).toBeLessThan(0.5)
    v.throttle = 1
    for (let i = 0; i < 100; i += 1) stepWorld(sim, 0.05, new Map())
    const fast = Math.hypot(v.vel.x, v.vel.y)
    expect(fast).toBeGreaterThan(40)
    v.throttle = 0
    for (let i = 0; i < 400; i += 1) stepWorld(sim, 0.05, new Map())
    expect(Math.hypot(v.vel.x, v.vel.y)).toBeLessThan(fast * 0.3)
    expect(sim.warpIdx).toBe(0)
    expect(dispatchCommand(sim, { type: 'setAutopilot', vesselId: v.id, mode: 'orbit' }, 'p1').error).toBeTruthy()
    arcade.on = false
  })

  it('sandık toplanır, kapasiteyle sınırlıdır ve üste paraya çevrilir; hedefe ulaşan kazanır', () => {
    const sim = makeLootSim(3)
    const v = launch(sim, 'p1')
    const cap = vesselStats(v.parts).cargoCap
    const c = arenaCenter()
    v.pos = { x: c.x + 1500, y: c.y + 1500 }
    sim.gs.mp!.loot!.crates = []
    dropLoot(sim.gs, { x: v.pos.x + 10, y: v.pos.y }, { x: 0, y: 0 }, cap + 3, 0)
    stepWorld(sim, 0.05, new Map())
    expect(v.cargo.ore).toBeCloseTo(cap, 5)
    const left = sim.gs.mp!.loot!.crates.reduce((s, k) => s + (k.site < 0 ? k.tons : 0), 0)
    expect(left).toBeCloseTo(3, 1)

    const money = sim.gs.mp!.players.p1!.money
    const home = findOutpost(sim.gs, 'p1')!
    v.pos = { x: home.pos.x + 100, y: home.pos.y }
    v.parts.find((p) => partDef(p.def).kind === 'tank')!.fuel = 0.5
    const events = stepWorld(sim, 0.05, new Map())
    expect(v.cargo.ore).toBe(0)
    expect(sim.gs.mp!.players.p1!.money).toBeGreaterThanOrEqual(money + cap * LOOT_VALUE_PER_TON)
    expect(sim.gs.mp!.players.p1!.looted).toBeCloseTo(cap, 5)
    expect(sim.gs.mp!.winnerId).toBe('p1')
    expect(events.some((e) => e.type === 'victory')).toBe(true)
    for (let i = 0; i < 40; i += 1) stepWorld(sim, 0.05, new Map())
    expect(v.parts.find((p) => partDef(p.def).kind === 'tank')!.fuel).toBeGreaterThan(2)
    arcade.on = false
  })

  it('arena dışına çıkan gemi merkeze doğru itilir', () => {
    const sim = makeLootSim()
    const v = launch(sim, 'p1')
    const c = arenaCenter()
    v.pos = { x: c.x + ARENA_RADIUS + 400, y: c.y }
    v.vel = { x: 0, y: 0 }
    for (let i = 0; i < 20; i += 1) stepWorld(sim, 0.05, new Map())
    expect(v.vel.x).toBeLessThan(-5)
    arcade.on = false
  })

  it('üs taretleri yaklaşan düşmana kendiliğinden ateş eder; vurulan gemi kargosunu saçar', () => {
    const sim = makeLootSim()
    const v2 = launch(sim, 'p2')
    const b1 = findOutpost(sim.gs, 'p1')!
    v2.spawnShieldUntil = 0
    v2.pos = { x: b1.pos.x - Math.cos(b1.angle) * 500, y: b1.pos.y - Math.sin(b1.angle) * 500 }
    v2.cargo.ore = 3
    let fired = false
    for (let i = 0; i < 60; i += 1) {
      if (stepWorld(sim, 0.05, new Map()).some((e) => e.type === 'weaponFire')) fired = true
    }
    expect(fired).toBe(true)
    expect(vesselStats(v2.parts).hp).toBeLessThan(vesselStats(v2.parts).maxHp)

    sim.gs.mp!.loot!.crates = []
    const events: GameEvent[] = []
    const cmd = v2.parts.findIndex((p) => partDef(p.def).kind === 'command')
    v2.parts[cmd]!.hp = 1
    applyVesselDamage(sim.gs, v2, v2.pos.x, v2.pos.y, 5, { ...dmgOpts(sim, events), splash: 60 })
    expect(v2.debris).toBeDefined()
    expect(sim.gs.vessels.includes(v2)).toBe(true)
    expect(sim.gs.mp!.players.p1!.kills).toBe(1)
    expect(sim.gs.mp!.players.p2!.activeVesselId).toBeNull()
    expect(sim.gs.mp!.loot!.crates.reduce((s, k) => s + k.tons, 0)).toBeGreaterThan(3)
    arcade.on = false
  })

  it('çekirdeği yok edilen üs kasasının bir kısmını saçar, sonra yeniden kurulur; üs geliştirilebilir', () => {
    const sim = makeLootSim()
    expect(dispatchCommand(sim, { type: 'upgradeOutpost' }, 'p2').error).toBeUndefined()
    const b2 = findOutpost(sim.gs, 'p2')!
    expect(b2.outpost?.level).toBe(2)
    expect(vesselStats(b2.parts).shieldCap).toBeGreaterThan(0)
    expect(sim.gs.mp!.players.p2!.money).toBe(100_000 - OUTPOST_UPGRADE_COST[1]!)
    const before = sim.gs.mp!.players.p2!.money
    b2.lastAttackerId = 'p1'
    b2.parts.find((p) => p.def === 'base-core')!.hp = 0
    sim.gs.mp!.loot!.crates = []
    stepWorld(sim, 0.05, new Map())
    expect(findOutpost(sim.gs, 'p2')).toBeUndefined()
    expect(sim.gs.mp!.players.p2!.money).toBeLessThan(before * 0.75)
    expect(sim.gs.mp!.loot!.crates.length).toBeGreaterThan(0)
    expect(sim.gs.mp!.players.p1!.coloniesDestroyed).toBe(1)
    sim.clock = (sim.clock ?? 0) + 60
    stepWorld(sim, 0.05, new Map())
    expect(findOutpost(sim.gs, 'p2')?.outpost?.level).toBe(2)
    arcade.on = false
  })

  it('anlık görüntü üsleri, sandıkları ve devre dışı parçaları istemciye taşır', () => {
    const sim = makeLootSim()
    const v = launch(sim, 'p1')
    v.parts[0]!.hp = -5
    stepWorld(sim, 0.05, new Map())
    const wire = JSON.parse(JSON.stringify(buildCompactSnapshot(sim, true)))
    const out = hydrateCompactSnapshot(wire, null, 'p2', [], {})
    expect(out.gs.mp!.loot!.sites.length).toBe(5)
    expect(out.gs.vessels.filter((o) => o.outpost).length).toBe(2)
    expect(partAlive(out.gs.vessels.find((o) => o.id === v.id)!.parts[0]!)).toBe(false)
    arcade.on = false
  })
})

describe('Parça bazlı hasar: gemi tek isabetle dağılmaz', () => {
  const design: PartInst[] = [
    { def: 'capsule', x: 6, y: 0 },
    { def: 'tank-m', x: 6, y: 2 },
    { def: 'tank-m', x: 6, y: 4 },
    { def: 'hawk', x: 6, y: 6 },
    { def: 'kolibri', x: 5, y: 6 },
  ]
  const sim: Sim = { gs: makeLootSim().gs, warpIdx: 0, firing: new Map(), fx: [], clock: 0 }

  it('ortadaki tank patlayınca yakıtı gider ama gövde ve alttaki motor yerinde kalır', () => {
    const v = shipOf(design)
    sim.gs.vessels.push(v)
    const st = vesselStats(v.parts)
    const tank = v.parts[1]!
    tank.hp = 1
    const events: GameEvent[] = []
    // Tankın tam üstüne küçük isabet
    const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
    const lf = -(tank.y + 1 - st.comY)
    const hit = { x: v.pos.x + fwd.x * lf, y: v.pos.y + fwd.y * lf }
    applyVesselDamage(sim.gs, v, hit.x, hit.y, 5, dmgOpts(sim, events))
    expect(v.parts.length).toBe(design.length)
    expect(partAlive(tank)).toBe(false)
    expect(tank.fuel).toBe(0)
    expect(vesselStats(v.parts).fuel).toBeCloseTo(4, 5)
    expect(vesselStats(v.parts).hasCommand).toBe(true)
    expect(v.debris).toBeUndefined()
    expect(events.some((e) => e.type === 'explosion')).toBe(true)
    // Patlama komşu parçaları da hırpalar
    expect(v.parts[2]!.hp).toBeLessThan(partMaxHp('tank-m'))
  })

  it('motor devre dışı kalınca itki azalır; hasarlı motor daha az iter', () => {
    const parts = freshParts(design)
    const full = runEngines(parts.map((p) => ({ ...p })), 1, 0, 0.02, 100).thrust
    const hurt = parts.map((p) => ({ ...p }))
    hurt[3]!.hp = partMaxHp('hawk') * 0.3
    const weak = runEngines(hurt, 1, 0, 0.02, 100).thrust
    const dead = parts.map((p) => ({ ...p }))
    dead[3]!.hp = 0
    const one = runEngines(dead, 1, 0, 0.02, 100).thrust
    expect(full).toBeCloseTo(180 + 16, 0)
    expect(weak).toBeLessThan(full * 0.75)
    expect(weak).toBeGreaterThan(one)
    expect(one).toBeCloseTo(16, 0)
  })

  it('tamamen ezilen parça kopar; ana gövdeden ayrılan bölüm bütün bir enkaz olur', () => {
    const v = shipOf(design)
    sim.gs.vessels.push(v)
    const before = sim.gs.vessels.length
    v.parts[2]!.hp = -partMaxHp('tank-m') * BREAKOFF_RATIO + 1
    v.parts[2]!.fuel = 0
    const st = vesselStats(v.parts)
    const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
    const lf = -(v.parts[2]!.y + 1 - st.comY)
    applyVesselDamage(sim.gs, v, v.pos.x + fwd.x * lf, v.pos.y + fwd.y * lf, 30, dmgOpts(sim, []))
    expect(v.parts.map((p) => p.def)).toEqual(['capsule', 'tank-m'])
    const wreck = sim.gs.vessels.slice(before).find((o) => o.parts.length === 2)
    expect(wreck?.debris).toBeDefined()
    expect(wreck!.parts.map((p) => p.def).sort()).toEqual(['hawk', 'kolibri'])
    expect(vesselStats(v.parts).hasCommand).toBe(true)
  })

  it('zırh plakası bitişik parçaya gelen hasarın çoğunu üstlenir', () => {
    const bare = shipOf([{ def: 'capsule', x: 6, y: 1 }, { def: 'tank-m', x: 6, y: 3 }])
    const armored = shipOf([{ def: 'armor-heavy', x: 6, y: 0 }, { def: 'capsule', x: 6, y: 1 }, { def: 'tank-m', x: 6, y: 3 }])
    for (const v of [bare, armored]) {
      sim.gs.vessels.push(v)
      const st = vesselStats(v.parts)
      const cap = v.parts.find((p) => p.def === 'capsule')!
      const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
      const lf = -(cap.y + 1 - st.comY)
      applyVesselDamage(sim.gs, v, v.pos.x + fwd.x * lf, v.pos.y + fwd.y * lf, 100, dmgOpts(sim, []))
    }
    const hpOf = (v: Vessel) => v.parts.find((p) => p.def === 'capsule')!.hp!
    expect(hpOf(bare)).toBeCloseTo(240 - 100, 5)
    expect(hpOf(armored)).toBeCloseTo(240 - 30, 5)
    expect(armored.parts[0]!.hp).toBeCloseTo(640 - 60, 5)
    expect(PARTS.filter((p) => p.armor).length).toBe(4)
  })
})
