/**
 * Saf araç fiziği: itki, yerçekimi, atmosfer sürüklenmesi, dönüş, iniş/çarpışma.
 * Yerçekimi aracın kütlesine değil, bulunduğu gök cisminin μ'süne bağlıdır: a = −μ·r/|r|³.
 */
import { BODIES, type BodyDef, type BodyId, solarFlux } from '../nasa/bodies'
import { partDef } from '../game/data'
import type { SasMode, Vessel } from '../game/types'
import { activeEngines, fuelGroups, runEngines, vesselStats, type VesselStats } from '../game/vessel'
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
  if (id === 'mercury') {
    return 65 * s(21 * theta + 1.1) + 34 * s(59 * theta + 0.3) + 15 * s(210 * theta) + 6 * s(1600 * theta + 2) + 2 * s(5200 * theta)
  }
  if (id === 'venus') {
    return 48 * s(13 * theta + 0.7) + 26 * s(37 * theta + 2.2) + 11 * s(190 * theta + 1) + 4 * s(1400 * theta) + 1.5 * s(4800 * theta + 1.5)
  }
  if (id === 'mars') {
    return 80 * s(19 * theta) + 40 * s(53 * theta + 1) + 16 * s(260 * theta) + 8 * s(2100 * theta) + 3 * s(6000 * theta + 2) + 1.2 * s(15000 * theta)
  }
  if (id === 'ceres') {
    return 36 * s(15 * theta + 2) + 20 * s(41 * theta) + 10 * s(150 * theta + 1) + 3.5 * s(900 * theta + 1.7) + 1.2 * s(2800 * theta)
  }
  if (id === 'ganymede') {
    return 50 * s(23 * theta + 0.4) + 24 * s(67 * theta + 1.8) + 12 * s(290 * theta) + 5 * s(1700 * theta + 2.4) + 1.6 * s(6100 * theta)
  }
  if (id === 'titan') {
    return 32 * s(11 * theta + 1.3) + 18 * s(39 * theta + 0.9) + 9 * s(180 * theta + 2) + 3 * s(1200 * theta) + 1.1 * s(4300 * theta + 0.6)
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
  let solarGen = 0
  let rtgGen = 0
  for (const p of v.parts) {
    const d = partDef(p.def)
    if (d.kind === 'solar' && p.deployed) solarGen += d.ecGen ?? 0
    if (d.kind === 'rtg') rtgGen += d.ecGen ?? 0
  }
  if (solarGen > 0) {
    const abs = bodyAbsState(v.bodyId, time)
    solarGen *= solarFlux(Math.hypot(abs.r.x + v.pos.x, abs.r.y + v.pos.y))
  }
  const gen = solarGen + rtgGen
  v.ec = Math.max(0, Math.min(st.ecCap, v.ec + gen * dt))
  return gen
}

/** İnişte dayanılabilir çarpma hızı (m/s). */
export function landingTolerance(st: VesselStats): number {
  return st.legTolerance
}

function maxThrustAvailable(v: Vessel, pressure: number): number {
  const groups = fuelGroups(v.parts)
  let total = 0
  for (const i of activeEngines(v.parts)) {
    const d = partDef(v.parts[i]!.def)
    if (d.ecUse && v.ec <= 0.1) continue
    const hasFuel = v.parts.some((p, j) => groups[j] === groups[i] && partDef(p.def).kind === 'tank' && (p.fuel ?? 0) > 0)
    if (!hasFuel) continue
    const isp = d.ispVac! + (d.ispSL! - d.ispVac!) * Math.min(1, Math.max(0, pressure))
    total += (d.thrust! * isp) / d.ispVac!
  }
  return total
}

function autoLandGuidance(v: Vessel, st: VesselStats, body: BodyDef, s: Situation, pressure: number, rho: number): number | null {
  if (!body.landable || v.landed) return null
  if (s.alt < 450) {
    for (const p of v.parts) if (partDef(p.def).kind === 'leg') p.deployed = true
  }
  if (body.atmoHeight > 0 && rho > 0.0005 && s.alt < 8000 && s.vr < 0) {
    for (const p of v.parts) if (partDef(p.def).kind === 'chute') p.deployed = true
  }
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const maxF = maxThrustAvailable(v, pressure)
  const maxAccel = maxF / Math.max(0.1, st.mass)
  const g = body.mu / (s.r * s.r)
  if (maxAccel <= 0.05) {
    v.throttle = 0
    return s.speed > 2 ? Math.atan2(-v.vel.y, -v.vel.x) : s.theta
  }
  const vh = Math.hypot(v.vel.x - s.vr * up.x, v.vel.y - s.vr * up.y)
  const aNet = Math.max(0.25, maxAccel - g)
  const brakeLimit = Math.sqrt(2 * aNet * Math.max(0, s.alt - 25)) * 0.62
  const targetVr =
    s.alt > 45
      ? -Math.max(4, Math.min(130, brakeLimit, s.alt * 0.14))
      : -1.8
  const vDes = { x: up.x * targetVr, y: up.y * targetVr }
  const dv = { x: vDes.x - v.vel.x, y: vDes.y - v.vel.y }
  const tau = s.alt < 500 ? 0.9 : 1.4
  const aCmd = { x: dv.x / tau + up.x * g, y: dv.y / tau + up.y * g }
  let targetAngle = Math.atan2(aCmd.y, aCmd.x)
  if (s.alt < 28) {
    const tilt = wrapPi(targetAngle - s.theta)
    targetAngle = s.theta + Math.max(-0.28, Math.min(0.28, tilt))
  }
  const dStop = (s.speed * s.speed) / (2 * aNet * 0.65)
  if (s.alt > 80 && s.alt > dStop * 1.6 + 180 && s.vr > targetVr * 0.85 && vh < 8) {
    v.throttle = 0
    return targetAngle
  }
  const align = Math.cos(wrapPi(v.angle - targetAngle))
  const req = len(aCmd) / maxAccel
  v.throttle = align > 0.55 ? Math.max(0, Math.min(1, req * align)) : 0
  return targetAngle
}

/** Tek bir fizik adımı (yarı-örtük Euler). Aracı yerinde değiştirir. */
export function stepPhysics(v: Vessel, dt: number, ctrl: Controls | null): StepResult {
  const body = BODIES[v.bodyId]
  const st = vesselStats(v.parts, v.cargo)
  const s = situation(v, st)
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const rho = airDensity(body, s.altSea)
  const pressure = pressureRatio(body, s.altSea)
  const autoTarget = v.autoLand ? autoLandGuidance(v, st, body, s, pressure, rho) : null
  const out = runEngines(v.parts, v.throttle, pressure, dt, v.ec)
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
  const forcedTarget = chuting ? Math.atan2(-v.vel.y, -v.vel.x) : autoTarget
  rotateVessel(v, st, dt, ctrl, forcedTarget)

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
    return r2 < body.radius ? { firing: out.firing, crash: `${body.name} atmosferinde yok oldu` } : { firing: out.firing }
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
      v.autoLand = false
      v.throttle = 0
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
  if (burning || v.autoLand) return true
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
