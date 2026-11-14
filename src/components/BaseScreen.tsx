import { PAYLOADS } from '../game/data'
import { useEconomyStore } from '../economy/economyStore'
import { messages } from '../i18n/tr'
import { PLANETARY_REFERENCE } from '../data/planetaryReference'

interface BaseScreenProps {
  onHome: () => void
  onNewMission: () => void
}

function BaseCard({ destinationId }: { destinationId: 'moon' | 'mars' }) {
  const base = useEconomyStore((state) => state.bases[destinationId])
  const title = destinationId === 'moon' ? messages.moonBase : messages.marsBase
  const moduleCounts = PAYLOADS.map((payload) => ({
    ...payload,
    count: base.deliveredModules.filter((id) => id === payload.id).length,
  })).filter((payload) => payload.count > 0)
  const irradiance = PLANETARY_REFERENCE.solarIrradiance[destinationId]

  return <article className="base-card panel-card">
    <header><div><p className="eyebrow"><span/> {messages.colonyOutpost}</p><h2>{title}</h2></div><span className="base-turn">{messages.turnLabel} {base.completedTurns}</span></header>
    {moduleCounts.length === 0 ? <p className="base-empty">{messages.noModulesDelivered}</p> : <div className="base-modules">{moduleCounts.map((module) => <div className="base-module" key={module.id}>
      <span className={`cargo-swatch swatch-${module.id}`} aria-hidden="true"/><span>{module.name}</span><b>×{module.count}</b>
    </div>)}</div>}
    <div className="base-resource-grid">
      <div><span className="resource-icon energy">✦</span><span>{messages.energy}</span><b>{base.resources.energy}</b></div>
      <div><span className="resource-icon mineral">◆</span><span>{messages.minerals}</span><b>{base.resources.minerals}</b></div>
      <div><span className="resource-icon food">✿</span><span>{messages.food}</span><b>{base.resources.food}</b></div>
    </div>
    <div className="base-energy-status">
      <span>{messages.nasaIrradiance}: <b>{irradiance.valueWm2.toLocaleString('tr-TR')} W/m²</b></span>
      <span>{messages.solarProduction}: <b>{base.lastTurnEnergyProduced.toFixed(1)} {messages.energyUnit}</b></span>
      <span>{messages.energyDemand}: <b>{base.lastTurnEnergyDemand.toFixed(1)} {messages.energyUnit}</b></span>
    </div>
    {base.lastTurnEnergyShortfall > 0 && <p className="energy-shortfall-alert" role="status">{messages.lastTurnEnergyShortfall} {base.lastTurnEnergyShortfall.toFixed(1)} {messages.energyUnit}.</p>}
    <p className="base-production-note">{messages.turnBasedProduction}</p>
  </article>
}

function BaseScreen({ onHome, onNewMission }: BaseScreenProps) {
  const balanceCredits = useEconomyStore((state) => state.balanceCredits)
  const sciencePoints = useEconomyStore((state) => state.sciencePoints)
  const missions = useEconomyStore((state) => state.missions)
  const claimResearchSupport = useEconomyStore((state) => state.claimResearchSupport)
  const recentMissions = [...missions].reverse().slice(0, 5)

  return <div className="base-page">
    <header className="assembly-topbar">
      <button className="back-button" onClick={onHome}>← <span>{messages.home}</span></button>
      <a className="wordmark" href="#base"><span className="wordmark-icon">✦</span><span>MISSION CONTROL</span></a>
      <div className="budget-pill"><span>{messages.science}</span><b>{sciencePoints} SP</b></div>
    </header>
    <main className="base-layout">
      <section className="assembly-heading"><p className="eyebrow"><span/> {messages.colonyNetwork}</p><h1>{messages.bases}<span>.</span></h1><p>{messages.baseIntro}</p></section>
      <div className="base-economy-strip panel-card"><div><span>{messages.currentBudget}</span><b>{balanceCredits.toLocaleString('tr-TR')} cr</b></div><div><span>{messages.science}</span><b>{sciencePoints} SP</b></div><div><span>{messages.completedMissions}</span><b>{missions.filter((mission) => mission.status !== 'active').length}</b></div></div>
      {balanceCredits <= 0 && <div className="research-support"><p>{messages.supportOffer}</p><button className="button button-secondary" onClick={() => claimResearchSupport()}>{messages.claimSupport}</button></div>}
      <div className="base-grid"><BaseCard destinationId="moon"/><BaseCard destinationId="mars"/></div>
      <section className="mission-history panel-card"><div className="panel-heading"><div><span className="section-index">03</span><h2>{messages.missionHistory}</h2></div></div>
        {recentMissions.length === 0 ? <p className="base-empty">{messages.noMissionsYet}</p> : recentMissions.map((mission) => <div className="history-row" key={mission.id}>
          <span className={`history-status ${mission.status}`}/><div><b>{mission.destinationId === 'moon' ? messages.moon : messages.mars} · {mission.id.slice(0, 12)}</b><small>{messages[mission.status === 'succeeded' ? 'missionSucceededShort' : mission.status === 'failed' ? 'missionFailedShort' : mission.status === 'cancelled' ? 'missionCancelledShort' : 'missionActiveShort']}</small></div><span className="history-cost">{mission.costCredits} cr</span>
        </div>)}
      </section>
      <div className="base-actions"><button className="button button-secondary" onClick={onHome}>{messages.home}</button><button className="button button-primary" onClick={onNewMission}>{messages.newMission}</button></div>
    </main>
  </div>
}

export default BaseScreen
