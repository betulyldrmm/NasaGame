/**
 * Tanıtım ve "Nasıl Oynanır?" için canlı sahneler. Oyunun kendi çizimleri (roket parçaları,
 * gezegenler, koloni yapıları) kullanılır; böylece öğretilen şey oyunda görülenle aynıdır.
 * Sahnedeki yazılar Türkçe yazılır; dil katmanı fillText'i çevirir.
 */
import { useEffect, useRef, useState } from 'react'
import { partDef } from '../game/data'
import { estimateDeltaV, freshParts, vesselStats } from '../game/vessel'
import { BODIES } from '../nasa/bodies'
import { drawPart, drawVesselParts } from '../render/partArt'
import { drawSphere } from '../render/renderer'
import type { PartInst } from '../game/types'
import { lang } from '../i18n'

/** Sahne yazıları: dil seçimine göre doğrudan seçilir (sayılı metinler sözlükten geçmesin). */
export const L = (tr: string, en: string) => (lang === 'en' ? en : tr)

type Ctx = CanvasRenderingContext2D
export type SceneId = 'journey' | 'build' | 'land' | 'twr' | 'orbit' | 'engines' | 'colony'

const num = (x: number) => (lang === 'en' ? x.toFixed(2) : x.toFixed(2).replace('.', ','))
const ENGINE_EN: Record<string, string> = { titan: 'Titan (launch)', hawk: 'Hawk (medium)', frontier: 'Frontier (vacuum)', ion: 'Ion Engine' }
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

// ───────── ortak çizim yardımcıları ─────────
const starSeed = Array.from({ length: 90 }, (_, i) => ({
  x: (Math.sin(i * 12.9898) * 43758.5453) % 1,
  y: (Math.sin(i * 78.233) * 12345.678) % 1,
  s: 0.6 + ((i * 37) % 10) / 9,
}))
function stars(ctx: Ctx, w: number, h: number, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#050b1c')
  g.addColorStop(1, '#0b1834')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  for (const s of starSeed) {
    const a = 0.45 + 0.4 * Math.sin(t * 1.3 + s.x * 40)
    ctx.fillStyle = `rgba(230,240,255,${a.toFixed(2)})`
    ctx.fillRect(Math.abs(s.x) * w, Math.abs(s.y) * h, s.s, s.s)
  }
}
function label(ctx: Ctx, text: string, x: number, y: number, color = '#dbeafe', size = 13, align: CanvasTextAlign = 'left', weight = 600) {
  ctx.font = `${weight} ${size}px Manrope, system-ui, sans-serif`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}
function pill(ctx: Ctx, text: string, x: number, y: number, color: string) {
  ctx.font = '700 12px Manrope, system-ui, sans-serif'
  const w = ctx.measureText(text).width + 16
  ctx.fillStyle = 'rgba(8,16,34,.82)'
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - 11, w, 22, 11)
  ctx.fill()
  ctx.stroke()
  label(ctx, text, x, y + 0.5, color, 12, 'center', 700)
}
function wrapText(ctx: Ctx, text: string, x: number, y: number, maxW: number, lineH: number, color: string, size = 13) {
  ctx.font = `600 ${size}px Manrope, system-ui, sans-serif`
  const words = text.split(' ')
  let line = ''
  let yy = y
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) {
      label(ctx, line, x, yy, color, size)
      line = w
      yy += lineH
    } else line = test
  }
  if (line) label(ctx, line, x, yy, color, size)
}
const engineIdx = (parts: PartInst[]) => parts.map((p, i) => (partDef(p.def).kind === 'engine' ? i : -1)).filter((i) => i >= 0)

let colonyImgs: Record<string, HTMLImageElement> | null = null
function colonyImg(id: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  colonyImgs ??= {}
  let im = colonyImgs[id]
  if (!im) {
    im = new Image()
    im.src = `/assets/colony/${id}.png`
    colonyImgs[id] = im
  }
  return im.complete && im.naturalWidth > 0 ? im : null
}
function sprite(ctx: Ctx, id: string, x: number, y: number, size: number, alpha = 1) {
  const im = colonyImg(id)
  if (!im) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.imageSmoothingEnabled = false
  const h = (size * im.naturalHeight) / im.naturalWidth
  ctx.drawImage(im, x - size / 2, y - h, size, h)
  ctx.restore()
}

// ───────── roket tasarımları ─────────
/** Montaj sahnesinde adım adım kurulan iki kademeli roket. */
const BUILD: { parts: PartInst[]; text: string }[] = [
  { parts: [{ def: 'capsule', x: 6, y: 1 }], text: L('Komuta kapsülü: gemiyi yönetir, her gemide bir tane olmalı.', 'Command capsule: it flies the ship; every ship needs one.') },
  { parts: [{ def: 'chute', x: 6, y: 0 }], text: L('Paraşüt: atmosferi olan gezegenlerde yavaşlatır.', 'Parachute: slows you down on worlds with an atmosphere.') },
  { parts: [{ def: 'tank-m', x: 6, y: 3 }, { def: 'frontier', x: 6, y: 5 }], text: L('Üst kademe: yakıt tankı + Frontier vakum motoru (uzayda verimli).', 'Upper stage: fuel tank + Frontier vacuum engine (efficient in space).') },
  { parts: [{ def: 'leg', x: 5, y: 4 }, { def: 'leg', x: 8, y: 4 }], text: L("İniş ayakları: Ay'a yumuşak iniş için.", 'Landing legs: for a soft landing on the Moon.') },
  { parts: [{ def: 'decoupler', x: 6, y: 7 }], text: L('Kademe adaptörü: uçuşta tıklayınca alttaki kademe ayrılır.', 'Stage adapter: click it in flight and the stage below drops away.') },
  { parts: [{ def: 'tank-xl', x: 6, y: 8 }, { def: 'tank-xl', x: 6, y: 12 }, { def: 'titan', x: 6, y: 16 }], text: L('Alt kademe: büyük tanklar + Titan kalkış motoru (çok güçlü).', 'Lower stage: big tanks + Titan launch engine (very powerful).') },
  {
    parts: [
      { def: 'radial', x: 5, y: 12 },
      { def: 'radial', x: 8, y: 12 },
      { def: 'nose', x: 3, y: 10 },
      { def: 'tank-l', x: 3, y: 12 },
      { def: 'hawk', x: 3, y: 15 },
      { def: 'nose', x: 9, y: 10 },
      { def: 'tank-l', x: 9, y: 12 },
      { def: 'hawk', x: 9, y: 15 },
    ],
    text: L('Yan iticiler: kalkışta ek itki verir, yakıtı bitince atılır.', 'Side boosters: extra thrust at lift-off, dropped when empty.'),
  },
]
const BUILD_ALL = freshParts(BUILD.flatMap((s) => s.parts))
const BUILD_TWR = estimateDeltaV(BUILD_ALL, 0, 9.81)[0]?.twr ?? 0
const BUILD_DV = estimateDeltaV(BUILD_ALL, 0, 9.81).reduce((a, s) => a + s.dv, 0)

const HEAVY = freshParts([
  { def: 'capsule', x: 6, y: 0 },
  { def: 'tank-xxl', x: 6, y: 2 },
  { def: 'tank-xxl', x: 6, y: 7 },
  { def: 'tank-xxl', x: 6, y: 12 },
  { def: 'hawk', x: 6, y: 17 },
])
const LIGHT = freshParts([
  { def: 'capsule', x: 6, y: 0 },
  { def: 'tank-xl', x: 6, y: 2 },
  { def: 'tank-xl', x: 6, y: 6 },
  { def: 'titan', x: 6, y: 10 },
])
const HEAVY_TWR = estimateDeltaV(HEAVY, 0, 9.81)[0]?.twr ?? 0
const LIGHT_TWR = estimateDeltaV(LIGHT, 0, 9.81)[0]?.twr ?? 0
const LANDER = freshParts([
  { def: 'capsule', x: 6, y: 0 },
  { def: 'cargo', x: 6, y: 2 },
  { def: 'tank-m', x: 6, y: 4 },
  { def: 'leg', x: 5, y: 5 },
  { def: 'leg', x: 8, y: 5 },
  { def: 'frontier', x: 6, y: 6 },
])
for (const p of LANDER) if (partDef(p.def).kind === 'leg') p.deployed = true
const SHUTTLE = freshParts([
  { def: 'capsule', x: 6, y: 0 },
  { def: 'tank-m', x: 6, y: 2 },
  { def: 'frontier', x: 6, y: 4 },
])

function drawRocket(ctx: Ctx, parts: PartInst[], x: number, y: number, c: number, angle: number, power: number, t: number, vacuum = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const firing = power > 0 ? new Map(engineIdx(parts).map((i) => [i, power])) : undefined
  drawVesselParts(ctx, parts, c, { firing, time: t, vacuum })
  ctx.restore()
}

// ───────── sahneler ─────────
function sceneJourney(ctx: Ctx, w: number, h: number, t: number) {
  stars(ctx, w, h, t)
  const earth = { x: w * 0.16, y: h * 0.62, r: Math.min(w, h) * 0.24 }
  const moon = { x: w * 0.5, y: h * 0.28, r: earth.r * 0.27 }
  const mars = { x: w * 0.85, y: h * 0.6, r: earth.r * 0.53 }
  const light = { x: -1, y: -0.25 }
  drawSphere(ctx, BODIES.earth, earth.x, earth.y, earth.r, light, 0, true)
  drawSphere(ctx, BODIES.moon, moon.x, moon.y, moon.r, light, 0, true)
  drawSphere(ctx, BODIES.mars, mars.x, mars.y, mars.r, light, 0, true)
  label(ctx, L('Dünya', 'Earth'), earth.x, earth.y + earth.r + 14, '#93c5fd', 12, 'center')
  label(ctx, L('Ay', 'Moon'), moon.x, moon.y + moon.r + 13, '#cbd5e1', 12, 'center')
  label(ctx, 'Mars', mars.x, mars.y + mars.r + 14, '#fdba74', 12, 'center')
  // yörünge ve rota
  const P0 = { x: earth.x + earth.r * 0.75, y: earth.y - earth.r * 0.75 }
  const P1 = { x: w * 0.36, y: h * 0.02 }
  const P2 = { x: w * 0.66, y: h * 0.05 }
  const P3 = { x: mars.x - mars.r * 0.95, y: mars.y - mars.r * 0.55 }
  const bez = (u: number) => {
    const m = 1 - u
    return {
      x: m * m * m * P0.x + 3 * m * m * u * P1.x + 3 * m * u * u * P2.x + u * u * u * P3.x,
      y: m * m * m * P0.y + 3 * m * m * u * P1.y + 3 * m * u * u * P2.y + u * u * u * P3.y,
    }
  }
  ctx.save()
  ctx.setLineDash([5, 7])
  ctx.lineDashOffset = -t * 18
  ctx.strokeStyle = 'rgba(56,217,232,.55)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let i = 0; i <= 60; i += 1) {
    const p = bez(i / 60)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
  ctx.restore()
  const u = ease(((t % 7) / 6.2))
  const p = bez(Math.min(0.999, u))
  const q = bez(Math.min(1, u + 0.01))
  const ang = Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2
  const burn = u < 0.18 || u > 0.86 ? 0.9 : 0
  drawRocket(ctx, SHUTTLE, p.x, p.y, Math.max(2.2, h / 70), ang, burn, t, 1)
}

/** Montaj sahnesi adım sayısı: 7 parça adımı + TWR kontrolü + kalkış. */
export const BUILD_STEPS = BUILD.length + 2

function sceneBuild(ctx: Ctx, w: number, h: number, t: number, manual?: { step: number; since: number }) {
  // mavi kopya kâğıdı ızgarası
  ctx.fillStyle = '#071328'
  ctx.fillRect(0, 0, w, h)
  const st = vesselStats(BUILD_ALL)
  const rows = st.maxY - st.minY
  const c = Math.min((h - 30) / rows, (w * 0.42) / (st.maxX - st.minX))
  const cx = w * 0.26
  const cy = h * 0.5
  const midX = (st.minX + st.maxX) / 2
  const midY = (st.minY + st.maxY) / 2
  ctx.strokeStyle = 'rgba(56,217,232,.10)'
  ctx.lineWidth = 1
  for (let gx = ((cx - midX * c) % c) - c; gx < w; gx += c) {
    ctx.beginPath()
    ctx.moveTo(gx, 0)
    ctx.lineTo(gx, h)
    ctx.stroke()
  }
  for (let gy = ((cy - midY * c) % c) - c; gy < h; gy += c) {
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(w, gy)
    ctx.stroke()
  }
  const STEP = 1.35
  const nSteps = BUILD.length
  // Elle ilerletilen modda adım tıklamayla değişir; zaman o adımın başından sayılır.
  const mStep = manual ? Math.min(manual.step, nSteps + 1) : 0
  const tl = manual ? (mStep >= nSteps ? nSteps * STEP + (mStep > nSteps ? 2.6 : 0) + (t - manual.since) : mStep * STEP + (t - manual.since)) : t % (nSteps * STEP + 6)
  const step = manual ? Math.min(nSteps, mStep) : Math.min(nSteps, Math.floor(tl / STEP))
  const lift = manual ? (mStep > nSteps ? clamp01((t - manual.since) / 2.6) : 0) : clamp01((tl - nSteps * STEP - 2.6) / 2.6)
  // parçalar
  let idx = 0
  ctx.save()
  ctx.translate(0, -ease(lift) * h * 1.3)
  if (lift > 0) {
    const off = { x: cx + (st.comX - midX) * c, y: cy + (st.comY - midY) * c }
    drawRocket(ctx, BUILD_ALL, off.x, off.y, c, 0, 1, t)
  } else {
    BUILD.forEach((s, si) => {
      const appear = clamp01((tl - si * STEP) / 0.45)
      for (const _ of s.parts) {
        const p = BUILD_ALL[idx]!
        idx += 1
        if (si > step) continue
        const d = partDef(p.def)
        const drop = (1 - ease(appear)) * -60
        ctx.save()
        ctx.globalAlpha = 0.25 + 0.75 * appear
        ctx.translate(cx + (p.x - midX) * c, cy + (p.y - midY) * c + drop)
        drawPart(ctx, p, c, { flip: p.x + d.w / 2 < midX, time: t })
        ctx.restore()
      }
    })
  }
  ctx.restore()
  // anlatım
  const tx = w * 0.5
  const tw = w * 0.46
  label(ctx, L('ROKET HANGARI', 'ROCKET HANGAR'), tx, 22, '#38d9e8', 11, 'left', 800)
  if (step < nSteps) {
    label(ctx, L(`Adım ${step + 1} / ${nSteps}`, `Step ${step + 1} / ${nSteps}`), tx, 46, '#94a3b8', 12)
    wrapText(ctx, BUILD[step]!.text, tx, 72, tw, 19, '#f1f5f9', 14)
  } else {
    label(ctx, L('Kalkıştan önce kontrol et', 'Check before launch'), tx, 46, '#94a3b8', 12)
    wrapText(ctx, L("TWR (itki / ağırlık) 1'den büyük olmalı; 1,2 ve üstü yeşil.", 'TWR (thrust / weight) must be above 1; 1.2 or more shows green.'), tx, 72, tw, 19, '#f1f5f9', 14)
    // TWR göstergesi
    const fill = clamp01((tl - nSteps * STEP) / 1.2) * Math.min(1, BUILD_TWR / 2.4)
    const by = 128
    ctx.fillStyle = 'rgba(148,163,184,.25)'
    ctx.fillRect(tx, by, tw, 10)
    ctx.fillStyle = BUILD_TWR >= 1.2 ? '#4ade80' : '#fbbf24'
    ctx.fillRect(tx, by, tw * fill, 10)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(tx + (tw * 1) / 2.4, by - 4, 2, 18)
    label(ctx, L('1,0', '1.0'), tx + (tw * 1) / 2.4, by + 24, '#94a3b8', 11, 'center')
    label(ctx, `TWR ${num(BUILD_TWR)} ✓`, tx, by + 44, '#4ade80', 15, 'left', 800)
    label(ctx, L(`Toplam Δv ≈ ${Math.round(BUILD_DV).toLocaleString('tr-TR')} m/s`, `Total Δv ≈ ${Math.round(BUILD_DV).toLocaleString('en-US')} m/s`), tx, by + 66, '#cbd5e1', 13)
    if (lift > 0) label(ctx, L('Rampaya çıkar ve fırlat! 🚀', 'Roll out and launch! 🚀'), tx, by + 92, '#fbbf24', 14, 'left', 800)
  }
  if (manual && mStep <= nSteps) {
    const blink = 0.55 + 0.45 * Math.sin(t * 4)
    label(ctx, L('Devam için tıkla ▸', 'Click to continue ▸'), w - 14, h - 16, `rgba(251,191,36,${blink.toFixed(2)})`, 13, 'right', 800)
  }
}

function sceneLand(ctx: Ctx, w: number, h: number, t: number) {
  stars(ctx, w, h, t)
  const ground = h * 0.8
  // Ay yüzeyi
  ctx.fillStyle = '#9aa3ad'
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let x = 0; x <= w; x += 8) ctx.lineTo(x, ground + Math.sin(x * 0.02) * 4 + Math.sin(x * 0.07) * 2)
  ctx.lineTo(w, h)
  ctx.fill()
  ctx.fillStyle = '#7b848e'
  for (const [x, r] of [[0.12, 18], [0.7, 26], [0.9, 12]] as const) {
    ctx.beginPath()
    ctx.ellipse(x * w, ground + 12, r, r * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  drawSphere(ctx, BODIES.earth, w * 0.86, h * 0.2, h * 0.09, { x: -1, y: -0.2 }, 0, true)
  const T = 11
  const tl = t % T
  const c = Math.max(4, h / 30)
  const lx = w * 0.3
  const st = vesselStats(LANDER)
  const legBottom = (st.maxY - st.comY) * c
  const descent = clamp01(tl / 4.2)
  const y = ground - legBottom - (1 - ease(descent)) * h * 0.9
  const burning = descent < 1 && descent > 0.35
  drawRocket(ctx, LANDER, lx, y, c, 0, burning ? 0.55 + 0.3 * Math.sin(t * 9) : 0, t, 1)
  if (descent < 1) label(ctx, L('Motorla yavaşla, 14 m/s altında in', 'Brake with the engine, touch down under 14 m/s'), lx + 60, h * 0.22, '#f1f5f9', 13)
  // koloni yapıları kargodan kurulur
  const builds = [
    { id: 'solar', x: 0.5, at: 5.2, name: L('Güneş Paneli', 'Solar Panel') },
    { id: 'habitat', x: 0.66, at: 6.4, name: L('Yaşam Küresi', 'Habitat Dome') },
    { id: 'station', x: 0.82, at: 7.6, name: L('Uzay İstasyonu', 'Space Station') },
  ]
  for (const b of builds) {
    const a = clamp01((tl - b.at) / 0.6)
    if (a <= 0) continue
    sprite(ctx, b.id, b.x * w, ground + 6, h * 0.24 * (0.6 + 0.4 * ease(a)), a)
    label(ctx, b.name, b.x * w, ground + 22, '#e2e8f0', 11, 'center')
  }
  if (tl > 4.4) pill(ctx, L('Kargodan kur → koloni', 'Build from cargo → colony'), w * 0.64, h * 0.12, '#4ade80')
}

function sceneTwr(ctx: Ctx, w: number, h: number, t: number) {
  ctx.fillStyle = '#8ec5ff'
  ctx.fillRect(0, 0, w, h)
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#2563eb')
  sky.addColorStop(1, '#93c5fd')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  const ground = h * 0.86
  ctx.fillStyle = '#3f8f3c'
  ctx.fillRect(0, ground, w, h - ground)
  ctx.fillStyle = '#475569'
  ctx.fillRect(w * 0.18, ground - 4, w * 0.16, 6)
  ctx.fillRect(w * 0.66, ground - 4, w * 0.16, 6)
  const tl = t % 6
  const c = Math.max(3, (h * 0.62) / 22)
  const sh = vesselStats(HEAVY)
  const sl = vesselStats(LIGHT)
  const shake = Math.sin(t * 50) * 0.8
  drawRocket(ctx, HEAVY, w * 0.26 + shake, ground - 4 - (sh.maxY - sh.comY) * c, c, 0, 1, t, 0)
  const rise = tl > 0.8 ? ((tl - 0.8) ** 2) * 18 : 0
  drawRocket(ctx, LIGHT, w * 0.74, ground - 4 - (sl.maxY - sl.comY) * c - rise, c, 0, 1, t, 0)
  pill(ctx, L(`TWR ${num(HEAVY_TWR)} — kalkamaz`, `TWR ${num(HEAVY_TWR)} — can't lift off`), w * 0.26, 22, '#f87171')
  pill(ctx, L(`TWR ${num(LIGHT_TWR)} — kalkar`, `TWR ${num(LIGHT_TWR)} — lifts off`), w * 0.74, 22, '#4ade80')
  label(ctx, L('Ağır: motor itkisi ağırlığı yenemiyor', 'Too heavy: thrust cannot beat weight'), w * 0.26, 46, '#0f172a', 12, 'center', 700)
  label(ctx, L('İtki > ağırlık: yukarı ivmelenir', 'Thrust > weight: it accelerates upward'), w * 0.74, 46, '#0f172a', 12, 'center', 700)
}

function sceneOrbit(ctx: Ctx, w: number, h: number, t: number) {
  stars(ctx, w, h, t)
  const R = h * 0.26
  const cx = w * 0.27
  const cy = h * 0.56
  drawSphere(ctx, BODIES.earth, cx, cy, R, { x: -1, y: -0.3 }, 0, true)
  const r0 = R * 1.4
  const top = { x: cx, y: cy - r0 }
  const period = 5
  const vc = (2 * Math.PI * r0) / period
  const GM = vc * vc * r0
  const shots = [
    { k: 0.6, color: '#f87171', text: L('Yavaş: hemen yere düşer', 'Slow: falls back right away') },
    { k: 0.85, color: '#fbbf24', text: L('Daha hızlı: daha uzağa düşer', 'Faster: lands farther away') },
    { k: 1.0, color: '#4ade80', text: L('Yörünge hızı: düşerken yüzeyi ıskalar → yörünge!', 'Orbital speed: it keeps missing the ground → orbit!') },
  ]
  const cycle = 16
  const tl = t % cycle
  shots.forEach((s, i) => {
    const t0 = i * 3.2
    if (tl < t0) return
    const dt = 1 / 120
    let x = top.x - cx
    let y = top.y - cy
    let vx = s.k * vc
    let vy = 0
    const n = Math.min(Math.floor((tl - t0) / dt), Math.floor((s.k >= 1 ? period * 1.02 : period) / dt))
    ctx.beginPath()
    ctx.moveTo(cx + x, cy + y)
    let hit = false
    for (let k = 0; k < n; k += 1) {
      const r = Math.hypot(x, y)
      const a = -GM / (r * r * r)
      vx += a * x * dt
      vy += a * y * dt
      x += vx * dt
      y += vy * dt
      ctx.lineTo(cx + x, cy + y)
      if (Math.hypot(x, y) < R) {
        hit = true
        break
      }
    }
    ctx.strokeStyle = s.color
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = hit ? '#f97316' : '#ffffff'
    ctx.beginPath()
    ctx.arc(cx + x, cy + y, hit ? 4 : 3, 0, Math.PI * 2)
    ctx.fill()
    wrapText(ctx, s.text, w * 0.56, h * 0.36 + i * 40, w * 0.42, 16, s.color, 13)
  })
  // Newton'un dağı ve topu
  ctx.fillStyle = '#64748b'
  ctx.beginPath()
  ctx.moveTo(top.x - R * 0.3, cy - R * 0.96)
  ctx.lineTo(top.x - 3, top.y + 4)
  ctx.lineTo(top.x + 3, top.y + 4)
  ctx.lineTo(top.x + R * 0.3, cy - R * 0.96)
  ctx.fill()
  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(top.x - 2, top.y - 3, 12, 6)
  wrapText(ctx, L('Yörünge = yana öyle hızlı gitmek ki düşerken hep ıskalamak', 'Orbit = moving sideways so fast you keep missing the ground'), w * 0.56, h * 0.12, w * 0.42, 17, '#e0f2fe', 14)
}

function sceneEngines(ctx: Ctx, w: number, h: number, t: number) {
  stars(ctx, w, h, t)
  const ids = ['titan', 'hawk', 'frontier', 'ion'] as const
  const T = 8
  const tl = t % T
  ids.forEach((id, i) => {
    const d = partDef(id)
    const x = w * (0.13 + i * 0.25)
    const parts = freshParts([
      { def: 'tank-l', x: 6, y: 0 },
      { def: id, x: id === 'ion' ? 6.5 : 6, y: 3 },
    ])
    const flow = d.thrust! / ((d.ispVac ?? 1) * 9.80665)
    const titanFlow = 480 / (265 * 9.80665)
    const fuelLeft = Math.max(0, 1 - (tl / 2.6) * (flow / titanFlow))
    const c = Math.max(4, h / 22)
    const power = fuelLeft > 0 ? 1 : 0
    drawRocket(ctx, parts, x, h * 0.42, c, 0, power, t, 1)
    label(ctx, L(d.name, ENGINE_EN[id] ?? d.name), x, h * 0.08, '#f1f5f9', 13, 'center', 800)
    // çubuklar
    const bx = x - w * 0.09
    const bw = w * 0.18
    const bars: [string, number, string][] = [
      [L('İtki', 'Thrust'), d.thrust! / 480, '#f97316'],
      [L('Verim', 'Efficiency'), (d.ispVac ?? 0) / 2100, '#38d9e8'],
      [L('Yakıt', 'Fuel'), fuelLeft, '#4ade80'],
    ]
    bars.forEach(([name, v, col], j) => {
      const yy = h * 0.72 + j * 18
      label(ctx, name, bx, yy, '#94a3b8', 10)
      ctx.fillStyle = 'rgba(148,163,184,.22)'
      ctx.fillRect(bx + 56, yy - 4, bw - 56, 8)
      ctx.fillStyle = col
      ctx.fillRect(bx + 56, yy - 4, (bw - 56) * Math.max(0.02, Math.min(1, v)), 8)
    })
    if (fuelLeft <= 0) pill(ctx, L('Yakıt bitti!', 'Out of fuel!'), x, h * 0.6, '#f87171')
  })
}

function sceneColony(ctx: Ctx, w: number, h: number, t: number) {
  stars(ctx, w, h, t)
  const ground = h * 0.78
  ctx.fillStyle = '#b4532a'
  ctx.fillRect(0, ground, w, h - ground)
  ctx.fillStyle = '#8a3c1c'
  ctx.fillRect(0, ground + 14, w, h - ground)
  const slots = ['solar', 'solar', 'battery', 'habitat', 'station', 'farm', 'rover', 'lab']
  const tl = t % 10
  // güneş ve ışık
  const sunX = w * 0.08
  const sunY = h * 0.18
  const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 40)
  glow.addColorStop(0, '#fff7cc')
  glow.addColorStop(1, 'rgba(255,200,80,0)')
  ctx.fillStyle = glow
  ctx.fillRect(sunX - 40, sunY - 40, 80, 80)
  slots.forEach((id, i) => {
    const a = clamp01((tl - i * 0.7) / 0.5)
    const x = w * (0.14 + i * 0.105)
    ctx.strokeStyle = 'rgba(255,255,255,.18)'
    ctx.strokeRect(x - w * 0.045, ground - h * 0.3, w * 0.09, h * 0.3)
    if (a > 0) sprite(ctx, id, x, ground, w * 0.085 * (0.7 + 0.3 * ease(a)), a)
  })
  const power = clamp01((tl - 1.2) / 3)
  pill(ctx, L(`⚡ ${(8 * power).toFixed(0)} üretim`, `⚡ ${(8 * power).toFixed(0)} power`), w * 0.3, h * 0.1, '#facc15')
  pill(ctx, L('₡ gelir / dk', '₡ income / min'), w * 0.62, h * 0.1, '#4ade80')
  label(ctx, L('Paneller elektrik üretir; yapılar elektrikle çalışıp para kazandırır.', 'Panels make power; buildings run on it and earn money.'), w * 0.5, h * 0.93, '#fde68a', 12, 'center')
}

const SCENES: Record<SceneId, (ctx: Ctx, w: number, h: number, t: number, manual?: { step: number; since: number }) => void> = {
  journey: sceneJourney,
  build: sceneBuild,
  land: sceneLand,
  twr: sceneTwr,
  orbit: sceneOrbit,
  engines: sceneEngines,
  colony: sceneColony,
}

/**
 * Canlı sahne: kendi kendine döngüde oynar. Montaj sahnesi ('build') tıklamayla adım adım ilerler;
 * `step` verilirse adımı dışarıdan yönetilir (tanıtımdaki "Sonraki" düğmesi), verilmezse sahneye
 * tıklayınca ilerler.
 */
export default function GuideScene({ scene, height = 240, step, onAdvance }: { scene: SceneId; height?: number; step?: number; onAdvance?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ownStep, setOwnStep] = useState(0)
  const cur = step ?? ownStep
  const since = useRef({ step: -1, at: 0 })
  const startRef = useRef(performance.now())
  if (since.current.step !== cur) since.current = { step: cur, at: (performance.now() - startRef.current) / 1000 }
  const manualRef = useRef<{ step: number; since: number } | undefined>(undefined)
  manualRef.current = scene === 'build' ? { step: cur, since: since.current.at } : undefined
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let raf = 0
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth || 600
      const h = cv.clientHeight || height
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const ctx = cv.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      try {
        SCENES[scene](ctx, w, h, (performance.now() - startRef.current) / 1000, manualRef.current)
      } catch {
        /* görsel yardımcı: hata oyunu durdurmasın */
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [scene, height])
  const advance = () => {
    if (scene !== 'build') return
    if (onAdvance) onAdvance()
    else setOwnStep((s) => (s + 1) % BUILD_STEPS)
  }
  return (
    <canvas
      ref={ref}
      className={`guide-scene${scene === 'build' ? ' is-clickable' : ''}`}
      style={{ width: '100%', height }}
      onClick={advance}
      aria-hidden="true"
    />
  )
}
