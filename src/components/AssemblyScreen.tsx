import { useMemo, useState, type CSSProperties } from 'react'
import { INITIAL_BUDGET_CREDITS, FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import { calculateRocketCost } from '../game/calculations'
import { calculateAssemblyTWR, getPayload, getRocketConfiguration, isOverBudget, useRocketAssembly } from '../game/assemblyStore'
import type { PayloadId, RocketBody, RocketEngine } from '../game/types'
import { messages } from '../i18n/tr'

interface AssemblyScreenProps {
  onBack: () => void
}

function RocketPreview({ body, engine, payloadIds }: { body: RocketBody; engine: RocketEngine; payloadIds: PayloadId[] }) {
  const bodyHeight = 130 + body.cargoSlots * 18
  const bodyTop = 215 - bodyHeight
  const engineWidth = engine.id === 'engine-titan' ? 60 : engine.id === 'engine-voyager' ? 48 : 36
  const engineLeft = (300 - engineWidth) / 2
  const engineColor = engine.id === 'engine-titan' ? '#FFAD57' : engine.id === 'engine-voyager' ? '#8298B8' : '#38D9E8'
  const cargoColors: Record<PayloadId, string> = { 'solar-panel': '#38D9E8', rover: '#FFAD57', greenhouse: '#4ADE80', habitat: '#C4A7FF' }

  return <div className="rocket-stage" aria-label={`${body.name} gövde, ${engine.name} motor, ${payloadIds.length} kargo`}>
    <div className="preview-grid" />
    <div className="pixel-satellite satellite-left">✦</div><div className="pixel-satellite satellite-right">·</div>
    <svg className="rocket-svg" viewBox="0 0 300 300" role="img" aria-label="Seçilen parçalara göre değişen piksel roket önizlemesi" shapeRendering="crispEdges">
      <defs><linearGradient id="rocketHull" x1="0" x2="1"><stop stopColor="#9CAECC"/><stop offset=".5" stopColor="#F3F7FF"/><stop offset="1" stopColor="#7085A6"/></linearGradient></defs>
      {/* exhaust pixels */}
      <rect x="132" y="232" width="12" height="12" fill={engineColor}/><rect x="144" y="244" width="12" height="12" fill="#FB7185"/><rect x="156" y="232" width="12" height="12" fill={engineColor}/>
      <rect x={150 - engineWidth / 4} y="226" width={engineWidth / 2} height="12" fill={engineColor}/>
      {/* fins and engine scale with selected engine */}
      <rect x="106" y="203" width="24" height="24" fill="#E45B69"/><rect x="174" y="203" width="24" height="24" fill="#E45B69"/>
      <rect x={engineLeft} y="208" width={engineWidth} height={engine.id === 'engine-titan' ? 24 : 18} fill={engineColor}/><rect x={engineLeft + 6} y="215" width={engineWidth - 12} height="14" fill="#243653"/>
      {/* rocket body */}
      <path d={`M150 ${bodyTop - 42} L174 ${bodyTop} H126 Z`} fill="#FFAD57"/><rect x="144" y={bodyTop - 10} width="12" height="14" fill="#FFE0A8"/>
      <rect x="120" y={bodyTop} width="60" height={bodyHeight} fill="url(#rocketHull)"/>
      <rect x="114" y={bodyTop + 10} width="72" height="12" fill="#C3D2E8"/><rect x="114" y="198" width="72" height="12" fill="#879BB9"/>
      <rect x="132" y={bodyTop + 32} width="36" height="31" fill="#172A49"/><rect x="138" y={bodyTop + 38} width="24" height="19" fill="#38D9E8"/>
      <rect x="144" y={bodyTop + 44} width="12" height="7" fill="#A6F2F5"/>
      {Array.from({ length: body.cargoSlots }, (_, index) => <rect key={index} x="126" y={bodyTop + 72 + index * 15} width="48" height="9" fill={index % 2 === 0 ? '#D0D9E8' : '#B4C1D7'}/>) }
      <rect x="124" y={bodyTop + 68} width="4" height={bodyHeight - 72} fill="#FFAD57"/><rect x="172" y={bodyTop + 68} width="4" height={bodyHeight - 72} fill="#FFAD57"/>
      {/* fitted cargo chips */}
      {payloadIds.slice(0, body.cargoSlots).map((id, index) => <g key={`${id}-${index}`}>
        <rect x={index % 2 === 0 ? 42 : 204} y={bodyTop + 75 + Math.floor(index / 2) * 30} width="42" height="27" fill="#243653" stroke={cargoColors[id]} strokeWidth="3"/>
        <rect x={index % 2 === 0 ? 48 : 210} y={bodyTop + 81 + Math.floor(index / 2) * 30} width="15" height="15" fill={cargoColors[id]}/>
        <rect x={index % 2 === 0 ? 66 : 228} y={bodyTop + 84 + Math.floor(index / 2) * 30} width="12" height="4" fill="#F3F7FF"/>
      </g>)}
      <rect x="0" y="268" width="300" height="2" fill="#8294B040"/>
    </svg>
    <div className="preview-caption"><span>PIXEL VEHICLE // 01</span><span>{body.cargoSlots} CARGO SLOT{body.cargoSlots > 1 ? 'S' : ''}</span></div>
  </div>
}

function AssemblyScreen({ onBack }: AssemblyScreenProps) {
  const { bodyId, engineId, fuelTankId, payloadIds, selectBody, selectEngine, selectFuelTank, addPayload, removePayload } = useRocketAssembly()
  const [feedback, setFeedback] = useState('')
  const configuration = useMemo(() => getRocketConfiguration({ bodyId, engineId, fuelTankId, payloadIds }), [bodyId, engineId, fuelTankId, payloadIds])
  const cost = calculateRocketCost(configuration)
  const remaining = INITIAL_BUDGET_CREDITS - cost
  const twr = calculateAssemblyTWR(configuration)
  const overBudget = isOverBudget(configuration)
  const twrState = twr < 1 ? 'danger' : twr < 1.2 ? 'warning' : 'success'
  const twrLabel = twr < 1 ? messages.twrLow : twr < 1.2 ? messages.twrRisky : messages.twrReady

  const handleAddPayload = (id: PayloadId) => {
    if (!addPayload(id)) {
      setFeedback(messages.capacityReached)
      return
    }
    setFeedback(messages.payloadAdded)
  }

  return <div className="assembly-page">
    <header className="assembly-topbar">
      <button className="back-button" onClick={onBack} aria-label={messages.backToMenu}>← <span>{messages.backToMenu}</span></button>
      <a className="wordmark" href="#assembly"><span className="wordmark-icon">✦</span><span>MISSION CONTROL</span></a>
      <div className="budget-pill"><span>{messages.budget}</span><b>{INITIAL_BUDGET_CREDITS.toLocaleString('tr-TR')} cr</b></div>
    </header>

    <main className="assembly-layout">
      <section className="assembly-heading">
        <p className="eyebrow"><span /> {messages.assemblyEyebrow}</p>
        <h1>{messages.assemblyTitle}<span>.</span></h1>
        <p>{messages.assemblyIntro}</p>
      </section>

      <div className="assembly-columns">
        <section className="build-panel panel-card" aria-label={messages.partsTitle}>
          <div className="panel-heading"><div><span className="section-index">01</span><h2>{messages.partsTitle}</h2></div><span className="selection-count">{payloadIds.length}/{configuration.body.cargoSlots}</span></div>

          <fieldset className="part-group">
            <legend>{messages.bodyLabel}<span>{messages.structureHint}</span></legend>
            <div className="choice-grid body-choices">{ROCKET_BODIES.map((body) => <button key={body.id} className={`choice-card ${body.id === bodyId ? 'selected' : ''}`} onClick={() => { selectBody(body.id); setFeedback(messages.bodyChanged) }} aria-pressed={body.id === bodyId}>
              <span className="mini-body" style={{ '--slots': body.cargoSlots } as CSSProperties}><i /></span><span className="choice-text"><b>{body.name}</b><small>{body.cargoSlots} {messages.cargoSlots} · {body.dryMassKg.toLocaleString('tr-TR')} kg</small></span><span className="choice-price">{body.costCredits} cr</span>
            </button>)}</div>
          </fieldset>

          <fieldset className="part-group">
            <legend>{messages.engineLabel}<span>{messages.thrustHint}</span></legend>
            <div className="choice-grid engine-choices">{ROCKET_ENGINES.map((engine) => <button key={engine.id} className={`choice-card engine-card ${engine.id === engineId ? 'selected' : ''}`} onClick={() => { selectEngine(engine.id); setFeedback(messages.engineChanged) }} aria-pressed={engine.id === engineId}>
              <span className="engine-glyph">▰<i>▾</i></span><span className="choice-text"><b>{engine.name}</b><small>{(engine.thrustN / 1_000).toLocaleString('tr-TR')} kN · {engine.dryMassKg} kg</small></span><span className="choice-price">{engine.costCredits} cr</span>
            </button>)}</div>
          </fieldset>

          <fieldset className="part-group select-group">
            <legend>{messages.tankLabel}<span>{messages.fuelHint}</span></legend>
            <select value={fuelTankId ?? ''} onChange={(event) => { selectFuelTank(event.target.value || null); setFeedback(messages.tankChanged) }} aria-label={messages.tankLabel}>
              <option value="">{messages.noTank}</option>
              {FUEL_TANKS.map((tank) => <option key={tank.id} value={tank.id}>{tank.name} · {tank.fuelMassKg.toLocaleString('tr-TR')} kg yakıt · {tank.costCredits} cr</option>)}
            </select>
          </fieldset>

          <fieldset className="part-group cargo-group">
            <legend>{messages.cargoLabel}<span>{messages.cargoHint}</span></legend>
            <div className="cargo-options">{PAYLOADS.map((payload) => {
              const canAdd = payloadIds.length < configuration.body.cargoSlots
              return <button key={payload.id} className="cargo-option" onClick={() => handleAddPayload(payload.id)} disabled={!canAdd}>
                <span className={`cargo-swatch swatch-${payload.id}`} aria-hidden="true"/><span className="cargo-option-copy"><b>{payload.name}</b><small>{payload.massKg} kg · {payload.costCredits} cr</small></span><span className="add-icon" aria-hidden="true">＋</span>
              </button>
            })}</div>
            <div className="cargo-manifest"><div className="manifest-title">{messages.manifest}<span>{payloadIds.length}/{configuration.body.cargoSlots}</span></div>
              {payloadIds.length === 0 ? <p className="empty-manifest">{messages.emptyCargo}</p> : payloadIds.map((id, index) => <div className="manifest-row" key={`${id}-${index}`}><span>{getPayload(id).name}</span><span>+{getPayload(id).massKg} kg</span><button onClick={() => { removePayload(index); setFeedback(messages.payloadRemoved) }} aria-label={`${getPayload(id).name} ${messages.remove}`}>×</button></div>)}
            </div>
          </fieldset>
        </section>

        <aside className="readout-column">
          <section className="preview-panel panel-card"><div className="panel-heading"><div><span className="section-index">02</span><h2>{messages.previewTitle}</h2></div><span className="live-tag"><i /> LIVE</span></div>
            <RocketPreview body={configuration.body} engine={configuration.engine} payloadIds={payloadIds}/>
            <div className="rocket-summary"><span>{configuration.body.name}</span><span>+</span><span>{configuration.engine.name}</span>{configuration.fuelTank && <><span>+</span><span>{configuration.fuelTank.name}</span></>}</div>
          </section>

          <section className="performance-panel panel-card"><div className="panel-heading"><div><span className="section-index">03</span><h2>{messages.performanceTitle}</h2></div></div>
            <div className="twr-readout"><div><span>{messages.twrLabel}</span><b className={`twr-value ${twrState}`}>{twr.toFixed(2)}</b></div><div className={`twr-badge ${twrState}`}><i />{twrLabel}</div></div>
            <div className="twr-track"><span className={`twr-fill ${twrState}`} style={{ width: `${Math.min(twr / 2, 1) * 100}%` }}/><i className="threshold threshold-one"/><i className="threshold threshold-two"/></div>
            <div className="metric-list">
              <div><span>{messages.massLabel}</span><b>{configuration.totalMassKg.toLocaleString('tr-TR')} <small>kg</small></b></div>
              <div><span>{messages.thrustLabel}</span><b>{(configuration.engine.thrustN / 1_000).toLocaleString('tr-TR')} <small>kN</small></b></div>
              <div><span>{messages.costLabel}</span><b className={overBudget ? 'over-budget' : ''}>{cost.toLocaleString('tr-TR')} <small>cr</small></b></div>
              <div className={overBudget ? 'budget-warning-row' : ''}><span>{messages.remainingLabel}</span><b className={overBudget ? 'over-budget' : ''}>{remaining.toLocaleString('tr-TR')} <small>cr</small></b></div>
            </div>
            {overBudget && <div className="alert-box budget-alert"><span>!</span><p>{messages.budgetExceeded}</p></div>}
            {twr < 1 && <div className="alert-box"><span>!</span><p>{messages.engineTooWeak}</p></div>}
            {twr >= 1 && twr < 1.2 && <div className="alert-box budget-alert"><span>!</span><p>{messages.twrRiskAdvice}</p></div>}
            {feedback && <p className="feedback-note" role="status">✦ {feedback}</p>}
            <details className="why-details"><summary>{messages.whyTitle}</summary><p>{messages.twrExplanation}</p><p>{messages.twrDisclaimer}</p></details>
          </section>
        </aside>
      </div>
      <footer className="assembly-footer"><span>SPACE MISSION DESIGN GAME</span><span>{messages.phaseTwo}</span></footer>
    </main>
  </div>
}

export default AssemblyScreen
