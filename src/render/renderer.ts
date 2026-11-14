/** Uçuş görünümü ve uzay haritası çizimi (Canvas 2D, 2.5D gölgelendirme). */
import { partDef } from '../game/data'
import { MODULES } from '../game/base'
import type { Vessel } from '../game/types'
import { vesselStats } from '../game/vessel'
import { bodyAbsState, len, stateAtAnomaly, type Vec, wrapPi } from '../flight/orbit'
import { airDensity, PAD_ANGLE, situation, terrainHeight } from '../flight/physics'
import type { Patch } from '../flight/predict'
import { activeVessel, type Sim } from '../flight/world'
import { BODIES, BODY_LIST, type BodyDef, type BodyId } from '../nasa/bodies'
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
}

export function createView(): View {
  return { w: 800, h: 600, zoom: 7, camRot: 0, map: false, mapZoom: 2.2e-5, mapFocus: 'earth', mapPan: { x: 0, y: 0 }, clock: 0 }
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

function drawBaseModules(ctx: Ctx, modules: Record<string, number>, clock: number) {
  let x = 26
  for (const m of MODULES) {
    const n = Math.min(4, modules[m.id] ?? 0)
    for (let i = 0; i < n; i += 1) {
      ctx.save()
      ctx.translate(x, 0)
      if (m.id === 'habitat' || m.id === 'lab') {
        const g = ctx.createRadialGradient(-2, -5, 0.5, 0, -2, 7)
        g.addColorStop(0, '#ffffff')
        g.addColorStop(0.5, m.id === 'lab' ? '#9fd8ff' : '#d9dee6')
        g.addColorStop(1, '#5b6470')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(0, 0, 6, 6, 0, Math.PI, 0)
        ctx.fill()
        ctx.fillStyle = '#38d9e8'
        ctx.fillRect(-1.2, -3.4, 2.4, 1.6)
        ctx.fillStyle = '#3a4048'
        ctx.fillRect(-6.4, -0.4, 12.8, 1)
      } else if (m.id === 'solar-farm') {
        ctx.fillStyle = '#6d7785'
        ctx.fillRect(-0.3, -3.5, 0.6, 3.5)
        ctx.save()
        ctx.translate(0, -3.6)
        ctx.rotate(-0.35)
        const g = ctx.createLinearGradient(-4.5, 0, 4.5, 0)
        g.addColorStop(0, '#14336e')
        g.addColorStop(1, '#3a7be0')
        ctx.fillStyle = g
        ctx.fillRect(-4.5, -0.5, 9, 1)
        ctx.restore()
      } else if (m.id === 'drill') {
        ctx.strokeStyle = '#c3cad2'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(-3, 0)
        ctx.lineTo(0, -9)
        ctx.lineTo(3, 0)
        ctx.moveTo(-1.8, -3.6)
        ctx.lineTo(1.8, -3.6)
        ctx.stroke()
        ctx.fillStyle = '#ffad57'
        ctx.fillRect(-0.5, -6 + Math.sin(clock * 3 + i) * 1.5, 1, 6)
      } else if (m.id === 'telemetry' || m.id === 'quantum-relay') {
        ctx.fillStyle = '#5b6470'
        ctx.fillRect(-1.2, -5.5, 2.4, 5.5)
        ctx.strokeStyle = m.id === 'quantum-relay' ? '#38d9e8' : '#dfe4ea'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(0, -7, 4.2, Math.PI * 0.15, Math.PI * 0.85)
        ctx.stroke()
        ctx.fillStyle = m.id === 'quantum-relay' ? '#4ade80' : '#ffad57'
        ctx.beginPath()
        ctx.arc(0, -8.5 + Math.sin(clock * 2) * 0.3, 0.9, 0, 6.283)
        ctx.fill()
      } else if (m.id === 'datacenter') {
        ctx.fillStyle = '#1b2b47'
        ctx.fillRect(-4, -8, 8, 8)
        ctx.fillStyle = '#38d9e8'
        for (let r = 0; r < 3; r += 1) ctx.fillRect(-2.5, -6.5 + r * 2.2, 5, 0.9)
      } else if (m.id === 'biodome') {
        ctx.fillStyle = 'rgba(74, 222, 128, 0.45)'
        ctx.beginPath()
        ctx.ellipse(0, 0, 6.5, 6.5, 0, Math.PI, 0)
        ctx.fill()
        ctx.strokeStyle = '#a6f4c5'
        ctx.lineWidth = 0.6
        ctx.stroke()
      } else if (m.id === 'rtg-reactor') {
        ctx.fillStyle = '#3a4048'
        ctx.fillRect(-3.5, -7, 7, 7)
        ctx.fillStyle = '#ffad57'
        ctx.fillRect(-2, -5.5, 4, 4)
      } else {
        const g = ctx.createLinearGradient(-3, 0, 3, 0)
        g.addColorStop(0, '#6a737d')
        g.addColorStop(0.4, '#ffffff')
        g.addColorStop(1, '#6a737d')
        ctx.fillStyle = g
        ctx.fillRect(-3, -7, 6, 7)
        ctx.fillStyle = '#ff8a3d'
        ctx.fillRect(-3, -4.2, 6, 0.8)
      }
      ctx.restore()
      x += 15
    }
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
      if (body.id === 'earth' && Math.abs(wrapPi(theta - PAD_ANGLE)) * body.radius < 90) continue
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
  if (body.id === 'earth' && cam.z > 0.12) withSurfaceFrame(ctx, cam, body, PAD_ANGLE, () => drawPad(ctx))
  const base = sim.gs.bases[body.id]
  if (base && cam.z > 0.2) withSurfaceFrame(ctx, cam, body, base.siteAngle, () => drawBaseModules(ctx, base.modules, clock))
}

function vesselCell(st: ReturnType<typeof vesselStats>, z: number, minPx: number) {
  return Math.max(z, minPx / Math.max(1, st.maxY - st.minY))
}

function drawVesselAt(ctx: Ctx, sim: Sim, v: Vessel, p: Vec, rot: number, cell: number, clock: number, vac: number) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(Math.PI / 2 - (v.angle + rot))
  drawVesselParts(ctx, v.parts, cell, { firing: sim.firing.get(v.id), time: clock, vacuum: vac })
  ctx.restore()
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
  const bodyId: BodyId = v?.bodyId ?? 'earth'
  const body = BODIES[bodyId]
  const padR = BODIES.earth.radius + 14
  let center = v ? v.pos : { x: Math.cos(PAD_ANGLE) * padR, y: Math.sin(PAD_ANGLE) * padR }
  const r = len(center)
  const theta = Math.atan2(center.y, center.x)
  if (v && body.landable) {
    // Yüzeye yakınken kamerayı aşağı kaydır: zemin her zaman görünür kalsın.
    const a = Math.max(0, situation(v).alt)
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
  if (sky > 0.01) {
    const g = ctx.createLinearGradient(0, 0, 0, view.h)
    g.addColorStop(0, mix('#02040a', body.colors.sky, sky * 0.75))
    g.addColorStop(1, mix('#02040a', mix(body.colors.sky, '#ffffff', 0.45), sky))
    ctx.globalAlpha = Math.min(1, sky * 1.2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, view.w, view.h)
    ctx.globalAlpha = 1
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
    const p = toScreen(cam, o.pos)
    if (p.x < -400 || p.x > view.w + 400 || p.y < -400 || p.y > view.h + 400) continue
    const st = vesselStats(o.parts)
    const isActive = o === v
    const cell = vesselCell(st, cam.z, isActive ? 40 : 18)
    if (o.bodyId === bodyId && cam.z > 0.8) {
      const s = situation(o, st)
      if (s.alt < 90 && body.landable) {
        withSurfaceFrame(ctx, cam, body, s.theta, () => {
          const a = 0.38 * (1 - Math.max(0, s.alt) / 90)
          const wd = (st.maxX - st.minX) * (0.7 + s.alt / 60)
          ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`
          ctx.beginPath()
          ctx.ellipse(0, 0.2, wd, wd * 0.18, 0, 0, 6.283)
          ctx.fill()
        })
      }
    }
    drawVesselAt(ctx, sim, o, p, cam.rot, cell, view.clock, vac)
    frame.hits.push({ id: o.id, x: p.x, y: p.y, cell, rot: Math.PI / 2 - (o.angle + cam.rot) })
    if (!isActive) {
      ctx.fillStyle = 'rgba(255,255,255,.75)'
      ctx.font = '11px "DM Mono", monospace'
      ctx.textAlign = 'center'
      ctx.fillText(o.name, p.x, p.y - (st.comY - st.minY) * cell - 8)
    }
  }
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
    ctx.fillStyle = 'rgba(255,255,255,.6)'
    ctx.fillText(b.name, p.x, p.y + rpx + 16)
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
    const o = abs[v.bodyId]!
    const p = S({ x: o.x + v.pos.x, y: o.y + v.pos.y })
    frame.vessels.push({ id: v.id, x: p.x, y: p.y })
    const active = v.id === gs.activeId
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(Math.PI / 2 - v.angle)
    const s = active ? 9 : 6
    ctx.beginPath()
    ctx.moveTo(0, -s * 1.5)
    ctx.lineTo(s, s)
    ctx.lineTo(0, s * 0.45)
    ctx.lineTo(-s, s)
    ctx.closePath()
    ctx.fillStyle = active ? '#ffffff' : 'rgba(190,200,215,.75)'
    ctx.fill()
    ctx.restore()
    if (!active) {
      ctx.fillStyle = 'rgba(190,200,215,.7)'
      ctx.fillText(v.name, p.x, p.y + 20)
    }
  }
  return frame
}
