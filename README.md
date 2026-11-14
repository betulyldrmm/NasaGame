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

## Proje yapısı

- `src/game`: tipler, kataloglar, saf hesaplamalar ve Zustand montaj deposu
- `src/components`: montaj ekranı ve roket önizlemesi
- `src/i18n`: Türkçe arayüz metinleri
- `src`: React uygulaması ve Cosmic Mission stilleri
- `docs`: tasarım yol haritası ve NASA veri kullanım raporu

Parça kütleleri, itki ve kredi maliyetleri oyun varsayımlarıdır. NASA kaynakları ve bilimsel sınırlamalar için [NASA veri raporuna](docs/nasa-data-usage.md) bakın.
