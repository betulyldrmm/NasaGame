/**
 * Prosedürel 2.5D parça çizimleri (Canvas 2D). Hem montaj grid'inde hem uçuşta kullanılır;
 * ayrı bir görsel dosyasına gerek kalmadan her ölçekte keskin kalır.
 * Her parça kendi (0,0)-(w·c, h·c) kutusuna, burun yukarı bakacak şekilde çizilir.
 */
import { partDef } from '../game/data'
import type { PartDef, PartInst } from '../game/types'
import { vesselStats } from '../game/vessel'

type Ctx = CanvasRenderingContext2D

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + q, y)
  ctx.arcTo(x + w, y, x + w, y + h, q)
  ctx.arcTo(x + w, y + h, x, y + h, q)
  ctx.arcTo(x, y + h, x, y, q)
  ctx.arcTo(x, y, x + w, y, q)
  ctx.closePath()
}

/** Silindir hissi veren yatay metal gradyanı. */
function metal(ctx: Ctx, x: number, w: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  for (const [o, c] of stops) g.addColorStop(o, c)
  return g
}

const WHITE: [number, string][] = [[0, '#7d8791'], [0.18, '#c9d0d8'], [0.36, '#ffffff'], [0.6, '#dfe4ea'], [0.86, '#9aa3ad'], [1, '#6a737d']]
const DARK: [number, string][] = [[0, '#22262c'], [0.25, '#4b525b'], [0.42, '#7a838e'], [0.65, '#4a5059'], [1, '#1b1e23']]
const GOLD: [number, string][] = [[0, '#7a5a1c'], [0.3, '#e0b455'], [0.45, '#fff0b8'], [0.7, '#c9973a'], [1, '#6b4d17']]
const STEEL: [number, string][] = [[0, '#3a4048'], [0.3, '#8b949f'], [0.45, '#d5dbe2'], [0.7, '#7c858f'], [1, '#30353c']]

function outline(ctx: Ctx, c: number) {
  ctx.lineWidth = Math.max(0.6, c * 0.035)
  ctx.strokeStyle = 'rgba(12,16,24,.75)'
  ctx.stroke()
}

function drawTank(ctx: Ctx, w: number, h: number, c: number, fuelFrac: number) {
  rr(ctx, 0.02 * c, 0, w - 0.04 * c, h, c * 0.12)
  ctx.fillStyle = metal(ctx, 0, w, WHITE)
  ctx.fill()
  outline(ctx, c)
  ctx.fillStyle = 'rgba(30,40,55,.55)'
  ctx.fillRect(0.02 * c, c * 0.1, w - 0.04 * c, c * 0.05)
  ctx.fillRect(0.02 * c, h - c * 0.15, w - 0.04 * c, c * 0.05)
  // yakıt seviyesi şeridi
  const bx = w - c * 0.26
  const bh = h - c * 0.44
  ctx.fillStyle = 'rgba(20,28,40,.6)'
  rr(ctx, bx, c * 0.22, c * 0.1, bh, c * 0.05)
  ctx.fill()
  ctx.fillStyle = fuelFrac > 0.25 ? '#38d9e8' : '#ffad57'
  rr(ctx, bx, c * 0.22 + bh * (1 - fuelFrac), c * 0.1, bh * fuelFrac, c * 0.05)
  ctx.fill()
}

function drawBell(ctx: Ctx, cx: number, top: number, bot: number, wTop: number, wBot: number, c: number, stops: [number, string][]) {
  ctx.beginPath()
  ctx.moveTo(cx - wTop / 2, top)
  ctx.quadraticCurveTo(cx - wBot / 2 + (wBot - wTop) * 0.05, (top + bot) / 2, cx - wBot / 2, bot)
  ctx.lineTo(cx + wBot / 2, bot)
  ctx.quadraticCurveTo(cx + wBot / 2 - (wBot - wTop) * 0.05, (top + bot) / 2, cx + wTop / 2, top)
  ctx.closePath()
  ctx.fillStyle = metal(ctx, cx - wBot / 2, wBot, stops)
  ctx.fill()
  outline(ctx, c)
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = 'rgba(0,0,0,.35)'
  ctx.lineWidth = Math.max(0.5, c * 0.03)
  const n = Math.max(3, Math.round((bot - top) / (c * 0.16)))
  for (let i = 1; i < n; i += 1) {
    const y = top + ((bot - top) * i) / n
    ctx.beginPath()
    ctx.moveTo(cx - wBot, y)
    ctx.lineTo(cx + wBot, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawEngine(ctx: Ctx, d: PartDef, w: number, h: number, c: number, on: boolean) {
  const cx = w / 2
  if (d.id === 'ion') {
    rr(ctx, w * 0.2, 0, w * 0.6, h * 0.55, c * 0.08)
    ctx.fillStyle = metal(ctx, w * 0.2, w * 0.6, STEEL)
    ctx.fill()
    outline(ctx, c)
    drawBell(ctx, cx, h * 0.5, h * 0.95, w * 0.5, w * 0.8, c, DARK)
    ctx.fillStyle = on ? '#6fe9ff' : '#2a6f80'
    ctx.fillRect(w * 0.2, h * 0.4, w * 0.6, h * 0.08)
    return
  }
  if (d.id === 'aerospike') {
    rr(ctx, w * 0.04, 0, w * 0.92, h * 0.28, c * 0.06)
    ctx.fillStyle = metal(ctx, 0, w, STEEL)
    ctx.fill()
    outline(ctx, c)
    ctx.beginPath()
    ctx.moveTo(w * 0.08, h * 0.28)
    ctx.lineTo(cx, h * 0.98)
    ctx.lineTo(w * 0.92, h * 0.28)
    ctx.closePath()
    ctx.fillStyle = metal(ctx, w * 0.08, w * 0.84, [[0, '#2a3038'], [0.4, '#b87048'], [0.55, '#ffd0a0'], [1, '#252a30']])
    ctx.fill()
    outline(ctx, c)
    ctx.fillStyle = on ? '#ffad57' : '#6b4028'
    ctx.fillRect(w * 0.14, h * 0.24, w * 0.72, h * 0.06)
    return
  }
  if (d.id === 'nerva') {
    rr(ctx, w * 0.06, 0, w * 0.88, h * 0.48, c * 0.1)
    ctx.fillStyle = metal(ctx, 0, w, GOLD)
    ctx.fill()
    outline(ctx, c)
    ctx.fillStyle = on ? '#38d9e8' : '#254a5a'
    ctx.fillRect(w * 0.14, h * 0.15, w * 0.72, h * 0.08)
    ctx.fillRect(w * 0.14, h * 0.3, w * 0.72, h * 0.08)
    drawBell(ctx, cx, h * 0.45, h - c * 0.02, w * 0.36, w * 0.88, c, DARK)
    return
  }
  const plate = c * 0.14
  rr(ctx, w * 0.04, 0, w * 0.92, plate, c * 0.04)
  ctx.fillStyle = metal(ctx, 0, w, DARK)
  ctx.fill()
  outline(ctx, c)
  const pumpH = h * (d.id === 'frontier' ? 0.22 : 0.3)
  rr(ctx, cx - w * 0.2, plate, w * 0.4, pumpH, c * 0.08)
  ctx.fillStyle = metal(ctx, cx - w * 0.2, w * 0.4, STEEL)
  ctx.fill()
  outline(ctx, c)
  if (d.w > 1) {
    // yan turbopompa borusu
    rr(ctx, cx + w * 0.22, plate + pumpH * 0.15, w * 0.11, pumpH * 1.25, c * 0.05)
    ctx.fillStyle = metal(ctx, cx + w * 0.22, w * 0.11, STEEL)
    ctx.fill()
    outline(ctx, c)
    ctx.strokeStyle = '#3a4048'
    ctx.lineWidth = c * 0.06
    ctx.beginPath()
    ctx.moveTo(cx - w * 0.2, plate)
    ctx.lineTo(cx - w * 0.38, 0)
    ctx.moveTo(cx + w * 0.2, plate)
    ctx.lineTo(cx + w * 0.38, 0)
    ctx.stroke()
  }
  const wide = d.id === 'frontier' ? 0.98 : d.id === 'titan' ? 0.82 : 0.78
  const stops = d.id === 'frontier' ? ([[0, '#3b2a20'], [0.3, '#a8785a'], [0.45, '#f0c8a0'], [0.7, '#8f6248'], [1, '#2e2018']] as [number, string][]) : DARK
  drawBell(ctx, cx, plate + pumpH * 0.9, h - c * 0.02, w * 0.3, w * wide, c, stops)
  if (!on) {
    ctx.fillStyle = 'rgba(251,113,133,.9)'
    ctx.beginPath()
    ctx.arc(w * 0.16, plate + c * 0.14, c * 0.07, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawCapsule(ctx: Ctx, w: number, h: number, c: number) {
  ctx.beginPath()
  ctx.moveTo(w * 0.3, c * 0.06)
  ctx.quadraticCurveTo(w * 0.5, -c * 0.04, w * 0.7, c * 0.06)
  ctx.lineTo(w * 0.98, h * 0.86)
  ctx.lineTo(w * 0.98, h)
  ctx.lineTo(w * 0.02, h)
  ctx.lineTo(w * 0.02, h * 0.86)
  ctx.closePath()
  ctx.fillStyle = metal(ctx, 0, w, [[0, '#1f232a'], [0.28, '#555d68'], [0.42, '#98a2ae'], [0.62, '#525a64'], [1, '#1a1d22']])
  ctx.fill()
  outline(ctx, c)
  ctx.fillStyle = 'rgba(0,0,0,.35)'
  ctx.fillRect(w * 0.02, h * 0.86, w * 0.96, h * 0.03)
  // pencere
  rr(ctx, w * 0.36, h * 0.3, w * 0.28, h * 0.26, c * 0.07)
  const g = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.56)
  g.addColorStop(0, '#bfeaff')
  g.addColorStop(0.5, '#3f8fd8')
  g.addColorStop(1, '#12305c')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = c * 0.05
  ctx.strokeStyle = '#0f1318'
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,.55)'
  rr(ctx, w * 0.39, h * 0.33, w * 0.08, h * 0.07, c * 0.03)
  ctx.fill()
}

function drawNose(ctx: Ctx, w: number, h: number, c: number) {
  ctx.beginPath()
  ctx.moveTo(w * 0.02, h)
  ctx.quadraticCurveTo(w * 0.1, h * 0.35, w * 0.5, 0)
  ctx.quadraticCurveTo(w * 0.9, h * 0.35, w * 0.98, h)
  ctx.closePath()
  ctx.fillStyle = metal(ctx, 0, w, WHITE)
  ctx.fill()
  outline(ctx, c)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = metal(ctx, 0, w, [[0, '#7a2f1c'], [0.4, '#ff8a5c'], [1, '#6e2a18']])
  ctx.fillRect(0, 0, w, h * 0.3)
  ctx.restore()
}

function drawDecoupler(ctx: Ctx, w: number, h: number, c: number) {
  rr(ctx, 0, h * 0.12, w, h * 0.76, c * 0.05)
  ctx.fillStyle = metal(ctx, 0, w, DARK)
  ctx.fill()
  outline(ctx, c)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#f5c542'
  const s = c * 0.22
  for (let x = -h; x < w + h; x += s * 2) {
    ctx.beginPath()
    ctx.moveTo(x, h * 0.62)
    ctx.lineTo(x + s, h * 0.62)
    ctx.lineTo(x + s + h * 0.24, h * 0.38)
    ctx.lineTo(x + h * 0.24, h * 0.38)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = '#ff5d5d'
  ctx.fillRect(0, h * 0.47, w, Math.max(1, h * 0.06))
}

function drawRadial(ctx: Ctx, w: number, h: number, c: number) {
  ctx.fillStyle = metal(ctx, 0, w, STEEL)
  for (const y of [0.22, 0.62]) {
    rr(ctx, -c * 0.03, h * y, w + c * 0.06, h * 0.16, c * 0.04)
    ctx.fill()
    outline(ctx, c)
  }
  rr(ctx, w * 0.32, h * 0.1, w * 0.36, h * 0.8, c * 0.07)
  ctx.fillStyle = '#f5c542'
  ctx.fill()
  outline(ctx, c)
  ctx.fillStyle = '#ff5d5d'
  ctx.fillRect(w * 0.46, h * 0.1, w * 0.08, h * 0.8)
}

function drawChute(ctx: Ctx, w: number, h: number, c: number, open: boolean, t: number) {
  if (open) {
    const cw = w * 3.4
    const top = -h * 6.2
    const sway = Math.sin(t * 1.7) * c * 0.12
    ctx.strokeStyle = 'rgba(230,235,245,.7)'
    ctx.lineWidth = Math.max(0.5, c * 0.025)
    for (let i = 0; i <= 6; i += 1) {
      ctx.beginPath()
      ctx.moveTo(w / 2, h * 0.3)
      ctx.lineTo(w / 2 - cw / 2 + (cw * i) / 6 + sway, top + h * 2.6)
      ctx.stroke()
    }
    for (let i = 0; i < 6; i += 1) {
      const x0 = w / 2 - cw / 2 + (cw * i) / 6 + sway
      const x1 = x0 + cw / 6
      ctx.beginPath()
      ctx.moveTo(x0, top + h * 2.6)
      ctx.quadraticCurveTo(w / 2 + sway + (x0 - w / 2) * 0.72, top - h * 0.2, w / 2 + sway, top)
      ctx.quadraticCurveTo(w / 2 + sway + (x1 - w / 2) * 0.72, top - h * 0.2, x1, top + h * 2.6)
      ctx.quadraticCurveTo((x0 + x1) / 2, top + h * 2.25, x0, top + h * 2.6)
      const g = ctx.createLinearGradient(x0, 0, x1, 0)
      const a = i % 2 === 0 ? ['#ff8a3d', '#ffb37a', '#d9642a'] : ['#e8edf3', '#ffffff', '#b9c2cc']
      g.addColorStop(0, a[2]!)
      g.addColorStop(0.45, a[1]!)
      g.addColorStop(1, a[0]!)
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = 'rgba(20,24,32,.5)'
      ctx.stroke()
    }
  }
  ctx.beginPath()
  ctx.moveTo(w * 0.14, h)
  ctx.quadraticCurveTo(w * 0.16, h * 0.15, w * 0.5, h * 0.12)
  ctx.quadraticCurveTo(w * 0.84, h * 0.15, w * 0.86, h)
  ctx.closePath()
  ctx.fillStyle = metal(ctx, 0, w, [[0, '#8a3d16'], [0.4, '#ff9d52'], [0.55, '#ffd0a6'], [1, '#8a3d16']])
  ctx.fill()
  outline(ctx, c)
}

function drawLeg(ctx: Ctx, d: PartDef, w: number, h: number, c: number, open: boolean) {
  const heavy = d.id === 'heavy-leg'
  // gövde solda (x=0), ayak dışa doğru açılır
  ctx.lineCap = 'round'
  ctx.strokeStyle = heavy ? '#9a6530' : '#6b7480'
  ctx.lineWidth = c * (heavy ? 0.22 : 0.16)
  const fx = open ? w * (heavy ? 1.3 : 1.15) : w * 0.3
  const fy = open ? h * (heavy ? 1.24 : 1.18) : h * 0.96
  ctx.beginPath()
  ctx.moveTo(c * 0.05, h * 0.12)
  ctx.lineTo(fx, fy)
  ctx.stroke()
  ctx.strokeStyle = heavy ? '#ffad57' : '#c3cad2'
  ctx.lineWidth = c * (heavy ? 0.09 : 0.07)
  ctx.beginPath()
  ctx.moveTo(c * 0.05, h * 0.12)
  ctx.lineTo(fx, fy)
  ctx.moveTo(c * 0.05, h * 0.6)
  ctx.lineTo((c * 0.05 + fx) / 2, (h * 0.12 + fy) / 2)
  ctx.stroke()
  ctx.fillStyle = heavy ? '#2b323c' : '#3a4048'
  rr(ctx, fx - c * (heavy ? 0.36 : 0.28), fy, c * (heavy ? 0.72 : 0.56), c * 0.16, c * 0.05)
  ctx.fill()
  ctx.lineCap = 'butt'
}

function drawRtg(ctx: Ctx, w: number, h: number, c: number) {
  rr(ctx, w * 0.12, h * 0.04, w * 0.76, h * 0.92, c * 0.08)
  ctx.fillStyle = metal(ctx, w * 0.12, w * 0.76, DARK)
  ctx.fill()
  outline(ctx, c)
  ctx.fillStyle = '#ff8a3d'
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect(w * 0.04, h * (0.18 + i * 0.19), w * 0.92, h * 0.07)
  }
  ctx.fillStyle = '#ffd166'
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, w * 0.16, 0, Math.PI * 2)
  ctx.fill()
}

function drawRcs(ctx: Ctx, w: number, h: number, c: number, pulse: boolean, time: number, flip: boolean) {
  rr(ctx, 0, h * 0.3, w * 0.5, h * 0.4, c * 0.06)
  ctx.fillStyle = metal(ctx, 0, w * 0.5, STEEL)
  ctx.fill()
  outline(ctx, c)
  ctx.fillStyle = '#2a2f36'
  const noz = (x: number, y: number, dx: number, dy: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + dx * c * 0.3 - dy * c * 0.12, y + dy * c * 0.3 - dx * c * 0.12)
    ctx.lineTo(x + dx * c * 0.3 + dy * c * 0.12, y + dy * c * 0.3 + dx * c * 0.12)
    ctx.closePath()
    ctx.fill()
  }
  noz(w * 0.3, h * 0.32, 0, -1)
  noz(w * 0.3, h * 0.68, 0, 1)
  noz(w * 0.48, h * 0.5, 1, 0)
  if (pulse) {
    const flicker = 0.72 + 0.28 * Math.sin(time * 34 + (flip ? 1.3 : 0))
    // Mirroring the left module also mirrors its local axis; +x points outward on both sides.
    const dir = 1
    const nozzleX = w * 0.92
    const length = c * (0.42 + 0.24 * flicker)
    const plume = ctx.createLinearGradient(nozzleX, 0, nozzleX + dir * length, 0)
    plume.addColorStop(0, `rgba(225,251,255,${0.9 * flicker})`)
    plume.addColorStop(0.25, `rgba(56,217,232,${0.62 * flicker})`)
    plume.addColorStop(1, 'rgba(56,217,232,0)')
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = plume
    ctx.beginPath()
    ctx.moveTo(nozzleX, h * 0.34)
    ctx.quadraticCurveTo(nozzleX + dir * length * 0.45, h * 0.24, nozzleX + dir * length, h * 0.5)
    ctx.quadraticCurveTo(nozzleX + dir * length * 0.45, h * 0.76, nozzleX, h * 0.66)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

function drawSolar(ctx: Ctx, w: number, h: number, c: number, open: boolean) {
  const cell = (x: number, y: number, pw: number, ph: number) => {
    const g = ctx.createLinearGradient(x, y, x + pw, y + ph)
    g.addColorStop(0, '#2c5fb8')
    g.addColorStop(0.5, '#14336e')
    g.addColorStop(1, '#3a7be0')
    ctx.fillStyle = g
    rr(ctx, x, y, pw, ph, c * 0.03)
    ctx.fill()
    ctx.strokeStyle = '#c9d2de'
    ctx.lineWidth = Math.max(0.5, c * 0.035)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(180,210,255,.35)'
    ctx.lineWidth = Math.max(0.4, c * 0.015)
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath()
      ctx.moveTo(x, y + (ph * i) / 4)
      ctx.lineTo(x + pw, y + (ph * i) / 4)
      ctx.stroke()
    }
  }
  if (open) {
    ctx.strokeStyle = '#8b949f'
    ctx.lineWidth = c * 0.07
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w * 3.4, h / 2)
    ctx.stroke()
    for (let i = 0; i < 3; i += 1) cell(w * (0.35 + i * 1.03), h * 0.06, w * 0.97, h * 0.88)
  } else {
    for (let i = 0; i < 3; i += 1) cell(w * (0.05 + i * 0.16), h * 0.06, w * 0.14, h * 0.88)
  }
}

function drawBattery(ctx: Ctx, w: number, h: number, c: number) {
  rr(ctx, 0.02 * c, h * 0.06, w - 0.04 * c, h * 0.88, c * 0.08)
  ctx.fillStyle = metal(ctx, 0, w, DARK)
  ctx.fill()
  outline(ctx, c)
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = i < 4 ? '#4ade80' : '#2c3a33'
    rr(ctx, w * (0.2 + i * 0.125), h * 0.34, w * 0.09, h * 0.32, c * 0.02)
    ctx.fill()
  }
  ctx.fillStyle = '#f5c542'
  ctx.beginPath()
  ctx.moveTo(w * 0.12, h * 0.3)
  ctx.lineTo(w * 0.07, h * 0.55)
  ctx.lineTo(w * 0.11, h * 0.55)
  ctx.lineTo(w * 0.09, h * 0.75)
  ctx.lineTo(w * 0.16, h * 0.45)
  ctx.lineTo(w * 0.12, h * 0.45)
  ctx.closePath()
  ctx.fill()
}

function drawCargo(ctx: Ctx, w: number, h: number, c: number) {
  rr(ctx, 0.02 * c, 0, w - 0.04 * c, h, c * 0.1)
  ctx.fillStyle = metal(ctx, 0, w, [[0, '#6c6a5c'], [0.2, '#c9c5ad'], [0.38, '#fbf8e6'], [0.62, '#d2ceb6'], [1, '#5f5d50']])
  ctx.fill()
  outline(ctx, c)
  ctx.strokeStyle = 'rgba(40,44,52,.7)'
  ctx.lineWidth = Math.max(0.6, c * 0.04)
  rr(ctx, w * 0.16, h * 0.14, w * 0.68, h * 0.72, c * 0.06)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(w / 2, h * 0.14)
  ctx.lineTo(w / 2, h * 0.86)
  ctx.stroke()
  ctx.fillStyle = '#ffad57'
  ctx.fillRect(w * 0.44, h * 0.47, w * 0.04, h * 0.06)
  ctx.fillRect(w * 0.52, h * 0.47, w * 0.04, h * 0.06)
}

function drawProbe(ctx: Ctx, d: PartDef, w: number, h: number, c: number) {
  const ai = d.id === 'probe-ai'
  ctx.beginPath()
  ctx.moveTo(w * 0.14, 0.06 * h)
  ctx.lineTo(w * 0.86, 0.06 * h)
  ctx.lineTo(w * 0.98, h * 0.4)
  ctx.lineTo(w * 0.98, h)
  ctx.lineTo(w * 0.02, h)
  ctx.lineTo(w * 0.02, h * 0.4)
  ctx.closePath()
  ctx.fillStyle = metal(ctx, 0, w, ai ? STEEL : GOLD)
  ctx.fill()
  outline(ctx, c)
  ctx.fillStyle = ai ? '#0b3545' : '#12305c'
  ctx.beginPath()
  ctx.arc(w / 2, h * 0.58, h * 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = ai ? '#4ade80' : '#38d9e8'
  ctx.beginPath()
  ctx.arc(w / 2, h * 0.58, h * 0.09, 0, Math.PI * 2)
  ctx.fill()
}

export interface PartDrawOpts {
  /** parça gövdenin solunda mı (yan parçalar aynalanır) */
  flip?: boolean
  time?: number
  rcsPulse?: boolean
}

export function drawPart(ctx: Ctx, p: PartInst, c: number, opts: PartDrawOpts = {}) {
  const d = partDef(p.def)
  const w = d.w * c
  const h = d.h * c
  ctx.save()
  const side = d.kind === 'leg' || d.kind === 'rcs' || d.kind === 'solar'
  if (side && opts.flip) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  switch (d.kind) {
    case 'tank': drawTank(ctx, w, h, c, d.fuel ? (p.fuel ?? d.fuel) / d.fuel : 0); break
    case 'engine': drawEngine(ctx, d, w, h, c, p.on !== false); break
    case 'command': if (d.id === 'probe' || d.id === 'probe-ai') drawProbe(ctx, d, w, h, c); else drawCapsule(ctx, w, h, c); break
    case 'nose': drawNose(ctx, w, h, c); break
    case 'decoupler': drawDecoupler(ctx, w, h, c); break
    case 'radialDecoupler': drawRadial(ctx, w, h, c); break
    case 'chute': drawChute(ctx, w, h, c, !!p.deployed, opts.time ?? 0); break
    case 'leg': drawLeg(ctx, d, w, h, c, !!p.deployed); break
    case 'rcs': drawRcs(ctx, w, h, c, !!opts.rcsPulse, opts.time ?? 0, !!opts.flip); break
    case 'solar': drawSolar(ctx, w, h, c, !!p.deployed); break
    case 'rtg': drawRtg(ctx, w, h, c); break
    case 'battery': drawBattery(ctx, w, h, c); break
    case 'cargo': drawCargo(ctx, w, h, c); break
  }
  ctx.restore()
}

function drawFlame(ctx: Ctx, d: PartDef, w: number, c: number, power: number, vacuum: number, t: number, seed: number) {
  const flick = 1 + 0.1 * Math.sin(t * 47 + seed * 3.1) + 0.06 * Math.sin(t * 83 + seed)
  const ion = d.id === 'ion'
  const nerva = d.id === 'nerva'
  const len = (ion ? 2.2 : 0.9 + 2.4 * power) * w * flick * (ion ? 1 : 0.7 + 0.5 * vacuum)
  const half = (w * (ion ? 0.22 : 0.3 + 0.28 * vacuum)) * (0.7 + 0.3 * power)
  const g = ctx.createLinearGradient(0, 0, 0, len)
  if (ion || nerva) {
    g.addColorStop(0, 'rgba(220,255,255,.98)')
    g.addColorStop(0.3, nerva ? 'rgba(80,235,255,.85)' : 'rgba(90,220,255,.7)')
    g.addColorStop(1, 'rgba(60,140,255,0)')
  } else {
    g.addColorStop(0, 'rgba(255,255,255,.98)')
    g.addColorStop(0.12, 'rgba(255,240,170,.95)')
    g.addColorStop(0.4, 'rgba(255,160,60,.8)')
    g.addColorStop(0.75, 'rgba(255,80,30,.35)')
    g.addColorStop(1, 'rgba(255,60,20,0)')
  }
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-half * 0.8, 0)
  ctx.quadraticCurveTo(-half * (1.2 + vacuum), len * 0.35, 0, len)
  ctx.quadraticCurveTo(half * (1.2 + vacuum), len * 0.35, half * 0.8, 0)
  ctx.closePath()
  ctx.fill()
  const glow = ctx.createRadialGradient(0, c * 0.2, 0, 0, c * 0.2, half * 3.2)
  glow.addColorStop(0, ion ? 'rgba(120,230,255,.35)' : 'rgba(255,190,90,.38)')
  glow.addColorStop(1, 'rgba(255,150,60,0)')
  ctx.fillStyle = glow
  ctx.fillRect(-half * 3.2, -half * 2, half * 6.4, half * 6)
  ctx.restore()
}

export interface VesselDrawOpts {
  firing?: Map<number, number>
  time?: number
  /** 0 deniz seviyesi … 1 vakum (alev genişliği) */
  vacuum?: number
  /** yanal hareket varken hava akışı görselini tetikler */
  rcsTx?: number
}

/** Aracı kütle merkezine göre, burun yukarı çizer. c = 1 grid karesinin piksel boyu. */
export function drawVesselParts(ctx: Ctx, parts: PartInst[], c: number, opts: VesselDrawOpts = {}) {
  const st = vesselStats(parts)
  const mid = (st.minX + st.maxX) / 2
  const order = parts.map((_, i) => i).sort((a, b) => {
    const ka = partDef(parts[a]!.def).kind
    const kb = partDef(parts[b]!.def).kind
    const z = (k: string) => (k === 'solar' || k === 'leg' ? 0 : k === 'chute' ? 2 : 1)
    return z(ka) - z(kb)
  })
  if (opts.firing) {
    for (const [i, power] of opts.firing) {
      const p = parts[i]
      if (!p || power <= 0) continue
      const d = partDef(p.def)
      ctx.save()
      ctx.translate((p.x + d.w / 2 - st.comX) * c, (p.y + d.h - st.comY) * c - c * 0.05)
      drawFlame(ctx, d, d.w * c, c, power, opts.vacuum ?? 0, opts.time ?? 0, i)
      ctx.restore()
    }
  }
  for (const i of order) {
    const p = parts[i]!
    const d = partDef(p.def)
    ctx.save()
    ctx.translate((p.x - st.comX) * c, (p.y - st.comY) * c)
    const flip = p.x + d.w / 2 < mid
    drawPart(ctx, p, c, { flip, time: opts.time, rcsPulse: d.kind === 'rcs' && !!opts.rcsTx })
    ctx.restore()
  }
}
