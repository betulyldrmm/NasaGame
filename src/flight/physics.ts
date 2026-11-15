/**
 * Saf araç fiziği: itki, yerçekimi, atmosfer sürüklenmesi, dönüş, iniş/çarpışma.
 * Yerçekimi aracın kütlesine değil, bulunduğu gök cisminin μ'süne bağlıdır: a = −μ·r/|r|³.
 */
import { BODIES, type BodyDef, type BodyId, solarFlux } from '../nasa/bodies'
import { partDef } from '../game/data'
import type { AutopilotMode, SasMode, Vessel } from '../game/types'
import { activeEngines, fuelGroups, runEngines, vesselStats, type VesselStats } from '../game/vessel'
import { bodyAbsState, elementsFromState, len, propagate, wrapPi } from './orbit'

/** Fırlatma rampasının Dünya üzerindeki açısı (gezegenin "tepesi"). */
export const PAD_ANGLE = Math.PI / 2

export interface Controls {
  /** −1 sola (saat yönünün tersi), +1 sağa */
  rotate: number
  /** RCS öteleme, gemi ekseninde: tx sağ, ty ileri */
  tx: number
  ty: number
  /** Çok oyunculu: istemcinin kendi aracında yerelde hesapladığı burun yönü (anında tepki için) */
  vid?: number
  angle?: number
  angVel?: number
  /** ev sahibi bu yön bilgisini bir kez uyguladı mı */
  applied?: boolean
}

export interface StepResult {
  firing: Map<number, number>
  crash?: string
  /** çarpma anındaki hız (m/s) */
  crashSpeed?: number
  touchdown?: boolean
  touchdownSpeed?: number
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
export function rotateVessel(
  v: Vessel,
  st: VesselStats,
  dt: number,
  ctrl: Controls | null,
  forcedTarget: number | null = null,
  manualScale = 1,
) {
  if (!st.hasCommand) {
    v.angle = wrapPi(v.angle + v.angVel * dt)
    return
  }
  // Büyük roketler daha oturaklı, hafif sondalar daha çevik döner; aşırı savrulma önlenir.
  const massScale = Math.max(0.45, Math.min(1.15, Math.sqrt(10 / Math.max(2.5, st.mass))))
  const rcsBoost = v.rcsOn && st.rcs > 0 ? 1.45 : 1
  const manualMaxAcc = 0.95 * massScale * rcsBoost
  const autoMaxAcc = 1.65 * Math.max(0.7, massScale) * rcsBoost
  const maxManualVel = 1.15 * (v.rcsOn && st.rcs > 0 ? 1.2 : 1)
  const maxAutoVel = 1.65

  if (!forcedTarget && ctrl && ctrl.rotate !== 0) {
    const mdt = dt * manualScale
    const acc = -ctrl.rotate * manualMaxAcc
    v.angVel = Math.max(-maxManualVel, Math.min(maxManualVel, v.angVel + acc * mdt))
    v.angle = wrapPi(v.angle + v.angVel * mdt)
    return
  }

  const target = forcedTarget ?? sasTarget(v, v.sas)
  if (target === null) {
    const dampDt = Math.min(dt * manualScale, 0.25)
    v.angVel += -6.0 * v.angVel * dampDt
    if (Math.abs(v.angVel) < 0.004) v.angVel = 0
    v.angle = wrapPi(v.angle + v.angVel * dampDt)
    return
  }

  // Zaman hızlandırmada (büyük adım) PD denetleyici kararsızlaşıp gemiyi fırıl fırıl döndürür;
  // bu durumda hedefe sabit hızla, taşmadan dön.
  if (dt > 0.06) {
    const err = wrapPi(target - v.angle)
    const step = Math.max(-maxAutoVel * dt, Math.min(maxAutoVel * dt, err))
    v.angle = wrapPi(v.angle + step)
    v.angVel = 0
    return
  }
  const acc = Math.max(-autoMaxAcc, Math.min(autoMaxAcc, 7.5 * wrapPi(target - v.angle) - 5.2 * v.angVel))
  v.angVel = Math.max(-maxAutoVel, Math.min(maxAutoVel, v.angVel + acc * dt))
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

export function effectiveAutopilot(v: Vessel): AutopilotMode {
  return v.autopilot ?? (v.autoLand ? 'land' : 'off')
}

export function safeOrbitAlt(body: BodyDef): number {
  if (body.atmoHeight > 0) return body.atmoHeight + Math.max(15_000, Math.round(body.radius * 0.045))
  return Math.max(8_000, Math.min(24_000, Math.round(body.radius * 0.14)))
}

/** Yakalama aşamasında şu an motor yakılmalı mı? (rehberlik ve ray/fizik seçimi ortak kullanır) */
const CORRECTION_NOTE = 'Çarpışma rotası düzeltiliyor…'

function captureWantsBurn(body: BodyDef, s: Situation, el: ReturnType<typeof elementsFromState>): boolean {
  const targetR = body.radius + safeOrbitAlt(body)
  const safePeri = body.radius + (body.atmoHeight > 0 ? body.atmoHeight + 4000 : Math.max(4000, safeOrbitAlt(body) * 0.5))
  if (el.rp < safePeri) return true
  if (el.rp > targetR * 3) return s.speed > 20
  // Yakalama yanışı enberi çevresinde yapılır (gerçek anomali ±0,7 rad): en az yakıtla en çok etki.
  if (Math.abs(el.nu) < 0.7) return true
  return s.vr >= 0 && (el.e >= 1 || el.ra > body.soi * 0.98) && s.speed > 20
}

function autoOrbitGuidance(
  v: Vessel,
  st: VesselStats,
  body: BodyDef,
  s: Situation,
  pressure: number,
  parkingOnly = false,
): number | null {
  if (body.id === 'sun') {
    v.throttle = 0
    v.autopilot = 'off'
    v.autopilotNote = undefined
    return null
  }
  const el = elementsFromState(v.pos, v.vel, body.mu)
  const targetAlt = safeOrbitAlt(body)
  const targetR = body.radius + targetAlt
  const safePeri = body.radius + (body.atmoHeight > 0 ? body.atmoHeight + 4000 : Math.max(4000, targetAlt * 0.5))
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const vt = v.vel.x * -up.y + v.vel.y * up.x
  const spin = Math.abs(vt) > 15 ? (vt >= 0 ? 1 : -1) : -1
  const tanAngle = s.theta + spin * (Math.PI / 2)

  // Kapalı, güvenli ve yeterince dairesel yörüngeye ulaşıldı mı?
  if (!v.landed && el.e < 0.075 && el.rp >= safePeri && el.ra < body.soi * 0.85) {
    v.throttle = 0
    if (!parkingOnly) {
      v.autopilot = 'off'
      v.autopilotNote = undefined
      v.approachWarn = null
    }
    v.captureLatch = false
    v.sas = 'prograde'
    return Math.atan2(v.vel.y, v.vel.x)
  }

  const maxF = maxThrustAvailable(v, pressure)
  const maxAccel = maxF / Math.max(0.1, st.mass)
  if (maxAccel <= 0.05) {
    v.throttle = 0
    v.autopilotNote = 'Yörünge otopilotu: bu kademede yakıt yok!'
    return Math.atan2(v.vel.y || up.y, v.vel.x || up.x)
  }

  // Güvenli ama eliptik yörünge (varış sonrası): enberide geri yönde yakıp daireselleştir.
  if (!v.landed && el.e < 1 && el.rp >= safePeri && el.ra <= body.soi * 0.85) {
    const retro = s.speed > 20 ? Math.atan2(-v.vel.y, -v.vel.x) : v.angle
    if (Math.abs(el.nu) < 0.45) v.captureLatch = true
    if (!v.captureLatch) {
      v.throttle = 0
      v.autopilotNote = 'Enberiye süzülüyor (daireselleştirme beklemede)…'
      return retro
    }
    const align = Math.cos(wrapPi(v.angle - retro))
    v.throttle = align > 0.5 ? Math.max(0.15, Math.min(1, el.e * 5)) : 0
    v.autopilotNote = `${body.name} yörüngesi daireselleştiriliyor…`
    return retro
  }

  // Hiperbolik geliş veya taşmış elips → önce enberiyi alçalt, sonra enberide yakala
  if (!v.landed && (el.e >= 1 || el.ra > body.soi * 0.85)) {
    // Hız çok düşükken "geri yön" belirsizdir; gemi kendi etrafında dönmesin diye mevcut yön korunur.
    const retro = s.speed > 20 ? Math.atan2(-v.vel.y, -v.vel.x) : v.angle
    // Çarpışma rotasında ve henüz uzaktayken: hıza dik, gezegenden dışarı doğru kısa bir düzeltme
    // yanışı enberiyi çok az yakıtla güvenli yüksekliğe çıkarır (geri yanış enberiyi daha da düşürürdü).
    const midPeri = (safePeri + targetR) / 2
    const correcting = v.autopilotNote === CORRECTION_NOTE
    if (s.speed > 20 && s.r > targetR * 2 && (el.rp < safePeri || (correcting && el.rp < midPeri))) {
      const velA = Math.atan2(v.vel.y, v.vel.x)
      const out = Math.cos(velA + Math.PI / 2 - s.theta) > Math.cos(velA - Math.PI / 2 - s.theta) ? velA + Math.PI / 2 : velA - Math.PI / 2
      const align = Math.cos(wrapPi(v.angle - out))
      v.captureLatch = false
      v.throttle = align > 0.6 ? Math.max(0.15, Math.min(1, (midPeri - el.rp) / Math.max(1, targetR * 0.25))) : 0
      v.autopilotNote = CORRECTION_NOTE
      return out
    }
    const lowering = el.rp > targetR * 3
    if (!lowering && Math.abs(el.nu) < 0.7) v.captureLatch = true
    if (lowering) v.captureLatch = false
    if (!v.captureLatch && !captureWantsBurn(body, s, el)) {
      v.throttle = 0
      v.autopilotNote = `${body.name} yörünge yakalaması için yaklaşılıyor…`
      return retro
    }
    const target = el.rp < safePeri ? wrapPi(retro + wrapPi(s.theta - retro) * 0.35) : retro
    const align = Math.cos(wrapPi(v.angle - target))
    const gentle = el.rp > targetR * 3 ? Math.max(0.2, Math.min(1, (el.rp - targetR * 2.6) / targetR)) : 1
    v.throttle = align > 0.45 ? gentle : 0
    v.autopilotNote = el.rp > targetR * 3 ? `${body.name} yaklaşma yörüngesi alçaltılıyor…` : `${body.name} yörünge yakalama yanışı…`
    return target
  }

  v.captureLatch = false

  // Yükseliş: öte noktayı hedef irtifaya çıkar. Eğim hem irtifaya hem öte noktanın hedefe
  // yakınlığına bağlıdır; güçlü roketler dik çıkıp yatay hızsız kalmaz.
  const vCirc = Math.sqrt(body.mu / Math.max(s.r, body.radius + 1))
  const vtAbs = Math.abs(vt)
  const raAlt = el.e < 1 && Number.isFinite(el.ra) && !v.landed ? el.ra - body.radius : 0
  if (v.landed || (raAlt < targetAlt * 0.985 && s.vr > -2 && el.rp < safePeri)) {
    const startTurn = body.atmoHeight > 0 ? 450 : 90
    const endTurn = Math.max(startTurn + 1200, targetAlt * (body.atmoHeight > 0 ? 0.55 : 0.38))
    const tiltAlt = s.alt < startTurn ? 0 : smooth(startTurn, endTurn, Math.max(0, s.altSea)) * 1.46
    const gate = body.atmoHeight > 0 ? 5000 : 500
    const tiltAp = 1.5 * Math.max(0, Math.min(1, (raAlt / targetAlt - (body.atmoHeight > 0 ? 0.2 : 0.03)) / (body.atmoHeight > 0 ? 0.7 : 0.45))) * smooth(startTurn, startTurn + gate, Math.max(0, s.altSea))
    const tilt = Math.max(tiltAlt, tiltAp)
    const targetAngle = s.theta + spin * tilt
    const align = Math.cos(wrapPi(v.angle - targetAngle))
    v.throttle = s.alt < startTurn || align > 0.35 ? (raAlt > targetAlt * 0.94 ? 0.5 : 1) : 0
    v.autopilotNote = `${body.name} yörünge tırmanışı…`
    return targetAngle
  }

  // Öte noktaya süzülme: yanış süresinin yarısı kadar önce ateşle
  const need = Math.max(0, vCirc - vtAbs)
  const burnTime = need / Math.max(0.1, maxAccel)
  const toAp = s.vr > 0 ? (el.ra - s.r) / Math.max(5, s.vr) : 0
  if (s.vr > 0 && toAp > burnTime * 0.5 + 4 && el.rp < safePeri && s.altSea >= body.atmoHeight * 0.9) {
    v.throttle = 0
    v.autopilotNote = 'Öte noktaya süzülüyor (daireselleştirme beklemede)…'
    return tanAngle
  }

  // Daireselleştirme: yatay yak, dikey hızı sıfırda tut (düşüyorsa burnu hafif yukarı kaldır)
  const pitch = Math.max(-0.5, Math.min(0.7, -s.vr * 0.012))
  const targetAngle = tanAngle - spin * pitch
  const align = Math.cos(wrapPi(v.angle - targetAngle))
  v.throttle = align > 0.5 ? Math.max(0.2, Math.min(1, need / 25 + (s.vr < -3 ? 0.5 : 0))) : 0
  v.autopilotNote = `${body.name} yörüngesi daireselleştiriliyor…`
  return targetAngle
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
    v.autopilotNote = 'Oto-İniş: yakıt yok!'
    return s.speed > 2 ? Math.atan2(-v.vel.y, -v.vel.x) : s.theta
  }
  const vh = Math.hypot(v.vel.x - s.vr * up.x, v.vel.y - s.vr * up.y)
  const aNet = Math.max(0.25, maxAccel - g)
  const brakeLimit = Math.sqrt(2 * aNet * Math.max(0, s.alt - 25)) * 0.62
  const targetVr =
    s.alt > 2500 && vh > 35
      ? -Math.min(40, Math.max(6, s.alt * 0.015))
      : s.alt > 45
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
  if (s.alt > 80 && vh < 15 && s.alt > dStop * 1.6 + 180 && s.vr > targetVr * 0.85) {
    v.throttle = 0
    v.autopilotNote = 'Oto-İniş: kontrollü alçalma…'
    return targetAngle
  }
  const align = Math.cos(wrapPi(v.angle - targetAngle))
  const req = len(aCmd) / maxAccel
  v.throttle = align > 0.55 ? Math.max(0, Math.min(1, req * align)) : 0
  v.autopilotNote = vh > 35 ? 'Oto-İniş: yörünge hızı düşürülüyor…' : 'Oto-İniş: dikey iniş freni…'
  return targetAngle
}

/** Tek bir fizik adımı (yarı-örtük Euler). Aracı yerinde değiştirir. */
export function stepPhysics(
  v: Vessel,
  dt: number,
  ctrl: Controls | null,
  manualScale = 1,
  externalAutoTarget: number | null = null,
): StepResult {
  const body = BODIES[v.bodyId]
  const st = vesselStats(v.parts, v.cargo)
  const s = situation(v, st)
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const rho = airDensity(body, s.altSea)
  const pressure = pressureRatio(body, s.altSea)
  const ap = effectiveAutopilot(v)
  const autoTarget =
    externalAutoTarget !== null
      ? externalAutoTarget
      : ap === 'land'
        ? autoLandGuidance(v, st, body, s, pressure, rho)
        : ap === 'orbit' || ap === 'transfer'
          ? autoOrbitGuidance(v, st, body, s, pressure, ap === 'transfer')
          : null
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
  rotateVessel(v, st, dt, ctrl, forcedTarget, manualScale)

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
      if (speed > landingTolerance(st)) return { firing: out.firing, crash: `${speed.toFixed(0)} m/s hızla yüzeye çarptı`, crashSpeed: speed }
      if (tilt > 0.75) return { firing: out.firing, crash: 'yan yattı ve parçalandı', crashSpeed: landingTolerance(st) * 2 }
      v.landed = true
      v.autoLand = false
      v.autopilot = 'off'
      v.autopilotNote = undefined
      v.approachWarn = null
      v.throttle = 0
      v.vel = { x: 0, y: 0 }
      v.angVel = 0
      v.angle = theta2
      return { firing: out.firing, touchdown: true, touchdownSpeed: speed }
    }
  }
  return { firing: out.firing }
}

/**
 * Yörünge otopilotu şu an yalnızca süzülüyorsa bir sonraki yanışa kalan süreyi (s) döndürür;
 * motor/rehberlik gerekiyorsa null. Süzülürken araç raylara geçer ve zaman hızlandırılabilir.
 */
export function orbitCoastWait(v: Vessel, body: BodyDef, s: Situation): number | null {
  if (v.landed || v.throttle > 0 || v.captureLatch) return null
  const el = elementsFromState(v.pos, v.vel, body.mu)
  const targetR = body.radius + safeOrbitAlt(body)
  const safePeri = body.radius + (body.atmoHeight > 0 ? body.atmoHeight + 4000 : Math.max(4000, safeOrbitAlt(body) * 0.5))
  const open = el.e >= 1 || el.ra > body.soi * 0.85
  if (open || el.rp >= safePeri) {
    if (el.e < 0.075 && !open) return null
    if (open && captureWantsBurn(body, s, el)) return null
    const lim = open ? 0.7 : 0.45
    if (Math.abs(el.nu) < lim) return null
    if (s.vr < 0) return (s.r - el.p / (1 + el.e * Math.cos(lim))) / Math.max(1, -s.vr) - 15
    return el.e < 1 ? el.period * 0.3 : 600
  }
  if (el.ra < targetR * 0.985 || s.vr <= 0) return null
  const wait = (el.ra - s.r) / Math.max(1, s.vr) - 90
  return wait > 0 ? wait : null
}

/** Araç şu an sayısal fiziğe mi ihtiyaç duyuyor (itki, atmosfer, yüzeye yakınlık)? */
export function needsPhysics(v: Vessel, ctrl: Controls | null): boolean {
  const st = vesselStats(v.parts, v.cargo)
  const burning = v.throttle > 0 && st.fuel > 0 && activeEngines(v.parts).length > 0
  const ap = effectiveAutopilot(v)
  if (v.landed) return burning || ap === 'orbit' || ap === 'transfer'
  if (burning || ap === 'land') return true
  if (v.debris) return true
  const body = BODIES[v.bodyId]
  const s = situation(v, st)
  if (s.altSea < body.atmoHeight || (body.landable && s.alt < 1500)) return true
  if (ap === 'orbit') return orbitCoastWait(v, body, s) === null
  if (ap === 'transfer') {
    if (body.id !== 'sun') {
      const el = elementsFromState(v.pos, v.vel, body.mu)
      const safeAlt = safeOrbitAlt(body)
      const safePeri = body.radius + (body.atmoHeight > 0 ? body.atmoHeight + 4000 : Math.max(4000, safeAlt * 0.5))
      if (el.rp < safePeri || (el.e < 1 && el.ra < body.radius + safeAlt * 0.78)) return true
    }
    return false
  }
  return !!(ctrl && v.rcsOn && st.rcs > 0 && (ctrl.tx !== 0 || ctrl.ty !== 0))
}

/** Motorlar kapalıyken Kepler yörüngesinde analitik ilerleme. */
export function stepRails(v: Vessel, dt: number) {
  const next = propagate(v.pos, v.vel, BODIES[v.bodyId].mu, dt)
  v.pos = next.r
  v.vel = next.v
}
