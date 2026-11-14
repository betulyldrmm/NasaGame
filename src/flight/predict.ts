/**
 * Yörünge tahmini (yamalı konikler): aracın mevcut hızıyla izleyeceği yolu, etki alanı
 * geçişleri, karşılaşmalar ve çarpışmalarla birlikte hesaplar. Harita ekranındaki çizgiler budur.
 */
import { BODIES, childrenOf, type BodyId } from '../nasa/bodies'
import { bodyRelState, elementsFromState, type Elements, len, propagate, type Vec } from './orbit'

export interface Patch {
  bodyId: BodyId
  /** gök cismine göre noktalar */
  points: Vec[]
  end: 'orbit' | 'escape' | 'encounter' | 'impact' | 'limit'
  el: Elements
  tStart: number
  tEnd: number
}

export function predictTrajectory(bodyId: BodyId, pos: Vec, vel: Vec, t: number, maxPatches = 4): Patch[] {
  const patches: Patch[] = []
  let body = BODIES[bodyId]
  let r = pos
  let v = vel
  let time = t
  for (let n = 0; n < maxPatches; n += 1) {
    const el = elementsFromState(r, v, body.mu)
    const closed = el.e < 1 && el.ra < body.soi
    const kids = childrenOf(body.id)
    const prevDist = kids.map((k) => len({ x: r.x - bodyRelState(k, time).r.x, y: r.y - bodyRelState(k, time).r.y }))
    const points: Vec[] = [r]
    const tStart = time
    let end: Patch['end'] = 'limit'
    let next: { id: BodyId; r: Vec; v: Vec } | null = null
    const horizon = closed ? el.period : Infinity
    for (let i = 0; i < 2400; i += 1) {
      const rl = len(r)
      let dt = Math.max(0.5, (0.02 * rl) / Math.max(len(v), 1))
      if (closed) dt = Math.min(dt, el.period / 160)
      const left = horizon - (time - tStart)
      if (dt >= left) dt = left
      const s = propagate(r, v, body.mu, dt)
      r = s.r
      v = s.v
      time += dt
      points.push(r)
      const d = len(r)
      if (d < body.radius) {
        end = 'impact'
        break
      }
      if (body.parentId && d > body.soi) {
        const bs = bodyRelState(body, time)
        end = 'escape'
        next = { id: body.parentId, r: { x: r.x + bs.r.x, y: r.y + bs.r.y }, v: { x: v.x + bs.v.x, y: v.y + bs.v.y } }
        break
      }
      let hit = false
      for (let k = 0; k < kids.length; k += 1) {
        const kid = kids[k]!
        const ks = bodyRelState(kid, time)
        const rel = { x: r.x - ks.r.x, y: r.y - ks.r.y }
        const dist = len(rel)
        if (dist < kid.soi && prevDist[k]! >= kid.soi) {
          end = 'encounter'
          next = { id: kid.id, r: rel, v: { x: v.x - ks.v.x, y: v.y - ks.v.y } }
          hit = true
          break
        }
        prevDist[k] = dist
      }
      if (hit) break
      if (closed && time - tStart >= horizon - 1e-6) {
        end = 'orbit'
        break
      }
    }
    patches.push({ bodyId: body.id, points, end, el, tStart, tEnd: time })
    if (!next) break
    body = BODIES[next.id]
    r = next.r
    v = next.v
  }
  return patches
}
