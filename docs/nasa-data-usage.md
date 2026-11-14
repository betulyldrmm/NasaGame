# NASA Verisi Entegrasyon Raporu

Bu rapor, oyunda hangi NASA verisinin **nerede** ve **nasıl** kullanıldığını, hangi değerlerin oyun için ölçeklendiğini ve hangilerinin oyun varsayımı olduğunu açıklar. Tüm NASA kaynaklı sabitler tek dosyada durur: [`src/nasa/bodies.ts`](../src/nasa/bodies.ts).

> Not: Space Apps "Space Mission Design Game" kaynak sayfası otomatik erişime kapalı olduğu için içeriği okunamadı. Aşağıdaki entegrasyon, o sayfada bağlantısı verilen `nasa.github.io/mission-viz` ile NASA NSSDC ve JPL SSD verilerine dayanır. Sayfadaki diğer kaynaklar eklenecekse aynı dosyaya işlenebilir.

## 1. Kaynaklar ve kullanıldıkları yer

| Kaynak | Alınan veri | Oyunda kullanıldığı yer |
|---|---|---|
| [NASA mission-viz (WSMV)](https://nasa.github.io/mission-viz/) – gezegen yörünge parametreleri tablosu | Dünya ve Mars için dış merkezlik (0,0167 / 0,0934), yarı-büyük eksen (1,0 / 1,5237 AU), periyot (365,26 / 686,97 gün) | Gezegenlerin haritadaki eliptik yörüngeleri; Kepler elemanlarından konum hesaplama (`orbitState`) |
| NASA mission-viz – "Earth Moon Mission Visualization" ve eliptik yörünge/propagatör dersleri | Dünya yörüngesinden Ay yörüngesine transfer kavramı, Kepler propagatörü yaklaşımı | Harita ekranındaki yörünge tahmini (`predict.ts`) ve analitik Kepler ilerletici (`propagate`) |
| [NASA JPL SSD – Keplerian Elements for Approximate Positions](https://ssd.jpl.nasa.gov/planets/approx_pos.html) | J2000 ortalama boylamı, günberi boylamı ve yüzyıllık değişim hızları | Oyunun başlangıç tarihi olan **14 Kasım 2026**'da Dünya ve Mars'ın gerçek konum açıları → gerçek Mars transfer penceresi |
| [NASA NSSDC Planetary Fact Sheets](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | Merkür, Venüs, Dünya, Ay, Mars, Ceres, Jüpiter, Ganimed, Satürn ve Titan için yarıçap, yüzey çekimi, yörünge periyotları, dış merkezlik ve atmosfer ölçek yüksekliği / yüzey yoğunluğu | Gök cisimlerinin boyutu, çekimi, etki alanı, atmosfer sürüklenmesi |
| [NASA Glenn – Beginner's Guide to Rockets](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/) | İtki/ağırlık oranı, özgül itki (Isp), roket denklemi | Montaj ekranındaki TWR ve kademe Δv hesabı, motor modeli |

## 2. Yörünge mekaniğinde NASA verisi

**Çekim, aracın kütlesine değil gök cismine bağlıdır.** Her cismin kütleçekim parametresi NSSDC yüzey çekimi ve yarıçapından türetilir: `μ = g · R²`. Araca etkiyen ivme `a = −μ · r / |r|³` olduğundan düşüş hızı aracın ağırlığından bağımsızdır; Ay'da 1,62, Mars'ta 3,71, Dünya'da 9,80 m/s² ile düşersin.

**Etki alanları (SOI).** Haritadaki gri diskler Laplace formülüyle hesaplanır: `r_SOI = a · (m/M)^(2/5)`. Ay/Dünya kütle oranı oyunda 0,0123 çıkar; bu, gerçek değerle aynıdır çünkü oran `g·R²` üzerinden korunur.

| Cisim | Oyun yarıçapı | Yüzey çekimi | Etki alanı | Yörünge |
|---|---|---|---|---|
| Merkür | 120,6 km | 3,70 m/s² | 2.172 km | 0,3871 AU, e = 0,2056 |
| Venüs | 299,2 km | 8,87 m/s² | 11.909 km | 0,7233 AU, e = 0,0068 |
| Dünya | 315,0 km | 9,80 m/s² | 17.853 km | 1,0000 AU, e = 0,0167 |
| Ay | 85,9 km | 1,62 m/s² | 1.067 km | Dünya'dan 6.200 km, e = 0,0549 |
| Mars | 167,6 km | 3,71 m/s² | 11.133 km | 1,5237 AU, e = 0,0934 |
| Ceres | 23,2 km | 0,28 m/s² | 1.480 km | 2,7675 AU, e = 0,0758 |
| Jüpiter | 3.456,6 km | 24,79 m/s² | 915.058 km | 5,2029 AU, e = 0,0484 (gaz devi, iniş yok) |
| Ganimed | 130,2 km | 1,43 m/s² | 396 km | Jüpiter'den 17.074 km, e = 0,0013 |
| Satürn | 2.879,2 km | 10,44 m/s² | 1.025.330 km | 9,5367 AU, e = 0,0539 (gaz devi, iniş yok) |
| Titan | 127,3 km | 1,35 m/s² | 704 km | Satürn'den 19.330 km, e = 0,0288 |

> **Atmosfer notu:** Venüs yüzey yoğunluğu (gerçek ~65 kg/m³) oyun içi kalkış/geri dönüş dengesi için `4,2 kg/m³` ile sınırlandırılmıştır; Titan yoğun azot atmosferi (`1,4 kg/m³`, ölçek yüksekliği `21 km × 0,3`) ve Dünya/Mars değerleri NSSDC verilerinden ölçeklenmiştir.

**Yamalı konikler.** Araç hangi cismin etki alanındaysa o cismin çekimiyle Kepler yörüngesi izler; sınırı geçince konum ve hız yeni cismin çerçevesine çevrilir. Bu sayede:

- Alçak Dünya yörüngesinde yapılan küçük bir yakma, öte noktayı binlerce kilometre oynatır (haritada anında görünür).
- Ay'ın yanından motor yakmadan geçmek Dünya'ya göre hızı değiştirir: **yerçekimi sapanı**. Oyun bunu ölçer ve "Yerçekimi sapanı" görevini verir.
- Tahmin çizgisi karşılaşmayı, Ay enberisini, çarpışmayı ve çıkış yörüngesini ayrı renkli yamalar olarak gösterir.

**Transfer penceresi.** Harita ekranı vis-viva denklemi `v² = μ(2/r − 1/a)` ile Hohmann transferini hesaplar: gereken Δv, hedefin gereken faz açısı ve pencereye kalan süre. Mars için ideal Dünya–Mars faz açısı 44°'dir. JPL elemanları 14 Kasım 2026 için uygulandığında Mars Dünya'nın yaklaşık 55° önündedir, yani oyun gerçek 2026 sonu Mars fırlatma penceresinin hemen öncesinde başlar; pencere yaklaşık 23 oyun saati sonra açılır.

**Kepler'in 3. yasası.** Güneş'in μ'sü Dünya'nın ölçekli yörüngesinden (`μ = n²a³`), Ay'ın uzaklığı gerçek 27,32 günlük periyodundan türetilir. Mars'ın 687 günlük periyodu ayrıca girilmez; yasadan kendiliğinden çıkar.

**Güneş enerjisi.** Güneş paneli ve üs güneş tarlası üretimi `1/r²` ile ölçeklenir: Mars'ta Dünya'dakinin yaklaşık %43'ü, Jüpiter'de yaklaşık %3,7'si. Bu nedenle Jüpiter (Ganimed) ve Satürn (Titan) görevlerinde ve dış gezegen üslerinde mesafeden bağımsız çalışan **RTG Nükleer Pil / Üs Reaktörü** kullanılır.

## 3. Ölçekleme kararları

Gerçek boyutlarda bir yörünge turu 90 dakika, Ay yolculuğu üç gün sürer. Oranları koruyup mutlak değerleri küçülttük:

| Büyüklük | Ölçek | Sonuç |
|---|---|---|
| Gezegen yarıçapları | 1 / 20,2 | Dünya 315 km; Ay ve Mars aynı oranla |
| Güneş uzaklıkları | 1 AU = 1.000.000 km | Mars 1,52 milyon km |
| Zaman | 1 gerçek gün = 1 oyun saati | Ay periyodu 27,3 saat, Dünya yılı 365 saat |
| Atmosfer | 0,3 | Dünya atmosferi 30 km'de biter |
| Yüzey çekimi | 1 : 1 (ölçeklenmedi) | İniş ve kalkış hissi gerçek |

Sonuç olarak yörünge hızı yaklaşık 1,6 km/s (gerçekte 7,8 km/s), Dünya yörüngesi için gereken Δv yaklaşık 2.400 m/s olur.

## 4. Motor modeli

Yakıt akışı sabittir: `ṁ = F_vakum / (Isp_vakum · g₀)`. İtki, ortam basıncına göre Isp ile değişir: `F = ṁ · Isp(p) · g₀`. Bu yüzden:

| Motor | Vakum itkisi | Isp (vakum / deniz seviyesi) | Rol |
|---|---|---|---|
| Titan | 480 kN | 265 / 240 s | Kalkış: yüksek itki, yüksek tüketim |
| Hawk | 180 kN | 285 / 235 s | Yan itici, ikinci kademe |
| Aerospike | 240 kN | 340 / 305 s | Yoğun atmosferlerde (Dünya, Venüs) verimli |
| Frontier | 60 kN | 345 / 100 s | Uzayda verimli, atmosferde zayıf |
| Kolibri | 16 kN | 315 / 140 s | Küçük iniş araçları |
| İyon | 1,6 kN | 2100 / 2100 s | Elektrikle çalışır; batarya ve panel/RTG ister |
| NERVA | 140 kN | 760 / 160 s | Nükleer termal motor; dış gezegenler ve geri dönüş |

Kademe Δv'si Tsiolkovsky denklemiyle hesaplanır: `Δv = Isp · g₀ · ln(m₀/m₁)`.

## 5. Oyun varsayımı olanlar (NASA verisi değil)

- Parça kütleleri, itki değerleri, fiyatlar, görev ödülleri, maden fiyatları ve üs gelirleri.
- Gezegenler dönmez; yörüngeler tek düzlemdedir (2B).
- Atmosfere giriş ısınması modellenmez.
- Ay'ın başlangıç konumu ve günberi yönü temsilidir.
- Yüzey engebesi prosedüreldir.

## 6. Doğrulama

`npm test` şunları sınar: Ay/Dünya kütle ve yarıçap oranlarının gerçek değerlerle eşleşmesi, Kepler ilerleticinin bir periyot sonunda başlangıç noktasına dönmesi, hazır roketin basit bir otomatik pilotla Dünya yörüngesine girmesi ve Hohmann yakmasıyla Ay'ın etki alanına ulaşması, genişletilmiş Güneş Sistemi cisimlerinin (Merkür, Venüs, Ceres, Jüpiter/Ganimed, Satürn/Titan) tutarlı yörünge/SOI/iniş özellikleri, Dünya başlangıç pasif gelir üssü, teknoloji ağacı kilitleri/çarpanları, `25×` fizik zaman hızlandırması ve `autoLand` ile Ay'a güvenli iniş.
