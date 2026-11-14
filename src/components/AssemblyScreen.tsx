import {
  calculatePayloadEnergyOutput,
  evaluateColony,
  evaluateMission,
} from '../game/calculations'
import {
  AERODYNAMIC_FINS,
  FUEL_TANKS,
  LANDING_SYSTEMS,
  PAYLOADS,
  PLANETS,
  ROCKET_BODIES,
  ROCKET_ENGINES,
} from '../game/data'
import { getSelectedRocketParts, useGameStore } from '../game/store'
import { getPayloadIcon, RocketBlueprintVisualizer } from './RocketSprites'

export function AssemblyScreen() {
  const state = useGameStore()
  const parts = getSelectedRocketParts(state)
  const evaluation = evaluateMission(parts, parts.planet)
  const colonyOnTarget = state.colonies[parts.planet.id] ?? []
  const colonySummary = evaluateColony(parts.planet, colonyOnTarget)

  const canAfford = state.budgetCredits >= evaluation.totalCostCredits

  // TWR gauge needle percentage (0 to 100% mapped from TWR 0.0 to 2.4)
  const twrNeedlePercent = Math.min(98, Math.max(2, Math.round((evaluation.earthTWR / 2.4) * 100)))
  const deltaVPercent = Math.min(
    100,
    Math.round((evaluation.deltaVMps / Math.max(1, evaluation.requiredDeltaVMps)) * 100),
  )

  return (
    <section className="assembly-container" aria-label="Roket Montaj ve Görev Tasarım Ekranı">
      {/* 1. Target Planet Selector Bar */}
      <div className="planet-selector-bar">
        <div className="section-header-row">
          <div>
            <span className="eyebrow-tag">ADIM 1 · HEDEF GEZEGEN VE YÖRÜNGE SEÇİMİ</span>
            <h2>Hedef Gök Cismini Seçin</h2>
          </div>
          <div className="preset-bar">
            <span className="preset-label">Hızlı Senaryo Yükle:</span>
            <button type="button" className="chip-btn" onClick={() => state.applyPreset('MOON_READY')}>
              🌕 Ay Optimal
            </button>
            <button type="button" className="chip-btn" onClick={() => state.applyPreset('MARS_READY')}>
              🔴 Mars Optimal
            </button>
            <button
              type="button"
              className="chip-btn chip-warn"
              onClick={() => state.applyPreset('LOW_TWR_DEMO')}
              title="TWR < 1.0 olduğunda rampada kalma ve %15 yakıt cezası deneyimi"
            >
              ⚠️ Test: Düşük TWR (&lt;1.0)
            </button>
            <button
              type="button"
              className="chip-btn chip-warn"
              onClick={() => state.applyPreset('SPIN_DEMO')}
              title="Kanatçık olmadığında CoM/CoP dengesizliği ve 5. saniyede takla deneyimi"
            >
              ⚠️ Test: CoM/CoP Takla
            </button>
            <button
              type="button"
              className="chip-btn chip-warn"
              onClick={() => state.applyPreset('VACUUM_PARACHUTE_DEMO')}
              title="Ay'da atmosfer olmadığı için paraşütün açılmaması deneyimi"
            >
              ⚠️ Test: Ay’da Paraşüt
            </button>
          </div>
        </div>

        <div className="planet-cards-grid">
          {PLANETS.map((planet) => {
            const isSelected = planet.id === state.selectedPlanetId
            const solarEff = Math.round((100 / ((planet.distanceAU ?? 1) ** 2)) * 10) / 10
            const modCount = (state.colonies[planet.id] ?? []).length
            return (
              <button
                key={planet.id}
                type="button"
                className={`planet-card ${isSelected ? 'selected' : ''}`}
                style={{ '--planet-accent': planet.themeColor } as React.CSSProperties}
                onClick={() => state.selectPlanet(planet.id)}
              >
                <div className="planet-card-top">
                  <span className="planet-dot" style={{ background: planet.themeColor }} />
                  <strong>{planet.name}</strong>
                  {modCount > 0 && <span className="planet-colony-tag">{modCount} Modül</span>}
                </div>
                <p className="planet-subtitle">{planet.subtitle}</p>
                <div className="planet-metrics">
                  <span>Yerçekimi: <b>{planet.gravityMps2} m/s²</b></span>
                  <span>Güneş (1/r²): <b>%{solarEff}</b></span>
                  <span>Gerekli Δv: <b>{planet.requiredDeltaVMps} m/s</b></span>
                  <span>Ödül: <b style={{ color: '#4ADE80' }}>+{planet.baseRewardCredits} ₡</b></span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. Main 3-Column VAB Engineering Grid */}
      <div className="vab-grid">
        {/* LEFT COLUMN: Structural, Engine, Fuel, Fin & Landing Selectors */}
        <div className="vab-panel vab-parts-col">
          <div className="part-group">
            <h3>1. Roket Gövdesi (Kargo Kapasitesi)</h3>
            <div className="part-list">
              {ROCKET_BODIES.map((body) => {
                const unlocked = state.unlockedIds.includes(body.id)
                const active = state.selectedBodyId === body.id
                return (
                  <button
                    key={body.id}
                    type="button"
                    className={`part-item ${active ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                    onClick={() => (unlocked ? state.selectBody(body.id) : state.setActiveModal('TECH_TREE'))}
                  >
                    <div className="part-item-head">
                      <strong>{body.name}</strong>
                      <span className="part-price">
                        {unlocked ? `${body.costCredits} ₡` : `🔒 ${body.unlockScienceCost} XP`}
                      </span>
                    </div>
                    <div className="part-specs">
                      <span>📦 {body.cargoSlots} Yuva</span>
                      <span>⚖️ Kuru: {body.dryMassKg} kg</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="part-group">
            <h3>2. Ana İtki Motoru (F_itki ve Isp)</h3>
            <div className="part-list">
              {ROCKET_ENGINES.map((engine) => {
                const unlocked = state.unlockedIds.includes(engine.id)
                const active = state.selectedEngineId === engine.id
                return (
                  <button
                    key={engine.id}
                    type="button"
                    className={`part-item ${active ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                    onClick={() => (unlocked ? state.selectEngine(engine.id) : state.setActiveModal('TECH_TREE'))}
                  >
                    <div className="part-item-head">
                      <strong>{engine.name}</strong>
                      <span className="part-price">
                        {unlocked ? `${engine.costCredits} ₡` : `🔒 ${engine.unlockScienceCost} XP`}
                      </span>
                    </div>
                    <div className="part-specs">
                      <span>🔥 {(engine.thrustN / 1000).toFixed(0)} kN İtki</span>
                      <span>⚡ Isp: {engine.ispSeconds} s</span>
                      <span>⚖️ {engine.dryMassKg} kg</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="part-group">
            <h3>3. Yakıt Tankı (Tsiolkovsky Kütle Oranı)</h3>
            <div className="part-list">
              {FUEL_TANKS.map((tank) => {
                const unlocked = state.unlockedIds.includes(tank.id)
                const active = state.selectedTankId === tank.id
                return (
                  <button
                    key={tank.id}
                    type="button"
                    className={`part-item ${active ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                    onClick={() => (unlocked ? state.selectTank(tank.id) : state.setActiveModal('TECH_TREE'))}
                  >
                    <div className="part-item-head">
                      <strong>{tank.name}</strong>
                      <span className="part-price">
                        {unlocked ? `${tank.costCredits} ₡` : `🔒 ${tank.unlockScienceCost} XP`}
                      </span>
                    </div>
                    <div className="part-specs">
                      <span>⛽ Yakıt: {tank.fuelMassKg} kg</span>
                      <span>⚖️ Kuru: {tank.dryMassKg} kg</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="part-group">
            <h3>4. Aerodinamik Kanatçık (CoM / CoP Dengesi)</h3>
            <div className="part-list">
              {AERODYNAMIC_FINS.map((fin) => {
                const active = state.selectedFinId === fin.id
                return (
                  <button
                    key={fin.id}
                    type="button"
                    className={`part-item ${active ? 'active' : ''}`}
                    onClick={() => state.selectFin(fin.id)}
                  >
                    <div className="part-item-head">
                      <strong>{fin.name}</strong>
                      <span className="part-price">{fin.costCredits} ₡</span>
                    </div>
                    <div className="part-specs">
                      <span>▲ CoP Kaydırma: +{fin.copShiftDown}</span>
                      <span>⚖️ {fin.dryMassKg} kg</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="part-group">
            <h3>5. Atmosfer ve Yüzey İniş Sistemi (EDL)</h3>
            <div className="part-list">
              {LANDING_SYSTEMS.map((landing) => {
                const active = state.selectedLandingId === landing.id
                return (
                  <button
                    key={landing.id}
                    type="button"
                    className={`part-item ${active ? 'active' : ''}`}
                    onClick={() => state.selectLanding(landing.id)}
                  >
                    <div className="part-item-head">
                      <strong>{landing.name}</strong>
                      <span className="part-price">{landing.costCredits} ₡</span>
                    </div>
                    <p className="part-desc">{landing.description}</p>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: Live Blueprint + Cargo Slot Manager */}
        <div className="vab-panel vab-center-col">
          <RocketBlueprintVisualizer
            body={parts.body}
            engine={parts.engine}
            fuelTank={parts.fuelTank}
            fin={parts.fin}
            landingSystem={parts.landingSystem}
            payloads={parts.payloads}
            stability={evaluation.stability}
          />

          {/* Cargo Slots & Payload Catalog */}
          <div className="cargo-manager-box">
            <div className="cargo-header">
              <h3>
                Kargo Yuvaları ({parts.payloads.length} / {parts.body.cargoSlots} Dolu)
              </h3>
              {parts.payloads.length > 0 && (
                <button type="button" className="text-btn" onClick={state.clearPayloads}>
                  Tümünü Boşalt
                </button>
              )}
            </div>

            <div className="installed-slots-row">
              {Array.from({ length: parts.body.cargoSlots }, (_, idx) => {
                const item = parts.payloads[idx]
                return (
                  <div key={idx} className={`cargo-slot-pill ${item ? 'filled' : 'empty'}`}>
                    {item ? (
                      <>
                        <span>
                          {getPayloadIcon(item.id)} {item.name} ({item.massKg} kg)
                        </span>
                        <button
                          type="button"
                          className="slot-remove-btn"
                          onClick={() => state.removePayloadAt(idx)}
                          aria-label={`${item.name} yükünü çıkar`}
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <span>Yuva #{idx + 1} Boş — Aşağıdan Modül Ekleyin</span>
                    )}
                  </div>
                )
              })}
            </div>

            <h4>Yüklenebilir Koloni ve Görev Modülleri ({parts.planet.name} Verimiyle)</h4>
            <div className="payload-catalog-grid">
              {PAYLOADS.map((payload) => {
                const unlocked = state.unlockedIds.includes(payload.id)
                const slotsFull = parts.payloads.length >= parts.body.cargoSlots
                const energyAtTarget = calculatePayloadEnergyOutput(payload, parts.planet)
                return (
                  <button
                    key={payload.id}
                    type="button"
                    className={`payload-card ${!unlocked ? 'locked' : ''}`}
                    disabled={unlocked && slotsFull}
                    onClick={() => (unlocked ? state.addPayload(payload.id) : state.setActiveModal('TECH_TREE'))}
                  >
                    <div className="payload-card-top">
                      <span>
                        {getPayloadIcon(payload.id)} <strong>{payload.name}</strong>
                      </span>
                      <span className="part-price">
                        {unlocked ? `+${payload.costCredits} ₡` : `🔒 ${payload.unlockScienceCost} XP`}
                      </span>
                    </div>
                    <div className="payload-stats">
                      <span>⚖️ {payload.massKg} kg</span>
                      {energyAtTarget > 0 && (
                        <span style={{ color: '#4ADE80' }}>⚡ +{energyAtTarget} Enerji</span>
                      )}
                      {(payload.energyConsumption ?? 0) > 0 && (
                        <span style={{ color: '#FFAD57' }}>🔌 -{payload.energyConsumption} Enerji</span>
                      )}
                      {(payload.incomeCreditsPerTurn ?? 0) > 0 && (
                        <span style={{ color: '#38D9E8' }}>💰 +{payload.incomeCreditsPerTurn} ₡/tur</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Live Physics Gauges, Planet Briefing & Launch Control */}
        <div className="vab-panel vab-telemetry-col">
          {/* 1. LIVE TWR GAUGE (Kalkış Gücü İbresi) */}
          <div className="telemetry-card">
            <div className="telemetry-head">
              <span>CANLI KALKIŞ GÜCÜ (TWR)</span>
              <strong
                className={`twr-badge twr-${evaluation.twrStatus.toLowerCase()}`}
              >
                TWR: {evaluation.earthTWR.toFixed(2)} ·{' '}
                {evaluation.twrStatus === 'RED'
                  ? 'KALKAMAZ (<1.0)'
                  : evaluation.twrStatus === 'YELLOW'
                    ? 'RİSKLİ / YAVAŞ (1.0–1.19)'
                    : 'GÜVENLİ KALKIŞ (≥1.2)'}
              </strong>
            </div>

            <div className="twr-meter-track" aria-label="TWR Renkli Gösterge Çubuğu">
              <div className="twr-zone twr-zone-red">1.0 Altı: Kalkamaz</div>
              <div className="twr-zone twr-zone-yellow">1.0–1.2: Riskli</div>
              <div className="twr-zone twr-zone-green">1.2+: Güvenli</div>
              <div
                className="twr-needle"
                style={{ left: `${twrNeedlePercent}%` }}
                title={`Anlık TWR: ${evaluation.earthTWR}`}
              />
            </div>

            <p className="telemetry-hint">
              Dünya yerçekimi ivmesi <b>9.81 m/s²</b>’dir. Toplam Kütle: <b>{evaluation.totalMassKg.toLocaleString('tr-TR')} kg</b>{' '}
              (Kuru: {evaluation.dryMassKg} kg + Yakıt: {evaluation.fuelMassKg} kg).
            </p>
          </div>

          {/* 2. DELTA-V RANGE BAR (Tsiolkovsky Menzil) */}
          <div className="telemetry-card">
            <div className="telemetry-head">
              <span>MENZİL / HIZ DEĞİŞİMİ (DELTA-V)</span>
              <strong style={{ color: evaluation.deltaVMps >= evaluation.requiredDeltaVMps ? '#4ADE80' : '#FB7185' }}>
                {evaluation.deltaVMps} / {evaluation.requiredDeltaVMps} m/s
              </strong>
            </div>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${deltaVPercent}%`,
                  background: evaluation.deltaVMps >= evaluation.requiredDeltaVMps ? '#4ADE80' : '#FB7185',
                }}
              />
            </div>
            <p className="telemetry-hint">
              {evaluation.deltaVMps >= evaluation.requiredDeltaVMps
                ? `✓ ${parts.planet.name} transfer yörüngesi için yeterli hız değişimi (Δv) mevcut.`
                : `⚠ ${parts.planet.name} için ${evaluation.requiredDeltaVMps - evaluation.deltaVMps} m/s daha Δv gerekiyor! Aksi halde yakıt transfer yörüngesinde biter.`}
            </p>
          </div>

          {/* 3. TARGET PLANET ATMOSPHERE, LANDING & 1/r² ENERGY */}
          <div className="telemetry-card">
            <div className="telemetry-head">
              <span>HEDEF GEZEGEN MÜHENDİSLİK ANALİZİ</span>
              <strong style={{ color: parts.planet.themeColor }}>{parts.planet.name}</strong>
            </div>
            <p className="planet-desc-box">{parts.planet.description}</p>
            <ul className="engineering-checklist">
              <li>
                <span>Güneş Işınımı (1/r²):</span>
                <b>%{evaluation.solarEfficiencyPercent} Verim ({parts.planet.distanceAU} AU)</b>
              </li>
              <li>
                <span>Hedef İniş TWR ({parts.planet.gravityMps2} m/s²):</span>
                <b>{evaluation.targetLandingTWR.toFixed(2)}</b>
              </li>
              <li>
                <span>Kargo Net Enerji Etkisi:</span>
                <b style={{ color: evaluation.payloadNetEnergyAtTarget >= 0 ? '#4ADE80' : '#FB7185' }}>
                  {evaluation.payloadNetEnergyAtTarget >= 0 ? `+${evaluation.payloadNetEnergyAtTarget}` : evaluation.payloadNetEnergyAtTarget} birim
                </b>
              </li>
              <li>
                <span>Mevcut Koloni Net Enerjisi:</span>
                <b style={{ color: colonySummary.isBlackout ? '#FB7185' : '#38D9E8' }}>
                  {colonySummary.netEnergy} birim ({colonySummary.moduleCount} modül)
                </b>
              </li>
            </ul>
            <div className="nasa-citation-tag">{parts.planet.nasaCitation}</div>
          </div>

          {/* 4. COST & LAUNCH CONTROL */}
          <div className="launch-control-box">
            <div className="cost-breakdown">
              <div>
                <span>Toplam Üretim Maliyeti:</span>
                <strong>{evaluation.totalCostCredits} ₡</strong>
              </div>
              <div>
                <span>Rampada İptal / Kalkamama Cezası (%15 Yakıt):</span>
                <strong style={{ color: '#FFAD57' }}>{evaluation.padAbortCostCredits} ₡</strong>
              </div>
              <div>
                <span>Görev Başarı Ödülü:</span>
                <strong style={{ color: '#4ADE80' }}>
                  +{(parts.planet.baseRewardCredits ?? 400) + parts.payloads.reduce((s, p) => s + Math.round(p.costCredits * 0.55), 0)} ₡
                </strong>
              </div>
            </div>

            {!canAfford && (
              <div className="softlock-alert">
                <p>
                  Bütçeniz ({state.budgetCredits} ₡) bu roketin üretim maliyetinden ({evaluation.totalCostCredits} ₡) düşük!
                </p>
                <button type="button" className="grant-btn-full" onClick={state.claimEmergencyGrant}>
                  🆘 NASA Acil Araştırma Fonu Al (+450 ₡ ve LEO Uydu Görevi)
                </button>
              </div>
            )}

            <button
              type="button"
              className="launch-button"
              disabled={!canAfford}
              onClick={state.startLaunchSimulation}
            >
              🚀 FIRLATMA RAMPASINA GEÇ VE ATEŞLE
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
