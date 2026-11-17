/**
 * Saf araç fiziği: itki, yerçekimi, atmosfer sürüklenmesi, dönüş, iniş/çarpışma.
 * Yerçekimi aracın kütlesine değil, bulunduğu gök cisminin μ'süne bağlıdır: a = −μ·r/|r|³.
 */
import { BODIES, type BodyDef, type BodyId, solarFlux } from '../nasa/bodies'
import { quadrantCenterAngle, quadrantOfAngle, QUADRANT_SHORT, type QuadrantId } from '../game/base'
import { partDef } from '../game/data'
import type { AutopilotMode, SasMode, Vessel } from '../game/types'
import { activeEngines, arcade, ARCADE_DRAG, fuelGroups, runEngines, vesselStats, type VesselStats } from '../game/vessel'
import { bodyAbsState, elementsFromState, len, propagate, wrapPi } from './orbit'

export interface FollowLeaderRef {
  name: string
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  angle: number
  landed: boolean
  throttle: number
  accel: number
  slotIndex: number
}

/** Fırlatma rampasının Dünya üzerindeki açısı (gezegenin "tepesi"). */
export const PAD_ANGLE = Math.PI / 2

export interface Controls {
  /** −1 sola (saat yönünün tersi), +1 sağa */
  rotate: number
  /** RCS öteleme, gemi ekseninde: tx sağ, ty ileri */
  tx: number
  ty: number
  /** Silah ateşi (F veya Sağ Tık / Sol Tık Nişan) */
  fire?: boolean
  /** FTL stili seçili silah anahtarı (def.id — aynı türdeki tüm bağlı tareti ateşler) */
  weaponKey?: string
  /** Aktif silah grubu (geriye dönük uyumluluk için tutulur) */
  fireGroup?: 0 | 1 | 2 | 3
  /** Dünya ekseninde nişan açısı (rad) ve imleç mesafesi (m) */
  aimAngle?: number
  aimDist?: number
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
    const f = smooth(0.008, 0.035, Math.abs(wrapPi(theta - PAD_ANGLE)))
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
  const r = Math.max(1e-6, len(v.pos))
  const theta = Math.atan2(v.pos.y, v.pos.x)
  const bottom = v.parts.length > 0 ? st.maxY - st.comY : 0
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
  // Arcade uçuşta gemiler çok daha çevik döner.
  const agile = arcade.on ? 2.6 : 1
  const manualMaxAcc = 0.95 * massScale * rcsBoost * agile
  const autoMaxAcc = 1.65 * Math.max(0.7, massScale) * rcsBoost * agile
  const maxManualVel = 1.15 * (v.rcsOn && st.rcs > 0 ? 1.2 : 1) * (arcade.on ? 1.9 : 1)
  const maxAutoVel = 1.65 * (arcade.on ? 1.9 : 1)

  if (forcedTarget === null && ctrl && ctrl.rotate !== 0) {
    const mdt = dt * manualScale
    const acc = -Math.max(-1, Math.min(1, ctrl.rotate)) * manualMaxAcc
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
    if (d.kind === 'command' && d.ecGen) rtgGen += d.ecGen
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
    if (d.electricFan) {
      if (v.ec <= 0.1) continue
      const airBoost = pressure > 0.05 ? 1 + Math.min(0.4, pressure * 0.35) : 0.92
      total += d.thrust! * airBoost
      continue
    }
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
    return s.speed > 0.1 ? Math.atan2(v.vel.y, v.vel.x) : Math.atan2(up.y, up.x)
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
  if (v.landed || (raAlt < targetAlt * 0.985 && s.vr > -15 && el.rp < safePeri)) {
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
  if (s.vr > 0 && toAp > burnTime * 0.5 + 4 && el.rp < safePeri && s.altSea >= body.atmoHeight * (parkingOnly ? 1 : 0.9)) {
    v.throttle = 0
    v.autopilotNote = 'Öte noktaya süzülüyor (daireselleştirme beklemede)…'
    return tanAngle
  }

  // Daireselleştirme: yatay yak, dikey hızı sıfırda tut (düşüyorsa burnu hafif yukarı kaldır)
  const pitch = Math.max(-0.5, Math.min(0.7, -s.vr * 0.012))
  const targetAngle = tanAngle - spin * pitch
  const align = Math.cos(wrapPi(v.angle - targetAngle))
  const circNeed = need > 0.5 ? Math.max(0.2, Math.min(1, need / 25)) : 0
  v.throttle = align > 0.5 ? Math.max(circNeed, s.vr < -3 ? 0.5 : 0) : 0
  v.autopilotNote = `${body.name} yörüngesi daireselleştiriliyor…`
  return targetAngle
}

function autoLandGuidance(v: Vessel, st: VesselStats, body: BodyDef, s: Situation, pressure: number, rho: number): number | null {
  if (!body.landable || v.landed) return null
  const maxF = maxThrustAvailable(v, pressure)
  const maxAccel = maxF / Math.max(0.1, st.mass)
  const g = body.mu / (s.r * s.r)
  const canHover = maxAccel > g * 1.05
  if (s.alt < 450) {
    for (const p of v.parts) if (partDef(p.def).kind === 'leg') p.deployed = true
  }
  const chuteAlt = canHover ? 550 : rho >= 0.08 ? (maxAccel <= 0.05 ? 1600 : 1100) : 4500
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const tan = { x: -up.y, y: up.x }
  const vt = v.vel.x * tan.x + v.vel.y * tan.y
  const vh = Math.abs(vt)
  if (body.atmoHeight > 0 && rho > 0.0004 && s.alt < chuteAlt && (s.vr < -2 || s.speed > 55) && (!canHover || vh < 120 || s.alt < 420)) {
    for (const p of v.parts) if (partDef(p.def).kind === 'chute') p.deployed = true
  }
  const chuteActive = body.atmoHeight > 0 && st.chutesDeployed > 0 && rho > 0.0004
  const tol = landingTolerance(st)
  const coastAim = s.alt < 80 ? s.theta : s.vr <= -2 ? Math.atan2(-v.vel.y, -v.vel.x) : s.theta
  if (maxAccel <= 0.05) {
    v.throttle = 0
    v.autopilotNote = chuteActive ? 'Oto-İniş: paraşütle alçalış…' : 'Oto-İniş: yakıt yok!'
    return coastAim
  }

  // Motor itkisi yerel yerçekimini yenemiyorsa (ör. kalın atmosferde vakum motoru): yatay hızı sıfırla,
  // kalan düşüşte yakıtı gereksiz yere yakma ve yalnızca yüzeye yakın frenleyip paraşüte destek ol.
  if (!canHover) {
    if (!chuteActive && vh > 14 && !(rho > 0.12 && vh < 45)) {
      const aTan = -Math.sign(vt) * maxAccel
      const targetAngle = Math.atan2(tan.y * aTan, tan.x * aTan)
      const align = Math.cos(wrapPi(v.angle - targetAngle))
      v.throttle = align > 0.35 ? Math.min(1, Math.max(0.25, vh / 18)) : 0
      v.autopilotNote = 'Oto-İniş: yörünge hızı düşürülüyor…'
      return targetAngle
    }
    const needCushion = chuteActive
      ? s.alt < 150 && s.vr < -Math.min(5.5, tol * 0.55)
      : s.alt < Math.min(500, Math.max(120, (s.speed * s.speed) / Math.max(0.5, 2 * maxAccel) * 2.2)) && s.vr < -Math.min(4.5, tol * 0.45)
    if (!needCushion) {
      v.throttle = 0
      v.autopilotNote = chuteActive ? 'Oto-İniş: paraşütle alçalış…' : 'Oto-İniş: kontrollü alçalma…'
      return coastAim
    }
    const targetAngle = s.theta
    const align = Math.cos(wrapPi(v.angle - targetAngle))
    v.throttle = align > 0.35 ? 1 : 0
    v.autopilotNote = 'Oto-İniş: dikey iniş freni…'
    return targetAngle
  }

  // Güvenli dikey frenleme eğrisi: yüksekte hızlı alçalır, geç ve güçlü frenleyip son anda yumuşak oturur.
  const aNet = Math.max(0.4, maxAccel * 0.9 - g)
  const maxDesc = Math.min(600, Math.max(110, body.radius * 0.0055))
  const touchSpeed = Math.min(3.6, Math.max(2.2, tol * 0.36))
  const vBrake = Math.sqrt(2 * aNet * Math.max(0, s.alt - 4)) * 0.86
  const flareLimit = touchSpeed + Math.max(0, s.alt - 3) * 0.19
  let targetVr = s.alt > 4 ? -Math.max(touchSpeed, Math.min(maxDesc, vBrake, flareLimit)) : -touchSpeed
  if (vh > 4) {
    if (s.alt < 90) {
      const hold = Math.min(1, (vh - 4) / 8)
      const holdVr = (s.alt > 20 ? 0 : -1.5) * hold + targetVr * (1 - hold)
      targetVr = Math.max(targetVr, holdVr)
    } else {
      const tStopH = vh / Math.max(0.4, maxAccel * 0.8)
      const reserveAlt = Math.min(s.alt * 0.35, Math.max(160, maxDesc * 0.5))
      const vhCap = Math.max(3, (s.alt - reserveAlt) / Math.max(3, tStopH * 1.15))
      targetVr = Math.max(targetVr, -vhCap)
    }
  }

  const tauV = s.alt < 150 ? 0.52 : s.alt < 800 ? 0.75 : 1.0
  const tauH = s.alt < 150 ? 0.65 : s.alt < 800 ? 0.9 : 1.2
  const aUpFloor = s.alt < 60 && s.vr < 0 ? Math.min(maxAccel * 0.8, g * 0.45) : 0
  const aUp = Math.min(maxAccel * 0.96, Math.max(aUpFloor, g + (targetVr - s.vr) / tauV))
  const aTanBudget = Math.sqrt(Math.max(0, maxAccel * maxAccel - aUp * aUp))
  const aTanWant = -vt / tauH
  const aTan = Math.max(-aTanBudget, Math.min(aTanBudget, aTanWant))
  const aCmd = { x: up.x * aUp + tan.x * aTan, y: up.y * aUp + tan.y * aTan }
  const cmdMag = len(aCmd)
  let targetAngle = cmdMag > 1e-4 ? Math.atan2(aCmd.y, aCmd.x) : coastAim
  if (s.alt < 65) {
    const tilt = wrapPi(targetAngle - s.theta)
    const lim = s.alt < 10 && vh < 4 ? 0.18 : s.alt < 25 ? 0.36 : 0.52
    targetAngle = s.theta + Math.max(-lim, Math.min(lim, tilt))
  }

  const vDown = Math.max(0, -s.vr)
  const dStopV = (vDown * vDown) / (2 * aNet)
  const safeCoast = s.alt > 90 && vh < 8 && s.alt > dStopV * 1.22 + vDown * 1.1 + 70 && s.vr > targetVr * 0.94
  const safeChute = chuteActive && s.alt > 75 && vh < 12 && s.vr > -Math.max(4.5, st.legTolerance * 0.8)
  if (cmdMag < 0.05 || safeCoast || safeChute) {
    v.throttle = 0
    v.autopilotNote = chuteActive ? 'Oto-İniş: paraşütle alçalış…' : 'Oto-İniş: kontrollü alçalma…'
    return coastAim
  }

  const align = Math.cos(wrapPi(v.angle - targetAngle))
  const req = cmdMag / maxAccel
  const ramp = align <= 0.35 ? 0 : Math.min(1, (align - 0.35) / 0.35)
  v.throttle = ramp > 0 ? Math.max(0, Math.min(1, req * ramp)) : 0
  v.autopilotNote = vh > 35 ? 'Oto-İniş: yörünge hızı düşürülüyor…' : 'Oto-İniş: dikey iniş freni…'
  return targetAngle
}

/** Gezegensel dron otopilotu: uzay sınırını aşmadan bir sonraki çeyreğe uçar ve yumuşak iner. */
function autoDroneNextQuadGuidance(v: Vessel, st: VesselStats, body: BodyDef, s: Situation, pressure: number): number | null {
  if (!v.drone || !body.landable) {
    v.autopilot = 'off'
    v.throttle = 0
    return null
  }
  const curQ = quadrantOfAngle(s.theta)
  const targetQ: QuadrantId = v.targetQuad ?? (((curQ + 1) % 4) as QuadrantId)
  const targetTheta = quadrantCenterAngle(targetQ)
  const dTheta = wrapPi(targetTheta - s.theta)
  const arcDist = dTheta * s.r
  const absArc = Math.abs(arcDist)
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const tan = { x: -up.y, y: up.x }
  const vt = v.vel.x * tan.x + v.vel.y * tan.y
  const maxF = maxThrustAvailable(v, pressure)
  const maxAccel = maxF / Math.max(0.1, st.mass)
  const g = body.mu / (s.r * s.r)
  if (maxAccel <= g * 1.02) {
    v.throttle = 0
    v.autopilotNote = 'Fan bataryası şarj ediliyor…'
    return s.theta
  }

  const label = QUADRANT_SHORT[targetQ]
  if (v.landed && absArc < 220) {
    v.throttle = 0
    v.autopilot = 'off'
    v.autopilotNote = undefined
    return s.theta
  }

  const maxAlt = v.drone.maxAlt || 15_000
  const cruiseAlt = Math.min(maxAlt * 0.45, Math.max(1600, body.radius * 0.016))
  const brakeDecel = Math.max(1.8, maxAccel * 0.34)
  const maxCruise = Math.min(720 + v.drone.tier * 140, Math.max(220, maxAccel * 18))
  const wantVtMag = absArc < 45 ? 0 : Math.min(maxCruise, Math.sqrt(2 * brakeDecel * Math.max(0, absArc - 15)))
  const wantVt = Math.sign(dTheta || 1) * wantVtMag

  let wantVr: number
  if (absArc < 900 && Math.abs(vt) < 60) {
    // Çeyrek merkezine yaklaşıldı: yumuşakça yüzeye alçal
    const aNet = Math.min(28, Math.max(1, maxAccel * 0.85 - g))
    const vBrake = Math.sqrt(2 * aNet * Math.max(0, s.alt - 1.5)) * 0.76
    wantVr = -Math.max(2.0, Math.min(44, vBrake))
    v.autopilotNote = `${label} çeyreğine alçalıp iniyor…`
  } else {
    // Düzgün seyir yüksekliğini koru (uzay sınırı 0.75× altına kilitli)
    const targetAlt = s.alt < 120 ? cruiseAlt : absArc < 4000 ? Math.max(200, cruiseAlt * (absArc / 4000)) : cruiseAlt
    const altErr = targetAlt - Math.max(s.altSea, s.alt)
    wantVr = Math.max(-110, Math.min(140, altErr * 0.38))
    const kmLeft = (absArc / 1000).toFixed(1)
    v.autopilotNote = `🧭 ${label} çeyreğine uçuluyor (${kmLeft} km)…`
  }

  // Kalkıştan hemen sonra yatmadan önce güvenle yüksel
  if (s.alt < 55 && absArc > 250) {
    v.throttle = 1
    return s.theta
  }

  const aUp = Math.min(maxAccel * 0.94, Math.max(0, g + (wantVr - s.vr) / 0.7))
  const aTanBudget = Math.sqrt(Math.max(0, maxAccel * maxAccel - aUp * aUp))
  const aTan = Math.max(-aTanBudget, Math.min(aTanBudget, (wantVt - vt) / 0.85))
  const aCmd = { x: up.x * aUp + tan.x * aTan, y: up.y * aUp + tan.y * aTan }
  const mag = len(aCmd)
  let targetAngle = mag > 1e-4 ? Math.atan2(aCmd.y, aCmd.x) : s.theta
  if (s.alt < 38) {
    const tilt = wrapPi(targetAngle - s.theta)
    targetAngle = s.theta + Math.max(-0.24, Math.min(0.24, tilt))
  }
  const align = Math.cos(wrapPi(v.angle - targetAngle))
  v.throttle = align > 0.35 && mag > 1e-4 ? Math.max(0, Math.min(1, mag / maxAccel)) : 0
  return targetAngle
}

/** Filo takip rehberliği: lider roketi güvenli V-formasyonunda takip eder (gezegen içinden geçmez, dronu sınırdan korur). */
export function autoFollowGuidance(
  v: Vessel,
  st: VesselStats,
  body: BodyDef,
  s: Situation,
  pressure: number,
  leader: FollowLeaderRef,
  elapsedSub = 0,
): number | null {
  const row = Math.floor(leader.slotIndex / 2) + 1
  const side = leader.slotIndex % 2 === 0 ? -1 : 1
  const up = { x: v.pos.x / s.r, y: v.pos.y / s.r }
  const tan = { x: -up.y, y: up.x }
  const g = arcade.on ? 0 : body.mu / (s.r * s.r)
  const vt = v.vel.x * tan.x + v.vel.y * tan.y

  // Liderin alt-adım anındaki konum ve hızını kestir
  let lPos = { ...leader.pos }
  let lVel = { ...leader.vel }
  let lThrust = { x: 0, y: 0 }
  if (leader.landed) {
    const lr = Math.max(1, len(leader.pos))
    const lUp = { x: leader.pos.x / lr, y: leader.pos.y / lr }
    const gL = arcade.on ? 0 : body.mu / (lr * lr)
    lVel = { x: 0, y: 0 }
    lThrust = { x: lUp.x * gL, y: lUp.y * gL }
  } else {
    const tm = Math.max(0, Math.min(1, leader.throttle)) * leader.accel
    lThrust = { x: Math.cos(leader.angle) * tm, y: Math.sin(leader.angle) * tm }
    let axL = lThrust.x
    let ayL = lThrust.y
    if (!arcade.on && body.id !== 'sun') {
      const lr = Math.max(1, len(leader.pos))
      const gL = body.mu / (lr * lr)
      axL -= (leader.pos.x / lr) * gL
      ayL -= (leader.pos.y / lr) * gL
    }
    if (elapsedSub > 0) {
      lPos = {
        x: leader.pos.x + leader.vel.x * elapsedSub + 0.5 * axL * elapsedSub * elapsedSub,
        y: leader.pos.y + leader.vel.y * elapsedSub + 0.5 * ayL * elapsedSub * elapsedSub,
      }
      lVel = { x: leader.vel.x + axL * elapsedSub, y: leader.vel.y + ayL * elapsedSub }
    }
  }

  const maxF = maxThrustAvailable(v, pressure)
  const maxAccel = maxF / Math.max(0.1, st.mass)

  // Lider yüzeye inmişse yanına in veya yerde kalkışını bekle
  if (leader.landed && body.landable && !arcade.on) {
    const lTheta = Math.atan2(lPos.y, lPos.x)
    const rawDist = Math.hypot(lPos.x - v.pos.x, lPos.y - v.pos.y)
    if (v.landed && rawDist < 420) {
      v.throttle = 0
      v.autopilotNote = `⏳ ${leader.name} kalkışı bekleniyor…`
      return s.theta
    }
    if (maxAccel <= 0.01) {
      v.throttle = 0
      v.autopilotNote = v.drone ? 'Fan bataryası şarj ediliyor…' : 'Takip otopilotu: bu kademede itki/yakıt yok!'
      return s.theta
    }
    if (v.landed) {
      v.throttle = 1
      v.autopilotNote = `🚀 ${leader.name} yanına uçuş için kalkış…`
      return s.theta
    }
    const slotTheta = wrapPi(lTheta + side * Math.min(0.08, (row * 52) / body.radius))
    const dTheta = wrapPi(slotTheta - s.theta)
    const arcDist = Math.abs(dTheta) * s.r
    if (arcDist < 650) {
      const aNet = Math.max(0.8, maxAccel * 0.85 - g)
      const wantVt = Math.max(-35, Math.min(35, dTheta * s.r * 0.35))
      const vSink = Math.max(1.8, Math.min(35, Math.sqrt(2 * aNet * Math.max(0, s.alt - 1.5)) * 0.72))
      const desVr = arcDist < 120 ? -vSink : Math.max(-30, Math.min(50, (Math.max(55, arcDist * 0.22) - s.alt) * 0.45))
      const reqUp = Math.max(0, g + (desVr - s.vr) / 0.75)
      const reqTan = Math.max(-maxAccel * 0.45, Math.min(maxAccel * 0.45, (wantVt - vt) / 0.8))
      const ax = up.x * reqUp + tan.x * reqTan
      const ay = up.y * reqUp + tan.y * reqTan
      let targetAngle = Math.hypot(ax, ay) > 1e-4 ? Math.atan2(ay, ax) : s.theta
      if (s.alt < 40) {
        const tilt = wrapPi(targetAngle - s.theta)
        targetAngle = s.theta + Math.max(-0.28, Math.min(0.28, tilt))
      }
      const align = Math.cos(wrapPi(v.angle - targetAngle))
      v.throttle = align > 0.35 ? Math.max(0, Math.min(1, Math.hypot(ax, ay) / maxAccel)) : 0
      v.autopilotNote = arcDist < 120 ? `🛬 ${leader.name} yanına iniyor…` : `🤝 ${leader.name} yaklaşıyor (${Math.round(arcDist)} m)`
      return targetAngle
    }
    const maxCapAlt = v.drone ? (v.drone.maxAlt || 15_000) * 0.48 : Math.max(2400, body.atmoHeight * 0.35 + 1500)
    const cruiseAlt = Math.min(maxCapAlt, Math.max(1200, body.radius * 0.016))
    const wantVt = Math.sign(dTheta || 1) * Math.min(420, Math.sqrt(2 * Math.max(1, maxAccel * 0.35) * arcDist))
    const wantVr = Math.max(-90, Math.min(120, (cruiseAlt - s.alt) * 0.35))
    const reqUp = Math.max(0, g + (wantVr - s.vr) / 0.85)
    const reqTan = Math.max(-maxAccel * 0.55, Math.min(maxAccel * 0.55, (wantVt - vt) / 0.9))
    const ax = up.x * reqUp + tan.x * reqTan
    const ay = up.y * reqUp + tan.y * reqTan
    const targetAngle = Math.hypot(ax, ay) > 1e-4 ? Math.atan2(ay, ax) : s.theta
    const align = Math.cos(wrapPi(v.angle - targetAngle))
    v.throttle = align > 0.35 ? Math.max(0, Math.min(1, Math.hypot(ax, ay) / maxAccel)) : 0
    v.autopilotNote = `🤝 ${leader.name} bölgesine uçuluyor (${(arcDist / 1000).toFixed(1)} km)`
    return targetAngle
  }

  // Havada/yörüngede/arenada V-formasyon slotu hesapla
  const heading = len(lVel) > 6 ? Math.atan2(lVel.y, lVel.x) : leader.angle
  const lFwd = { x: Math.cos(heading), y: Math.sin(heading) }
  const lRight = { x: lFwd.y, y: -lFwd.x }
  let slotPos = {
    x: lPos.x - lFwd.x * (46 * row) + lRight.x * (side * 48 * row),
    y: lPos.y - lFwd.y * (46 * row) + lRight.y * (side * 48 * row),
  }
  if (!arcade.on && body.landable) {
    const sr = len(slotPos)
    const sa = Math.atan2(slotPos.y, slotPos.x)
    const minSafeR = body.radius + terrainHeight(body.id, sa) + (v.drone ? 14 : 24)
    if (sr > 1 && sr < minSafeR) {
      slotPos = { x: (slotPos.x / sr) * minSafeR, y: (slotPos.y / sr) * minSafeR }
    }
  }
  let ceilingHold = false
  if (v.drone) {
    const maxAlt = v.drone.maxAlt || 15_000
    const lAlt = len(lPos) - body.radius
    if (lAlt > maxAlt * 0.85) {
      ceilingHold = true
      const capR = body.radius + maxAlt * 0.62
      const sr = Math.max(1, len(slotPos))
      slotPos = { x: (slotPos.x / sr) * capR, y: (slotPos.y / sr) * capR }
    }
  }

  if (maxAccel <= 0.01) {
    v.throttle = 0
    v.autopilotNote = v.drone ? 'Fan bataryası şarj ediliyor…' : 'Takip otopilotu: bu kademede itki/yakıt yok!'
    return leader.angle
  }
  if (v.landed) {
    v.throttle = 1
    v.autopilotNote = `🚀 ${leader.name} takibi için kalkış…`
    return s.theta
  }

  const err = { x: slotPos.x - v.pos.x, y: slotPos.y - v.pos.y }
  const dist = len(err)
  const relVel = { x: lVel.x - v.vel.x, y: lVel.y - v.vel.y }
  const relSpeed = len(relVel)

  // Uzak/gezegen gölgeli yörünge kovalaması: gezegenin içinden kestirme geçme
  let occluded = false
  if (!arcade.on && body.id !== 'sun') {
    const segLen2 = err.x * err.x + err.y * err.y
    const tProj = segLen2 > 1 ? Math.max(0, Math.min(1, -(v.pos.x * err.x + v.pos.y * err.y) / segLen2)) : 0
    const minR = Math.hypot(v.pos.x + err.x * tProj, v.pos.y + err.y * tProj)
    const safeFloorR = body.radius + (body.atmoHeight > 0 ? Math.min(body.atmoHeight * 0.45, 8000) : 1800)
    occluded = minR < safeFloorR
  }

  if (!v.drone && !arcade.on && body.id !== 'sun' && (dist > 28_000 || occluded)) {
    const dTheta = wrapPi(Math.atan2(slotPos.y, slotPos.x) - s.theta)
    if (s.alt < 1200) {
      v.throttle = 1
      v.autopilotNote = `🛰️ ${leader.name} yörünge yakalaması…`
      return s.theta + Math.max(-0.22, Math.min(0.22, dTheta))
    }
    const lR = Math.max(1, len(lPos))
    const lUp = { x: lPos.x / lR, y: lPos.y / lR }
    const lTan = { x: -lUp.y, y: lUp.x }
    const vtL = lVel.x * lTan.x + lVel.y * lTan.y
    const wantR = Math.max(lR, body.radius + (body.atmoHeight > 0 ? body.atmoHeight + 8000 : 12_000))
    const wantVr = Math.max(-180, Math.min(260, (wantR - s.r) * 0.14))
    const wantVt = vtL + Math.max(-360, Math.min(360, dTheta * s.r * 0.08))
    const gEff = Math.max(0, g - (vt * vt) / s.r)
    const reqUp = gEff + (wantVr - s.vr) / 1.3
    const reqTan = (wantVt - vt) / 1.3
    const ax = up.x * reqUp + tan.x * reqTan
    const ay = up.y * reqUp + tan.y * reqTan
    const mag = Math.hypot(ax, ay)
    const targetAngle = mag > 1e-4 ? Math.atan2(ay, ax) : s.theta
    const align = Math.cos(wrapPi(v.angle - targetAngle))
    v.throttle = align > 0.4 && mag > 1e-4 ? Math.max(0.05, Math.min(1, mag / maxAccel)) : 0
    v.autopilotNote = `🛰️ ${leader.name} yakalanıyor (${(dist / 1000).toFixed(1)} km)`
    return targetAngle
  }

  // Yakın süzülme koruma bandı: yörüngede gereksiz yakıt harcamadan formasyonda kal
  if (dist < 18 && relSpeed < 0.7 && leader.throttle < 0.05) {
    v.throttle = 0
    v.autopilotNote = ceilingHold
      ? `⚠ ${leader.name} uzaya çıktı — dron yükseklik sınırında bekliyor!`
      : `🤝 ${leader.name} takipte (${Math.round(dist)} m)`
    return leader.angle
  }

  const brakeA = Math.max(0.4, arcade.on ? maxAccel * 0.75 : Math.max(0.4, (maxAccel - g * 0.35) * 0.55))
  const capSpd = arcade.on ? 380 : Math.min(850, Math.sqrt(2 * brakeA * Math.max(0, dist - 8)))
  const kpSpeed = Math.min(capSpd, dist * 0.45)
  const desVel = dist > 0.5 ? { x: lVel.x + (err.x / dist) * kpSpeed, y: lVel.y + (err.y / dist) * kpSpeed } : lVel
  const tau = dist < 120 ? 1.15 : 1.45
  const reqAx = lThrust.x + (desVel.x - v.vel.x) / tau
  const reqAy = lThrust.y + (desVel.y - v.vel.y) / tau
  const reqMag = Math.hypot(reqAx, reqAy)
  if (reqMag < maxAccel * 0.035 && dist < 30 && relSpeed < 1.0 && leader.throttle < 0.05) {
    v.throttle = 0
    v.autopilotNote = ceilingHold
      ? `⚠ ${leader.name} uzaya çıktı — dron yükseklik sınırında bekliyor!`
      : `🤝 ${leader.name} takipte (${Math.round(dist)} m)`
    return leader.angle
  }
  let targetAngle = reqMag > 1e-4 ? Math.atan2(reqAy, reqAx) : leader.angle
  if (s.alt < 40 && !arcade.on) {
    const tilt = wrapPi(targetAngle - s.theta)
    targetAngle = s.theta + Math.max(-0.35, Math.min(0.35, tilt))
  }
  const align = Math.cos(wrapPi(v.angle - targetAngle))
  v.throttle = align > 0.35 && reqMag > 1e-4 ? Math.max(0.05, Math.min(1, reqMag / maxAccel)) : 0
  v.autopilotNote = ceilingHold
    ? `⚠ ${leader.name} uzaya çıktı — dron yükseklik sınırında bekliyor!`
    : `🤝 ${leader.name} takipte (${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`})`
  return targetAngle
}

/** Tek bir fizik adımı (yarı-örtük Euler). Aracı yerinde değiştirir. */
export function stepPhysics(
  v: Vessel,
  dt: number,
  ctrl: Controls | null,
  manualScale = 1,
  externalAutoTarget: number | null = null,
  followRef: FollowLeaderRef | null = null,
  elapsedSub = 0,
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
      : ap === 'follow' && followRef
        ? autoFollowGuidance(v, st, body, s, pressure, followRef, elapsedSub)
      : ap === 'nextQuad'
        ? autoDroneNextQuadGuidance(v, st, body, s, pressure)
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

  const tx = ctrl ? Math.max(-1, Math.min(1, ctrl.tx || 0)) : 0
  const ty = ctrl ? Math.max(-1, Math.min(1, ctrl.ty || 0)) : 0
  if (ctrl && v.rcsOn && st.rcs > 0 && (tx !== 0 || ty !== 0)) {
    const acc = 0.6 * Math.min(2, st.rcs / 2)
    const right = { x: fwd.y, y: -fwd.x }
    ax += (right.x * tx + fwd.x * ty) * acc
    ay += (right.y * tx + fwd.y * ty) * acc
    v.dvUsed += acc * dt
  }

  // Arcade uçuş (Yağma modu): yerçekimi yok.
  const g = arcade.on ? 0 : body.mu / (s.r * s.r)

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

  // Paraşüt açıkken araç hız vektörünün tersine (burun yukarı) döner; oto-inişte ise iniş
  // rehberliği zaten süzülürken ters yönü, yanış gerekiyorsa fren yönünü verir.
  const chuting = st.chutesDeployed > 0 && rho > 0.0005 && s.speed > 2
  let chuteAngle: number | null = chuting ? Math.atan2(-v.vel.y, -v.vel.x) : null
  if (chuteAngle !== null && s.alt < 25) {
    const tilt = wrapPi(chuteAngle - s.theta)
    chuteAngle = s.theta + Math.max(-0.45, Math.min(0.45, tilt))
  }
  const forcedTarget = chuteAngle !== null && ap !== 'land' ? chuteAngle : autoTarget
  rotateVessel(v, st, dt, ctrl, forcedTarget, manualScale)

  v.vel = { x: v.vel.x + ax * dt, y: v.vel.y + ay * dt }
  if (arcade.on) {
    // Uzay sürtünmesi: motor kesilince gemi yavaşça durur, azami hız itkiyle sınırlanır.
    const k = Math.exp(-ARCADE_DRAG * dt)
    v.vel = { x: v.vel.x * k, y: v.vel.y * k }
  }

  if (rho > 0 && s.speed > 0.05) {
    const width = Math.max(0.5, st.maxX - st.minX)
    const cdBase = v.drone ? 0.1 : st.hasNose ? 0.3 : 0.6
    const cdA = cdBase * width * 1.2 + st.chutesDeployed * 420
    const dragAcc = (0.5 * rho * s.speed * s.speed * cdA) / 1000 / mass
    const sp = len(v.vel)
    const k = Math.max(0, 1 - Math.min(sp, dragAcc * dt) / Math.max(sp, 1e-6))
    v.vel = { x: v.vel.x * k, y: v.vel.y * k }
  }

  v.pos = { x: v.pos.x + v.vel.x * dt, y: v.pos.y + v.vel.y * dt }

  const r2 = Math.max(1e-6, len(v.pos))
  if (!body.landable) {
    return r2 < body.radius ? { firing: out.firing, crash: `${body.name} atmosferinde yok oldu` } : { firing: out.firing }
  }
  const theta2 = Math.atan2(v.pos.y, v.pos.x)
  const bottom = v.parts.length > 0 ? st.maxY - st.comY : 0
  const groundR = body.radius + terrainHeight(body.id, theta2) + bottom
  if (r2 <= groundR) {
    const up2 = { x: v.pos.x / r2, y: v.pos.y / r2 }
    const vr = v.vel.x * up2.x + v.vel.y * up2.y
    v.pos = { x: up2.x * groundR, y: up2.y * groundR }
    if (vr <= 1) {
      const speed = len(v.vel)
      const tilt = Math.abs(wrapPi(v.angle - theta2))
      if (speed > landingTolerance(st)) return { firing: out.firing, crash: `${speed.toFixed(0)} m/s hızla yüzeye çarptı`, crashSpeed: speed }
      if (tilt > 0.75) return { firing: out.firing, crash: 'yan yattı ve parçalandı', crashSpeed: landingTolerance(st) * 2 }
      const keepFollow = ap === 'follow' && Boolean(v.followId)
      v.landed = true
      v.autoLand = false
      if (!keepFollow) {
        v.autopilot = 'off'
        v.autopilotNote = undefined
      } else {
        v.autopilotNote = '⏳ Filo lideri ile yüzeyde beklemede…'
      }
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
    if (s.vr < 0) {
      const wait = (s.r - el.p / (1 + el.e * Math.cos(lim))) / Math.max(1, -s.vr) - 15
      return wait > 0 ? wait : null
    }
    return el.e < 1 ? el.period * 0.3 : 600
  }
  if (el.ra < targetR * 0.985 || s.vr <= 0) return null
  const wait = (el.ra - s.r) / Math.max(1, s.vr) - 90
  return wait > 0 ? wait : null
}

/** Araç şu an sayısal fiziğe mi ihtiyaç duyuyor (itki, atmosfer, yüzeye yakınlık)? */
export function needsPhysics(v: Vessel, ctrl: Controls | null): boolean {
  const st = vesselStats(v.parts, v.cargo)
  const engines = activeEngines(v.parts)
  const hasFan = engines.some((i) => !!partDef(v.parts[i]!.def).electricFan)
  const burning = v.throttle > 0 && engines.length > 0 && (st.fuel > 0 || (hasFan && v.ec > 0.1))
  const ap = effectiveAutopilot(v)
  if (v.landed) return burning || ap === 'orbit' || ap === 'transfer' || ap === 'nextQuad'
  if (burning || ap === 'land' || ap === 'nextQuad') return true
  if (v.debris || arcade.on) return true
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

/** Takip otopilotu şu an fizik adımı gerektiriyor mu, yoksa liderle eşzamanlı yörünge raylarında süzülebilir mi? */
export function followNeedsPhysics(v: Vessel, leader: Vessel | undefined, ctrl: Controls | null): boolean {
  if (!leader || leader.cruise || v.bodyId !== leader.bodyId) return true
  const dist = Math.hypot(leader.pos.x - v.pos.x, leader.pos.y - v.pos.y)
  if (v.landed) return v.throttle > 0 || !leader.landed || dist > 420
  if (arcade.on || v.throttle > 0) return true
  if (ctrl && v.rcsOn && vesselStats(v.parts, v.cargo).rcs > 0 && (ctrl.tx !== 0 || ctrl.ty !== 0)) return true
  const body = BODIES[v.bodyId]
  const s = situation(v)
  if (s.altSea < body.atmoHeight || (body.landable && s.alt < 1500)) return true
  if (leader.landed || leader.throttle > 0.05) return true
  const relSpeed = Math.hypot(leader.vel.x - v.vel.x, leader.vel.y - v.vel.y)
  return dist > 260 || relSpeed > 1.4
}

/** Motorlar kapalıyken Kepler yörüngesinde analitik ilerleme. */
export function stepRails(v: Vessel, dt: number) {
  const next = propagate(v.pos, v.vel, BODIES[v.bodyId].mu, dt)
  v.pos = next.r
  v.vel = next.v
}
