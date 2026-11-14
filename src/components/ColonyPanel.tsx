import { useEffect, useMemo, useState } from 'react'
import { baseReport, COLONY_SLOTS, colonyTier, EARTH_MODULES, ensureSites, MODULE_BY_ID, MODULES, TIER_HINT } from '../game/base'
import { runCommand, useGame } from '../game/store'
import { BODIES, type BodyId, solarFlux } from '../nasa/bodies'
import { bodyAbsState, len } from '../flight/orbit'
import { modulePrice } from '../flight/world'

const fmt = (n: number) => Math.round(n).toLocaleString('tr-TR')
const spriteUrl = (s: string) => `/assets/colony/${s}.png`

interface Props {
  initialBody?: BodyId
  onNotify?: (text: string, kind?: 'info' | 'warn') => void
  onOpenTech?: () => void
}

/** Yüzey kolonisi: yapıları alttaki çubuktan sürükleyip yüzeydeki yuvalara bırak. */
export default function ColonyPanel({ initialBody = 'earth', onNotify }: Props) {
  const gs = useGame()
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
    for (const v of gs.vessels) if (v.landed && BODIES[v.bodyId]?.landable) ids.add(v.bodyId)
    return [...ids]
  }, [gs.bases, gs.vessels])

  const body = BODIES[bodyId]
  const base = gs.bases[bodyId]
  const landedHere = gs.vessels.some((v) => v.landed && v.bodyId === bodyId)
  const canBuild = bodyId === 'earth' || landedHere || !!base
  const flux = solarFlux(len(bodyAbsState(bodyId, gs.time).r))
  const sites = base ? ensureSites(base) : Array.from({ length: COLONY_SLOTS }, () => null)
  const report = base ? baseReport(base, flux) : null
  const tier = colonyTier(base)
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
    else say('Yapı söküldü; bedelinin %60\'ı iade edildi.')
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
                  </>
                ) : (
                  <span className="colony-plus">＋</span>
                )}
              </button>
            )
          })}
        </div>
        {!canBuild && <div className="colony-locked">Buraya koloni kurmak için önce {body.name} yüzeyine bir araç indir.</div>}
      </div>

      <div className={`colony-info${feedback?.kind === 'warn' ? ' warn' : ''}`}>
        {selDef && selSlot !== null ? (
          <>
            <span><b>{selDef.name}</b> — {selDef.desc} {selPowered ? '' : 'Şu an elektrik yetmediği için çalışmıyor.'}</span>
            <button className="hud-btn" onClick={() => remove(selSlot)}>Sök (%60 iade)</button>
          </>
        ) : !powerOk ? (
          <span>⚡ Elektrik yetmiyor: {report!.unpowered} yapı durdu. {flux < 0.9 ? `Burada güneş ışığı yalnızca %${sunPct}; daha fazla panel ya da Reaktör kur.` : 'Güneş Paneli ekle.'}</span>
        ) : (
          <span>{feedback?.text ?? 'Bir yapıyı sürükleyip yüzeydeki boş yuvaya bırak. Yapılar koloninin elektriğiyle çalışır.'}</span>
        )}
      </div>

      <div className="colony-build">
        <h3>İnşaat</h3>
        <div className="colony-cards">
          {MODULES.filter((m) => bodyId !== 'earth' || EARTH_MODULES.includes(m.id)).map((m) => {
            const locked = bodyId !== 'earth' && m.tier > tier
            const stock = base?.stock?.[m.id] ?? 0
            const price = modulePrice(gs, bodyId, m.id)
            const afford = gs.money >= price
            const power = m.power > 0 ? m.power * (m.constantPower ? 1 : flux) : m.power
            const disabled = locked || !canBuild
            return (
              <button
                key={m.id}
                className={`colony-card${picked === m.id ? ' is-picked' : ''}${locked ? ' is-locked' : ''}${!afford && !locked ? ' is-poor' : ''}`}
                draggable={!disabled}
                disabled={disabled}
                title={locked ? TIER_HINT[m.tier] : m.desc}
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
                <small className={afford ? 'price' : 'price bad'}>{locked ? TIER_HINT[m.tier] : stock > 0 ? `Depoda: ${stock}` : `${fmt(price)} ₡`}</small>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
