import { useEffect, useState, type CSSProperties } from 'react'
import { calculateSolarEfficiency } from '../game/calculations'
import { COLONY_TILE_COSTS, useRocketAssembly, type ColonyTileType } from '../game/assemblyStore'

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
  zoneHint: string
  color: string
}

const BLOCK_TOOLS: BlockTool[] = [
  {
    id: 'solar',
    label: '☀️ Güneş Paneli',
    cost: COLONY_TILE_COSTS.solar,
    powerOut: 100,
    powerUse: 0,
    income: 15,
    zoneHint: 'Yüzey (Satır 1-3)',
    color: '#38D9E8',
  },
  {
    id: 'rtg',
    label: '☢️ Nükleer RTG',
    cost: COLONY_TILE_COSTS.rtg,
    powerOut: 130,
    powerUse: 0,
    income: 25,
    zoneHint: 'Her Katman',
    color: '#A855F7',
  },
  {
    id: 'habitat',
    label: '🏠 Yaşam Odası',
    cost: COLONY_TILE_COSTS.habitat,
    powerOut: 0,
    powerUse: 25,
    income: 75,
    zoneHint: '+4 Astronot',
    color: '#C4A7FF',
  },
  {
    id: 'greenhouse',
    label: '🌱 Biyo-Sera',
    cost: COLONY_TILE_COSTS.greenhouse,
    powerOut: 0,
    powerUse: 30,
    income: 65,
    zoneHint: 'Yüzey · +6 O₂',
    color: '#4ADE80',
  },
  {
    id: 'drill',
    label: '⛏️ Lazer Sondaj',
    cost: COLONY_TILE_COSTS.drill,
    powerOut: 0,
    powerUse: 35,
    income: 95,
    zoneHint: 'Yeraltı (Cevher 2x)',
    color: '#FFAD57',
  },
  {
    id: 'hull',
    label: '🧱 Basınçlı Koridor',
    cost: COLONY_TILE_COSTS.hull,
    powerOut: 0,
    powerUse: 0,
    income: 10,
    zoneHint: 'Asansör & Koridor',
    color: '#94A3B8',
  },
  {
    id: 'empty',
    label: '🔨 Sök (%50 İade)',
    cost: 0,
    powerOut: 0,
    powerUse: 0,
    income: 0,
    zoneHint: 'Veya Sağ Tık',
    color: '#FB7185',
  },
]

const ROW_LABELS = [
  'KUBBE / ÜST',
  'ÜST GÜVERTE',
  'YÜZEY UFKU',
  'YERALTI -10m',
  'YERALTI -25m',
  'DERİN DAMAR',
]

export function isOreTile(rIdx: number, cIdx: number): boolean {
  return rIdx >= 3 && (rIdx * 7 + cIdx * 3) % 4 === 0
}

export function ColonyScreen({ onBackToAssembly, onBackHome }: ColonyScreenProps) {
  const {
    destinationId,
    setDestinationId,
    budgetCredits,
    sciencePoints,
    colonyGrids,
    placeColonyTile,
    rewardMission,
    claimEmergencyGrant,
  } = useRocketAssembly()

  const [selectedTool, setSelectedTool] = useState<ColonyTileType>('solar')
  const [statusToast, setStatusToast] = useState<string>(
    'Sol tık ile seçili modülü kurun, sağ tık ile hızla sökün. Parlayan cevher damarlarında sondaj 2x kazandırır!',
  )
  const [solCount, setSolCount] = useState(1)
  const [solTick, setSolTick] = useState(0)

  const grid = colonyGrids[destinationId]
  const solarEff = calculateSolarEfficiency(destinationId === 'moon' ? 1.0 : 1.52)

  // Compute colony energy, oxygen, population, ore bonus & income
  let energyProduced = 0
  let energyUsed = 0
  let rawIncome = 0
  let blockCount = 0
  let colonists = 0
  let oxygenCapacity = 2 // Base life support from landed rocket
  let activeOreDrills = 0

  grid.forEach((row, rIdx) => {
    row.forEach((cell, cIdx) => {
      if (cell === 'empty') return
      blockCount += 1
      const tool = BLOCK_TOOLS.find((t) => t.id === cell)
      if (!tool) return
      if (cell === 'solar') {
        energyProduced += Math.round((tool.powerOut * solarEff) / 100)
      } else {
        energyProduced += tool.powerOut
      }
      energyUsed += tool.powerUse

      let tileIncome = tool.income
      if (cell === 'drill' && isOreTile(rIdx, cIdx)) {
        tileIncome *= 2 // 2x Ore Vein Bonus!
        activeOreDrills += 1
      }
      if (cell === 'habitat') colonists += 4
      if (cell === 'greenhouse') oxygenCapacity += 6
      rawIncome += tileIncome
    })
  })

  const netEnergy = energyProduced - energyUsed
  const isBlackout = blockCount > 0 && netEnergy < 0
  const hasLifeSupportBonus = colonists > 0 && oxygenCapacity >= colonists
  const turnIncome = isBlackout ? 0 : Math.round(rawIncome * (hasLifeSupportBonus ? 1.25 : 1.0))
  const solProgress = (solTick % 5) * 20 + 20

  const activeToolObj = BLOCK_TOOLS.find((t) => t.id === selectedTool) ?? BLOCK_TOOLS[0]!

  // Clean 1-second tick interval without calling external state updates inside React state updaters
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSolTick((t) => t + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (solTick > 0 && solTick % 5 === 0) {
      if (turnIncome > 0) {
        rewardMission(turnIncome, 10, [], destinationId)
      }
      setSolCount((s) => s + 1)
    }
  }, [solTick, turnIncome, destinationId, rewardMission])

  const handleTileAction = (rIdx: number, cIdx: number, toolOverride?: ColonyTileType) => {
    const toolId = toolOverride ?? selectedTool
    const toolMeta = BLOCK_TOOLS.find((t) => t.id === toolId) ?? activeToolObj

    const res = placeColonyTile(destinationId, rIdx, cIdx, toolId, toolMeta.cost)
    if (res.message) {
      setStatusToast(res.message)
    } else if (res.ok) {
      const bonusNote =
        toolId === 'drill' && isOreTile(rIdx, cIdx)
          ? ' (💎 Zengin Cevher Damarı: 2x Gelir Bonusu Aktif!)'
          : ''
      setStatusToast(`✓ ${toolMeta.label} kuruldu (-${toolMeta.cost} cr)${bonusNote}`)
    }
  }

  const isRowValidForSelected = (rIdx: number): boolean => {
    if (selectedTool === 'solar' || selectedTool === 'greenhouse') return rIdx <= 2
    if (selectedTool === 'drill') return rIdx >= 2
    return true
  }

  const hasBlock = (rIdx: number, cIdx: number) =>
    (rIdx === 2 && cIdx === 1) || (grid[rIdx]?.[cIdx] ?? 'empty') !== 'empty'

  return (
    <div className="assembly-page">
      <header className="assembly-topbar">
        <button className="back-button" onClick={onBackHome}>
          ← <span>Ana Menü</span>
        </button>
        <a className="wordmark" href="#colony">
          <span className="wordmark-icon">✦</span>
          <span>SPACE ENGINEERS · 2D GEZEGEN KOLONİSİ</span>
        </a>
        <div className="topbar-right-pills">
          <button type="button" className="mini-nav-btn" onClick={onBackToAssembly}>
            🚀 Roket Hangarına Dön
          </button>
          <div className="budget-pill">
            <span>BÜTÇE · BİLİM</span>
            <b>
              {budgetCredits.toLocaleString('tr-TR')} cr · {sciencePoints} XP
            </b>
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
              🌕 AY KRATER ÜSSÜ (1.0 AU · %100 Güneş)
            </button>
            <button
              type="button"
              className={`target-pill ${destinationId === 'mars' ? 'active' : ''}`}
              onClick={() => setDestinationId('mars')}
            >
              🔴 MARS KANYON ÜSSÜ (1.52 AU · %43.3 Güneş)
            </button>
          </div>

          <div className="colony-meters">
            <div className={`colony-stat-pill ${isBlackout ? 'danger' : 'ok'}`}>
              <span>⚡ ENERJİ ({energyProduced}W / -{energyUsed}W)</span>
              <b>{isBlackout ? `ŞALTER İNDİ (${netEnergy}W)` : `+${netEnergy} W`}</b>
            </div>
            <div className="colony-stat-pill">
              <span>👨‍🚀 MÜRETTEBAT & O₂</span>
              <b style={{ color: oxygenCapacity >= colonists ? '#38D9E8' : '#FFAD57' }}>
                {colonists} Kişi · {oxygenCapacity} O₂ {hasLifeSupportBonus ? '(+%25)' : ''}
              </b>
            </div>
            <div className="colony-stat-pill">
              <span>⛏️ CEVHER SONDAJI</span>
              <b style={{ color: '#FFAD57' }}>{activeOreDrills} Aktif Damar</b>
            </div>
            <div className="colony-stat-pill">
              <span>💰 SOL #{solCount} GELİRİ</span>
              <b style={{ color: '#4ADE80' }}>+{turnIncome} cr/tur</b>
            </div>
            <button
              type="button"
              className="button button-primary harvest-btn"
              disabled={turnIncome <= 0}
              onClick={() => {
                rewardMission(turnIncome, 15, [], destinationId)
                setSolCount((s) => s + 1)
                setStatusToast(`⚡ Manuel hasat tamamlandı: +${turnIncome} cr ve +15 Bilim XP!`)
              }}
            >
              ⚡ Hasat Et (+{turnIncome} cr)
            </button>
          </div>
        </div>

        {/* Toast / Placement Guide Banner */}
        <div className={`colony-toast-bar ${isBlackout ? 'toast-danger' : ''}`}>
          <span>
            {isBlackout
              ? '🚨 UYARI: Tüketim üretimi aştı (Şalter İndi)! Yüzeye Güneş Paneli veya Nükleer RTG kurun.'
              : statusToast}
          </span>
          <div className="colony-toast-right">
            {budgetCredits < 60 && (
              <button type="button" className="inline-grant-btn" onClick={claimEmergencyGrant}>
                +500 cr NASA Acil Hibe
              </button>
            )}
            <span className="sol-timer-pill">SOL DÖNGÜSÜ: %{solProgress}</span>
          </div>
        </div>

        {/* Dynamic 2D Pixel Sandbox Grid (Terraria + Space Engineers Cross-Section) */}
        <section className={`pixel-sandbox-frame panel-card ${isBlackout ? 'frame-blackout' : ''}`}>
          <div className="sandbox-sky-label">
            <span>
              2D KESİT İNŞAAT ALANI — SEÇİLİ ARAÇ:{' '}
              <b style={{ color: activeToolObj.color }}>{activeToolObj.label}</b> ({activeToolObj.zoneHint})
            </span>
            <span>GÜNEŞ AKISI (1/r²): %{solarEff}</span>
          </div>

          <div className="pixel-grid-wrapper">
            {grid.map((row, rIdx) => {
              const isSky = rIdx <= 1
              const isSurface = rIdx === 2
              const rowValid = isRowValidForSelected(rIdx)
              return (
                <div
                  key={rIdx}
                  className={`pixel-grid-row ${
                    isSky ? 'row-sky' : isSurface ? 'row-surface' : 'row-underground'
                  } ${destinationId === 'mars' ? 'planet-mars' : 'planet-moon'} ${
                    rowValid ? 'row-buildable' : 'row-restricted'
                  }`}
                >
                  <div className="row-depth-tag">{ROW_LABELS[rIdx]}</div>
                  {row.map((cell, cIdx) => {
                    const hasOre = isOreTile(rIdx, cIdx)
                    const isLandedRocketSpot = rIdx === 2 && cIdx === 1
                    const activeHere = isLandedRocketSpot || cell !== 'empty'
                    const connRight = activeHere && cIdx < 9 && hasBlock(rIdx, cIdx + 1)
                    const connLeft = activeHere && cIdx > 0 && hasBlock(rIdx, cIdx - 1)
                    const connDown = activeHere && rIdx < 5 && hasBlock(rIdx + 1, cIdx)
                    const connUp = activeHere && rIdx > 0 && hasBlock(rIdx - 1, cIdx)

                    return (
                      <button
                        key={`${rIdx}-${cIdx}`}
                        type="button"
                        className={`pixel-tile tile-${cell} ${hasOre ? 'has-ore' : ''} ${
                          isLandedRocketSpot ? 'rocket-pad-tile' : ''
                        } ${!rowValid ? 'tile-restricted' : ''}`}
                        onClick={() => handleTileAction(rIdx, cIdx)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          handleTileAction(rIdx, cIdx, 'empty')
                        }}
                        title={`${ROW_LABELS[rIdx]} · Sütun ${cIdx + 1}${
                          hasOre ? ' (💎 Zengin Cevher Damarı - 2x Sondaj!)' : ''
                        }`}
                      >
                        {activeHere && (
                          <span
                            className="conduit-overlay"
                            aria-hidden="true"
                            style={
                              {
                                '--c-color': isBlackout ? '#FB7185' : '#38D9E8',
                              } as CSSProperties
                            }
                          >
                            {connRight && <i className="conn-r" />}
                            {connLeft && <i className="conn-l" />}
                            {connDown && <i className="conn-d" />}
                            {connUp && <i className="conn-u" />}
                          </span>
                        )}
                        {isLandedRocketSpot
                          ? renderLandedRocketSvg()
                          : renderPixelBlockSvg(cell, hasOre, isBlackout, rIdx, destinationId)}
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
                style={{ '--slot-color': tool.color } as CSSProperties}
                onClick={() => setSelectedTool(tool.id)}
              >
                <strong>{tool.label}</strong>
                <small>
                  {tool.cost > 0 ? `${tool.cost} cr` : 'Sağ Tık'} · {tool.zoneHint}
                </small>
                <small style={{ color: tool.color }}>
                  {tool.id === 'solar'
                    ? `+${Math.round((tool.powerOut * solarEff) / 100)}W Güç`
                    : tool.powerOut > 0
                      ? `+${tool.powerOut}W Sabit`
                      : tool.powerUse > 0
                        ? `-${tool.powerUse}W / +${tool.income}cr`
                        : tool.id === 'hull'
                          ? `+${tool.income}cr`
                          : 'Hurda İadesi'}
                </small>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

function renderLandedRocketSvg() {
  return (
    <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
      <rect x="2" y="28" width="28" height="3" fill="#38D9E8" />
      <rect x="7" y="22" width="3" height="6" fill="#94A3B8" />
      <rect x="22" y="22" width="3" height="6" fill="#94A3B8" />
      <rect x="10" y="8" width="12" height="16" fill="#E2E8F0" />
      <rect x="10" y="10" width="2" height="12" fill="#FFAD57" />
      <rect x="20" y="10" width="2" height="12" fill="#FFAD57" />
      <polygon points="16,2 10,8 22,8" fill="#FFAD57" />
      <rect x="14" y="12" width="4" height="4" fill="#38D9E8" />
      <rect x="13" y="24" width="6" height="4" fill="#475569" />
    </svg>
  )
}

function renderPixelBlockSvg(
  cell: ColonyTileType,
  hasOre: boolean,
  isBlackout: boolean,
  rIdx: number,
  planetId: 'moon' | 'mars',
) {
  if (cell === 'empty') {
    if (rIdx <= 1) {
      // Distant ambient pixel Earth/Phobos in top right corner sky tile or stars
      if (rIdx === 0) {
        return (
          <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
            <rect x="6" y="10" width="2" height="2" fill="#93C5FD" opacity="0.55" />
            <rect x="24" y="20" width="2" height="2" fill="#E2E8F0" opacity="0.45" />
          </svg>
        )
      }
      return null
    }
    if (!hasOre) {
      return rIdx >= 3 ? (
        <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
          <rect x="6" y="12" width="4" height="3" fill={planetId === 'mars' ? '#451A03' : '#1E293B'} />
          <rect x="20" y="22" width="5" height="3" fill={planetId === 'mars' ? '#451A03' : '#1E293B'} />
        </svg>
      ) : null
    }
    return (
      <svg viewBox="0 0 32 32" className="tile-svg ore-crystal" shapeRendering="crispEdges">
        <rect x="6" y="8" width="6" height="6" fill="#FACC15" />
        <rect x="18" y="14" width="7" height="7" fill="#38D9E8" />
        <rect x="10" y="21" width="5" height="5" fill="#F59E0B" />
      </svg>
    )
  }

  if (cell === 'hull') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="2" y="2" width="28" height="28" fill="#1E293B" stroke="#64748B" strokeWidth="2" />
        {rIdx >= 3 ? (
          <>
            <rect x="11" y="4" width="2" height="24" fill="#94A3B8" />
            <rect x="19" y="4" width="2" height="24" fill="#94A3B8" />
            <rect x="11" y="8" width="10" height="2" fill="#38D9E8" />
            <rect x="11" y="15" width="10" height="2" fill="#38D9E8" />
            <rect x="11" y="22" width="10" height="2" fill="#38D9E8" />
          </>
        ) : (
          <>
            <rect x="6" y="11" width="20" height="10" fill="#0F172A" />
            <rect x="8" y="13" width="16" height="6" fill="#38D9E8" />
          </>
        )}
      </svg>
    )
  }

  if (cell === 'solar') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="14" y="16" width="4" height="14" fill="#94A3B8" />
        <rect x="8" y="27" width="16" height="3" fill="#475569" />
        <rect x="2" y="5" width="28" height="11" fill="#0284C7" stroke="#38D9E8" strokeWidth="2" />
        <rect x="9" y="5" width="2" height="11" fill="#38D9E8" />
        <rect x="16" y="5" width="2" height="11" fill="#38D9E8" />
        <rect x="23" y="5" width="2" height="11" fill="#38D9E8" />
      </svg>
    )
  }

  if (cell === 'rtg') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect x="8" y="4" width="16" height="24" fill="#3B0764" stroke="#A855F7" strokeWidth="2" />
        <rect x="12" y="10" width="8" height="8" fill="#FACC15" />
        <rect x="3" y="7" width="5" height="4" fill="#94A3B8" />
        <rect x="3" y="14" width="5" height="4" fill="#94A3B8" />
        <rect x="3" y="21" width="5" height="4" fill="#94A3B8" />
        <rect x="24" y="7" width="5" height="4" fill="#94A3B8" />
        <rect x="24" y="14" width="5" height="4" fill="#94A3B8" />
        <rect x="24" y="21" width="5" height="4" fill="#94A3B8" />
      </svg>
    )
  }

  if (cell === 'greenhouse') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect
          x="2"
          y="6"
          width="28"
          height="24"
          fill="#064E3B"
          stroke={isBlackout ? '#FB7185' : '#4ADE80'}
          strokeWidth="2"
        />
        <rect x="4" y="24" width="24" height="4" fill="#78350F" />
        <rect x="6" y="16" width="5" height="8" fill="#4ADE80" />
        <rect x="13" y="12" width="6" height="12" fill="#22C55E" />
        <rect x="21" y="15" width="5" height="9" fill="#4ADE80" />
        <rect x="14" y="9" width="4" height="3" fill={isBlackout ? '#450A0A' : '#FACC15'} />
      </svg>
    )
  }

  if (cell === 'habitat') {
    return (
      <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
        <rect
          x="2"
          y="3"
          width="28"
          height="27"
          fill="#1E1B4B"
          stroke={isBlackout ? '#FB7185' : '#C4A7FF'}
          strokeWidth="2"
        />
        <rect x="5" y="7" width="8" height="6" fill={isBlackout ? '#450A0A' : '#38D9E8'} />
        <rect x="17" y="9" width="6" height="6" fill="#F8FAFC" />
        <rect x="18" y="10" width="4" height="3" fill="#38D9E8" />
        <rect x="16" y="15" width="8" height="9" fill="#FFAD57" />
        <rect x="16" y="24" width="3" height="4" fill="#94A3B8" />
        <rect x="21" y="24" width="3" height="4" fill="#94A3B8" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 32 32" className="tile-svg" shapeRendering="crispEdges">
      <rect
        x="5"
        y="2"
        width="22"
        height="12"
        fill="#7C2D12"
        stroke={isBlackout ? '#FB7185' : '#FFAD57'}
        strokeWidth="2"
      />
      <polygon points="10,14 22,14 16,26" fill="#94A3B8" />
      {!isBlackout && <rect x="14" y="24" width="4" height="7" fill={hasOre ? '#38D9E8' : '#FACC15'} />}
      {!isBlackout && hasOre && <rect x="9" y="27" width="14" height="3" fill="#FACC15" />}
    </svg>
  )
}
