import { useEffect, useRef, useState } from 'react'
import { evaluateMission } from '../game/calculations'
import { getSelectedRocketParts, useGameStore } from '../game/store'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  color: string
}

export function FlightSimulator() {
  const state = useGameStore()
  const parts = getSelectedRocketParts(state)
  const evaluation = evaluateMission(parts, parts.planet)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [phaseLabel, setPhaseLabel] = useState('RAMPA ATEŞLEME (STAGE 1: LAUNCHPAD)')
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2>(1)
  const completedRef = useRef(false)

  // Determine total animation duration based on where the mission ends
  const endTimeSec =
    evaluation.failureStage === 'LAUNCHPAD'
      ? 3.4
      : evaluation.failureStage === 'ATMOSPHERE'
        ? 5.8
        : evaluation.failureStage === 'ORBIT'
          ? 9.0
          : 12.2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId = 0
    let lastTimestamp = performance.now()
    let simTime = 0
    const particles: Particle[] = []

    // Pre-generate 3 parallax star layers
    const stars = Array.from({ length: 110 }, (_, idx) => ({
      x: (idx * 97) % 900,
      y: (idx * 53) % 520,
      size: (idx % 3) * 0.8 + 0.8,
      layer: (idx % 3) + 1,
    }))

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimestamp) / 1000) * speedMultiplier
      lastTimestamp = now
      simTime += dt
      setElapsedSec(Math.min(endTimeSec, Math.round(simTime * 10) / 10))

      // Update phase label
      if (simTime < 2.6 || evaluation.failureStage === 'LAUNCHPAD') {
        setPhaseLabel('AŞAMA 1: FIRLATMA RAMPASI (LAUNCHPAD)')
      } else if (simTime < 5.8) {
        setPhaseLabel('AŞAMA 2: ATMOSFERİK TIRMANIŞ & MAX-Q (ATMOSPHERE)')
      } else if (simTime < 9.0) {
        setPhaseLabel(`AŞAMA 3: GEZEGENLERARASI TRANSFER YÖRÜNGESİ (ORBIT -> ${parts.planet.name.toUpperCase()})`)
      } else {
        setPhaseLabel(`AŞAMA 4: ${parts.planet.name.toUpperCase()} ATMOSFER GİRİŞİ VE YÜZEY İNİŞİ (SURFACE EDL)`)
      }

      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // 1. Background sky / space gradient depending on phase
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
      if (simTime < 2.6 || evaluation.failureStage === 'LAUNCHPAD') {
        bgGrad.addColorStop(0, '#07142B')
        bgGrad.addColorStop(0.65, '#12315E')
        bgGrad.addColorStop(1, '#1E406E')
      } else if (simTime < 5.8) {
        const p = Math.min(1, (simTime - 2.6) / 3.0)
        bgGrad.addColorStop(0, '#040917')
        bgGrad.addColorStop(1, p > 0.6 ? '#09152E' : '#163768')
      } else if (simTime < 9.0) {
        bgGrad.addColorStop(0, '#030611')
        bgGrad.addColorStop(1, '#081226')
      } else {
        bgGrad.addColorStop(0, '#040814')
        bgGrad.addColorStop(1, parts.planet.surfaceColor ?? '#334155')
      }
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      // 2. Parallax Starfield (3 speeds)
      for (const s of stars) {
        const offsetX = (s.x - simTime * s.layer * 14) % w
        const drawX = offsetX < 0 ? offsetX + w : offsetX
        const offsetY = (s.y + simTime * s.layer * 8) % h
        ctx.fillStyle = s.layer === 3 ? '#38D9E8' : '#F8FAFC'
        ctx.globalAlpha = 0.3 + s.layer * 0.2
        ctx.beginPath()
        ctx.arc(drawX, offsetY, s.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // ==============================================================
      // SCENE RENDERING BY FLIGHT STAGE
      // ==============================================================
      if (simTime < 2.6 || evaluation.failureStage === 'LAUNCHPAD') {
        // LAUNCHPAD SCENE
        ctx.fillStyle = '#0F172A'
        ctx.fillRect(0, h - 75, w, 75)
        ctx.strokeStyle = '#38D9E8'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, h - 75)
        ctx.lineTo(w, h - 75)
        ctx.stroke()

        // Launch Tower Gantry
        ctx.strokeStyle = '#475569'
        ctx.lineWidth = 3
        ctx.strokeRect(w / 2 - 95, h - 275, 42, 200)

        const isLowTwr = evaluation.failureStage === 'LAUNCHPAD'
        const liftY = isLowTwr ? 0 : Math.max(0, (simTime - 1.1) * 95)
        const shakeX = isLowTwr ? Math.sin(simTime * 55) * 6 : Math.sin(simTime * 35) * 1.5

        // Spawn smoke & fire particles on pad
        if (evaluation.failureCode !== 'NO_FUEL_TANK') {
          for (let i = 0; i < 4; i++) {
            particles.push({
              x: w / 2 + shakeX + (Math.random() - 0.5) * 24,
              y: h - 85 - liftY,
              vx: (Math.random() - 0.5) * (isLowTwr ? 120 : 65),
              vy: isLowTwr ? -Math.random() * 45 : Math.random() * 60 + 20,
              radius: Math.random() * 14 + 8,
              alpha: 0.9,
              color: isLowTwr ? '#94A3B8' : i % 2 === 0 ? '#FFAD57' : '#38D9E8',
            })
          }
        }

        drawRocketSprite(ctx, w / 2 + shakeX, h - 165 - liftY, 0, true, parts.body.spriteVariant ?? 'explorer')

        if (isLowTwr && simTime > 1.2) {
          drawCanvasBanner(
            ctx,
            w / 2,
            110,
            evaluation.failureCode === 'NO_FUEL_TANK'
              ? '⚠ YAKIT TANKI YOK — ATEŞLEME BAŞARISIZ!'
              : `⚠ YETERSİZ KALKIŞ GÜCÜ (TWR = ${evaluation.earthTWR} < 1.0) — ROKET KALKAMIYOR!`,
            '#FB7185',
          )
        }
      } else if (simTime < 5.8) {
        // ATMOSPHERE CLIMB & T+5.0s CoM/CoP SPIN TEST
        const isSpinFail = evaluation.failureStage === 'ATMOSPHERE'
        const spinProgress = isSpinFail && simTime > 4.2 ? simTime - 4.2 : 0
        const angle = isSpinFail && simTime > 4.2 ? spinProgress * 8.5 : 0
        const rocketX = w / 2 + (isSpinFail && simTime > 4.2 ? Math.sin(spinProgress * 7) * 75 : 0)
        const rocketY = h / 2 + 20 - Math.min(80, (simTime - 2.6) * 25)

        if (isSpinFail && simTime > 5.1) {
          // Explosion burst at T+5s!
          for (let i = 0; i < 6; i++) {
            particles.push({
              x: rocketX,
              y: rocketY,
              vx: (Math.random() - 0.5) * 240,
              vy: (Math.random() - 0.5) * 240,
              radius: Math.random() * 18 + 6,
              alpha: 1,
              color: i % 2 === 0 ? '#FB7185' : '#FACC15',
            })
          }
          drawCanvasBanner(
            ctx,
            w / 2,
            100,
            '💥 T+5.0s AERODİNAMİK TAKLA VE İNFİLAK! (CoM / CoP Kararsızlığı)',
            '#FB7185',
          )
        } else {
          drawRocketSprite(ctx, rocketX, rocketY, angle, true, parts.body.spriteVariant ?? 'explorer')
          if (isSpinFail && simTime > 4.1) {
            drawCanvasBanner(
              ctx,
              w / 2,
              100,
              '⚠ UYARI: BASINÇ MERKEZİ (CoP) ÖNDE — ROKET TAKLA ATIYOR!',
              '#FACC15',
            )
          }
        }
      } else if (simTime < 9.0) {
        // INTERPLANETARY ORBITAL TRANSFER SCENE
        const p = (simTime - 5.8) / 3.2
        const isLowDv = evaluation.failureStage === 'ORBIT'
        const fuelDepleted = isLowDv && p > 0.55

        // Draw Earth on left
        ctx.fillStyle = '#2563EB'
        ctx.beginPath()
        ctx.arc(140, h / 2 + 60, 56, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#93C5FD'
        ctx.font = 'bold 12px "DM Mono", monospace'
        ctx.textAlign = 'center'
        ctx.fillText('DÜNYA (1.0 AU)', 140, h / 2 + 135)

        // Draw Target Planet on right
        ctx.fillStyle = parts.planet.themeColor ?? '#FFAD57'
        ctx.beginPath()
        ctx.arc(w - 150, h / 2 - 40, 48, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#F8FAFC'
        ctx.fillText(parts.planet.name.toUpperCase(), w - 150, h / 2 + 30)

        // Transfer trajectory dashed curve
        ctx.strokeStyle = fuelDepleted ? '#FB7185' : '#38D9E8'
        ctx.setLineDash([6, 6])
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(195, h / 2 + 40)
        ctx.quadraticCurveTo(w / 2, h / 2 - 140, w - 195, h / 2 - 40)
        ctx.stroke()
        ctx.setLineDash([])

        const effectiveT = fuelDepleted ? 0.55 + (p - 0.55) * 0.2 : p
        const rx = (1 - effectiveT) ** 2 * 195 + 2 * (1 - effectiveT) * effectiveT * (w / 2) + effectiveT ** 2 * (w - 195)
        const ry =
          (1 - effectiveT) ** 2 * (h / 2 + 40) +
          2 * (1 - effectiveT) * effectiveT * (h / 2 - 140) +
          effectiveT ** 2 * (h / 2 - 40)

        const driftAngle = fuelDepleted ? Math.PI / 2 + (p - 0.55) * 6 : Math.PI / 2 - 0.25
        drawRocketSprite(ctx, rx, ry, driftAngle, !fuelDepleted, parts.body.spriteVariant ?? 'explorer')

        if (fuelDepleted) {
          drawCanvasBanner(
            ctx,
            w / 2,
            95,
            `⛽ YAKIT BİTTİ! (${evaluation.deltaVMps} / ${evaluation.requiredDeltaVMps} m/s Δv) — UZAY BOŞLUĞUNDA SÜRÜKLENİYOR`,
            '#FB7185',
          )
        }
      } else {
        // SURFACE DESCENT & EDL SCENE
        const p = Math.min(1, (simTime - 9.0) / 3.0)
        const isSurfaceFail = evaluation.failureStage === 'SURFACE'

        // Draw planetary surface & craters
        ctx.fillStyle = parts.planet.surfaceColor ?? '#475569'
        ctx.fillRect(0, h - 90, w, 90)
        ctx.fillStyle = '#0F172A55'
        ctx.beginPath()
        ctx.ellipse(230, h - 55, 55, 14, 0, 0, Math.PI * 2)
        ctx.ellipse(w - 220, h - 45, 70, 18, 0, 0, Math.PI * 2)
        ctx.fill()

        const targetY = h - 135
        const currentY = 90 + p * (targetY - 90)

        // Draw parachute if equipped
        if (parts.landingSystem.type === 'PARACHUTE') {
          ctx.strokeStyle = '#F8FAFC'
          ctx.lineWidth = 1.5
          if (parts.planet.atmosphereType === 'VACUUM') {
            // Limp collapsed parachute in vacuum!
            ctx.fillStyle = '#FB7185'
            ctx.fillRect(w / 2 - 6, currentY - 68, 12, 24)
          } else {
            ctx.fillStyle = '#FB923C'
            ctx.beginPath()
            ctx.arc(w / 2, currentY - 75, 32, Math.PI, 0)
            ctx.fill()
          }
        }

        if (isSurfaceFail && p > 0.85) {
          for (let i = 0; i < 6; i++) {
            particles.push({
              x: w / 2,
              y: targetY + 20,
              vx: (Math.random() - 0.5) * 200,
              vy: -Math.random() * 180,
              radius: Math.random() * 16 + 6,
              alpha: 1,
              color: '#FB7185',
            })
          }
          drawCanvasBanner(ctx, w / 2, 95, `💥 YÜZEYE ÇAKILMA: ${evaluation.learningCard.title}`, '#FB7185')
        } else {
          const retroFiring =
            parts.landingSystem.type === 'RETROROCKET' || parts.landingSystem.type === 'HEATSHIELD_SKYCRANE'
          drawRocketSprite(ctx, w / 2, currentY, 0, retroFiring && p < 0.96, parts.body.spriteVariant ?? 'explorer')

          if (!isSurfaceFail && p >= 0.95) {
            drawCanvasBanner(
              ctx,
              w / 2,
              95,
              `✓ ${parts.planet.name.toUpperCase()} YÜZEYİNE GÜVENLİ İNİŞ TAMAMLANDI!`,
              '#4ADE80',
            )
          }
        }
      }

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i]!
        pt.x += pt.vx * dt
        pt.y += pt.vy * dt
        pt.alpha -= dt * 0.9
        if (pt.alpha <= 0) {
          particles.splice(i, 1)
          continue
        }
        ctx.globalAlpha = Math.max(0, pt.alpha)
        ctx.fillStyle = pt.color
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (simTime >= endTimeSec) {
        if (!completedRef.current) {
          completedRef.current = true
          state.completeFlight(false)
        }
        return
      }

      animationFrameId = requestAnimationFrame(render)
    }

    animationFrameId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animationFrameId)
  }, [speedMultiplier])

  const canAbortOnPad = elapsedSec < 2.6 && !state.lastFlightReport

  return (
    <section className="flight-sim-shell" aria-label="Canlı 2D Uçuş ve Yörünge Simülasyonu">
      <div className="flight-sim-topbar">
        <div>
          <span className="eyebrow-tag">{phaseLabel}</span>
          <h2>
            Hedef: {parts.planet.name} · Uçuş Süresi: T+{elapsedSec.toFixed(1)}s
          </h2>
        </div>

        <div className="flight-sim-actions">
          <button
            type="button"
            className="chip-btn"
            onClick={() => setSpeedMultiplier((prev) => (prev === 1 ? 2 : 1))}
          >
            ⏩ Simülasyon Hızı: {speedMultiplier}x
          </button>

          {canAbortOnPad && (
            <button
              type="button"
              className="abort-btn"
              onClick={() => {
                if (!completedRef.current) {
                  completedRef.current = true
                  state.completeFlight(true)
                }
              }}
            >
              🛑 RAMPADA İPTAL ET (Sadece %15 Yakıt Cezası: -{evaluation.padAbortCostCredits} ₡)
            </button>
          )}

          {!state.lastFlightReport && (
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                if (!completedRef.current) {
                  completedRef.current = true
                  state.completeFlight(false)
                }
              }}
            >
              ⏭ Sonuca Atla
            </button>
          )}
        </div>
      </div>

      <div className="canvas-frame">
        <canvas ref={canvasRef} width={920} height={480} className="flight-canvas" />

        {/* Live Telemetry Overlay inside Canvas */}
        <div className="canvas-hud-overlay">
          <div>
            <span>KALKIŞ TWR</span>
            <strong style={{ color: evaluation.earthTWR >= 1.0 ? '#4ADE80' : '#FB7185' }}>
              {evaluation.earthTWR.toFixed(2)}
            </strong>
          </div>
          <div>
            <span>DENGE (CoM/CoP)</span>
            <strong style={{ color: evaluation.stability.isStable ? '#4ADE80' : '#FB7185' }}>
              {evaluation.stability.isStable ? 'KARARLI' : 'KARARSIZ'}
            </strong>
          </div>
          <div>
            <span>MENZİL (Δv)</span>
            <strong style={{ color: evaluation.deltaVMps >= evaluation.requiredDeltaVMps ? '#38D9E8' : '#FB7185' }}>
              {evaluation.deltaVMps} / {evaluation.requiredDeltaVMps} m/s
            </strong>
          </div>
          <div>
            <span>İNİŞ SİSTEMİ</span>
            <strong>{parts.landingSystem.name.split(' ')[0]}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function drawRocketSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleRad: number,
  thrustActive: boolean,
  variant: string,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angleRad)

  const width = variant === 'scout' ? 22 : variant === 'carrier' ? 34 : 28

  // Exhaust flame
  if (thrustActive) {
    ctx.fillStyle = '#FFAD57'
    ctx.beginPath()
    ctx.moveTo(-width * 0.35, 36)
    ctx.lineTo(width * 0.35, 36)
    ctx.lineTo(0, 64 + Math.random() * 18)
    ctx.closePath()
    ctx.fill()
  }

  // Fins
  ctx.fillStyle = '#38D9E8'
  ctx.beginPath()
  ctx.moveTo(-width / 2, 16)
  ctx.lineTo(-width / 2 - 12, 34)
  ctx.lineTo(-width / 2, 32)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(width / 2, 16)
  ctx.lineTo(width / 2 + 12, 34)
  ctx.lineTo(width / 2, 32)
  ctx.closePath()
  ctx.fill()

  // Main Rocket Hull
  ctx.fillStyle = '#F8FAFC'
  ctx.strokeStyle = '#38D9E8'
  ctx.lineWidth = 1.5
  ctx.fillRect(-width / 2, -24, width, 58)
  ctx.strokeRect(-width / 2, -24, width, 58)

  // Orange Cryo Tank Stripe
  ctx.fillStyle = '#FB923C'
  ctx.fillRect(-width / 2 + 1, 4, width - 2, 18)

  // Nose Cone
  ctx.fillStyle = '#E2E8F0'
  ctx.beginPath()
  ctx.moveTo(-width / 2, -24)
  ctx.lineTo(0, -48)
  ctx.lineTo(width / 2, -24)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}

function drawCanvasBanner(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.save()
  ctx.font = 'bold 14px "Manrope", sans-serif'
  const metrics = ctx.measureText(text)
  const padX = 18
  const boxW = metrics.width + padX * 2
  ctx.fillStyle = '#080F20EE'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.fillRect(x - boxW / 2, y - 22, boxW, 36)
  ctx.strokeRect(x - boxW / 2, y - 22, boxW, 36)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, x, y + 1)
  ctx.restore()
}
