import { useMemo, useState } from 'react'
import {
  isQuadrantColonized,
  MODULE_BY_ID,
  MODULES,
  QUADRANT_SHORT,
  QUADRANTS,
  quadrantOfAngle,
  type QuadrantId,
} from '../game/base'
import { PAD_DRONE_SPECS, partDef } from '../game/data'
import { isModuleUnlocked } from '../game/tech'
import { runCommand } from '../game/store'
import type { GameCommand, GameState, Vessel } from '../game/types'
import { cargoMass, modulesMass, partAlive, vesselStats } from '../game/vessel'
import { lang, T } from '../i18n'
import { BODIES, solarFlux, type BodyId } from '../nasa/bodies'
import { isWarfareMode } from '../flight/combat'
import { bodyAbsState, len } from '../flight/orbit'
import { availableLaunchSites, canTransferCargoBetween, getActorBase, type Sim } from '../flight/world'

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const imgUrl = (id: string) => `/assets/colony/${MODULE_BY_ID[id]?.sprite ?? 'battery'}.png`

interface Props {
  gs: GameState
  curSim: Sim
  myActor: string
  active: Vessel | null
  initialSite?: { bodyId: BodyId; quadrant: QuadrantId } | null
  onClose: () => void
  onSwitch: (vesselId: number) => void
  onToast: (text: string, kind?: 'info' | 'warn') => void
  onRefresh: () => void
}

type DroneTab = 'pad' | 'bay' | 'active'

export default function DroneWindow({
  gs,
  curSim,
  myActor,
  active,
  initialSite,
  onClose,
  onSwitch,
  onToast,
  onRefresh,
}: Props) {
  const warfare = isWarfareMode(gs)
  const W = (tr: string, en: string) => (lang === 'en' ? en : tr)
  const modName = (id: string) => {
    const n = MODULE_BY_ID[id]?.name ?? id
    return lang === 'en' ? T(n) : n
  }
  const bodyName = (id: BodyId) => (lang === 'en' ? T(BODIES[id].name) : BODIES[id].name)

  const launchSites = useMemo(() => availableLaunchSites(gs, myActor), [gs, myActor])
  const myVessels = useMemo(
    () => curSim.gs.vessels.filter((o) => !o.debris && !o.station && !o.outpost && (!gs.mp || o.ownerId === myActor)),
    [curSim.gs.vessels, gs.mp, myActor],
  )
  const myDrones = useMemo(() => myVessels.filter((o) => Boolean(o.drone)), [myVessels])
  const bayCarriers = useMemo(
    () =>
      myVessels.filter((o) => !o.drone && o.parts.some((p) => partAlive(p) && partDef(p.def).kind === 'droneBay')),
    [myVessels],
  )

  const defaultTab: DroneTab = initialSite
    ? 'pad'
    : active?.drone
      ? 'active'
      : bayCarriers.some((c) => c.parts.some((p) => partAlive(p) && partDef(p.def).kind === 'droneBay' && (p.ammo ?? 1) > 0))
        ? 'bay'
        : myDrones.length > 0
          ? 'active'
          : 'pad'

  const [tab, setTab] = useState<DroneTab>(defaultTab)
  const [siteKey, setSiteKey] = useState<string>(() => {
    if (initialSite) return `${initialSite.bodyId}:${initialSite.quadrant}`
    const ls = gs.launchSite
    return ls ? `${ls.bodyId}:${ls.quadrant}` : 'earth:0'
  })
  const [padTier, setPadTier] = useState<1 | 2 | 3>(2)
  const [padMods, setPadMods] = useState<Record<string, number>>({})
  const [carrierId, setCarrierId] = useState<number>(() => {
    if (active && !active.drone && active.parts.some((p) => partDef(p.def).kind === 'droneBay')) return active.id
    return bayCarriers[0]?.id ?? 0
  })

  const exec = (cmd: GameCommand, okMsg?: string): boolean => {
    const res = runCommand(cmd)
    if (res.error) {
      onToast(res.error, 'warn')
      onRefresh()
      return false
    }
    if (okMsg) onToast(okMsg)
    onRefresh()
    return true
  }

  const modList = useMemo(
    () => MODULES.filter((m) => (!m.warfare || warfare) && isModuleUnlocked(gs, m.id)),
    [gs, warfare],
  )

  // ── Sekme 1: Rampadan Dron Fırlatma ──
  const activeSite = launchSites.find((s) => `${s.bodyId}:${s.quadrant}` === siteKey) ?? launchSites[0]
  const padSpec = PAD_DRONE_SPECS[padTier]
  const padSiteBase = activeSite ? getActorBase(gs, activeSite.bodyId, myActor, activeSite.quadrant) : undefined
  const padIsHomeEarth = activeSite ? activeSite.bodyId === 'earth' && activeSite.quadrant === 0 : true
  const padUsed = modulesMass(padMods)
  const padCost = useMemo(() => {
    let total = padSpec.cost
    for (const [mid, n] of Object.entries(padMods)) {
      if (n <= 0) continue
      const fromStock = !padIsHomeEarth ? Math.min(n, padSiteBase?.stock?.[mid] ?? 0) : 0
      total += (n - fromStock) * (MODULE_BY_ID[mid]?.cost ?? 0)
    }
    return total
  }, [padSpec.cost, padMods, padIsHomeEarth, padSiteBase])

  const stepPadMod = (id: string, delta: number) => {
    const m = MODULE_BY_ID[id]
    if (!m) return
    const cur = padMods[id] ?? 0
    if (delta > 0 && padUsed + m.mass > padSpec.cargoCap + 1e-9) {
      onToast(W(`Dron kapasitesi dolu (${padSpec.cargoCap} t).`, `Drone bay full (${padSpec.cargoCap} t max).`), 'warn')
      return
    }
    const nextN = Math.max(0, cur + delta)
    const next = { ...padMods }
    if (nextN > 0) next[id] = nextN
    else delete next[id]
    setPadMods(next)
  }

  const selectPadTier = (tier: 1 | 2 | 3) => {
    setPadTier(tier)
    const cap = PAD_DRONE_SPECS[tier].cargoCap
    if (modulesMass(padMods) > cap + 1e-9) {
      // Yeni kapasiteye sığmayanları kırp
      const trimmed: Record<string, number> = {}
      let used = 0
      for (const [id, n] of Object.entries(padMods)) {
        const m = MODULE_BY_ID[id]?.mass ?? 1
        for (let k = 0; k < n; k += 1) {
          if (used + m <= cap + 1e-9) {
            trimmed[id] = (trimmed[id] ?? 0) + 1
            used += m
          }
        }
      }
      setPadMods(trimmed)
    }
  }

  // ── Sekme 2: Gemi Dron Hangarı ──
  const carrier = bayCarriers.find((c) => c.id === carrierId) ?? bayCarriers[0] ?? null
  const bayIdx = carrier ? carrier.parts.findIndex((p) => partAlive(p) && partDef(p.def).kind === 'droneBay') : -1
  const bayPart = carrier && bayIdx >= 0 ? carrier.parts[bayIdx] : undefined
  const baySpec = bayPart ? partDef(bayPart.def).droneSpec : undefined
  const bayReady = Boolean(bayPart && baySpec && (bayPart.ammo ?? baySpec.ammo) > 0)
  const bayCd = Math.max(0, bayPart?.cd ?? 0)
  const bayCargo = bayPart?.droneCargo ?? {}
  const bayUsed = modulesMass(bayCargo)
  const carrierSt = carrier ? vesselStats(carrier.parts) : null
  const carrierShipFree = carrier && carrierSt ? Math.max(0, carrierSt.cargoCap - cargoMass(carrier.cargo)) : 0
  const carrierQuad = carrier ? quadrantOfAngle(Math.atan2(carrier.pos.y, carrier.pos.x)) : 0
  const carrierHomeEarth = Boolean(carrier && carrier.landed && carrier.bodyId === 'earth' && carrierQuad === 0)
  const carrierBase = carrier && carrier.landed ? getActorBase(gs, carrier.bodyId, myActor, carrierQuad) : undefined
  const carrierFlux = carrier ? solarFlux(len(bodyAbsState(carrier.bodyId, gs.time).r)) : 1
  const carrierHasShop = Boolean(
    carrier &&
      carrier.landed &&
      (carrierHomeEarth || (carrierBase && !carrierBase.destroyed && isQuadrantColonized(carrierBase, carrierFlux))),
  )

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="drone-window panel-card"
        role="dialog"
        aria-modal="true"
        aria-label={W('Dron Kontrol & Kargo Merkezi', 'Drone Control & Cargo Center')}
        data-no-i18n
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drone-win-head">
          <div>
            <p className="eyebrow"><span /> {W('FAN-AİR DRON SİSTEMİ', 'ELECTRIC FAN-AIR DRONE BAY')}</p>
            <h2>🛸 {W('Dron Merkezi', 'Drone Command')}</h2>
          </div>
          <div className="drone-win-head-r">
            <span className="tech-budget">{W('Bütçe:', 'Budget:')} <b>{fmt(gs.money)} ₡</b></span>
            <button type="button" className="hud-btn" onClick={onClose} aria-label={W('Kapat', 'Close')}>×</button>
          </div>
        </header>

        <div className="drone-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pad'}
            className={`hud-btn${tab === 'pad' ? ' is-on' : ''}`}
            onClick={() => setTab('pad')}
          >
            🗼 {W('Rampadan Fırlat', 'Launch from Pad')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bay'}
            className={`hud-btn${tab === 'bay' ? ' is-on' : ''}`}
            onClick={() => setTab('bay')}
          >
            🚀 {W('Gemi Hangarı', 'Ship Hangar')} {bayReady ? '(1)' : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={`hud-btn${tab === 'active' ? ' is-on' : ''}`}
            onClick={() => setTab('active')}
          >
            🛸 {W('Aktif Dronlar', 'Active Drones')} ({myDrones.length})
          </button>
        </div>

        {tab === 'pad' && (
          <div className="drone-pane">
            <div className="drone-pad-top">
              <label className="drone-field">
                <span>📍 {W('Fırlatma Rampası', 'Launch Pad')}</span>
                <select value={activeSite ? `${activeSite.bodyId}:${activeSite.quadrant}` : 'earth:0'} onChange={(e) => setSiteKey(e.target.value)}>
                  {launchSites.map((s) => (
                    <option key={`${s.bodyId}:${s.quadrant}`} value={`${s.bodyId}:${s.quadrant}`}>
                      {lang === 'en' ? T(s.label) : s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="drone-tier-row">
                {([1, 2, 3] as const).map((tier) => {
                  const sp = PAD_DRONE_SPECS[tier]
                  return (
                    <button
                      key={tier}
                      type="button"
                      className={`drone-tier-btn${padTier === tier ? ' is-on' : ''}`}
                      onClick={() => selectPadTier(tier)}
                    >
                      <b>Mk-{tier === 1 ? 'I' : tier === 2 ? 'II' : 'III'}</b>
                      <small>{sp.cargoCap} t · {fmt(sp.cost)} ₡</small>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="cargo-capbar">
              <span>{W('Dron Kargosu', 'Drone Cargo')} ({lang === 'en' ? T(padSpec.name) : padSpec.name})</span>
              <i><em style={{ width: `${Math.min(100, (padUsed / padSpec.cargoCap) * 100)}%` }} /></i>
              <small>{padUsed.toFixed(1)} / {padSpec.cargoCap} t</small>
            </div>

            <div className="cargo-presets">
              {padSpec.cargoCap >= 6 && (
                <>
                  <button
                    type="button"
                    className="mini-warp-btn"
                    onClick={() => setPadMods({ 'colony-station': 1, 'solar-farm': 2 })}
                  >
                    🛰️ {W('Koloni Paketi (6 t)', 'Colony Kit (6 t)')}
                  </button>
                  <button
                    type="button"
                    className="mini-warp-btn"
                    onClick={() => setPadMods({ 'colony-station': 1, 'rtg-reactor': 1 })}
                  >
                    ☢️ {W('Nükleer Koloni (6 t)', 'Nuclear Kit (6 t)')}
                  </button>
                </>
              )}
              {padSpec.cargoCap >= 3.5 && padSpec.cargoCap < 6 && (
                <button
                  type="button"
                  className="mini-warp-btn"
                  onClick={() => setPadMods({ 'solar-farm': 2 })}
                >
                  🔆 {W('2× Güneş Paneli (2 t)', '2× Solar (2 t)')}
                </button>
              )}
              {padUsed > 0 && (
                <button type="button" className="mini-warp-btn" onClick={() => setPadMods({})}>
                  {W('Temizle', 'Clear')}
                </button>
              )}
            </div>

            <div className="drone-mod-grid">
              {modList.map((m) => {
                const n = padMods[m.id] ?? 0
                const stCount = !padIsHomeEarth ? padSiteBase?.stock?.[m.id] ?? 0 : 0
                const freeFromStock = Math.min(stCount, Math.max(0, stCount - n))
                return (
                  <div key={m.id} className="cargo-row">
                    <img className="cargo-ico" src={imgUrl(m.id)} alt="" />
                    <div>
                      <b>{modName(m.id)}</b>
                      <small>
                        {m.mass} t · {freeFromStock > 0 ? W(`Depo (${freeFromStock}): 0 ₡`, `Stock (${freeFromStock}): 0 ₡`) : `${fmt(m.cost)} ₡`}
                      </small>
                    </div>
                    <span className="stepper">
                      <button type="button" onClick={() => stepPadMod(m.id, -1)} disabled={n <= 0}>−</button>
                      <b>{n}</b>
                      <button type="button" onClick={() => stepPadMod(m.id, 1)} disabled={padUsed + m.mass > padSpec.cargoCap + 1e-9}>＋</button>
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="drone-footer">
              <small>
                {W(
                  'Elektrikli fan dron roket yakıtı yakmaz; bulunduğu gezegenin diğer çeyreklerine otonom uçabilir (uzay sınırını aşarsa parçalanır).',
                  'Electric fan drones use zero rocket fuel and fly autonomously to any quadrant on this planet (break apart above space ceiling).',
                )}
              </small>
              <button
                type="button"
                className="button button-primary"
                disabled={!activeSite || gs.money < padCost}
                onClick={() => {
                  if (!activeSite) return
                  const ok = exec({
                    type: 'launchPadDrone',
                    bodyId: activeSite.bodyId,
                    quadrant: activeSite.quadrant,
                    tier: padTier,
                    modules: padMods,
                  })
                  if (ok) {
                    setPadMods({})
                    onClose()
                  }
                }}
              >
                🛸 {W('Rampadan Dron Fırlat', 'Launch Drone from Pad')} — {fmt(padCost)} ₡
              </button>
            </div>
          </div>
        )}

        {tab === 'bay' && (
          <div className="drone-pane">
            {!carrier || !bayPart || !baySpec ? (
              <div className="drone-empty-box">
                <p>
                  {W(
                    'Aktif roketinde Dron Fırlatıcı yok. Montajdan rokete Dron Fırlatıcı ekleyebilir ya da "Rampadan Fırlat" sekmesinden doğrudan rampa dronu kaldırabilirsin.',
                    'No rocket with a Drone Bay is available. Add a Drone Bay in Builder or use "Launch from Pad" directly.',
                  )}
                </p>
                <button type="button" className="button button-primary" onClick={() => setTab('pad')}>
                  🗼 {W('Rampadan Dron Fırlat', 'Launch from Pad')}
                </button>
              </div>
            ) : (
              <>
                {bayCarriers.length > 1 && (
                  <label className="drone-field">
                    <span>🚀 {W('Taşıyıcı Roket', 'Carrier Rocket')}</span>
                    <select value={carrier.id} onChange={(e) => setCarrierId(Number(e.target.value))}>
                      {bayCarriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({bodyName(c.bodyId)})</option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="cargo-capbar">
                  <span>{carrier.name} · {lang === 'en' ? T(baySpec.name) : baySpec.name}</span>
                  <i><em style={{ width: `${Math.min(100, (bayUsed / baySpec.cargoCap) * 100)}%` }} /></i>
                  <small>{bayReady ? `${bayUsed.toFixed(1)} / ${baySpec.cargoCap} t` : W('Fırlatıldı (0/1)', 'Launched (0/1)')}</small>
                </div>

                {!bayReady ? (
                  <div className="drone-empty-box">
                    <p>{W('Bu roketin dronu fırlatıldı. "Aktif Dronlar" sekmesinden dronu yönetebilirsin.', 'This ship already launched its drone. Manage it under "Active Drones".')}</p>
                    <button type="button" className="button button-secondary" onClick={() => setTab('active')}>
                      🛸 {W('Aktif Dronlara Git', 'Go to Active Drones')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="cargo-cols">
                      <div className="cargo-col">
                        <h3>{W('🚢 Roket Kargosundan Drona', '🚢 Move Rocket → Drone')}</h3>
                        {Object.entries(carrier.cargo.modules).filter(([id, n]) => n > 0 && id !== 'iss-supplies').length === 0 ? (
                          <p className="cargo-empty">{W('Roket kargosunda aktarılacak modül yok.', 'No modules in rocket cargo hold.')}</p>
                        ) : (
                          Object.entries(carrier.cargo.modules)
                            .filter(([id, n]) => n > 0 && id !== 'iss-supplies')
                            .map(([id, n]) => (
                              <div key={id} className="cargo-row">
                                <img className="cargo-ico" src={imgUrl(id)} alt="" />
                                <div>
                                  <b>{modName(id)} ×{n}</b>
                                  <small>{MODULE_BY_ID[id]?.mass ?? 0} t</small>
                                </div>
                                <button
                                  type="button"
                                  className="hud-btn"
                                  disabled={bayUsed + (MODULE_BY_ID[id]?.mass ?? 0) > baySpec.cargoCap + 1e-9}
                                  onClick={() => exec({ type: 'transferDroneCargo', vesselId: carrier.id, partIndex: bayIdx, moduleId: id, delta: 1, source: 'ship' })}
                                >
                                  → {W('Drona', 'To Drone')}
                                </button>
                              </div>
                            ))
                        )}
                        {carrier.landed && (carrierHasShop || Object.values(carrierBase?.stock ?? {}).some((n) => n > 0)) && (
                          <>
                            <h3 className="drone-subhead">{W('🏭 Üsten Drona Yükle', '🏭 Load from Base/Stock')}</h3>
                            {modList
                              .filter((m) => carrierHasShop || (carrierBase?.stock?.[m.id] ?? 0) > 0)
                              .map((m) => {
                                const stCount = !carrierHomeEarth ? carrierBase?.stock?.[m.id] ?? 0 : 0
                                return (
                                  <div key={`col-${m.id}`} className="cargo-row">
                                    <img className="cargo-ico" src={imgUrl(m.id)} alt="" />
                                    <div>
                                      <b>{modName(m.id)}</b>
                                      <small>{m.mass} t · {stCount > 0 ? W(`Depo ${stCount}: 0 ₡`, `Stock ${stCount}: 0 ₡`) : `${fmt(m.cost)} ₡`}</small>
                                    </div>
                                    <button
                                      type="button"
                                      className="hud-btn"
                                      disabled={bayUsed + m.mass > baySpec.cargoCap + 1e-9}
                                      onClick={() => exec({ type: 'transferDroneCargo', vesselId: carrier.id, partIndex: bayIdx, moduleId: m.id, delta: 1, source: 'colony' })}
                                    >
                                      ＋ {W('Yükle', 'Load')}
                                    </button>
                                  </div>
                                )
                              })}
                          </>
                        )}
                      </div>

                      <div className="cargo-col">
                        <h3>{W('🛸 Dronun İçindeki Yük', '🛸 Staged in Drone')}</h3>
                        {Object.entries(bayCargo).filter(([, n]) => n > 0).length === 0 ? (
                          <p className="cargo-empty">{W('Drona henüz özel yük konmadı (fırlatınca uyumlu gemi kargosu otomatik yüklenebilir).', 'No dedicated cargo staged yet.')}</p>
                        ) : (
                          Object.entries(bayCargo)
                            .filter(([, n]) => n > 0)
                            .map(([id, n]) => (
                              <div key={`st-${id}`} className="cargo-row">
                                <img className="cargo-ico" src={imgUrl(id)} alt="" />
                                <div>
                                  <b>{modName(id)} ×{n}</b>
                                  <small>{((MODULE_BY_ID[id]?.mass ?? 0) * n).toFixed(1)} t</small>
                                </div>
                                {carrierSt && carrierSt.cargoCap > 0 && (
                                  <button
                                    type="button"
                                    className="hud-btn"
                                    disabled={carrierShipFree + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                                    onClick={() => exec({ type: 'transferDroneCargo', vesselId: carrier.id, partIndex: bayIdx, moduleId: id, delta: -1, source: 'ship' })}
                                  >
                                    ← {W('Gemiye', 'To Ship')}
                                  </button>
                                )}
                                {carrier.landed && (
                                  <button
                                    type="button"
                                    className="hud-btn"
                                    onClick={() => exec({ type: 'transferDroneCargo', vesselId: carrier.id, partIndex: bayIdx, moduleId: id, delta: -1, source: 'colony' })}
                                  >
                                    {carrierHomeEarth ? W('İade', 'Refund') : W('Depoya', 'Store')}
                                  </button>
                                )}
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    <div className="drone-footer">
                      <small>{W(`Elektrik gereksinimi: ${baySpec.ecUse} ⚡ · Roket enerji: ${carrier.ec.toFixed(0)} ⚡`, `Requires ${baySpec.ecUse} ⚡ · Ship has ${carrier.ec.toFixed(0)} ⚡`)}</small>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={bayCd > 0.05 || carrier.ec < baySpec.ecUse}
                        onClick={() => {
                          const ok = exec({
                            type: 'launchDrone',
                            vesselId: carrier.id,
                            partIndex: bayIdx,
                            aimAngle: carrier.landed ? Math.atan2(carrier.pos.y, carrier.pos.x) : carrier.angle,
                          })
                          if (ok) onClose()
                        }}
                      >
                        🛸 {bayCd > 0.05 ? `${bayCd.toFixed(1)}s` : W('Gemiden Dronu Fırlat', 'Launch Drone from Ship')}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'active' && (
          <div className="drone-pane">
            {myDrones.length === 0 ? (
              <div className="drone-empty-box">
                <p>{W('Henüz uçuşta veya yüzeyde aktif dron yok.', 'No active drones launched yet.')}</p>
                <button type="button" className="button button-primary" onClick={() => setTab(bayReady ? 'bay' : 'pad')}>
                  🛸 {bayReady ? W('Gemi Hangarına Git', 'Open Ship Hangar') : W('Rampadan Fırlat', 'Launch from Pad')}
                </button>
              </div>
            ) : (
              <div className="drone-list">
                {myDrones.map((d) => {
                  const dst = vesselStats(d.parts, d.cargo)
                  const dq = quadrantOfAngle(Math.atan2(d.pos.y, d.pos.x))
                  const dUsed = cargoMass(d.cargo)
                  const dCap = d.drone!.cargoCap
                  const dFree = Math.max(0, dCap - dUsed)
                  const dMods = Object.entries(d.cargo.modules).filter(([id, n]) => n > 0 && id !== 'iss-supplies')
                  const isCur = active?.id === d.id
                  const partners = myVessels.filter((o) => o.id !== d.id && canTransferCargoBetween(d, o))
                  const dBase = d.landed ? getActorBase(gs, d.bodyId, myActor, dq) : undefined
                  const dHomeEarth = d.bodyId === 'earth' && dq === 0
                  const dFlux = solarFlux(len(bodyAbsState(d.bodyId, gs.time).r))
                  const dCanShop = Boolean(
                    d.landed && (dHomeEarth || (dBase && !dBase.destroyed && isQuadrantColonized(dBase, dFlux))),
                  )
                  const dStock = !dHomeEarth ? Object.entries(dBase?.stock ?? {}).filter(([, n]) => n > 0) : []
                  return (
                    <article key={d.id} className={`drone-card${isCur ? ' is-cur' : ''}`}>
                      <div className="drone-card-head">
                        <div>
                          <b>🛸 {d.name}</b>
                          <small>
                            {bodyName(d.bodyId)} · {QUADRANT_SHORT[dq]} · {d.landed ? W('Yüzeyde', 'Landed') : W('Uçuşta', 'Airborne')} · 🔋 {Math.round(d.ec)}/{dst.ecCap} ⚡ · ❤️ {Math.round(dst.hp)}/{dst.maxHp}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="hud-btn recover"
                          onClick={() => {
                            onSwitch(d.id)
                            onClose()
                          }}
                        >
                          🎮 {isCur ? W('Kontrolde', 'Active') : W('Kontrol Et', 'Control')}
                        </button>
                      </div>

                      <div className="cargo-capbar">
                        <span>{W('Dron Kargosu', 'Drone Hold')}</span>
                        <i><em style={{ width: `${Math.min(100, (dUsed / dCap) * 100)}%` }} /></i>
                        <small>{dUsed.toFixed(1)} / {dCap} t</small>
                      </div>

                      <div className="drone-nav-row">
                        <span>🧭 {W('Otonom Çeyrek:', 'Autopilot:')}</span>
                        {QUADRANTS.map((q) => (
                          <button
                            key={q}
                            type="button"
                            className={`mini-warp-btn${d.autopilot === 'nextQuad' && d.targetQuad === q ? ' is-on' : ''}`}
                            onClick={() => exec({ type: 'setAutopilot', vesselId: d.id, mode: 'nextQuad', targetQuad: q })}
                          >
                            Q{q + 1}
                          </button>
                        ))}
                        {!d.landed && (
                          <button
                            type="button"
                            className={`mini-warp-btn${d.autopilot === 'land' ? ' is-on' : ''}`}
                            onClick={() => exec({ type: 'setAutopilot', vesselId: d.id, mode: 'land' })}
                          >
                            🛬 {W('İn', 'Land')}
                          </button>
                        )}
                        {d.autopilot && d.autopilot !== 'off' && (
                          <button
                            type="button"
                            className="mini-warp-btn"
                            onClick={() => exec({ type: 'setAutopilot', vesselId: d.id, mode: 'off' })}
                          >
                            🛑 {W('Dur', 'Stop')}
                          </button>
                        )}
                        {d.landed && dMods.length > 0 && !dHomeEarth && (
                          <button
                            type="button"
                            className="hud-btn recover"
                            onClick={() => exec({ type: 'deployModules', vesselId: d.id, quadrant: dq })}
                          >
                            ⬇ {W('Çeyreğe Kur', 'Build in Quadrant')}
                          </button>
                        )}
                      </div>

                      <div className="cargo-cols">
                        <div className="cargo-col">
                          <h3>{W('📦 Dron Kargosu', '📦 Inside Drone')}</h3>
                          {dMods.length === 0 ? (
                            <p className="cargo-empty">{W('Dron kargosu boş.', 'Drone hold empty.')}</p>
                          ) : (
                            dMods.map(([id, n]) => (
                              <div key={id} className="cargo-row">
                                <img className="cargo-ico" src={imgUrl(id)} alt="" />
                                <div>
                                  <b>{modName(id)} ×{n}</b>
                                  <small>{MODULE_BY_ID[id]?.mass ?? 0} t</small>
                                </div>
                                {d.landed && !dHomeEarth && (
                                  <button
                                    type="button"
                                    className="hud-btn"
                                    onClick={() => exec({ type: 'deployModules', vesselId: d.id, moduleId: id, quadrant: dq })}
                                  >
                                    ⬇ {W('Kur', 'Deploy')}
                                  </button>
                                )}
                                {d.landed && (
                                  <button
                                    type="button"
                                    className="hud-btn"
                                    onClick={() => exec({ type: 'buyCargoModule', vesselId: d.id, moduleId: id, delta: -1 })}
                                  >
                                    {dHomeEarth ? W('İade', 'Sell') : W('Depoya', 'Store')}
                                  </button>
                                )}
                                {partners.map((pt) => {
                                  const pFree = vesselStats(pt.parts).cargoCap - cargoMass(pt.cargo)
                                  return (
                                    <button
                                      key={pt.id}
                                      type="button"
                                      className="hud-btn"
                                      disabled={pFree + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                                      onClick={() => exec({ type: 'transferCargo', fromVesselId: d.id, toVesselId: pt.id, moduleId: id, count: 1 })}
                                    >
                                      → {pt.name.split(' ')[0]}
                                    </button>
                                  )
                                })}
                              </div>
                            ))
                          )}
                        </div>

                        <div className="cargo-col">
                          <h3>{W('🔁 Yakın Araç / Depo → Dron', '🔁 Transfer Ship / Stock → Drone')}</h3>
                          {partners.map((other) => {
                            const oMods = Object.entries(other.cargo.modules).filter(([id, n]) => n > 0 && id !== 'iss-supplies')
                            return oMods.map(([id, n]) => (
                              <div key={`${other.id}-${id}`} className="cargo-row">
                                <img className="cargo-ico" src={imgUrl(id)} alt="" />
                                <div>
                                  <b>{modName(id)} ×{n}</b>
                                  <small>{other.name} · {MODULE_BY_ID[id]?.mass ?? 0} t</small>
                                </div>
                                <button
                                  type="button"
                                  className="hud-btn"
                                  disabled={dFree + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                                  onClick={() => exec({ type: 'transferCargo', fromVesselId: other.id, toVesselId: d.id, moduleId: id, count: 1 })}
                                >
                                  ← {W('Drona Al', 'Pull')}
                                </button>
                              </div>
                            ))
                          })}
                          {dStock.map(([id, n]) => (
                            <div key={`st-${id}`} className="cargo-row">
                              <img className="cargo-ico" src={imgUrl(id)} alt="" />
                              <div>
                                <b>{modName(id)} ×{n}</b>
                                <small>{W('Çeyrek Deposu', 'Quadrant Stock')} · {MODULE_BY_ID[id]?.mass ?? 0} t</small>
                              </div>
                              <button
                                type="button"
                                className="hud-btn"
                                disabled={dFree + 1e-9 < (MODULE_BY_ID[id]?.mass ?? 0)}
                                onClick={() => exec({ type: 'pickupModule', vesselId: d.id, moduleId: id, quadrant: dq })}
                              >
                                ← {W('Yükle', 'Load')}
                              </button>
                            </div>
                          ))}
                          {dCanShop && modList.map((m) => (
                            <div key={`buy-${m.id}`} className="cargo-row">
                              <img className="cargo-ico" src={imgUrl(m.id)} alt="" />
                              <div>
                                <b>{modName(m.id)}</b>
                                <small>{m.mass} t · {fmt(m.cost)} ₡</small>
                              </div>
                              <button
                                type="button"
                                className="hud-btn"
                                disabled={dFree + 1e-9 < m.mass || gs.money < m.cost}
                                onClick={() => exec({ type: 'buyCargoModule', vesselId: d.id, moduleId: m.id, delta: 1 })}
                              >
                                ＋ {W('Yükle', 'Load')}
                              </button>
                            </div>
                          ))}
                          {partners.every((o) => Object.keys(o.cargo.modules).length === 0) && dStock.length === 0 && !dCanShop && (
                            <p className="cargo-empty">
                              {W(
                                'Yakınında (2 km / aynı çeyrek) yüklü gemi ya da yüzey deposu yok.',
                                'No cargo ship (within 2 km / same quadrant) or surface stock nearby.',
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
