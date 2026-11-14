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

## Faz 4: ekonomi ve üs sistemi (uygulandı)

- `src/economy/economy.ts` saf ekonomi varsayımlarını ve tur üretimini; `economyStore.ts` görev/ekonomi durumunu tek Zustand persist deposunda yönetir.
- Görev başında mevcut roket kataloğundan maliyet alınır. Rampada iptal %15 maliyet kaybettirir; uçuşta başarısızlık tam üretim maliyetini kaybettirir. Başarı +100 kredi ve +150 bilim puanını yalnızca bir kez verir.
- Bakiye maliyeti karşılamıyorsa görev başlamaz. Bakiye sıfırlandığında görev dışında bir defa 250 kredi araştırma desteği alınabilir.
- Başarıyla ulaştırılan kargo Ay/Mars üssüne eklenir. Her başarılı görev, o üste bir üretim turu işletir: güneş paneli enerji, rover mineral, sera gıda sağlar. Bu oranların tümü oyun varsayımıdır.
- `src/data/planetary-reference.json` JPL Horizons Dünya/Mars osculating elemanlarını epoch, TDB, Sun merkezli J2000 ekliptik/ICRF frame ve SI-dışı birimleriyle saklar. `planetaryReference.ts` runtime shape/birim/range denetimi yapar. `visualization/kepler.ts` yaklaşık Kepler konumu, `KeplerOrbitPreview` SVG harita üretir; Ay Güneş merkezli gezegen yörüngesi olarak çizilmez.
- NASA NSSDC Dünya/Ay/Mars ışınımı `W/m²` değerleri aynı JSON içindedir. `solarEnergy.ts` hedef/Dünya ışınım oranını oyun enerjisine dönüştürür. 20 birim/panel/tur referansı, ekipman talepleri ve açıkta modülleri durdurma kuralı oyun varsayımıdır; NASA donanım verisi değildir.
- Kredi, bilim, görev geçmişi, aktif görev, üs ve destek hakkı `space-mission-economy-v1` LocalStorage anahtarıyla saklanır. Uçuş ilerlemesi aralıklı kaydedilir ve devam eden uçuş geri açılabilir.

## Faz 5: teslim hazırlığı (uygulandı)

- Menü, montaj, görev/uçuş, sonuç ve üs ekranları mevcut durum üzerinden birbirine bağlandı. Sonuçtan montaja veya üsse dönülebilir; ana menü devam eden görevi sürdürme seçeneği gösterir.
- Türkçe/İngilizce kısa proje tanımları, 2–3 dakikalık jüri demo metni ve teslim kontrol listesi `docs/` içindedir.
- NASA kaynaklı olgular ile oyunlaştırılmış katalog, uçuş ve ekonomi değerleri veri raporunda ayrıdır.

## Gelecek fazlar

- Daha doğru gezegen atmosfer profilleri
- Gerçekçi yörünge ve transfer hesabı
- Ayrıntılı iniş fiziği
- Gezegenler arası gerçekçi transfer/yörünge fiziği
- Kaynakların daha derin üs inşasında kullanımı

## Mimari yön

Katalog `src/game/data.ts`, tipler `src/game/types.ts`, saf hesaplamalar `src/game/calculations.ts`, Zustand montaj durumu `src/game/assemblyStore.ts` içindedir. React ekranı bunları tüketir; görsel sahne oyun durumunu kullanabilir ama React bileşenlerine bağımlı olmamalıdır. Arayüz metinleri `src/i18n` altında tutulur.
