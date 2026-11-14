import { PLANETS } from '../game/data'
import { useGameStore } from '../game/store'

export function EncyclopediaModal() {
  const { activeModal, setActiveModal } = useGameStore()

  if (activeModal !== 'ENCYCLOPEDIA') return null

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encyclopedia-title"
      onClick={() => setActiveModal(null)}
    >
      <section className="wide-modal" onClick={(e) => e.stopPropagation()}>
        <button className="dialog-close" aria-label="Kapat" onClick={() => setActiveModal(null)}>
          ×
        </button>

        <p className="eyebrow">
          <span /> NASA NSSDC PLANETARY FACT SHEET & MÜHENDİSLİK REHBERİ
        </p>
        <h2 id="encyclopedia-title">Roket Bilimi ve Gezegen Fiziği Başvuru Kılavuzu</h2>

        <div className="guide-showcase-row">
          <img
            src="/assets/rocket-blueprint-showcase.jpg"
            alt="Modüler roket ve uydu mimari şeması"
            className="guide-banner-img"
          />
          <img
            src="/assets/solar-system-banner.jpg"
            alt="Güneş sistemi transfer yörüngeleri"
            className="guide-banner-img"
          />
        </div>

        <div className="guide-cards-grid">
          <div className="guide-card">
            <h3>1. İtki / Ağırlık Oranı (TWR)</h3>
            <p>
              Roketin Dünya yüzeyinden kalkabilmesi için motor itkisinin toplam ağırlıktan büyük olması gerekir:
              <code>TWR = F_itki / (m_toplam × 9.81)</code>.
            </p>
            <p>
              <b>1.0 altı Kırmızı:</b> Rampadan kalkamaz (%15 yakıt yanar). <b>1.0–1.19 Sarı:</b> Riskli.{' '}
              <b>1.2+ Yeşil:</b> Güvenli kalkış.
            </p>
          </div>

          <div className="guide-card">
            <h3>2. Ağırlık (CoM) ve Basınç (CoP) Merkezi</h3>
            <p>
              Montaj şemasında <b>Sarı Daire (Ağırlık Merkezi - CoM)</b> her zaman{' '}
              <b>Mavi Üçgenin (Basınç Merkezi - CoP)</b> üstünde durmalıdır.
            </p>
            <p>
              Roketin altına <b>Dengeleyici Kanatçık (Fin)</b> eklediğinizde Mavi Üçgen aşağı çekilir ve 5. saniyedeki
              atmosferik takla (spin) önlenir.
            </p>
          </div>

          <div className="guide-card">
            <h3>3. Tsiolkovsky Denklemi ve Delta-V</h3>
            <p>
              Daha çok yakıt her zaman daha uzun menzil demek değildir; yakıtın kendisi de ağırdır:{' '}
              <code>Δv = Isp × g₀ × ln(m₀ / mf)</code>.
            </p>
            <p>
              Mars ve Europa gibi uzak hedefler için yüksek <b>Isp (Özgül İmpuls)</b> değerine sahip motorlar
              kullanılmalıdır.
            </p>
          </div>

          <div className="guide-card">
            <h3>4. Güneş Uzaklığı (1/r²) ve Atmosfer</h3>
            <p>
              1 AU’da 100 birim elektrik üreten Güneş Paneli, Mars’ta (1.52 AU) <b>43.3 birim</b>, Europa’da (5.2 AU) ise
              yalnızca <b>3.7 birim</b> üretir (RTG Nükleer Jeneratör gerekir!).
            </p>
            <p>
              Ay ve Europa’da atmosfer olmadığı için paraşüt çalışmaz (Ters İtki gerekir). Mars’ta ise Isı Kalkanı +
              Skycrane birlikte kullanılır.
            </p>
          </div>
        </div>

        <h3 className="table-heading">Doğrulanmış NASA NSSDC Gezegen Veri Tablosu</h3>
        <div className="nasa-table-wrap">
          <table className="nasa-table">
            <thead>
              <tr>
                <th>Gök Cismi</th>
                <th>Yerçekimi (g)</th>
                <th>Güneş Uzaklığı</th>
                <th>Güneş Verimi (1/r²)</th>
                <th>Atmosfer & İniş Kuralı</th>
                <th>Gerekli Δv</th>
              </tr>
            </thead>
            <tbody>
              {PLANETS.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.gravityMps2} m/s²</td>
                  <td>{p.distanceAU} AU</td>
                  <td>%{Math.round((100 / ((p.distanceAU ?? 1) ** 2)) * 10) / 10}</td>
                  <td>
                    {p.atmosphereType === 'VACUUM'
                      ? '0 bar Vakum (Ters İtki Şart, Paraşüt Çalışmaz)'
                      : p.atmosphereType === 'THIN'
                        ? '0.006 bar İnce CO₂ (Isı Kalkanı + Skycrane)'
                        : 'LEO Yörünge Salınımı (RCS)'}
                  </td>
                  <td>{p.requiredDeltaVMps} m/s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
