import { useGameStore } from '../game/store'

/**
 * Post-flight Educational Learning Card Modal ("Fail-Forward" loop).
 * Displays what happened, the underlying rocket/planetary physics principle,
 * how to fix it, progressive cost loss (15% vs 100%), Telemetry Science XP earned,
 * and the official NASA NSSDC / JPL source citation for full hackathon jury points.
 */
export function LearningCardModal() {
  const { lastFlightReport, dismissFlightReport, setActiveModal } = useGameStore()
  if (!lastFlightReport) return null

  const {
    evaluation,
    learningCard,
    planet,
    costDeducted,
    rewardCreditsEarned,
    colonyIncomeCredits,
    scienceEarned,
    isNewFailureDiscovery,
    emergencyGrantTriggered,
    landedModulesCount,
  } = lastFlightReport

  const netCredits = rewardCreditsEarned + colonyIncomeCredits - costDeducted

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="learning-card-title">
      <section className={`learning-modal ${evaluation.isSuccess ? 'modal-success' : 'modal-failure'}`}>
        <div className="learning-modal-header">
          <span className={`learning-badge ${evaluation.isSuccess ? 'badge-ok' : 'badge-err'}`}>
            {learningCard.badge}
          </span>
          <span className="stage-tag">AŞAMA: {evaluation.failureStage === 'NONE' ? 'TAMAMLANDI' : evaluation.failureStage}</span>
        </div>

        <h2 id="learning-card-title">{learningCard.title}</h2>

        <div className="learning-grid">
          <div className="learning-box">
            <h4>🔭 Ne Oldu? (Gözlem)</h4>
            <p>{learningCard.whatHappened}</p>
          </div>

          <div className="learning-box">
            <h4>⚛️ Uzay Mühendisliği ve Fizik İlkesi</h4>
            <p>{learningCard.physicsPrinciple}</p>
            <code className="formula-chip">{learningCard.formulaText}</code>
          </div>

          <div className="learning-box learning-fix-box">
            <h4>🛠️ Nasıl Düzeltilir? (Mühendislik Çözümü)</h4>
            <p>{learningCard.howToFix}</p>
          </div>
        </div>

        {/* Financial & Telemetry XP Summary */}
        <div className="outcome-ledger">
          <div className="ledger-item">
            <span>Üretim / Yakıt Kaybı:</span>
            <strong style={{ color: '#FB7185' }}>
              -{costDeducted} ₡ ({evaluation.failureStage === 'LAUNCHPAD' ? '%15 Rampa Yakıtı' : '%100 Üretim'})
            </strong>
          </div>
          {rewardCreditsEarned > 0 && (
            <div className="ledger-item">
              <span>Görev Başarı Ödülü ({planet.name}):</span>
              <strong style={{ color: '#4ADE80' }}>+{rewardCreditsEarned} ₡</strong>
            </div>
          )}
          {colonyIncomeCredits > 0 && (
            <div className="ledger-item">
              <span>Aktif Koloni Geliri:</span>
              <strong style={{ color: '#38D9E8' }}>+{colonyIncomeCredits} ₡</strong>
            </div>
          )}
          <div className="ledger-item">
            <span>Net Bütçe Değişimi:</span>
            <strong style={{ color: netCredits >= 0 ? '#4ADE80' : '#FB7185' }}>
              {netCredits >= 0 ? `+${netCredits}` : netCredits} ₡
            </strong>
          </div>
          <div className="ledger-item">
            <span>Kazanılan Telemetri / Bilim Puanı:</span>
            <strong style={{ color: '#FACC15' }}>
              +{scienceEarned} XP {isNewFailureDiscovery ? '(🌟 Yeni Hata Türü Keşif Bonusu!)' : ''}
            </strong>
          </div>
        </div>

        {emergencyGrantTriggered && (
          <div className="grant-banner">
            <strong>🆘 NASA ACİL DURUM HİBESİ DEVREDE (+450 ₡):</strong> Kasadaki bütçeniz kritik seviyenin altına
            düştüğü için NASA Kurtarma Fonu hesabınıza 450 Kredi aktardı! Alçak Dünya Yörüngesine (LEO) ucuz bir
            Haberleşme Uydusu göndererek bütçenizi hızla toparlayabilirsiniz.
          </div>
        )}

        <div className="learning-footer">
          <span className="nasa-source-label">📡 {learningCard.nasaSource}</span>

          <div className="learning-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                dismissFlightReport(false)
                setActiveModal('TECH_TREE')
              }}
            >
              🔬 Ar-Ge Laboratuvarı
            </button>

            {evaluation.isSuccess && landedModulesCount > 0 && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => dismissFlightReport(true)}
              >
                🏙️ Koloni Üssünü Gör ({planet.name})
              </button>
            )}

            <button
              type="button"
              className="button button-primary"
              onClick={() => dismissFlightReport(false)}
            >
              🔧 Montaj Ekranına Dön ve Geliştir
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
