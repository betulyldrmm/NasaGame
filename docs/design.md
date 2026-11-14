# Tasarım Özeti

Açık dünya, 2B yörünge mekaniği oyunu. Akış: **Montaj binası → Rampa → Uçuş / Uzay haritası → Yüzey üssü**.

## Sistemler

- **Grid montaj**: 14×30 kare grid; parçalar kenar paylaşınca bağlanır. Simetri modu yan iticileri aynalar.
- **Kademeler**: Dikey adaptör üst/alt gövdeyi, yatay adaptör yan gövdeyi bağlar. Uçuşta adaptöre tıklanınca gövde ayrılır; Boşluk kısa motor itkisi verir. Adaptörler yakıt geçirmez; nozülünün altı kapalı motor çalışmaz.
- **Fizik**: İtki veya atmosfer varken sayısal adım (0,02 s), aksi hâlde analitik Kepler ("raylar"). Zaman 100.000× kadar hızlanır.
- **Yamalı konikler**: Güneş → Dünya → Ay ve Güneş → Mars etki alanları.
- **Harita (M)**: Yörünge tahmini, enberi/öte nokta, karşılaşma, transfer penceresi. Araca tıklayınca kontrol o araca geçer.
- **Ekonomi**: Görev ödülleri, üs geliri, maden satışı, Dünya'ya inen aracın %80 iadesi (yeniden kullanım), ISRU yakıt ikmali.
- **Uçuş kontrolleri**: `R` RCS'yi açar, `I/J/K/L` öteleme yapar. `G` iniş ayaklarını açıp kapatır ve açılma animasyonu oynatır. Alt kontrol satırında radial, RCS ve kademe düğmeleri gösterilmez.

## Sonraki adımlar için fikirler

- Uydu sözleşmeleri (belirli yörüngeye yük bırakma).
- Atmosfere giriş ısınması ve ısı kalkanı.
- Manevra düğümleri (planlanan yakmanın haritada önizlemesi).
