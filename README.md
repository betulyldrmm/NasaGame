# Space Mission Design Game

NASA Space Apps Challenge 2026 için geliştirilen tarayıcı tabanlı uzay görevi tasarım oyunu.

## Gereksinimler

- Node.js 20.19+ veya 22.12+
- npm

## Komutlar

```sh
npm install
npm run dev
npm run build
npm test
```

## Faz 2: Roket tasarımı

Ana menüden **Yeni Görev** ile roket montaj ekranını açın. Gövde, motor ve yakıt tankı seçin; görev kargolarını kapasite sınırları içinde ekleyip çıkarın. Pixel-art roket önizlemesi, kütle, itki, TWR, maliyet ve kalan bütçe seçimlerle anlık güncellenir. Bu aşamada bütçe yalnızca kontrol edilir, harcanmaz.

## Faz 2.5: 2.5D roket önizlemesi

Montaj ekranı React Three Fiber ve Three.js ile sabit açılı, düşük poligonlu bir 2.5D roket sahnesi gösterir. Geometri, yumuşak gölgeler ve uzay arka planı seçimlere göre güncellenir; gövde, motor, yakıt tankı ve kargo görünüşü farklılaşır. Sahne `frameloop="demand"` ile yalnızca ihtiyaç olduğunda çizilir. WebGL kullanılamazsa önceki 2D SVG önizlemesi yedek olarak gösterilir. Bu önizleme uçuş fiziği içermez ve kamera döndürme kontrolleri sunmaz.

## Proje yapısı

- `src/game`: tipler, kataloglar, saf hesaplamalar ve Zustand montaj deposu
- `src/components`: montaj ekranı ve roket önizlemesi
- `src/visualization`: 2.5D model ölçülerini mevcut katalog seçimlerine eşleyen sunum verisi
- `src/flight`: saf dikey uçuş fiziği ve görev değerlendirmesi
- `src/i18n`: Türkçe arayüz metinleri
- `src`: React uygulaması ve Cosmic Mission stilleri
- `docs`: tasarım yol haritası ve NASA veri kullanım raporu

Parça kütleleri, itki ve kredi maliyetleri oyun varsayımlarıdır. NASA kaynakları ve bilimsel sınırlamalar için [NASA veri raporuna](docs/nasa-data-usage.md) bakın.

## Faz 3: fırlatma ve görev simülasyonu

Montaj ekranında **Görev uçuşuna geç** ile Ay veya Mars hedefi ve iniş sistemleri seçilir; **Fırlat** Phaser tabanlı dikey uçuşu başlatır. İrtifa, dikey hız ve yakıt HUD'da canlı güncellenir. Görev sonucu TWR, oyunlaştırılmış Delta‑V eşiği ve iniş sistemi kurallarını açıklar. Simülasyon 1D dikey yükseliştir; gerçek transfer yörüngesi veya gezegenler arası uçuş değildir.

Phaser sahnesi `src/flight/FlightScene.ts` içinde procedural placeholder görseller kullanır; `src/components/PhaserFlightView.tsx` React/Phaser yaşam döngüsünü yönetir. `npm test` fizik adımlarını ve görev değerlendirme kurallarını bileşenlerden bağımsız doğrular.
