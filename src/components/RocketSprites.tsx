import type {
  AerodynamicFin,
  AerodynamicStabilityResult,
  FuelTank,
  LandingSystem,
  Payload,
  RocketBody,
  RocketEngine,
} from '../game/types'

interface RocketBlueprintVisualizerProps {
  body: RocketBody
  engine: RocketEngine
  fuelTank: FuelTank | null
  fin: AerodynamicFin
  landingSystem: LandingSystem
  payloads: Payload[]
  stability: AerodynamicStabilityResult
}

export function getPayloadIcon(payloadId: string): string {
  switch (payloadId) {
    case 'solar-panel':
      return '☀️'
    case 'rtg-generator':
      return '☢️'
    case 'rover':
      return '🚜'
    case 'greenhouse':
      return '🌱'
    case 'habitat':
      return '🏠'
    case 'comm-sat':
      return '🛰️'
    default:
      return '📦'
  }
}

/**
 * Interactive 2.5D / Pixel-Blueprint Modular Rocket Stack Visualizer.
 * Displays the stacked rocket components alongside the live Yellow Circle (CoM)
 * and Blue Triangle (CoP) aerodynamic stability markers recommended in the NASA design guide.
 */
export function RocketBlueprintVisualizer({
  body,
  engine,
  fuelTank,
  fin,
  landingSystem,
  payloads,
  stability,
}: RocketBlueprintVisualizerProps) {
  const bodyWidth =
    body.spriteVariant === 'scout'
      ? 68
      : body.spriteVariant === 'explorer'
        ? 86
        : body.spriteVariant === 'carrier'
          ? 110
          : 104

  const tankHeight =
    !fuelTank
      ? 24
      : fuelTank.spriteVariant === 'small'
        ? 54
        : fuelTank.spriteVariant === 'medium'
          ? 76
          : fuelTank.spriteVariant === 'large'
            ? 100
            : 118

  // Map 0..100 normalized positions into pixel coordinates inside the 380px tall SVG rocket frame
  const comY = Math.round(45 + (stability.comPosition / 100) * 285)
  const copY = Math.round(45 + (stability.copPosition / 100) * 285)

  const slots = Array.from({ length: body.cargoSlots }, (_, i) => payloads[i] ?? null)

  return (
    <div className="rocket-blueprint-card">
      <div className="blueprint-header">
        <span className="blueprint-tag">MİMARİ KESİT · 1:100 ÖLÇEK</span>
        <span className={`stability-pill ${stability.isStable ? 'stable' : 'unstable'}`}>
          {stability.isStable
            ? `✓ KARARLI (CoM Üstte · +${stability.stabilityMargin})`
            : `⚠ KARARSIZ! (Takla Riski · ${stability.stabilityMargin})`}
        </span>
      </div>

      <div className="blueprint-stage">
        <svg
          viewBox="0 0 320 410"
          className="rocket-svg"
          role="img"
          aria-label="Modüler roket montaj şeması, ağırlık merkezi (sarı daire) ve basınç merkezi (mavi üçgen)"
        >
          <defs>
            <pattern id="bp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#38D9E8" strokeOpacity="0.11" strokeWidth="1" />
            </pattern>
            <linearGradient id="hull-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#CFD8E8" />
              <stop offset="45%" stopColor="#F8FAFC" />
              <stop offset="80%" stopColor="#94A3B8" />
              <stop offset="100%" stopColor="#475569" />
            </linearGradient>
            <linearGradient id="cryo-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#C2410C" />
              <stop offset="45%" stopColor="#FB923C" />
              <stop offset="100%" stopColor="#7C2D12" />
            </linearGradient>
          </defs>

          {/* Engineering Coordinate Grid */}
          <rect x="0" y="0" width="320" height="410" fill="url(#bp-grid)" />
          <line x1="160" y1="12" x2="160" y2="395" stroke="#38D9E8" strokeDasharray="4 4" strokeOpacity="0.35" />

          {/* Side Boosters for Heavy Carrier / Carbon-X */}
          {(body.spriteVariant === 'carrier' || body.spriteVariant === 'titan') && (
            <g>
              <rect
                x={160 - bodyWidth / 2 - 22}
                y={170}
                width="18"
                height="155"
                rx="4"
                fill="url(#hull-grad)"
                stroke="#38D9E8"
                strokeWidth="1.2"
              />
              <polygon
                points={`${160 - bodyWidth / 2 - 22},170 ${160 - bodyWidth / 2 - 13},145 ${160 - bodyWidth / 2 - 4},170`}
                fill="#FFAD57"
              />
              <rect
                x={160 + bodyWidth / 2 + 4}
                y={170}
                width="18"
                height="155"
                rx="4"
                fill="url(#hull-grad)"
                stroke="#38D9E8"
                strokeWidth="1.2"
              />
              <polygon
                points={`${160 + bodyWidth / 2 + 4},170 ${160 + bodyWidth / 2 + 13},145 ${160 + bodyWidth / 2 + 22},170`}
                fill="#FFAD57"
              />
            </g>
          )}

          {/* Nose Cone & Landing System Shroud */}
          <g>
            <path
              d={`M ${160 - bodyWidth / 2} 95 Q 160 22 ${160 + bodyWidth / 2} 95 Z`}
              fill="url(#hull-grad)"
              stroke="#38D9E8"
              strokeWidth="1.5"
            />
            {landingSystem.type === 'PARACHUTE' && (
              <rect
                x={160 - 20}
                y={64}
                width="40"
                height="16"
                rx="3"
                fill="#FB7185"
                stroke="#FFF"
                strokeWidth="1"
              />
            )}
            {landingSystem.type === 'RETROROCKET' && (
              <g>
                <rect x={160 - bodyWidth / 2 - 7} y={84} width="10" height="14" rx="2" fill="#38D9E8" />
                <rect x={160 + bodyWidth / 2 - 3} y={84} width="10" height="14" rx="2" fill="#38D9E8" />
              </g>
            )}
            {landingSystem.type === 'HEATSHIELD_SKYCRANE' && (
              <path
                d={`M ${160 - bodyWidth / 2 - 8} 96 Q 160 80 ${160 + bodyWidth / 2 + 8} 96`}
                fill="none"
                stroke="#FFAD57"
                strokeWidth="5"
                strokeLinecap="round"
              />
            )}
          </g>

          {/* Upper Payload / Habitat Body Section */}
          <rect
            x={160 - bodyWidth / 2}
            y={95}
            width={bodyWidth}
            height={110}
            fill="url(#hull-grad)"
            stroke="#38D9E8"
            strokeWidth="1.5"
          />

          {/* Cargo Bay Slots Inside Body */}
          {slots.map((slotPayload, idx) => {
            const slotHeight = Math.floor(92 / slots.length)
            const slotY = 102 + idx * slotHeight
            return (
              <g key={idx}>
                <rect
                  x={160 - bodyWidth / 2 + 8}
                  y={slotY}
                  width={bodyWidth - 16}
                  height={slotHeight - 4}
                  rx="3"
                  fill={slotPayload ? '#0F172A' : '#1E293B'}
                  stroke={slotPayload ? '#38D9E8' : '#475569'}
                  strokeDasharray={slotPayload ? 'none' : '3 2'}
                />
                <text
                  x="160"
                  y={slotY + (slotHeight - 4) / 2 + 4}
                  textAnchor="middle"
                  fill={slotPayload ? '#F8FAFC' : '#64748B'}
                  fontSize="10"
                  fontFamily="DM Mono, monospace"
                >
                  {slotPayload ? `${getPayloadIcon(slotPayload.id)} ${slotPayload.name.split(' ')[0]}` : `YUVA ${idx + 1}: BOŞ`}
                </text>
              </g>
            )
          })}

          {/* Fuel Tank Section */}
          <rect
            x={160 - bodyWidth / 2}
            y={205}
            width={bodyWidth}
            height={tankHeight}
            fill={fuelTank?.spriteVariant === 'large' || fuelTank?.spriteVariant === 'cryo' ? 'url(#cryo-grad)' : 'url(#hull-grad)'}
            stroke="#FFAD57"
            strokeWidth="1.5"
          />
          {/* Tank ribbing */}
          <line
            x1={160 - bodyWidth / 2}
            y1={205 + tankHeight / 2}
            x2={160 + bodyWidth / 2}
            y2={205 + tankHeight / 2}
            stroke="#080F20"
            strokeOpacity="0.45"
            strokeWidth="2"
          />
          <text
            x="160"
            y={205 + tankHeight / 2 - 5}
            textAnchor="middle"
            fill="#080F20"
            fontWeight="700"
            fontSize="9"
            fontFamily="DM Mono, monospace"
          >
            {fuelTank ? `${fuelTank.fuelMassKg} KG YAKIT` : 'TANK YOK!'}
          </text>

          {/* Stabilizer Fins (Kanatçıklar) */}
          {fin.spriteVariant === 'standard' && (
            <g>
              <polygon
                points={`${160 - bodyWidth / 2},${205 + tankHeight - 36} ${160 - bodyWidth / 2 - 28},${205 + tankHeight + 12} ${160 - bodyWidth / 2},${205 + tankHeight}`}
                fill="#38D9E8"
                stroke="#F8FAFC"
                strokeWidth="1.2"
              />
              <polygon
                points={`${160 + bodyWidth / 2},${205 + tankHeight - 36} ${160 + bodyWidth / 2 + 28},${205 + tankHeight + 12} ${160 + bodyWidth / 2},${205 + tankHeight}`}
                fill="#38D9E8"
                stroke="#F8FAFC"
                strokeWidth="1.2"
              />
            </g>
          )}
          {fin.spriteVariant === 'grid' && (
            <g>
              <polygon
                points={`${160 - bodyWidth / 2},${205 + tankHeight - 44} ${160 - bodyWidth / 2 - 36},${205 + tankHeight + 16} ${160 - bodyWidth / 2},${205 + tankHeight + 4}`}
                fill="#0EA5E9"
                stroke="#38D9E8"
                strokeWidth="1.5"
              />
              <polygon
                points={`${160 + bodyWidth / 2},${205 + tankHeight - 44} ${160 + bodyWidth / 2 + 36},${205 + tankHeight + 16} ${160 + bodyWidth / 2},${205 + tankHeight + 4}`}
                fill="#0EA5E9"
                stroke="#38D9E8"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* Engine Bell / Nozzle */}
          <g>
            <polygon
              points={`${160 - 20},${205 + tankHeight} ${160 + 20},${205 + tankHeight} ${160 + 30},${205 + tankHeight + 34} ${160 - 30},${205 + tankHeight + 34}`}
              fill={engine.spriteVariant === 'nerva' ? '#A855F7' : engine.spriteVariant === 'vulcan' ? '#F97316' : '#334155'}
              stroke="#94A3B8"
              strokeWidth="1.5"
            />
            {/* Exhaust glow preview */}
            <polygon
              points={`${160 - 18},${205 + tankHeight + 34} ${160 + 18},${205 + tankHeight + 34} 160,${205 + tankHeight + 64}`}
              fill="#FFAD57"
              fillOpacity="0.65"
            />
          </g>

          {/* ==========================================================
              LIVE CoM (Yellow Circle) & CoP (Blue Triangle) MARKERS
             ========================================================== */}
          {/* CoM - Yellow Circle (Ağırlık Merkezi) */}
          <g transform={`translate(0, ${comY})`}>
            <line x1="22" y1="0" x2="160" y2="0" stroke="#FACC15" strokeWidth="1.5" strokeDasharray="3 2" />
            <circle cx="160" cy="0" r="10" fill="#FACC15" stroke="#080F20" strokeWidth="2.5" />
            <circle cx="160" cy="0" r="3.5" fill="#080F20" />
            <rect x="8" y="-12" width="84" height="22" rx="4" fill="#080F20" stroke="#FACC15" strokeWidth="1.2" />
            <text x="50" y="3" textAnchor="middle" fill="#FACC15" fontSize="9.5" fontWeight="700" fontFamily="DM Mono, monospace">
              ● CoM ({stability.comPosition})
            </text>
          </g>

          {/* CoP - Blue Triangle (Basınç / Aerodinamik Merkez) */}
          <g transform={`translate(0, ${copY})`}>
            <line x1="160" y1="0" x2="298" y2="0" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="3 2" />
            <polygon points="160,-11 171,9 149,9" fill="#38BDF8" stroke="#080F20" strokeWidth="2.2" />
            <rect x="224" y="-12" width="88" height="22" rx="4" fill="#080F20" stroke="#38BDF8" strokeWidth="1.2" />
            <text x="268" y="3" textAnchor="middle" fill="#38BDF8" fontSize="9.5" fontWeight="700" fontFamily="DM Mono, monospace">
              ▲ CoP ({stability.copPosition})
            </text>
          </g>
        </svg>
      </div>

      <div className="blueprint-legend">
        <span>
          <strong style={{ color: '#FACC15' }}>● Sarı Daire (CoM):</strong> Ağırlık Merkezi
        </span>
        <span>
          <strong style={{ color: '#38BDF8' }}>▲ Mavi Üçgen (CoP):</strong> Basınç Merkezi
        </span>
        <span className="blueprint-rule">
          Kural: Sarı Daire her zaman Mavi Üçgenin <b>üstünde</b> durmalıdır!
        </span>
      </div>
    </div>
  )
}
