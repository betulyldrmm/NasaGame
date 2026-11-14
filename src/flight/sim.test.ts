import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN } from '../game/data'
import { baseIncomeMultiplier, hasAutoLandTech, INITIAL_TECH, isModuleUnlocked, isPartUnlocked, unlockTech } from '../game/tech'
import { estimateDeltaV, freshParts, isConnected, vesselStats } from '../game/vessel'
import { BODIES } from '../nasa/bodies'
import { elementsFromState, hohmann, len, propagate, wrapPi } from './orbit'
import { PAD_ANGLE, situation, terrainHeight } from './physics'
import { predictTrajectory } from './predict'
import {
  activeVessel,
  buyEarthModule,
  launchDesign,
  newGame,
  PHYSICS_WARP_MAX_IDX,
  type Sim,
  stageNext,
  stepWorld,
  tickBasesOnly,
  totalPassiveIncomePerHour,
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
    expect(rate).toBeGreaterThan(1000)

    const money0 = gs.money
    const earned = tickBasesOnly(gs, 3600)
    expect(earned).toBeCloseTo(rate, 2)
    expect(gs.money).toBeCloseTo(money0 + rate, 2)
    expect(gs.time).toBe(3600)
  })

  it('enforces tech tree gating and increases income multipliers', () => {
    const gs = newGame()
    expect(gs.techDone).toEqual([INITIAL_TECH])
    expect(validateDesign(DEFAULT_DESIGN, {}, gs)).toBeNull()
    expect(isPartUnlocked(gs, 'aerospike')).toBe(false)
    expect(isModuleUnlocked(gs, 'datacenter')).toBe(false)
    expect(hasAutoLandTech(gs)).toBe(false)

    // Kilitli parça içeren tasarım reddedilmeli
    const lockedDesign = [
      { def: 'probe', x: 6, y: 10 },
      { def: 'tank-m', x: 6, y: 11 },
      { def: 'aerospike', x: 6, y: 13 },
    ]
    expect(validateDesign(lockedDesign, {}, gs)).not.toBeNull()

    // Önce önkoşul olmadan tier-2 araştırması açılamaz
    expect(unlockTech(gs, 'auto-land')).not.toBeNull()

    // Yeterli bütçe ile sırayla idle-ops ve adv-landing aç
    const baseEarthMult = baseIncomeMultiplier(gs, 'earth')
    expect(unlockTech(gs, 'idle-ops')).toBeNull()
    expect(isModuleUnlocked(gs, 'datacenter')).toBe(true)
    expect(baseIncomeMultiplier(gs, 'earth')).toBeGreaterThan(baseEarthMult)

    expect(unlockTech(gs, 'adv-landing')).toBeNull()
    expect(isPartUnlocked(gs, 'aerospike')).toBe(true)
    expect(validateDesign(lockedDesign, {}, gs)).toBeNull()

    expect(unlockTech(gs, 'auto-land')).toBeNull()
    expect(hasAutoLandTech(gs)).toBe(true)

    const sim: Sim = { gs, warpIdx: 0, firing: new Map() }
    const countBefore = gs.bases.earth!.modules.datacenter ?? 0
    expect(buyEarthModule(sim, 'datacenter')).toBeNull()
    expect(gs.bases.earth!.modules.datacenter).toBe(countBefore + 1)
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
    gs.techDone.push('adv-landing', 'auto-land')
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
