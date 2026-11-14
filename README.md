# Space Mission Design Game

NASA Space Apps Challenge 2026 için tarayıcıda çalışacak eğitici uzay görev tasarım oyununun Faz 1 başlangıç altyapısı.

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

## Yapı

- `src/game`: oyun tipleri, başlangıç verileri ve saf hesaplamalar
- `src/i18n`: arayüz metinleri
- `src`: React uygulaması ve stiller
- `docs`: tasarım yol haritası ve NASA veri kullanım kaydı

NASA kaynakları, varsayımlar ve bilimsel sınırlılıklar için [docs/nasa-data-usage.md](docs/nasa-data-usage.md) dosyasına bakın. Gelecek özellikler [docs/design.md](docs/design.md) içindedir.
