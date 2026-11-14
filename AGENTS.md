# Mimari ve Katkı Rehberi (`AGENTS.md`)

**NASA Space Apps Challenge 2026 — Space Mission Design Game**: veri odaklı, saf fizikli, açık dünya yörünge oyunu.

## 1. Temel kurallar

1. **Veri odaklı katalog**: Roket parçaları `src/game/data.ts` içindeki `PARTS` dizisinde, üs modülleri `src/game/base.ts` içindeki `MODULES` dizisinde, gök cisimleri `src/nasa/bodies.ts` içindedir. Yeni parça eklemek için diziye tek bir nesne ekle; çizimi `src/render/partArt.ts` içinde `kind` değerine göre seçilir.
2. **UI'dan bağımsız saf fizik**: Formüller React bileşenlerine yazılmaz.
   - `src/flight/orbit.ts` — Kepler matematiği (`elementsFromState`, `propagate`, `hohmann`).
   - `src/flight/physics.ts` — araç adımı (`stepPhysics`), atmosfer, arazi, iniş.
   - `src/flight/world.ts` — dünya adımı (`stepWorld`), SOI geçişleri, kademe ayırma, oyuncu eylemleri.
   - `src/flight/predict.ts` — yörünge tahmini.
   - `src/game/vessel.ts` — grid bağlantısı, yakıt grupları, motorlar, Δv.
3. **NASA sabitleri tek yerde**: Gerçek değerler `REAL`, ölçek kararları `SCALE` içinde durur. Değişiklikler `docs/nasa-data-usage.md` raporuna işlenir.
4. **Görseller prosedürel ve 2.5D**: Parçalar ve gezegenler Canvas 2D gradyanlarıyla çizilir (`src/render/`). Piksel-art kuralı kaldırılmıştır.
5. **Birimler**: metre, saniye, ton, kilonewton; 1 grid karesi = 1 m.

## 2. Dizin haritası

- `src/nasa/bodies.ts` — NASA verisi ve oyun ölçeği.
- `src/flight/` — fizik, yörünge, dünya simülasyonu, testler.
- `src/game/` — tipler, parça kataloğu, araç yapısı, görevler, üs ekonomisi, kayıt (`store.ts`).
- `src/render/` — parça çizimleri ve uçuş/harita çizimi.
- `src/components/` — `BuilderScreen` (grid montaj), `FlightScreen` (uçuş, harita, HUD, paneller), `IntroCutscene`.
- `server/index.mjs` — bağımlılıksız Node.js sunucusu (statik dosyalar + `/api/save`).

## 3. Doğrulama

Değişiklikten sonra `npm test` ve `npm run build` çalıştır. `src/flight/sim.test.ts` hazır roketin yörüngeye ve Ay'a ulaşabildiğini sınar; parça dengesini değiştirirsen bu test bozulabilir.
