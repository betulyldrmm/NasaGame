# Space Mission Design Game 🚀

NASA Space Apps Challenge 2026 için geliştirilmiş, **Fail-Forward (Hata Yap – Görsel Olarak Sonucunu Gör – Nedenini Öğren – Düzelt)** döngüsüne dayalı eğitici uzay görev tasarımı ve 2D kesit koloni yönetim oyunu.

## Öne Çıkan Özellikler

1. **Canlı Kalkış Gücü (TWR) ve Kütle Hesabı**:
   - $TWR = F_{itki} / (m_{toplam} \times 9.81\text{ m/s}^2)$ formülüyle çalışan canlı renkli ibre (`< 1.0` Kırmızı, `1.0–1.19` Sarı, `≥ 1.2` Yeşil).
2. **Ağırlık Merkezi (CoM) ve Basınç Merkezi (CoP) Dengesi**:
   - Roket şeması üzerinde canlı hareket eden **Sarı Daire (CoM)** ve **Mavi Üçgen (CoP)**. Kanatçık (Fin) eklenmezse roket atmosferde 5. saniyede takla atarak infilak eder.
3. **Tsiolkovsky Roket Denklemi ($\Delta v$) ve Yakıt Kütle Cezası**:
   - Küçük (1 yuva), Orta (2 yuva) ve Ağır Koloni (4 yuva) gövdeleri, farklı $I_{sp}$ motorları ve yakıt tankları.
4. **Gezegen Fiziği, Atmosfer/İniş ve $1/r^2$ Güneş Uzaklığı Yasası**:
   - **Ay (1.0 AU, 0 bar)**: Vakum nedeniyle paraşüt çalışmaz, Ters İtki Motoru gerekir.
   - **Mars (1.52 AU, 0.006 bar)**: Güneş paneli verimi %43.3'e düşer; Isı Kalkanı + Skycrane birlikte kullanılır.
   - **Europa (5.2 AU, 0 bar)**: Güneş paneli verimi %3.7'ye düşer; Nükleer Jeneratör (RTG) zorunludur.
5. **Kademeli Maliyet Kaybı, Ar-Ge ve Anti-Softlock**:
   - Rampada iptal/kalkamama durumunda yalnızca **%15 yakıt parası** yanar.
   - Keşfedilen her yeni hata türü **+35 Telemetri Bilim Puanı (XP)** kazandırır.
   - Bütçe bittiğinde **NASA Acil Araştırma Fonu (+450 ₡)** devreye girer.
6. **2D Kesit (Terraria Stili) Gezegen Koloni Üssü**:
   - Yüzey güneş/RTG hattı, biyo-kubbe sera katı, yaşam/komuta katı ve yeraltı maden galerisi. Net enerji eksiye düşerse koloni şalter indirir (`Blackout`).

## Komutlar

```sh
npm install
npm run dev
npm run build
npm test
```

## AI Ajanlar ve Geliştiriciler İçin Mimari

Projenin veri odaklı (`src/game/data.ts`) ve saf fizik fonksiyonlu (`evaluateMission` in `src/game/calculations.ts`) modüler yapısı hakkında detaylı bilgi için [AGENTS.md](AGENTS.md), [docs/design.md](docs/design.md) ve [docs/nasa-data-usage.md](docs/nasa-data-usage.md) dosyalarına bakın.
