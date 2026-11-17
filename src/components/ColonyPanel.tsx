import { useEffect, useMemo, useState } from 'react'
import {
  baseReport,
  COLONY_SLOTS,
  colonyHealthSummary,
  colonyShieldCap,
  colonyStationStatus,
  EARTH_MODULES,
  ensureSites,
  hasActiveLaunchPad,
  MODULE_BY_ID,
  MODULES,
  QUADRANT_SHORT,
  QUADRANTS,
  quadrantOfAngle,
  TIER_HINT,
  WARFARE_EARTH_MODULES,
  type QuadrantId,
} from '../game/base'
import {
  OUTPOST_INCOME_PER_MIN,
  OUTPOST_LOOT_BONUS,
  OUTPOST_MAX_LEVEL,
  OUTPOST_REPAIR_RATE,
  OUTPOST_UPGRADE_COST,
  outpostDesign,
} from '../game/data'
import { runCommand, useActiveGame } from '../game/store'
import { vesselStats } from '../game/vessel'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import { isLootMode, isWarfareMode } from '../flight/combat'
import { findOutpost } from '../flight/loot'
import { bodyAbsState, len } from '../flight/orbit'
import { activeVessel, getActorBase, modulePrice } from '../flight/world'

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const spriteUrl = (s: string) => `/assets/colony/${s}.png`

const OUTPOST_TIER_NAMES = ['', 'Temel Karakol', 'Kalkanlı İkmal Üssü', 'Ağır Zırhlı İstasyon', 'Yörünge Kalesi', 'Süper Hisar']

interface Props {
  initialBody?: BodyId
  initialQuadrant?: QuadrantId
  onNotify?: (text: string, kind?: 'info' | 'warn') => void
  onOpenTech?: () => void
  onOpenDronePad?: (bodyId: BodyId, quadrant: QuadrantId) => void
}

/** Yüzey kolonisi: 4 gezegen çeyreği ve 12 yuvayla sürükle-bırak koloni veya Yağma üs geliştirme. */
export default function ColonyPanel({ initialBody = 'earth', initialQuadrant, onNotify, onOpenDronePad }: Props) {
  const gs = useActiveGame()
  const myId = gs.ownerId ?? 'local'
  const warfare = isWarfareMode(gs)
  const isLoot = isLootMode(gs)
  const [bodyId, setBodyId] = useState<BodyId>(BODIES[initialBody]?.landable ? initialBody : 'earth')
  const [quadrant, setQuadrant] = useState<QuadrantId>(initialQuadrant ?? 0)
  const [picked, setPicked] = useState<string | null>(null)
  const [selSlot, setSelSlot] = useState<number | null>(null)
  const [hoverSlot, setHoverSlot] = useState<number | null>(null)
  const [justPlaced, setJustPlaced] = useState<{ slot: number; ts: number } | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; kind: 'info' | 'warn' } | null>(null)

  useEffect(() => {
    if (BODIES[initialBody]?.landable) setBodyId(initialBody)
    if (initialQuadrant !== undefined) setQuadrant(initialQuadrant)
    else {
      const av = activeVessel(gs)
      if (av && av.bodyId === initialBody) setQuadrant(quadrantOfAngle(Math.atan2(av.pos.y, av.pos.x)))
    }
  }, [initialBody, initialQuadrant])

  const say = (text: string, kind: 'info' | 'warn' = 'info') => {
    setFeedback({ text, kind })
    onNotify?.(text, kind)
  }

  const tabs = useMemo(() => {
    const ids = new Set<BodyId>(['earth', 'moon', 'mars'])
    for (const id of Object.keys(gs.bases) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
    if (gs.quadrantBases) for (const id of Object.keys(gs.quadrantBases) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
    if (gs.mp) {
      for (const cap of Object.values(gs.mp.captures)) {
        if (cap?.ownerId === myId && BODIES[cap.bodyId]?.landable) ids.add(cap.bodyId)
      }
      const myCols = gs.mp.players[myId]?.colonies
      if (myCols) for (const id of Object.keys(myCols) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
      const myQCols = gs.mp.players[myId]?.quadrantColonies
      if (myQCols) for (const id of Object.keys(myQCols) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
    }
    for (const v of gs.vessels) {
      if (v.landed && BODIES[v.bodyId]?.landable && (!gs.mp || v.ownerId === myId)) ids.add(v.bodyId)
    }
    return [...ids]
  }, [gs.bases, gs.quadrantBases, gs.vessels, gs.mp, myId])

  if (isLoot) {
    const me = gs.mp?.players[myId]
    const outpost = findOutpost(gs, myId)
    const level = Math.max(1, Math.min(OUTPOST_MAX_LEVEL, me?.outpostLevel ?? 1))
    const nextCost = level < OUTPOST_MAX_LEVEL ? OUTPOST_UPGRADE_COST[level]! : null
    const st = outpost ? vesselStats(outpost.parts) : null
    return (
      <div className="colony colony-outpost">
        <header className="colony-top">
          <div className="colony-planet">
            <div>
              <small>Yağma Uzay Üssü</small>
              <b>🏰 {OUTPOST_TIER_NAMES[level]} (Sv. {level}/{OUTPOST_MAX_LEVEL})</b>
            </div>
          </div>
          <div className="colony-stats">
            <div className="colony-stat plain"><span>💰 Üs Geliri</span><b>+{fmt(OUTPOST_INCOME_PER_MIN[level] ?? 0)} ₡/dk</b></div>
            <div className="colony-stat plain"><span>🔧 Onarım</span><b>+{OUTPOST_REPAIR_RATE[level]} HP/sn</b></div>
            <div className="colony-stat plain"><span>📦 Ganimet Bonusu</span><b>×{(OUTPOST_LOOT_BONUS[level] ?? 1).toFixed(2)}</b></div>
            {st && (
              <>
                <div className="colony-stat plain"><span>🧱 Çekirdek &amp; Zırh</span><b>{Math.round(st.hp)}/{st.maxHp}</b></div>
                <div className="colony-stat plain"><span>🛡️ Kalkan</span><b>{Math.round(outpost?.shield ?? 0)}/{st.shieldCap}</b></div>
              </>
            )}
          </div>
        </header>

        <div className="outpost-upgrade-list">
          {Array.from({ length: OUTPOST_MAX_LEVEL }, (_, i) => i + 1).map((lvl) => {
            const unlocked = level >= lvl
            const isNext = lvl === level + 1
            const cost = OUTPOST_UPGRADE_COST[lvl - 1] ?? 0
            const design = outpostDesign(lvl)
            const turrets = design.filter((p) => p.def === 'base-turret').length
            const shields = design.filter((p) => p.def === 'shield-gen').length
            return (
              <div key={lvl} className={`outpost-tier-card${unlocked ? ' is-owned' : ''}${isNext ? ' is-next' : ''}`}>
                <div className="outpost-tier-head">
                  <b>Sv.{lvl} · {OUTPOST_TIER_NAMES[lvl]}</b>
                  <span className="outpost-tier-badge">
                    {unlocked ? '✓ Aktif' : `${fmt(cost)} ₡`}
                  </span>
                </div>
                <small>
                  🔫 {turrets} Otomatik Taret · 🛡️ {shields * 200} HP Kalkan · 💰 +{fmt(OUTPOST_INCOME_PER_MIN[lvl] ?? 0)} ₡/dk · 📦 ×{(OUTPOST_LOOT_BONUS[lvl] ?? 1).toFixed(2)} ganimet
                </small>
                {isNext && (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!outpost || gs.money < cost}
                    onClick={() => {
                      const res = runCommand({ type: 'upgradeOutpost' })
                      if (res.error) say(res.error, 'warn')
                      else say(`🏰 Uzay üssü Seviye ${lvl}'e yükseltildi!`)
                    }}
                  >
                    {outpost ? `⬆ Seviye ${lvl}'e Yükselt — ${fmt(cost)} ₡` : '🛠️ Üssün yeniden kurulması bekleniyor'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {feedback && <div className={`colony-info${feedback.kind === 'warn' ? ' warn' : ''}`}><span>{feedback.text}</span></div>}
        {nextCost === null && <div className="colony-status-bar is-active">🏆 Uzay üssün maksimum Kale seviyesine ulaştı!</div>}
      </div>
    )
  }

  const body = BODIES[bodyId]
  const base = getActorBase(gs, bodyId, myId, quadrant)
  const isHomeEarth = bodyId === 'earth' && quadrant === 0
  const landedHere = gs.vessels.some(
    (v) => v.landed && v.bodyId === bodyId && (!gs.mp || v.ownerId === myId) && quadrantOfAngle(Math.atan2(v.pos.y, v.pos.x)) === quadrant,
  )
  const mpCapOwner =
    gs.mp && !warfare && bodyId !== 'earth'
      ? (gs.mp.quadrantCaptures?.[bodyId]?.[quadrant] ?? (quadrant === 0 ? gs.mp.captures[bodyId] : undefined))?.ownerId
      : undefined
  const canBuild = base?.destroyed
    ? false
    : isHomeEarth
      ? true
      : gs.mp
        ? warfare || bodyId === 'earth'
          ? landedHere || !!base
          : mpCapOwner === myId || (!mpCapOwner && landedHere)
        : landedHere || !!base
  const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
  const sites = base ? ensureSites(base) : Array.from({ length: COLONY_SLOTS }, () => null)
  const colShieldCap = colonyShieldCap(base, flux)
  const colHealth = base ? colonyHealthSummary(base) : { hp: 0, maxHp: 0, buildings: 0 }
  const report = base ? baseReport(base, flux, isHomeEarth ? 1 : body.incomeMult) : null
  const stationStatus = colonyStationStatus(base, flux)
  const hasActiveStation = stationStatus === 'active'
  const launchPadReady = hasActiveLaunchPad(base, flux)
  const idx = tabs.indexOf(bodyId)

  const place = (slot: number, moduleId: string) => {
    const res = runCommand({ type: 'placeGridModule', bodyId, x: slot, moduleId, quadrant })
    if (res.error) say(res.error, 'warn')
    else {
      say(`${MODULE_BY_ID[moduleId]!.name} (${QUADRANT_SHORT[quadrant]}) kuruldu.`)
      setJustPlaced({ slot, ts: Date.now() })
      window.setTimeout(() => setJustPlaced((cur) => (cur?.slot === slot ? null : cur)), 720)
      setPicked(null)
    }
  }

  const remove = (slot: number) => {
    const res = runCommand({ type: 'removeGridModule', bodyId, x: slot, quadrant })
    if (res.error) say(res.error, 'warn')
    else if (isHomeEarth) say('Yapı söküldü; bedelinin %60\'ı iade edildi.')
    else say('Yapı söküldü; çeyrek deposuna kaldırıldı.')
    setSelSlot(null)
  }

  const sel = selSlot !== null ? sites[selSlot] : null
  const selDef = sel ? MODULE_BY_ID[sel] : null
  const selPowered = selSlot !== null ? report?.sites[selSlot]?.powered !== false : true
  const powerOk = !report || report.unpowered === 0
  const sunPct = Math.round(flux * 100)

  return (
    <div className={`colony colony-${bodyId}`}>
      <header className="colony-top">
        <div className="colony-planet">
          <button className="colony-arrow" aria-label="Önceki gezegen" onClick={() => setBodyId(tabs[(idx - 1 + tabs.length) % tabs.length]!)}>◀</button>
          <div>
            <small>Gezegen</small>
            <b>{body.name}</b>
          </div>
          <button className="colony-arrow" aria-label="Sonraki gezegen" onClick={() => setBodyId(tabs[(idx + 1) % tabs.length]!)}>▶</button>
        </div>
        <div className="colony-quad-tabs" role="tablist" aria-label="Gezegen Çeyrekleri">
          {QUADRANTS.map((q) => {
            const qb = getActorBase(gs, bodyId, myId, q)
            const qCol = qb && colonyStationStatus(qb, flux) === 'active'
            const qPad = hasActiveLaunchPad(qb, flux)
            const qHasShip = gs.vessels.some(
              (v) => v.landed && v.bodyId === bodyId && (!gs.mp || v.ownerId === myId) && quadrantOfAngle(Math.atan2(v.pos.y, v.pos.x)) === q,
            )
            return (
              <button
                key={q}
                type="button"
                role="tab"
                aria-selected={quadrant === q}
                className={`colony-quad-btn${quadrant === q ? ' is-active' : ''}${qCol ? ' is-col' : ''}`}
                onClick={() => {
                  setQuadrant(q)
                  setSelSlot(null)
                }}
              >
                <span>{QUADRANT_SHORT[q]}</span>
                {(bodyId === 'earth' && q === 0) || qCol || qPad || qHasShip ? (
                  <span className="colony-quad-icons">
                    {bodyId === 'earth' && q === 0 ? <small>🏠</small> : null}
                    {qCol ? <small title="Uzay İstasyonu aktif">🛰️</small> : null}
                    {qPad ? <small title="Fırlatma Rampası hazır">🗼</small> : null}
                    {qHasShip ? <small title="İnmiş aracın burada">🚢</small> : null}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="colony-stats">
          <div className="colony-stat" title="Güneş paneli üretimi Güneş'e uzaklığın karesiyle azalır (1/r²).">
            <span>☀️ Güneş ışığı</span>
            <i><em className="sun" style={{ width: `${Math.min(100, sunPct)}%` }} /></i>
            <b>%{sunPct}</b>
          </div>
          <div className="colony-stat" title="Üretilen elektrik / yapıların ihtiyacı">
            <span>⚡ Elektrik</span>
            <i><em className={powerOk ? 'ok' : 'bad'} style={{ width: `${report && report.powerDemand > 0 ? Math.min(100, (report.powerSupply / report.powerDemand) * 100) : 100}%` }} /></i>
            <b className={powerOk ? '' : 'bad'}>{(report?.powerSupply ?? 0).toFixed(1)} / {(report?.powerDemand ?? 0).toFixed(0)}</b>
          </div>
          <div className="colony-stat plain"><span>💰 Gelir</span><b>+{fmt(report?.incomePerMin ?? 0)} ₡/dk</b></div>
          <div className="colony-stat plain"><span>⛏️ Maden</span><b>{(base?.ore ?? 0).toFixed(1)} t</b></div>
          {warfare && colHealth.maxHp > 0 && (
            <div className="colony-stat plain"><span>🧱 Yapılar</span><b>{Math.round(colHealth.hp)}/{colHealth.maxHp}</b></div>
          )}
          {colShieldCap > 0 && (
            <div className="colony-stat plain"><span>🛡️ Kubbe</span><b>{Math.round(base?.shield ?? 0)}/{colShieldCap}</b></div>
          )}
        </div>
      </header>

      <div className="colony-scene">
        <div className="colony-sky" aria-hidden="true" />
        <div className="colony-hills" aria-hidden="true" />
        <div className="colony-ground" aria-hidden="true" />
        <div className={`colony-cable${powerOk ? '' : ' is-low'}`} aria-hidden="true" />
        <div className="colony-slots">
          {sites.map((id, i) => {
            const def = id ? MODULE_BY_ID[id] : null
            const powered = report?.sites[i]?.powered !== false
            const justBuilt = justPlaced?.slot === i
            const ghostDef = !def && picked && hoverSlot === i ? MODULE_BY_ID[picked] : null
            return (
              <button
                key={i}
                className={`colony-slot${def ? ' is-built' : ''}${justBuilt ? ' is-just-built' : ''}${selSlot === i ? ' is-selected' : ''}${hoverSlot === i && !def ? ' is-hover' : ''}${!def && picked ? ' is-target' : ''}`}
                aria-label={def ? `${def.name}${powered ? '' : ' (elektrik yok)'}` : `Boş yuva ${i + 1}`}
                onMouseEnter={() => { if (!def) setHoverSlot(i) }}
                onMouseLeave={() => setHoverSlot((h) => (h === i ? null : h))}
                onClick={() => {
                  if (def) setSelSlot(selSlot === i ? null : i)
                  else if (picked) place(i, picked)
                  else say('Önce alttan bir yapı seç, sonra boş yuvaya tıkla — ya da sürükleyip bırak.')
                }}
                onDragOver={(e) => {
                  if (!def) {
                    e.preventDefault()
                    setHoverSlot(i)
                  }
                }}
                onDragLeave={() => setHoverSlot((h) => (h === i ? null : h))}
                onDrop={(e) => {
                  e.preventDefault()
                  setHoverSlot(null)
                  const mid = e.dataTransfer.getData('text/plain')
                  if (!def && MODULE_BY_ID[mid]) place(i, mid)
                }}
              >
                {def ? (
                  <>
                    <img src={spriteUrl(def.sprite)} alt="" draggable={false} className={powered ? '' : 'is-off'} />
                    {justBuilt && <span className="colony-build-fx" aria-hidden="true" />}
                    {!powered && <span className="colony-nopower" title="Elektrik yetmiyor">⚡✕</span>}
                    {def.hp && base?.siteHp?.[i] != null && base.siteHp[i]! < def.hp && (
                      <span className="colony-slot-hp">
                        <i style={{ width: `${Math.max(0, Math.min(100, (base.siteHp[i]! / def.hp) * 100))}%` }} />
                      </span>
                    )}
                  </>
                ) : ghostDef ? (
                  <img src={spriteUrl(ghostDef.sprite)} alt="" draggable={false} className="colony-ghost-img" />
                ) : (
                  <span className="colony-plus">＋</span>
                )}
              </button>
            )
          })}
        </div>
        {!canBuild && (
          <div className="colony-locked">
            {base?.destroyed
              ? `${body.name} (${QUADRANT_SHORT[quadrant]}) üssün düşman saldırısında imha edildi!`
              : gs.mp && mpCapOwner && mpCapOwner !== myId
                ? `${QUADRANT_SHORT[quadrant]} şu an başka bir oyuncunun kolonisi — burada koloni kuramazsın.`
                : `Buraya üs kurmak için önce ${body.name} ${QUADRANT_SHORT[quadrant]} çeyreğine bir araç veya dron indir.`}
          </div>
        )}
      </div>

      <div className={`colony-info${feedback?.kind === 'warn' ? ' warn' : ''}`}>
        {selDef && selSlot !== null ? (
          <>
            <span>
              <b>{selDef.name}</b> — {selDef.desc}
              {selDef.income > 0 ? ` (+${fmt(Math.round(selDef.income * (isHomeEarth ? 1 : body.incomeMult)))} ₡/dk)` : ''}
              {selPowered ? '' : ' Şu an elektrik yetmediği için çalışmıyor.'}
            </span>
            <button className="hud-btn" onClick={() => remove(selSlot)}>{isHomeEarth ? 'Sök (%60 iade)' : 'Sök (depoya döner)'}</button>
          </>
        ) : !powerOk ? (
          <span>⚡ Elektrik yetmiyor: {report!.unpowered} yapı durdu. {flux < 0.9 ? `Burada güneş ışığı yalnızca %${sunPct}; daha fazla panel ya da Reaktör kur.` : 'Güneş Paneli ekle.'}</span>
        ) : (
          <span>{feedback?.text ?? 'Bir yapıyı sürükleyip yüzeydeki 12 yuvadan birine bırak. Yapılar çeyreğin elektriğiyle çalışır.'}</span>
        )}
      </div>

      {!isHomeEarth && (
        <div className={`colony-status-bar is-${stationStatus}`}>
          <span>
            {launchPadReady
              ? `🛰️ ${QUADRANT_SHORT[quadrant]} Kolonileştirildi · 🗼 Fırlatma Rampası & Yerel İnşaat Açık!`
              : hasActiveStation
                ? `🛰️ ${QUADRANT_SHORT[quadrant]} Kolonileştirildi · Krediyle doğrudan bina kurabilirsin (Fırlatma Rampası ekleyince buradan roket kalkar!)`
                : stationStatus === 'unpowered'
                  ? '⚡ Uzay İstasyonu elektriksiz (5 ⚡ gerekir) · Güneş paneli veya reaktör kur'
                  : '📦 Bu çeyrekte istasyon kurulana dek yalnızca kargo veya dron ile getirdiğin yapılar kurulur'}
          </span>
          {launchPadReady && onOpenDronePad && (
            <button type="button" className="hud-btn recover" onClick={() => onOpenDronePad(bodyId, quadrant)}>
              🛸 Rampadan Dron Fırlat
            </button>
          )}
        </div>
      )}
      {isHomeEarth && onOpenDronePad && (
        <div className="colony-status-bar is-active">
          <span>🗼 Dünya Ana Fırlatma Rampası Hazır · Roket veya otonom fan-air dron fırlatabilirsin.</span>
          <button type="button" className="hud-btn recover" onClick={() => onOpenDronePad('earth', 0)}>
            🛸 Rampadan Dron Fırlat
          </button>
        </div>
      )}

      <div className="colony-build">
        <h3>İnşaat ({QUADRANT_SHORT[quadrant]})</h3>
        <div className="colony-cards">
          {MODULES.filter((m) => (isHomeEarth ? (warfare ? WARFARE_EARTH_MODULES : EARTH_MODULES).includes(m.id) : !m.warfare || warfare)).map((m) => {
            const stock = base?.stock?.[m.id] ?? 0
            const tierLocked = false
            const cargoOnly = !isHomeEarth && !stock && !hasActiveStation
            const locked = tierLocked || cargoOnly
            const price = modulePrice(gs, bodyId, m.id, myId, quadrant)
            const afford = gs.money >= price
            const power = m.power > 0 ? m.power * (m.constantPower ? 1 : flux) : m.power
            const disabled = locked || !canBuild
            const lockHint = cargoOnly
              ? 'Önce kargo veya dron ile Uzay İstasyonu getir ya da bu yapıyı kargoyla taşı.'
              : TIER_HINT[m.tier]
            return (
              <button
                key={m.id}
                className={`colony-card${picked === m.id ? ' is-picked' : ''}${locked ? ' is-locked' : ''}${stock > 0 ? ' is-stock' : ''}${!afford && !locked ? ' is-poor' : ''}`}
                draggable={!disabled}
                disabled={disabled}
                title={locked ? lockHint : m.desc}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', m.id)
                  e.dataTransfer.effectAllowed = 'copy'
                  setPicked(m.id)
                  setSelSlot(null)
                }}
                onDragEnd={() => setPicked(null)}
                onClick={() => {
                  setPicked(picked === m.id ? null : m.id)
                  setSelSlot(null)
                }}
              >
                <span className="colony-card-art"><img src={spriteUrl(m.sprite)} alt="" draggable={false} />{locked && <span className="colony-lock">🔒</span>}</span>
                <b>{m.name}</b>
                {m.income > 0 && (
                  <small className="ok">+{fmt(Math.round(m.income * (isHomeEarth ? 1 : body.incomeMult)))} ₡/dk</small>
                )}
                <small className={power > 0 ? 'ok' : ''}>{power > 0 ? `+${power.toFixed(1)}` : power} ⚡</small>
                <small className={stock > 0 ? 'price ok' : afford && !cargoOnly ? 'price' : 'price bad'}>
                  {cargoOnly
                    ? (stationStatus === 'unpowered' ? '⚡ İstasyon güçsüz' : '📦 Kargo gerekli')
                    : tierLocked
                      ? TIER_HINT[m.tier]
                      : stock > 0
                        ? `Depoda: ${stock}`
                        : `${fmt(price)} ₡`}
                </small>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
