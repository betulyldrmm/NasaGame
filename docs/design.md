# Tasarım Özeti

Açık dünya, 2B yörünge mekaniği oyunu. Akış: **Montaj binası → Rampa → Uçuş / Uzay haritası → Yüzey üssü**.

## Sistemler

- **Grid montaj**: 14×30 kare grid; parçalar kenar paylaşınca bağlanır. Simetri modu yan iticileri aynalar.
- **Kademeler**: Dikey adaptör üst/alt gövdeyi, yatay adaptör yan gövdeyi bağlar. Adaptöre tıklanınca veya Boşluk'a basınca gövde ayrılır ve bağımsız bir araç olur. Adaptörler yakıt geçirmez; nozülünün altı kapalı motor çalışmaz.
- **Fizik**: İtki veya atmosfer varken sayısal adım (0,02 s), aksi hâlde analitik Kepler ("raylar"). Zaman 100.000× kadar hızlanır.
- **Yamalı konikler**: Güneş → Dünya → Ay ve Güneş → Mars etki alanları.
- **Harita (M)**: Yörünge tahmini, enberi/öte nokta, karşılaşma, transfer penceresi. Araca tıklayınca kontrol o araca geçer.
- **Ekonomi**: Görev ödülleri, üs geliri, maden satışı, Dünya'ya inen aracın %80 iadesi (yeniden kullanım), ISRU yakıt ikmali.

## Sonraki adımlar için fikirler

- Yörüngede kenetlenme ve istasyon kurma.
- Uydu sözleşmeleri (belirli yörüngeye yük bırakma).
- Atmosfere giriş ısınması ve ısı kalkanı.
- Manevra düğümleri (planlanan yakmanın haritada önizlemesi).
