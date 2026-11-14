# NASA veri kullanımı

Bu rapor yalnızca Faz 3'te kullanılan, NASA kaynaklarıyla doğrulanan fiziksel/çevresel bilgileri kaydeder. Roket kataloğu ve simülasyon katsayıları ayrı olarak oyun varsayımı diye etiketlenmiştir.

| NASA kaynağı | Doğrulanmış veri/olgu | Oyundaki mekanik | Birim | Durum |
|---|---|---|---|---|
| [NASA Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | Dünya, Ay ve Mars yüzey yerçekiminin karşılaştırması | Dünya kalkışı TWR/ivmesi ve hedef yerçekimi | m/s² | Entegre edildi; tablo değerleri oyunda yuvarlandı |
| [NASA Moon: By the Numbers](https://science.nasa.gov/moon/by-the-numbers/) | Dünya ve Ay yüzey yerçekimi (oyunda 9,81 ve 1,62) | Dünya kalkışı TWR/ivmesi ve Ay hedefi | m/s² | Entegre edildi |
| [NASA Mars Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) | Mars yüzey yerçekimi (oyunda 3,71'e yuvarlanır) | Mars hedef yerçekimi ve iniş TWR | m/s² | Entegre edildi |
| [NASA Glenn: Moon](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/moon/) | Ay'ın anlamlı bir atmosferi yoktur; aerodinamik frenleme ve paraşütle iniş için atmosfer bulunmaz, inişte roket itişi gerekir | Ay iniş sistemi kuralı | Nitel; oyun içi atmosfer sayısallaştırılmıyor | Entegre edildi |
| [NASA: Landing on Mars, a Tricky Feat](https://science.nasa.gov/solar-system/skywatching/night-sky-network/landing-on-mars-a-tricky-feat/) | Mars atmosferi paraşüte katkı sağlar ancak tek başına inişi tamamlatacak kadar yoğun değildir; Perseverance inişinde ısı kalkanı, paraşüt ve retroroket kullanıldı | Mars iniş ekipmanı için kural tabanlı kontrol | Nitel | Entegre edildi |
| [NASA Glenn: Free Falling Objects](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/free-falling-objects/) | Dünya yüzeyinde yaklaşık 9,8 m/s² yerçekimi ve F=ma ilişkisi | Dikey ivme/TWR kavramının açıklaması | m/s², N, kg | Entegre edildi |

## Oyunda kullanılan, NASA verisi olmayan varsayımlar

- Motor yakıt debileri: Spark 10,2; Voyager 25,5; Titan 51 kg/s. Bunlar oyun motoru değerleridir; gerçek motor ölçümü değildir.
- Sürükleme katsayısı 0,45; referans alanlar gövde yuvasına göre 0,55/0,82/1,2 m²; başlangıç hava yoğunluğu 1,225 kg/m³ ve ölçek yüksekliği 8.500 m basitleştirilmiş simülasyon katsayılarıdır. Gezegen atmosferi profili iddiası taşımaz.
- Delta‑V görev hedefleri: Ay 600 m/s, Mars 1.000 m/s. Bunlar oynanabilirlik için seçilmiş senaryo eşikleridir; NASA gereksinimi veya gerçek transfer/iniş Delta‑V bütçesi değildir.
- Delta‑V kapasitesi, `vₑ = itki / yakıt debisi` oyun yaklaşımı ve ideal roket denkleminden hesaplanır. Motor verim eğrisi, kademeler ve gerçek özgül itki verileri kullanılmaz.
- TWR 1 ve üzeri kalkış kontrolü yalnızca basit dikey ilk kalkış modelidir. İniş ekipmanı sonuçları da kural tabanlı görev denetimidir.

## Bilimsel sınırlılıklar

Uçuş, Dünya'dan başlayan tek boyutlu dikey yükseliştir. Semi-implicit Euler zaman adımı, sabit Dünya yerçekimi ve yaklaşık üstel yoğunluk azalması kullanılır. Rüzgâr, atmosfer sıcaklık/basınç profili, değişen aerodinamik katsayılar, kontrol yönlendirmesi, kademeler, gerçek yörünge, transfer, yeniden giriş ve iniş dinamiği modellenmez. Ay/Mars hedefleri fiziksel yolculuk simülasyonu değil, Delta‑V eşiği ve iniş donanımı eğitim kontrolüdür. Sonuçlar gerçek görev tasarımı veya uçuş güvenliği değerlendirmesi değildir.
