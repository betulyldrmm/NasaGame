/**
 * Saf (UI'dan bağımsız) 2B Kepler yörünge matematiği.
 * Birimler: metre, saniye. Açı: radyan, +x ekseninden saat yönünün tersine.
 */
import { BODIES, type BodyDef, type BodyId, type OrbitDef } from '../nasa/bodies'

export interface Vec {
  x: number
  y: number
}

export interface StateVec {
  r: Vec
  v: Vec
}

export interface Elements {
  /** yarı-büyük eksen; hiperbolde negatif */
  a: number
  e: number
  /** enberi yönünün açısı */
  argp: number
  /** gerçek anomali (hareket yönünde ölçülür) */
  nu: number
  /** +1 saat yönünün tersi, −1 saat yönü */
  dir: number
  /** yarı-latus rektum */
  p: number
  rp: number
  /** öte nokta; kaçış yörüngesinde Infinity */
  ra: number
  period: number
  energy: number
}

export const len = (v: Vec) => Math.hypot(v.x, v.y)
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })
export const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (2 * Math.PI)
  if (x < 0) x += 2 * Math.PI
  return x - Math.PI
}

/** Kepler denklemi M = E − e·sinE (Newton). */
export function solveKepler(M: number, e: number): number {
  let m = wrapPi(M)
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1)
  for (let i = 0; i < 30; i += 1) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E))
    E -= d
    if (Math.abs(d) < 1e-12) break
  }
  return E + (M - m)
}

/** Hiperbolik Kepler denklemi M = e·sinhH − H. */
export function solveKeplerHyperbolic(M: number, e: number): number {
  let H = Math.max(-650, Math.min(650, Math.asinh(M / e)))
  for (let i = 0; i < 50; i += 1) {
    const clamped = Math.max(-650, Math.min(650, H))
    const d = (e * Math.sinh(clamped) - clamped - M) / Math.max(1e-9, e * Math.cosh(clamped) - 1)
    if (!Number.isFinite(d)) break
    H = Math.max(-650, Math.min(650, clamped - d))
    if (Math.abs(d) < 1e-12) break
  }
  return H
}

export function elementsFromState(r: Vec, v: Vec, mu: number): Elements {
  const rl = Math.max(1e-6, len(r))
  const safeMu = Math.max(1e-6, mu)
  const v2 = v.x * v.x + v.y * v.y
  const h = r.x * v.y - r.y * v.x
  const dir = h >= 0 ? 1 : -1
  const ex = (v.y * h) / safeMu - r.x / rl
  const ey = (-v.x * h) / safeMu - r.y / rl
  const e = Math.hypot(ex, ey)
  const energy = v2 / 2 - safeMu / rl
  const a = -safeMu / (2 * energy)
  const p = (h * h) / safeMu
  const argp = e > 1e-9 ? Math.atan2(ey, ex) : 0
  const nu = wrapPi(dir * (Math.atan2(r.y, r.x) - argp))
  const rp = p / (1 + e)
  const ra = e < 1 ? p / (1 - e) : Infinity
  const period = e < 1 && a > 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / safeMu) : Infinity
  return { a, e, argp, nu, dir, p, rp, ra, period, energy }
}

export function stateAtAnomaly(el: Pick<Elements, 'e' | 'argp' | 'dir' | 'p'>, nu: number, mu: number): StateVec {
  const r = el.p / (1 + el.e * Math.cos(nu))
  const theta = el.argp + el.dir * nu
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const k = Math.sqrt(mu / el.p)
  const vr = k * el.e * Math.sin(nu)
  const vt = k * (1 + el.e * Math.cos(nu)) * el.dir
  return { r: { x: r * c, y: r * s }, v: { x: vr * c - vt * s, y: vr * s + vt * c } }
}

function gravityAccel(r: Vec, mu: number): Vec {
  const rl = Math.max(1e-6, len(r))
  const k = -mu / (rl * rl * rl)
  return { x: r.x * k, y: r.y * k }
}

/** Dejenere (radyal / parabolik) yörüngeler için RK4 yedeği. */
function propagateNumeric(r: Vec, v: Vec, mu: number, dt: number): StateVec {
  let remaining = dt
  let cr = r
  let cv = v
  for (let i = 0; i < 4000 && remaining > 1e-9; i += 1) {
    const rl = len(cr)
    const h = Math.min(remaining, Math.max(0.01, (0.01 * rl) / Math.max(len(cv), Math.sqrt(mu / rl))))
    const a1 = gravityAccel(cr, mu)
    const r2 = add(cr, scale(cv, h / 2))
    const v2 = add(cv, scale(a1, h / 2))
    const a2 = gravityAccel(r2, mu)
    const r3 = add(cr, scale(v2, h / 2))
    const v3 = add(cv, scale(a2, h / 2))
    const a3 = gravityAccel(r3, mu)
    const r4 = add(cr, scale(v3, h))
    const v4 = add(cv, scale(a3, h))
    const a4 = gravityAccel(r4, mu)
    cr = { x: cr.x + (h / 6) * (cv.x + 2 * v2.x + 2 * v3.x + v4.x), y: cr.y + (h / 6) * (cv.y + 2 * v2.y + 2 * v3.y + v4.y) }
    cv = { x: cv.x + (h / 6) * (a1.x + 2 * a2.x + 2 * a3.x + a4.x), y: cv.y + (h / 6) * (a1.y + 2 * a2.y + 2 * a3.y + a4.y) }
    remaining -= h
  }
  return { r: cr, v: cv }
}

/** İki-cisim problemini dt kadar analitik olarak ilerletir ("raylar üstünde"). */
export function propagate(r: Vec, v: Vec, mu: number, dt: number): StateVec {
  if (dt === 0) return { r, v }
  const el = elementsFromState(r, v, mu)
  const rl = len(r)
  if (el.p < 1e-7 * rl || Math.abs(el.e - 1) < 1e-5 || !Number.isFinite(el.a) || Math.abs(el.a) < 1e-6) {
    return propagateNumeric(r, v, mu, dt)
  }
  if (el.e < 1) {
    const n = Math.sqrt(mu / (el.a * el.a * el.a))
    const E0 = Math.atan2(Math.sqrt(1 - el.e * el.e) * Math.sin(el.nu), el.e + Math.cos(el.nu))
    const M = E0 - el.e * Math.sin(E0) + n * dt
    const E = solveKepler(M, el.e)
    const nu = Math.atan2(Math.sqrt(1 - el.e * el.e) * Math.sin(E), Math.cos(E) - el.e)
    return stateAtAnomaly(el, nu, mu)
  }
  const n = Math.sqrt(mu / (-el.a * -el.a * -el.a))
  const k = Math.sqrt((el.e - 1) / (el.e + 1))
  const H0 = 2 * Math.atanh(Math.max(-0.999999999, Math.min(0.999999999, k * Math.tan(el.nu / 2))))
  const M = el.e * Math.sinh(H0) - H0 + n * dt
  if (!Number.isFinite(M)) return propagateNumeric(r, v, mu, dt)
  const H = solveKeplerHyperbolic(M, el.e)
  const nu = 2 * Math.atan(Math.tanh(H / 2) / k)
  return stateAtAnomaly(el, nu, mu)
}

/** Bir gök cisminin ebeveynine göre konumu/hızı (Kepler elemanlarından). */
export function orbitState(orbit: OrbitDef, parentMu: number, t: number): StateVec {
  const E = solveKepler(orbit.M0 + orbit.n * t, orbit.e)
  const nu = Math.atan2(Math.sqrt(1 - orbit.e * orbit.e) * Math.sin(E), Math.cos(E) - orbit.e)
  return stateAtAnomaly({ e: orbit.e, argp: orbit.argp, dir: 1, p: orbit.a * (1 - orbit.e * orbit.e) }, nu, parentMu)
}

export function bodyRelState(body: BodyDef, t: number): StateVec {
  if (!body.orbit || !body.parentId) return { r: { x: 0, y: 0 }, v: { x: 0, y: 0 } }
  return orbitState(body.orbit, BODIES[body.parentId].mu, t)
}

/** Güneş merkezli mutlak konum/hız. */
export function bodyAbsState(id: BodyId, t: number): StateVec {
  let body: BodyDef | null = BODIES[id]
  let r = { x: 0, y: 0 }
  let v = { x: 0, y: 0 }
  while (body && body.parentId) {
    const s = bodyRelState(body, t)
    r = add(r, s.r)
    v = add(v, s.v)
    body = BODIES[body.parentId]
  }
  return { r, v }
}

export const circularSpeed = (mu: number, r: number) => Math.sqrt(mu / r)

/** Vis-viva: v² = μ(2/r − 1/a). */
export const visViva = (mu: number, r: number, a: number) => Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)))

/** r1 dairesel yörüngesinden r2'ye Hohmann transferi: yakma Δv'si, süre ve hedefin gereken faz açısı. */
export function hohmann(mu: number, r1: number, r2: number, targetMeanMotion: number) {
  const a = (r1 + r2) / 2
  const dv1 = visViva(mu, r1, a) - circularSpeed(mu, r1)
  const dv2 = circularSpeed(mu, r2) - visViva(mu, r2, a)
  const time = Math.PI * Math.sqrt((a * a * a) / mu)
  const phase = wrapPi(Math.PI - targetMeanMotion * time)
  return { dv1, dv2, time, phase }
}
