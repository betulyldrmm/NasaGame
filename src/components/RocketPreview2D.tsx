import type { FuelTank, PayloadId, RocketBody, RocketEngine } from '../game/types'

interface RocketPreviewProps {
  body: RocketBody
  engine: RocketEngine
  fuelTank?: FuelTank | null
  payloadIds: PayloadId[]
  hasFins?: boolean
  comPercent?: number
  copPercent?: number
  onCycleBody?: () => void
  onCycleTank?: () => void
  onCycleEngine?: () => void
  onToggleFins?: () => void
}

const cargoColors: Record<PayloadId, string> = {
  'solar-panel': '#38D9E8',
  rover: '#FFAD57',
  greenhouse: '#4ADE80',
  habitat: '#C4A7FF',
}

export default function RocketPreview2D({
  body,
  engine,
  fuelTank,
  payloadIds,
  hasFins = true,
  comPercent = 45,
  copPercent = 60,
  onCycleBody,
  onCycleTank,
  onCycleEngine,
  onToggleFins,
}: RocketPreviewProps) {
  const bodyHeight = 76 + body.cargoSlots * 16
  const tankHeight = !fuelTank ? 0 : fuelTank.id === 'tank-compact' ? 24 : fuelTank.id === 'tank-standard' ? 38 : 52
  const bodyTop = 196 - bodyHeight - tankHeight
  const tankTop = 196 - tankHeight
  const engineWidth = engine.id === 'engine-titan' ? 68 : engine.id === 'engine-voyager' ? 54 : 42
  const engineLeft = 150 - engineWidth / 2
  const engineColor =
    engine.id === 'engine-titan' ? '#FFAD57' : engine.id === 'engine-voyager' ? '#9CAECC' : '#38D9E8'

  const comY = Math.round(bodyTop + ((210 - bodyTop) * comPercent) / 100)
  const copY = Math.round(bodyTop + ((210 - bodyTop) * copPercent) / 100)

  return (
    <div className="rocket-stage">
      <div className="preview-grid" aria-hidden="true" />
      <div className="pixel-satellite satellite-left" aria-hidden="true">
        ✦
      </div>
      <div className="pixel-satellite satellite-right" aria-hidden="true">
        ·
      </div>
      <svg
        className="rocket-svg"
        viewBox="0 0 300 285"
        role="img"
        aria-label="Seçilen parçalara göre değişen 2D piksel roket önizlemesi"
        shapeRendering="crispEdges"
      >
        <defs>
          <linearGradient id="rocketHull" x1="0" x2="1">
            <stop stopColor="#9CAECC" />
            <stop offset=".5" stopColor="#F3F7FF" />
            <stop offset="1" stopColor="#7085A6" />
          </linearGradient>
        </defs>

        {/* Engine Exhaust Pixel Flame */}
        <g className="pixel-flame-flicker">
          <rect x="132" y="232" width="12" height="12" fill={engineColor} />
          <rect x="144" y="244" width="12" height="14" fill="#FB7185" />
          <rect x="156" y="232" width="12" height="12" fill={engineColor} />
          <rect x={150 - engineWidth / 4} y="224" width={engineWidth / 2} height="10" fill={engineColor} />
        </g>

        {/* Stabilizer Fins (Click to toggle) */}
        {hasFins && (
          <g onClick={onToggleFins} style={{ cursor: 'pointer' }}>
            <rect x="98" y="182" width="22" height="24" fill="#E45B69" />
            <rect x="90" y="194" width="10" height="16" fill="#E45B69" />
            <rect x="180" y="182" width="22" height="24" fill="#E45B69" />
            <rect x="200" y="194" width="10" height="16" fill="#E45B69" />
          </g>
        )}

        {/* Engine Nozzle (Click to cycle engine) */}
        <g onClick={onCycleEngine} style={{ cursor: 'pointer' }}>
          <rect
            x={engineLeft}
            y="204"
            width={engineWidth}
            height={engine.id === 'engine-titan' ? 24 : 18}
            fill={engineColor}
          />
          <rect x={engineLeft + 6} y="210" width={engineWidth - 12} height="14" fill="#243653" />
        </g>

        {/* Nose Cone */}
        <path d={`M150 ${bodyTop - 38} L180 ${bodyTop} H120 Z`} fill="#FFAD57" />
        <rect x="144" y={bodyTop - 12} width="12" height="12" fill="#FFE0A8" />

        {/* Main Body Fuselage (Click to cycle body) */}
        <g onClick={onCycleBody} style={{ cursor: 'pointer' }}>
          <rect x="120" y={bodyTop} width="60" height={bodyHeight} fill="url(#rocketHull)" />
          <rect x="114" y={bodyTop + 8} width="72" height="10" fill="#C3D2E8" />
          <rect x="132" y={bodyTop + 26} width="36" height="26" fill="#172A49" />
          <rect x="138" y={bodyTop + 31} width="24" height="16" fill="#38D9E8" />
          <rect x="144" y={bodyTop + 35} width="12" height="6" fill="#A6F2F5" />
          {Array.from({ length: body.cargoSlots }, (_, index) => (
            <rect
              key={index}
              x="126"
              y={bodyTop + 58 + index * 14}
              width="48"
              height="9"
              fill={index % 2 === 0 ? '#D0D9E8' : '#B4C1D7'}
            />
          ))}
          <rect x="122" y={bodyTop + 54} width="4" height={bodyHeight - 58} fill="#FFAD57" />
          <rect x="174" y={bodyTop + 54} width="4" height={bodyHeight - 58} fill="#FFAD57" />
        </g>

        {/* Fuel Tank Segment (Click to cycle tank) */}
        {tankHeight > 0 && (
          <g onClick={onCycleTank} style={{ cursor: 'pointer' }}>
            <rect x="120" y={tankTop} width="60" height={tankHeight} fill="#315885" />
            <rect x="116" y={tankTop + 2} width="68" height="5" fill="#FFAD57" />
            <rect x="116" y={tankTop + tankHeight - 7} width="68" height="5" fill="#FFAD57" />
          </g>
        )}
        <rect x="114" y="196" width="72" height="10" fill="#879BB9" />

        {/* Attached Pixel Cargo Pods */}
        {payloadIds.slice(0, body.cargoSlots).map((id, index) => (
          <g key={`${id}-${index}`}>
            <rect
              x={index % 2 === 0 ? 40 : 208}
              y={bodyTop + 56 + Math.floor(index / 2) * 30}
              width="48"
              height="24"
              fill="#243653"
              stroke={cargoColors[id]}
              strokeWidth="3"
            />
            <rect
              x={index % 2 === 0 ? 46 : 214}
              y={bodyTop + 62 + Math.floor(index / 2) * 30}
              width="14"
              height="12"
              fill={cargoColors[id]}
            />
            <rect
              x={index % 2 === 0 ? 64 : 232}
              y={bodyTop + 66 + Math.floor(index / 2) * 30}
              width="16"
              height="4"
              fill="#F3F7FF"
            />
          </g>
        ))}

        {/* Live CoM (Yellow Pixel Marker) & CoP (Blue Pixel Triangle) */}
        <g transform={`translate(0, ${comY})`}>
          <rect x="18" y="-8" width="54" height="16" fill="#0B1428" stroke="#FACC15" strokeWidth="1.5" />
          <text x="45" y="3" textAnchor="middle" fill="#FACC15" fontSize="8.5" fontFamily="DM Mono, monospace">
            ● CoM
          </text>
          <rect x="72" y="-1" width="72" height="2" fill="#FACC15" />
          <rect x="144" y="-6" width="12" height="12" fill="#FACC15" stroke="#080F20" strokeWidth="2" />
        </g>

        <g transform={`translate(0, ${copY})`}>
          <rect x="228" y="-8" width="54" height="16" fill="#0B1428" stroke="#38D9E8" strokeWidth="1.5" />
          <text x="255" y="3" textAnchor="middle" fill="#38D9E8" fontSize="8.5" fontFamily="DM Mono, monospace">
            ▲ CoP
          </text>
          <rect x="156" y="-1" width="72" height="2" fill="#38D9E8" />
          <polygon points="150,-8 159,8 141,8" fill="#38D9E8" stroke="#080F20" strokeWidth="1.5" />
        </g>

        <rect x="0" y="264" width="300" height="2" fill="#8294B040" />
      </svg>
      <div className="preview-caption">
        <span>PİKSEL ŞEMA (PARÇALARA TIKLA)</span>
        <span>{hasFins ? '✓ DENGE: KARARLI' : '⚠ KANATÇIK YOK (TAKLA!)'}</span>
      </div>
    </div>
  )
}
