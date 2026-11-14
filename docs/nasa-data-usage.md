# NASA veri kullanımı

| NASA kaynağı | Veri ve ilgili mekanik | Birimler | Durum |
|---|---|---|---|
| [NASA Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | Dünya, Ay ve Mars yüzey yerçekimi; ileride hedefe bağlı TWR | m/s² | Entegre edildi; oyun değerleri yuvarlandı |
| [NASA Moon: By the Numbers](https://science.nasa.gov/moon/by-the-numbers/) | Ay yüzey yerçekimi için çapraz başvuru | m/s² | Doğrulama kaynağı |
| [NASA Glenn: Free Falling Objects](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/free-falling-objects/) | Ağırlık ve ivme kavramları; TWR eğitim açıklaması | m/s², N | Planlandı |
| [NASA Mission Visualization](https://nasa.github.io/mission-viz/) / [kaynak deposu](https://github.com/nasa/mission-viz) | İleride yörünge görselleştirme yaklaşımına başvuru | Uygulanamaz | Kaynak incelendi; Faz 2'de veri kullanılmadı |

## Bilimsel veriler ve oyun varsayımları

Gezegen katalog değerleri NASA kaynaklarındaki yaklaşık yüzey yerçekimlerinden alınmıştır: Dünya 9,81 m/s², Ay 1,62 m/s² ve Mars 3,71 m/s². Faz 2 TWR ekranı istekte belirtildiği üzere yalnızca Dünya değeri olan 9,81 m/s² ile hesaplanır.

Gövde, motor, yakıt ve kargo kütleleri; motor itkileri; parça fiyatları; 1.000 kredi bütçe ve TWR renk eşikleri oyunlaştırılmış varsayımlardır. Bunlar NASA donanım performans verisi değildir. İtki N (arayüzde kN), kütle kg, yerçekimi m/s² ve maliyet oyun kredisi olarak tutulur.

## Bilimsel sınırlılıklar

TWR, basit itki / (kütle × yerçekimi) oranıdır. Atmosfer, sürükleme, itki eğrisi, yakıt tüketimi sırasında değişen kütle, kademeler, yörünge ve iniş dinamiği modellenmez. TWR eşikleri yalnızca oyun içi eğitim göstergesidir ve görev başarısını ya da gerçek uçuş güvenliğini garanti etmez. Proje içinde PDF rehberi yoktur; PDF içeriği incelenemedi.
