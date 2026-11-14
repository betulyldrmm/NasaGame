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

## Faz 3: roket fırlatma ve görev simülasyonu (uygulandı)

- Montaj ekranından görev kurulumuna, Phaser Canvas sahnesine ve sonuç/öğrenme kartlarına geçiş.
- Phaser ile prosedürel 2D/2.5D pixel-art kalkış rampası, roket, motor alevi, parçacıklar ve irtifayla hareket eden parallax katmanları.
- Saf `src/flight/physics.ts` fonksiyonlarında sabit zaman adımlı 1D dikey hareket; başlangıç TWR kontrolü, azalan yakıt/kütle, Dünya yerçekimi ve yaklaşık hava sürüklemesi.
- Görev değerlendirmesi `src/flight/mission.ts` içinde: TWR, oyun Delta‑V eşiği, hedef yerçekimi ve Ay/Mars iniş donanımı.
- Phaser sahnesi React'ten bağımsız; React HUD callbacks ile güncellenir. Kapatılırken Phaser Game ve scene event listener'ları temizlenir. Ekonomi hesabı/ödülü yoktur.
- NASA doğrulanmış çevresel olguları ile motor debisi, aerodinamik katsayılar ve görev Delta‑V eşikleri ayrı belgelenir.

## Gelecek fazlar

- Daha doğru gezegen atmosfer profilleri
- Gerçekçi yörünge ve transfer hesabı
- Ayrıntılı iniş fiziği
- Görev ödülleri ve bütçe kaybı
- Koloni kurma ve kaynak üretimi

## Mimari yön

Katalog `src/game/data.ts`, tipler `src/game/types.ts`, saf hesaplamalar `src/game/calculations.ts`, Zustand montaj durumu `src/game/assemblyStore.ts` içindedir. React ekranı bunları tüketir; görsel sahne oyun durumunu kullanabilir ama React bileşenlerine bağımlı olmamalıdır. Arayüz metinleri `src/i18n` altında tutulur.
