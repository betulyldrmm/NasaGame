# Faz 1 tasarım notları

## Gelecekteki özellikler

- Roket montaj ekranı
- Canlı TWR göstergesi (eşikler: `< 1.0` kırmızı, `1.0–<1.2` sarı, `≥ 1.2` yeşil)
- Gezegenlerin farklı yüzey yerçekimleri
- Delta-V kapasitesi
- Ay ve Mars için iniş sistemleri
- 2D Phaser uçuş simülasyonu
- Görev başarısı ve başarısızlığı
- Bütçe kaybı ve ödüller
- Koloni kurma ve kaynak üretimi

## Mimari yön

Oyun modelleri ve saf hesaplamalar `src/game` altında React'ten bağımsız tutulur. Başlangıç kataloğu `data.ts` içindedir. Sonraki aşamada görev/roket durumu Zustand deposuna, uçuş sahnesi Phaser modülüne taşınabilir; arayüz metinleri `src/i18n` altında tutulur. Simülasyon ve UI birbirine doğrudan bağlanmadan model ve hesaplama katmanını paylaşır.
