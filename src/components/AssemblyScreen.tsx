import { lazy, Suspense, useMemo, useState, type CSSProperties } from 'react'
import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import { calculateRocketCost } from '../game/calculations'
import { calculateAssemblyTWR, getPayload, getRocketConfiguration, useRocketAssembly } from '../game/assemblyStore'
import { useEconomyStore } from '../economy/economyStore'
import type { PayloadId } from '../game/types'
import { messages } from '../i18n/tr'
import RocketPreview2D from './RocketPreview2D'

const RocketPreview25D = lazy(() => import('./RocketPreview25D'))

interface AssemblyScreenProps {
  onBack: () => void
  onLaunch: () => void
}

function AssemblyScreen({ onBack, onLaunch }: AssemblyScreenProps) {
  const { bodyId, engineId, fuelTankId, payloadIds, selectBody, selectEngine, selectFuelTank, addPayload, removePayload } = useRocketAssembly()
  const balanceCredits = useEconomyStore((state) => state.balanceCredits)
  const claimResearchSupport = useEconomyStore((state) => state.claimResearchSupport)
  const [feedback, setFeedback] = useState('')
  const configuration = useMemo(() => getRocketConfiguration({ bodyId, engineId, fuelTankId, payloadIds }), [bodyId, engineId, fuelTankId, payloadIds])
  const cost = calculateRocketCost(configuration)
  const remaining = balanceCredits - cost
  const twr = calculateAssemblyTWR(configuration)
  const overBudget = cost > balanceCredits
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
      <div className="budget-pill"><span>{messages.budget}</span><b>{balanceCredits.toLocaleString('tr-TR')} cr</b></div>
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
            <Suspense fallback={<div className="preview-loading"><p>2.5D model yükleniyor…</p><RocketPreview2D body={configuration.body} engine={configuration.engine} payloadIds={payloadIds}/></div>}>
              <RocketPreview25D body={configuration.body} engine={configuration.engine} fuelTank={configuration.fuelTank} payloadIds={payloadIds}/>
            </Suspense>
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
            {balanceCredits <= 0 && <div className="research-support"><p>{messages.supportOffer}</p><button className="button button-secondary" onClick={() => claimResearchSupport()}>{messages.claimSupport}</button></div>}
            {twr < 1 && <div className="alert-box"><span>!</span><p>{messages.engineTooWeak}</p></div>}
            {twr >= 1 && twr < 1.2 && <div className="alert-box budget-alert"><span>!</span><p>{messages.twrRiskAdvice}</p></div>}
            {feedback && <p className="feedback-note" role="status">✦ {feedback}</p>}
            <details className="why-details"><summary>{messages.whyTitle}</summary><p>{messages.twrExplanation}</p><p>{messages.twrDisclaimer}</p></details>
            <button className="button button-primary launch-from-assembly" onClick={onLaunch}><span>▲</span> {messages.continueToLaunch}</button>
          </section>
        </aside>
      </div>
      <footer className="assembly-footer"><span>SPACE MISSION DESIGN GAME</span><span>{messages.phaseTwo}</span></footer>
    </main>
  </div>
}

export default AssemblyScreen
