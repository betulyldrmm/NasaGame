import { expect, it } from 'vitest'
import { newMultiplayerGame } from './multiplayerSim'
import { dispatchCommand, stepWorld, type Sim } from './world'
import { DEFAULT_DESIGN } from '../game/data'
import { BODIES } from '../nasa/bodies'
it('cruise path never enters a body', () => {
  for (const [target, ang] of [['moon', 0], ['moon', 2], ['moon', 3.5], ['mars', 1], ['mars', 4]] as const) {
    const gs = newMultiplayerGame('R', 'p1', [{ id: 'p1', username: 'A', color: '#fff', slot: 0 }], { startingMoney: 1e6 })
    gs.mp!.started = true
    const sim: Sim = { gs, warpIdx: 0, firing: new Map(), clock: 0 }
    dispatchCommand(sim, { type: 'launch', design: DEFAULT_DESIGN }, 'p1')
    const v = gs.vessels[0]!
    gs.mp!.players.p1.targetBody = target; v.targetBody = target
    const r = BODIES.earth.radius + BODIES.earth.atmoHeight + 30000
    v.landed = false; v.pos = { x: Math.cos(ang) * r, y: Math.sin(ang) * r }; v.vel = { x: -Math.sin(ang) * Math.sqrt(BODIES.earth.mu / r), y: Math.cos(ang) * Math.sqrt(BODIES.earth.mu / r) }
    v.autopilot = 'transfer'
    for (const p of v.parts) if (p.fuel !== undefined) p.fuel = 50
    let minAlt = Infinity
    for (let i = 0; i < 300; i++) {
      stepWorld(sim, 0.05, new Map())
      if (v.cruise) minAlt = Math.min(minAlt, Math.hypot(v.pos.x, v.pos.y) - BODIES[v.bodyId].radius)
    }
    expect(v.bodyId).toBe(target)
    expect(minAlt).toBeGreaterThan(0)
  }
})
