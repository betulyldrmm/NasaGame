/** Uçuş görünümü ve uzay haritası çizimi (Canvas 2D, 2.5D gölgelendirme). */
import { partDef } from '../game/data'
import { isBodyColonized, MODULE_BY_ID } from '../game/base'
import type { Vessel } from '../game/types'
import { vesselStats } from '../game/vessel'
import { bodyAbsState, len, stateAtAnomaly, type Vec, wrapPi } from '../flight/orbit'
import { airDensity, PAD_ANGLE, situation, terrainHeight } from '../flight/physics'
import type { Patch } from '../flight/predict'
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
  const g = ctx.createRadialGradient(cx + light.x * rpx * 0.5, cy + light.y * rpx * 0.5, rpx * 0.05, cx, cy, rpx * 1.02)
  g.addColorStop(0, body.colors.light)
  g.addColorStop(0.45, body.colors.base)
  g.addColorStop(1, body.colors.dark)
  return g
}

function drawSphere(ctx: Ctx, body: BodyDef, cx: number, cy: number, rpx: number, light: Vec, rot: number, detail: boolean) {
  if (body.id === 'sun') {
    const glow = ctx.createRadialGradient(cx, cy, rpx * 0.6, cx, cy, rpx * 4)
    glow.addColorStop(0, 'rgba(255,220,120,.55)')
    glow.addColorStop(1, 'rgba(255,170,60,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, rpx * 4, 0, 6.283)
    ctx.fill()
  }
  if (body.atmoHeight > 0) {
    const ar = rpx * (1 + body.atmoHeight / body.radius)
    const g = ctx.createRadialGradient(cx, cy, rpx * 0.98, cx, cy, ar)
    g.addColorStop(0, body.id === 'earth' ? 'rgba(120,190,255,.5)' : 'rgba(240,170,120,.32)')
    g.addColorStop(1, 'rgba(120,190,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, ar, 0, 6.283)
    ctx.fill()
  }
  if (body.id === 'saturn' && rpx >= 4) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.35 - rot * 0.1)
    ctx.strokeStyle = 'rgba(235,212,165,.42)'
    ctx.lineWidth = Math.max(1.2, rpx * 0.28)
    ctx.beginPath()
    ctx.ellipse(0, 0, rpx * 2.1, rpx * 0.42, 0, Math.PI, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, rpx, 0, 6.283)
  ctx.fillStyle = sphereFill(ctx, body, cx, cy, rpx, light)
  ctx.fill()
  if (detail && rpx >= 9 && body.id !== 'sun') {
    ctx.save()
    ctx.clip()
    ctx.translate(cx, cy)
    ctx.rotate(-rot)
    if (body.id === 'jupiter' || body.id === 'saturn') {
      const bands = body.id === 'jupiter' ? ['rgba(165,98,54,.35)', 'rgba(245,220,185,.32)', 'rgba(130,68,38,.3)'] : ['rgba(175,148,96,.25)', 'rgba(245,232,190,.22)']
      for (let i = -3; i <= 3; i += 1) {
        ctx.fillStyle = bands[Math.abs(i) % bands.length]!
        ctx.fillRect(-rpx * 1.1, i * rpx * 0.22 - rpx * 0.08, rpx * 2.2, rpx * 0.14)
      }
      if (body.id === 'jupiter') {
        ctx.fillStyle = 'rgba(195,78,52,.5)'
        ctx.beginPath()
        ctx.ellipse(rpx * 0.25, rpx * 0.28, rpx * 0.22, rpx * 0.12, 0, 0, 6.283)
        ctx.fill()
      }
    } else {
      const n = body.id === 'earth' ? 9 : 14
      for (let i = 0; i < n; i += 1) {
        const a = hash(i + body.radius) * 6.283
        const d = Math.sqrt(hash(i * 3 + 1)) * rpx * 0.9
        const s = rpx * (body.id === 'earth' ? 0.16 + 0.22 * hash(i * 7) : 0.04 + 0.11 * hash(i * 7))
        ctx.beginPath()
        ctx.ellipse(Math.cos(a) * d, -Math.sin(a) * d, s, s * (0.55 + 0.4 * hash(i * 11)), hash(i * 13) * 3, 0, 6.283)
        ctx.fillStyle =
          body.id === 'earth'
            ? 'rgba(70,160,90,.55)'
            : body.id === 'venus' || body.id === 'titan'
              ? 'rgba(245,205,130,.28)'
              : 'rgba(60,62,75,.35)'
        ctx.fill()
      }
    }
    ctx.restore()
    // gece tarafı
    const sh = ctx.createLinearGradient(cx + light.x * rpx, cy + light.y * rpx, cx - light.x * rpx, cy - light.y * rpx)
    sh.addColorStop(0.35, 'rgba(0,0,10,0)')
    sh.addColorStop(1, 'rgba(0,0,10,.62)')
    ctx.beginPath()
    ctx.arc(cx, cy, rpx, 0, 6.283)
    ctx.fillStyle = sh
    ctx.fill()
  }
  if (body.id === 'saturn' && rpx >= 4) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.35 - rot * 0.1)
    ctx.strokeStyle = 'rgba(245,222,175,.68)'
    ctx.lineWidth = Math.max(1.2, rpx * 0.28)
    ctx.beginPath()
    ctx.ellipse(0, 0, rpx * 2.1, rpx * 0.42, 0, 0, Math.PI)
    ctx.stroke()
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

function drawPad(ctx: Ctx) {
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
  ctx.fillStyle = '#ff5d5d'
  ctx.beginPath()
  ctx.arc(-12, -37, 0.7, 0, 6.283)
  ctx.fill()
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
function drawBaseSites(ctx: Ctx, sites: (string | null)[]) {
  ctx.imageSmoothingEnabled = false
  sites.forEach((id, i) => {
    const def = id ? MODULE_BY_ID[id] : null
    const img = def ? sprite(def.sprite) : null
    if (!img) return
    const w = 11
    const h = (w * img.naturalHeight) / img.naturalWidth
    ctx.drawImage(img, 28 + i * 13 - w / 2, -h + 0.3, w, h)
  })
  ctx.imageSmoothingEnabled = true
}

/** Rampanın yanındaki su kulesi (egzoza 5 sn maruz kalırsa fırlar). */
function drawWaterTower(ctx: Ctx, flame: number) {
  ctx.strokeStyle = '#6d7785'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(-2.6, 0)
  ctx.lineTo(-1.6, -11)
  ctx.moveTo(2.6, 0)
  ctx.lineTo(1.6, -11)
  ctx.moveTo(-2.2, -4)
  ctx.lineTo(2.2, -8)
  ctx.moveTo(2.2, -4)
  ctx.lineTo(-2.2, -8)
  ctx.stroke()
  const g = ctx.createLinearGradient(-3.5, 0, 3.5, 0)
  g.addColorStop(0, '#7d8791')
  g.addColorStop(0.4, '#ffffff')
  g.addColorStop(1, '#6a737d')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(0, -14, 3.6, 3.4, 0, 0, 6.283)
  ctx.fill()
  ctx.fillStyle = '#3f8fd8'
  ctx.fillRect(-3.4, -14.6, 6.8, 1.2)
  if (flame > 0) {
    const fg = ctx.createLinearGradient(0, 0, 0, 9 * flame)
    fg.addColorStop(0, 'rgba(255,255,255,.95)')
    fg.addColorStop(0.3, 'rgba(160,220,255,.8)')
    fg.addColorStop(1, 'rgba(120,180,255,0)')
    ctx.fillStyle = fg
    ctx.beginPath()
    ctx.moveTo(-2.4, 0)
    ctx.lineTo(0, 9 * flame)
    ctx.lineTo(2.4, 0)
    ctx.closePath()
    ctx.fill()
  }
}

/** "İstikbal göklerdedir" anıtı. */
function drawMonument(ctx: Ctx) {
  const g = ctx.createLinearGradient(-1.4, 0, 1.4, 0)
  g.addColorStop(0, '#8b949f')
  g.addColorStop(0.45, '#f1f4f8')
  g.addColorStop(1, '#6a737d')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-1.5, 0)
  ctx.lineTo(-0.9, -12)
  ctx.lineTo(0, -14)
  ctx.lineTo(0.9, -12)
  ctx.lineTo(1.5, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#4b525b'
  ctx.fillRect(-3, -0.9, 6, 0.9)
}

/** Gökyüzü easter egg'leri: düşen balina + petunya saksısı, sürüklenen kırmızı spor araba. */
function drawSkyEggs(ctx: Ctx, sim: Sim, view: View, v: Vessel | null) {
  const clock = sim.clock ?? 0
  for (const f of sim.fx ?? []) {
    if (f.kind !== 'whale') continue
    const age = clock - f.born
    if (age > 11) continue
    const y = -90 + (view.h + 200) * Math.min(1, (age / 10) ** 1.6)
    ctx.save()
    ctx.translate(view.w * 0.74, y)
    ctx.rotate(0.5 + Math.sin(age * 1.3) * 0.12)
    ctx.fillStyle = '#5b7fa6'
    ctx.beginPath()
    ctx.ellipse(0, 0, 54, 22, 0, 0, 6.283)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-48, 0)
    ctx.lineTo(-78, -20)
    ctx.lineTo(-70, 0)
    ctx.lineTo(-78, 20)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#dfe8f2'
    ctx.beginPath()
    ctx.ellipse(8, 9, 40, 10, 0, 0, Math.PI)
    ctx.fill()
    ctx.fillStyle = '#0b1424'
    ctx.beginPath()
    ctx.arc(34, -5, 3, 0, 6.283)
    ctx.fill()
    ctx.restore()
    // petunya saksısı
    ctx.save()
    ctx.translate(view.w * 0.74 + 110, y - 60)
    ctx.rotate(age * 2)
    ctx.fillStyle = '#b5633c'
    ctx.beginPath()
    ctx.moveTo(-9, -4)
    ctx.lineTo(9, -4)
    ctx.lineTo(6, 10)
    ctx.lineTo(-6, 10)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#3f8a4f'
    ctx.fillRect(-1, -14, 2, 10)
    ctx.fillStyle = '#e879c6'
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath()
      ctx.arc(Math.cos(i * 1.257) * 5, -16 + Math.sin(i * 1.257) * 5, 3.4, 0, 6.283)
      ctx.fill()
    }
    ctx.fillStyle = '#fde68a'
    ctx.beginPath()
    ctx.arc(0, -16, 2.2, 0, 6.283)
    ctx.fill()
    ctx.restore()
  }
  // Starman: yüksek irtifada arada bir geçen kırmızı araba
  // Starman: yalnızca Dünya yörüngesinde ve nadiren (yaklaşık 8 dakikada bir) geçer
  const inEarthOrbit = !!v && !v.landed && v.bodyId === 'earth' && len(v.pos) - BODIES.earth.radius > BODIES.earth.atmoHeight
  if (v && inEarthOrbit && hash(Math.floor(view.clock / 60) + 17) < 0.13) {
    const cycle = view.clock % 60
    if (cycle < 16) {
      const x = -80 + (view.w + 160) * (cycle / 16)
      ctx.save()
      ctx.translate(x, view.h * 0.2 + Math.sin(cycle * 0.7) * 10)
      ctx.rotate(-0.12 + Math.sin(cycle * 0.4) * 0.08)
      ctx.fillStyle = '#d7263d'
      ctx.beginPath()
      ctx.moveTo(-26, 4)
      ctx.lineTo(-24, -4)
      ctx.lineTo(-8, -6)
      ctx.lineTo(-2, -12)
      ctx.lineTo(10, -12)
      ctx.lineTo(16, -5)
      ctx.lineTo(27, -2)
      ctx.lineTo(27, 5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#12233f'
      ctx.beginPath()
      ctx.moveTo(-1, -10.5)
      ctx.lineTo(8.5, -10.5)
      ctx.lineTo(13, -5.5)
      ctx.lineTo(-4, -5.5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#f4f6f8'
      ctx.beginPath()
      ctx.arc(3, -11.5, 3.6, 0, 6.283)
      ctx.fill()
      ctx.fillStyle = '#1b1e23'
      ctx.fillRect(3.4, -12.6, 2.6, 2)
      ctx.beginPath()
      ctx.arc(-15, 6, 5, 0, 6.283)
      ctx.arc(16, 6, 5, 0, 6.283)
      ctx.fill()
      ctx.fillStyle = '#9aa3ad'
      ctx.beginPath()
      ctx.arc(-15, 6, 2, 0, 6.283)
      ctx.arc(16, 6, 2, 0, 6.283)
      ctx.fill()
      ctx.restore()
    }
  }
}

/** Patlamalar: ateş topu, şok dalgası, kıvılcımlar ve duman. */
function drawBooms(ctx: Ctx, sim: Sim, cam: Cam, bodyId: BodyId) {
  const clock = sim.clock ?? 0
  for (const f of sim.fx ?? []) {
    if (f.kind !== 'boom' || f.bodyId !== bodyId) continue
    const age = clock - f.born
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
  // uzak sırt (derinlik hissi)
  if (cam.z > 0.15) {
    layer((t) => terrainHeight(body.id, t + 0.00041) * 0.85 + 16 + 9 * Math.sin(t * 5200 + 1.3), body.id === 'earth' ? '#2f6b4f' : mix(c.dark, c.base, 0.45))
    layer((t) => terrainHeight(body.id, t - 0.00023) * 0.95 + 7 + 4 * Math.sin(t * 8300), body.id === 'earth' ? '#3f8a4f' : mix(c.dark, c.base, 0.75))
  }
  const top = pt(focusTheta, body.radius + terrainHeight(body.id, focusTheta))
  const low = pt(focusTheta, body.radius + terrainHeight(body.id, focusTheta) - Math.min(depth, 260 / Math.min(1, cam.z) ))
  const g = ctx.createLinearGradient(top.x, top.y, low.x, low.y)
  if (body.id === 'earth') {
    g.addColorStop(0, '#6fbf5a')
    g.addColorStop(0.04, '#3f8f3c')
    g.addColorStop(0.12, '#6b5a3a')
    g.addColorStop(1, '#2a2318')
  } else {
    g.addColorStop(0, c.light)
    g.addColorStop(0.08, c.base)
    g.addColorStop(1, mix(c.dark, '#000000', 0.5))
  }
  layer((t) => terrainHeight(body.id, t), g, body.id === 'earth' ? '#a6e38a' : mix(c.light, '#ffffff', 0.5))

  if (cam.z > 0.45) {
    // yüzey detayları: krater, kaya, ağaç
    const spacing = 23
    const dTheta = spacing / body.radius
    const span = Math.min(half, (diag / cam.z / body.radius) * 0.6)
    const k0 = Math.floor((focusTheta - span) / dTheta)
    const k1 = Math.ceil((focusTheta + span) / dTheta)
    for (let k = k0; k <= k1; k += 1) {
      const r1 = hash(k * 1.37 + body.radius)
      const theta = (k + hash(k) * 0.6) * dTheta
      const padMargin = sim.gs.mp ? 700 : 90
      if (body.id === 'earth' && Math.abs(wrapPi(theta - PAD_ANGLE)) * body.radius < padMargin) continue
      if (r1 > 0.62) continue
      withSurfaceFrame(ctx, cam, body, theta, () => {
        const s = 0.6 + hash(k * 3.1) * 1.4
        if (body.id === 'earth') {
          if (r1 < 0.4) {
            ctx.fillStyle = '#5a4630'
            ctx.fillRect(-0.4 * s, -3 * s, 0.8 * s, 3 * s)
            for (let j = 0; j < 3; j += 1) {
              ctx.beginPath()
              ctx.moveTo(-3.2 * s + j * 0.5 * s, -2.5 * s - j * 2.6 * s)
              ctx.lineTo(0, -8 * s - j * 2.4 * s)
              ctx.lineTo(3.2 * s - j * 0.5 * s, -2.5 * s - j * 2.6 * s)
              ctx.closePath()
              ctx.fillStyle = j % 2 ? '#2f7a3b' : '#256b33'
              ctx.fill()
            }
          } else {
            ctx.fillStyle = '#4c9a4a'
            ctx.beginPath()
            ctx.ellipse(0, -0.8 * s, 2.6 * s, 1.5 * s, 0, 0, 6.283)
            ctx.fill()
          }
        } else if (r1 < 0.3) {
          const rx = 4 + hash(k * 5.3) * 11
          ctx.beginPath()
          ctx.ellipse(0, 0.3, rx, rx * 0.2, 0, 0, 6.283)
          ctx.fillStyle = mix(c.dark, '#000000', 0.25)
          ctx.fill()
          ctx.beginPath()
          ctx.ellipse(0, 0.3, rx, rx * 0.2, 0, Math.PI, 6.283)
          ctx.strokeStyle = mix(c.light, '#ffffff', 0.4)
          ctx.lineWidth = 0.35
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
      for (const p of Object.values(sim.gs.mp.players)) {
        const thetaPad = padAngleForSlot(p.slot)
        withSurfaceFrame(ctx, cam, body, thetaPad, () => {
          drawPad(ctx)
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
        drawPad(ctx)
      })
    }
    withSurfaceFrame(ctx, cam, body, PAD_ANGLE, () => {
      ctx.save()
      ctx.translate(-52, 0)
      drawMonument(ctx)
      ctx.restore()
      const launch = (sim.fx ?? []).find((f) => f.kind === 'tower')
      const age = launch ? (sim.clock ?? 0) - launch.born : -1
      if (!sim.towerGone || (age >= 0 && age < 9)) {
        ctx.save()
        ctx.translate(36, age >= 0 ? -4 * age * age : 0)
        drawWaterTower(ctx, age >= 0 ? 1 + 0.2 * Math.sin(age * 40) : 0)
        ctx.restore()
      }
    })
  }
  const earthBase = sim.gs.mp ? sim.gs.mp.players[sim.gs.ownerId ?? '']?.earthBase : sim.gs.bases[body.id]
  const base = body.id === 'earth' ? earthBase : sim.gs.bases[body.id]
  const baseAngle = body.id === 'earth' && sim.gs.mp ? playerPadAngle(sim.gs, sim.gs.ownerId) : base?.siteAngle ?? PAD_ANGLE
  if (base && cam.z > 0.2) withSurfaceFrame(ctx, cam, body, baseAngle, () => drawBaseSites(ctx, base.sites ?? []))

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
  drawVesselParts(ctx, v.parts, cell, { firing: sim.firing.get(v.id), time: clock, vacuum: vac, rcsTx })
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
  let center = vPos ? vPos : hold ? hold.pos : { x: Math.cos(defPad) * padR, y: Math.sin(defPad) * padR }
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
  }

  drawSkyEggs(ctx, sim, view, v)

  // gök cisimleri
  const hereAbs = bodyAbsState(bodyId, gs.time).r
  for (const b of BODY_LIST) {
    const abs = bodyAbsState(b.id, gs.time).r
    const rel = { x: abs.x - hereAbs.x, y: abs.y - hereAbs.y }
    const p = toScreen(cam, rel)
    const rpx = b.radius * cam.z
    if (rpx < 0.6) continue
    const margin = rpx * (1 + (b.atmoHeight / b.radius) * 1.2) + 50
    if (p.x < -margin || p.x > view.w + margin || p.y < -margin || p.y > view.h + margin) continue
    const sunDir = b.id === 'sun' ? { x: 0, y: 0 } : (() => {
      const d = toScreen({ ...cam, cx: 0, cy: 0, w: 0, h: 0, z: 1 }, { x: -abs.x, y: -abs.y })
      const l = Math.hypot(d.x, d.y) || 1
      return { x: d.x / l, y: d.y / l }
    })()
    if (rpx <= 5000) {
      drawSphere(ctx, b, p.x, p.y, rpx, sunDir, cam.rot, true)
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

  // araçlar
  const vac = 1 - Math.min(1, rho / 1.2)
  for (const o of gs.vessels) {
    if (o.bodyId !== bodyId) continue
    const oPos = getVisualPos(o)
    const p = toScreen(cam, oPos)
    if (p.x < -400 || p.x > view.w + 400 || p.y < -400 || p.y > view.h + 400) continue
    const st = vesselStats(o.parts)
    const isActive = o === v
    const cell = o.debris ? Math.max(cam.z, 2.2) : vesselCell(st, cam.z, isActive ? 40 : 18)
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
    drawVesselAt(ctx, sim, o, p, cam.rot, cell, view.clock, vac, isActive ? view.rcsTx : 0)
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
      ctx.fillStyle = ownerCol ?? 'rgba(255,255,255,.75)'
      ctx.font = ownerCol ? 'bold 11px "DM Mono", monospace' : '11px "DM Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(o.name, p.x, p.y - (st.comY - st.minY) * cell - 8)
    }
  }
  if (gs.mp) {
    for (const o of gs.vessels) {
      if (o.bodyId !== bodyId || o === v || o.debris || o.station) continue
      if (!o.ownerId || o.ownerId === gs.ownerId) continue
      const owner = gs.mp.players[o.ownerId]
      if (!owner) continue
      const oPos = getVisualPos(o)
      const dist = Math.hypot(oPos.x - center.x, oPos.y - center.y)
      if (dist > 80_000) continue
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
        ctx.fillText(`⚔ ${distLabel}`, p.x, p.y + 32)
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
        ctx.fillText(`⚔ ${owner.username} · ${distLabel}`, bx, by + 16)
      }
      ctx.restore()
    }
  }
  drawBooms(ctx, sim, cam, bodyId)
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
    drawSphere(ctx, b, p.x, p.y, rpx, sd, 0, b.radius * z > 9)
    const cap = gs.mp?.captures[b.id]
    if (gs.mp && cap) {
      const owner = cap.ownerId ? gs.mp.players[cap.ownerId] : null
      const capturer = cap.capturerId ? gs.mp.players[cap.capturerId] : null
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
      ctx.fillText(b.name, p.x, p.y + rpx + 16)
      if (cap.phase === 'contested') {
        ctx.fillStyle = '#fb7185'
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText('⚔', p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      } else if (owner) {
        ctx.fillStyle = owner.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText(`🛰️ ${owner.username}`, p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      } else if (capturer && cap.phase === 'neutralizing') {
        ctx.fillStyle = capturer.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText(`⚔ ${Math.round(cap.progress * 100)}%`, p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      } else if (capturer && cap.progress > 0) {
        ctx.fillStyle = capturer.color
        ctx.font = 'bold 10px "DM Mono", monospace'
        ctx.fillText(`📍 ${capturer.username}`, p.x, p.y + rpx + 29)
        ctx.font = '12px "DM Mono", monospace'
      }
    } else if (!gs.mp && b.id !== 'earth' && gs.bases[b.id]) {
      const col = isBodyColonized(gs.bases[b.id], solarFlux(len(abs[b.id]!)))
      ctx.fillStyle = col ? '#4ade80' : 'rgba(255,255,255,.78)'
      ctx.fillText(col ? `${b.name} 🛰️` : `${b.name} 📍`, p.x, p.y + rpx + 16)
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
