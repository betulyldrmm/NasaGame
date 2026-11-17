/** Uçuş görünümü ve uzay haritası çizimi (Canvas 2D, 2.5D gölgelendirme). */
import { partDef, partMaxHp } from '../game/data'
import { COLONY_SLOTS, colonyShieldCap, hasActiveLaunchPad, isQuadrantColonized, MODULE_BY_ID, QUADRANTS, quadrantCenterAngle, QUADRANT_SHORT } from '../game/base'
import type { Projectile, Vessel } from '../game/types'
import { vesselStats } from '../game/vessel'
import { bodyAbsState, len, stateAtAnomaly, type Vec, wrapPi } from '../flight/orbit'
import { airDensity, PAD_ANGLE, situation, terrainHeight } from '../flight/physics'
import type { Patch } from '../flight/predict'
import { allColoniesOnBody, colonyCenterWorldPos, colonySlotOffset, findLockTarget, getActorQuadrantBase, getPlayerQuadrantColonies, isLootMode, isWarfareMode } from '../flight/combat'
import { findOutpost, lootLeaderId, outpostPos, PICKUP_RANGE, SERVICE_RANGE } from '../flight/loot'
import { padAngleForSlot, playerPadAngle } from '../flight/multiplayerSim'
import { getVisualPos } from '../flight/mpClient'
import { activeVessel, type Sim } from '../flight/world'
import { BODIES, BODY_LIST, solarFlux, type BodyDef, type BodyId } from '../nasa/bodies'
import { drawVesselParts } from './partArt'

type Ctx = CanvasRenderingContext2D

export interface View {
  w: number
  h: number
  /** uçuş görünümü: piksel / metre */
  zoom: number
  camRot: number
  map: boolean
  /** harita: piksel / metre */
  mapZoom: number
  mapFocus: BodyId | 'ship'
  mapPan: Vec
  /** animasyon saati (gerçek saniye) */
  clock: number
  /** aktif roket için yanal RCS girdisi; yalnızca görsel jetleri tetikler */
  rcsTx: number
  /** uçuş kamerasının fareyle kaydırılması (ekran pikseli, roket ekranda kalacak şekilde sınırlı) */
  camPan?: Vec
  /** nişan alınan imleç ekran konumu (silah hedeflemesi ve nişangah için) */
  aimScreen?: Vec
  /** seçili silah türü (Füze kilidi halkası için) */
  selectedWeapon?: string
}

/** Kaydırma sınırı: roket ekranın kenarına kadar gidebilir ama dışına çıkamaz. */
export function clampCamPan(view: View, pan: Vec): Vec {
  const mx = view.w * 0.32
  const my = view.h * 0.3
  return { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) }
}

export function createView(): View {
  return { w: 800, h: 600, zoom: 7, camRot: 0, map: false, mapZoom: 2.2e-5, mapFocus: 'earth', mapPan: { x: 0, y: 0 }, clock: 0, rcsTx: 0 }
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const STARS = Array.from({ length: 420 }, (_, i) => ({ x: hash(i), y: hash(i + 999), s: 0.4 + hash(i + 77) * 1.3, tw: hash(i + 5) * 6.28 }))

function drawStars(ctx: Ctx, view: View, alpha: number, rot: number) {
  if (alpha <= 0.02) return
  const R = Math.hypot(view.w, view.h) / 2
  ctx.save()
  ctx.translate(view.w / 2, view.h / 2)
  ctx.rotate(-rot)
  for (const s of STARS) {
    const a = alpha * (0.45 + 0.4 * Math.sin(view.clock * 0.8 + s.tw))
    ctx.fillStyle = `rgba(${200 + Math.round(55 * s.x)},${215 + Math.round(40 * s.y)},255,${a.toFixed(3)})`
    ctx.beginPath()
    ctx.arc((s.x * 2 - 1) * R, (s.y * 2 - 1) * R, s.s, 0, 6.283)
    ctx.fill()
  }
  ctx.restore()
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** Küre gölgelendirmesi: ışık Güneş yönünden gelir. */
function sphereFill(ctx: Ctx, body: BodyDef, cx: number, cy: number, rpx: number, light: Vec) {
  const g = ctx.createRadialGradient(cx + light.x * rpx * 0.48, cy + light.y * rpx * 0.48, rpx * 0.04, cx, cy, rpx * 1.04)
  g.addColorStop(0, body.colors.light)
  g.addColorStop(0.5, body.colors.base)
  g.addColorStop(1, body.colors.dark)
  return g
}

export function drawSphere(ctx: Ctx, body: BodyDef, cx: number, cy: number, rpx: number, light: Vec, rot: number, detail: boolean, clock = 0) {
  if (body.id === 'sun') {
    const pulse = 1 + 0.04 * Math.sin(clock * 2.1)
    const glow = ctx.createRadialGradient(cx, cy, rpx * 0.55, cx, cy, rpx * 4.2 * pulse)
    glow.addColorStop(0, 'rgba(255,245,180,.78)')
    glow.addColorStop(0.28, 'rgba(255,190,70,.35)')
    glow.addColorStop(1, 'rgba(255,130,30,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, rpx * 4.2 * pulse, 0, 6.283)
    ctx.fill()
    // Taç küre fışkırmaları (animasyonlu güneş halkaları)
    if (rpx >= 8) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 6; i += 1) {
        const a = i * 1.047 + clock * 0.06
        const flareR = rpx * (0.14 + 0.08 * Math.sin(clock * 1.7 + i * 2.1))
        ctx.strokeStyle = 'rgba(255,140,45,.48)'
        ctx.lineWidth = Math.max(1.2, rpx * 0.05)
        ctx.beginPath()
        ctx.arc(Math.cos(a) * rpx * 0.96, Math.sin(a) * rpx * 0.96, flareR, a - 1.3, a + 1.3)
        ctx.stroke()
      }
      ctx.restore()
    }
  }
  if (body.atmoHeight > 0) {
    const ar = rpx * (1 + Math.max(0.05, body.atmoHeight / body.radius) * 1.15)
    const g = ctx.createRadialGradient(cx, cy, rpx * 0.94, cx, cy, ar)
    const atCol =
      body.id === 'earth' ? 'rgba(96,185,255,' :
      body.id === 'titan' ? 'rgba(245,158,66,' :
      body.id === 'venus' ? 'rgba(253,224,135,' :
      body.id === 'mars' ? 'rgba(244,142,102,' : 'rgba(220,185,135,'
    g.addColorStop(0, atCol + '.56)')
    g.addColorStop(0.5, atCol + '.18)')
    g.addColorStop(1, atCol + '0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, ar, 0, 6.283)
    ctx.fill()
  }
  // Satürn arka halkaları (Cassini boşluğu + gezegen gölgesi)
  if (body.id === 'saturn' && rpx >= 4) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.35 - rot * 0.1)
    for (const ring of [
      { mult: 2.32, lw: 0.22, col: 'rgba(225,198,150,.56)' },
      { mult: 1.88, lw: 0.28, col: 'rgba(245,225,180,.72)' },
      { mult: 1.48, lw: 0.14, col: 'rgba(175,148,110,.36)' },
    ]) {
      ctx.strokeStyle = ring.col
      ctx.lineWidth = Math.max(1, rpx * ring.lw)
      ctx.beginPath()
      ctx.ellipse(0, 0, rpx * ring.mult, rpx * ring.mult * 0.21, 0, Math.PI, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, rpx, 0, 6.283)
  ctx.fillStyle = sphereFill(ctx, body, cx, cy, rpx, light)
  ctx.fill()

  if (body.id === 'sun' && detail && rpx >= 10) {
    ctx.save()
    ctx.clip()
    ctx.translate(cx, cy)
    for (let i = 0; i < 18; i += 1) {
      const a = hash(i * 4.3) * 6.283 + clock * 0.04
      const d = Math.sqrt(hash(i * 9.1)) * rpx * 0.85
      const rad = rpx * (0.06 + 0.08 * hash(i * 2.7))
      ctx.fillStyle = i % 5 === 0 ? 'rgba(180,75,15,.35)' : 'rgba(255,250,210,.26)'
      ctx.beginPath()
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, rad, 0, 6.283)
      ctx.fill()
    }
    ctx.restore()
  }

  if (detail && rpx >= 7 && body.id !== 'sun') {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, rpx, 0, 6.283)
    ctx.clip()
    ctx.translate(cx, cy)
    ctx.rotate(-rot)
    const drift = (clock * (body.id === 'jupiter' ? 0.035 : body.id === 'venus' ? 0.028 : 0.012)) % 6.283

    if (body.id === 'jupiter' || body.id === 'saturn') {
      const jupColors = ['rgba(248,230,202,.46)', 'rgba(176,104,58,.44)', 'rgba(235,198,154,.38)', 'rgba(142,76,42,.38)', 'rgba(218,168,118,.35)']
      const satColors = ['rgba(248,236,198,.38)', 'rgba(205,176,120,.32)', 'rgba(232,208,155,.34)', 'rgba(165,135,88,.26)']
      const belts = body.id === 'jupiter' ? jupColors : satColors
      const count = body.id === 'jupiter' ? 9 : 7
      for (let i = -count; i <= count; i += 1) {
        const y0 = (i / (count + 0.5)) * rpx
        ctx.fillStyle = belts[Math.abs(i) % belts.length]!
        ctx.beginPath()
        ctx.moveTo(-rpx * 1.1, y0)
        for (let k = -4; k <= 4; k += 1) {
          const x = (k / 4) * rpx * 1.05
          const wave = body.id === 'jupiter' ? Math.sin(k * 1.4 + i + drift * 6) * rpx * 0.025 : 0
          ctx.lineTo(x, y0 + wave)
        }
        ctx.lineTo(rpx * 1.1, y0 + rpx * 0.12)
        ctx.lineTo(-rpx * 1.1, y0 + rpx * 0.12)
        ctx.closePath()
        ctx.fill()
      }
      if (body.id === 'jupiter') {
        // Büyük Kırmızı Leke kasırgası
        const gx = Math.sin(drift) * rpx * 0.55
        ctx.fillStyle = 'rgba(186,62,40,.68)'
        ctx.beginPath()
        ctx.ellipse(gx, rpx * 0.3, rpx * 0.24, rpx * 0.13, 0, 0, 6.283)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,195,145,.55)'
        ctx.lineWidth = Math.max(0.8, rpx * 0.025)
        ctx.stroke()
      }
    } else if (body.id === 'earth') {
      // Kıtalar, sığ deniz rafları, kutup buzulları ve dönen siklon bulutları
      const continents = [
        { x: -0.34, y: -0.18, rx: 0.32, ry: 0.24, rot: 0.3 },
        { x: -0.22, y: 0.28, rx: 0.2, ry: 0.26, rot: -0.25 },
        { x: 0.26, y: -0.22, rx: 0.36, ry: 0.25, rot: -0.18 },
        { x: 0.36, y: 0.24, rx: 0.22, ry: 0.18, rot: 0.4 },
        { x: 0.04, y: 0.06, rx: 0.16, ry: 0.22, rot: 0.15 },
      ]
      for (const l of continents) {
        // Turkuaz kıyı sığlığı
        ctx.fillStyle = 'rgba(56,217,232,.25)'
        ctx.beginPath()
        ctx.ellipse(l.x * rpx, l.y * rpx, l.rx * rpx * 1.14, l.ry * rpx * 1.14, l.rot, 0, 6.283)
        ctx.fill()
        // Yeşil kara + çöl/dağ dokusu
        ctx.fillStyle = '#3b9b56'
        ctx.beginPath()
        ctx.ellipse(l.x * rpx, l.y * rpx, l.rx * rpx, l.ry * rpx, l.rot, 0, 6.283)
        ctx.fill()
        ctx.fillStyle = 'rgba(180,165,105,.45)'
        ctx.beginPath()
        ctx.ellipse((l.x + 0.03) * rpx, (l.y + 0.02) * rpx, l.rx * rpx * 0.45, l.ry * rpx * 0.38, l.rot, 0, 6.283)
        ctx.fill()
      }
      // Kuzey ve güney kutup buzulları
      ctx.fillStyle = 'rgba(240,248,255,.88)'
      ctx.beginPath()
      ctx.ellipse(0, -rpx * 0.92, rpx * 0.48, rpx * 0.16, 0, 0, 6.283)
      ctx.ellipse(0, rpx * 0.93, rpx * 0.52, rpx * 0.15, 0, 0, 6.283)
      ctx.fill()
      // Yavaşça kayan beyaz siklon bulut şeritleri
      ctx.fillStyle = 'rgba(255,255,255,.36)'
      for (let i = 0; i < 8; i += 1) {
        const cxCloud = (((hash(i * 5.7) * 2 - 1) + drift * 0.18) % 1.4) * rpx * 0.85
        const cyCloud = (hash(i * 9.3) * 1.6 - 0.8) * rpx * 0.8
        ctx.beginPath()
        ctx.ellipse(cxCloud, cyCloud, rpx * (0.24 + 0.14 * hash(i)), rpx * 0.065, -0.22 + hash(i * 3) * 0.4, 0, 6.283)
        ctx.fill()
      }
    } else if (body.id === 'mars') {
      // Koyu bazalt ovalar, Valles Marineris kanyon yarığı, kutup buzulları
      ctx.fillStyle = 'rgba(105,36,20,.46)'
      ctx.beginPath()
      ctx.ellipse(-rpx * 0.25, -rpx * 0.1, rpx * 0.35, rpx * 0.22, 0.3, 0, 6.283)
      ctx.ellipse(rpx * 0.3, rpx * 0.22, rpx * 0.28, rpx * 0.16, -0.4, 0, 6.283)
      ctx.fill()
      // Valles Marineris ekvator kanyonu
      ctx.strokeStyle = 'rgba(82,22,12,.72)'
      ctx.lineWidth = Math.max(1, rpx * 0.045)
      ctx.beginPath()
      ctx.moveTo(-rpx * 0.35, rpx * 0.05)
      ctx.quadraticCurveTo(0, rpx * 0.12, rpx * 0.36, -rpx * 0.02)
      ctx.stroke()
      // İki kutupta CO2 buz başlıkları
      ctx.fillStyle = 'rgba(250,242,235,.82)'
      ctx.beginPath()
      ctx.ellipse(0, -rpx * 0.93, rpx * 0.32, rpx * 0.11, 0, 0, 6.283)
      ctx.ellipse(0, rpx * 0.94, rpx * 0.28, rpx * 0.09, 0, 0, 6.283)
      ctx.fill()
    } else if (body.id === 'venus' || body.id === 'titan') {
      // Dönerek şeritlenen V-desenli yoğun bulut akıntıları & hidrokarbon kutup denizleri (Titan)
      const bandCol = body.id === 'venus' ? 'rgba(255,244,200,.34)' : 'rgba(255,212,135,.3)'
      const darkCol = body.id === 'venus' ? 'rgba(166,112,48,.28)' : 'rgba(122,58,14,.32)'
      for (let i = -3; i <= 3; i += 1) {
        const y = i * rpx * 0.25
        ctx.strokeStyle = Math.abs(i) % 2 === 0 ? bandCol : darkCol
        ctx.lineWidth = Math.max(1.2, rpx * 0.14)
        ctx.beginPath()
        ctx.moveTo(-rpx * 1.1, y - rpx * 0.08)
        ctx.quadraticCurveTo(Math.sin(drift * 2 + i) * rpx * 0.25, y + rpx * 0.14, rpx * 1.1, y - rpx * 0.08)
        ctx.stroke()
      }
      if (body.id === 'titan') {
        // Kutup metan denizleri (Kraken Mare)
        ctx.fillStyle = 'rgba(34,26,38,.52)'
        ctx.beginPath()
        ctx.ellipse(-rpx * 0.12, -rpx * 0.72, rpx * 0.28, rpx * 0.14, 0.2, 0, 6.283)
        ctx.fill()
      }
    } else {
      // Ay, Merkür, Ceres, Ganimed: mare havzaları, oluklu buz hatları, parlak ve gölgeli çok halkalı kraterler
      if (body.id === 'moon') {
        ctx.fillStyle = 'rgba(68,74,88,.48)'
        ctx.beginPath()
        ctx.ellipse(-rpx * 0.22, -rpx * 0.18, rpx * 0.34, rpx * 0.26, -0.3, 0, 6.283)
        ctx.ellipse(rpx * 0.2, -rpx * 0.05, rpx * 0.26, rpx * 0.3, 0.4, 0, 6.283)
        ctx.ellipse(-rpx * 0.05, rpx * 0.32, rpx * 0.24, rpx * 0.16, 0.1, 0, 6.283)
        ctx.fill()
      } else if (body.id === 'ganymede') {
        // Açık renk buz olukları (sulci)
        ctx.strokeStyle = 'rgba(232,240,250,.32)'
        ctx.lineWidth = Math.max(0.8, rpx * 0.04)
        for (let g = 0; g < 6; g += 1) {
          const a = hash(g * 7.1) * Math.PI
          const y = (hash(g * 3.7) - 0.5) * rpx * 1.3
          ctx.beginPath()
          ctx.moveTo(-rpx * Math.cos(a), y - rpx * Math.sin(a))
          ctx.lineTo(rpx * Math.cos(a), y + rpx * Math.sin(a))
          ctx.stroke()
        }
      }
      const n = 15
      for (let i = 0; i < n; i += 1) {
        const a = hash(i + body.radius) * 6.283
        const d = Math.sqrt(hash(i * 3 + 1)) * rpx * 0.85
        const cxC = Math.cos(a) * d
        const cyC = -Math.sin(a) * d
        const cr = rpx * (0.04 + 0.11 * hash(i * 7))
        ctx.fillStyle = 'rgba(38,40,48,.38)'
        ctx.beginPath()
        ctx.arc(cxC, cyC, cr, 0, 6.283)
        ctx.fill()
        ctx.strokeStyle = body.id === 'ceres' && i % 5 === 0 ? 'rgba(255,255,255,.78)' : 'rgba(255,255,255,.26)'
        ctx.lineWidth = Math.max(0.7, cr * 0.22)
        ctx.beginPath()
        ctx.arc(cxC, cyC, cr, Math.PI * 0.9, Math.PI * 1.9)
        ctx.stroke()
        if (body.id === 'ceres' && i % 5 === 0) {
          ctx.fillStyle = 'rgba(248,252,255,.85)'
          ctx.beginPath()
          ctx.arc(cxC, cyC, cr * 0.42, 0, 6.283)
          ctx.fill()
        }
      }
    }
    ctx.restore()

    // Gece tarafı gölge geçişi + Dünya'da gece şehir ışıkları
    const sh = ctx.createLinearGradient(cx + light.x * rpx, cy + light.y * rpx, cx - light.x * rpx, cy - light.y * rpx)
    sh.addColorStop(0.32, 'rgba(0,0,12,0)')
    sh.addColorStop(1, 'rgba(2,4,14,.68)')
    ctx.beginPath()
    ctx.arc(cx, cy, rpx, 0, 6.283)
    ctx.fillStyle = sh
    ctx.fill()
    if (body.id === 'earth' && rpx >= 14) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, rpx, 0, 6.283)
      ctx.clip()
      for (let i = 0; i < 16; i += 1) {
        const a = hash(i * 11.3 + 2) * 6.283
        const d = (0.25 + 0.55 * hash(i * 3.9)) * rpx
        const pxCity = cx + Math.cos(a) * d
        const pyCity = cy + Math.sin(a) * d
        // Yalnızca ışığa ters (gece) yarı kürede parlasın
        if ((pxCity - cx) * light.x + (pyCity - cy) * light.y < -rpx * 0.15) {
          ctx.fillStyle = 'rgba(255,215,120,.65)'
          ctx.beginPath()
          ctx.arc(pxCity, pyCity, Math.max(0.8, rpx * 0.018), 0, 6.283)
          ctx.fill()
        }
      }
      ctx.restore()
    }
  }

  // Satürn ön halkaları
  if (body.id === 'saturn' && rpx >= 4) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.35 - rot * 0.1)
    for (const ring of [
      { mult: 2.32, lw: 0.22, col: 'rgba(242,216,170,.72)' },
      { mult: 1.88, lw: 0.28, col: 'rgba(252,235,195,.84)' },
      { mult: 1.48, lw: 0.14, col: 'rgba(185,158,118,.48)' },
    ]) {
      ctx.strokeStyle = ring.col
      ctx.lineWidth = Math.max(1, rpx * ring.lw)
      ctx.beginPath()
      ctx.ellipse(0, 0, rpx * ring.mult, rpx * ring.mult * 0.21, 0, 0, Math.PI)
      ctx.stroke()
    }
    ctx.restore()
  }
}

// ───────────────────────── uçuş görünümü ─────────────────────────

interface Cam {
  cx: number
  cy: number
  rot: number
  z: number
  w: number
  h: number
}

const toScreen = (c: Cam, p: Vec): Vec => {
  const dx = p.x - c.cx
  const dy = p.y - c.cy
  const cs = Math.cos(c.rot)
  const sn = Math.sin(c.rot)
  return { x: c.w / 2 + (dx * cs - dy * sn) * c.z, y: c.h / 2 - (dx * sn + dy * cs) * c.z }
}

const screenToWorld = (c: Cam, sx: number, sy: number): Vec => {
  const ux = (sx - c.w / 2) / c.z
  const uy = -(sy - c.h / 2) / c.z
  const cs = Math.cos(c.rot)
  const sn = Math.sin(c.rot)
  return { x: c.cx + ux * cs + uy * sn, y: c.cy - ux * sn + uy * cs }
}

/** Uçuş ekranı imleç pikselinden roketin hedefleyeceği dünya açısını ve mesafesini (m) hesaplar. */
export function aimAngleFromScreen(frame: FlightFrame | null, v: Vessel | null, sx: number, sy: number): number | undefined {
  return aimInfoFromScreen(frame, v, sx, sy)?.angle
}

export function aimInfoFromScreen(frame: FlightFrame | null, v: Vessel | null, sx: number, sy: number): { angle: number; dist: number } | undefined {
  if (!frame?.cam || !v) return undefined
  const wp = screenToWorld(frame.cam, sx, sy)
  const vp = getVisualPos(v)
  const dx = wp.x - vp.x
  const dy = wp.y - vp.y
  const dist = Math.hypot(dx, dy)
  if (dist < 0.5) return undefined
  return { angle: Math.atan2(dy, dx), dist }
}

/** Yüzeydeki bir noktada yerel çerçeve: +x teğet, −y yukarı (radyal), birim metre. */
function withSurfaceFrame(ctx: Ctx, cam: Cam, body: BodyDef, theta: number, fn: () => void) {
  const r = body.radius + terrainHeight(body.id, theta)
  const p = toScreen(cam, { x: Math.cos(theta) * r, y: Math.sin(theta) * r })
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(Math.PI / 2 - (theta + cam.rot))
  ctx.scale(cam.z, cam.z)
  fn()
  ctx.restore()
}

function drawPad(ctx: Ctx, clock = 0) {
  ctx.fillStyle = '#5b6470'
  ctx.fillRect(-22, -1.2, 44, 3)
  ctx.fillStyle = '#8b96a3'
  ctx.fillRect(-22, -1.6, 44, 0.6)
  ctx.fillStyle = '#f5c542'
  for (let x = -20; x < 20; x += 4) ctx.fillRect(x, -1.6, 2, 0.6)
  // kule
  const g = ctx.createLinearGradient(-14, 0, -10, 0)
  g.addColorStop(0, '#3d4652')
  g.addColorStop(0.5, '#9aa6b4')
  g.addColorStop(1, '#4a5461')
  ctx.fillStyle = g
  ctx.fillRect(-14, -36, 4, 34.5)
  ctx.strokeStyle = 'rgba(20,26,36,.7)'
  ctx.lineWidth = 0.3
  for (let y = -36; y < -2; y += 4) {
    ctx.beginPath()
    ctx.moveTo(-14, y)
    ctx.lineTo(-10, y + 4)
    ctx.moveTo(-10, y)
    ctx.lineTo(-14, y + 4)
    ctx.stroke()
  }
  ctx.fillStyle = '#6d7785'
  ctx.fillRect(-10, -27, 7, 0.9)
  ctx.fillRect(-10, -15, 7, 0.9)
  const beaconOn = Math.sin(clock * 4.5) > -0.2
  ctx.fillStyle = beaconOn ? '#ff5d5d' : '#7f1d1d'
  ctx.beginPath()
  ctx.arc(-12, -37, 0.7, 0, 6.283)
  ctx.fill()
  if (beaconOn) {
    ctx.fillStyle = 'rgba(255,93,93,.22)'
    ctx.beginPath()
    ctx.arc(-12, -37, 2.2, 0, 6.283)
    ctx.fill()
  }
}

const spriteCache = new Map<string, HTMLImageElement>()
function sprite(name: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let img = spriteCache.get(name)
  if (!img) {
    img = new Image()
    img.src = `/assets/colony/${name}.png`
    spriteCache.set(name, img)
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** Koloni yapıları: koloni ekranındaki aynı piksel-art görseller yüzeyde de durur. */
function drawBaseSites(
  ctx: Ctx,
  sites: (string | null)[],
  opts: { compact?: boolean; siteHp?: (number | null)[]; clock?: number } = {},
) {
  ctx.imageSmoothingEnabled = false
  const t = opts.clock ?? 0
  sites.forEach((id, i) => {
    const def = id ? MODULE_BY_ID[id] : null
    const img = def ? sprite(def.sprite) : null
    if (!img || !def) return
    const w = opts.compact ? 9.2 : 11
    const h = (w * img.naturalHeight) / img.naturalWidth
    const x = colonySlotOffset(i, !!opts.compact)
    ctx.drawImage(img, x - w / 2, -h + 0.3, w, h)

    // Modüle özgü canlı yüzey animasyonları
    if (opts.clock !== undefined) {
      if (id === 'launch-pad') {
        const blink = Math.sin(t * 5) > 0
        ctx.fillStyle = blink ? '#f87171' : '#7f1d1d'
        ctx.beginPath()
        ctx.arc(x - w * 0.25, -h * 0.92, 0.85, 0, Math.PI * 2)
        ctx.fill()
        // Kriojenik yakıt buharı bulutları
        const steam = ((t * 1.4 + i) % 1) * 5.5
        ctx.fillStyle = `rgba(215,245,255,${(0.42 * (1 - steam / 5.5)).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(x + Math.sin(t * 2.5 + i) * 1.2, -1 - steam, 1.3 + steam * 0.22, 0, Math.PI * 2)
        ctx.fill()
      } else if (id === 'telemetry') {
        const wave = ((t * 1.8 + i) % 1) * 6
        ctx.strokeStyle = `rgba(56,217,232,${(0.55 * (1 - wave / 6)).toFixed(2)})`
        ctx.lineWidth = 0.65
        ctx.beginPath()
        ctx.arc(x, -h * 0.72, 2 + wave, -Math.PI * 0.8, -Math.PI * 0.2)
        ctx.stroke()
      } else if (id === 'drill') {
        const puff = ((t * 4.5 + i) % 1) * 3.5
        ctx.fillStyle = `rgba(214,190,150,${(0.55 * (1 - puff / 3.5)).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(x + Math.sin(t * 11) * 1.4, -puff, 0.95, 0, Math.PI * 2)
        ctx.fill()
      } else if (id === 'rtg-reactor' || id === 'colony-shield') {
        ctx.fillStyle = id === 'colony-shield' ? `rgba(56,217,232,${(0.22 + 0.16 * Math.sin(t * 4)).toFixed(2)})` : `rgba(74,222,128,${(0.22 + 0.16 * Math.sin(t * 3.5)).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(x, -h * 0.45, w * 0.36, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const maxHp = def.hp ?? 320
    const curHp = opts.siteHp?.[i] ?? maxHp
    if (curHp < maxHp) {
      const frac = Math.max(0, Math.min(1, curHp / maxHp))
      ctx.fillStyle = 'rgba(10,14,22,.82)'
      ctx.fillRect(x - w * 0.45, -h - 2.4, w * 0.9, 1.3)
      ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#fbbf24' : '#f87171'
      ctx.fillRect(x - w * 0.45, -h - 2.4, w * 0.9 * frac, 1.3)
      if (frac < 0.5 && opts.clock !== undefined) {
        const rise = ((opts.clock * 4 + i * 0.7) % 1) * 5
        ctx.fillStyle = `rgba(90,95,105,${(0.55 * (1 - rise / 5)).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(x + Math.sin(opts.clock * 3 + i) * 1.1, -h * 0.55 - rise, 1.4 + rise * 0.25, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })
  ctx.imageSmoothingEnabled = true
}


/** Patlamalar ve muharebe efektleri: ateş topu, ışın, kalkan halkası ve isabet kıvılcımları. */
function drawBooms(ctx: Ctx, sim: Sim, cam: Cam, bodyId: BodyId) {
  const clock = sim.clock ?? 0
  for (const f of sim.fx ?? []) {
    if (f.bodyId !== bodyId) continue
    const age = clock - f.born
    if (f.kind === 'muzzle') {
      const life = 0.11
      if (age < 0 || age > life || f.x2 === undefined || f.y2 === undefined) continue
      const a = 1 - age / life
      const p0 = toScreen(cam, f)
      const p1 = toScreen(cam, { x: f.x2, y: f.y2 })
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      const lenPx = Math.max(8, Math.hypot(p1.x - p0.x, p1.y - p0.y))
      ctx.save()
      ctx.translate(p0.x, p0.y)
      ctx.rotate(ang)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = a
      const wCone = Math.max(3, f.size * cam.z * 0.55) * a
      ctx.fillStyle = f.color ?? '#fde047'
      ctx.beginPath()
      ctx.moveTo(0, -wCone)
      ctx.lineTo(lenPx, 0)
      ctx.lineTo(0, wCone)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(lenPx * 0.15, 0, Math.max(2, wCone * 0.6), 0, 6.283)
      ctx.fill()
      ctx.restore()
      continue
    }
    if (f.kind === 'beam') {
      const giant = f.size >= 5
      const life = giant ? 0.34 : 0.22
      if (age < 0 || age > life || f.x2 === undefined || f.y2 === undefined) continue
      const a = 1 - age / life
      const p0 = toScreen(cam, f)
      const p1 = toScreen(cam, { x: f.x2, y: f.y2 })
      const pulse = 0.85 + 0.15 * Math.sin(clock * 46)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      // Dış plazma halesi
      ctx.globalAlpha = a * (giant ? 0.55 : 0.45)
      ctx.strokeStyle = f.color ?? '#fb7185'
      ctx.lineWidth = Math.max(giant ? 10 : 4.5, f.size * cam.z * (giant ? 1.85 : 1.5) * pulse) * a
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
      // Orta ışın
      ctx.globalAlpha = a * 0.9
      ctx.strokeStyle = f.color ?? '#fb7185'
      ctx.lineWidth = Math.max(giant ? 5 : 2.5, f.size * cam.z * 0.9 * pulse) * a
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
      // Kavurucu beyaz çekirdek
      ctx.globalAlpha = a
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(giant ? 2.4 : 1.2, f.size * cam.z * 0.36) * a
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
      // Namlu ve hedef yanık parıltıları
      const endR = Math.max(giant ? 12 : 5, f.size * cam.z * 1.1) * a
      const eg = ctx.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, endR)
      eg.addColorStop(0, '#ffffff')
      eg.addColorStop(0.45, f.color ?? '#fb7185')
      eg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = eg
      ctx.beginPath()
      ctx.arc(p1.x, p1.y, endR, 0, 6.283)
      ctx.fill()
      ctx.restore()
      continue
    }
    if (f.kind === 'hit') {
      const life = 0.28
      if (age < 0 || age > life) continue
      const t = age / life
      const p = toScreen(cam, f)
      const R = Math.max(5, f.size * cam.z) * (0.4 + t * 1.4)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 1 - t
      ctx.strokeStyle = f.color ?? '#ffad57'
      ctx.lineWidth = 1.6
      for (let i = 0; i < 6; i += 1) {
        const a = hash(f.born * 13 + i * 2.3) * 6.283
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25)
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R)
        ctx.stroke()
      }
      ctx.restore()
      continue
    }
    if (f.kind === 'shield') {
      const life = 0.45
      if (age < 0 || age > life) continue
      const t = age / life
      const p = toScreen(cam, f)
      const R = Math.max(8, f.size * cam.z * (0.65 + t * 0.55))
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = (1 - t) * 0.8
      ctx.strokeStyle = f.color ?? '#38d9e8'
      ctx.lineWidth = Math.max(1.5, 3 * (1 - t))
      ctx.beginPath()
      ctx.arc(p.x, p.y, R, 0, 6.283)
      ctx.stroke()
      ctx.restore()
      continue
    }
    if (f.kind === 'shockwave') {
      const life = 0.75
      if (age < 0 || age > life) continue
      const t = age / life
      const p = toScreen(cam, f)
      const R = Math.max(18, f.size * cam.z) * (0.25 + 1.9 * (1 - (1 - t) ** 2.4))
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = Math.max(0, (1 - t) * 0.9)
      ctx.strokeStyle = f.color ?? '#fde68a'
      ctx.lineWidth = Math.max(2, (1 - t) * 6)
      ctx.beginPath()
      ctx.arc(p.x, p.y, R, 0, 6.283)
      ctx.stroke()
      ctx.globalAlpha = Math.max(0, (1 - t) * 0.55)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(1, (1 - t) * 2.5)
      ctx.beginPath()
      ctx.arc(p.x, p.y, R * 0.72, 0, 6.283)
      ctx.stroke()
      ctx.restore()
      continue
    }
    if (f.kind === 'debrisBurst') {
      const life = 2.4
      if (age < 0 || age > life) continue
      const t = age / life
      const p = toScreen(cam, f)
      const spreadPx = Math.max(20, f.size * cam.z * 2.8)
      ctx.save()
      ctx.translate(p.x, p.y)
      for (let i = 0; i < 16; i += 1) {
        const a = hash(f.born * 19 + i * 2.1) * 6.283
        const spd = 0.45 + 0.75 * hash(i * 4.7 + f.born)
        const dist = spreadPx * spd * (1 - (1 - t) ** 1.8)
        const sx = Math.cos(a) * dist
        const sy = Math.sin(a) * dist
        const ember = 1 - t
        // Kızgın kor izi
        ctx.strokeStyle = `rgba(255,145,55,${(ember * 0.65).toFixed(2)})`
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(sx - Math.cos(a) * 7 * ember, sy - Math.sin(a) * 7 * ember)
        ctx.lineTo(sx, sy)
        ctx.stroke()
        // Dönen metal gövde / kiriş parçası
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate(a + age * (4 + (i % 3) * 3))
        ctx.globalAlpha = Math.max(0, 1 - t * 0.85)
        ctx.fillStyle = i % 3 === 0 ? '#64748b' : i % 3 === 1 ? '#f59e0b' : '#cbd5e1'
        const pw = 3 + (i % 4) * 1.4
        const ph = 1.8 + (i % 2) * 1.2
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph)
        ctx.restore()
      }
      ctx.restore()
      continue
    }
    if (f.kind === 'smokePlume') {
      const life = 3.2
      if (age < 0 || age > life) continue
      const t = age / life
      const p = toScreen(cam, f)
      const R = Math.max(12, f.size * cam.z)
      ctx.save()
      ctx.translate(p.x, p.y)
      for (let i = 0; i < 6; i += 1) {
        const a = hash(f.born * 11 + i * 3.1) * 6.283
        const ox = Math.cos(a) * R * 0.6 * t
        const oy = Math.sin(a) * R * 0.45 * t - R * 0.8 * t
        const rad = R * (0.28 + 0.55 * t) * (0.7 + 0.3 * hash(i + f.born))
        ctx.globalAlpha = Math.max(0, (1 - t) * 0.5)
        ctx.fillStyle = i < 2 && t < 0.4 ? '#7c2d12' : '#2e323c'
        ctx.beginPath()
        ctx.arc(ox, oy, rad, 0, 6.283)
        ctx.fill()
      }
      ctx.restore()
      continue
    }
    if (f.kind !== 'boom') continue
    const life = 1.25
    if (age < 0 || age > life) continue
    const t = age / life
    const p = toScreen(cam, f)
    const R = Math.max(10, f.size * cam.z) * (0.4 + 1.3 * (1 - (1 - t) ** 3))
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.globalAlpha = Math.max(0, 0.55 * (1 - t))
    ctx.fillStyle = '#3a3a40'
    for (let i = 0; i < 5; i += 1) {
      const a = hash(f.born * 7 + i) * 6.283
      ctx.beginPath()
      ctx.arc(Math.cos(a) * R * 0.5 * t, Math.sin(a) * R * 0.5 * t - R * 0.5 * t, R * (0.35 + 0.25 * hash(i + f.born)), 0, 6.283)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.max(0, 1 - t * 1.25)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,236,150,.95)')
    g.addColorStop(0.6, 'rgba(255,130,40,.75)')
    g.addColorStop(1, 'rgba(200,40,20,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, 6.283)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,220,170,.8)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, R * (0.6 + t), 0, 6.283)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,210,120,.95)'
    ctx.lineWidth = 1.6
    for (let i = 0; i < 9; i += 1) {
      const a = hash(f.born * 3 + i * 1.7) * 6.283
      const d0 = R * (0.3 + t * 1.5)
      const d1 = d0 + R * 0.35 * (1 - t)
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0)
      ctx.lineTo(Math.cos(a) * d1, Math.sin(a) * d1)
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawTerrain(ctx: Ctx, cam: Cam, body: BodyDef, focusTheta: number, sim: Sim, clock: number) {
  const diag = Math.hypot(cam.w, cam.h)
  const half = Math.min(Math.PI, (diag / (cam.z * body.radius)) * 0.9 + 0.0005)
  const N = 300
  const depth = Math.min(body.radius * 0.9, (diag / cam.z) * 1.2)
  const pt = (theta: number, r: number) => toScreen(cam, { x: Math.cos(theta) * r, y: Math.sin(theta) * r })
  const layer = (hfn: (t: number) => number, fill: string | CanvasGradient, stroke?: string) => {
    ctx.beginPath()
    for (let i = 0; i <= N; i += 1) {
      const t = focusTheta + ((i / N) * 2 - 1) * half
      const p = pt(t, body.radius + hfn(t))
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    if (stroke) {
      ctx.save()
      ctx.strokeStyle = stroke
      ctx.lineWidth = Math.max(1.5, Math.min(5, cam.z * 0.6))
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    }
    for (let i = N; i >= 0; i -= 6) {
      const t = focusTheta + ((i / N) * 2 - 1) * half
      const p = pt(t, body.radius - depth)
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  const c = body.colors
  const icyBody = body.id === 'ganymede' || body.id === 'ceres'
  const mistyBody = body.id === 'venus' || body.id === 'titan'
  // uzak sırt (derinlik hissi)
  if (cam.z > 0.15) {
    const ridgeFar =
      body.id === 'earth' ? '#2c6564'
      : body.id === 'mars' ? mix(c.dark, '#7a331c', 0.55)
      : icyBody ? mix(c.dark, '#4a6b88', 0.45)
      : mistyBody ? mix(c.dark, '#8a6830', 0.4)
      : mix(c.dark, c.base, 0.45)
    const ridgeNear =
      body.id === 'earth' ? '#3b8452'
      : body.id === 'mars' ? mix(c.base, '#9e4422', 0.5)
      : icyBody ? mix(c.base, '#789bb8', 0.4)
      : mix(c.dark, c.base, 0.75)
    layer((t) => terrainHeight(body.id, t + 0.00041) * 0.85 + 18 + 10 * Math.sin(t * 5200 + 1.3), ridgeFar)
    layer((t) => terrainHeight(body.id, t - 0.00023) * 0.95 + 8 + 4.5 * Math.sin(t * 8300), ridgeNear)
  }
  const top = pt(focusTheta, body.radius + terrainHeight(body.id, focusTheta))
  const low = pt(focusTheta, body.radius + terrainHeight(body.id, focusTheta) - Math.min(depth, 260 / Math.min(1, cam.z) ))
  const g = ctx.createLinearGradient(top.x, top.y, low.x, low.y)
  if (body.id === 'earth') {
    g.addColorStop(0, '#72c45d')
    g.addColorStop(0.035, '#3f8f3c')
    g.addColorStop(0.11, '#735f3c')
    g.addColorStop(0.28, '#4a3d2b')
    g.addColorStop(1, '#221c15')
  } else {
    g.addColorStop(0, c.light)
    g.addColorStop(0.08, c.base)
    g.addColorStop(0.32, c.dark)
    g.addColorStop(1, mix(c.dark, '#000000', 0.55))
  }
  layer((t) => terrainHeight(body.id, t), g, body.id === 'earth' ? '#a6e38a' : mix(c.light, '#ffffff', 0.5))

  // Jeolojik tabaka damarları (kaya / buz katmanları)
  if (cam.z > 0.35) {
    const strataColor =
      body.id === 'earth' ? 'rgba(42,30,18,.42)'
      : icyBody ? 'rgba(205,235,255,.26)'
      : 'rgba(0,0,0,.28)'
    for (let band = 0; band < 2; band += 1) {
      const baseDepth = 8 + band * 15
      ctx.save()
      ctx.beginPath()
      for (let i = 0; i <= N; i += 4) {
        const t = focusTheta + ((i / N) * 2 - 1) * half
        const wave = Math.sin(t * 4600 + band * 2.1) * 1.6 + Math.cos(t * 9800 - band) * 0.7
        const p = pt(t, body.radius + terrainHeight(body.id, t) - baseDepth + wave)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.strokeStyle = strataColor
      ctx.lineWidth = Math.max(1, Math.min(3.2, cam.z * 0.55))
      ctx.stroke()
      ctx.restore()
    }
  }

  if (cam.z > 0.45) {
    // yüzey detayları: krater, kaya, ağaç, buz kristali, mesa
    const spacing = 22
    const dTheta = spacing / body.radius
    const span = Math.min(half, (diag / cam.z / body.radius) * 0.6)
    const k0 = Math.floor((focusTheta - span) / dTheta)
    const k1 = Math.ceil((focusTheta + span) / dTheta)
    for (let k = k0; k <= k1; k += 1) {
      const r1 = hash(k * 1.37 + body.radius)
      const r2 = hash(k * 2.71 + body.radius * 0.3)
      const theta = (k + hash(k) * 0.6) * dTheta
      const padMargin = sim.gs.mp ? 700 : 90
      if (body.id === 'earth' && Math.abs(wrapPi(theta - PAD_ANGLE)) * body.radius < padMargin) continue
      if (r1 > 0.68) continue
      withSurfaceFrame(ctx, cam, body, theta, () => {
        const s = 0.65 + hash(k * 3.1) * 1.45
        if (body.id === 'earth') {
          if (r1 < 0.36) {
            ctx.fillStyle = '#5a4630'
            ctx.fillRect(-0.4 * s, -3 * s, 0.8 * s, 3 * s)
            for (let j = 0; j < 3; j += 1) {
              ctx.beginPath()
              ctx.moveTo(-3.2 * s + j * 0.5 * s, -2.5 * s - j * 2.6 * s)
              ctx.lineTo(0, -8.2 * s - j * 2.4 * s)
              ctx.lineTo(3.2 * s - j * 0.5 * s, -2.5 * s - j * 2.6 * s)
              ctx.closePath()
              ctx.fillStyle = j % 2 ? '#2f7a3b' : '#256b33'
              ctx.fill()
            }
          } else if (r1 < 0.55) {
            ctx.fillStyle = '#4c9a4a'
            ctx.beginPath()
            ctx.ellipse(0, -0.8 * s, 2.6 * s, 1.5 * s, 0, 0, 6.283)
            ctx.fill()
            if (r2 > 0.65) {
              ctx.fillStyle = r2 > 0.82 ? '#fde047' : '#f472b6'
              ctx.fillRect(-1.1 * s, -1.7 * s, 0.45 * s, 0.45 * s)
              ctx.fillRect(0.6 * s, -1.4 * s, 0.45 * s, 0.45 * s)
            }
          } else {
            ctx.fillStyle = '#6c685e'
            ctx.beginPath()
            ctx.moveTo(-1.3 * s, 0.2)
            ctx.lineTo(-0.7 * s, -1.1 * s)
            ctx.lineTo(0.8 * s, -0.9 * s)
            ctx.lineTo(1.5 * s, 0.2)
            ctx.closePath()
            ctx.fill()
          }
        } else if (icyBody && r1 > 0.34) {
          // Buz ve parlak tuz kristalleri (Ganymede / Ceres)
          for (let j = -1; j <= 1; j += 1) {
            const h = (1.6 + (j === 0 ? 1.5 : 0.7)) * s
            ctx.beginPath()
            ctx.moveTo(j * 0.75 * s - 0.55 * s, 0.2)
            ctx.lineTo(j * 0.85 * s, -h)
            ctx.lineTo(j * 0.75 * s + 0.55 * s, 0.2)
            ctx.closePath()
            ctx.fillStyle = body.id === 'ceres'
              ? (j === 0 ? 'rgba(235,245,255,.78)' : 'rgba(170,190,210,.65)')
              : (j === 0 ? 'rgba(165,220,255,.75)' : 'rgba(105,165,215,.65)')
            ctx.fill()
          }
        } else if (mistyBody && r1 > 0.44) {
          // Kükürt / metan duman bacaları (Venüs / Titan)
          ctx.fillStyle = mix(c.dark, '#201810', 0.35)
          ctx.beginPath()
          ctx.moveTo(-1.8 * s, 0.2)
          ctx.lineTo(-0.65 * s, -1.7 * s)
          ctx.lineTo(0.65 * s, -1.7 * s)
          ctx.lineTo(1.9 * s, 0.2)
          ctx.closePath()
          ctx.fill()
          const puff = (clock * 0.7 + r2 * 6) % 1
          ctx.fillStyle = body.id === 'venus'
            ? `rgba(255,215,120,${(0.32 * (1 - puff)).toFixed(2)})`
            : `rgba(245,175,90,${(0.28 * (1 - puff)).toFixed(2)})`
          ctx.beginPath()
          ctx.arc(Math.sin(clock * 1.4 + k) * 0.5 * s, -2.0 * s - puff * 3.8 * s, (0.7 + puff * 1.1) * s, 0, 6.283)
          ctx.fill()
        } else if (body.id === 'mars' && r1 >= 0.3 && r1 < 0.48) {
          // Mars kızıl kaya mesası (katmanlı tepecik)
          ctx.fillStyle = mix(c.dark, '#6e2c14', 0.45)
          ctx.beginPath()
          ctx.moveTo(-2.7 * s, 0.2)
          ctx.lineTo(-1.7 * s, -1.9 * s)
          ctx.lineTo(1.5 * s, -1.9 * s)
          ctx.lineTo(2.6 * s, 0.2)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = mix(c.light, '#e58a54', 0.5)
          ctx.fillRect(-1.7 * s, -1.9 * s, 3.2 * s, 0.45 * s)
        } else if (r1 < 0.3) {
          const rx = 4 + hash(k * 5.3) * 11
          ctx.beginPath()
          ctx.ellipse(0, 0.3, rx, rx * 0.2, 0, 0, 6.283)
          ctx.fillStyle = mix(c.dark, '#000000', 0.3)
          ctx.fill()
          ctx.beginPath()
          ctx.ellipse(0, 0.3, rx, rx * 0.2, 0, Math.PI, 6.283)
          ctx.strokeStyle = mix(c.light, '#ffffff', 0.45)
          ctx.lineWidth = 0.42
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(-1.6 * s, 0.2)
          ctx.lineTo(-1.1 * s, -1.3 * s)
          ctx.lineTo(0.3 * s, -1.9 * s)
          ctx.lineTo(1.5 * s, -0.9 * s)
          ctx.lineTo(1.8 * s, 0.2)
          ctx.closePath()
          const rg = ctx.createLinearGradient(-1.6 * s, -1.9 * s, 1.8 * s, 0)
          rg.addColorStop(0, c.light)
          rg.addColorStop(1, c.dark)
          ctx.fillStyle = rg
          ctx.fill()
        }
      })
    }
  }
  if (body.id === 'earth' && cam.z > 0.12) {
    if (sim.gs.mp) {
      const mode = sim.gs.mp.config.mode
      for (const p of Object.values(sim.gs.mp.players)) {
        const thetaPad = padAngleForSlot(p.slot, mode)
        withSurfaceFrame(ctx, cam, body, thetaPad, () => {
          drawPad(ctx, clock)
          ctx.fillStyle = p.color
          ctx.fillRect(-10, -2, 20, 2)
          if (cam.z > 0.45) {
            ctx.font = 'bold 9px "DM Mono", monospace'
            ctx.textAlign = 'center'
            ctx.fillText(p.username, 0, -18)
          }
        })
      }
    } else {
      withSurfaceFrame(ctx, cam, body, PAD_ANGLE, () => {
        drawPad(ctx, clock)
      })
    }
  }
  const fluxHere = solarFlux(len(bodyAbsState(body.id, sim.gs.time).r))
  if (sim.gs.mp && isWarfareMode(sim.gs) && cam.z > 0.14) {
    for (const col of allColoniesOnBody(sim.gs, body.id)) {
      const owner = sim.gs.mp.players[col.ownerId]
      const colAngle = col.base.siteAngle ?? (col.isEarth && owner ? padAngleForSlot(owner.slot, 'orbital-warfare') : quadrantCenterAngle(col.quadrant))
      const cx = colonySlotOffset((COLONY_SLOTS - 1) / 2, true)
      withSurfaceFrame(ctx, cam, body, colAngle, () => {
        if (col.base.destroyed) {
          ctx.fillStyle = 'rgba(45,48,56,.92)'
          for (let i = 0; i < 6; i += 1) {
            const x = colonySlotOffset(i, true)
            ctx.fillRect(x - 3.5, -2.5, 7, 2.5)
          }
          if (cam.z > 0.35 && owner) {
            ctx.fillStyle = '#f87171'
            ctx.font = 'bold 8px "DM Mono", monospace'
            ctx.textAlign = 'center'
            ctx.fillText(`💀 ${owner.username}`, cx, -12)
          }
          return
        }
        if (!(col.isEarth && col.quadrant === 0) && hasActiveLaunchPad(col.base, fluxHere)) {
          drawPad(ctx, clock)
        }
        drawBaseSites(ctx, col.base.sites ?? [], { compact: true, siteHp: col.base.siteHp, clock })
        const shCap = colonyShieldCap(col.base, solarFlux(len(bodyAbsState(body.id, sim.gs.time).r)))
        if ((col.base.shield ?? 0) > 0 && shCap > 0) {
          const shFrac = Math.min(1, (col.base.shield ?? 0) / shCap)
          ctx.save()
          ctx.strokeStyle = `rgba(56,217,232,${(0.35 + 0.45 * shFrac).toFixed(2)})`
          ctx.fillStyle = `rgba(56,217,232,${(0.06 + 0.08 * shFrac).toFixed(2)})`
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(cx, 0, 72, Math.PI, 0)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
        if ((col.base.stunUntil ?? 0) > clock) {
          ctx.strokeStyle = '#60a5fa'
          ctx.lineWidth = 1.1
          ctx.beginPath()
          ctx.arc(cx + Math.sin(clock * 18) * 3, -12, 16, Math.PI * 1.15, Math.PI * 1.85)
          ctx.stroke()
        }
        if (cam.z > 0.35 && owner) {
          ctx.fillStyle = owner.color
          ctx.font = 'bold 8px "DM Mono", monospace'
          ctx.textAlign = 'center'
          const qTxt = col.quadrant > 0 ? ` · Q${col.quadrant + 1}` : ''
          ctx.fillText(`🏰 ${owner.username}${qTxt}`, cx, col.base.shield ? -76 : -22)
        }
      })
    }
  } else if (cam.z > 0.16) {
    const actorId = sim.gs.ownerId ?? 'local'
    for (const q of QUADRANTS) {
      const base = getActorQuadrantBase(sim.gs, body.id, actorId, q)
      if (!base) continue
      const baseAngle = body.id === 'earth' && q === 0 && sim.gs.mp ? playerPadAngle(sim.gs, actorId) : base.siteAngle ?? quadrantCenterAngle(q)
      withSurfaceFrame(ctx, cam, body, baseAngle, () => {
        if (!(body.id === 'earth' && q === 0) && hasActiveLaunchPad(base, fluxHere)) {
          drawPad(ctx, clock)
        }
        drawBaseSites(ctx, base.sites ?? [], { clock })
        if (cam.z > 0.38) {
          ctx.fillStyle = 'rgba(200,235,255,.8)'
          ctx.font = 'bold 8px "DM Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText(QUADRANT_SHORT[q], 0, -24)
        }
      })
    }
    if (sim.gs.mp && body.id === 'earth') {
      for (const p of Object.values(sim.gs.mp.players)) {
        if (p.id === actorId) continue
        for (const item of getPlayerQuadrantColonies(p, 'earth')) {
          if (item.quadrant === 0) continue
          const ba = item.base.siteAngle ?? quadrantCenterAngle(item.quadrant)
          withSurfaceFrame(ctx, cam, body, ba, () => drawBaseSites(ctx, item.base.sites ?? [], { compact: true, clock }))
        }
      }
    }
  }

  // Çok oyunculu bayrak direği: ele geçirilmiş veya fethedilmekte olan gezegen yüzeyinde dalgalanır
  const cap = sim.gs.mp?.captures[body.id]
  if (sim.gs.mp && cap && cam.z > 0.16 && (cap.ownerId || (cap.capturerId && cap.progress > 0))) {
    const owner = cap.ownerId ? sim.gs.mp.players[cap.ownerId] : null
    const capturer = cap.capturerId ? sim.gs.mp.players[cap.capturerId] : null
    const flagCol = owner?.color ?? capturer?.color ?? '#38d9e8'
    const hoist = Math.max(0.15, Math.min(1, cap.progress))
    withSurfaceFrame(ctx, cam, body, cap.flagAngle, () => {
      ctx.strokeStyle = '#d9e3f0'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -16)
      ctx.stroke()
      const fy = -3 - hoist * 12
      const wave = Math.sin(clock * 5) * 1.4
      ctx.fillStyle = flagCol
      ctx.beginPath()
      ctx.moveTo(0, fy)
      ctx.quadraticCurveTo(6, fy + wave, 11, fy + 1.5 - wave * 0.5)
      ctx.lineTo(0, fy + 5.5)
      ctx.closePath()
      ctx.fill()
      if (cam.z > 0.45 && (owner || capturer)) {
        ctx.fillStyle = flagCol
        ctx.font = 'bold 8px "DM Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`🚩 ${owner?.username ?? capturer?.username ?? ''}`, 5, fy - 4)
      }
    })
  }
}

function vesselCell(st: ReturnType<typeof vesselStats>, z: number, minPx: number) {
  return Math.max(z, minPx / Math.max(1, st.maxY - st.minY))
}

/** Hızlı yolculuk (cruise) sırasında hız şeritleri, hız/ilerleme göstergesi ve şok parıltısı çizer. */
function drawCruiseWarp(ctx: Ctx, sim: Sim, view: View, camRot: number) {
  const v = activeVessel(sim.gs)
  const c = v?.cruise
  if (!v || !c) return
  const clock = sim.clock ?? 0
  const u = Math.max(0, Math.min(1, (clock - c.start) / Math.max(0.5, c.dur)))
  const spd = Math.sin(Math.PI * u)
  const vLen = Math.hypot(v.vel.x, v.vel.y)
  const worldHeading = vLen > 1 ? Math.atan2(v.vel.y, v.vel.x) : u >= 0.74 ? v.angle + Math.PI : v.angle
  const ang = -(worldHeading + camRot)
  const span = Math.hypot(view.w, view.h) + 280
  const travel = (clock * (1.2 + 2.8 * spd) + u * 6) % 1000

  ctx.save()
  ctx.translate(view.w / 2, view.h / 2)
  ctx.rotate(ang)
  ctx.globalCompositeOperation = 'lighter'

  // Hızlandıkça uzayan yıldız ve kozmik toz şeritleri
  const count = 88
  for (let i = 0; i < count; i += 1) {
    const lane = (hash(i * 19.7 + 3) - 0.5) * span
    const phase = (hash(i * 7.3 + 11) + travel * (0.45 + 0.9 * hash(i * 3.1))) % 1
    const ux = (0.5 - phase) * span
    const streakLen = 14 + (50 + 180 * hash(i * 5.9)) * spd
    const alpha = (0.14 + 0.42 * spd) * (0.35 + 0.65 * hash(i * 13.3))
    const grad = ctx.createLinearGradient(ux + streakLen * 0.5, lane, ux - streakLen * 0.5, lane)
    const warm = i % 5 === 0
    grad.addColorStop(0, warm ? `rgba(255,228,155,${alpha})` : `rgba(175,245,255,${alpha})`)
    grad.addColorStop(0.35, warm ? `rgba(255,185,95,${alpha * 0.7})` : `rgba(56,217,232,${alpha * 0.65})`)
    grad.addColorStop(1, 'rgba(56,217,232,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 1 + 1.6 * hash(i * 29.1) * (0.3 + spd)
    ctx.beginPath()
    ctx.moveTo(ux + streakLen * 0.5, lane)
    ctx.lineTo(ux - streakLen * 0.5, lane)
    ctx.stroke()
  }

  // Kenar hız tüneli vinyeti
  if (spd > 0.05) {
    ctx.rotate(-ang)
    const vig = ctx.createRadialGradient(0, 0, Math.min(view.w, view.h) * 0.25, 0, 0, span * 0.52)
    vig.addColorStop(0, 'rgba(56,217,232,0)')
    vig.addColorStop(0.72, `rgba(25,110,180,${0.05 * spd})`)
    vig.addColorStop(1, `rgba(120,235,255,${0.16 * spd})`)
    ctx.fillStyle = vig
    ctx.fillRect(-view.w / 2, -view.h / 2, view.w, view.h)
  }
  ctx.restore()
}

function drawProjectiles(ctx: Ctx, sim: Sim, cam: Cam, bodyId: BodyId) {
  const projs: Projectile[] = sim.gs.mp?.projectiles ?? sim.gs.projectiles ?? []
  if (!projs.length) return
  for (const pr of projs) {
    if (pr.bodyId !== bodyId || pr.ttl <= 0) continue
    const p = toScreen(cam, pr.pos)
    if (p.x < -80 || p.x > cam.w + 80 || p.y < -80 || p.y > cam.h + 80) continue
    const spd = Math.hypot(pr.vel.x, pr.vel.y)
    const dirW = spd > 1 ? Math.atan2(pr.vel.y, pr.vel.x) : 0
    const ang = -(dirW + cam.rot)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(ang)
    ctx.globalCompositeOperation = 'lighter'
    const col = pr.color || '#fbbf24'
    if (pr.kind === 'railgun') {
      const L = Math.max(22, Math.min(64, spd * cam.z * 0.042))
      const g = ctx.createLinearGradient(-L, 0, L * 0.35, 0)
      g.addColorStop(0, 'rgba(56,217,232,0)')
      g.addColorStop(0.6, col)
      g.addColorStop(1, '#ffffff')
      ctx.strokeStyle = g
      ctx.lineWidth = Math.max(2.6, cam.z * 0.5)
      ctx.beginPath()
      ctx.moveTo(-L, 0)
      ctx.lineTo(L * 0.35, 0)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(224,242,254,.55)'
      ctx.lineWidth = 1.2
      for (const rx of [-L * 0.25, -L * 0.55]) {
        ctx.beginPath()
        ctx.moveTo(rx - 4, -5)
        ctx.lineTo(rx + 2, 0)
        ctx.lineTo(rx - 4, 5)
        ctx.stroke()
      }
    } else if (pr.kind === 'plasma' || pr.kind === 'emp') {
      const r = Math.max(4, (pr.kind === 'emp' ? 0.95 : 0.75) * cam.z)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.42, col)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, r * 2.4, 0, 6.283)
      ctx.fill()
      ctx.strokeStyle = col
      ctx.lineWidth = Math.max(1.5, r * 0.45)
      ctx.beginPath()
      ctx.moveTo(-r * 3.8, 0)
      ctx.lineTo(0, 0)
      ctx.stroke()
      if (pr.kind === 'emp') {
        ctx.strokeStyle = '#93c5fd'
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.arc(0, 0, r * 1.5, sim.clock ?? 0, (sim.clock ?? 0) + 4.4)
        ctx.stroke()
      }
    } else if (pr.kind === 'missile' || pr.kind === 'torpedo' || pr.kind === 'rocket') {
      const s = pr.kind === 'torpedo' ? 1.6 : pr.kind === 'missile' ? 1.3 : 0.95
      const rPx = Math.max(3, cam.z * 0.45 * s)
      // Duman izi boncukları
      ctx.globalCompositeOperation = 'source-over'
      for (let b = 1; b <= 4; b += 1) {
        ctx.fillStyle = `rgba(210,220,235,${(0.32 - b * 0.06).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(-rPx * (2.6 + b * 2.2), Math.sin((sim.clock ?? 0) * 18 + b) * 1.2, rPx * (0.45 + b * 0.14), 0, 6.283)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = '#ff9a3c'
      ctx.beginPath()
      ctx.moveTo(-rPx * 1.4, 0)
      ctx.lineTo(-rPx * 3.6 - Math.random() * rPx, -rPx * 0.6)
      ctx.lineTo(-rPx * 3.6 - Math.random() * rPx, rPx * 0.6)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(rPx * 1.9, 0)
      ctx.lineTo(-rPx * 1.4, -rPx * 0.68)
      ctx.lineTo(-rPx * 1.4, rPx * 0.68)
      ctx.closePath()
      ctx.fill()
    } else {
      const L = pr.kind === 'flak' ? Math.max(7, Math.min(20, cam.z * 1.8)) : Math.max(11, Math.min(30, spd * cam.z * 0.03))
      ctx.strokeStyle = col
      ctx.lineWidth = pr.dmg >= 100 ? Math.max(2.6, cam.z * 0.45) : Math.max(1.7, cam.z * 0.3)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-L, 0)
      ctx.lineTo(0, 0)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(0, 0, ctx.lineWidth * 0.68, 0, 6.283)
      ctx.fill()
    }
    ctx.restore()
  }
}

/** Yağma modu dünyası: arena sınırı, kaynak sahaları, üs ikmal halkaları ve ganimet sandıkları. */
function drawLootWorld(ctx: Ctx, sim: Sim, cam: Cam, clock: number) {
  const gs = sim.gs
  const loot = gs.mp?.loot
  if (!loot) return
  const onScreen = (p: Vec, m: number) => p.x > -m && p.x < cam.w + m && p.y > -m && p.y < cam.h + m
  ctx.save()
  // Arena sınırı
  const c = toScreen(cam, loot.center)
  const rpx = loot.radius * cam.z
  if (rpx < 60_000) {
    ctx.strokeStyle = 'rgba(248,113,113,.4)'
    ctx.lineWidth = 2
    ctx.setLineDash([14, 10])
    ctx.beginPath()
    ctx.arc(c.x, c.y, rpx, 0, 6.283)
    ctx.stroke()
    ctx.setLineDash([])
  }
  // Kaynak sahaları
  loot.sites.forEach((site, idx) => {
    const p = toScreen(cam, site.pos)
    const r = (idx === 0 ? 480 : 360) * cam.z
    if (!onScreen(p, r + 40)) return
    ctx.strokeStyle = 'rgba(251,191,36,.22)'
    ctx.fillStyle = 'rgba(251,191,36,.035)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, 6.283)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(253,230,138,.8)'
    ctx.font = 'bold 11px "DM Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(site.name, p.x, p.y - r - 6)
  })
  // Üs ikmal halkaları
  for (const o of gs.vessels) {
    if (!o.outpost) continue
    const p = toScreen(cam, o.pos)
    const r = SERVICE_RANGE * cam.z
    if (!onScreen(p, r + 40)) continue
    const mine = o.ownerId === gs.ownerId
    const col = (o.ownerId && gs.mp?.players[o.ownerId]?.color) || '#94a3b8'
    ctx.strokeStyle = col
    ctx.globalAlpha = mine ? 0.55 : 0.25
    ctx.lineWidth = 1.2
    ctx.setLineDash([6, 8])
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, 6.283)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    if (mine) {
      ctx.fillStyle = col
      ctx.font = 'bold 10px "DM Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('İkmal · Onarım · Teslim', p.x, p.y + r + 14)
    }
  }
  // Sandıklar
  for (const k of loot.crates) {
    const p = toScreen(cam, k.pos)
    if (!onScreen(p, 30)) continue
    const size = Math.max(7, Math.min(22, (2.2 + k.tons) * cam.z * 1.6))
    const bob = Math.sin(clock * 1.7 + k.id) * 0.25
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(bob + k.id)
    ctx.fillStyle = k.site < 0 ? '#f59e0b' : '#d4a04a'
    ctx.strokeStyle = '#3b2a0d'
    ctx.lineWidth = 1.2
    ctx.fillRect(-size / 2, -size / 2, size, size)
    ctx.strokeRect(-size / 2, -size / 2, size, size)
    ctx.beginPath()
    ctx.moveTo(-size / 2, 0)
    ctx.lineTo(size / 2, 0)
    ctx.moveTo(0, -size / 2)
    ctx.lineTo(0, size / 2)
    ctx.stroke()
    ctx.restore()
    if (cam.z > 0.5) {
      ctx.strokeStyle = 'rgba(253,230,138,.18)'
      ctx.beginPath()
      ctx.arc(p.x, p.y, PICKUP_RANGE * cam.z, 0, 6.283)
      ctx.stroke()
      ctx.fillStyle = 'rgba(253,230,138,.9)'
      ctx.font = '10px "DM Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`${k.tons.toFixed(1)} t`, p.x, p.y - size / 2 - 5)
    }
  }
  ctx.restore()
}

/**
 * Arcade yönlendirme: kargo doluysa üsse, değilse en yakın sandığa işaret eden ok; liderin üstünde taç.
 * Metin göstergeleri yerine oyuncuya "şimdi ne yapmalıyım" sorusunun tek cevabını verir.
 */
function drawArcadeGuides(ctx: Ctx, sim: Sim, cam: Cam, v: Vessel | null, clock: number) {
  const gs = sim.gs
  const loot = gs.mp?.loot
  if (!loot) return
  ctx.save()
  const leader = lootLeaderId(gs)
  if (leader) {
    for (const o of gs.vessels) {
      if (o.ownerId !== leader || o.outpost || o.debris) continue
      const p = toScreen(cam, o.pos)
      ctx.font = '22px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('👑', p.x, p.y - 30 - Math.sin(clock * 3) * 3)
    }
  }
  if (v && !v.debris && v.ownerId) {
    const st = vesselStats(v.parts, v.cargo)
    const full = st.cargoCap > 0 && v.cargo.ore >= st.cargoCap - 0.01
    let target: Vec | null = null
    let color = '#fbbf24'
    if (full || (v.cargo.ore > 0.05 && loot.crates.length === 0)) {
      target = findOutpost(gs, v.ownerId)?.pos ?? null
      color = '#4ade80'
    } else {
      let best = Infinity
      for (const c of loot.crates) {
        const d = Math.hypot(c.pos.x - v.pos.x, c.pos.y - v.pos.y)
        if (d < best) {
          best = d
          target = c.pos
        }
      }
    }
    if (target) {
      const dx = target.x - v.pos.x
      const dy = target.y - v.pos.y
      const d = Math.hypot(dx, dy)
      if (d > 120) {
        const p = toScreen(cam, v.pos)
        const q = toScreen(cam, target)
        const a = Math.atan2(q.y - p.y, q.x - p.x)
        const r = 58
        ctx.translate(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r)
        ctx.rotate(a)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(clock * 5)
        ctx.beginPath()
        ctx.moveTo(14, 0)
        ctx.lineTo(-6, -9)
        ctx.lineTo(-2, 0)
        ctx.lineTo(-6, 9)
        ctx.closePath()
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

/** Yağma modu radarı: arenanın tamamı — üsler, sahalar, sandıklar ve gemiler. */
function drawLootRadar(ctx: Ctx, sim: Sim, view: View, center: Vec) {
  const gs = sim.gs
  const loot = gs.mp?.loot
  if (!loot) return
  const R = Math.max(42, Math.min(80, Math.min(view.w, view.h) * 0.13))
  const cx = view.w - R - 18
  const cy = 58 + R
  const k = R / (loot.radius * 1.04)
  // Radar ekran yönüyle aynı bakar (kamera dönmediği için kuzey yukarı).
  const P = (w: Vec): Vec => ({ x: cx + (w.x - loot.center.x) * k, y: cy - (w.y - loot.center.y) * k })
  ctx.save()
  ctx.fillStyle = 'rgba(6,10,18,.72)'
  ctx.strokeStyle = 'rgba(148,163,184,.5)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, 6.283)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, 6.283)
  ctx.clip()
  for (const site of loot.sites) {
    const p = P(site.pos)
    ctx.fillStyle = 'rgba(251,191,36,.16)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(4, 420 * k), 0, 6.283)
    ctx.fill()
  }
  ctx.fillStyle = '#fbbf24'
  for (const c of loot.crates) {
    const p = P(c.pos)
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2)
  }
  for (const o of gs.vessels) {
    if (o.bodyId !== 'earth' || o.debris) continue
    const p = P(o.pos)
    const col = (o.ownerId && gs.mp?.players[o.ownerId]?.color) || '#94a3b8'
    ctx.fillStyle = col
    ctx.strokeStyle = col
    if (o.outpost) {
      ctx.lineWidth = 1.5
      ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7)
      if (o.ownerId === gs.ownerId) ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
    } else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, o.ownerId === gs.ownerId ? 3 : 2.4, 0, 6.283)
      ctx.fill()
    }
  }
  // Kameranın baktığı nokta
  const me = P(center)
  ctx.strokeStyle = 'rgba(255,255,255,.85)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(me.x, me.y, 5.5, 0, 6.283)
  ctx.stroke()
  ctx.restore()
}

function vesselHealthSummary(v: Vessel): { hp: number; maxHp: number } {
  let hp = 0
  let maxHp = 0
  for (const p of v.parts) {
    const m = partMaxHp(p.def)
    maxHp += m
    hp += Math.max(0, p.hp ?? m)
  }
  return { hp, maxHp }
}

function drawVesselAt(ctx: Ctx, sim: Sim, v: Vessel, p: Vec, rot: number, cell: number, clock: number, vac: number, rcsTx: number) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(Math.PI / 2 - (v.angle + rot))
  if (v.cruise) {
    const c = v.cruise
    const u = Math.max(0, Math.min(1, (clock - c.start) / Math.max(0.5, c.dur)))
    const spd = Math.sin(Math.PI * u)
    const st = vesselStats(v.parts)
    const tailY = (st.maxY - st.comY) * cell
    const topY = (st.minY - st.comY) * cell
    const R = Math.max(18, cell * 4.5)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // İyon / Plazma egzoz huzmesi (motorun altından uzar)
    const flicker = 0.92 + 0.08 * Math.sin(clock * 48)
    const tailLen = R * (1.4 + 3.2 * spd) * flicker
    const tg = ctx.createLinearGradient(0, tailY, 0, tailY + tailLen)
    tg.addColorStop(0, `rgba(235,252,255,${0.85 * (0.4 + spd)})`)
    tg.addColorStop(0.3, `rgba(56,217,232,${0.65 * (0.4 + spd)})`)
    tg.addColorStop(0.7, `rgba(120,165,255,${0.25 * (0.4 + spd)})`)
    tg.addColorStop(1, 'rgba(56,217,232,0)')
    ctx.fillStyle = tg
    ctx.beginPath()
    ctx.moveTo(-cell * 0.55, tailY)
    ctx.lineTo(0, tailY + tailLen)
    ctx.lineTo(cell * 0.55, tailY)
    ctx.closePath()
    ctx.fill()
    // Parlak çekirdek alev
    ctx.fillStyle = `rgba(255,255,255,${0.65 * (0.3 + spd)})`
    ctx.beginPath()
    ctx.ellipse(0, tailY + R * 0.25, cell * 0.35, R * (0.45 + 0.65 * spd), 0, 0, 6.283)
    ctx.fill()
    // Hız şok halesi (gidiş yönünde)
    if (spd > 0.08) {
      const forwardNose = u < 0.74
      ctx.strokeStyle = `rgba(145,240,255,${0.5 * spd})`
      ctx.lineWidth = Math.max(1.5, cell * 0.22)
      ctx.beginPath()
      if (forwardNose) ctx.arc(0, topY + R * 0.25, R * 0.95, Math.PI * 1.15, Math.PI * 1.85)
      else ctx.arc(0, tailY - R * 0.25, R * 0.95, Math.PI * 0.15, Math.PI * 0.85)
      ctx.stroke()
    }
    ctx.restore()
  }
  const aimDelta = v.aimAngle !== undefined ? wrapPi(v.aimAngle - v.angle) : 0
  drawVesselParts(ctx, v.parts, cell, { firing: sim.firing.get(v.id), time: clock, vacuum: vac, rcsTx, aimDelta })
  // Yoğun atmosferde ses hızı (Mach) üstünde burunda şok yoğuşma konisi
  if (!v.landed && !v.drone && !v.cruise && vac < 0.72) {
    const spd = len(v.vel)
    if (spd > 280) {
      const st = vesselStats(v.parts)
      const noseY = (st.minY - st.comY) * cell
      const halfW = Math.max(1.2, (st.maxX - st.minX) * 0.75) * cell
      const alpha = Math.min(0.45, ((spd - 280) / 450) * (1 - vac) * 0.55)
      ctx.save()
      ctx.strokeStyle = `rgba(225,244,255,${alpha.toFixed(2)})`
      ctx.lineWidth = Math.max(1.4, cell * 0.25)
      ctx.beginPath()
      ctx.moveTo(-halfW * 1.4, noseY + halfW * 1.9)
      ctx.quadraticCurveTo(0, noseY - halfW * 0.4, halfW * 1.4, noseY + halfW * 1.9)
      ctx.stroke()
      ctx.restore()
    }
  }
  if (v.drone?.warn) {
    const pulse = 0.55 + 0.45 * Math.sin(clock * 14)
    ctx.save()
    ctx.strokeStyle = `rgba(248,113,113,${pulse.toFixed(2)})`
    ctx.lineWidth = Math.max(1.8, cell * 0.22)
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.arc(0, 0, Math.max(cell * 2.2, 14), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const spawnProtected = !!(v.spawnShieldUntil && clock < v.spawnShieldUntil)
  if (spawnProtected || (v.shield ?? 0) > 0) {
    const st = vesselStats(v.parts)
    const rad = Math.max((st.maxX - st.minX), (st.maxY - st.minY)) * cell * 0.68
    ctx.save()
    ctx.strokeStyle = spawnProtected ? 'rgba(147,197,253,.75)' : 'rgba(56,217,232,.55)'
    ctx.fillStyle = spawnProtected ? 'rgba(96,165,250,.10)' : 'rgba(56,217,232,.07)'
    ctx.lineWidth = Math.max(1.2, cell * 0.12)
    ctx.beginPath()
    ctx.ellipse(0, 0, Math.max(rad * 0.62, (st.maxX - st.minX) * cell * 0.75), rad, 0, 0, 6.283)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  if (v.empUntil && clock < v.empUntil) {
    const st = vesselStats(v.parts)
    const rad = Math.max(14, (st.maxY - st.minY) * cell * 0.55)
    ctx.strokeStyle = 'rgba(96,165,250,.9)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(Math.sin(clock * 23) * 3, Math.cos(clock * 19) * 3, rad, clock * 8, clock * 8 + 2.4)
    ctx.stroke()
  }
  if (v.burnUntil && clock < v.burnUntil) {
    const st = vesselStats(v.parts)
    const rad = Math.max(12, (st.maxY - st.minY) * cell * 0.45)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let k = 0; k < 4; k += 1) {
      const a = clock * 7 + k * 1.57
      ctx.fillStyle = 'rgba(74,222,128,.75)'
      ctx.beginPath()
      ctx.arc(Math.cos(a) * rad * 0.6, Math.sin(a) * rad * 0.6, Math.max(2, cell * 0.22), 0, 6.283)
      ctx.fill()
    }
    ctx.restore()
  }
  ctx.restore()
}

let lastView: { bodyId: BodyId; pos: Vec; until: number } | null = null

export function resetViewCache() {
  lastView = null
}

export interface FlightFrame {
  cam: Cam | null
  /** araç id → ekran konumu ve hücre boyu (tıklama testi için) */
  hits: { id: number; x: number; y: number; cell: number; rot: number }[]
}

export function renderFlight(ctx: Ctx, sim: Sim, view: View, patches: Patch[]): FlightFrame {
  const gs = sim.gs
  const v = activeVessel(gs)
  const frame: FlightFrame = { cam: null, hits: [] }
  ctx.fillStyle = '#02040a'
  ctx.fillRect(0, 0, view.w, view.h)
  const bodyId: BodyId = v?.bodyId ?? (lastView && view.clock < lastView.until ? lastView.bodyId : 'earth')
  const body = BODIES[bodyId]
  const padR = BODIES.earth.radius + 14
  const vPos = v ? getVisualPos(v) : null
  // Araç kaybedilince kamera son konumda kalır: enkazın savrulup patlaması izlenebilsin.
  if (v && vPos) lastView = { bodyId: v.bodyId, pos: { ...vPos }, until: view.clock + 8 }
  const hold = !v && lastView && view.clock < lastView.until ? lastView : null
  const defPad = gs.mp ? playerPadAngle(gs, gs.ownerId) : PAD_ANGLE
  const lootMode = isLootMode(gs)
  // Yağma modunda gemisi olmayan oyuncunun kamerası kendi uzay üssünde bekler.
  const lootHome = lootMode && gs.ownerId ? (findOutpost(gs, gs.ownerId)?.pos ?? outpostPos(gs.mp?.players[gs.ownerId]?.slot ?? 0)) : null
  let center = vPos ? vPos : hold ? hold.pos : lootHome ? lootHome : { x: Math.cos(defPad) * padR, y: Math.sin(defPad) * padR }
  const r = len(center)
  const theta = Math.atan2(center.y, center.x)
  if (v && vPos && body.landable) {
    // Yüzeye yakınken kamerayı aşağı kaydır: zemin her zaman görünür kalsın.
    const vs = vPos === v.pos ? v : { ...v, pos: vPos }
    const a = Math.max(0, situation(vs).alt)
    const shift = Math.min(a * 0.6 + 6, (0.27 * view.h) / view.zoom) * (1 - Math.min(1, a / 4000))
    center = { x: center.x - (center.x / r) * shift, y: center.y - (center.y / r) * shift }
  }
  const altSea = r - body.radius
  const wRot = 1 - Math.min(1, Math.max(0, (altSea - body.radius * 0.02) / (body.radius * 0.1)))
  const targetRot = wrapPi(Math.PI / 2 - theta) * wRot * wRot * (3 - 2 * wRot)
  view.camRot += wrapPi(targetRot - view.camRot) * 0.12
  if (view.camPan && (view.camPan.x || view.camPan.y)) {
    // Ekranda (px, py) kaydırma → dünya koordinatında kamera merkezinin tersine kayması
    const pan = clampCamPan(view, view.camPan)
    view.camPan = pan
    const cs = Math.cos(view.camRot)
    const sn = Math.sin(view.camRot)
    const ax = -pan.x / view.zoom
    const ay = pan.y / view.zoom
    center = { x: center.x + ax * cs + ay * sn, y: center.y - ax * sn + ay * cs }
  }
  const cam: Cam = { cx: center.x, cy: center.y, rot: view.camRot, z: view.zoom, w: view.w, h: view.h }
  frame.cam = cam

  const rho = airDensity(body, altSea)
  const sky = body.rho0 > 0 ? Math.min(1, (rho / body.rho0) ** 0.4) : 0
  drawStars(ctx, view, 1 - sky * 0.95, cam.rot)
  drawCruiseWarp(ctx, sim, view, cam.rot)
  if (sky > 0.01) {
    const g = ctx.createLinearGradient(0, 0, 0, view.h)
    g.addColorStop(0, mix('#02040a', body.colors.sky, sky * 0.75))
    g.addColorStop(1, mix('#02040a', mix(body.colors.sky, '#ffffff', 0.45), sky))
    ctx.globalAlpha = Math.min(1, sky * 1.2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, view.w, view.h)
    ctx.globalAlpha = 1
    // Rüzgarda süzülen atmosferik bulut katmanları (Dünya/Venüs/Mars/Titan)
    if (sky > 0.16 && cam.z > 0.02) {
      ctx.save()
      ctx.fillStyle = body.id === 'mars' ? 'rgba(235,165,120,.14)' : body.id === 'titan' ? 'rgba(245,190,110,.18)' : 'rgba(255,255,255,.18)'
      for (let i = 0; i < 9; i += 1) {
        const wCloud = 90 + hash(i * 13) * 140
        const spd = 8 + hash(i * 5) * 14
        const x = ((hash(i * 7) * (view.w + 320) + view.clock * spd) % (view.w + 320)) - 160
        const y = view.h * (0.08 + 0.56 * hash(i * 19))
        ctx.beginPath()
        ctx.ellipse(x, y, wCloud * 0.5, 11 + hash(i * 3) * 14, 0, 0, 6.283)
        ctx.fill()
      }
      ctx.restore()
    }
  }
  // Yakın büyük patlamalarda kameraya kısa sarsıntı hissi
  let shakeX = 0
  let shakeY = 0
  for (const f of sim.fx ?? []) {
    if (f.bodyId !== bodyId || f.size < 10) continue
    const age = (sim.clock ?? view.clock) - f.born
    if (age >= 0 && age < 0.48) {
      const decay = (1 - age / 0.48) ** 2
      shakeX += Math.sin(view.clock * 73 + f.born) * Math.min(9, f.size * 0.42) * decay
      shakeY += Math.cos(view.clock * 89 + f.born) * Math.min(9, f.size * 0.42) * decay
    }
  }
  if (shakeX !== 0 || shakeY !== 0) {
    ctx.save()
    ctx.translate(shakeX, shakeY)
  }


  // gök cisimleri
  const hereAbs = bodyAbsState(bodyId, gs.time).r
  for (const b of BODY_LIST) {
    const abs = bodyAbsState(b.id, gs.time).r
    const rel = { x: abs.x - hereAbs.x, y: abs.y - hereAbs.y }
    const p = toScreen(cam, rel)
    const rpx = b.radius * cam.z
    if (rpx < 0.6) continue
    const margin = rpx * (1 + (b.atmoHeight / b.radius) * 1.2) + 50
    // Bulunduğumuz cisim her zaman çizilir: dağlar yarıçapın üstünde kaldığından küre testi yakın
    // zoomda yüzeyi yanlışlıkla ekran dışı sayıyordu (Ay'da yüzey kayboluyordu).
    if (b.id !== bodyId && (p.x < -margin || p.x > view.w + margin || p.y < -margin || p.y > view.h + margin)) continue
    const sunDir = b.id === 'sun' ? { x: 0, y: 0 } : (() => {
      const d = toScreen({ ...cam, cx: 0, cy: 0, w: 0, h: 0, z: 1 }, { x: -abs.x, y: -abs.y })
      const l = Math.hypot(d.x, d.y) || 1
      return { x: d.x / l, y: d.y / l }
    })()
    if (rpx <= 5000) {
      drawSphere(ctx, b, p.x, p.y, rpx, sunDir, cam.rot, true, view.clock)
    } else if (b.id === bodyId) {
      drawTerrain(ctx, cam, b, theta, sim, view.clock)
    }
  }

  // yakındaki yörünge çizgisi (uzaklaştırılmış görünümde)
  if (v && !v.landed && cam.z < 0.02 && patches[0]) {
    ctx.beginPath()
    patches[0].points.forEach((q, i) => {
      const p = toScreen(cam, q)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.strokeStyle = 'rgba(120,220,255,.45)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  if (lootMode && bodyId === 'earth') drawLootWorld(ctx, sim, cam, view.clock)

  // araçlar
  const vac = 1 - Math.min(1, rho / 1.2)
  for (const o of gs.vessels) {
    if (o.debris || o.bodyId !== bodyId || o.autopilot !== 'follow' || !o.followId) continue
    if (gs.mp && o.ownerId !== gs.ownerId) continue
    const leader = gs.vessels.find((l) => l.id === o.followId && l.bodyId === bodyId)
    if (!leader) continue
    const p1 = toScreen(cam, getVisualPos(o))
    const p2 = toScreen(cam, getVisualPos(leader))
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 12) continue
    ctx.save()
    ctx.strokeStyle = 'rgba(56, 217, 232, 0.34)'
    ctx.lineWidth = 1.4
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.restore()
  }
  for (const o of gs.vessels) {
    if (o.bodyId !== bodyId) continue
    const oPos = getVisualPos(o)
    const p = toScreen(cam, oPos)
    if (p.x < -400 || p.x > view.w + 400 || p.y < -400 || p.y > view.h + 400) continue
    const st = vesselStats(o.parts)
    const isActive = o === v
    const cell = o.debris ? Math.max(cam.z, 2.2) : vesselCell(st, cam.z, o.outpost ? 60 : isActive ? 40 : 18)
    if (o.bodyId === bodyId && cam.z > 0.8) {
      const vo = oPos === o.pos ? o : { ...o, pos: oPos }
      const s = situation(vo, st)
      if (s.alt < 90 && s.alt > -20 && body.landable && !o.cruise) {
        withSurfaceFrame(ctx, cam, body, s.theta, () => {
          const a = 0.38 * (1 - Math.max(0, s.alt) / 90)
          const wd = Math.max(0.1, (st.maxX - st.minX) * (0.7 + s.alt / 60))
          ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`
          ctx.beginPath()
          ctx.ellipse(0, 0.2, wd, wd * 0.18, 0, 0, 6.283)
          ctx.fill()
        })
      }
    }
    drawVesselAt(ctx, sim, o, p, cam.rot, cell, sim.clock ?? view.clock, vac, isActive ? view.rcsTx : 0)
    if (!o.debris) frame.hits.push({ id: o.id, x: p.x, y: p.y, cell, rot: Math.PI / 2 - (o.angle + cam.rot) })
    if (isActive && !o.landed && cam.z < 12 && len(o.vel) > 8) {
      const ringR = Math.max(46, ((st.maxY - st.minY) * cell) / 2 + 18)
      const va = Math.atan2(o.vel.y, o.vel.x)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.strokeStyle = 'rgba(255,255,255,.10)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(0, 0, ringR, 0, 6.283)
      ctx.stroke()
      // İleri hız yönü (Prograde - yeşil daire)
      ctx.save()
      ctx.rotate(Math.PI / 2 - (va + cam.rot))
      ctx.strokeStyle = 'rgba(74,222,128,.85)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(0, -ringR, 4, 0, 6.283)
      ctx.stroke()
      ctx.restore()
      // Geri hız yönü (Retrograde - turuncu çarpı)
      ctx.save()
      ctx.rotate(Math.PI / 2 - (va + Math.PI + cam.rot))
      ctx.strokeStyle = 'rgba(255,173,87,.8)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(-3.2, -ringR - 3.2)
      ctx.lineTo(3.2, -ringR + 3.2)
      ctx.moveTo(3.2, -ringR - 3.2)
      ctx.lineTo(-3.2, -ringR + 3.2)
      ctx.stroke()
      ctx.restore()
      ctx.restore()
    }
    if (!isActive && !o.debris) {
      const ownerCol = gs.mp && o.ownerId ? gs.mp.players[o.ownerId]?.color : undefined
      const topBarY = p.y - (st.comY - st.minY) * cell - 8
      ctx.fillStyle = ownerCol ?? 'rgba(255,255,255,.75)'
      ctx.font = ownerCol ? 'bold 11px "DM Mono", monospace' : '11px "DM Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(o.name, p.x, topBarY)
      if (isWarfareMode(gs) && o.ownerId !== gs.ownerId && !o.station) {
        const hs = vesselHealthSummary(o)
        const shCap = st.shieldCap
        const bw = 38
        const by = topBarY + 3
        ctx.fillStyle = 'rgba(10,14,22,.8)'
        ctx.fillRect(p.x - bw / 2, by, bw, 4)
        ctx.fillStyle = '#f87171'
        ctx.fillRect(p.x - bw / 2, by, bw * Math.max(0, Math.min(1, hs.hp / Math.max(1, hs.maxHp))), 4)
        if (shCap > 0 && (o.shield ?? 0) > 0) {
          ctx.fillStyle = '#38d9e8'
          ctx.fillRect(p.x - bw / 2, by - 2.5, bw * Math.min(1, (o.shield ?? 0) / shCap), 2)
        }
      }
    }
  }
  drawProjectiles(ctx, sim, cam, bodyId)
  if (gs.mp && isWarfareMode(gs)) {
    for (const col of allColoniesOnBody(gs, bodyId)) {
      if (col.ownerId === gs.ownerId || col.base.destroyed) continue
      const owner = gs.mp.players[col.ownerId]
      if (!owner) continue
      const colAngle = col.base.siteAngle ?? (col.isEarth ? padAngleForSlot(owner.slot, 'orbital-warfare') : PAD_ANGLE)
      const cPos = colonyCenterWorldPos(bodyId, colAngle, true)
      const dist = Math.hypot(cPos.x - center.x, cPos.y - center.y)
      if (dist > 70_000) continue
      const p = toScreen(cam, cPos)
      const inView = p.x >= 28 && p.x <= view.w - 28 && p.y >= 28 && p.y <= view.h - 28
      const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`
      if (!inView) {
        const cx = view.w / 2
        const cy = view.h / 2
        const ang = Math.atan2(p.y - cy, p.x - cx)
        const bx = Math.max(48, Math.min(view.w - 48, cx + Math.cos(ang) * (view.w * 0.43)))
        const by = Math.max(48, Math.min(view.h - 48, cy + Math.sin(ang) * (view.h * 0.43)))
        ctx.save()
        ctx.fillStyle = owner.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`🏰 ${owner.username} · ${distLabel}`, bx, by)
        ctx.restore()
      }
    }
  }
  if (gs.mp) {
    for (const o of gs.vessels) {
      if (o.bodyId !== bodyId || o === v || o.debris || o.station) continue
      // Yağma modunda kendi üssün de işaretlenir (eve dönüş oku).
      const ownBase = !!o.outpost && o.ownerId === gs.ownerId
      if (!o.ownerId || (o.ownerId === gs.ownerId && !ownBase)) continue
      // Arcade: düşman üsleri radarda; ekran kenarında yalnızca gemiler ve kendi üssün işaretlenir.
      if (o.outpost && !ownBase && isLootMode(gs)) continue
      const owner = gs.mp.players[o.ownerId]
      if (!owner) continue
      const oPos = getVisualPos(o)
      const dist = Math.hypot(oPos.x - center.x, oPos.y - center.y)
      if (dist > 80_000) continue
      if (o.outpost && dist < 400) continue
      const p = toScreen(cam, oPos)
      const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`
      const inView = p.x >= 28 && p.x <= view.w - 28 && p.y >= 28 && p.y <= view.h - 28
      ctx.save()
      ctx.strokeStyle = owner.color
      ctx.fillStyle = owner.color
      ctx.lineWidth = 1.6
      if (inView) {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - 20)
        ctx.lineTo(p.x + 20, p.y)
        ctx.lineTo(p.x, p.y + 20)
        ctx.lineTo(p.x - 20, p.y)
        ctx.closePath()
        ctx.stroke()
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(distLabel, p.x, p.y + 32)
      } else {
        const cx = view.w / 2
        const cy = view.h / 2
        const ang = Math.atan2(p.y - cy, p.x - cx)
        const margin = 44
        const bx = Math.max(margin, Math.min(view.w - margin, cx + Math.cos(ang) * (view.w * 0.44)))
        const by = Math.max(margin, Math.min(view.h - margin, cy + Math.sin(ang) * (view.h * 0.44)))
        ctx.save()
        ctx.translate(bx, by)
        ctx.rotate(ang)
        ctx.beginPath()
        ctx.moveTo(9, 0)
        ctx.lineTo(-5, -6)
        ctx.lineTo(-5, 6)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`${ownBase ? '🏠 Üssün' : o.outpost ? `🛰️ ${owner.username}` : owner.username} · ${distLabel}`, bx, by + 16)
      }
      ctx.restore()
    }
  }
  drawBooms(ctx, sim, cam, bodyId)
  if (lootMode) drawArcadeGuides(ctx, sim, cam, v, view.clock)
  if (lootMode) drawLootRadar(ctx, sim, view, center)
  if (v && !v.debris && view.selectedWeapon === 'gun-missile') {
    const info = view.aimScreen ? aimInfoFromScreen(frame, v, view.aimScreen.x, view.aimScreen.y) : undefined
    const lock = findLockTarget(gs, v, info?.angle, info?.dist)
    if (lock) {
      const lp = toScreen(cam, getVisualPos(lock))
      ctx.save()
      ctx.strokeStyle = '#f43f5e'
      ctx.fillStyle = '#f43f5e'
      ctx.lineWidth = 1.8
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(lp.x, lp.y, 26, 0, 6.283)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = 'bold 10px "DM Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText('🎯 KİLİT', lp.x, lp.y - 32)
      ctx.restore()
    }
  }
  if (v && !v.debris && view.aimScreen && vesselStats(v.parts).weaponCount > 0) {
    const ax = view.aimScreen.x
    const ay = view.aimScreen.y
    const vp = toScreen(cam, getVisualPos(v))
    ctx.save()
    ctx.strokeStyle = 'rgba(251,191,36,.28)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 5])
    ctx.beginPath()
    ctx.moveTo(vp.x, vp.y)
    ctx.lineTo(ax, ay)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(251,191,36,.85)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(ax, ay, 10, 0, 6.283)
    ctx.moveTo(ax - 15, ay)
    ctx.lineTo(ax - 5, ay)
    ctx.moveTo(ax + 5, ay)
    ctx.lineTo(ax + 15, ay)
    ctx.moveTo(ax, ay - 15)
    ctx.lineTo(ax, ay - 5)
    ctx.moveTo(ax, ay + 5)
    ctx.lineTo(ax, ay + 15)
    ctx.stroke()
    ctx.restore()
  }
  if (shakeX !== 0 || shakeY !== 0) ctx.restore()
  return frame
}

/** Ekran noktasına denk gelen aktif araç parçası (yoksa −1). */
export function pickPart(frame: FlightFrame, v: Vessel, sx: number, sy: number): number {
  const hit = frame.hits.find((h) => h.id === v.id)
  if (!hit) return -1
  const dx = sx - hit.x
  const dy = sy - hit.y
  const cs = Math.cos(-hit.rot)
  const sn = Math.sin(-hit.rot)
  const st = vesselStats(v.parts)
  const gx = (dx * cs - dy * sn) / hit.cell + st.comX
  const gy = (dx * sn + dy * cs) / hit.cell + st.comY
  let best = -1
  let bestD = 0.7
  v.parts.forEach((p, i) => {
    const d = partDef(p.def)
    const ox = Math.max(p.x - gx, 0, gx - (p.x + d.w))
    const oy = Math.max(p.y - gy, 0, gy - (p.y + d.h))
    const dist = Math.hypot(ox, oy)
    if (dist < bestD) {
      bestD = dist
      best = i
    }
  })
  return best
}

export function pickVesselFlight(frame: FlightFrame, sim: Sim, sx: number, sy: number): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const h of frame.hits) {
    if (h.id === sim.gs.activeId) continue
    const v = sim.gs.vessels.find((o) => o.id === h.id)
    if (!v) continue
    if (sim.gs.mp && v.ownerId && v.ownerId !== sim.gs.ownerId) continue
    const st = vesselStats(v.parts)
    const rad = Math.max(22, ((st.maxY - st.minY) * h.cell) / 2 + 8)
    const d = Math.hypot(sx - h.x, sy - h.y)
    if (d < rad && d < bestD) {
      bestD = d
      best = h.id
    }
  }
  return best
}

// ───────────────────────── uzay haritası ─────────────────────────

export interface MapFrame {
  vessels: { id: number; x: number; y: number }[]
  bodies: { id: BodyId; x: number; y: number; r: number }[]
}

const PATCH_COLORS = ['#7fe3ff', '#ffb35c', '#9bff9b', '#d7a6ff']

function fmtKm(m: number) {
  const km = m / 1000
  return Math.abs(km) >= 10000 ? `${(km / 1000).toFixed(1)} Mm` : `${km.toFixed(1)} km`
}

export function mapFocusAbs(sim: Sim, view: View): Vec {
  const gs = sim.gs
  let f: Vec
  const v = activeVessel(gs)
  if (view.mapFocus === 'ship' && v) {
    const b = bodyAbsState(v.bodyId, gs.time).r
    f = { x: b.x + v.pos.x, y: b.y + v.pos.y }
  } else {
    f = bodyAbsState(view.mapFocus === 'ship' ? 'earth' : view.mapFocus, gs.time).r
  }
  return { x: f.x + view.mapPan.x, y: f.y + view.mapPan.y }
}

function drawMapCruiseArcs(ctx: Ctx, sim: Sim, S: (p: Vec) => Vec, abs: Record<string, Vec>) {
  const clock = sim.clock ?? 0
  for (const v of sim.gs.vessels) {
    const c = v.cruise
    if (!c) continue
    const fromAbs = abs[c.from] ?? bodyAbsState(c.from, sim.gs.time).r
    const toAbs = abs[c.to] ?? bodyAbsState(c.to, sim.gs.time).r
    const p0 = { x: fromAbs.x + c.fromRel.x, y: fromAbs.y + c.fromRel.y }
    const p3 = { x: toAbs.x + c.toRel.x, y: toAbs.y + c.toRel.y }
    const dist = Math.max(1, len({ x: p3.x - p0.x, y: p3.y - p0.y }))
    const n0 = Math.max(1, len(c.fromRel))
    const n3 = Math.max(1, len(c.toRel))
    const k0 = Math.max(dist * 0.45, BODIES[c.from].radius * 2)
    const k3 = Math.max(dist * 0.3, BODIES[c.to].radius * 2)
    const p1 = { x: p0.x + (c.fromRel.x / n0) * k0, y: p0.y + (c.fromRel.y / n0) * k0 }
    const p2 = { x: p3.x + (c.toRel.x / n3) * k3, y: p3.y + (c.toRel.y / n3) * k3 }
    const bez = (t: number) => {
      const m = 1 - t
      const w0 = m * m * m
      const w1 = 3 * m * m * t
      const w2 = 3 * m * t * t
      const w3 = t * t * t
      return { x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y }
    }
    const u = Math.max(0, Math.min(1, (clock - c.start) / Math.max(0.5, c.dur)))
    const e = u * u * (3 - 2 * u)
    const N = 36
    ctx.save()
    // Hedefe kalan rota (kesikli turkuaz)
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = 'rgba(56,217,232,.42)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i <= N; i += 1) {
      const sp = S(bez(i / N))
      if (i === 0) ctx.moveTo(sp.x, sp.y)
      else ctx.lineTo(sp.x, sp.y)
    }
    ctx.stroke()
    // Geçilen sıcak plazma izi
    ctx.setLineDash([])
    ctx.strokeStyle = '#7feaff'
    ctx.lineWidth = 2.6
    ctx.beginPath()
    const stepsDone = Math.max(2, Math.round(N * e))
    for (let i = 0; i <= stepsDone; i += 1) {
      const sp = S(bez((e * i) / stepsDone))
      if (i === 0) ctx.moveTo(sp.x, sp.y)
      else ctx.lineTo(sp.x, sp.y)
    }
    ctx.stroke()
    // Anlık hızlandırılmış gemi konumu üstünde nabız halkası
    const cur = S(bez(e))
    ctx.fillStyle = '#e0faff'
    ctx.beginPath()
    ctx.arc(cur.x, cur.y, 4.2, 0, 6.283)
    ctx.fill()
    ctx.restore()
  }
}

export function renderMap(ctx: Ctx, sim: Sim, view: View, patches: Patch[]): MapFrame {
  const gs = sim.gs
  const frame: MapFrame = { vessels: [], bodies: [] }
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, view.w, view.h)
  drawStars(ctx, view, 0.5, 0)
  const F = mapFocusAbs(sim, view)
  const z = view.mapZoom
  const S = (p: Vec): Vec => ({ x: view.w / 2 + (p.x - F.x) * z, y: view.h / 2 - (p.y - F.y) * z })
  ctx.font = '12px "DM Mono", monospace'
  ctx.textAlign = 'center'

  const abs: Record<string, Vec> = {}
  for (const b of BODY_LIST) abs[b.id] = bodyAbsState(b.id, gs.time).r
  drawMapCruiseArcs(ctx, sim, S, abs)

  // etki alanları (SOI)
  for (const b of BODY_LIST) {
    if (!Number.isFinite(b.soi)) continue
    const p = S(abs[b.id]!)
    const rpx = b.soi * z
    if (rpx < 6 || rpx > 30000) continue
    const g = ctx.createRadialGradient(p.x, p.y, rpx * 0.2, p.x, p.y, rpx)
    g.addColorStop(0, 'rgba(255,255,255,.10)')
    g.addColorStop(0.85, 'rgba(255,255,255,.07)')
    g.addColorStop(1, 'rgba(255,255,255,.015)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(p.x, p.y, rpx, 0, 6.283)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.14)'
    ctx.lineWidth = 1
    ctx.stroke()
    if (rpx > 60) {
      ctx.fillStyle = 'rgba(255,255,255,.35)'
      ctx.fillText(`${b.name} etki alanı`, p.x, p.y - rpx - 7)
    }
  }

  // gök cisimlerinin yörüngeleri
  for (const b of BODY_LIST) {
    if (!b.orbit || !b.parentId) continue
    const parent = abs[b.parentId]!
    const el = { e: b.orbit.e, argp: b.orbit.argp, dir: 1, p: b.orbit.a * (1 - b.orbit.e * b.orbit.e) }
    ctx.beginPath()
    for (let i = 0; i <= 240; i += 1) {
      const s = stateAtAnomaly(el, (i / 240) * 6.2832, BODIES[b.parentId].mu).r
      const p = S({ x: parent.x + s.x, y: parent.y + s.y })
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.strokeStyle = 'rgba(255,255,255,.22)'
    ctx.lineWidth = 1.4
    ctx.stroke()
  }

  // gök cisimleri
  for (const b of BODY_LIST) {
    const p = S(abs[b.id]!)
    const rpx = Math.max(b.radius * z, b.id === 'sun' ? 7 : b.id === 'moon' ? 3.5 : 5)
    frame.bodies.push({ id: b.id, x: p.x, y: p.y, r: rpx })
    if (p.x < -rpx - 200 || p.x > view.w + rpx + 200 || p.y < -rpx - 200 || p.y > view.h + rpx + 200) continue
    const sd = b.id === 'sun' ? { x: 0, y: 0 } : (() => {
      const a = abs[b.id]!
      const l = Math.hypot(a.x, a.y) || 1
      return { x: -a.x / l, y: a.y / l }
    })()
    drawSphere(ctx, b, p.x, p.y, rpx, sd, 0, b.radius * z > 9, view.clock)
    // 4 çeyrek halkası (yakınlaşmış haritada)
    if (b.landable && rpx >= 14 && !isLootMode(gs)) {
      const flux = solarFlux(len(abs[b.id]!))
      for (const q of QUADRANTS) {
        let qColor: string | null = null
        if (gs.mp && isWarfareMode(gs)) {
          const cols = allColoniesOnBody(gs, b.id).filter((c) => !c.base.destroyed && c.quadrant === q)
          if (cols.length === 1) qColor = gs.mp.players[cols[0]!.ownerId]?.color ?? '#38d9e8'
          else if (cols.length > 1) qColor = '#fbbf24'
        } else if (gs.mp) {
          const qCap = gs.mp.quadrantCaptures?.[b.id]?.[q] ?? (q === 0 ? gs.mp.captures[b.id] : undefined)
          if (qCap?.ownerId) qColor = gs.mp.players[qCap.ownerId]?.color ?? '#38d9e8'
        } else {
          const qb = getActorQuadrantBase(gs, b.id, gs.ownerId ?? 'local', q)
          if (qb && (isQuadrantColonized(qb, flux) || (b.id === 'earth' && q === 0))) qColor = '#4ade80'
        }
        if (qColor) {
          const ca = quadrantCenterAngle(q)
          // Canvas açısı +Y aşağıdır, dolayısıyla canvas açısı = -dünya_açısı
          ctx.save()
          ctx.strokeStyle = qColor
          ctx.lineWidth = 2.6
          ctx.beginPath()
          ctx.arc(p.x, p.y, rpx + 3, -ca - Math.PI / 4 + 0.12, -ca + Math.PI / 4 - 0.12)
          ctx.stroke()
          ctx.restore()
        }
      }
    }
    const cap = gs.mp?.captures[b.id]
    if (gs.mp && isWarfareMode(gs)) {
      const cols = allColoniesOnBody(gs, b.id).filter((c) => !c.base.destroyed)
      ctx.fillStyle = cols.length ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.6)'
      ctx.fillText(cols.length ? `${b.name} 🏰${cols.length}` : b.name, p.x, p.y + rpx + 16)
    } else if (gs.mp && cap) {
      const owner = cap.ownerId ? gs.mp.players[cap.ownerId] : null
      const capturer = cap.capturerId ? gs.mp.players[cap.capturerId] : null
      const qHeld = QUADRANTS.filter((q) => (gs.mp?.quadrantCaptures?.[b.id]?.[q] ?? (q === 0 ? cap : undefined))?.ownerId).length
      const haloR = rpx + 5
      if (owner || capturer) {
        ctx.save()
        ctx.strokeStyle = owner?.color ?? capturer?.color ?? '#38d9e8'
        ctx.lineWidth = cap.phase === 'captured' ? 2.2 : 1.6
        if (cap.phase === 'contested') ctx.setLineDash([4, 3])
        ctx.beginPath()
        if (cap.phase === 'claiming' || cap.phase === 'neutralizing') {
          ctx.arc(p.x, p.y, haloR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.05, cap.progress))
        } else {
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2)
        }
        ctx.stroke()
        ctx.restore()
      }
      ctx.fillStyle = owner?.color ?? 'rgba(255,255,255,.65)'
      ctx.fillText(qHeld > 0 ? `${b.name} (${qHeld}/4)` : b.name, p.x, p.y + rpx + 16)
      if (cap.phase === 'contested') {
        ctx.fillStyle = '#fb7185'
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText('⇄', p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      } else if (owner) {
        ctx.fillStyle = owner.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText(`🛰️ ${owner.username}`, p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      } else if (capturer && cap.phase === 'neutralizing') {
        ctx.fillStyle = capturer.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText(`🛰️ ${Math.round(cap.progress * 100)}%`, p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      } else if (capturer && cap.progress > 0) {
        ctx.fillStyle = capturer.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText(`📍 ${capturer.username}`, p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      }
    } else if (!gs.mp && b.landable) {
      const flux = solarFlux(len(abs[b.id]!))
      let anyBase = false
      let colCount = 0
      for (const q of QUADRANTS) {
        const qb = getActorQuadrantBase(gs, b.id, gs.ownerId ?? 'local', q)
        if (qb) {
          anyBase = true
          if (isQuadrantColonized(qb, flux)) colCount += 1
        }
      }
      if (b.id !== 'earth' && anyBase) {
        ctx.fillStyle = colCount > 0 ? '#4ade80' : 'rgba(255,255,255,.78)'
        ctx.fillText(colCount > 0 ? `${b.name} 🛰️(${colCount}/4)` : `${b.name} 📍`, p.x, p.y + rpx + 16)
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.6)'
        ctx.fillText(b.name, p.x, p.y + rpx + 16)
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.6)'
      ctx.fillText(b.name, p.x, p.y + rpx + 16)
    }
  }

  // tahmini yörünge yamaları
  patches.forEach((patch, k) => {
    const origin = abs[patch.bodyId]!
    const color = PATCH_COLORS[k % PATCH_COLORS.length]!
    ctx.beginPath()
    patch.points.forEach((q, i) => {
      const p = S({ x: origin.x + q.x, y: origin.y + q.y })
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = k === 0 ? 2 : 1.6
    ctx.setLineDash(k === 0 ? [] : [7, 5])
    ctx.stroke()
    ctx.setLineDash([])
    const last = patch.points[patch.points.length - 1]!
    const lp = S({ x: origin.x + last.x, y: origin.y + last.y })
    const body = BODIES[patch.bodyId]
    const label = (text: string, p: Vec, col: string) => {
      ctx.fillStyle = col
      ctx.fillText(text, p.x, p.y - 10)
    }
    if (patch.end === 'impact') {
      ctx.strokeStyle = '#ff6b6b'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(lp.x - 6, lp.y - 6)
      ctx.lineTo(lp.x + 6, lp.y + 6)
      ctx.moveTo(lp.x + 6, lp.y - 6)
      ctx.lineTo(lp.x - 6, lp.y + 6)
      ctx.stroke()
      if (k > 0) label(`${body.name}: çarpışma`, lp, '#ff6b6b')
    } else if (patch.end === 'encounter' || patch.end === 'escape') {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(lp.x, lp.y, 5, 0, 6.283)
      ctx.stroke()
      label(patch.end === 'encounter' ? 'karşılaşma' : `${body.name} çıkış`, lp, color)
    }
    // enberi / öte nokta işaretleri
    const el = patch.el
    const mark = (nu: number, text: string) => {
      const q = stateAtAnomaly(el, nu, body.mu).r
      const p = S({ x: origin.x + q.x, y: origin.y + q.y })
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - 5, p.y - 9)
      ctx.lineTo(p.x + 5, p.y - 9)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 12px "DM Mono", monospace'
      ctx.fillText(text, p.x, p.y - 14)
      ctx.font = '12px "DM Mono", monospace'
    }
    if (k === 0 && el.e < 1 && patch.end === 'orbit') {
      mark(Math.PI, `Öte ${fmtKm(el.ra - body.radius)}`)
      mark(0, `Enberi ${fmtKm(el.rp - body.radius)}`)
    } else if (k === 0 && el.e < 1 && el.nu > 0 && el.nu < Math.PI && el.ra < body.soi) {
      mark(Math.PI, `Öte ${fmtKm(el.ra - body.radius)}`)
    } else if (k > 0 && el.rp > body.radius && el.nu < 0) {
      mark(0, `${body.name} enberi ${fmtKm(el.rp - body.radius)}`)
    }
  })

  // araçlar
  for (const o of gs.vessels) {
    if (o.debris || o.autopilot !== 'follow' || !o.followId) continue
    if (gs.mp && o.ownerId !== gs.ownerId) continue
    const leader = gs.vessels.find((l) => l.id === o.followId)
    if (!leader) continue
    const o1 = abs[o.bodyId]!
    const o2 = abs[leader.bodyId]!
    const vp1 = getVisualPos(o)
    const vp2 = getVisualPos(leader)
    const p1 = S({ x: o1.x + vp1.x, y: o1.y + vp1.y })
    const p2 = S({ x: o2.x + vp2.x, y: o2.y + vp2.y })
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 10) continue
    ctx.save()
    ctx.strokeStyle = 'rgba(56, 217, 232, 0.42)'
    ctx.lineWidth = 1.4
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.restore()
  }
  for (const v of gs.vessels) {
    if (v.debris) continue
    const o = abs[v.bodyId]!
    const vp = getVisualPos(v)
    const p = S({ x: o.x + vp.x, y: o.y + vp.y })
    frame.vessels.push({ id: v.id, x: p.x, y: p.y })
    const active = v.id === gs.activeId
    const mpCol = gs.mp && v.ownerId ? gs.mp.players[v.ownerId]?.color : undefined
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(Math.PI / 2 - v.angle)
    const s = active ? 9 : 7
    ctx.beginPath()
    ctx.moveTo(0, -s * 1.5)
    ctx.lineTo(s, s)
    ctx.lineTo(0, s * 0.45)
    ctx.lineTo(-s, s)
    ctx.closePath()
    ctx.fillStyle = mpCol ?? (active ? '#ffffff' : 'rgba(190,200,215,.75)')
    ctx.fill()
    if (active) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
    ctx.restore()
    if (!active) {
      ctx.fillStyle = mpCol ?? 'rgba(190,200,215,.7)'
      ctx.fillText(v.name, p.x, p.y + 20)
    }
  }
  return frame
}
