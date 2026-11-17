import { describe, expect, it } from 'vitest'
import { baseReport, COLONY_SLOTS, colonyTier, emptyBase, hasActiveLaunchPad, isQuadrantColonized, MODULE_BY_ID, quadrantCenterAngle, quadrantOfAngle, syncModules } from '../game/base'
import { DEFAULT_DESIGN, INITIAL_MONEY, partDef } from '../game/data'
import { MISSION_BY_ID } from '../game/missions'
import { estimateDeltaV, freshParts, isConnected, runEngines, trimCargoToCap, vesselStats } from '../game/vessel'
import { BODIES, solarFlux } from '../nasa/bodies'
import { elementsFromState, hohmann, len, propagate, wrapPi } from './orbit'
import { type Controls, PAD_ANGLE, situation, terrainHeight } from './physics'
import { predictTrajectory } from './predict'
import { droneMaxAlt, getActorQuadrantBase } from './combat'
import {
  computeDynamicWarp,
  newMultiplayerGame,
  padAngleForSlot,
  stepPlanetCaptures,
} from './multiplayerSim'
import {
  activeVessel,
  availableLaunchSites,
  canControlVessel,
  canLaunchFromQuadrant,
  canTransferCargoBetween,
  createsFollowCycle,
  deleteVessel,
  dispatchCommand,
  earthModuleCost,
  effectiveIncomeDt,
  launchDesign,
  newGame,
  PHYSICS_WARP_MAX_IDX,
  placePlanetModule,
  setVesselAutopilot,
  type Sim,
  stageNext,
  stepWorld,
  tickBasesOnly,
  totalPassiveIncomePerMin,
  validateDesign,
  WARPS,
} from './world'

const ctrl = { rotate: 0, tx: 0, ty: 0 }

describe('nasa bodies', () => {
  it('keeps real ratios', () => {
    expect(BODIES.moon.mu / BODIES.earth.mu).toBeCloseTo(0.0123, 3)
    expect(BODIES.moon.radius / BODIES.earth.radius).toBeCloseTo(1737.4 / 6371, 4)
    expect(BODIES.mars.orbit!.a / BODIES.earth.orbit!.a).toBeCloseTo(1.5237, 3)
    expect(BODIES.moon.soi).toBeLessThan(BODIES.moon.orbit!.a)
    expect(BODIES.earth.soi).toBeGreaterThan(BODIES.moon.orbit!.a * 1.2)
    console.log('SOI km', BODIES.earth.soi / 1e3, BODIES.moon.soi / 1e3, BODIES.mars.soi / 1e3, 'moon a', BODIES.moon.orbit!.a / 1e3)
  })
})

describe('kepler', () => {
  it('returns to start after one period', () => {
    const mu = BODIES.earth.mu
    const r = { x: 400e3, y: 0 }
    const v = { x: 100, y: 1700 }
    const el = elementsFromState(r, v, mu)
    const s = propagate(r, v, mu, el.period)
    expect(len({ x: s.r.x - r.x, y: s.r.y - r.y })).toBeLessThan(1)
    const h = propagate(r, { x: 0, y: -3000 }, mu, 500)
    const back = propagate(h.r, { x: -h.v.x, y: -h.v.y }, mu, 500)
    expect(len({ x: back.r.x - r.x, y: back.r.y - r.y })).toBeLessThan(1)
  })
})

describe('default rocket', () => {
  it('is connected and has enough delta-v', () => {
    expect(isConnected(DEFAULT_DESIGN)).toBe(true)
    const stages = estimateDeltaV(DEFAULT_DESIGN)
    console.log(stages.map((s) => `${s.dv.toFixed(0)} m/s twr ${s.twr.toFixed(2)}`), vesselStats(DEFAULT_DESIGN).cost)
    expect(stages[0]!.twr).toBeGreaterThan(1.2)
    expect(stages.reduce((s, x) => s + x.dv, 0)).toBeGreaterThan(5000)
  })

  it('reaches orbit and the Moon with a simple autopilot', { timeout: 15_000 }, () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    v.throttle = 1
    const earth = BODIES.earth
    const target = earth.radius + 50_000
    let phase = 0
    for (let i = 0; i < 60 * 60 * 30 && sim.gs.activeId; i += 1) {
      const s = situation(v)
      const el = elementsFromState(v.pos, v.vel, earth.mu)
      const up = Math.atan2(v.pos.y, v.pos.x)
      if (phase === 0) {
        const tilt = Math.min(1, Math.max(0, (s.altSea - 500) / 16_000)) * 1.5
        v.angle = up - tilt
        if (s.altSea > 1000 && el.e < 1 && el.ra > target) { v.throttle = 0; phase = 1 }
      } else if (phase === 1) {
        v.angle = Math.atan2(v.vel.y, v.vel.x)
        if (s.altSea > earth.atmoHeight && s.r > el.ra - 3000) { v.throttle = 1; phase = 2 }
      } else if (phase === 2) {
        v.angle = up - Math.PI / 2 + Math.max(-0.6, Math.min(0.6, -s.vr * 0.01))
        if (el.e < 1 && el.rp > earth.radius + 40_000) { v.throttle = 0; phase = 3; break }
      }
      // yakıtı biten kademeyi at
      if (v.throttle > 0 && sim.firing.get(v.id)?.size === 0) stageNext(sim, v)
      const ev = stepWorld(sim, 1 / 60, ctrl)
      for (const e of ev) if (e.type === 'crash' && e.wasActive) throw new Error(e.reason)
    }
    const el = elementsFromState(v.pos, v.vel, earth.mu)
    console.log('orbit', (el.rp - earth.radius) / 1e3, (el.ra - earth.radius) / 1e3, 'fuel', vesselStats(v.parts).fuel, 'parts', v.parts.length, 't', sim.gs.time, 'dv left', estimateDeltaV(v.parts.map((p) => ({ ...p }))).map((s) => s.dv))
    expect(phase).toBe(3)
    expect(sim.gs.missionsDone).toContain('earth-orbit')

    // Hohmann ile Ay'a: doğru faz açısını bekle, prograde yak
    const moon = BODIES.moon
    const r1 = len(v.pos)
    const plan = hohmann(earth.mu, r1, moon.orbit!.a, moon.orbit!.n)
    let burned = false
    for (let i = 0; i < 400000 && v.bodyId === 'earth'; i += 1) {
      if (!burned) {
        const m = moonAngle(sim.gs.time)
        const phaseNow = wrapPi(m - Math.atan2(v.pos.y, v.pos.x))
        sim.warpIdx = 3
        if (Math.abs(wrapPi(phaseNow - plan.phase)) < 0.02) {
          const sp = len(v.vel)
          const k = (sp + plan.dv1) / sp
          v.vel = { x: v.vel.x * k, y: v.vel.y * k }
          burned = true
          const patches = predictTrajectory(v.bodyId, v.pos, v.vel, sim.gs.time)
          console.log('patches', patches.map((p) => `${p.bodyId}:${p.end}:${p.points.length}`))
          expect(patches.some((p) => p.bodyId === 'moon')).toBe(true)
          sim.warpIdx = 5
        }
      }
      stepWorld(sim, 1 / 60, ctrl)
    }
    expect(v.bodyId).toBe('moon')
    expect(sim.gs.missionsDone).toContain('moon-soi')
  })
})

function moonAngle(t: number) {
  const s = BODIES.moon.orbit!
  // Ay'ın anlık açısı
  const E = s.M0 + s.n * t
  return E + s.argp + 2 * s.e * Math.sin(E)
}

describe('solar system expansion', () => {
  it('includes landable inner & outer bodies with consistent scaled orbits', () => {
    for (const id of ['mercury', 'venus', 'earth', 'moon', 'mars', 'ceres', 'ganymede', 'titan'] as const) {
      expect(BODIES[id].landable).toBe(true)
      expect(BODIES[id].soi).toBeGreaterThan(BODIES[id].radius)
      expect(Number.isFinite(terrainHeight(id, PAD_ANGLE))).toBe(true)
    }
    expect(BODIES.jupiter.landable).toBe(false)
    expect(BODIES.saturn.landable).toBe(false)
    expect(BODIES.sun.landable).toBe(false)
    expect(BODIES.mercury.orbit!.a / BODIES.earth.orbit!.a).toBeCloseTo(0.3871, 3)
    expect(BODIES.ganymede.soi).toBeLessThan(BODIES.ganymede.orbit!.a)
    expect(BODIES.titan.soi).toBeLessThan(BODIES.titan.orbit!.a)
  })
})

describe('idle passive income & tech tree', () => {
  it('starts new games with an active Earth passive income base measured per real minute', () => {
    const gs = newGame()
    expect(gs.bases.earth).toBeDefined()
    expect(gs.bases.earth!.modules.telemetry).toBeGreaterThan(0)
    const rate = totalPassiveIncomePerMin(gs)
    expect(rate).toBe(3_000)

    const money0 = gs.money
    const earned = tickBasesOnly(gs, 60)
    expect(earned).toBeCloseTo(rate, 2)
    expect(gs.money).toBeCloseTo(money0 + rate, 2)
    expect(gs.time).toBe(60)
  })
})

describe('25x warp & auto-land', () => {
  it('supports up to 25x physics/surface time warp', () => {
    expect(WARPS[PHYSICS_WARP_MAX_IDX]).toBe(25)
    expect(WARPS.includes(25)).toBe(true)
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    expect(launchDesign(sim)).toBeNull()
    sim.warpIdx = 6
    const v = activeVessel(sim.gs)!
    v.throttle = 1
    const events = stepWorld(sim, 0.05, ctrl)
    expect(sim.warpIdx).toBe(PHYSICS_WARP_MAX_IDX)
    expect(events.some((e) => e.type === 'toast' && e.text.includes('25×'))).toBe(true)
  })

  it('lands a vessel safely on the Moon using autoLand guidance', () => {
    const gs = newGame()
    gs.techDone.push('adv-landing')
    const parts = freshParts([
      { def: 'probe', x: 6, y: 10 },
      { def: 'tank-m', x: 6, y: 11 },
      { def: 'kolibri', x: 6, y: 13 },
      { def: 'leg', x: 5, y: 11 },
      { def: 'leg', x: 8, y: 11 },
    ])
    const moon = BODIES.moon
    const alt0 = 800
    const r0 = moon.radius + terrainHeight('moon', Math.PI / 2) + alt0
    gs.vessels.push({
      id: 1,
      name: 'AutoLander',
      parts,
      bodyId: 'moon',
      pos: { x: 0, y: r0 },
      vel: { x: 12, y: -25 },
      angle: Math.PI / 2,
      angVel: 0,
      landed: false,
      autoLand: true,
      throttle: 0,
      ec: vesselStats(parts).ecCap,
      cargo: { modules: {}, ore: 0, oreFrom: null },
      rcsOn: false,
      sas: 'off',
      visited: ['moon'],
      assist: null,
      dvUsed: 0,
    })
    gs.activeId = 1
    gs.nextId = 2
    const sim: Sim = { gs, warpIdx: 0, firing: new Map() }
    for (let i = 0; i < 60 * 180; i += 1) {
      const ev = stepWorld(sim, 1 / 60, ctrl)
      for (const e of ev) if (e.type === 'crash') throw new Error(`AutoLand crashed: ${e.reason}`)
      if (gs.vessels[0]?.landed) break
    }
    const lander = gs.vessels[0]!
    expect(lander).toBeDefined()
    expect(lander.landed).toBe(true)
    expect(lander.autoLand).toBe(false)
    expect(lander.parts.some((p) => p.def === 'leg' && p.deployed)).toBe(true)
  })

  it('locks and caps singleplayer warp during auto-land and keeps final descent gentle', () => {
    const gs = newGame()
    const parts = freshParts([
      { def: 'probe', x: 6, y: 10 },
      { def: 'tank-m', x: 6, y: 11 },
      { def: 'kolibri', x: 6, y: 13 },
      { def: 'leg', x: 5, y: 11 },
      { def: 'leg', x: 8, y: 11 },
    ])
    const moon = BODIES.moon
    const r0 = moon.radius + terrainHeight('moon', Math.PI / 2) + 12_000
    gs.vessels.push({
      id: 1,
      name: 'HighWarpLander',
      parts,
      bodyId: 'moon',
      pos: { x: 0, y: r0 },
      vel: { x: 25, y: -10 },
      angle: Math.PI / 2,
      angVel: 0,
      landed: false,
      autopilot: 'land',
      autoLand: true,
      throttle: 0,
      ec: vesselStats(parts).ecCap,
      cargo: { modules: {}, ore: 0, oreFrom: null },
      rcsOn: false,
      sas: 'off',
      visited: ['moon'],
      assist: null,
      dvUsed: 0,
    })
    gs.activeId = 1
    gs.nextId = 2
    const sim: Sim = { gs, warpIdx: 7, firing: new Map() }

    // Başlangıçta 2500× seçili olsa bile Oto-İniş devreye girerken iniş sınırına (12 km'de en fazla 100×) iner.
    stepWorld(sim, 0.05, ctrl)
    expect(WARPS[sim.warpIdx]!).toBeLessThanOrEqual(100)

    // Çok yüksekte (12 km) oyuncu hızı 2500×'e çıkarsa bile fizik sınırı (25×) içinde tutar, raylara kaçırmaz.
    // 12 km yükseklikte oyuncu 2500× seçse bile iniş sınırı (100×) içinde tutulur, raylara kaçırmaz.
    sim.warpIdx = 7
    stepWorld(sim, 0.05, ctrl)
    expect(WARPS[sim.warpIdx]!).toBeLessThanOrEqual(100)

    // 1.000 m alçalmasında en fazla 10×, 250 m'de en fazla 4×, 100 m altında ise otomatik 1×'e iner.
    const lander = gs.vessels[0]!
    lander.pos = { x: 0, y: moon.radius + terrainHeight('moon', Math.PI / 2) + 1000 }
    lander.vel = { x: 8, y: -20 }
    sim.warpIdx = 4
    stepWorld(sim, 1 / 60, ctrl)
    expect(WARPS[sim.warpIdx]!).toBe(1) // Dünya dışında 1000 m ve altı 1×

    lander.pos = { x: 0, y: moon.radius + terrainHeight('moon', Math.PI / 2) + 250 }
    lander.vel = { x: 4, y: -15 }
    sim.warpIdx = 4
    stepWorld(sim, 1 / 60, ctrl)
    expect(WARPS[sim.warpIdx]!).toBeLessThanOrEqual(4)

    let touchdownSpeed = 0
    let maxSpeedBelow150 = 0
    for (let i = 0; i < 60 * 180; i += 1) {
      const preSpeed = situation(lander).speed
      const ev = stepWorld(sim, 1 / 60, ctrl)
      const s = situation(lander)
      if (!lander.landed && s.alt < 95) expect(sim.warpIdx).toBe(0)
      if (!lander.landed && s.alt < 120) maxSpeedBelow150 = Math.max(maxSpeedBelow150, -s.vr)
      for (const e of ev) {
        if (e.type === 'crash') throw new Error(`AutoLand high-warp crashed: ${e.reason}`)
      }
      if (lander.landed) {
        touchdownSpeed = preSpeed
        break
      }
    }
    expect(lander.landed).toBe(true)
    expect(maxSpeedBelow150).toBeLessThan(28)
    expect(touchdownSpeed).toBeLessThan(4.5)
  })

  it('drops warp to 1x when autopilot completes or diving manually close to a surface', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    const parts = freshParts([
      { def: 'probe', x: 6, y: 10 },
      { def: 'tank-m', x: 6, y: 11 },
      { def: 'kolibri', x: 6, y: 13 },
    ])
    const moon = BODIES.moon
    const rCirc = moon.radius + 15_000
    const vCirc = Math.sqrt(moon.mu / rCirc)
    sim.gs.vessels.push({
      id: 1,
      name: 'OrbitFinish',
      parts,
      bodyId: 'moon',
      pos: { x: 0, y: rCirc },
      vel: { x: -vCirc, y: 0 },
      angle: Math.PI,
      angVel: 0,
      landed: false,
      autopilot: 'orbit',
      throttle: 0,
      ec: vesselStats(parts).ecCap,
      cargo: { modules: {}, ore: 0, oreFrom: null },
      rcsOn: false,
      sas: 'off',
      visited: ['moon'],
      assist: null,
      dvUsed: 0,
    })
    sim.gs.activeId = 1
    sim.warpIdx = 6

    // İlk adımda dairesel yörüngeye oturup otopilot kapanır; sonraki adımda hız 1×'e alınır.
    stepWorld(sim, 0.05, ctrl)
    expect(sim.gs.vessels[0]!.autopilot).toBe('off')
    stepWorld(sim, 0.05, ctrl)
    expect(sim.warpIdx).toBe(0)

    // Manuel inişte yüzeye yakın hızlı düşerken 25× otomatik 1×'e iner.
    const v = sim.gs.vessels[0]!
    v.pos = { x: 0, y: moon.radius + terrainHeight('moon', Math.PI / 2) + 800 }
    v.vel = { x: 0, y: -25 }
    sim.warpIdx = 4
    stepWorld(sim, 0.05, ctrl)
    expect(sim.warpIdx).toBe(0)
  })
})

describe('ship presets, delete and docking', () => {
  it('presets are valid, launchable and have usable delta-v', async () => {
    const { SHIP_PRESETS } = await import('../game/data')
    const { validateDesign, designCost, deleteVessel, dockCandidate, dockVessels, decouple } = await import('./world')
    const { isConnected: conn, estimateDeltaV: dvOf, vesselStats: stats } = await import('../game/vessel')
    const gs = newGame()
    for (const p of SHIP_PRESETS) {
      const full = p.id === 'atlas' ? 8 : 0
      const st = dvOf(p.design, full)
      console.log(p.name, designCost(p.design, {}), st.map((s) => `${s.dv.toFixed(0)}@${s.twr.toFixed(2)}`))
      expect(validateDesign(p.design, {}, gs)).toBeNull()
      expect(conn(p.design)).toBe(true)
      expect(st[0]!.twr).toBeGreaterThan(1.2)
      expect(st.reduce((a, s) => a + s.dv, 0)).toBeGreaterThan(p.id === 'atlas' ? 3900 : 5000)
      expect(designCost(p.design, {})).toBeLessThan(40000)
    }
    // sil + kenetlen
    const sim: Sim = { gs, warpIdx: 0, firing: new Map() }
    expect(launchDesign(sim)).toBeNull()
    const a = activeVessel(gs)!
    a.landed = false
    a.pos = { x: 0, y: BODIES.earth.radius + 60_000 }
    a.vel = { x: -1600, y: 0 }
    const ev = stageNext(sim, a)
    expect(ev.length).toBe(1)
    expect(gs.vessels.length).toBe(3)
    const booster = gs.vessels.find((v) => v.id !== a.id)!
    expect(dockCandidate(gs, a)).not.toBeNull()
    const partsBefore = a.parts.length + booster.parts.length
    dockVessels(sim, a, booster)
    expect(gs.vessels.length).toBe(2)
    expect(a.parts.length).toBe(partsBefore + 1)
    expect(conn(a.parts)).toBe(true)
    expect(stats(a.parts).hasCommand).toBe(true)
    // adaptörle yeniden ayrılabilir
    const dec = a.parts.findIndex((p) => p.def === 'decoupler' && p.y === Math.min(...a.parts.filter((q) => q.def === 'decoupler').map((q) => q.y)))
    decouple(sim, a, [dec])
    expect(gs.vessels.length).toBe(3)
    const other = gs.vessels.find((v) => v.id !== a.id)!
    expect(deleteVessel(sim, other.id)).toBe(true)
    expect(gs.vessels.length).toBe(2)
    expect(deleteVessel(sim, a.id)).toBe(true)
    expect(gs.activeId).not.toBe(a.id)
  })
})

describe('economy balance & controlled rotation', () => {
  it('caps passive income warp scaling and escalates duplicate Earth module prices', () => {
    expect(effectiveIncomeDt(1, 1)).toBeCloseTo(1, 4)
    expect(effectiveIncomeDt(1, 100_000)).toBeLessThanOrEqual(5)

    // 100.000× yörünge hızlandırması pasif geliri sömürmemeli (en fazla 5× hızlanır: 1 sn -> 5/60 dk)
    const sim: Sim = { gs: newGame(), warpIdx: WARPS.length - 1, firing: new Map() }
    const m0 = sim.gs.money
    for (let i = 0; i < 20; i += 1) stepWorld(sim, 0.05, ctrl)
    const gained = sim.gs.money - m0
    expect(gained).toBeCloseTo((totalPassiveIncomePerMin(sim.gs) * 5) / 60, 1)

    // Aynı Dünya modülünü tekrar eklemek giderek pahalanmalı
    const firstTelCost = earthModuleCost(sim.gs, 'telemetry')
    sim.gs.bases.earth!.modules.telemetry = 3
    expect(earthModuleCost(sim.gs, 'telemetry')).toBeGreaterThan(firstTelCost)
  })

  it('keeps manual turning controlled even at 25x physics warp', () => {
    const setupOrbit = () => {
      const gs = newGame()
      const parts = freshParts([
        { def: 'probe', x: 6, y: 10 },
        { def: 'tank-m', x: 6, y: 11 },
        { def: 'frontier', x: 6, y: 13 },
      ])
      const r = BODIES.earth.radius + 80_000
      gs.vessels.push({
        id: 1,
        name: 'SpinTest',
        parts,
        bodyId: 'earth',
        pos: { x: 0, y: r },
        vel: { x: -1600, y: 0 },
        angle: Math.PI / 2,
        angVel: 0,
        landed: false,
        throttle: 1,
        ec: 60,
        cargo: { modules: {}, ore: 0, oreFrom: null },
        rcsOn: false,
        sas: 'off',
        visited: ['earth'],
        assist: null,
        dvUsed: 0,
      })
      gs.activeId = 1
      return gs
    }

    const sim1: Sim = { gs: setupOrbit(), warpIdx: 0, firing: new Map() }
    const sim25: Sim = { gs: setupOrbit(), warpIdx: PHYSICS_WARP_MAX_IDX, firing: new Map() }
    const turnCtrl = { rotate: 1, tx: 0, ty: 0 }
    for (let i = 0; i < 12; i += 1) {
      stepWorld(sim1, 1 / 60, turnCtrl)
      stepWorld(sim25, 1 / 60, turnCtrl)
    }
    const delta1 = Math.abs(wrapPi(sim1.gs.vessels[0]!.angle - Math.PI / 2))
    const delta25 = Math.abs(wrapPi(sim25.gs.vessels[0]!.angle - Math.PI / 2))
    expect(delta1).toBeGreaterThan(0.01)
    expect(delta1).toBeLessThan(0.35)
    expect(delta25).toBeLessThan(0.35)
    expect(Math.abs(delta25 - delta1)).toBeLessThan(0.05)
  })
})

describe('colony power & inverse-square law', () => {
  it('one solar panel runs a mining rover on the Moon but not on Mars', () => {
    const mk = () => {
      const b = emptyBase(0)
      b.sites = ['solar-farm', 'drill', null, null, null, null, null, null]
      syncModules(b)
      return b
    }
    const moon = baseReport(mk(), solarFlux(BODIES.earth.orbit!.a))
    expect(moon.unpowered).toBe(0)
    expect(moon.orePerMin).toBeGreaterThan(0)
    const flux = solarFlux(BODIES.mars.orbit!.a)
    expect(flux).toBeGreaterThan(0.4)
    expect(flux).toBeLessThan(0.46)
    const mars = baseReport(mk(), flux)
    expect(mars.unpowered).toBe(1)
    expect(mars.orePerMin).toBe(0)
    const two = mk()
    two.sites![2] = 'solar-farm'
    expect(baseReport(two, flux).unpowered).toBe(0)
  })

  it('unlocks later buildings as the colony grows and builds from delivered stock for free', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    const gs = sim.gs
    expect(colonyTier(gs.bases.earth)).toBe(1)
    // Dünya'da yalnızca yer tesisleri kurulur
    expect(placePlanetModule(sim, 'earth', 3, 'habitat')).not.toBeNull()
    expect(placePlanetModule(sim, 'earth', 3, 'biodome')).not.toBeNull()
    expect(placePlanetModule(sim, 'earth', 3, 'battery')).toBeNull()
    expect(placePlanetModule(sim, 'earth', 4, 'lab')).toBeNull()
    expect(placePlanetModule(sim, 'earth', 4, 'lab')).not.toBeNull()
    // uzay kolonisinde kademe kuralı sürer
    const m2 = emptyBase(0)
    gs.bases.mars = m2
    expect(placePlanetModule(sim, 'mars', 0, 'lab')).not.toBeNull()
    expect(colonyTier(m2)).toBe(1)
    expect(placePlanetModule(sim, 'moon', 0, 'solar-farm')).not.toBeNull()
    const moon = emptyBase(0)
    moon.stock = { 'solar-farm': 1 }
    gs.bases.moon = moon
    const m0 = gs.money
    expect(placePlanetModule(sim, 'moon', 0, 'solar-farm')).toBeNull()
    expect(gs.money).toBe(m0)
    expect(moon.stock['solar-farm']).toBe(0)
  })
})

describe('auto-orbit, auto-transfer & proximity warning', () => {
  it('auto-orbits from Earth pad then auto-transfers to Moon SOI with proximity warning when auto-land is locked', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000

    const launchErr = launchDesign(sim)
    expect(launchErr).toBeNull()
    let v = activeVessel(sim.gs)!
    expect(v.landed).toBe(true)

    // 1. One-click orbit autopilot from Earth launchpad (1x physics dt capped at 0.05s)
    const orbitErr = setVesselAutopilot(sim, v, 'orbit')
    expect(orbitErr).toBeNull()
    sim.warpIdx = 7 // oyuncu hızlı zaman seçer; otopilot 500 m altında 1×'e kilitler

    let reachedOrbit = false
    for (let i = 0; i < 16000; i += 1) {
      stepWorld(sim, 0.05, ctrl)
      v = activeVessel(sim.gs)!
      if (sim.gs.missionsDone.includes('earth-orbit') && v.autopilot === 'off') {
        reachedOrbit = true
        break
      }
    }
    expect(reachedOrbit).toBe(true)
    const orbitEl = elementsFromState(v.pos, v.vel, BODIES.earth.mu)
    expect(orbitEl.e).toBeLessThan(1)
    expect(orbitEl.rp - BODIES.earth.radius).toBeGreaterThan(BODIES.earth.atmoHeight)

    // 2. Select Moon as target and engage auto-transfer
    sim.gs.targetBody = 'moon'
    const transferErr = setVesselAutopilot(sim, v, 'transfer')
    expect(transferErr).toBeNull()
    sim.warpIdx = 7

    let arrived = false
    let captured = false
    for (let i = 0; i < 90000; i += 1) {
      const evs = stepWorld(sim, 0.05, ctrl)
      v = activeVessel(sim.gs)!
      if (!v) throw new Error('vessel lost: ' + JSON.stringify(evs))
      if (evs.some((e) => e.type === 'toast' && e.text.includes('hedefine ulaşıldı'))) arrived = true
      if (v.bodyId === 'moon' && v.landed) {
        captured = true
        break
      }
    }
    expect(v.bodyId).toBe('moon')
    expect(arrived).toBe(true)
    // varışta otopilot yörüngeye oturmadan doğrudan yüzeye iner
    expect(captured).toBe(true)
  }, 60_000)

  it('auto-transfers directly from Earth base pad to Moon without clicking orbit first', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    let v = activeVessel(sim.gs)!
    expect(v.landed).toBe(true)

    sim.gs.targetBody = 'moon'
    expect(setVesselAutopilot(sim, v, 'transfer')).toBeNull()
    sim.warpIdx = 7
    expect(v.throttle).toBe(1)

    let liftedOff = false
    let coastedAtHighWarp = false
    let arrived = false
    for (let i = 0; i < 40000; i += 1) {
      stepWorld(sim, 0.05, ctrl)
      v = activeVessel(sim.gs)!
      if (!v.landed) liftedOff = true
      if (sim.warpIdx > PHYSICS_WARP_MAX_IDX) coastedAtHighWarp = true
      if (v.bodyId === 'moon' && v.approachWarn === 'moon') {
        arrived = true
        break
      }
    }

    expect(liftedOff).toBe(true)
    expect(coastedAtHighWarp).toBe(true)
    expect(arrived).toBe(true)
    expect(sim.gs.missionsDone).toContain('earth-orbit')
    expect(sim.gs.missionsDone).toContain('moon-soi')
    expect(sim.warpIdx).toBe(7) // varışta oyuncunun seçtiği hız korunur
  }, 30_000)

  it('auto-transfers directly from Moon surface back to Earth SOI', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    const parts = freshParts([
      { def: 'probe', x: 6, y: 8 },
      { def: 'tank-xl', x: 6, y: 10 },
      { def: 'frontier', x: 6, y: 14 },
    ])
    const st = vesselStats(parts)
    const r = BODIES.moon.radius + terrainHeight('moon', 0) + (st.maxY - st.comY)
    sim.gs.vessels.push({
      id: 1,
      name: 'LunarReturn',
      parts,
      bodyId: 'moon',
      pos: { x: r, y: 0 },
      vel: { x: 0, y: 0 },
      angle: 0,
      angVel: 0,
      landed: true,
      throttle: 0,
      ec: 100,
      cargo: { modules: {}, ore: 0, oreFrom: null },
      rcsOn: false,
      sas: 'off',
      visited: ['moon'],
      assist: null,
      dvUsed: 0,
    })
    sim.gs.activeId = 1
    sim.gs.targetBody = 'earth'

    let v = activeVessel(sim.gs)!
    expect(setVesselAutopilot(sim, v, 'transfer')).toBeNull()
    sim.warpIdx = 7
    expect(v.throttle).toBe(1)

    let arrivedEarth = false
    for (let i = 0; i < 30000; i += 1) {
      stepWorld(sim, 0.05, ctrl)
      v = activeVessel(sim.gs)!
      if (v.bodyId === 'earth' && v.approachWarn === 'earth') {
        arrivedEarth = true
        break
      }
    }
    expect(arrivedEarth).toBe(true)
    expect(v.autopilot).toBe('land') // hedefe git: doğrudan yüzeye iniş
  }, 30_000)
})

describe('multiplayer-ready dispatchCommand & ownerId isolation', () => {
  it('enforces vessel ownership boundaries while executing deterministic serializable commands', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.ownerId = 'alice'
    sim.gs.money = 50_000
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    expect(v.ownerId).toBe('alice')
    expect(canControlVessel(v, 'alice')).toBe(true)
    expect(canControlVessel(v, 'bob')).toBe(false)

    // Bob cannot hijack Alice's vessel
    const bobRes = dispatchCommand(sim, { type: 'setAutopilot', vesselId: v.id, mode: 'orbit' }, 'bob')
    expect(bobRes.error).toBeTruthy()
    expect(v.autopilot).toBe('off')

    // Alice can dispatch commands and deterministic tick counter advances on world step
    const tickBefore = sim.gs.tick ?? 0
    const targetRes = dispatchCommand(sim, { type: 'setTarget', bodyId: 'moon' }, 'alice')
    expect(targetRes.error).toBeUndefined()
    expect(sim.gs.targetBody).toBe('moon')


    const apRes = dispatchCommand(sim, { type: 'setAutopilot', vesselId: v.id, mode: 'orbit' }, 'alice')
    expect(apRes.error).toBeUndefined()
    expect(v.autopilot).toBe('orbit')

    stepWorld(sim, 0.05, ctrl)
    expect((sim.gs.tick ?? 0)).toBeGreaterThan(tickBefore)
  })
})

describe('ISS, break-up and easter eggs', () => {
  it('spawns the ISS, rendezvous + docking delivers supplies and pays out', async () => {
    const { ensureStation, rendezvousStation, dockCandidate, dockVessels, isStationVessel, deleteVessel } = await import('./world')
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    const gs = sim.gs
    gs.money = 100_000
    gs.designCargo = { 'iss-supplies': 2 }
    expect(launchDesign(sim)).toBeNull()
    ensureStation(gs)
    const iss = gs.vessels.find(isStationVessel)!
    expect(iss.station).toBe(true)
    expect(deleteVessel(sim, iss.id)).toBe(false)
    const v = activeVessel(gs)!
    expect(rendezvousStation(sim, v)).not.toBeNull() // rampada olmaz
    const r = BODIES.earth.radius + 50_000
    v.landed = false
    v.pos = { x: 0, y: r }
    v.vel = { x: -Math.sqrt(BODIES.earth.mu / r), y: 0 }
    const fuel0 = vesselStats(v.parts).fuel
    expect(rendezvousStation(sim, v)).toBeNull()
    expect(vesselStats(v.parts).fuel).toBeLessThan(fuel0)
    expect(dockCandidate(gs, v)?.id).toBe(iss.id)
    const money0 = gs.money
    dockVessels(sim, v, iss)
    expect(gs.missionsDone).toContain('iss-dock')
    expect(gs.missionsDone).toContain('iss-cargo')
    expect(gs.money).toBeGreaterThan(money0 + 2 * 4500)
    expect(v.cargo.modules['iss-supplies']).toBeUndefined()
    expect(isConnected(v.parts)).toBe(true)
    // istasyon kenetliyken yenisi doğmaz
    ensureStation(gs)
    expect(gs.vessels.filter(isStationVessel).length).toBe(1)
  })

  it('breaks apart piece by piece on a hard crash and survives a mild one', () => {
    const run = (speed: number, height = 40) => {
      const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
      sim.gs.money = 100_000
      expect(launchDesign(sim)).toBeNull()
      const v = activeVessel(sim.gs)!
      const n0 = v.parts.length
      v.landed = false
      v.pos = { x: 0, y: BODIES.earth.radius + vesselStats(v.parts).maxY - vesselStats(v.parts).comY + height }
      v.vel = { x: 0, y: -speed }
      let booms = 0
      let crashed = false
      let sawPartial = false
      for (let i = 0; i < 600; i += 1) {
        const ev = stepWorld(sim, 0.05, ctrl)
        booms += ev.filter((e) => e.type === 'explosion').length
        if (ev.some((e) => e.type === 'crash' && e.wasActive)) crashed = true
        const cur = sim.gs.vessels.find((o) => o.id === v.id)
        void cur
        if (sim.gs.vessels.filter((o) => o.debris).length > 3) sawPartial = true
      }
      expect(sim.gs.vessels.some((o) => o.debris)).toBe(false) // tüm enkaz sonunda patlar
      return { booms, crashed, sawPartial, left: sim.gs.vessels.find((o) => o.id === v.id)?.parts.length ?? 0, n0 }
    }
    const hard = run(60)
    expect(hard.crashed).toBe(true)
    expect(hard.sawPartial).toBe(true)
    expect(hard.booms).toBeGreaterThan(10)
    const mild = run(22, 0.5)
    expect(mild.crashed).toBe(false)
    expect(mild.booms).toBeGreaterThan(0)
    expect(mild.left).toBeGreaterThan(0)
    expect(mild.left).toBeLessThan(mild.n0)
  })

  it('grants Margaret Hamilton on the first landing', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    v.landed = false
    v.pos = { x: 0, y: BODIES.earth.radius + vesselStats(v.parts).maxY - vesselStats(v.parts).comY + 2 }
    v.vel = { x: 0, y: -1 }
    let got = false
    for (let i = 0; i < 200; i += 1) if (stepWorld(sim, 0.05, ctrl).some((e) => e.type === 'achievement' && e.id === 'hamilton')) got = true
    expect(got).toBe(true)
    expect(sim.gs.achievements).toContain('hamilton')
  })

  it('hedefe git yörüngeye oturmadan doğrudan Ay yüzeyine iner, 1000 m altında 1×', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    let v = activeVessel(sim.gs)!
    sim.gs.targetBody = 'moon'
    expect(setVesselAutopilot(sim, v, 'transfer')).toBeNull()
    let frames = 0
    let sawOrbitAtMoon = false
    let sawLand = false
    for (; frames < 20_000; frames += 1) {
      stepWorld(sim, 1 / 60, ctrl)
      v = activeVessel(sim.gs)!
      if (v.bodyId === 'moon' && v.autopilot === 'orbit') sawOrbitAtMoon = true
      if (v.autopilot === 'land') sawLand = true
      if (v.bodyId === 'moon' && v.autopilot === 'land') {
        const alt = Math.hypot(v.pos.x, v.pos.y) - BODIES.moon.radius - terrainHeight('moon', Math.atan2(v.pos.y, v.pos.x))
        if (alt < 900) expect(sim.warpIdx).toBe(0) // Dünya dışında 1000 m altı 1×
      }
      if (v.landed && v.bodyId === 'moon') break
    }
    expect(sawOrbitAtMoon).toBe(false)
    expect(sawLand).toBe(true)
    expect(v.bodyId).toBe('moon')
    expect(v.landed).toBe(true)
    expect(frames / 60).toBeLessThan(150) // gerçek saniye
  }, 90_000)

  it('otopilot 500 m altında 1×, üstünde oyuncunun seçtiği hız', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    let v = activeVessel(sim.gs)!
    sim.gs.targetBody = 'moon'
    expect(setVesselAutopilot(sim, v, 'transfer')).toBeNull()
    sim.warpIdx = 7
    stepWorld(sim, 0.05, ctrl)
    expect(sim.warpIdx).toBe(0)
    let alt = 0
    for (let i = 0; i < 4000 && alt < 2000; i += 1) {
      stepWorld(sim, 0.05, ctrl)
      v = activeVessel(sim.gs)!
      alt = Math.hypot(v.pos.x, v.pos.y) - BODIES.earth.radius
      if (alt < 450) expect(sim.warpIdx).toBe(0)
    }
    expect(alt).toBeGreaterThan(2000)
    expect(sim.warpIdx).toBe(7)
  })

  it('su kulesi yalnızca roket 30 sn boyunca 50 m altında ateşlerse uçar', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    // Normal kalkış: kule yerinde kalır.
    v.throttle = 1
    for (let i = 0; i < 400 && Math.hypot(v.pos.x, v.pos.y) - BODIES.earth.radius < 300; i += 1) stepWorld(sim, 0.05, ctrl)
    expect(sim.towerGone).toBeFalsy()
    // Rampada alçakta oyalanma: motor açık, roket 50 m altında tutulur.
    const sim2: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim2.gs.money = 100_000
    expect(launchDesign(sim2)).toBeNull()
    const w = activeVessel(sim2.gs)!
    let flew = false
    for (let i = 0; i < 700 && !flew; i += 1) {
      w.throttle = 0.3
      const r = Math.hypot(w.pos.x, w.pos.y)
      if (r - BODIES.earth.radius > 20) {
        w.pos = { x: (w.pos.x / r) * (BODIES.earth.radius + 20), y: (w.pos.y / r) * (BODIES.earth.radius + 20) }
        w.vel = { x: 0, y: 0 }
      }
      if (stepWorld(sim2, 0.05, ctrl).some((e) => e.type === 'achievement' && e.id === 'water-tower')) flew = true
      if (i === 500) expect(flew).toBe(false)
    }
    expect(flew).toBe(true)
  })

  it('istasyonu seçmek görev tamamlamaz', async () => {
    const { ensureStation, isStationVessel } = await import('./world')
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    ensureStation(sim.gs)
    const iss = sim.gs.vessels.find(isStationVessel)!
    sim.gs.activeId = iss.id
    stepWorld(sim, 0.1, ctrl)
    expect(sim.gs.missionsDone.length).toBe(0)
  })
})

describe('multiplayer colony race', () => {
  const twoPlayerSim = (targetPlanets = 3): Sim => {
    const gs = newMultiplayerGame(
      'TEST',
      'p1',
      [
        { id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 },
        { id: 'p2', username: 'Ali', color: '#fb7185', slot: 1 },
      ],
      { targetPlanets, startingMoney: 100_000 },
    )
    gs.mp!.started = true
    return { gs, warpIdx: 0, firing: new Map() }
  }

  it('gives each player an isolated Earth launchpad, wallet and vessel control', () => {
    const sim = twoPlayerSim()
    const p1Before = sim.gs.mp!.players.p1.money
    const p2Before = sim.gs.mp!.players.p2.money

    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p2').error).toBeUndefined()

    const v1 = sim.gs.vessels.find((v) => v.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((v) => v.ownerId === 'p2')!
    expect(v1).toBeTruthy()
    expect(v2).toBeTruthy()
    expect(len({ x: v1.pos.x - v2.pos.x, y: v1.pos.y - v2.pos.y })).toBeGreaterThan(100)
    expect(Math.abs(Math.atan2(v1.pos.y, v1.pos.x) - padAngleForSlot(0))).toBeLessThan(1e-5)
    expect(Math.abs(Math.atan2(v2.pos.y, v2.pos.x) - padAngleForSlot(1))).toBeLessThan(1e-5)

    // Bütçeler ayrıdır: ikisinin de harcaması yalnızca kendi kasasından düşer
    expect(sim.gs.mp!.players.p1.money).toBeLessThan(p1Before)
    expect(sim.gs.mp!.players.p2.money).toBeLessThan(p2Before)

    // Oyuncular birbirinin roketini kontrol edemez veya kademe ayıramaz
    const v1Parts = v1.parts.length
    expect(canControlVessel(v1, 'p1')).toBe(true)
    expect(canControlVessel(v1, 'p2')).toBe(false)
    dispatchCommand(sim, { type: 'setActive', vesselId: v1.id }, 'p2')
    expect(sim.gs.mp!.players.p2.activeVesselId).toBe(v2.id)
    expect(dispatchCommand(sim, { type: 'stage', vesselId: v1.id }, 'p2').error).toBe('Bu araç başka bir oyuncuya ait.')
    expect(dispatchCommand(sim, { type: 'stage', vesselId: v2.id }, 'p2').error).toBeUndefined()
    expect(v1.parts.length).toBe(v1Parts)
  })

  it('arcade: uzayda "hedefe git" yakıtı düşüp hedefin atmosfer sınırına hızla götürür', async () => {
    const { arcadeArrivalRadius, arcadeDeltaV } = await import('./world')
    const sim = twoPlayerSim()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    const v = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    // Yerdeyken hızlı yolculuk başlamaz (önce uzaya çıkılmalı)
    sim.gs.mp!.players.p1.targetBody = 'moon'
    v.targetBody = 'moon'
    expect(dispatchCommand(sim, { type: 'setAutopilot', vesselId: v.id, mode: 'transfer' }, 'p1').error).toBeUndefined()
    stepWorld(sim, 0.05, new Map())
    expect(v.cruise).toBeUndefined()
    // Dünya yörüngesine koy
    const r = BODIES.earth.radius + BODIES.earth.atmoHeight + 30_000
    v.landed = false
    v.pos = { x: r, y: 0 }
    v.vel = { x: 0, y: Math.sqrt(BODIES.earth.mu / r) }
    v.autopilot = 'transfer'
    const dvNeed = arcadeDeltaV(v, 'moon')
    expect(dvNeed).toBeGreaterThan(300)
    expect(dvNeed).toBeLessThan(3000)
    const fuelBefore = v.parts.reduce((a, p) => a + (p.fuel ?? 0), 0)
    const evs = stepWorld(sim, 0.05, new Map())
    expect(v.cruise).toBeTruthy()
    expect(evs.some((e) => e.type === 'toast' && e.ownerId === 'p1')).toBe(true)
    expect(v.parts.reduce((a, p) => a + (p.fuel ?? 0), 0)).toBeLessThan(fuelBefore)
    let arrived = false
    for (let i = 0; i < 400 && !arrived; i += 1) {
      const e = stepWorld(sim, 0.05, new Map())
      if (e.some((x) => x.type === 'toast' && x.text.includes('Hedefe varıldı'))) arrived = true
    }
    expect(arrived).toBe(true)
    expect(v.bodyId).toBe('moon')
    expect(v.cruise).toBeUndefined()
    expect(len(v.pos)).toBeCloseTo(arcadeArrivalRadius('moon'), -2)
    expect(v.autopilot).toBe('off')
    // Varışta normal hızda sabit bir yörüngededir
    const el = elementsFromState(v.pos, v.vel, BODIES.moon.mu)
    expect(el.e).toBeLessThan(0.05)
  })

  it('arcade: yakıt yetmezse yolculuk başlamaz ve oyuncuya söylenir', () => {
    const sim = twoPlayerSim()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    const v = sim.gs.vessels.find((o) => o.ownerId === 'p1')!
    sim.gs.mp!.players.p1.targetBody = 'mars'
    v.targetBody = 'mars'
    for (const p of v.parts) if (p.fuel !== undefined) p.fuel = 0.05
    const r = BODIES.earth.radius + BODIES.earth.atmoHeight + 30_000
    v.landed = false
    v.pos = { x: r, y: 0 }
    v.vel = { x: 0, y: Math.sqrt(BODIES.earth.mu / r) }
    v.autopilot = 'transfer'
    const evs = stepWorld(sim, 0.05, new Map())
    expect(v.cruise).toBeUndefined()
    expect(v.autopilot).toBe('off')
    expect(evs.some((e) => e.type === 'toast' && e.text.includes('gerekli'))).toBe(true)
  })

  it('istemcinin burun yönü ev sahibinde bir kez uygulanır', () => {
    const sim = twoPlayerSim()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p2').error).toBeUndefined()
    const v = sim.gs.vessels.find((o) => o.ownerId === 'p2')!
    const r = BODIES.earth.radius + 200_000
    v.landed = false
    v.pos = { x: r, y: 0 }
    v.vel = { x: 0, y: Math.sqrt(BODIES.earth.mu / r) }
    const ctrlMap = new Map<string, Controls>([['p2', { rotate: 0, tx: 0, ty: 0, vid: v.id, angle: 1.234, angVel: 0 }]])
    stepWorld(sim, 0.02, ctrlMap)
    expect(v.angle).toBeCloseTo(1.234, 2)
    expect(ctrlMap.get('p2')!.applied).toBe(true)
    v.angle = 0
    stepWorld(sim, 0.02, ctrlMap)
    expect(v.angle).toBeCloseTo(0, 2)
  })

  it('dynamically speeds up time while coasting and slams down on close approach or manual thrust', () => {
    const sim = twoPlayerSim()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p2').error).toBeUndefined()

    const v1 = sim.gs.vessels.find((v) => v.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((v) => v.ownerId === 'p2')!
    const r = BODIES.earth.radius + 90_000
    const vCirc = Math.sqrt(BODIES.earth.mu / r)
    v1.landed = false
    v1.pos = { x: r, y: 0 }
    v1.vel = { x: 0, y: vCirc }
    v2.landed = false
    v2.pos = { x: -r, y: 0 }
    v2.vel = { x: 0, y: -vCirc }

    // Güvenli yörüngede süzülüp hızlandırma talep edildiğinde (kalkış sonrası 2.2 sn koruma bitince) zaman yükselir
    expect(dispatchCommand(sim, { type: 'setWarpPref', warpIdx: 6 }, 'p1').error).toBeUndefined()
    const emptyCtrls = new Map<string, typeof ctrl>()
    for (let i = 0; i < 80; i += 1) stepWorld(sim, 0.05, emptyCtrls)
    expect(sim.warpIdx).toBeGreaterThan(2)
    expect(WARPS[sim.warpIdx]).toBeGreaterThanOrEqual(10)

    // Elle itki uygulandığında zaman fizik hızlandırma sınırının üstüne çıkamaz / anında düşer
    const burnCtrls = new Map<string, typeof ctrl>([['p1', { rotate: 0, tx: 0, ty: 1 }]])
    stepWorld(sim, 0.05, burnCtrls)
    expect(sim.warpIdx).toBeLessThanOrEqual(PHYSICS_WARP_MAX_IDX)

    // Hızlı konumda iki oyuncu roketi < 3 km mesafeye girince anında 1x'e düşer
    let ramped = computeDynamicWarp(sim.gs, 5, 10, 0.05, 10, emptyCtrls, new Map())
    expect(ramped.warpIdx).toBeGreaterThanOrEqual(4)
    v2.pos = { x: v1.pos.x, y: v1.pos.y + 2_000 }
    v2.vel = { x: v1.vel.x, y: v1.vel.y }
    ramped = computeDynamicWarp(sim.gs, ramped.warpIdx, ramped.rampTimer, 0.05, 10.1, emptyCtrls, new Map())
    expect(ramped.warpIdx).toBe(0)
    expect(WARPS[ramped.warpIdx]).toBe(1)
  })

  it('shatters rockets on high-speed collisions (no bounty) and leaves gentle bumps intact', () => {
    const sim = twoPlayerSim()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    expect(
      dispatchCommand(
        sim,
        {
          type: 'launch',
          design: [
            { def: 'probe', x: 6, y: 2 },
            { def: 'tank-s', x: 6, y: 3 },
            { def: 'kolibri', x: 6, y: 4 },
          ],
        },
        'p2',
      ).error,
    ).toBeUndefined()

    const v1 = sim.gs.vessels.find((v) => v.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((v) => v.ownerId === 'p2')!
    const r = BODIES.earth.radius + 50_000
    v1.noCollideUntil = 0
    v2.noCollideUntil = 0

    // Yumuşak dokunuş (< 3.5 m/s): iki gemi de parçalanmaz
    v1.landed = false
    v2.landed = false
    v1.pos = { x: r, y: 0 }
    v1.vel = { x: 0, y: 1.0 }
    v2.pos = { x: r, y: 1.5 }
    v2.vel = { x: 0, y: -1.0 }
    const mildEvents = stepWorld(sim, 0.05, new Map())
    expect(mildEvents.some((e) => e.type === 'kill')).toBe(false)
    expect(sim.gs.vessels.find((v) => v.id === v2.id)?.parts.length).toBe(3)

    // Yüksek hızda çarpışma (~140 m/s): hafif gemi uzayda parçalanır (çarpışma ve patlama kalır), ödül/puan yok
    const p1MoneyBefore = sim.gs.mp!.players.p1.money
    v1.noCollideUntil = 0
    v2.noCollideUntil = 0
    v1.pos = { x: r, y: -3 }
    v1.vel = { x: 0, y: 70 }
    v2.pos = { x: r, y: 3 }
    v2.vel = { x: 0, y: -70 }
    const ramEvents = stepWorld(sim, 0.05, new Map())
    expect(ramEvents.some((e) => e.type === 'kill')).toBe(false)
    // Gemi artık bütün hâlde yok olmaz: komutası ezilince kontrolsüz enkaza dönüşür.
    expect(sim.gs.vessels.some((v) => v.id === v2.id && !v.debris)).toBe(false)
    expect(sim.gs.mp!.players.p1.kills).toBe(0)
    expect(sim.gs.mp!.players.p1.money).toBeLessThan(p1MoneyBefore + 100) // yalnızca pasif gelir, ödül yok
  })

  it('yükle/indir: kargodan tek tür indirilir, depodaki yapı gemiye geri alınır', async () => {
    const { deployModules, pickupModule } = await import('./world')
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    v.bodyId = 'moon'
    v.landed = true
    v.cargo.modules = { 'solar-farm': 2, habitat: 1 }
    expect(deployModules(sim, v, 'habitat')).toBeNull()
    expect(v.cargo.modules).toEqual({ 'solar-farm': 2 })
    const moon = sim.gs.bases.moon!
    expect(moon.modules.habitat).toBe(1)
    moon.stock = { battery: 1 }
    expect(pickupModule(sim, v, 'battery')).toBeNull()
    expect(v.cargo.modules.battery).toBe(1)
    expect(moon.stock.battery).toBe(0)
    expect(pickupModule(sim, v, 'battery')).not.toBeNull()
  })

  it('uzay kolonisinde istasyon aktifken doğrudan krediyle inşa açılır, istasyon yoksa yalnızca kargo çalışır', async () => {
    const { colonyStationStatus, isBodyColonized, MODULE_BY_ID } = await import('../game/base')
    const { removePlanetModule } = await import('./world')
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    const moon = emptyBase(Math.PI / 2)
    sim.gs.bases.moon = moon
    const flux = solarFlux(BODIES.earth.orbit!.a)

    // İstasyon veya stok olmadan yapı parayla kurulamaz
    expect(placePlanetModule(sim, 'moon', 0, 'solar-farm')).not.toBeNull()
    expect(sim.gs.money).toBe(100_000)

    // Kargodan gelenler kurulur, para harcanmaz
    moon.stock = { 'solar-farm': 2, 'colony-station': 1 }
    expect(placePlanetModule(sim, 'moon', 0, 'solar-farm')).toBeNull()
    expect(placePlanetModule(sim, 'moon', 1, 'colony-station')).toBeNull()
    expect(colonyStationStatus(moon, flux)).toBe('unpowered')
    expect(placePlanetModule(sim, 'moon', 2, 'solar-farm')).toBeNull()
    expect(isBodyColonized(moon, flux)).toBe(true)
    expect(sim.gs.money).toBe(100_000)

    // İstasyon aktif olunca bu çeyrekte krediyle doğrudan bina inşa edilebilir!
    expect(placePlanetModule(sim, 'moon', 3, 'habitat')).toBeNull()
    expect(sim.gs.money).toBe(100_000 - MODULE_BY_ID.habitat!.cost)

    // Sökülen yapı depoya döner ve yeniden ücretsiz kurulabilir
    expect(removePlanetModule(sim, 'moon', 0).error).toBeUndefined()
    expect(moon.stock['solar-farm']).toBe(1)
    expect(placePlanetModule(sim, 'moon', 4, 'solar-farm')).toBeNull()
    expect(sim.gs.money).toBe(100_000 - MODULE_BY_ID.habitat!.cost)
  })


  it('captures neutral planets by building powered Space Stations, contests/neutralizes rivals, and declares victory', async () => {
    const { deployModules } = await import('./world')
    const sim = twoPlayerSim(2)
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p2').error).toBeUndefined()
    const v1 = sim.gs.vessels.find((v) => v.ownerId === 'p1')!
    const v2 = sim.gs.vessels.find((v) => v.ownerId === 'p2')!

    const placeLanded = (v: typeof v1, bodyId: 'moon' | 'mars', angle: number) => {
      const b = BODIES[bodyId]
      const h = terrainHeight(bodyId, angle)
      const rr = b.radius + h + 2
      v.bodyId = bodyId
      v.landed = true
      v.pos = { x: Math.sin(angle) * rr, y: Math.cos(angle) * rr }
      v.vel = { x: 0, y: 0 }
    }

    // 1) Ada Ay'a iner ama Uzay İstasyonu kurmadan gezegen kolonileşmez
    placeLanded(v1, 'moon', 0)
    const ev1: ReturnType<typeof stepWorld> = []
    stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.captures.moon!.ownerId).toBeNull()
    expect(sim.gs.mp!.captures.moon!.phase).toBe('claiming')

    // Tek güneş paneliyle Uzay İstasyonu güçsüz kalır → henüz kolonileşmez
    v1.cargo.modules = { 'colony-station': 1, 'solar-farm': 1 }
    expect(deployModules(sim, v1)).toBeNull()
    stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.captures.moon!.ownerId).toBeNull()

    // 2. panelle güç sağlanınca Ada Ay'ı kolonileştirir!
    v1.cargo.modules = { 'solar-farm': 1 }
    expect(deployModules(sim, v1)).toBeNull()
    stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.captures.moon!.ownerId).toBe('p1')
    expect(sim.gs.mp!.captures.moon!.phase).toBe('captured')
    expect(sim.gs.mp!.players.p1.planetsHeld).toBe(1)
    expect(sim.gs.mp!.players.p1.captures).toBe(1)
    expect(ev1.some((e) => e.type === 'capture' && e.bodyId === 'moon' && e.ownerId === 'p1')).toBe(true)

    // 2) Ali aynı anda Ay'a indiğinde savunma varken çatışma (contested) başlar
    placeLanded(v2, 'moon', 0.05)
    stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.captures.moon!.phase).toBe('contested')
    expect(sim.gs.mp!.captures.moon!.ownerId).toBe('p1')

    // 3) Ada'nın gemisi yok edilince Ali 5 sn içinde Ada'nın Uzay İstasyonu'nu devre dışı bırakır
    sim.gs.vessels = sim.gs.vessels.filter((v) => v.id !== v1.id)
    for (let i = 0; i < 6; i += 1) stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.captures.moon!.ownerId).toBeNull()
    expect(sim.gs.mp!.players.p1.planetsHeld).toBe(0)
    expect(sim.gs.bases.moon!.modules['colony-station'] ?? 0).toBe(0)

    // Ali kendi Uzay İstasyonu'nu kurunca Ay'ı kolonileştirir
    v2.cargo.modules = { 'colony-station': 1 }
    expect(deployModules(sim, v2)).toBeNull()
    stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.captures.moon!.ownerId).toBe('p2')
    expect(sim.gs.mp!.players.p2.planetsHeld).toBe(1)
    expect(sim.gs.mp!.players.p2.captures).toBe(1)

    // 4) Ali Mars'a inip reaktörlü Uzay İstasyonu kurunca hedef (2 gezegen) tamamlanır ve zafer ilan edilir
    placeLanded(v2, 'mars', 0)
    v2.cargo.modules = { 'colony-station': 1, 'rtg-reactor': 1 }
    expect(deployModules(sim, v2)).toBeNull()
    stepPlanetCaptures(sim.gs, 1, ev1)
    expect(sim.gs.mp!.players.p2.planetsHeld).toBe(2)
    expect(sim.gs.mp!.players.p2.captures).toBe(2)
    expect(sim.gs.mp!.winnerId).toBe('p2')
    expect(ev1.some((e) => e.type === 'victory' && e.winnerId === 'p2')).toBe(true)
  })

  it('kompakt ağ anlık görüntüsü statik alanları sıyırıp geri yükler ve MP modunda ISS oluşturmaz', async () => {
    const { newMultiplayerGame } = await import('./multiplayerSim')
    const { buildCompactSnapshot, hydrateCompactSnapshot } = await import('./mpClient')
    const { ensureStation } = await import('./world')

    const gs = newMultiplayerGame('ROOM', 'p1', [
      { id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 },
      { id: 'p2', username: 'Ali', color: '#f97316', slot: 1 },
    ])
    gs.mp!.players.p2.money = 42_500
    gs.mp!.players.p2.targetBody = 'mars'

    ensureStation(gs)
    expect(gs.vessels.some((v) => v.station)).toBe(false)

    const hostSim: Sim = {
      gs,
      warpIdx: 1,
      warpRampTimer: 0,
      firing: new Map([[99, new Map([[0, 0.8]])]]),
      fx: [
        { kind: 'boom', bodyId: 'earth', x: 0, y: 0, size: 1, born: 0 },
        { kind: 'boom', bodyId: 'earth', x: 1, y: 1, size: 2, born: 8 },
      ],
      clock: 10,
    }

    const fullSnap = buildCompactSnapshot(hostSim, true)
    expect(fullSnap._omitStatic).toBeUndefined()
    expect(fullSnap._fx?.length).toBe(1)
    expect(fullSnap.mp?.players.p1.earthBase).toBeDefined()

    const clientFull = hydrateCompactSnapshot(
      JSON.parse(JSON.stringify(fullSnap)),
      null,
      'p2',
      [],
      {},
    )
    expect(clientFull.gs.money).toBe(42_500)
    expect(clientFull.gs.targetBody).toBe('mars')
    expect(clientFull.gs.mp?.players.p1.earthBase).toBeDefined()

    const slimSnap = buildCompactSnapshot(hostSim, false)
    expect(slimSnap._omitStatic).toBe(true)
    expect(slimSnap.mp?.players.p1.earthBase).toBeUndefined()
    expect(JSON.stringify(slimSnap).length).toBeLessThan(JSON.stringify(fullSnap).length)

    const clientSlim = hydrateCompactSnapshot(
      JSON.parse(JSON.stringify(slimSnap)),
      clientFull.gs,
      'p2',
      [],
      {},
    )
    expect(clientSlim.gs.bases).toEqual(clientFull.gs.bases)
    expect(clientSlim.gs.mp?.players.p1.earthBase).toBeDefined()
    expect(clientSlim.gs.mp?.players.p2.earthBase).toBeDefined()
    expect(clientSlim.warpIdx).toBe(1)
    expect(clientSlim.firing.get(99)?.get(0)).toBe(0.8)
  })
})

describe('auto-land orbital, mp stuck protection & fast-travel upgrades', () => {
  it('auto-land lands safely from circular Moon orbit and auto-stages spent stages', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 4, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    const origParts = v.parts.length
    // En alttaki kademe yakıtını neredeyse sıfıra çek (otomatik kademe ayırma tetiklensin)
    for (const p of v.parts) {
      if (p.y >= 10 && p.fuel !== undefined) p.fuel = 0.05
    }
    const r = BODIES.moon.radius + 20_000
    v.bodyId = 'moon'
    v.landed = false
    v.pos = { x: r, y: 0 }
    v.vel = { x: 0, y: Math.sqrt(BODIES.moon.mu / r) }
    v.angle = Math.PI / 2
    expect(setVesselAutopilot(sim, v, 'land')).toBeNull()

    let crashed = ''
    let steps = 0
    for (let i = 0; i < 6_000 && !v.landed && !crashed; i += 1) {
      steps = i + 1
      const evs = stepWorld(sim, 0.05, ctrl)
      const ce = evs.find((e) => e.type === 'crash' && (e.vesselId === v.id || e.name === v.name))
      if (ce && ce.type === 'crash') {
        const s = situation(v)
        crashed = `${ce.reason} alt=${s.alt.toFixed(1)} vr=${s.vr.toFixed(1)} spd=${s.speed.toFixed(1)} th=${v.throttle.toFixed(2)} parts=${v.parts.length}`
      }
    }
    expect(crashed).toBe('')
    expect(v.landed).toBe(true)
    expect(v.bodyId).toBe('moon')
    expect(v.parts.length).toBeLessThan(origParts)
    expect(sim.warpIdx).toBe(0)
    expect(steps * 0.05).toBeLessThan(35)
  })

  it('auto-land lands safely on Earth from high horizontal speed using engines and parachutes', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    sim.gs.money = 100_000
    expect(launchDesign(sim)).toBeNull()
    const v = activeVessel(sim.gs)!
    v.landed = false
    const r = BODIES.earth.radius + 32_000
    v.pos = { x: 0, y: r }
    v.vel = { x: 1400, y: 0 }
    v.angle = Math.PI
    // İki alt kademeyi uzayda ayırıp üst kademe (paraşüt + ayak + vakum motoru) ile alçalma
    stageNext(sim, v)
    stageNext(sim, v)
    expect(setVesselAutopilot(sim, v, 'land')).toBeNull()

    let crashed = ''
    for (let i = 0; i < 10_000 && !v.landed && !crashed; i += 1) {
      const evs = stepWorld(sim, 0.05, ctrl)
      const ce = evs.find((e) => e.type === 'crash' && (e.vesselId === v.id || e.name === v.name))
      if (ce && ce.type === 'crash') {
        const s = situation(v)
        crashed = `${ce.reason} alt=${s.alt.toFixed(1)} vr=${s.vr.toFixed(1)} spd=${s.speed.toFixed(1)} th=${v.throttle.toFixed(2)} parts=${v.parts.length}`
      }
    }
    expect(crashed).toBe('')
    if (!v.landed) {
      const s = situation(v)
      throw new Error(`Not landed after 500s: alt=${s.alt.toFixed(1)} vr=${s.vr.toFixed(1)} spd=${s.speed.toFixed(1)} th=${v.throttle.toFixed(2)} note=${v.autopilotNote} chute=${v.parts.some((p) => p.deployed)}`)
    }
    expect(v.landed).toBe(true)
    expect(v.bodyId).toBe('earth')
  })

  it('auto-land rescues low chaotic descent and lands fast from Mars orbit with warp', () => {
    // 1) Düşük irtifada yatay hızla yana sürüklenirken acil oto-iniş kurtarması
    const simLow: Sim = { gs: newGame(), warpIdx: 0, firing: new Map() }
    expect(launchDesign(simLow)).toBeNull()
    const vLow = activeVessel(simLow.gs)!
    stageNext(simLow, vLow)
    stageNext(simLow, vLow)
    const theta = 0.8
    const rLow = BODIES.moon.radius + terrainHeight('moon', theta) + 70
    vLow.bodyId = 'moon'
    vLow.landed = false
    vLow.pos = { x: Math.cos(theta) * rLow, y: Math.sin(theta) * rLow }
    vLow.vel = { x: -Math.sin(theta) * 22 - Math.cos(theta) * 14, y: Math.cos(theta) * 22 - Math.sin(theta) * 14 }
    vLow.angle = wrapPi(theta + Math.PI)
    expect(setVesselAutopilot(simLow, vLow, 'land')).toBeNull()
    for (let i = 0; i < 3000 && !vLow.landed; i += 1) {
      const evs = stepWorld(simLow, 0.05, ctrl)
      const ce = evs.find((e) => e.type === 'crash' && (e.vesselId === vLow.id || e.name === vLow.name))
      if (ce && ce.type === 'crash') throw new Error(`Low rescue crashed: ${ce.reason}`)
    }
    expect(vLow.landed).toBe(true)

    // 2) Mars yörüngesinden (20 km) 25×/10× zaman hızlandırmasıyla çok hızlı ve güvenli iniş
    const simMars: Sim = { gs: newGame(), warpIdx: 4, firing: new Map() }
    expect(launchDesign(simMars)).toBeNull()
    const vMars = activeVessel(simMars.gs)!
    stageNext(simMars, vMars)
    const mr = BODIES.mars.radius + 20_000
    vMars.bodyId = 'mars'
    vMars.landed = false
    vMars.pos = { x: mr, y: 0 }
    vMars.vel = { x: 0, y: Math.sqrt(BODIES.mars.mu / mr) }
    vMars.angle = Math.PI / 2
    expect(setVesselAutopilot(simMars, vMars, 'land')).toBeNull()
    simMars.warpIdx = 4
    let realSteps = 0
    for (let i = 0; i < 600 && !vMars.landed; i += 1) {
      realSteps = i + 1
      const evs = stepWorld(simMars, 0.05, ctrl)
      const ce = evs.find((e) => e.type === 'crash' && (e.vesselId === vMars.id || e.name === vMars.name))
      if (ce && ce.type === 'crash') throw new Error(`Mars orbit auto-land crashed: ${ce.reason}`)
    }
    expect(vMars.landed).toBe(true)
    // 25×/10×/4× kademeli iniş 30 gerçek saniyeden kısa sürer
    expect(realSteps * 0.05).toBeLessThan(30)
  })

  it('MP auto-land speeds up high up, drops to 1x near touchdown, and ships never freeze above physics warp', () => {
    const gs = newMultiplayerGame(
      'MP-FIX',
      'p1',
      [
        { id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 },
        { id: 'p2', username: 'Ali', color: '#fb7185', slot: 1 },
      ],
      { targetPlanets: 3, startingMoney: 100_000 },
    )
    gs.mp!.started = true
    const sim: Sim = { gs, warpIdx: 0, firing: new Map() }
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p2').error).toBeUndefined()

    const v1 = gs.vessels.find((v) => v.ownerId === 'p1')!
    const v2 = gs.vessels.find((v) => v.ownerId === 'p2')!

    // 1) Yüksek warp varken yerde gaz açılınca gemi rayda donmaz, kalkış yapar
    v1.throttle = 1
    sim.warpIdx = 5
    const r2 = BODIES.earth.radius + 250_000
    v2.landed = false
    v2.pos = { x: r2, y: 0 }
    v2.vel = { x: 0, y: Math.sqrt(BODIES.earth.mu / r2) }
    stepWorld(sim, 0.05, new Map())
    expect(sim.warpIdx).toBe(0)
    expect(v1.landed).toBe(false)
    expect(situation(v1).alt).toBeGreaterThan(0)

    // 2) MP oto-iniş yüksek alçalmasında (2.5 km) otomatik hızlanır (<=10×), 90 m altında 1×'e iner ve güvenle iner
    const theta = 0.5
    const mrHigh = BODIES.moon.radius + terrainHeight('moon', theta) + 2500
    v1.bodyId = 'moon'
    v1.landed = false
    v1.throttle = 0
    v1.pos = { x: Math.cos(theta) * mrHigh, y: Math.sin(theta) * mrHigh }
    v1.vel = { x: Math.cos(theta) * -22, y: Math.sin(theta) * -22 }
    v1.angle = theta
    expect(setVesselAutopilot(sim, v1, 'land')).toBeNull()
    sim.clock = 10
    sim.warpIdx = 2
    const dynHigh = computeDynamicWarp(gs, sim.warpIdx, 0.4, 0.05, sim.clock, new Map(), new Map())
    expect(dynHigh.warpIdx).toBe(3)
    const dynHigher = computeDynamicWarp(gs, dynHigh.warpIdx, 0.4, 0.05, sim.clock, new Map(), new Map())
    expect(dynHigher.warpIdx).toBe(4)

    const mrLow = BODIES.moon.radius + terrainHeight('moon', theta) + 85
    v1.pos = { x: Math.cos(theta) * mrLow, y: Math.sin(theta) * mrLow }
    v1.vel = { x: Math.cos(theta) * -12, y: Math.sin(theta) * -12 }
    const dynLow = computeDynamicWarp(gs, 3, 0, 0.05, sim.clock, new Map(), new Map())
    expect(dynLow.warpIdx).toBe(0)

    v1.pos = { x: Math.cos(theta) * mrHigh, y: Math.sin(theta) * mrHigh }
    v1.vel = { x: Math.cos(theta) * -22, y: Math.sin(theta) * -22 }
    let crashed = false
    let saw1xNearGround = false
    for (let i = 0; i < 1200 && !v1.landed && !crashed; i += 1) {
      const evs = stepWorld(sim, 0.05, new Map())
      const s = situation(v1)
      if (!v1.landed && s.alt < 90 && sim.warpIdx === 0) saw1xNearGround = true
      if (evs.some((e) => e.type === 'crash')) crashed = true
    }
    expect(crashed).toBe(false)
    expect(saw1xNearGround).toBe(true)
    expect(v1.landed).toBe(true)
  })

  it('fast travel lasts longer with active telemetry and recovers missing snapshot parts', async () => {
    const { buildCompactSnapshot, hydrateCompactSnapshot } = await import('./mpClient')
    const gs = newMultiplayerGame('CRU', 'p1', [{ id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 }], {
      startingMoney: 500_000,
    })
    gs.mp!.started = true
    const sim: Sim = { gs, warpIdx: 0, firing: new Map(), clock: 0 }
    expect(dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1').error).toBeUndefined()
    const v = gs.vessels[0]!
    gs.mp!.players.p1.targetBody = 'mars'
    v.targetBody = 'mars'
    const r = BODIES.earth.radius + BODIES.earth.atmoHeight + 30_000
    v.landed = false
    v.pos = { x: r, y: 0 }
    v.vel = { x: 0, y: Math.sqrt(BODIES.earth.mu / r) }
    v.autopilot = 'transfer'

    // İlk tam anlık görüntü istemci önbelleğine parçaları yazar
    const fullSnap = buildCompactSnapshot(sim, true)
    hydrateCompactSnapshot(JSON.parse(JSON.stringify(fullSnap)), null, 'p1', [], {})
    const stripped = JSON.parse(JSON.stringify(buildCompactSnapshot(sim, false)))
    for (const wv of stripped.vessels) delete wv.parts
    const recovered = hydrateCompactSnapshot(stripped, null, 'p1', [], {})
    expect(recovered.gs.vessels.length).toBe(1)

    stepWorld(sim, 0.05, new Map())
    expect(v.cruise).toBeTruthy()
    expect(v.cruise!.dur).toBeGreaterThanOrEqual(7.5)
    expect(v.cruise!.dur).toBeLessThanOrEqual(13.5)

    // Yolculuk ortasında hız ve motor itkisi görünür
    for (let i = 0; i < Math.floor((v.cruise!.dur * 0.5) / 0.05); i += 1) {
      stepWorld(sim, 0.05, new Map())
    }
    expect(v.cruise).toBeTruthy()
    expect(v.throttle).toBeGreaterThan(0)
    expect(len(v.vel)).toBeGreaterThan(1000)

    // Varışta tüm otopilot ve hız ayarları temizlenir
    for (let i = 0; i < 300 && v.cruise; i += 1) stepWorld(sim, 0.05, new Map())
    expect(v.cruise).toBeUndefined()
    expect(v.bodyId).toBe('mars')
    expect(v.throttle).toBe(0)
    expect(v.autopilot).toBe('off')
    expect(v.autopilotNote).toBeUndefined()
  })
})

describe('economy, 4 quadrants, launch pads, and controllable drones', () => {
  it('scales economy, mission rewards, Earth module cost curve, and COLONY_SLOTS = 12 cleanly', () => {
    expect(INITIAL_MONEY).toBe(34_000)
    expect(COLONY_SLOTS).toBe(12)
    expect(MISSION_BY_ID['venus-land']!.reward).toBeGreaterThan(MISSION_BY_ID['mars-land']!.reward)
    expect(MODULE_BY_ID['colony-station']!.power).toBe(-5)
    expect(MODULE_BY_ID['launch-pad']!.cost).toBe(5200)
    expect(MODULE_BY_ID['launch-pad']!.power).toBe(-1)
    expect(MODULE_BY_ID['telemetry']!.income).toBeLessThan(MODULE_BY_ID['habitat']!.income)
    expect(MODULE_BY_ID['habitat']!.income).toBeLessThan(MODULE_BY_ID['sampler']!.income)
    expect(MODULE_BY_ID['sampler']!.income).toBeLessThan(MODULE_BY_ID['biodome']!.income)
    expect(MODULE_BY_ID['biodome']!.income).toBeLessThan(MODULE_BY_ID['lab']!.income)
    expect(MODULE_BY_ID['lab']!.income).toBe(10_000)

    const gs = newGame()
    expect(totalPassiveIncomePerMin(gs)).toBe(3_000)
    const sim: Sim = { gs, warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    expect(placePlanetModule(sim, 'earth', 3, 'solar-farm')).toBeNull()
    expect(placePlanetModule(sim, 'earth', 4, 'lab')).toBeNull()
    expect(totalPassiveIncomePerMin(gs)).toBe(13_000)

    const gs2 = newGame()
    const baseSolarCost = earthModuleCost(gs2, 'solar-farm')
    expect(baseSolarCost).toBe(Math.round(MODULE_BY_ID['solar-farm']!.cost * 1.35))
    gs2.bases.earth!.sites![3] = 'solar-farm'
    syncModules(gs2.bases.earth!)
    expect(earthModuleCost(gs2, 'solar-farm')).toBe(Math.round(MODULE_BY_ID['solar-farm']!.cost * 1.7))
  })

  it('keeps 4 quadrants independent, enables local builds with Space Station, and launches rockets from Moon Launch Pad in SP', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    sim.gs.money = 120_000
    expect(canLaunchFromQuadrant(sim.gs, 'earth', 0, 'local')).toBe(true)
    expect(canLaunchFromQuadrant(sim.gs, 'earth', 1, 'local')).toBe(false)
    expect(isQuadrantColonized(sim.gs.quadrantBases?.earth?.[1], 1)).toBe(false)

    // Ay Çeyrek 1'de İstasyon olmadan krediyle bina dikilemez ve fırlatma yapılamaz
    expect(placePlanetModule(sim, 'moon', 0, 'launch-pad', 'local', 1)).toBeTruthy()
    expect(canLaunchFromQuadrant(sim.gs, 'moon', 1, 'local')).toBe(false)

    // Kargo aracını Ay Q1'e indirip Uzay İstasyonu + Reaktör kur
    const q1 = quadrantCenterAngle(1)
    const moonR = BODIES.moon.radius
    const id = sim.gs.nextId
    sim.gs.nextId += 1
    const cargoShip = {
      id,
      name: 'Koloni Gemisi',
      ownerId: 'local',
      bodyId: 'moon' as const,
      pos: { x: Math.cos(q1) * moonR, y: Math.sin(q1) * moonR },
      vel: { x: 0, y: 0 },
      angle: q1,
      angVel: 0,
      throttle: 0,
      landed: true,
      ec: 60,
      rcsOn: false,
      sas: 'off' as const,
      autopilot: 'off' as const,
      visited: ['earth' as const, 'moon' as const],
      assist: null,
      dvUsed: 0,
      parts: freshParts([{ def: 'capsule', x: 6, y: 1 }, { def: 'cargo-lg', x: 6, y: 3 }]),
      cargo: { modules: { 'colony-station': 1, 'rtg-reactor': 1 }, ore: 0, oreFrom: null },
    }
    sim.gs.vessels.push(cargoShip)
    sim.gs.activeId = id

    expect(dispatchCommand(sim, { type: 'deployModules', vesselId: id, quadrant: 1 }).error).toBeUndefined()
    // Rampayı boş bırakmak için kargo aracını aynı çeyrek içinde kenara al
    cargoShip.pos = { x: Math.cos(q1 + 0.002) * moonR, y: Math.sin(q1 + 0.002) * moonR }

    const moonQ1 = sim.gs.quadrantBases?.moon?.[1]
    expect(isQuadrantColonized(moonQ1, 1)).toBe(true)
    expect(baseReport(moonQ1!, 1, BODIES.moon.incomeMult).incomePerMin).toBe(10_800)
    expect(isQuadrantColonized(sim.gs.bases.moon, 1)).toBe(false)
    expect(hasActiveLaunchPad(moonQ1, 1)).toBe(false)

    // Aktif İstasyon sayesinde doğrudan krediyle Fırlatma Rampası kurulur ve oradan roket fırlatılır
    expect(placePlanetModule(sim, 'moon', 2, 'launch-pad', 'local', 1)).toBeNull()
    expect(hasActiveLaunchPad(moonQ1, 1)).toBe(true)
    expect(canLaunchFromQuadrant(sim.gs, 'moon', 1, 'local')).toBe(true)
    expect(availableLaunchSites(sim.gs, 'local').some((s) => s.bodyId === 'moon' && s.quadrant === 1)).toBe(true)
    expect(launchDesign(sim, 'local', DEFAULT_DESIGN, {}, 'moon', 1)).toBeNull()
    const onMoon = activeVessel(sim.gs)!
    expect(onMoon.bodyId).toBe('moon')
    expect(quadrantOfAngle(Math.atan2(onMoon.pos.y, onMoon.pos.x))).toBe(1)
  })

  it('launches unarmed controllable cargo drones in Colony Race and SP, colonizes quadrants, and breaks above planetary ceiling', () => {
    const carrierDesign = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'drone-bay-l', x: 8, y: 1 },
      { def: 'cargo-lg', x: 6, y: 3 },
      { def: 'tank-m', x: 6, y: 6 },
      { def: 'frontier', x: 6, y: 8 },
    ]
    expect(isConnected(freshParts(carrierDesign))).toBe(true)

    const gs = newMultiplayerGame(
      'DRN1',
      'p1',
      [{ id: 'p1', username: 'Ada', color: '#38d9e8', slot: 0 }],
      { mode: 'colony-race', startingMoney: 100_000 },
    )
    gs.mp!.started = true
    const sim: Sim = { gs, warpIdx: 0, firing: new Map(), fx: [], clock: 0 }

    // Koloni Yarışı'nda Dron Hangarı + kargo taşıyan roketi fırlat
    const launchRes = dispatchCommand(
      sim,
      {
        type: 'launch',
        design: carrierDesign,
        designCargo: { 'colony-station': 1, 'rtg-reactor': 1 },
      },
      'p1',
    )
    expect(launchRes.error).toBeUndefined()
    const carrier = gs.vessels.find((v) => v.ownerId === 'p1')!

    // Ateş tuşuyla Dron Hangarından silahsız dronu çıkar
    const evs = stepWorld(
      sim,
      0.05,
      new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'drone-bay-l', aimAngle: PAD_ANGLE }]]),
    )
    expect(evs.some((e) => e.type === 'toast')).toBe(true)
    const drone = gs.vessels.find((v) => v.drone && v.ownerId === 'p1')!
    expect(drone).toBeDefined()
    expect(drone.drone!.tier).toBe(3)
    expect(drone.drone!.homeBodyId).toBe('earth')
    expect(vesselStats(drone.parts, drone.cargo).weaponCount).toBe(0)

    // Dron silahsızdır: ateş komutu mermi üretmez ve gezegenler arası transfer otopilotu reddedilir
    stepWorld(
      sim,
      0.05,
      new Map([['p1', { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'gun-vulcan', aimAngle: 0 }]]),
    )
    expect(gs.projectiles?.length ?? 0).toBe(0)
    expect(setVesselAutopilot(sim, drone, 'transfer')).toBeTruthy()

    // Kargo gemiden drona otomatik aktarılmıştır; transferCargo komutu da çalışır
    expect(drone.cargo.modules['colony-station']).toBe(1)
    expect(drone.cargo.modules['rtg-reactor']).toBe(1)
    expect(carrier.cargo.modules['colony-station']).toBeUndefined()
    // 1 modülü geri ana gemiye, sonra tekrar drona aktar (480 m menzil testi)
    drone.pos = { x: carrier.pos.x + 20, y: carrier.pos.y }
    expect(
      dispatchCommand(
        sim,
        { type: 'transferCargo', fromVesselId: drone.id, toVesselId: carrier.id, moduleId: 'rtg-reactor', count: 1 },
        'p1',
      ).error,
    ).toBeUndefined()
    expect(carrier.cargo.modules['rtg-reactor']).toBe(1)
    expect(
      dispatchCommand(
        sim,
        { type: 'transferCargo', fromVesselId: carrier.id, toVesselId: drone.id, moduleId: 'rtg-reactor', count: 1 },
        'p1',
      ).error,
    ).toBeUndefined()
    expect(drone.cargo.modules['rtg-reactor']).toBe(1)

    // Dron Dünya Çeyrek 1'e inip Uzay İstasyonunu indirerek çeyreği kolonileştirir
    const q1 = quadrantCenterAngle(1)
    const earthR = BODIES.earth.radius + terrainHeight('earth', q1)
    drone.pos = { x: Math.cos(q1) * earthR, y: Math.sin(q1) * earthR }
    drone.vel = { x: 0, y: 0 }
    drone.landed = true
    drone.angle = q1
    gs.mp!.players.p1.activeVesselId = drone.id
    expect(dispatchCommand(sim, { type: 'deployModules', vesselId: drone.id, quadrant: 1 }, 'p1').error).toBeUndefined()
    expect(isQuadrantColonized(getActorQuadrantBase(gs, 'earth', 'p1', 1), 1)).toBe(true)

    // Uzay sınırı denetimi: 0.75 * maxAlt üstünde uyarır, maxAlt üstünde kalınca parçalanır
    const maxAlt = droneMaxAlt('earth', 3)
    drone.landed = false
    drone.pos = { x: 0, y: BODIES.earth.radius + maxAlt * 0.85 }
    drone.vel = { x: 0, y: 0 }
    const warnEvs = stepWorld(sim, 0.05, new Map())
    expect(drone.drone!.warn).toBe(true)
    expect(warnEvs.some((e) => e.type === 'toast' && e.text.includes('DRON UYARISI'))).toBe(true)

    drone.pos = { x: 0, y: BODIES.earth.radius + maxAlt + 600 }
    drone.vel = { x: 0, y: 40 }
    let crashSeen = false
    for (let i = 0; i < 60 && gs.vessels.some((v) => v.id === drone.id); i += 1) {
      const ev = stepWorld(sim, 0.05, new Map())
      if (ev.some((e) => e.type === 'crash' && e.vesselId === drone.id)) crashSeen = true
    }
    expect(crashSeen).toBe(true)
    expect(gs.vessels.some((v) => v.id === drone.id)).toBe(false)

    // Tek Oyunculu modda da Dron Hangarı doğrudan çalışır
    const spSim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    spSim.gs.money = 120_000
    expect(launchDesign(spSim, 'local', carrierDesign, { 'solar-farm': 2 })).toBeNull()
    stepWorld(spSim, 0.05, { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'drone-bay-l', aimAngle: PAD_ANGLE })
    const spDrone = spSim.gs.vessels.find((v) => v.drone)
    expect(spDrone).toBeDefined()
    expect(spDrone!.cargo.modules['solar-farm']).toBe(2)
  })

  it('enforces 1 drone bay max with ammo=1, powers drones by electric fans without liquid fuel, and autopilots to next quadrant', () => {
    for (const id of ['drone-bay-s', 'drone-bay-m', 'drone-bay-l']) {
      expect(partDef(id).droneSpec?.ammo).toBe(1)
    }
    const twoBays = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'drone-bay-s', x: 5, y: 1 },
      { def: 'drone-bay-s', x: 8, y: 1 },
      { def: 'tank-m', x: 6, y: 3 },
      { def: 'hawk', x: 6, y: 5 },
    ]
    expect(validateDesign(twoBays, {})).toBeTruthy()

    const spSim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    spSim.gs.money = 120_000
    const carrierDesign = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'drone-bay-l', x: 8, y: 1 },
      { def: 'tank-m', x: 6, y: 3 },
      { def: 'hawk', x: 6, y: 5 },
    ]
    expect(launchDesign(spSim, 'local', carrierDesign)).toBeNull()
    const carrier = activeVessel(spSim.gs)!
    stepWorld(spSim, 0.05, { rotate: 0, tx: 0, ty: 0, fire: true, weaponKey: 'drone-bay-l', aimAngle: PAD_ANGLE })
    // Fırlatma sonrası hangarda ikinci dron kalmaz (ammo = 1)
    const bayPart = carrier.parts.find((p) => p.def === 'drone-bay-l')!
    expect(bayPart.ammo).toBe(0)

    const drone = spSim.gs.vessels.find((v) => v.drone)!
    expect(drone).toBeDefined()
    const dst = vesselStats(drone.parts, drone.cargo)
    expect(dst.fuelCap).toBe(0)
    expect(dst.ecCap).toBeGreaterThan(0)
    expect(drone.parts.some((p) => partDef(p.def).electricFan)).toBe(true)

    const fanParts = drone.parts.map((p) => ({ ...p }))
    const engCheck = runEngines(fanParts, 1, 1.0, 0.1, dst.ecCap)
    expect(engCheck.thrust).toBeGreaterThan(0)
    expect(vesselStats(fanParts, drone.cargo).fuel).toBe(0)
    expect(engCheck.ecUsed).toBeGreaterThan(0)

    // Dronu Q0 yüzeyine koyup "Sonraki Çeyrek" (nextQuad) otopilotu ile Q1'e uçur
    const q0 = quadrantCenterAngle(0)
    const r0 = BODIES.earth.radius + terrainHeight('earth', q0)
    drone.pos = { x: Math.cos(q0) * r0, y: Math.sin(q0) * r0 }
    drone.vel = { x: 0, y: 0 }
    drone.landed = true
    drone.angle = q0
    spSim.gs.activeId = drone.id

    expect(setVesselAutopilot(spSim, drone, 'nextQuad')).toBeNull()
    expect(drone.autopilot).toBe('nextQuad')
    expect(drone.targetQuad).toBe(1)

    const maxAlt = droneMaxAlt('earth', 3)
    for (let i = 0; i < 9000 && drone.autopilot === 'nextQuad'; i += 1) {
      stepWorld(spSim, 0.1, { rotate: 0, tx: 0, ty: 0 })
      const alt = Math.hypot(drone.pos.x, drone.pos.y) - BODIES.earth.radius
      expect(alt).toBeLessThan(maxAlt * 0.8)
    }
    expect(spSim.gs.vessels.some((v) => v.id === drone.id)).toBe(true)
    expect(drone.landed).toBe(true)
    expect(drone.autopilot).toBe('off')
    expect(quadrantOfAngle(Math.atan2(drone.pos.y, drone.pos.x))).toBe(1)
  })

  it('supports dedicated designDroneCargo without main cargo bay, transfers Ship <-> Drone <-> Base, and preserves staged payload', () => {
    const bayOnlyDesign = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'drone-bay-m', x: 8, y: 1 },
      { def: 'tank-m', x: 6, y: 3 },
      { def: 'hawk', x: 6, y: 5 },
    ]
    // Kargo gövdesi olmayan rokette sadece dron kargosu doğrulanır
    expect(validateDesign(bayOnlyDesign, {}, undefined, { 'colony-station': 1, 'solar-farm': 2 })).toBeNull()
    expect(validateDesign(bayOnlyDesign, { 'solar-farm': 1 })).toBeTruthy()
    expect(validateDesign(bayOnlyDesign, {}, undefined, { 'colony-station': 2 })).toBeTruthy() // > 7.5 t

    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    sim.gs.money = 120_000
    const res = dispatchCommand(
      sim,
      {
        type: 'launch',
        design: bayOnlyDesign,
        designCargo: {},
        designDroneCargo: { 'colony-station': 1, 'solar-farm': 2 },
      },
      'local',
    )
    expect(res.error).toBeUndefined()
    const rocket = activeVessel(sim.gs)!
    const bayIdx = rocket.parts.findIndex((p) => p.def === 'drone-bay-m')
    expect(rocket.parts[bayIdx]!.droneCargo).toEqual({ 'colony-station': 1, 'solar-farm': 2 })

    // Roket + Kargo Gövdesi olan ikinci senaryoda Ship <-> Drone Bay <-> Colony aktarımı
    const withCargoDesign = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'drone-bay-m', x: 8, y: 1 },
      { def: 'cargo', x: 6, y: 3 },
      { def: 'tank-m', x: 6, y: 5 },
      { def: 'hawk', x: 6, y: 7 },
    ]
    const sim2: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    sim2.gs.money = 150_000
    expect(
      dispatchCommand(
        sim2,
        {
          type: 'launch',
          design: withCargoDesign,
          designCargo: { 'solar-farm': 1 },
          designDroneCargo: { 'colony-station': 1 },
        },
        'local',
      ).error,
    ).toBeUndefined()
    const carrier = activeVessel(sim2.gs)!
    const cBayIdx = carrier.parts.findIndex((p) => p.def === 'drone-bay-m')
    // Gemiden Drona yük aktar
    expect(
      dispatchCommand(
        sim2,
        {
          type: 'transferDroneCargo',
          vesselId: carrier.id,
          partIndex: cBayIdx,
          moduleId: 'solar-farm',
          delta: 1,
          source: 'ship',
        },
        'local',
      ).error,
    ).toBeUndefined()
    expect(carrier.cargo.modules['solar-farm']).toBeUndefined()
    expect(carrier.parts[cBayIdx]!.droneCargo).toEqual({ 'colony-station': 1, 'solar-farm': 1 })

    // Yüzeyde Dünya Ana Üssü'nden doğrudan Drona 1 adet daha ekle (toplam 6 t <= 7.5 t)
    const moneyBeforeBuy = sim2.gs.money
    expect(
      dispatchCommand(
        sim2,
        {
          type: 'transferDroneCargo',
          vesselId: carrier.id,
          partIndex: cBayIdx,
          moduleId: 'solar-farm',
          delta: 1,
          source: 'colony',
        },
        'local',
      ).error,
    ).toBeUndefined()
    expect(sim2.gs.money).toBe(moneyBeforeBuy - MODULE_BY_ID['solar-farm']!.cost)
    expect(carrier.parts[cBayIdx]!.droneCargo).toEqual({ 'colony-station': 1, 'solar-farm': 2 })

    // Dron fırlatıldığında yalnızca kendi droneCargo yükünü alır (gemiye ait kalan cargo varsa dokunmaz)
    expect(
      dispatchCommand(
        sim2,
        {
          type: 'buyCargoModule',
          vesselId: carrier.id,
          moduleId: 'drill',
          delta: 1,
        },
        'local',
      ).error,
    ).toBeUndefined()
    expect(
      dispatchCommand(sim2, { type: 'launchDrone', vesselId: carrier.id, partIndex: cBayIdx }, 'local').error,
    ).toBeUndefined()
    const spawned = activeVessel(sim2.gs)!
    expect(spawned.drone?.tier).toBe(2)
    expect(spawned.cargo.modules).toEqual({ 'colony-station': 1, 'solar-farm': 2 })
    expect(carrier.cargo.modules['drill']).toBe(1)
  })

  it('launches electric drones directly from Earth Q0 and colonized Moon Q1 Launch Pad pulling base stock', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    sim.gs.money = 100_000

    // Dünya Q0 rampasından Mk-II dron + 2× Güneş Paneli fırlat
    const earthRes = dispatchCommand(
      sim,
      {
        type: 'launchPadDrone',
        bodyId: 'earth',
        quadrant: 0,
        tier: 2,
        modules: { 'solar-farm': 2 },
      },
      'local',
    )
    expect(earthRes.error).toBeUndefined()
    const eDrone = activeVessel(sim.gs)!
    expect(eDrone.drone?.tier).toBe(2)
    expect(eDrone.bodyId).toBe('earth')
    expect(eDrone.cargo.modules).toEqual({ 'solar-farm': 2 })
    expect(eDrone.parts.some((p) => partDef(p.def).electricFan)).toBe(true)

    // Ay Q1'de Uzay İstasyonu + Fırlatma Rampası + Güneş Paneli ve depoda 1× Güneş Paneli hazırla
    const q1 = emptyBase(quadrantCenterAngle(1))
    q1.sites = ['colony-station', 'launch-pad', 'solar-farm', 'solar-farm', null, null, null, null, null, null, null, null]
    q1.stock = { 'solar-farm': 1 }
    syncModules(q1)
    sim.gs.quadrantBases ??= {}
    sim.gs.quadrantBases.moon = [
      emptyBase(quadrantCenterAngle(0)),
      q1,
      emptyBase(quadrantCenterAngle(2)),
      emptyBase(quadrantCenterAngle(3)),
    ]

    const moneyBeforeMoon = sim.gs.money
    const moonRes = dispatchCommand(
      sim,
      {
        type: 'launchPadDrone',
        bodyId: 'moon',
        quadrant: 1,
        tier: 3,
        modules: { 'solar-farm': 2 },
      },
      'local',
    )
    expect(moonRes.error).toBeUndefined()
    const mDrone = activeVessel(sim.gs)!
    expect(mDrone.drone?.tier).toBe(3)
    expect(mDrone.bodyId).toBe('moon')
    expect(quadrantOfAngle(Math.atan2(mDrone.pos.y, mDrone.pos.x))).toBe(1)
    expect(mDrone.cargo.modules).toEqual({ 'solar-farm': 2 })
    // 1 modül stoktan bedava düştü, sadece 1 modül + Mk-III dron ücreti kesildi
    expect(q1.stock?.['solar-farm']).toBeUndefined()
    expect(sim.gs.money).toBe(moneyBeforeMoon - 9_500 - MODULE_BY_ID['solar-farm']!.cost)
  })

  it('allows cargo transfer within 2km or same landed quadrant and preserves fitting cargo on partial bay loss', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    sim.gs.money = 120_000
    expect(
      dispatchCommand(
        sim,
        {
          type: 'launchPadDrone',
          bodyId: 'earth',
          quadrant: 0,
          tier: 2,
          modules: { 'solar-farm': 2 },
        },
        'local',
      ).error,
    ).toBeUndefined()
    const drone = activeVessel(sim.gs)!

    const rocketDesign = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'cargo', x: 6, y: 3 },
      { def: 'tank-m', x: 6, y: 5 },
      { def: 'hawk', x: 6, y: 7 },
    ]
    expect(launchDesign(sim, 'local', rocketDesign)).toBeNull()
    const rocket = activeVessel(sim.gs)!

    // İki araç aynı çeyrekte inmişken 1200 m mesafede bile kargo aktarılabilir
    const shiftedAngle = Math.atan2(rocket.pos.y, rocket.pos.x) + 1200 / BODIES.earth.radius
    const sr = BODIES.earth.radius + terrainHeight('earth', shiftedAngle)
    drone.pos = { x: Math.cos(shiftedAngle) * sr, y: Math.sin(shiftedAngle) * sr }
    drone.landed = true
    expect(canTransferCargoBetween(drone, rocket)).toBe(true)

    expect(
      dispatchCommand(
        sim,
        {
          type: 'transferCargo',
          fromVesselId: drone.id,
          toVesselId: rocket.id,
          moduleId: 'solar-farm',
          count: 1,
        },
        'local',
      ).error,
    ).toBeUndefined()
    expect(rocket.cargo.modules['solar-farm']).toBe(1)
    expect(drone.cargo.modules['solar-farm']).toBe(1)

    // Kargo kapasitesi küçüldüğünde tüm yük silinmez; sığan modüller + kalan maden korunur
    const cargo = { ore: 3, oreFrom: 'moon' as const, modules: { 'colony-station': 1, 'solar-farm': 1 } }
    const trimRes1 = trimCargoToCap(cargo, 6)
    expect(cargo.modules['colony-station']).toBe(1)
    expect(cargo.modules['solar-farm']).toBe(1)
    expect(cargo.ore).toBe(1)
    expect(trimRes1.droppedOre).toBe(2)

    const modCargo = { ore: 2, oreFrom: 'moon' as const, modules: { 'colony-station': 1, 'solar-farm': 3 } }
    const trimRes2 = trimCargoToCap(modCargo, 6)
    expect(modCargo.modules['colony-station']).toBe(1)
    expect(modCargo.modules['solar-farm']).toBe(2)
    expect(modCargo.ore).toBe(0)
    expect(modCargo.oreFrom).toBeNull()
    expect(trimRes2.droppedModules['solar-farm']).toBe(1)
    expect(trimRes2.droppedOre).toBe(2)
  })

  it('supports fleet follow formation in orbit, rejects follow cycles, executes fleet orders, and detaches on leader removal', () => {
    const sim: Sim = { gs: newGame(), warpIdx: 0, firing: new Map(), fx: [], clock: 0 }
    sim.gs.money = 250_000
    const shipDesign = [
      { def: 'capsule', x: 6, y: 1 },
      { def: 'tank-l', x: 6, y: 3 },
      { def: 'hawk', x: 6, y: 6 },
    ]

    expect(launchDesign(sim, 'local', shipDesign)).toBeNull()
    const leader = activeVessel(sim.gs)!
    // İlk aracı Ay yörüngesine al (240 km) ve ikinci aracı aynı yörüngenin 1400 m gerisine yerleştir
    const rOrb = BODIES.moon.radius + 35_000
    const vOrb = Math.sqrt(BODIES.moon.mu / rOrb)
    leader.bodyId = 'moon'
    leader.landed = false
    leader.pos = { x: rOrb, y: 0 }
    leader.vel = { x: 0, y: vOrb }
    leader.angle = Math.PI / 2

    expect(launchDesign(sim, 'local', shipDesign)).toBeNull()
    const wingman1 = activeVessel(sim.gs)!
    wingman1.bodyId = 'moon'
    wingman1.landed = false
    wingman1.pos = { x: rOrb, y: -1400 }
    wingman1.vel = { x: 0, y: vOrb }
    wingman1.angle = Math.PI / 2

    expect(launchDesign(sim, 'local', shipDesign)).toBeNull()
    const wingman2 = activeVessel(sim.gs)!
    wingman2.bodyId = 'moon'
    wingman2.landed = false
    wingman2.pos = { x: rOrb + 400, y: -900 }
    wingman2.vel = { x: 0, y: vOrb }
    wingman2.angle = Math.PI / 2

    // Döngü koruması: kendi kendini veya takipçisini lider olarak seçemez
    expect(dispatchCommand(sim, { type: 'setAutopilot', vesselId: wingman1.id, mode: 'follow', followId: leader.id }, 'local').error).toBeUndefined()
    expect(createsFollowCycle(sim.gs, leader.id, wingman1.id)).toBe(true)
    expect(dispatchCommand(sim, { type: 'setAutopilot', vesselId: leader.id, mode: 'follow', followId: wingman1.id }, 'local').error).toBeTruthy()

    // Toplu filo komutu: followAll tüm boş gemileri liderin arkasında formasyona katar
    expect(dispatchCommand(sim, { type: 'fleetOrder', leaderId: leader.id, order: 'followAll' }, 'local').error).toBeUndefined()
    expect(wingman1.autopilot).toBe('follow')
    expect(wingman1.followId).toBe(leader.id)
    expect(wingman2.autopilot).toBe('follow')
    expect(wingman2.followId).toBe(leader.id)

    // İlerlet: kanat gemileri yörüngedeki lidere 200 m formasyon içine yaklaşır
    for (let i = 0; i < 1600; i += 1) {
      stepWorld(sim, 0.05, { rotate: 0, tx: 0, ty: 0 })
    }
    const d1 = Math.hypot(leader.pos.x - wingman1.pos.x, leader.pos.y - wingman1.pos.y)
    const d2 = Math.hypot(leader.pos.x - wingman2.pos.x, leader.pos.y - wingman2.pos.y)
    expect(d1).toBeLessThan(200)
    expect(d2).toBeLessThan(200)
    // Çarpışma yok — iki araç hala yaşıyor ve ayrı V-formasyon yuvalarında
    expect(Math.hypot(wingman1.pos.x - wingman2.pos.x, wingman1.pos.y - wingman2.pos.y)).toBeGreaterThan(20)

    // Toplu filo emri: stop tüm filoyu durdurur, disband takibi çözer
    expect(dispatchCommand(sim, { type: 'fleetOrder', leaderId: leader.id, order: 'followAll' }, 'local').error).toBeUndefined()
    expect(dispatchCommand(sim, { type: 'fleetOrder', leaderId: leader.id, order: 'stop' }, 'local').error).toBeUndefined()
    expect(leader.autopilot).toBe('off')
    expect(wingman1.autopilot).toBe('off')
    expect(wingman1.followId).toBeUndefined()

    // Lider silinince aktif takipçiler güvenle ayrılır
    expect(dispatchCommand(sim, { type: 'fleetOrder', leaderId: leader.id, order: 'followAll' }, 'local').error).toBeUndefined()
    expect(deleteVessel(sim, leader.id, 'local')).toBe(true)
    expect(wingman1.autopilot).toBe('off')
    expect(wingman1.followId).toBeUndefined()
    expect(wingman2.autopilot).toBe('off')
    expect(wingman2.followId).toBeUndefined()
  })
})
