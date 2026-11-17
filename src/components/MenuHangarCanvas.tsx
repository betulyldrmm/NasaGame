import { useEffect, useRef } from 'react'

/**
 * Ana menüdeki `menu-hangar.jpg` sahnesini birebir ekrana hizalar ve roketin etrafında
 * çalışan mühendisleri, kaynak kıvılcımlarını, vinç hareketini, tarama lazerini ve kriyojenik buharı canlandırır.
 */
export default function MenuHangarCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const img = new Image()
    img.src = '/assets/menu-hangar.jpg'

    interface Spark {
      x: number
      y: number
      vx: number
      vy: number
      life: number
      maxLife: number
      col: string
    }
    interface SteamPuff {
      x: number
      y: number
      vx: number
      vy: number
      r: number
      life: number
      maxLife: number
    }

    const sparks: Spark[] = []
    const steam: SteamPuff[] = []
    const stars = Array.from({ length: 28 }, (_, i) => ({
      nx: 0.28 + ((Math.sin(i * 91.7) * 0.5 + 0.5) * 0.42),
      ny: 0.12 + ((Math.cos(i * 47.3) * 0.5 + 0.5) * 0.65),
      phase: i * 1.37,
    }))
    const motes = Array.from({ length: 34 }, (_, i) => ({
      side: i % 2 === 0 ? -1 : 1,
      u: (i * 0.071) % 1,
      v: Math.sin(i * 19.3) * 0.5 + 0.5,
      s: 0.8 + (i % 3) * 0.5,
    }))

    let mouse = { x: 0.5, y: 0.5 }
    const onMove = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        mouse = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
      }
    }
    window.addEventListener('mousemove', onMove, { passive: true })

    let raf = 0
    let last = performance.now()
    let clock = 0

    const drawWorker = (
      px: number,
      py: number,
      unit: number,
      dir: number,
      walkPhase: number,
      shirt: string,
      helmet: string,
      opts: { tool?: 'wrench' | 'tablet' | 'torch' | 'wave'; welding?: boolean; moving?: boolean },
    ) => {
      const s = Math.max(1.5, unit)
      const stride = opts.moving ? Math.sin(walkPhase) * 2.2 * s : 0
      const bob = opts.moving ? Math.abs(Math.sin(walkPhase)) * 1.1 * s : Math.sin(walkPhase * 0.5) * 0.4 * s
      ctx.save()
      ctx.translate(px, py - bob)
      // Ayak gölgesi
      ctx.fillStyle = 'rgba(0,0,0,.42)'
      ctx.beginPath()
      ctx.ellipse(0, bob + 0.5 * s, 3.2 * s, 1.1 * s, 0, 0, Math.PI * 2)
      ctx.fill()

      // Bacaklar
      ctx.fillStyle = '#1f2937'
      ctx.fillRect(-1.8 * s + stride * 0.6, -5 * s, 1.4 * s, 5 * s)
      ctx.fillRect(0.4 * s - stride * 0.6, -5 * s, 1.4 * s, 5 * s)

      // Tulum gövde
      ctx.fillStyle = shirt
      ctx.fillRect(-2.3 * s, -11.2 * s, 4.6 * s, 6.4 * s)
      ctx.fillStyle = 'rgba(255,255,255,.18)'
      ctx.fillRect(-1.8 * s, -10 * s, 3.6 * s, 1.1 * s)

      // Kol + Alet animasyonu
      const armSwing = opts.tool === 'wave' ? Math.sin(walkPhase * 1.4) * 2.4 * s : Math.sin(walkPhase * 2) * 0.9 * s
      ctx.fillStyle = shirt
      ctx.fillRect(dir > 0 ? 1.5 * s : -3.4 * s, -10.5 * s - Math.max(0, armSwing * 0.5), 2.1 * s, 1.6 * s)
      if (opts.tool === 'tablet') {
        ctx.fillStyle = '#38d9e8'
        ctx.fillRect(dir > 0 ? 2.8 * s : -4.4 * s, -11.5 * s, 1.8 * s, 1.3 * s)
      } else if (opts.tool === 'wrench') {
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(dir > 0 ? 3.2 * s : -4.8 * s, -11 * s - armSwing * 0.5, 2.2 * s, 0.9 * s)
      } else if (opts.tool === 'torch') {
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(dir > 0 ? 3.2 * s : -4.8 * s, -10.3 * s, 2.2 * s, 0.9 * s)
        if (opts.welding) {
          const flash = 0.7 + 0.3 * Math.sin(clock * 65)
          const fx = dir > 0 ? 5.8 * s : -5.8 * s
          const fy = -10 * s
          const rg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7.5 * s * flash)
          rg.addColorStop(0, '#ffffff')
          rg.addColorStop(0.35, 'rgba(125,245,255,.85)')
          rg.addColorStop(1, 'rgba(56,217,232,0)')
          ctx.fillStyle = rg
          ctx.beginPath()
          ctx.arc(fx, fy, 7.5 * s * flash, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Kafa ve koruyucu baret
      ctx.fillStyle = '#f3d2b3'
      ctx.fillRect(-1.7 * s, -14.8 * s, 3.4 * s, 3.4 * s)
      ctx.fillStyle = helmet
      ctx.fillRect(-2.1 * s, -15.8 * s, 4.2 * s, 1.8 * s)
      ctx.fillRect(dir > 0 ? -1.4 * s : -2.6 * s, -14.3 * s, 4 * s, 0.7 * s)
      ctx.restore()
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
      last = now
      clock += dt

      const rect = cv.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = Math.max(1, Math.round(rect.width))
      const H = Math.max(1, Math.round(rect.height))
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr)
        cv.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const iw = img.naturalWidth || 1030
      const ih = img.naturalHeight || 718
      const scale = Math.max(W / iw, H / ih)
      const dw = iw * scale
      const dh = ih * scale
      const ox = (W - dw) / 2
      const oy = (H - dh) / 2
      const X = (nx: number) => ox + nx * dw
      const Y = (ny: number) => oy + ny * dh
      const U = Math.max(0.75, scale * 1.45)

      if (img.complete && iw > 0) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, ox, oy, dw, dh)
        ctx.imageSmoothingEnabled = true
      }

      // 1. Açık hangar kapısından görünen parlayan Ay ve parıldayan yıldızlar
      const mx = X(0.356)
      const my = Y(0.256)
      const moonHalo = ctx.createRadialGradient(mx, my, 4 * U, mx, my, 42 * U)
      moonHalo.addColorStop(0, `rgba(210,235,255,${(0.16 + 0.05 * Math.sin(clock * 1.4)).toFixed(3)})`)
      moonHalo.addColorStop(1, 'rgba(150,200,255,0)')
      ctx.fillStyle = moonHalo
      ctx.beginPath()
      ctx.arc(mx, my, 42 * U, 0, Math.PI * 2)
      ctx.fill()

      for (const st of stars) {
        const sx = X(st.nx)
        const sy = Y(st.ny)
        // Roketin tam üzerine denk gelen noktaları atla
        if (st.nx > 0.43 && st.nx < 0.56 && st.ny > 0.25 && st.ny < 0.82) continue
        const tw = 0.25 + 0.75 * Math.max(0, Math.sin(clock * 2.1 + st.phase)) ** 2
        if (tw < 0.45) continue
        ctx.fillStyle = `rgba(235,246,255,${(tw * 0.75).toFixed(2)})`
        ctx.fillRect(sx - 1.5 * U, sy - 0.4 * U, 3 * U, 0.8 * U)
        ctx.fillRect(sx - 0.4 * U, sy - 1.5 * U, 0.8 * U, 3 * U)
      }

      // 2. Üst spot ışıklarının içinde süzülen toz zerrecikleri ve imleç parlaması
      const tilt = (mouse.x - 0.5) * 0.015
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (const m of motes) {
        const prog = (m.u + clock * 0.045) % 1
        const startX = m.side < 0 ? 0.13 : 0.83
        const endX = m.side < 0 ? 0.44 : 0.56
        const bx = startX + (endX - startX) * prog + Math.sin(clock + m.v * 6) * 0.012 + tilt * prog
        const by = 0.09 + 0.68 * prog + (m.v - 0.5) * 0.04
        const alpha = Math.sin(Math.PI * prog) * 0.42
        ctx.fillStyle = `rgba(255,214,155,${alpha.toFixed(2)})`
        ctx.beginPath()
        ctx.arc(X(bx), Y(by), m.s * U * 0.85, 0, Math.PI * 2)
        ctx.fill()
      }

      // 3. Roket boyunca yukarı-aşağı süpüren holografik teşhis lazeri
      const scanY = 0.31 + (0.5 + 0.5 * Math.sin(clock * 1.15)) * 0.43
      const syPx = Y(scanY)
      const gradScan = ctx.createLinearGradient(X(0.42), syPx, X(0.58), syPx)
      gradScan.addColorStop(0, 'rgba(56,217,232,0)')
      gradScan.addColorStop(0.5, 'rgba(56,217,232,.55)')
      gradScan.addColorStop(1, 'rgba(56,217,232,0)')
      ctx.fillStyle = gradScan
      ctx.fillRect(X(0.42), syPx - 1.5 * U, dw * 0.16, 3 * U)
      ctx.strokeStyle = 'rgba(186,248,255,.75)'
      ctx.lineWidth = Math.max(1, U * 0.7)
      ctx.beginPath()
      ctx.moveTo(X(0.45), syPx)
      ctx.lineTo(X(0.55), syPx)
      ctx.stroke()
      ctx.restore()

      // 4. Sağ üst gezer vinç uyarısı ve hareketli kablo kancası
      const hookDrop = Math.sin(clock * 1.35) * 4.5 * U
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = Math.max(1, 0.9 * U)
      ctx.beginPath()
      ctx.moveTo(X(0.573), Y(0.308))
      ctx.lineTo(X(0.573), Y(0.352) + hookDrop)
      ctx.stroke()
      ctx.fillStyle = '#e08b3e'
      ctx.beginPath()
      ctx.arc(X(0.573), Y(0.356) + hookDrop, 2.2 * U, 0, Math.PI, false)
      ctx.stroke()

      const beaconOn = Math.sin(clock * 4.2) > 0
      if (beaconOn) {
        ctx.fillStyle = '#ff5d5d'
        ctx.beginPath()
        ctx.arc(X(0.618), Y(0.278), 2.4 * U, 0, Math.PI * 2)
        ctx.fill()
      }

      // 5. Kademeler arası & kıskaçlardan yükselen sıvı oksijen (LOX) kriyojenik buharı
      if (Math.random() < 0.45 && steam.length < 36) {
        const src = Math.random() < 0.5 ? { x: 0.455, y: 0.675, vx: -14 } : Math.random() < 0.7 ? { x: 0.542, y: 0.675, vx: 14 } : { x: 0.495, y: 0.505, vx: 10 }
        steam.push({
          x: X(src.x),
          y: Y(src.y),
          vx: (src.vx + (Math.random() - 0.5) * 8) * scale * 0.45,
          vy: (-12 - Math.random() * 14) * scale * 0.45,
          r: (2.5 + Math.random() * 3) * U,
          life: 0,
          maxLife: 1.4 + Math.random() * 1.1,
        })
      }
      for (let i = steam.length - 1; i >= 0; i -= 1) {
        const p = steam[i]!
        p.life += dt
        if (p.life >= p.maxLife) {
          steam.splice(i, 1)
          continue
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.r += 4.5 * U * dt
        const a = Math.sin((p.life / p.maxLife) * Math.PI) * 0.28
        ctx.fillStyle = `rgba(220,244,255,${a.toFixed(2)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // 6. Roket üzerinde çalışan animasyonlu mühendis ekibi & kaynak kıvılcımları!
      const walkA = 0.25 + 0.13 * (0.5 + 0.5 * Math.sin(clock * 0.34))
      const dirA = Math.cos(clock * 0.34) >= 0 ? 1 : -1
      drawWorker(X(walkA), Y(0.915), U, dirA, clock * 7.5, '#3b82f6', '#fbbf24', { tool: 'tablet', moving: true })

      const walkB = 0.675 + 0.075 * (0.5 + 0.5 * Math.cos(clock * 0.28))
      const dirB = -Math.sin(clock * 0.28) >= 0 ? 1 : -1
      drawWorker(X(walkB), Y(0.915), U, dirB, clock * 7.2, '#475569', '#f8fafc', { tool: 'wrench', moving: true })

      // Üst kule teknisyeni (tablet/sinyal kontrol) — ayak tabanı platform üzerinde (y≈0.526)
      drawWorker(X(0.556), Y(0.526), U * 0.9, -1, clock * 3.8, '#e2e8f0', '#f59e0b', { tool: 'tablet' })
      // Sol üst yürüme yolu teknisyeni — ayak tabanı sol podyumda (y≈0.456)
      drawWorker(X(0.112 + 0.024 * Math.sin(clock * 0.45)), Y(0.456), U * 0.84, Math.cos(clock * 0.45) >= 0 ? 1 : -1, clock * 5.5, '#64748b', '#38d9e8', { tool: 'wave', moving: true })

      // Sol alt kıskaç podyumu (y≈0.774) ve motor standı (y≈0.915) kaynakçı mühendisleri
      const weldPulse1 = Math.sin(clock * 4.1) > 0.25
      drawWorker(X(0.415), Y(0.774), U * 0.9, 1, clock * 3.5, '#f97316', '#f8fafc', { tool: 'torch', welding: weldPulse1 })
      const weldPulse2 = Math.cos(clock * 3.3) > 0.3
      drawWorker(X(0.592), Y(0.915), U * 0.94, -1, clock * 3.2, '#38bdf8', '#fbbf24', { tool: 'torch', welding: weldPulse2 })

      if (weldPulse1 && Math.random() < 0.7) {
        for (let k = 0; k < 2; k += 1) {
          sparks.push({
            x: X(0.428),
            y: Y(0.752),
            vx: (40 + Math.random() * 70) * U,
            vy: (-35 - Math.random() * 55) * U,
            life: 0,
            maxLife: 0.45 + Math.random() * 0.4,
            col: Math.random() < 0.4 ? '#93f5ff' : '#fbbf24',
          })
        }
      }
      if (weldPulse2 && Math.random() < 0.7) {
        for (let k = 0; k < 2; k += 1) {
          sparks.push({
            x: X(0.573),
            y: Y(0.892),
            vx: (-45 - Math.random() * 65) * U,
            vy: (-45 - Math.random() * 60) * U,
            life: 0,
            maxLife: 0.5 + Math.random() * 0.4,
            col: Math.random() < 0.35 ? '#ffffff' : '#fb923c',
          })
        }
      }

      // Kıvılcım fiziği (yerçekimi ve hangar zemininde sekme)
      const floorY = Y(0.915)
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const sp = sparks[i]!
        sp.life += dt
        if (sp.life >= sp.maxLife) {
          sparks.splice(i, 1)
          continue
        }
        sp.vy += 260 * U * dt
        sp.x += sp.vx * dt
        sp.y += sp.vy * dt
        if (sp.y > floorY) {
          sp.y = floorY
          sp.vy *= -0.42
          sp.vx *= 0.75
        }
        const a = 1 - sp.life / sp.maxLife
        ctx.fillStyle = sp.col
        ctx.globalAlpha = a
        ctx.fillRect(sp.x - U * 0.7, sp.y - U * 0.7, 1.5 * U, 1.5 * U)
      }
      ctx.globalAlpha = 1

      // 7. Sağ yer konsolunda canlı yeşil telemetri dalgası LED'leri
      for (let k = 0; k < 4; k += 1) {
        const hBar = 1.5 + Math.abs(Math.sin(clock * 6 + k * 1.1)) * 3.5
        ctx.fillStyle = '#4ade80'
        ctx.fillRect(X(0.620) + k * 2.1 * U, Y(0.905) - hBar * U * 0.4, 1.3 * U, hBar * U * 0.4)
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
    }
  }, [])

  return <canvas ref={ref} className="menu-hangar-canvas" aria-hidden="true" />
}
