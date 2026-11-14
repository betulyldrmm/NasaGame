# Space Mission Design Game 🚀

NASA Space Apps Challenge 2026 için geliştirilmiş, tarayıcıda çalışan **açık dünya yörünge mekaniği oyunu**. Kare grid üzerinde roketini kur, Dünya'dan kalk, yörüngeye yerleş, Ay'a ve Mars'a git, üs kur, maden getir.

## Özellikler

- **Grid tabanlı roket yapımı**: yakıt tankları, beş motor tipi, dikey ve yatay kademe adaptörleri, paraşüt, iniş ayağı, RCS, iyon motoru, batarya, açılır güneş paneli, kargo gövdesi.
- **Motor dengesi**: yüksek itkili motorlar çok yakıt yakar; verimli vakum motorları atmosferde güçsüzdür.
- **Gerçek yörünge mekaniği**: Kepler yörüngeleri, etki alanları (SOI), yerçekimi sapanı, Hohmann transfer penceresi.
- **Uzay haritası (M)**: izlenecek yol, enberi/öte nokta, karşılaşmalar; araca tıklayıp kontrolü devral.
- **Dünya, Ay, Mars**: NASA verisinden ölçeklenmiş boyut, çekim ve yörüngeler; engebeli yüzeyler.
- **Görevler ve ekonomi**: yörünge görevleri, Ay/Mars üssü, maden satışı, yeniden kullanılabilir roketler.

## Çalıştırma

```sh
npm install
npm run dev      # geliştirme (http://localhost:5173)
npm test         # fizik ve yörünge testleri
npm run build    # üretim derlemesi
npm run server   # Node.js sunucusu: derlemeyi sunar, kaydı saklar (http://localhost:8787)
```

Kayıt tarayıcıda (localStorage) tutulur; Node.js sunucusu çalışıyorsa oraya da yazılır.

## Kontroller

| Tuş | İşlev |
|---|---|
| W / S, Z, X | Gaz artır / azalt, tam gaz, motoru kes |
| A / D | Döndür |
| T | Yön kilidi: ileri / geri / radyal |
| Boşluk | Sıradaki kademeyi ayır |
| M | Uzay haritası |
| , / . | Zamanı yavaşlat / hızlandır |
| P, G, O | Paraşüt, iniş ayakları, güneş panelleri |
| R, sonra I J K L | RCS öteleme |
| Tab | Sonraki araca geç |

Parçaya tıklamak da çalışır: adaptör ayrılır, panel açılır, motor açılıp kapanır.

## Belgeler

- [NASA verisi entegrasyon raporu](docs/nasa-data-usage.md)
- [Tasarım özeti](docs/design.md)
- [Mimari rehberi](AGENTS.md)
