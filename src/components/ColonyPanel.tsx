import { useEffect, useMemo, useState } from 'react'
import {
  baseReport,
  COLONY_SLOTS,
  colonyHealthSummary,
  colonyShieldCap,
  colonyStationStatus,
  EARTH_MODULES,
  ensureSites,
  MODULE_BY_ID,
  MODULES,
  TIER_HINT,
  WARFARE_EARTH_MODULES,
} from '../game/base'
import { runCommand, useActiveGame } from '../game/store'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import { isWarfareMode } from '../flight/combat'
import { bodyAbsState, len } from '../flight/orbit'
import { getActorBase, modulePrice } from '../flight/world'

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const spriteUrl = (s: string) => `/assets/colony/${s}.png`

interface Props {
  initialBody?: BodyId
  onNotify?: (text: string, kind?: 'info' | 'warn') => void
  onOpenTech?: () => void
}

/** Yüzey kolonisi: yapıları alttaki çubuktan sürükleyip yüzeydeki yuvalara bırak. */
export default function ColonyPanel({ initialBody = 'earth', onNotify }: Props) {
  const gs = useActiveGame()
  const myId = gs.ownerId ?? 'local'
  const warfare = isWarfareMode(gs)
  const [bodyId, setBodyId] = useState<BodyId>(BODIES[initialBody]?.landable ? initialBody : 'earth')
  const [picked, setPicked] = useState<string | null>(null)
  const [selSlot, setSelSlot] = useState<number | null>(null)
  const [hoverSlot, setHoverSlot] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; kind: 'info' | 'warn' } | null>(null)

  useEffect(() => {
    if (BODIES[initialBody]?.landable) setBodyId(initialBody)
  }, [initialBody])

  const tabs = useMemo(() => {
    const ids = new Set<BodyId>(['earth', 'moon', 'mars'])
    for (const id of Object.keys(gs.bases) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
    if (gs.mp) {
      for (const cap of Object.values(gs.mp.captures)) {
        if (cap?.ownerId === myId && BODIES[cap.bodyId]?.landable) ids.add(cap.bodyId)
      }
      const myCols = gs.mp.players[myId]?.colonies
      if (myCols) for (const id of Object.keys(myCols) as BodyId[]) if (BODIES[id]?.landable) ids.add(id)
    }
    for (const v of gs.vessels) {
      if (v.landed && BODIES[v.bodyId]?.landable && (!gs.mp || v.ownerId === myId)) ids.add(v.bodyId)
    }
    return [...ids]
  }, [gs.bases, gs.vessels, gs.mp, myId])

  const body = BODIES[bodyId]
  const base = getActorBase(gs, bodyId, myId)
  const landedHere = gs.vessels.some((v) => v.landed && v.bodyId === bodyId && (!gs.mp || v.ownerId === myId))
  const mpCapOwner = gs.mp && !warfare && bodyId !== 'earth' ? gs.mp.captures[bodyId]?.ownerId : undefined
  const canBuild = base?.destroyed
    ? false
    : bodyId === 'earth'
      ? true
      : gs.mp
        ? warfare
          ? landedHere || !!base
          : mpCapOwner === myId || (!mpCapOwner && landedHere)
        : landedHere || !!base
  const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
  const sites = base ? ensureSites(base) : Array.from({ length: COLONY_SLOTS }, () => null)
  const colShieldCap = colonyShieldCap(base, flux)
  const colHealth = base ? colonyHealthSummary(base) : { hp: 0, maxHp: 0, buildings: 0 }
  const report = base ? baseReport(base, flux) : null
  const stationStatus = colonyStationStatus(base, flux)
  const idx = tabs.indexOf(bodyId)

  const say = (text: string, kind: 'info' | 'warn' = 'info') => {
    setFeedback({ text, kind })
    onNotify?.(text, kind)
  }

  const place = (slot: number, moduleId: string) => {
    const res = runCommand({ type: 'placeGridModule', bodyId, x: slot, moduleId })
    if (res.error) say(res.error, 'warn')
    else {
      say(`${MODULE_BY_ID[moduleId]!.name} kuruldu.`)
      setPicked(null)
    }
  }

  const remove = (slot: number) => {
    const res = runCommand({ type: 'removeGridModule', bodyId, x: slot })
    if (res.error) say(res.error, 'warn')
    else if (bodyId === 'earth') say('Yapı söküldü; bedelinin %60\'ı iade edildi.')
    else say('Yapı söküldü; depoya kaldırıldı.')
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
          <div className="colony-stat plain"><span>💰 Gelir</span><b>{fmt(report?.incomePerHour ?? 0)} ₡/sa</b></div>
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
            return (
              <button
                key={i}
                className={`colony-slot${def ? ' is-built' : ''}${selSlot === i ? ' is-selected' : ''}${hoverSlot === i && !def ? ' is-hover' : ''}${!def && picked ? ' is-target' : ''}`}
                aria-label={def ? `${def.name}${powered ? '' : ' (elektrik yok)'}` : `Boş yuva ${i + 1}`}
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
                    {!powered && <span className="colony-nopower" title="Elektrik yetmiyor">⚡✕</span>}
                    {def.hp && base?.siteHp?.[i] != null && base.siteHp[i]! < def.hp && (
                      <span className="colony-slot-hp">
                        <i style={{ width: `${Math.max(0, Math.min(100, (base.siteHp[i]! / def.hp) * 100))}%` }} />
                      </span>
                    )}
                  </>
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
              ? `${body.name} üssün düşman saldırısında imha edildi!`
              : gs.mp && mpCapOwner && mpCapOwner !== myId
                ? `${body.name} şu an başka bir oyuncunun kolonisi — burada koloni kuramazsın.`
                : `Buraya üs kurmak için önce ${body.name} yüzeyine bir araç indir.`}
          </div>
        )}
      </div>

      <div className={`colony-info${feedback?.kind === 'warn' ? ' warn' : ''}`}>
        {selDef && selSlot !== null ? (
          <>
            <span><b>{selDef.name}</b> — {selDef.desc} {selPowered ? '' : 'Şu an elektrik yetmediği için çalışmıyor.'}</span>
            <button className="hud-btn" onClick={() => remove(selSlot)}>{bodyId === 'earth' ? 'Sök (%60 iade)' : 'Sök (depoya döner)'}</button>
          </>
        ) : !powerOk ? (
          <span>⚡ Elektrik yetmiyor: {report!.unpowered} yapı durdu. {flux < 0.9 ? `Burada güneş ışığı yalnızca %${sunPct}; daha fazla panel ya da Reaktör kur.` : 'Güneş Paneli ekle.'}</span>
        ) : (
          <span>{feedback?.text ?? 'Bir yapıyı sürükleyip yüzeydeki boş yuvaya bırak. Yapılar koloninin elektriğiyle çalışır.'}</span>
        )}
      </div>

      {bodyId !== 'earth' && (
        <div className={`colony-status-bar is-${stationStatus}`}>
          {stationStatus === 'active'
            ? '🛰️ Kolonileştirildi · Yeni yapılar yine Dünya\'dan kargoyla gelir'
            : stationStatus === 'unpowered'
              ? '⚡ Uzay İstasyonu elektriksiz (7 ⚡ gerekir) · Panel getir'
              : '📦 Burada yalnızca kargoyla getirdiğin yapılar kurulur'}
        </div>
      )}

      <div className="colony-build">
        <h3>İnşaat</h3>
        <div className="colony-cards">
          {MODULES.filter((m) => (bodyId === 'earth' ? (warfare ? WARFARE_EARTH_MODULES : EARTH_MODULES).includes(m.id) : !m.warfare || warfare)).map((m) => {
            const stock = base?.stock?.[m.id] ?? 0
            const tierLocked = false
            const cargoOnly = bodyId !== 'earth' && !stock
            const locked = tierLocked || cargoOnly
            const price = modulePrice(gs, bodyId, m.id)
            const afford = gs.money >= price
            const power = m.power > 0 ? m.power * (m.constantPower ? 1 : flux) : m.power
            const disabled = locked || !canBuild
            const lockHint = cargoOnly
              ? 'Dünya\'da roketin kargo bölmesine ekle ve buraya getir; sadece getirdiğin yapılar kurulur.'
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
