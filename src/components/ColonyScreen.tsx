import { useState } from 'react'
import { calculateSolarEfficiency } from '../game/calculations'
import { useRocketAssembly, type ColonyTileType } from '../game/assemblyStore'

interface ColonyScreenProps {
  onBackToAssembly: () => void
  onBackHome: () => void
}

interface BlockTool {
  id: ColonyTileType
  label: string
  cost: number
  powerOut: number
  powerUse: number
  income: number
  color: string
}

const BLOCK_TOOLS: BlockTool[] = [
  { id: 'hull', label: '🧱 Gövde Bloğu', cost: 20, powerOut: 0, powerUse: 0, income: 5, color: '#64748B' },
  { id: 'solar', label: '☀️ Güneş Paneli', cost: 60, powerOut: 100, powerUse: 0, income: 15, color: '#38D9E8' },
  { id: 'rtg', label: '☢️ Nükleer RTG', cost: 140, powerOut: 120, powerUse: 0, income: 25, color: '#A855F7' },
  { id: 'greenhouse', label: '🌱 Biyo-Sera', cost: 90, powerOut: 0, powerUse: 30, income: 65, color: '#4ADE80' },
  { id: 'habitat', label: '🏠 Yaşam Odası', cost: 110, powerOut: 0, powerUse: 25, income: 80, color: '#C4A7FF' },
  { id: 'drill', label: '⛏️ Maden Sondajı', cost: 100, powerOut: 0, powerUse: 35, income: 110, color: '#FFAD57' },
  { id: 'empty', label: '🔨 Yık / Sil (+15 cr)', cost: 0, powerOut: 0, powerUse: 0, income: 0, color: '#FB7185' },
]

export function ColonyScreen({ onBackToAssembly, onBackHome }: ColonyScreenProps) {
  const {
    destinationId,
    setDestinationId,
    budgetCredits,
    colonyGrids,
    placeColonyTile,
    rewardMission,
  } = useRocketAssembly()

  const [selectedTool, setSelectedTool] = useState<ColonyTileType>('solar')
  const grid = colonyGrids[destinationId]
  const solarEff = calculateSolarEfficiency(destinationId === 'moon' ? 1.0 : 1.52)

  // Compute colony energy & income
  let energyProduced = 0
  let energyUsed = 0
  let rawIncome = 0
  let blockCount = 0

  for (const row of grid) {
    for (const cell of row) {
      if (cell === 'empty') continue
      blockCount += 1
      const tool = BLOCK_TOOLS.find((t) => t.id === cell)
      if (!tool) continue
      if (cell === 'solar') {
        energyProduced += Math.round((tool.powerOut * solarEff) / 100)
      } else {
        energyProduced += tool.powerOut
      }
      energyUsed += tool.powerUse
      rawIncome += tool.income
    }
  }

  const netEnergy = energyProduced - energyUsed
  const isBlackout = blockCount > 0 && netEnergy < 0
  const turnIncome = isBlackout ? 0 : rawIncome

  const activeToolObj = BLOCK_TOOLS.find((t) => t.id === selectedTool) ?? BLOCK_TOOLS[0]!

  return (
    <div className="assembly-page">
      <header className="assembly-topbar">
        <button className="back-button" onClick={onBackHome}>
          ← <span>Ana Menü</span>
        </button>
        <a className="wordmark" href="#colony">
          <span className="wordmark-icon">✦</span>
          <span>SPACE ENGINEERS · 2D PİKSEL KOLONİ</span>
        </a>
        <div className="topbar-right-pills">
          <button type="button" className="mini-nav-btn" onClick={onBackToAssembly}>
            🚀 Roket Hangarı
          </button>
          <div className="budget-pill">
            <span>BÜTÇE</span>
            <b>{budgetCredits.toLocaleString('tr-TR')} cr</b>
          </div>
        </div>
      </header>

      <main className="assembly-layout">
        {/* Top Status & Planet Switcher */}
        <div className="colony-top-strip panel-card">
          <div className="target-pills">
            <button
              type="button"
              className={`target-pill ${destinationId === 'moon' ? 'active' : ''}`}
              onClick={() => setDestinationId('moon')}
            >
              🌕 AY ÜSSÜ (1.0 AU · %100 Güneş)
            </button>
            <button
              type="button"
              className={`target-pill ${destinationId === 'mars' ? 'active' : ''}`}
              onClick={() => setDestinationId('mars')}
            >
              🔴 MARS ÜSSÜ (1.52 AU · %43 Güneş)
            </button>
          </div>

          <div className="colony-meters">
            <div className={`colony-stat-pill ${isBlackout ? 'danger' : 'ok'}`}>
              <span>⚡ NET ENERJİ (1/r²)</span>
              <b>{isBlackout ? `ŞALTER İNDİ (${netEnergy})` : `+${netEnergy} W`}</b>
            </div>
            <div className="colony-stat-pill">
              <span>💰 TUR GELİRİ</span>
              <b style={{ color: '#4ADE80' }}>+{turnIncome} cr</b>
            </div>
            <button
              type="button"
              className="button button-primary harvest-btn"
              disabled={turnIncome <= 0}
              onClick={() => rewardMission(turnIncome, 15, [], destinationId)}
            >
              ⚡ Üretimi Topla (+{turnIncome} cr)
            </button>
          </div>
        </div>

        {/* Dynamic 2D Pixel Sandbox Grid (Terraria + Space Engineers Style) */}
        <section className={`pixel-sandbox-frame panel-card ${isBlackout ? 'frame-blackout' : ''}`}>
          <div className="sandbox-sky-label">
            <span>KAROLARA TIKLAYARAK BLOK YERLEŞTİRİN ({destinationId === 'moon' ? 'AY KRATERİ' : 'MARS KANYONU'})</span>
            <span>GÜNEŞ VERİMİ: %{solarEff}</span>
          </div>

          <div className="pixel-grid-wrapper">
            {grid.map((row, rIdx) => {
              const isSky = rIdx <= 1
              const isSurface = rIdx === 2
              return (
                <div
                  key={rIdx}
                  className={`pixel-grid-row ${isSky ? 'row-sky' : isSurface ? 'row-surface' : 'row-underground'}`}
                >
                  {row.map((cell, cIdx) => {
                    const hasOre = rIdx >= 3 && (rIdx * 7 + cIdx * 3) % 5 === 0
                    const isLandedRocketSpot = rIdx === 1 && cIdx === 1
                    return (
                      <button
                        key={`${rIdx}-${cIdx}`}
                        type="button"
                        className={`pixel-tile tile-${cell} ${hasOre ? 'has-ore' : ''}`}
                        onClick={() => placeColonyTile(destinationId, rIdx, cIdx, selectedTool, activeToolObj.cost)}
                        title={`Satır ${rIdx + 1}, Sütun ${cIdx + 1}`}
                      >
                        {isLandedRocketSpot && cell === 'empty' ? (
                          <span className="pixel-rocket-marker" title="İnen Roketiniz">
                            🚀
                          </span>
                        ) : (
                          renderPixelBlockSvg(cell, hasOre, isBlackout)
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Hotbar Palette at Bottom (Space Engineers / Terraria Style) */}
          <div className="sandbox-hotbar">
            {BLOCK_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className={`hotbar-slot ${selectedTool === tool.id ? 'selected' : ''}`}
                style={{ '--slot-color': tool.color } as React.CSSProperties}
                onClick={() => setSelectedTool(tool.id)}
              >
                <strong>{tool.label}</strong>
                <small>
                  {tool.cost > 0 ? `${tool.cost} cr` : 'Ücretsiz'}
                  {tool.id === 'solar'
                    ? ` · +${Math.round((tool.powerOut * solarEff) / 100)}W`
                    : tool.powerOut > 0
                      ? ` · +${tool.powerOut}W`
                      : tool.powerUse > 0
                        ? ` · -${tool.powerUse}W / +${tool.income}cr`
                        : ''}
                </small>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function renderPixelBlockSvg(cell: ColonyTileType, hasOre: boolean, isBlackout: boolean) {
  if (cell === 'empty') {
    if (!hasOre) return null
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="8" y="10" width="5" height="5" fill="#FACC15" />
        <rect x="18" y="16" width="6" height="6" fill="#38D9E8" />
        <rect x="12" y="22" width="4" height="4" fill="#FACC15" />
      </svg>
    )
  }

  if (cell === 'hull') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="2" y="2" width="28" height="28" fill="#334155" stroke="#94A3B8" strokeWidth="2" />
        <rect x="8" y="12" width="16" height="8" fill="#38D9E8" />
      </svg>
    )
  }

  if (cell === 'solar') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="14" y="16" width="4" height="14" fill="#94A3B8" />
        <rect x="3" y="6" width="26" height="10" fill="#0284C7" stroke="#38D9E8" strokeWidth="2" />
        <rect x="10" y="6" width="2" height="10" fill="#38D9E8" />
        <rect x="20" y="6" width="2" height="10" fill="#38D9E8" />
      </svg>
    )
  }

  if (cell === 'rtg') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="8" y="4" width="16" height="24" fill="#4C1D95" stroke="#A855F7" strokeWidth="2" />
        <rect x="12" y="10" width="8" height="8" fill="#FACC15" />
        <rect x="4" y="8" width="4" height="16" fill="#94A3B8" />
        <rect x="24" y="8" width="4" height="16" fill="#94A3B8" />
      </svg>
    )
  }

  if (cell === 'greenhouse') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="2" y="6" width="28" height="24" fill="#064E3B" stroke="#4ADE80" strokeWidth="2" />
        <rect x="6" y="18" width="6" height="8" fill="#4ADE80" />
        <rect x="14" y="14" width="6" height="12" fill="#22C55E" />
        <rect x="22" y="16" width="5" height="10" fill="#4ADE80" />
      </svg>
    )
  }

  if (cell === 'habitat') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect
          x="2"
          y="2"
          width="28"
          height="28"
          fill="#1E1B4B"
          stroke={isBlackout ? '#FB7185' : '#C4A7FF'}
          strokeWidth="2"
        />
        {/* Pixel Astronaut inside Habitat */}
        <rect x="13" y="9" width="6" height="6" fill="#F8FAFC" />
        <rect x="14" y="10" width="4" height="3" fill="#38D9E8" />
        <rect x="12" y="15" width="8" height="9" fill="#FFAD57" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
      <rect x="6" y="2" width="20" height="12" fill="#7C2D12" stroke="#FFAD57" strokeWidth="2" />
      <polygon points="10,14 22,14 16,30" fill="#FACC15" />
    </svg>
  )
}
