import { describe, expect, it } from 'vitest'
import { BODIES } from '../nasa/bodies'
import {
  COLONY_SHIELD_PER_GEN,
  COLONY_SLOTS,
  colonyHealthSummary,
  colonyShieldCap,
  hasActiveLaunchPad,
  isQuadrantColonized,
  MODULE_BY_ID,
  quadrantCenterAngle,
} from '../game/base'
import { COMBAT_PRESETS, partDef, partMaxHp, PARTS } from '../game/data'
import { estimateDeltaV, freshParts, isConnected, vesselStats } from '../game/vessel'
import { buildCompactSnapshot, hydrateCompactSnapshot } from './mpClient'
import { newMultiplayerGame, padAngleForSlot } from './multiplayerSim'
import { PAD_ANGLE } from './physics'
import {
  allColoniesOnBody,
  applyColonyDamage,
  applyVesselDamage,
  colonyCenterWorldPos,
  colonySlotWorldPos,
  countSurvivingColonies,
  getActorQuadrantBase,
  isLootMode,
  isWarfareMode,
} from './combat'
import { availableLaunchSites, canLaunchFromQuadrant, dispatchCommand, placePlanetModule, stepWorld, validateDesign, type Sim } from './world'

function makeWarSim(goal: 'siege' | 'score15' | 'score30' | 'endless' = 'siege', money = 200_000): Sim {
  const gs = newMultiplayerGame(
    'WAR1',
    'p1',
    [
      { id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 },
      { id: 'p2', username: 'Vega', color: '#ff8a3d', slot: 1 },
    ],
    { mode: 'orbital-warfare', warfareGoal: goal, startingMoney: money },
  )
  gs.mp!.started = true
  return { gs, warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
}

describe('Space Warfare parts, presets and rules', () => {
  it('defines 12 distinct weapons plus armor and shield generator with valid stats', () => {
    const weapons = PARTS.filter((p) => p.kind === 'weapon')
    const defense = PARTS.filter((p) => p.kind === 'armor' || p.kind === 'shield')
    expect(weapons.length).toBe(12)
    expect(defense.length).toBe(5)
    for (const w of weapons) {
      expect(w.weapon).toBeDefined()
      expect(w.weapon!.dmg).toBeGreaterThan(0)
      expect(w.weapon!.cooldown).toBeGreaterThan(0)
      expect([1, 2, 3]).toContain(w.weapon!.group)
    }
  })

  it('all COMBAT_PRESETS are connected, lift-off ready and valid only in warfare/SP (blocked in colony-race)', () => {
    const warGs = makeWarSim('siege', 200_000).gs
    const raceGs = newMultiplayerGame(
      'RAC1',
      'p1',
      [{ id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 }],
      { mode: 'colony-race', startingMoney: 200_000 },
    )

    for (const preset of COMBAT_PRESETS) {
      expect(isConnected(preset.design)).toBe(true)
      const st = vesselStats(preset.design)
      expect(st.weaponCount).toBeGreaterThanOrEqual(2)
      expect(st.hasCombatParts).toBe(true)
      const dv = estimateDeltaV(preset.design, 0)
      expect(dv[0]?.twr ?? 0).toBeGreaterThanOrEqual(1.2)
      expect(validateDesign(preset.design, {}, warGs)).toBeNull()
      expect(validateDesign(preset.design, {}, raceGs)).toContain('Uzay Savaşı')
    }

    // Savunma koloni modülleri Koloni Yarışı'nda engellenir, Uzay Savaşı'nda serbesttir
    expect(validateDesign(COMBAT_PRESETS[0]!.design, { 'aa-turret': 1 }, raceGs)).toContain('Uzay Savaşı')
  })

  it('spaces warfare Earth launch pads wider inside flat plateau', () => {
    const p0 = padAngleForSlot(0, 'orbital-warfare')
    const p1 = padAngleForSlot(1, 'orbital-warfare')
    const diffRad = Math.abs(p1 - p0)
    expect(p0).toBe(PAD_ANGLE)
    expect(diffRad).toBeGreaterThan(0.0007)
    expect(diffRad * BODIES.earth.radius).toBeGreaterThan(220)
  })
})

describe('Weapon firing, FTL mechanics, shields, EMP and ship-to-ship combat', () => {
  it('fires ONLY the selected FTL weapon (never all), respects ammo, EC and spins up Chain Vulcan', () => {
    const sim = makeWarSim()
    const design = COMBAT_PRESETS[0]!.design // 2× gun-laser + 2× gun-vulcan
    expect(dispatchCommand(sim, { type: 'launch', design }, 'p1').error).toBeUndefined()
    const v = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    v.landed = false
    v.spawnShieldUntil = 0
    v.pos = { x: BODIES.earth.radius + 5000, y: 0 }
    v.vel = { x: 0, y: 200 }
    v.angle = Math.PI / 2

    // 1) Yalnızca gun-vulcan seçili -> lazerler ateşlenmez, sadece Vulcan atar ve hızlanır
    const ctrlVulcan = new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-vulcan', aimAngle: Math.PI / 2 }]])
    const events = stepWorld(sim, 0.05, ctrlVulcan)
    expect(events.some((e) => e.type === 'weaponFire' && e.weaponId === 'gun-vulcan')).toBe(true)
    expect((sim.gs.mp?.projectiles?.length ?? 0)).toBe(2) // yalnızca 2× Vulcan mermisi
    expect(sim.fx?.some((f) => f.kind === 'beam')).toBe(false) // Odak Lazeri seçili değilken ateşlenmez!

    const vulcanParts = v.parts.filter((p) => p.def === 'gun-vulcan')
    expect(vulcanParts.every((p) => (p.ammo ?? 0) === partDef('gun-vulcan').weapon!.ammo! - 1)).toBe(true)

    // Vulcan basılı tutuldukça spin-up (p.charge) yükselir
    const ch0 = vulcanParts[0]!.charge ?? 0
    for (let i = 0; i < 30; i += 1) stepWorld(sim, 0.05, ctrlVulcan)
    expect(vulcanParts[0]!.charge ?? 0).toBeGreaterThan(ch0)

    // 2) gun-laser seçili -> basılı tutunca Odak Lazeri şarj olup sürekli yakar (sınırsız cephane, EC kullanır)
    const ctrlLaser = new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-laser', aimAngle: Math.PI / 2 }]])
    for (let i = 0; i < 8; i += 1) stepWorld(sim, 0.05, ctrlLaser)
    expect(sim.fx?.some((f) => f.kind === 'beam')).toBe(true)

    // 3) Elektrik sıfırsa lazer ateşleyemez
    v.ec = 0
    for (const p of v.parts) p.cd = 0
    const laserCountBefore = sim.fx?.filter((f) => f.kind === 'beam').length ?? 0
    stepWorld(sim, 0.05, ctrlLaser)
    expect(sim.fx?.filter((f) => f.kind === 'beam').length ?? 0).toBe(laserCountBefore)
  })

  it('holds to charge Giant Death Laser (gun-beam) and unleashes continuous sweeping beam piercing enemies', () => {
    const sim = makeWarSim()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[2]!.design }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p2').error).toBeUndefined()
    const v1 = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((o) => o.ownerId === 'p2')!
    v1.landed = false
    v2.landed = false
    v1.spawnShieldUntil = 0
    v2.spawnShieldUntil = 0
    const r = BODIES.earth.radius + 15_000
    v1.pos = { x: r, y: 0 }
    v1.vel = { x: 0, y: 100 }
    v1.angle = Math.PI / 2
    v2.pos = { x: r, y: 600 }
    v2.vel = { x: 0, y: 100 }

    const beamPart = v1.parts.find((p) => p.def === 'gun-beam')!
    const ctrl = new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-beam', aimAngle: Math.PI / 2 }]])
    // İlk 0.5 sn yalnızca şarj olur, henüz ışın çıkmaz
    for (let i = 0; i < 10; i += 1) stepWorld(sim, 0.05, ctrl)
    expect(beamPart.charge).toBeGreaterThan(0.35)
    expect(sim.fx?.some((f) => f.kind === 'beam')).toBe(false)

    // 1.1 sn dolunca dev ölüm ışını ateşlenir ve basılı tuttukça kesintisiz süpürür!
    const shieldBefore = v2.shield ?? 0
    for (let i = 0; i < 20; i += 1) stepWorld(sim, 0.05, ctrl)
    const giantBeams = (sim.fx ?? []).filter((f) => f.kind === 'beam' && f.size >= 5)
    expect(giantBeams.length).toBeGreaterThanOrEqual(2)
    expect(v2.shield ?? 0).toBeLessThan(shieldBefore)
  })

  it('spawns 9 flak shards with cursor airburst and applies homing steering on limited-ammo guided missiles', () => {
    const sim = makeWarSim()
    const design = freshParts([
      { def: 'capsule', x: 6, y: 8 },
      { def: 'battery', x: 6, y: 10 },
      { def: 'gun-flak', x: 4, y: 8 },
      { def: 'gun-missile', x: 8, y: 8 },
      { def: 'tank-l', x: 6, y: 11 },
      { def: 'titan', x: 6, y: 14 },
    ])
    expect(dispatchCommand(sim, { type: 'launch', design }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p2').error).toBeUndefined()

    const v1 = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((o) => o.ownerId === 'p2')!
    v1.landed = false
    v2.landed = false
    v1.spawnShieldUntil = 0
    v2.spawnShieldUntil = 0
    const r = BODIES.earth.radius + 15_000
    v1.pos = { x: r, y: 0 }
    v1.vel = { x: 0, y: 100 }
    v1.angle = 0
    v2.pos = { x: r, y: 900 }
    v2.vel = { x: 0, y: 100 }

    // Flak seçiliyken 9 parçacık fırlatır, füze atmaz
    const ctrlFlak = new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-flak', aimAngle: 0, aimDist: 350 }]])
    stepWorld(sim, 0.05, ctrlFlak)
    expect((sim.gs.mp?.projectiles ?? []).filter((p) => p.kind === 'flak').length).toBe(9)
    expect((sim.gs.mp?.projectiles ?? []).filter((p) => p.kind === 'missile').length).toBe(0)

    // Güdümlü füze seçiliyken hedefe kilitlenir ve sınırlı cephanesi azalır
    const ctrlMissile = new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-missile', aimAngle: Math.PI / 4, aimDist: 900 }]])
    stepWorld(sim, 0.05, ctrlMissile)
    const missiles = (sim.gs.mp?.projectiles ?? []).filter((p) => p.kind === 'missile')
    expect(missiles.length).toBe(1)
    expect(missiles[0]!.targetId).toBe(v2.id)
    expect(v1.parts.find((p) => p.def === 'gun-missile')!.ammo).toBe(partDef('gun-missile').weapon!.ammo! - 1)

    // Güdümlü füze zamanla hedef yönüne (+Y) doğru döner
    const vy0 = missiles[0]!.vel.y
    for (let i = 0; i < 6; i += 1) stepWorld(sim, 0.05, new Map())
    expect(missiles[0]!.vel.y).toBeGreaterThan(vy0)
  })

  it('repairs damaged ships landed at a friendly colony via repairVessel command', () => {
    const sim = makeWarSim()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p1').error).toBeUndefined()
    const v1 = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    expect(v1.landed).toBe(true)
    v1.parts[0]!.hp = 20
    expect(dispatchCommand(sim, { type: 'repairVessel', vesselId: v1.id }, 'p1').error).toBeUndefined()
    expect(v1.parts[0]!.hp).toBeGreaterThan(20)
  })

  it('energy shields absorb hits, EMP drains EC and stuns, and hull destruction awards kills and scores', () => {
    const sim = makeWarSim('score15')
    const shieldDesign = freshParts([
      { def: 'capsule', x: 6, y: 8 },
      { def: 'shield-gen', x: 6, y: 10 },
      { def: 'battery', x: 6, y: 11 },
      { def: 'tank-l', x: 6, y: 12 },
      { def: 'titan', x: 6, y: 15 },
    ])
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: shieldDesign }, 'p2').error).toBeUndefined()

    const v2 = sim.gs.vessels.find((o) => o.ownerId === 'p2')!
    v2.landed = false
    v2.pos = { x: BODIES.earth.radius + 10_000, y: 0 }
    const events: any[] = []

    // Doğum kalkanı aktifken hasar engellenir
    v2.spawnShieldUntil = (sim.clock ?? 0) + 5
    applyVesselDamage(sim.gs, v2, v2.pos.x, v2.pos.y, 120, {
      attackerId: 'p1',
      clock: sim.clock ?? 0,
      firing: sim.firing,
      fxOut: sim.fx,
      events,
    })
    expect(v2.shield).toBe(200)

    // Kalkan EM/EMP hasarı alır, raylı top ise %35 kalkanı deler
    v2.spawnShieldUntil = 0
    const ecBefore = v2.ec
    applyVesselDamage(sim.gs, v2, v2.pos.x, v2.pos.y, 50, {
      attackerId: 'p1',
      shieldMult: 2.2,
      empDrain: 40,
      empStun: 2.5,
      clock: sim.clock ?? 0,
      firing: sim.firing,
      fxOut: sim.fx,
      events,
    })
    expect(v2.shield).toBeCloseTo(200 - 110, 1)
    expect(v2.ec).toBeLessThan(ecBefore)
    expect(v2.empUntil).toBeGreaterThan(sim.clock ?? 0)

    // Dev hasar gemiyi parçalar ve p1'e skor + kill verir
    v2.shield = 0
    const killsBefore = sim.gs.mp!.players.p1.kills
    const scoreBefore = sim.gs.mp!.players.p1.score ?? 0
    applyVesselDamage(sim.gs.mp ? sim.gs : sim.gs, v2, v2.pos.x, v2.pos.y, 2000, {
      attackerId: 'p1',
      splash: 30,
      clock: sim.clock ?? 0,
      firing: sim.firing,
      fxOut: sim.fx,
      events,
    })
    expect(sim.gs.mp!.players.p1.kills).toBe(killsBefore + 1)
    expect(sim.gs.mp!.players.p1.score).toBe(scoreBefore + 2)
  })
})

describe('Colony defenses, shield domes, colony siege & snapshot delta optimization', () => {
  it('colony shield dome protects buildings, repair bay heals, AA turret shoots attacker, and destroying base eliminates player', () => {
    const sim = makeWarSim('siege', 500_000)
    // p2 Dünya üssüne Güneş Paneli + Kalkan Kubbesi + Onarım Hangarı kursun (0..4 zaten dolu; AA taret dahil hepsi güç alsın)
    expect(dispatchCommand(sim, { type: 'placeGridModule', bodyId: 'earth', x: 5, moduleId: 'solar-farm' }, 'p2').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'placeGridModule', bodyId: 'earth', x: 6, moduleId: 'colony-shield' }, 'p2').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'placeGridModule', bodyId: 'earth', x: 7, moduleId: 'repair-bay' }, 'p2').error).toBeUndefined()

    const p2Base = sim.gs.mp!.players.p2.earthBase!
    expect(colonyShieldCap(p2Base, 1)).toBe(COLONY_SHIELD_PER_GEN)

    // İlk tic ile kalkan dolsun
    for (let i = 0; i < 6; i += 1) stepWorld(sim, 0.2, new Map())
    expect(p2Base.shield).toBeGreaterThan(0)

    // p1 roketi p2 kolonisi menziline girerse AA Lazer ateş eder!
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[2]!.design }, 'p1').error).toBeUndefined()
    const v1 = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    v1.landed = false
    v1.spawnShieldUntil = 0
    const colPos = colonyCenterWorldPos('earth', p2Base.siteAngle ?? PAD_ANGLE, true)
    const up = { x: Math.cos(p2Base.siteAngle!), y: Math.sin(p2Base.siteAngle!) }
    v1.pos = { x: colPos.x + up.x * 650, y: colPos.y + up.y * 650 }
    v1.vel = { x: 0, y: 0 }
    p2Base.turretCd = 0
    const fxBefore = sim.fx?.length ?? 0
    const turretEvs = stepWorld(sim, 0.05, new Map())
    expect((sim.fx?.length ?? 0) > fxBefore || turretEvs.some((e) => e.type === 'weaponFire')).toBe(true)

    // Kuşatma hasarı önce kalkanı kırar, sonra binalara işler ve Onarım Hangarı iyileştirir
    const slot5 = colonySlotWorldPos('earth', p2Base.siteAngle!, 5, true, 4)
    p2Base.shield = 200
    const events: any[] = []
    applyColonyDamage(
      sim.gs,
      { ownerId: 'p2', bodyId: 'earth', base: p2Base, isEarth: true, quadrant: 0 },
      slot5.x,
      slot5.y,
      300,
      { attackerId: 'p1', splash: 8, clock: sim.clock ?? 0, fxOut: sim.fx, events },
    )
    expect(p2Base.shield).toBe(0)
    const sumAfterHit = colonyHealthSummary(p2Base)
    expect(sumAfterHit.hp).toBeLessThan(sumAfterHit.maxHp)

    // Roketi uzaklaştırıp 4 saniye geçir: onarım hangarı binaları onarır
    v1.pos = { x: BODIES.earth.radius + 90_000, y: 0 }
    for (let i = 0; i < 40; i += 1) stepWorld(sim, 0.1, new Map())
    const sumAfterRepair = colonyHealthSummary(p2Base)
    expect(sumAfterRepair.hp).toBeGreaterThan(sumAfterHit.hp)

    // Ağır orbital torpido bombardımanı tüm p2 üssünü imha eder -> p2 elenir -> p1 zafer!
    p2Base.shield = 0
    for (let s = 0; s < p2Base.sites!.length; s += 1) {
      if (!p2Base.sites![s]) continue
      const posS = colonySlotWorldPos('earth', p2Base.siteAngle!, s, true, 4)
      applyColonyDamage(
        sim.gs,
        { ownerId: 'p2', bodyId: 'earth', base: p2Base, isEarth: true, quadrant: 0 },
        posS.x,
        posS.y,
        5000,
        { attackerId: 'p1', splash: 60, clock: sim.clock ?? 0, fxOut: sim.fx, events },
      )
    }
    expect(p2Base.destroyed).toBe(true)
    expect(countSurvivingColonies(sim.gs.mp!.players.p2)).toBe(0)

    const endEvs = stepWorld(sim, 0.05, new Map())
    expect(sim.gs.mp!.players.p2.eliminated).toBe(true)
    expect(sim.gs.mp!.winnerId).toBe('p1')
    expect(endEvs.some((e) => e.type === 'victory' && e.winnerId === 'p1')).toBe(true)

    // Elenen p2 artık yeni roket fırlatamaz
    const resLaunch = dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p2')
    expect(resLaunch.error).toContain('elendin')
  })

  it('compact snapshots include combat data, omit duplicate parts arrays and trim delta payloads', () => {
    const sim = makeWarSim()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p1').error).toBeUndefined()
    const v1 = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    v1.landed = false
    v1.pos = { x: BODIES.earth.radius + 5000, y: 0 }
    v1.shield = 145
    v1.aimAngle = 1.25
    v1.parts[2]!.ammo = 99
    v1.parts[2]!.hp = 42

    // 1. Anlık görüntü tam yapıyı ve üssü gönderir
    const snap1 = JSON.parse(JSON.stringify(buildCompactSnapshot(sim, true)))
    expect(snap1.vessels[0].parts?.length).toBe(v1.parts.length)
    expect(snap1.mp.players.p1.earthBase).toBeDefined()

    const h1 = hydrateCompactSnapshot(snap1, null, 'p2', [], {})
    const v1Client = h1.gs.vessels.find((o) => o.id === v1.id)!
    expect(v1Client.shield).toBeCloseTo(145, 1)
    expect(v1Client.aimAngle).toBeCloseTo(1.25, 2)
    expect(v1Client.parts[2]!.ammo).toBe(99)
    expect(v1Client.parts[2]!.hp).toBe(42)

    // 2. Hemen ardından gelen delta snapshot `parts` ve `earthBase` alanlarını keser (bant genişliği/ping tasarrufu!)
    v1.shield = 120
    v1.parts[2]!.ammo = 88
    v1.parts[2]!.charge = 0.75
    const snap2 = JSON.parse(JSON.stringify(buildCompactSnapshot(sim, false)))
    expect(snap2.vessels[0].parts).toBeUndefined()
    expect(snap2.vessels[0]._pa).toBeDefined()
    expect(snap2.vessels[0]._pc).toBeDefined()
    expect(snap2._omitStatic).toBe(true)
    expect(snap2.mp.players.p1.earthBase).toBeUndefined()

    const h2 = hydrateCompactSnapshot(snap2, h1.gs, 'p2', [], {})
    const v1Updated = h2.gs.vessels.find((o) => o.id === v1.id)!
    expect(v1Updated.shield).toBeCloseTo(120, 1)
    expect(v1Updated.parts.length).toBe(v1.parts.length)
    expect(v1Updated.parts[2]!.ammo).toBe(88)
    expect(v1Updated.parts[2]!.charge).toBeCloseTo(0.75, 2)
    expect(allColoniesOnBody(h2.gs, 'earth').length).toBe(2)

    // Şarj sıfırlanınca istemcide takılı kalmaz
    v1.parts[2]!.charge = 0
    v1.parts[2]!.cd = 0
    const snap3 = JSON.parse(JSON.stringify(buildCompactSnapshot(sim, false)))
    const h3 = hydrateCompactSnapshot(snap3, h2.gs, 'p2', [], {})
    expect(h3.gs.vessels.find((o) => o.id === v1.id)!.parts[2]!.charge).toBe(0)
  })

  it('restores fast-travel climb & warp during MP transfer while dropping to 1x during active weapon fire', () => {
    const sim = makeWarSim()
    expect(dispatchCommand(sim, { type: 'setTarget', bodyId: 'moon' }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p2').error).toBeUndefined()
    const v1 = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((o) => o.ownerId === 'p2')!
    v1.landed = false
    v2.landed = false
    v1.pos = { x: BODIES.earth.radius + 14_000, y: 0 }
    v1.vel = { x: 0, y: 1200 }
    v2.pos = { x: -(BODIES.earth.radius + 35_000), y: 0 }
    v2.vel = { x: 0, y: -1200 }

    // Ay transfer tırmanışında MP hızlı yolculuk yumuşak adımlarla 4× tavanına çıkar
    expect(dispatchCommand(sim, { type: 'setAutopilot', vesselId: v1.id, mode: 'transfer' }, 'p1').error).toBeUndefined()
    for (let i = 0; i < 18; i += 1) stepWorld(sim, 0.05, new Map())
    expect(sim.warpIdx).toBeGreaterThanOrEqual(2)

    // Silah ateşlenince çatışma güvenliği otomatik 1×'e çeker
    stepWorld(sim, 0.05, new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-vulcan', aimAngle: 0 }]]))
    expect(sim.warpIdx).toBe(0)
  })

  it('score15 warfare goal finishes match when a player accumulates 15 points', () => {
    const sim = makeWarSim('score15')
    sim.gs.mp!.players.p1.score = 15
    const evs = stepWorld(sim, 0.05, new Map())
    expect(sim.gs.mp!.winnerId).toBe('p1')
    expect(evs.some((e) => e.type === 'victory' && e.winnerId === 'p1')).toBe(true)
  })

  it('all warfare modules exist and have positive HP', () => {
    for (const id of ['aa-turret', 'sam-battery', 'colony-shield', 'repair-bay']) {
      const m = MODULE_BY_ID[id]
      expect(m).toBeDefined()
      expect(m!.warfare).toBe(true)
      expect(m!.hp).toBeGreaterThanOrEqual(200)
    }
  })
})

describe('combat regressions', () => {
  it('plasma burn deals damage at 144 Hz tick sizes and ignores spent stages as targets', () => {
    const sim = makeWarSim()
    expect(dispatchCommand(sim, { type: 'launch', design: COMBAT_PRESETS[0]!.design }, 'p2').error).toBeUndefined()
    const v = sim.gs.vessels.find((o) => o.ownerId === 'p2')!
    v.landed = false
    v.spawnShieldUntil = 0
    v.pos = { x: BODIES.earth.radius + 20_000, y: 0 }
    v.vel = { x: 0, y: 100 }
    v.burnUntil = (sim.clock ?? 0) + 5
    const hpBefore = v.parts.reduce((a, p) => a + (p.hp ?? partMaxHp(p.def)), 0)
    for (let i = 0; i < 100; i += 1) stepWorld(sim, 1 / 144, new Map())
    const hpAfter = v.parts.reduce((a, p) => a + (p.hp ?? partMaxHp(p.def)), 0)
    expect(hpAfter).toBeLessThan(hpBefore)
  })
})

describe('4-quadrant planets, Space Station building and Launch Pad launches', () => {
  it('supports 12 colony slots, single-quadrant Space Station colonization, local Station builds, and Moon Launch Pad launches', () => {
    expect(COLONY_SLOTS).toBe(12)
    const sim = makeWarSim('siege', 250_000)
    expect(isWarfareMode(sim.gs)).toBe(true)
    expect(isLootMode(sim.gs)).toBe(false)

    // Başlangıçta Ay Q1'de üs, rampa ve doğrudan inşa yetkisi yok
    expect(canLaunchFromQuadrant(sim.gs, 'moon', 1, 'p1')).toBe(false)
    expect(placePlanetModule(sim, 'moon', 0, 'launch-pad', 'p1', 1)).toBeTruthy()

    // p1 adına Ay Çeyrek 1'e inmiş bir kargo gemisi yerleştir (Uzay İstasyonu + Reaktör)
    const thetaQ1 = quadrantCenterAngle(1)
    const rMoon = BODIES.moon.radius
    const landerId = sim.gs.nextId
    sim.gs.nextId += 1
    sim.gs.vessels.push({
      id: landerId,
      name: 'Ay İnici',
      ownerId: 'p1',
      bodyId: 'moon',
      pos: { x: Math.cos(thetaQ1) * rMoon, y: Math.sin(thetaQ1) * rMoon },
      vel: { x: 0, y: 0 },
      angle: thetaQ1,
      angVel: 0,
      throttle: 0,
      landed: true,
      ec: 40,
      rcsOn: false,
      sas: 'off',
      autopilot: 'off',
      visited: ['moon'],
      assist: null,
      dvUsed: 0,
      parts: freshParts([{ def: 'capsule', x: 6, y: 1 }, { def: 'cargo-lg', x: 6, y: 3 }]),
      cargo: { modules: { 'colony-station': 1, 'rtg-reactor': 1 }, ore: 0, oreFrom: null },
    })
    sim.gs.mp!.players.p1.activeVesselId = landerId

    const deployRes = dispatchCommand(sim, { type: 'deployModules', vesselId: landerId, quadrant: 1 }, 'p1')
    expect(deployRes.error).toBeUndefined()
    // Kargo aracını rampadan 3.4 km kenara park et (yeni roket fırlatılabilsin)
    const landerRef = sim.gs.vessels.find((v) => v.id === landerId)!
    landerRef.pos = { x: Math.cos(thetaQ1 + 0.002) * rMoon, y: Math.sin(thetaQ1 + 0.002) * rMoon }

    // Uzay İstasyonu yalnızca Çeyrek 1'i kolonileştirir; Çeyrek 0 hâlâ boştur
    const q1Base = getActorQuadrantBase(sim.gs, 'moon', 'p1', 1)
    const q0Base = getActorQuadrantBase(sim.gs, 'moon', 'p1', 0)
    expect(q1Base?.modules['colony-station']).toBe(1)
    expect(isQuadrantColonized(q1Base, 1)).toBe(true)
    expect(q0Base).toBeUndefined()
    expect(allColoniesOnBody(sim.gs, 'moon').length).toBe(1)
    expect(countSurvivingColonies(sim.gs.mp!.players.p1)).toBe(2)

    // Yalnızca Uzay İstasyonu ile henüz fırlatma rampası yok, ama çeyrekte doğrudan krediyle bina kurulumu açılır
    expect(hasActiveLaunchPad(q1Base, 1)).toBe(false)
    expect(canLaunchFromQuadrant(sim.gs, 'moon', 1, 'p1')).toBe(false)
    expect(placePlanetModule(sim, 'moon', 2, 'launch-pad', 'p1', 1)).toBeNull()

    // Aktif İstasyon + Fırlatma Rampası Ay Q1'den doğrudan roket fırlatmayı açar
    expect(hasActiveLaunchPad(q1Base, 1)).toBe(true)
    expect(canLaunchFromQuadrant(sim.gs, 'moon', 1, 'p1')).toBe(true)
    expect(availableLaunchSites(sim.gs, 'p1').some((s) => s.bodyId === 'moon' && s.quadrant === 1)).toBe(true)

    const launchRes = dispatchCommand(
      sim,
      { type: 'launch', design: COMBAT_PRESETS[0]!.design, bodyId: 'moon', quadrant: 1 },
      'p1',
    )
    expect(launchRes.error).toBeUndefined()
    const launched = sim.gs.vessels.find((v) => v.ownerId === 'p1' && v.id === sim.gs.mp!.players.p1.activeVesselId)
    expect(launched).toBeDefined()
    expect(launched!.bodyId).toBe('moon')
    expect(launched!.landed).toBe(true)
    expect(Math.abs(Math.atan2(launched!.pos.y, launched!.pos.x) - thetaQ1)).toBeLessThan(0.2)
  })
})
