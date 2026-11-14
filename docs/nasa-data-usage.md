# NASA Veri Kullanımı ve Bilimsel Kaynak Kaydı

| NASA Kaynağı | Oyunda Kullanılan Veri ve Mekanik | Birimler | Durum |
|---|---|---|---|
| [NASA NSSDC Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | Dünya ($9.81\text{ m/s}^2$), Ay ($1.62\text{ m/s}^2$), Mars ($3.71\text{ m/s}^2$) ve Europa ($1.315\text{ m/s}^2$) yüzey yerçekimi ivmeleri, atmosfer basınçları (bar) ve Güneş uzaklıkları (AU) | $\text{m/s}^2$, $\text{AU}$, $\text{bar}$ | Tam entegre edildi |
| [NASA JPL Solar System Dynamics](https://ssd.jpl.nasa.gov/) | Gezegenlerarası transfer yörüngeleri ve kademeli $\Delta v$ gereksinimleri | $\text{m/s}$ | Tam entegre edildi (oyun ölçekli) |
| [NASA Glenn Research Center — Beginner's Guide to Rockets](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/) | TWR ($F / m \cdot g$), Tsiolkovsky Roket Denklemi ($\Delta v = I_{sp} \cdot g_0 \cdot \ln(m_0/m_f)$) ve CoM / CoP aerodinamik kararlılık kuralları | $\text{N}$, $\text{kg}$, $\text{s}$ | Tam entegre edildi |

## Oyunlaştırılmış Varsayımlar ve Bilimsel Notlar

- Gezegen yüzey yerçekimleri, atmosfer tipleri (Ay/Europa 0 bar vakum; Mars 0.006 bar ince $\text{CO}_2$) ve Güneş'e uzaklığa bağlı $1/r^2$ güneş enerjisi verimi (1 AU = %100, Mars 1.52 AU = %43.3, Europa 5.2 AU = %3.7) doğrudan NASA NSSDC verilerine dayanır.
- Gövde, motor, yakıt tankı kütleleri ve kredi maliyetleri 48 saatlik eğitici oyun döngüsü için ölçeklendirilmiştir.
- Her hata ve başarı bilgi kartının (`LearningCardModal`) altında ilgili resmi NASA kaynağı referans gösterilmiştir.
