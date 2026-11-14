# Space Mission Design Game

NASA Space Apps Challenge 2026 için geliştirilen, roket tasarımı ve basitleştirilmiş görev fiziği öğreten tarayıcı oyunu.

## Proje açıklaması

**TR:** Parçalarını seç, roketini fırlat ve Ay/Mars görevlerinin fiziğini, maliyetini ve sonuçlarını keşfet. Bilimsel olgular ile oyun varsayımları ayrı gösterilir.

**EN:** Build a rocket, launch missions, and explore simplified flight, budget, and colony systems for the Moon and Mars. Verified science is distinguished from gameplay assumptions.

## Teknolojiler

React 19, TypeScript (strict), Vite, Zustand, Phaser 3, Three.js/React Three Fiber, CSS, Vitest. Oyun durumu sunucuya gönderilmez; ekonomi ilerlemesi LocalStorage'da saklanır.

## Kurulum

Gereksinim: Node.js 20.19+ veya 22.12+, npm.

```sh
npm install
npm run dev
npm run build
npm test
```

## Oyun döngüsü

1. Ana menüden roket montajına geçin; gövde, motor, yakıt tankı ve kargoyu seçin. 2.5D önizleme ve kütle/TWR/maliyet değerleri anlık güncellenir.
2. Görev ekranında Ay veya Mars'ı ve iniş sistemlerini seçip görevi başlatın. Üretim maliyeti o anda ödenir; yetersiz bakiye fırlatmayı engeller.
3. Phaser ile dikey uçuşu izleyin. Bu bir 1D eğitim simülasyonudur; gezegenler arası uçuş veya gerçek yörünge çözümü değildir.
4. Sonuç ekranı TWR, oyun Delta‑V hedefi ve iniş donanımını açıklar. Başarı bir kez +100 kredi/+150 bilim puanı verir ve hedef üste kargoyu ulaştırır. Rampada iptal %15 maliyet kaybettirir; uçuşta kayıp üretim maliyetinin tamamını kaybettirir.
5. Üs ekranında Ay/Mars'a ulaştırılan modülleri ve görev tamamlandığında işleyen tur bazlı enerji/mineral/gıda üretimini inceleyin.

Görev panelindeki yörünge haritası NASA/JPL Horizons'un 2026-11-14 TDB epoch'lu Güneş merkezli Dünya/Mars elemanlarından yaklaşık Kepler konumları üretir. Tarih kaydırıcısı bu osculating elemanları iki cisimli modelle ilerletir; transfer rotası göstermez. Ay, ayrı Dünya merkezli veri olmadığı için Güneş çevresinde çizilmez.

Güneş paneli enerjisi hedef ışınımına göre ölçeklenir: NASA kaynaklı Dünya/Mars W/m² oranı oyun içi soyut enerji/tur birimine çevrilir. Panel başına 20 birim/Dünya ışınımı tabanı ve rover/sera/yaşam modülü enerji tüketimleri oyun varsayımıdır. Açık oluşursa üs üretimi o tur durur ve arayüz nedenini açıklar. JSON kaynakları, JPL epoch/koordinat metaverisi ve veri akışı [NASA veri raporunda](docs/nasa-data-usage.md) açıklanır.

Roket parça istatistikleri, ekonomi ödülleri, araştırma desteği ve kaynak üretim oranları oyunlaştırılmış tasarım değerleridir; NASA verisi değildir. Bilimsel kaynaklar ve sınırlar [NASA veri kullanım raporunda](docs/nasa-data-usage.md) listelenir.

## Proje yapısı

- `src/game`: tipler, parça kataloğu, saf hesaplamalar ve montaj durumu
- `src/visualization`: 2.5D roket sunum modeli
- `src/flight`: Phaser sahnesi, saf dikey fizik ve görev değerlendirmesi
- `src/economy`: ekonomi kuralları ve LocalStorage ile kalıcı Zustand deposu
- `src/components`: montaj, uçuş ve üs ekranları
- `src/i18n`: arayüz metinleri
- `docs`: tasarım, kaynak kullanımı, demo metni ve teslim kontrol listesi

## Bilinen sınırlılıklar

- Uçuş Dünya'dan dikey 1D yükseliştir. Ay/Mars seçimi görevin fiziksel olarak oraya uçtuğunu simüle etmez; görev değerlendirmesi basitleştirilmiş senaryo eşikleri kullanır.
- Atmosfer, iniş sistemi, motor ve Delta‑V modelleri görev tasarımı veya uçuş güvenliği için uygun değildir.
- Yerel kayıt yalnızca aynı tarayıcı profili/origin içinde tutulur; cihazlar arası senkronizasyon yoktur.
- Üs kaynak üretimi gerçek zamanlı değil, yalnızca başarılı görev tamamlandığında ilerler.
- Phaser ve 3D önizleme paket boyutları yükleme performansını etkileyebilir; Vite üretim çıktısı bu konuda uyarı verebilir.

## Demo ve teslim

- [2–3 dakikalık demo akışı](docs/demo-script.md)
- [Teslim öncesi kontrol listesi](docs/submission-checklist.md)
