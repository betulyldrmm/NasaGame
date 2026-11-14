/**
 * Saf araç fiziği: itki, yerçekimi, atmosfer sürüklenmesi, dönüş, iniş/çarpışma.
 * Yerçekimi aracın kütlesine değil, bulunduğu gök cisminin μ'süne bağlıdır: a = −μ·r/|r|³.
 */
import { BODIES, type BodyDef, type BodyId, solarFlux } from '../nasa/bodies'
import { partDef } from '../game/data'
import type { SasMode, Vessel } from '../game/types'
import { activeEngines, runEngines, vesselStats, type VesselStats } from '../game/vessel'
import { bodyAbsState, len, propagate, wrapPi } from './orbit'

/** Fırlatma rampasının Dünya üzerindeki açısı (gezegenin "tepesi"). */
export const PAD_ANGLE = Math.PI / 2

export interface Controls {
  /** −1 sola (saat yönünün tersi), +1 sağa */
  rotate: number
  /** RCS öteleme, gemi ekseninde: tx sağ, ty ileri */
  tx: number
  ty: number
}

export interface StepResult {
  firing: Map<number, number>
  crash?: string
  touchdown?: boolean
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Yüzey engebesi (m). Tam sayı frekanslar 2π'de süreklilik sağlar. Rampa çevresi düzdür. */
export function terrainHeight(id: BodyId, theta: number): number {
  const s = Math.sin
  if (id === 'moon') {
    return 55 * s(17 * theta + 0.5) + 30 * s(43 * theta + 2) + 14 * s(170 * theta) + 5 * s(1300 * theta + 1) + 1.8 * s(3700 * theta + 3) + 0.7 * s(9100 * theta)
  }
  if (id === 'mars') {
    return 80 * s(19 * theta) + 40 * s(53 * theta + 1) + 16 * s(260 * theta) + 8 * s(2100 * theta) + 3 * s(6000 * theta + 2) + 1.2 * s(15000 * theta)
  }
  if (id === 'earth') {
    const f = smooth(0.004, 0.03, Math.abs(wrapPi(theta - PAD_ANGLE)))
    return f * (40 * s(23 * theta) + 22 * s(61 * theta + 1) + 9 * s(410 * theta + 2) + 3.5 * s(1900 * theta) + 1.6 * s(9000 * theta + 1))
  }
  return 0
}

/** Üstel atmosfer modeli: ρ(h) = ρ0·e^(−h/H). */
export function airDensity(body: BodyDef, altSea: number): number {
  if (body.atmoHeight <= 0 || altSea >= body.atmoHeight) return 0
  return body.rho0 * Math.exp(-Math.max(0, altSea) / body.scaleHeight)
}

/** Dünya deniz seviyesine göre basınç oranı (motor Isp'si için). */
export function pressureRatio(body: BodyDef, altSea: number): number {
  return airDensity(body, altSea) / BODIES.earth.rho0
}

export interface Situation {
  r: number
  theta: number
  /** en alt parçanın yüzeye yüksekliği */
  alt: number
  /** ortalama yarıçapa göre irtifa */
  altSea: number
  speed: number
  /** dikey hız (+ yukarı) */
  vr: number
}

export function situation(v: Vessel, st: VesselStats = vesselStats(v.parts, v.cargo)): Situation {
  const body = BODIES[v.bodyId]
  const r = len(v.pos)
  const theta = Math.atan2(v.pos.y, v.pos.x)
  const bottom = st.maxY - st.comY
  return {
    r,
    theta,
    alt: r - body.radius - terrainHeight(body.id, theta) - bottom,
    altSea: r - body.radius - bottom,
    speed: len(v.vel),
    vr: (v.vel.x * v.pos.x + v.vel.y * v.pos.y) / r,
  }
}

function sasTarget(v: Vessel, mode: SasMode): number | null {
  if (mode === 'radial') return Math.atan2(v.pos.y, v.pos.x)
  if (len(v.vel) < 0.5) return null
  const pro = Math.atan2(v.vel.y, v.vel.x)
  if (mode === 'prograde') return pro
  if (mode === 'retrograde') return pro + Math.PI
  return null
}

/** Tepki tekerleği / RCS ile dönüş. Hem fizik adımında hem "raylar üstünde" kullanılır. */
export function rotateVessel(v: Vessel, st: VesselStats, dt: number, ctrl: Controls | null, forcedTarget: number | null = null) {
  if (!st.hasCommand) {
    v.angle = wrapPi(v.angle + v.angVel * dt)
    return
  }
  const maxAcc = 1.5 * (v.rcsOn && st.rcs > 0 ? 1.8 : 1)
  let acc: number
  if (ctrl && ctrl.rotate !== 0) {
    acc = -ctrl.rotate * maxAcc
  } else {
    const target = forcedTarget ?? sasTarget(v, v.sas)
    acc = target === null ? -3 * v.angVel : 7 * wrapPi(target - v.angle) - 4.5 * v.angVel
    acc = Math.max(-maxAcc, Math.min(maxAcc, acc))
  }
  v.angVel = Math.max(-2.5, Math.min(2.5, v.angVel + acc * dt))
  v.angle = wrapPi(v.angle + v.angVel * dt)
}

export function chargeBatteries(v: Vessel, st: VesselStats, time: number, dt: number) {
  let gen = 0
  for (const p of v.parts) {
    const d = partDef(p.def)
    if (d.kind === 'solar' && p.deployed) gen += d.ecGen ?? 0
  }
  if (gen > 0) {
    const abs = bodyAbsState(v.bodyId, time)
    gen *= solarFlux(Math.hypot(abs.r.x + v.pos.x, abs.r.y + v.pos.y))
  }
  v.ec = Math.max(0, Math.min(st.ecCap, v.ec + gen * dt))
  return gen
}

/** İnişte dayanılabilir çarpma hızı (m/s). */
export function landingTolerance(st: VesselStats): number {
  return st.legsDeployed >= 2 ? 14 : 7
}

/** Tek bir fizik adımı (yarı-örtük Euler). Aracı yerinde değiştirir. */
export function stepPhysics(v: Vessel, dt: number, ctrl: Controls | null): StepResult {
  const body = BODIES[v.bodyId]
  const st = vesselStats(v.parts, v.cargo)
  const s = situation(v, st)
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const rho = airDensity(body, s.altSea)
  const out = runEngines(v.parts, v.throttle, pressureRatio(body, s.altSea), dt, v.ec)
  v.ec -= out.ecUsed
  const fwd = { x: Math.cos(v.angle), y: Math.sin(v.angle) }
  const mass = st.mass
  let ax = (fwd.x * out.thrust) / mass
  let ay = (fwd.y * out.thrust) / mass
  v.dvUsed += (out.thrust / mass) * dt

  if (ctrl && v.rcsOn && st.rcs > 0 && (ctrl.tx !== 0 || ctrl.ty !== 0)) {
    const acc = 0.6 * Math.min(2, st.rcs / 2)
    const right = { x: fwd.y, y: -fwd.x }
    ax += (right.x * ctrl.tx + fwd.x * ctrl.ty) * acc
    ay += (right.y * ctrl.tx + fwd.y * ctrl.ty) * acc
    v.dvUsed += acc * dt
  }

  const g = body.mu / (s.r * s.r)

  if (v.landed) {
    const lift = (out.thrust / mass) * (fwd.x * up.x + fwd.y * up.y)
    if (lift <= g * 1.001) {
      v.vel = { x: 0, y: 0 }
      v.angVel = 0
      return { firing: out.firing }
    }
    v.landed = false
    v.pos = { x: v.pos.x + up.x * 0.05, y: v.pos.y + up.y * 0.05 }
  }

  ax -= up.x * g
  ay -= up.y * g

  // Paraşüt açıkken araç hız vektörünün tersine (burun yukarı) döner.
  const chuting = st.chutesDeployed > 0 && rho > 0.0005 && s.speed > 2
  rotateVessel(v, st, dt, ctrl, chuting ? Math.atan2(-v.vel.y, -v.vel.x) : null)

  v.vel = { x: v.vel.x + ax * dt, y: v.vel.y + ay * dt }

  if (rho > 0 && s.speed > 0.05) {
    const width = st.maxX - st.minX
    const cdA = (st.hasNose ? 0.3 : 0.6) * width * 1.2 + st.chutesDeployed * 420
    const dragAcc = (0.5 * rho * s.speed * s.speed * cdA) / 1000 / mass
    const sp = len(v.vel)
    const k = Math.max(0, 1 - Math.min(sp, dragAcc * dt) / Math.max(sp, 1e-6))
    v.vel = { x: v.vel.x * k, y: v.vel.y * k }
  }

  v.pos = { x: v.pos.x + v.vel.x * dt, y: v.pos.y + v.vel.y * dt }

  const r2 = len(v.pos)
  if (!body.landable) {
    return r2 < body.radius ? { firing: out.firing, crash: 'Güneş\'te buharlaştı' } : { firing: out.firing }
  }
  const theta2 = Math.atan2(v.pos.y, v.pos.x)
  const bottom = st.maxY - st.comY
  const groundR = body.radius + terrainHeight(body.id, theta2) + bottom
  if (r2 <= groundR) {
    const up2 = { x: v.pos.x / r2, y: v.pos.y / r2 }
    const vr = v.vel.x * up2.x + v.vel.y * up2.y
    v.pos = { x: up2.x * groundR, y: up2.y * groundR }
    if (vr <= 0) {
      const speed = len(v.vel)
      const tilt = Math.abs(wrapPi(v.angle - theta2))
      if (speed > landingTolerance(st)) return { firing: out.firing, crash: `${speed.toFixed(0)} m/s hızla yüzeye çarptı` }
      if (tilt > 0.75) return { firing: out.firing, crash: 'yan yattı ve parçalandı' }
      v.landed = true
      v.vel = { x: 0, y: 0 }
      v.angVel = 0
      v.angle = theta2
      return { firing: out.firing, touchdown: true }
    }
  }
  return { firing: out.firing }
}

/** Araç şu an sayısal fiziğe mi ihtiyaç duyuyor (itki, atmosfer, yüzeye yakınlık)? */
export function needsPhysics(v: Vessel, ctrl: Controls | null): boolean {
  const st = vesselStats(v.parts, v.cargo)
  const burning = v.throttle > 0 && st.fuel > 0 && activeEngines(v.parts).length > 0
  if (v.landed) return burning
  if (burning) return true
  if (ctrl && v.rcsOn && st.rcs > 0 && (ctrl.tx !== 0 || ctrl.ty !== 0)) return true
  const body = BODIES[v.bodyId]
  const s = situation(v, st)
  return s.altSea < body.atmoHeight || (body.landable && s.alt < 1500)
}

/** Motorlar kapalıyken Kepler yörüngesinde analitik ilerleme. */
export function stepRails(v: Vessel, dt: number) {
  const next = propagate(v.pos, v.vel, BODIES[v.bodyId].mu, dt)
  v.pos = next.r
  v.vel = next.v
}
