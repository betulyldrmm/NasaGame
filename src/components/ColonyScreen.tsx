import { useState } from 'react'
import { calculatePayloadEnergyOutput, evaluateColony } from '../game/calculations'
import { PAYLOADS, PLANETS } from '../game/data'
import { useGameStore } from '../game/store'
import type { ColonyLayer } from '../game/types'
import { getPayloadIcon } from './RocketSprites'

const LAYER_META: { key: ColonyLayer; title: string; subtitle: string; depthLabel: string }[] = [
  {
    key: 'SURFACE_ARRAY',
    title: 'YÜZEY ENERJİ VE RÖLE HATTI',
    subtitle: 'Güneş Panelleri (1/r²), Nükleer RTG Jeneratörleri ve Yörünge/Yüzey Antenleri',
    depthLabel: 'RAKIM: 0m (YÜZEY)',
  },
  {
    key: 'UPPER_HABITAT',
    title: 'ÜST BİYOKUBBE VE TARLA KATI',
    subtitle: 'Basınçlı Hidroponik Sera Modülleri ve Oksijen Üretim Kubbeleri',
    depthLabel: 'DERİNLİK: -5m',
  },
  {
    key: 'LOWER_LAB',
    title: 'KOMUTA, LABORATUVAR VE YAŞAM KATI',
    subtitle: 'Astronot Yaşam Odaları, Telemetri Merkezi ve Bilim Laboratuvarları',
    depthLabel: 'DERİNLİK: -15m',
  },
  {
    key: 'UNDERGROUND_MINE',
    title: 'YERALTI MADEN VE ENERJİ GALERİSİ',
    subtitle: 'Otonom Maden Araçları, Sondaj Kuleleri ve Regolit/Buzul Cevher İşleme',
    depthLabel: 'DERİNLİK: -30m',
  },
]

export function ColonyScreen() {
  const {
    selectedPlanetId,
    selectPlanet,
    colonies,
    setScreen,
    advanceColonyTurn,
    removeColonyModule,
  } = useGameStore()

  const [lastHarvestMsg, setLastHarvestMsg] = useState<string | null>(null)

  const planet = PLANETS.find((p) => p.id === selectedPlanetId) ?? PLANETS[1]!
  const modules = colonies[planet.id] ?? []
  const summary = evaluateColony(planet, modules)

  const handleHarvest = () => {
    const res = advanceColonyTurn()
    if (res.totalCredits === 0 && res.totalScience === 0) {
      setLastHarvestMsg('Aktif ve pozitif enerjili koloni modülü bulunmadığı için bu tur gelir üretilmedi.')
    } else {
      setLastHarvestMsg(`Görev Turu İlerletildi: Tüm kolonilerden +${res.totalCredits} ₡ Kredi ve +${res.totalScience} Bilim XP toplandı!`)
    }
  }

  return (
    <section className="colony-container" aria-label="2D Kesit Gezegen Koloni Üssü">
      <div className="colony-header-bar">
        <div>
          <span className="eyebrow-tag">2D YERALTI VE YÜZEY KESİT ÜSSÜ · TERRARIA STİLİ MODÜLER KOLONİ</span>
          <h2>{planet.name} Koloni Üssü ve Enerji Şebekesi</h2>
        </div>

        <div className="colony-header-actions">
          <button type="button" className="button button-secondary" onClick={handleHarvest}>
            ⏳ Koloni Üretim Turu İlerlet (Gelir Topla)
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setScreen('ASSEMBLY')}
          >
            🚀 {planet.name} İçin Yeni Kargo Roketi Tasarla
          </button>
        </div>
      </div>

      {lastHarvestMsg && <div className="harvest-toast">{lastHarvestMsg}</div>}

      {/* Planet Switcher Tabs */}
      <div className="planet-cards-grid">
        {PLANETS.map((p) => {
          const pMods = colonies[p.id] ?? []
          const pSum = evaluateColony(p, pMods)
          return (
            <button
              key={p.id}
              type="button"
              className={`planet-card ${p.id === planet.id ? 'selected' : ''}`}
              style={{ '--planet-accent': p.themeColor } as React.CSSProperties}
              onClick={() => selectPlanet(p.id)}
            >
              <div className="planet-card-top">
                <span className="planet-dot" style={{ background: p.themeColor }} />
                <strong>{p.name}</strong>
                <span className={`planet-colony-tag ${pSum.isBlackout ? 'tag-blackout' : ''}`}>
                  {pSum.isBlackout ? '⚡ ŞALTER İNDİ!' : `${pMods.length} Modül`}
                </span>
              </div>
              <div className="planet-metrics">
                <span>Güneş (1/r²): <b>%{pSum.solarEfficiencyPercent}</b></span>
                <span>Net Enerji: <b style={{ color: pSum.netEnergy >= 0 ? '#4ADE80' : '#FB7185' }}>{pSum.netEnergy}</b></span>
                <span>Gelir: <b>+{pSum.incomeCreditsPerTurn} ₡/tur</b></span>
                <span>Bilim: <b>+{pSum.sciencePerTurn} XP/tur</b></span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Blackout Alert Banner if Net Energy < 0 */}
      {summary.isBlackout && (
        <div className="blackout-banner" role="alert">
          <strong>⚡ KOLONİ ŞALTER İNDİRDİ (BLACKOUT — NET ENERJİ: {summary.netEnergy}):</strong> {planet.name}{' '}
          üzerindeki üretim modüllerinin enerji tüketimi ({summary.energyConsumed} birim), üretilen elektriği ({summary.energyProduced} birim) aştı!
          {planet.id === 'europa'
            ? ' Europa Güneş’ten 5.2 AU uzakta olduğu için Güneş Paneli yalnızca %3.7 (3.7 birim) elektrik üretir! Ar-Ge’den Nükleer Jeneratör (RTG) açıp göndermelisiniz.'
            : ' Gelir döngüsünü yeniden başlatmak için bu gezegene Güneş Paneli veya Nükleer Jeneratör (RTG) indirin ya da fazla modülü kapatın.'}
        </div>
      )}

      {/* Colony Dashboard + 2D Cross-Section Cutaway Grid */}
      <div className="colony-main-grid">
        {/* Left: 2D Multi-Story Cross-Section Cutaway (Inspired by Reference Photo 2) */}
        <div className={`colony-cutaway-board ${summary.isBlackout ? 'board-blackout' : ''}`}>
          <div
            className="colony-sky-banner"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(8,15,32,0.55) 0%, rgba(8,15,32,0.92) 100%), url('/assets/colony-cross-section.jpg')`,
            }}
          >
            <div className="sky-banner-info">
              <span className="sky-badge">{planet.subtitle}</span>
              <h3>{planet.name} — 2D Yüzey ve Yeraltı Koloni Kesiti</h3>
              <p>
                Başarılı uçuşlarla indirdiğiniz her Güneş Paneli, RTG, Sera, Yaşam Modülü ve Maden Aracı ilgili yeraltı/yüzey katına otomatik yerleşir.
              </p>
            </div>
          </div>

          <div className="cutaway-floors">
            {LAYER_META.map((layer) => {
              const layerModules = modules.filter((m) => m.layer === layer.key)
              return (
                <div key={layer.key} className={`cutaway-floor floor-${layer.key.toLowerCase()}`}>
                  <div className="floor-header">
                    <div>
                      <span className="depth-badge">{layer.depthLabel}</span>
                      <strong>{layer.title}</strong>
                    </div>
                    <span className="floor-subtitle">{layer.subtitle}</span>
                  </div>

                  <div className="floor-rooms-row">
                    {layerModules.map((mod) => {
                      const spec = PAYLOADS.find((p) => p.id === mod.payloadId)
                      const powerOut = spec ? calculatePayloadEnergyOutput(spec, planet) : 0
                      const powerIn = spec?.energyConsumption ?? 0
                      return (
                        <div
                          key={mod.instanceId}
                          className={`colony-room-tile ${summary.isBlackout && powerIn > 0 ? 'tile-offline' : 'tile-online'}`}
                        >
                          <div className="room-tile-top">
                            <span className="room-icon">{getPayloadIcon(mod.payloadId)}</span>
                            <strong>{mod.name}</strong>
                            <button
                              type="button"
                              className="room-remove-btn"
                              title="Modülü sök / devre dışı bırak"
                              onClick={() => removeColonyModule(planet.id, mod.instanceId)}
                            >
                              ×
                            </button>
                          </div>
                          <div className="room-tile-stats">
                            {powerOut > 0 && <span style={{ color: '#4ADE80' }}>⚡ +{powerOut} Enerji</span>}
                            {powerIn > 0 && <span style={{ color: '#FFAD57' }}>🔌 -{powerIn} Enerji</span>}
                            {(spec?.incomeCreditsPerTurn ?? 0) > 0 && (
                              <span style={{ color: '#38D9E8' }}>
                                💰 {summary.isBlackout ? '0 (Kesinti)' : `+${spec?.incomeCreditsPerTurn} ₡/tur`}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Empty expansion slots */}
                    {Array.from({ length: Math.max(1, 3 - layerModules.length) }, (_, idx) => (
                      <button
                        key={`empty-${idx}`}
                        type="button"
                        className="colony-room-empty"
                        onClick={() => setScreen('ASSEMBLY')}
                      >
                        <span>＋ Boş Koloni Odası</span>
                        <small>Roketle yeni modül indirin</small>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: Planetary Energy Physics & Colony Ledger */}
        <aside className="colony-sidebar">
          <div className="telemetry-card">
            <h3>⚡ Enerji Bilançosu (1/r² Yasası)</h3>
            <div className="colony-stat-list">
              <div>
                <span>Güneş’e Uzaklık (r):</span>
                <b>{planet.distanceAU} AU</b>
              </div>
              <div>
                <span>Güneş Paneli Verimi (1/r²):</span>
                <b style={{ color: summary.solarEfficiencyPercent < 20 ? '#FB7185' : '#38D9E8' }}>
                  %{summary.solarEfficiencyPercent} ({summary.solarEfficiencyPercent} birim / panel)
                </b>
              </div>
              <div>
                <span>Toplam Üretilen Enerji:</span>
                <b style={{ color: '#4ADE80' }}>+{summary.energyProduced} birim</b>
              </div>
              <div>
                <span>Toplam Tüketilen Enerji:</span>
                <b style={{ color: '#FFAD57' }}>-{summary.energyConsumed} birim</b>
              </div>
              <div className="stat-divider" />
              <div>
                <span>NET ENERJİ:</span>
                <strong style={{ color: summary.netEnergy >= 0 ? '#4ADE80' : '#FB7185' }}>
                  {summary.netEnergy >= 0 ? `+${summary.netEnergy}` : summary.netEnergy} birim
                </strong>
              </div>
            </div>
          </div>

          <div className="telemetry-card">
            <h3>💰 Tur Başına Koloni Geliri</h3>
            <div className="colony-stat-list">
              <div>
                <span>Şebeke Durumu:</span>
                <b style={{ color: summary.isBlackout ? '#FB7185' : '#4ADE80' }}>
                  {summary.isBlackout ? 'ŞALTER İNDİ (BLACKOUT)' : 'AKTİF ÇALIŞIYOR'}
                </b>
              </div>
              <div>
                <span>Tur Başına Kredi:</span>
                <b style={{ color: '#4ADE80' }}>+{summary.incomeCreditsPerTurn} ₡ / tur</b>
              </div>
              <div>
                <span>Tur Başına Telemetri Bilim:</span>
                <b style={{ color: '#38D9E8' }}>+{summary.sciencePerTurn} XP / tur</b>
              </div>
            </div>
            <p className="telemetry-hint">
              Gezegene başarıyla inen her Maden Aracı ve Tarla (Biyo-Kubbe), net enerji pozitifse (Net Enerji ≥ 0) her
              görev turunda düzenli Kredi ve Araştırma Puanı üretir.
            </p>
          </div>

          <div className="telemetry-card">
            <h3>📡 NASA Gezegen Referansı</h3>
            <p className="telemetry-hint">{planet.description}</p>
            <div className="nasa-citation-tag">{planet.nasaCitation}</div>
          </div>
        </aside>
      </div>
    </section>
  )
}
