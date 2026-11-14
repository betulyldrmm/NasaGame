# Space Mission Design Game — Mimari ve Tasarım Yol Haritası

## Tamamlanan Özellikler (Faz 1 + Faz 2)

- **Modüler Roket Montaj Ekranı (VAB)**: Gövde (1, 2, 4 kargo yuvalı), motor, yakıt tankı, aerodinamik kanatçık (Fin), iniş sistemi ve koloni modülü seçimi.
- **Canlı Kalkış Gücü (TWR) İbresi**: `< 1.0` Kırmızı (Kalkamaz), `1.0–1.19` Sarı (Riskli/Yavaş), `≥ 1.2` Yeşil (Güvenli Kalkış).
- **Ağırlık Merkezi (CoM - Sarı Daire) ve Basınç Merkezi (CoP - Mavi Üçgen)**: Roket şeması üzerinde canlı hareket eden denge sembolleri ve T+5. saniyede atmosferik takla (spin) mekaniği.
- **Tsiolkovsky Roket Denklemi ve Delta-V**: $\Delta v = I_{sp} \times g_0 \times \ln(m_0 / m_f)$ hesabı ve transfer yörüngesinde yakıt bitmesi simülasyonu.
- **Gezegen Atmosferleri, Yerçekimleri ve $1/r^2$ Güneş Yasası**:
  - Dünya LEO ($9.81\text{ m/s}^2$, $1.0\text{ AU}$)
  - Ay ($1.62\text{ m/s}^2$, $1.0\text{ AU}$, 0 bar vakum — paraşüt çalışmaz, ters itki gerekir)
  - Mars ($3.71\text{ m/s}^2$, $1.52\text{ AU}$, $\%43.3$ güneş verimi, ince atmosfer — ısı kalkanı + skycrane gerekir)
  - Europa ($1.315\text{ m/s}^2$, $5.20\text{ AU}$, $\%3.7$ güneş verimi — RTG nükleer jeneratör ve ters itki gerekir)
- **60 FPS HTML5 Canvas Uçuş Simülatörü**: Paralaks yıldız katmanları, rampa duman/sarsıntı efekti, rampa iptal (`Pad Abort`) butonu, T+5s takla ve infilak, yörünge transferi ve yüzey inişi.
- **Ekonomi, Kademeli Maliyet Kaybı ve Anti-Softlock**:
  - Rampada iptal veya kalkamama durumunda yalnızca **%15 yakıt maliyeti** yanar.
  - Uçuş sırasında patlama/kaybolmada **%100 üretim maliyeti** kaybedilir.
  - Her yeni hata türü **+35 Telemetri Bilim Puanı (XP)** kazandırır (Ar-Ge laboratuvarında yeni motorlar ve RTG açılır).
  - Bütçe bittiğinde **NASA Acil Araştırma Fonu (+450 ₡)** devreye girer.
- **2D Kesit (Terraria Stili) Gezegen Koloni Üssü**: Yüzey enerji hattı, biyo-kubbe sera katı, yaşam/komuta katı ve yeraltı maden galerisi; net enerji $< 0$ olduğunda **Blackout (Şalter İndirme)** mekaniği.
