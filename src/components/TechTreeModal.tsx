import { FUEL_TANKS, PAYLOADS, ROCKET_BODIES, ROCKET_ENGINES } from '../game/data'
import { useGameStore } from '../game/store'

export function TechTreeModal() {
  const { activeModal, setActiveModal, scienceXP, unlockedIds, unlockTechItem, discoveredFailures } =
    useGameStore()

  if (activeModal !== 'TECH_TREE') return null

  const unlockables = [
    ...ROCKET_ENGINES.filter((e) => (e.unlockScienceCost ?? 0) > 0).map((e) => ({
      id: e.id,
      name: e.name,
      category: 'İtki Motoru',
      description: e.description ?? '',
      cost: e.unlockScienceCost ?? 0,
      stats: `İtki: ${(e.thrustN / 1000).toFixed(0)} kN · Isp: ${e.ispSeconds} s`,
    })),
    ...PAYLOADS.filter((p) => (p.unlockScienceCost ?? 0) > 0).map((p) => ({
      id: p.id,
      name: p.name,
      category: 'Derin Uzay Enerji Modülü',
      description: p.description ?? '',
      cost: p.unlockScienceCost ?? 0,
      stats: `Sabit +${p.energyOutputAt1AU} Enerji (1/r² Bağımsız!) · Kütle: ${p.massKg} kg`,
    })),
    ...FUEL_TANKS.filter((t) => (t.unlockScienceCost ?? 0) > 0).map((t) => ({
      id: t.id,
      name: t.name,
      category: 'Kriyojenik Yakıt Tankı',
      description: t.description ?? '',
      cost: t.unlockScienceCost ?? 0,
      stats: `Yakıt: ${t.fuelMassKg} kg · Kuru: ${t.dryMassKg} kg`,
    })),
    ...ROCKET_BODIES.filter((b) => (b.unlockScienceCost ?? 0) > 0).map((b) => ({
      id: b.id,
      name: b.name,
      category: 'Kompozit Gövde',
      description: b.description ?? '',
      cost: b.unlockScienceCost ?? 0,
      stats: `${b.cargoSlots} Kargo Yuvası · Kuru: ${b.dryMassKg} kg`,
    })),
  ]

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="tech-tree-title" onClick={() => setActiveModal(null)}>
      <section className="wide-modal" onClick={(e) => e.stopPropagation()}>
        <button className="dialog-close" aria-label="Kapat" onClick={() => setActiveModal(null)}>
          ×
        </button>

        <div className="modal-top-row">
          <div>
            <p className="eyebrow"><span /> TELEMETRİ VE AR-GE LABORATUVARI</p>
            <h2 id="tech-tree-title">Mühendislik Teknolojileri ve Kilit Açma</h2>
          </div>
          <div className="xp-pill-large">
            Mevcut Telemetri Bilim Puanı: <strong>{scienceXP} XP</strong>
          </div>
        </div>

        <p className="modal-lead">
          Roketiniz patlasa veya yörüngede kalsa bile karşılaştığınız her yeni hata türü size <b>+35 Telemetri Bilim Puanı (XP)</b> kazandırır!
          Keşfedilen Hata Türü Sayısı: <b>{discoveredFailures.length}</b>.
        </p>

        <div className="tech-grid">
          {unlockables.map((item) => {
            const isUnlocked = unlockedIds.includes(item.id)
            const canUnlock = !isUnlocked && scienceXP >= item.cost
            return (
              <div key={item.id} className={`tech-card ${isUnlocked ? 'tech-unlocked' : ''}`}>
                <div className="tech-card-head">
                  <span className="tech-cat">{item.category}</span>
                  <span className={`tech-status ${isUnlocked ? 'unlocked' : ''}`}>
                    {isUnlocked ? '✓ AÇILDI' : `${item.cost} XP`}
                  </span>
                </div>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div className="tech-stats-line">{item.stats}</div>

                <button
                  type="button"
                  className={`button ${isUnlocked ? 'button-secondary' : 'button-primary'} tech-btn`}
                  disabled={isUnlocked || !canUnlock}
                  onClick={() => unlockTechItem(item.id, item.cost)}
                >
                  {isUnlocked
                    ? '✓ Envanterde Aktif'
                    : canUnlock
                      ? `🔓 Kilidi Aç (-${item.cost} XP)`
                      : `Yetersiz Bilim Puanı (${scienceXP}/${item.cost} XP)`}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
