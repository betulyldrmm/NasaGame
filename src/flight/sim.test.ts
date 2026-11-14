import { describe, expect, it } from 'vitest'
import { baseReport, colonyTier, emptyBase, syncModules } from '../game/base'
import { DEFAULT_DESIGN } from '../game/data'
import { estimateDeltaV, freshParts, isConnected, vesselStats } from '../game/vessel'
import { BODIES, solarFlux } from '../nasa/bodies'
import { elementsFromState, hohmann, len, propagate, wrapPi } from './orbit'
import { PAD_ANGLE, situation, terrainHeight } from './physics'
import { predictTrajectory } from './predict'
import {
  activeVessel,
  canControlVessel,
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
  totalPassiveIncomePerHour,
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

  it('reaches orbit and the Moon with a simple autopilot', () => {
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
  it('starts new games with an active Earth passive income base', () => {
    const gs = newGame()
    expect(gs.bases.earth).toBeDefined()
    expect(gs.bases.earth!.modules.telemetry).toBeGreaterThan(0)
    const rate = totalPassiveIncomePerHour(gs)
    expect(rate).toBeGreaterThan(900)

    const money0 = gs.money
    const earned = tickBasesOnly(gs, 3600)
    expect(earned).toBeCloseTo(rate, 2)
    expect(gs.money).toBeCloseTo(money0 + rate, 2)
    expect(gs.time).toBe(3600)
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

    // 100.000× yörünge hızlandırması pasif geliri sömürmemeli
    const sim: Sim = { gs: newGame(), warpIdx: WARPS.length - 1, firing: new Map() }
    const m0 = sim.gs.money
    for (let i = 0; i < 20; i += 1) stepWorld(sim, 0.05, ctrl)
    const gained = sim.gs.money - m0
    expect(gained).toBeLessThan(10)

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
    expect(moon.orePerHour).toBeGreaterThan(0)
    const flux = solarFlux(BODIES.mars.orbit!.a)
    expect(flux).toBeGreaterThan(0.4)
    expect(flux).toBeLessThan(0.46)
    const mars = baseReport(mk(), flux)
    expect(mars.unpowered).toBe(1)
    expect(mars.orePerHour).toBe(0)
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

    let arrived = false
    let captured = false
    for (let i = 0; i < 90000; i += 1) {
      const evs = stepWorld(sim, 0.05, ctrl)
      v = activeVessel(sim.gs)!
      if (!v) throw new Error('vessel lost: ' + JSON.stringify(evs))
      if (evs.some((e) => e.type === 'toast' && e.text.includes('hedefine ulaşıldı'))) arrived = true
      if (sim.gs.missionsDone.includes('moon-orbit')) {
        captured = true
        break
      }
    }
    expect(v.bodyId).toBe('moon')
    expect(arrived).toBe(true)
    // varışta otopilot kendisi yörüngeye girer
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
    expect(sim.warpIdx).toBe(0)
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
    expect(v.autopilot).toBe('orbit')
    expect(sim.warpIdx).toBe(0)
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
})
