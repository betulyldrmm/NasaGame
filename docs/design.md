# Tasarım notları

## Faz 1 altyapısı

React + TypeScript + Vite uygulaması, oyun veri tipleri ve React'ten bağımsız kütle/TWR/maliyet hesaplamaları oluşturuldu. NASA kaynakları ve bilimsel sınırlamalar `nasa-data-usage.md` içindedir.

## Faz 2: roket montajı (uygulandı)

- Ana menüden montaj ekranına geçiş ve menüye dönüş.
- Katalog tabanlı gövde, motor, yakıt tankı ve kargo seçimi.
- Zustand ile montaj durumunun yönetimi; yapılandırma `RocketConfiguration` biçiminde Phaser sahnesine aktarılabilecek şekilde sunulur.
- Kargo yuvası sınırı ve gövde küçültülünce kapasiteye göre fazla kargonun çıkarılması.
- Her seçimde anlık toplam kütle, itki, Dünya yüzeyinde TWR, maliyet ve bütçe bakiyesi.
- TWR renk eşikleri: `< 1,0` kırmızı, `1,0–<1,2` sarı, `≥ 1,2` yeşil. Bu eşikler oyunlaştırılmış bilgilendirmedir; uçuş başarısını garanti etmez.
- Basit, kodla çizilmiş pixel-art roket önizlemesi; seçili gövde boyu ve kargo görünümü değişir.

Parça kütleleri, itki ve maliyetler oyun varsayımıdır. Başlangıç kredisi bu fazda harcanmaz.

## Faz 2.5: 2.5D roket önizlemesi (uygulandı)

- React Three Fiber + Three.js Canvas yalnızca roket önizleme alanında kullanılır; React 19 ile uyumlu Fiber v9 seçildi.
- Sabit ortografik kamera, düşük segmentli gövde/motor/koni geometrileri, parça halkaları, kargo şekilleri, ışık ve gölge ile 2.5D sunum.
- Gövde yuvası, motor tipi, yakıt tankı ve kargo görsel boyutları mevcut Zustand montaj seçimlerinden türetilir.
- Talep üzerine render; WebGL erişilemezse önceki SVG 2D önizlemesi gösterilir.
- Uçuş simülasyonu, orbit kamera kontrolü ve gameplay fiziği bu aşamada eklenmedi.

## Gelecek fazlar

- Gezegen seçimine bağlı TWR ve daha ayrıntılı görev bağlamı
- Delta-V kapasitesi
- Ay/Mars iniş sistemleri
- Phaser tabanlı 2D uçuş sahnesi
- Görev başarısı/başarısızlığı, ödül ve bütçe kaybı
- Koloni kurma ve kaynak üretimi

## Mimari yön

Katalog `src/game/data.ts`, tipler `src/game/types.ts`, saf hesaplamalar `src/game/calculations.ts`, Zustand montaj durumu `src/game/assemblyStore.ts` içindedir. React ekranı bunları tüketir; görsel sahne oyun durumunu kullanabilir ama React bileşenlerine bağımlı olmamalıdır. Arayüz metinleri `src/i18n` altında tutulur.
