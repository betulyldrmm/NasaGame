# NASA veri kullanımı — Faz 1

| NASA kaynağı | Planlanan/kullanılan veri ve mekanik | Birimler | Durum |
|---|---|---|---|
| [NASA Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | Dünya, Ay ve Mars yüzey yerçekimi; ileride hedefe bağlı TWR | m/s² | Entegre edildi (oyunda yuvarlandı); ayrıntı doğrulaması gerekli |
| [NASA Moon: By the Numbers](https://science.nasa.gov/moon/by-the-numbers/) | Ay yüzey yerçekimi karşılaştırma değeri | m/s² | Doğrulama gerekli |
| [NASA Glenn: Free Falling Objects](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/free-falling-objects/) | Yerçekimi ivmesi ve ağırlık/TWR açıklaması | m/s², N | Planlandı |
| [NASA Mission Visualization](https://nasa.github.io/mission-viz/) / [kaynak deposu](https://github.com/nasa/mission-viz) | Gelecekte yörünge görselleştirme yaklaşımına başvuru; Faz 1'de veri kullanılmıyor | Uygulanamaz | Planlandı; bilimsel parametre kaynağı olarak kullanılmadı |

## Oyunlaştırılmış varsayımlar

Gövde, motor ve yük kütleleri; motor itki değerleri; kredi maliyetleri ve 1.000 kredi başlangıç bütçesi eğitim amaçlı oyun varsayımlarıdır, NASA verisi değildir. Gezegen yerçekimleri NASA kaynaklarındaki yaklaşık yüzey değerlerinden seçilmiştir (Dünya 9,81; Ay 1,62; Mars 3,71 m/s²). Oyun bu aşamada hiçbir uzay aracı performans verisini NASA'ya atfetmez.

## Bilimsel sınırlılıklar

TWR, bu prototipte basitçe itki / (kütle × yerçekimi) olarak hesaplanır. Atmosferik sürükleme, itki eğrisi, yakıt tüketimi, kütle değişimi, yörünge mekaniği, kademeler ve iniş dinamikleri modellenmez. Kullanıcıya bilimsel görev tasarımı veya uçuş sertifikasyonu sonucu sunmaz. Bu çalışma alanında PDF rehberi bulunmadığından PDF içeriği incelenemedi.
