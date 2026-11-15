/**
 * "Nasıl Oynanır?" rehberi: oyunun her parçasını canlı sahnelerle anlatır. Metinler Türkçe ve
 * İngilizce olarak burada yazılıdır (uzun paragraflar sözlükten geçmez).
 */
import { useState, type ReactNode } from 'react'
import { partDef } from '../game/data'
import { lang } from '../i18n'
import GuideScene, { type SceneId } from './GuideScenes'
import PartIcon from './PartIcon'

const en = lang === 'en'
const L = (tr: ReactNode, eng: ReactNode) => (en ? eng : tr)

const ENGINES: { id: string; use: [string, string] }[] = [
  { id: 'titan', use: ["Dünya'dan kalkış, ilk kademe", 'Launch from Earth, first stage'] },
  { id: 'hawk', use: ['Yan iticiler ve ikinci kademe', 'Side boosters and second stage'] },
  { id: 'aerospike', use: ['Yoğun atmosferde bile verimli (Venüs, Dünya)', 'Efficient even in thick air (Venus, Earth)'] },
  { id: 'frontier', use: ['Uzayda üst kademe; atmosferde zayıf', 'Upper stage in space; weak in air'] },
  { id: 'kolibri', use: ['Küçük iniş araçları', 'Small landers'] },
  { id: 'ion', use: ['Çok verimli ama çok yavaş; elektrik ister', 'Super efficient but tiny thrust; needs power'] },
  { id: 'nerva', use: ['Uzak gezegenler için dev Δv', 'Huge Δv for distant planets'] },
]

const ENGINE_EN: Record<string, string> = {
  titan: 'Titan (launch)',
  hawk: 'Hawk (medium)',
  aerospike: 'Aerospike (multi)',
  frontier: 'Frontier (vacuum)',
  kolibri: 'Kolibri (mini)',
  ion: 'Ion Engine',
  nerva: 'NERVA (nuclear)',
}

interface Section {
  id: string
  icon: string
  title: [string, string]
  scene?: SceneId
  body: () => ReactNode
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

const SECTIONS: Section[] = [
  {
    id: 'start',
    icon: '🚀',
    title: ['Oyunun amacı', 'The goal'],
    scene: 'journey',
    body: () => (
      <>
        <p>
          {L(
            "Görev kontrolündesin: roket tasarla, Dünya'dan fırlat, yörüngeye çık, Ay'a ve Mars'a git, oralarda güneş enerjisiyle çalışan koloniler kur. Her başarılı görev para kazandırır; parayla daha büyük roketler ve koloni yapıları alırsın.",
            "You are mission control: design a rocket, launch it from Earth, reach orbit, travel to the Moon and Mars and build solar-powered colonies there. Every completed mission earns money; money buys bigger rockets and colony buildings.",
          )}
        </p>
        <ol className="guide-steps">
          <li>{L(<><b>Hangar:</b> parçaları ızgaraya yerleştirip roketini kur (ya da hazır roketlerden birini seç).</>, <><b>Hangar:</b> place parts on the grid to build your rocket (or pick a ready-made one).</>)}</li>
          <li>{L(<><b>Uçuş:</b> rampadan kalk, yörüngeye otur, hedefe git, in.</>, <><b>Flight:</b> lift off, settle into orbit, travel to a target, land.</>)}</li>
          <li>{L(<><b>Harita (M):</b> gezegenleri, yörüngeni ve etki alanlarını gör.</>, <><b>Map (M):</b> see the planets, your orbit and spheres of influence.</>)}</li>
          <li>{L(<><b>Koloni:</b> Dünya&apos;da tesis kur, uzayda kargoyla getirdiklerini yerleştir.</>, <><b>Colony:</b> build facilities on Earth and set up what you carried into space.</>)}</li>
        </ol>
        <p className="guide-tip">{L('İlk görev önerisi: hazır "Selene I" roketiyle uzaya çık, sonra Dünya yörüngesine yerleş. Ekranın sağında "Sıradaki görev" yazar.', 'First steps: take the ready-made "Selene I" to space, then settle into Earth orbit. The next mission is shown on the right of the screen.')}</p>
      </>
    ),
  },
  {
    id: 'build',
    icon: '🛠️',
    title: ['Roket nasıl yapılır', 'Building a rocket'],
    scene: 'build',
    body: () => (
      <>
        <ol className="guide-steps">
          <li>{L(<>Soldaki listeden bir parçayı sürükleyip ızgaraya bırak. Parçalar birbirine <b>değmeli</b>; kopuk parça uçmaz.</>, <>Drag a part from the list on the left onto the grid. Parts must <b>touch</b> each other; loose parts won&apos;t fly.</>)}</li>
          <li>{L(<>En üste bir <b>komuta</b> parçası (kapsül ya da sonda), altına <b>yakıt tankı</b>, en alta <b>motor</b> koy. Motor, üstündeki tanklardan yakıt çeker.</>, <>Put a <b>command</b> part on top (capsule or probe), <b>fuel tanks</b> under it and an <b>engine</b> at the bottom. An engine drinks from the tanks above it.</>)}</li>
          <li>{L(<><b>Kademe:</b> üst kademe ile alt kademe arasına <b>dikey adaptör</b> koy. Alt kademenin yakıtı bitince adaptöre tıkla (veya otomatik): boş tank ve motor düşer, roket hafifler.</>, <><b>Stages:</b> put a <b>vertical adapter</b> between the upper and lower stage. When the lower stage is empty, click the adapter (or let it go automatically): the empty tank and engine drop, the rocket gets lighter.</>)}</li>
          <li>{L(<><b>Yan iticiler</b> ana gövdeye <b>yatay adaptörle</b> bağlanır; kalkışta ek itki verir.</>, <><b>Side boosters</b> attach to the core with a <b>horizontal adapter</b>; they add thrust at lift-off.</>)}</li>
          <li>{L(<>Sağ panelde <b>Δv</b> (yakıtınla toplam ne kadar hız değiştirebileceğin) ve <b>TWR</b>&apos;yi kontrol et. TWR yeşil değilse roket kalkamaz.</>, <>Check <b>Δv</b> (how much speed change your fuel buys in total) and <b>TWR</b> on the right. If TWR isn&apos;t green the rocket won&apos;t lift off.</>)}</li>
          <li>{L(<>Koloniye yapı götüreceksen <b>Kargo Gövdesi</b> ekle ve sağdaki Kargo bölümünden yükle (her gövde 4 t).</>, <>To carry colony buildings, add a <b>Cargo Bay</b> and load it from the Cargo section on the right (4 t per bay).</>)}</li>
          <li>{L(<><b>Rampaya çıkar</b> ile fırlat. Parçaların fiyatı paradan düşülür; Dünya&apos;ya sağlam dönen aracı <b>Aracı kurtar</b> ile %80 iade alırsın.</>, <><b>Roll out</b> to launch. Parts cost money; bring a craft back to Earth in one piece and <b>Recover</b> it for an 80% refund.</>)}</li>
        </ol>
        <p className="guide-tip">{L('Paraşüt yalnızca atmosferde (Dünya, Mars, Venüs, Titan) işe yarar. Ay gibi havasız yerlerde motorla yavaşlayıp iniş ayaklarıyla inmelisin.', 'Parachutes only work in an atmosphere (Earth, Mars, Venus, Titan). On airless worlds like the Moon you must brake with the engine and land on legs.')}</p>
      </>
    ),
  },
  {
    id: 'engines',
    icon: '🔥',
    title: ['Motorların farkı', 'Engine differences'],
    scene: 'engines',
    body: () => (
      <>
        <p>
          {L(
            <>Her motorun iki önemli değeri vardır: <b>İtki</b> (kN) — ne kadar güçlü ittiği; <b>Isp</b> (s) — verimi, yani aynı yakıtla ne kadar uzun yanabildiği. Güçlü motorlar yakıtı hızlı bitirir, verimli motorlar zayıf iter.</>,
            <>Every engine has two key numbers: <b>Thrust</b> (kN) — how hard it pushes; <b>Isp</b> (s) — its efficiency, i.e. how long it can burn on the same fuel. Powerful engines burn fuel fast, efficient engines push gently.</>,
          )}
        </p>
        <table className="guide-table">
          <thead>
            <tr>
              <th />
              <th>{L('Motor', 'Engine')}</th>
              <th>{L('İtki', 'Thrust')}</th>
              <th>{L('Isp yer / uzay', 'Isp sea / vac')}</th>
              <th>{L('Ne zaman?', 'When?')}</th>
            </tr>
          </thead>
          <tbody>
            {ENGINES.map((e) => {
              const d = partDef(e.id)
              return (
                <tr key={e.id}>
                  <td><PartIcon id={e.id} size={34} /></td>
                  <td><b>{en ? ENGINE_EN[e.id] : d.name}</b></td>
                  <td>{d.thrust} kN</td>
                  <td>{d.ispSL} / {d.ispVac} s</td>
                  <td>{en ? e.use[1] : e.use[0]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="guide-tip">
          {L(
            'Altın kural: kalkışta güçlü motor (Titan, Hawk), uzayda verimli motor (Frontier, NERVA). Frontier atmosferde verimini kaybeder; İyon motoru batarya ve güneş paneli ister.',
            'Golden rule: strong engines for lift-off (Titan, Hawk), efficient engines in space (Frontier, NERVA). Frontier loses efficiency in air; the Ion engine needs batteries and solar panels.',
          )}
        </p>
      </>
    ),
  },
  {
    id: 'twr',
    icon: '⚖️',
    title: ['TWR nedir?', 'What is TWR?'],
    scene: 'twr',
    body: () => (
      <>
        <p>
          {L(
            <><b>TWR</b> (Thrust-to-Weight Ratio), motor itkisinin roketin ağırlığına oranıdır: <code>TWR = itki ÷ (kütle × yerçekimi)</code>.</>,
            <><b>TWR</b> (Thrust-to-Weight Ratio) is the engine thrust divided by the rocket&apos;s weight: <code>TWR = thrust ÷ (mass × gravity)</code>.</>,
          )}
        </p>
        <ul className="guide-list">
          <li>{L(<><b>TWR &lt; 1:</b> itki ağırlığı yenemez, roket rampada kalır.</>, <><b>TWR &lt; 1:</b> thrust cannot beat weight; the rocket stays on the pad.</>)}</li>
          <li>{L(<><b>TWR 1–1,2:</b> kalkar ama çok yavaş, yakıtı yerçekimine harcar.</>, <><b>TWR 1–1.2:</b> lifts off but slowly, wasting fuel fighting gravity.</>)}</li>
          <li>{L(<><b>TWR 1,2–2:</b> ideal kalkış (hangarda yeşil görünür).</>, <><b>TWR 1.2–2:</b> ideal for launch (shown green in the hangar).</>)}</li>
        </ul>
        <p>
          {L(
            "TWR gezegene göre değişir: Ay'da yerçekimi Dünya'nın altıda biri olduğu için aynı roketin TWR'si orada 6 kat büyüktür. Yakıt yandıkça roket hafifler ve TWR yükselir.",
            "TWR depends on the planet: the Moon's gravity is one sixth of Earth's, so the same rocket has 6× the TWR there. As fuel burns the rocket gets lighter and TWR rises.",
          )}
        </p>
        <p className="guide-tip">{L('TWR düşükse: daha güçlü motor ekle, yan itici tak ya da gereksiz ağırlığı (fazla tank, kargo) azalt.', 'Low TWR? Add a stronger engine, attach side boosters, or drop unnecessary weight (extra tanks, cargo).')}</p>
      </>
    ),
  },
  {
    id: 'orbit',
    icon: '🌍',
    title: ['Yörünge nedir?', 'What is an orbit?'],
    scene: 'orbit',
    body: () => (
      <>
        <p>
          {L(
            'Yörüngede olmak, gezegene doğru sürekli düşerken yana o kadar hızlı gitmek demektir ki yüzeyi hep ıskalarsın. Bu yüzden yörüngeye çıkmak için yukarı değil, asıl yana hız kazanmak gerekir.',
            'Being in orbit means constantly falling toward the planet while moving sideways so fast that you keep missing the ground. So reaching orbit is mostly about sideways speed, not height.',
          )}
        </p>
        <ol className="guide-steps">
          <li>{L(<>Dik kalk. Birkaç km sonra burnu yavaşça <b>sağa</b> yatır (<K>D</K>) — buna yerçekimi dönüşü denir.</>, <>Lift off straight up. After a few km slowly tip the nose <b>right</b> (<K>D</K>) — the gravity turn.</>)}</li>
          <li>{L(<><b>Öte nokta (apoapsis)</b> atmosferin üstüne çıkınca motoru kes (<K>X</K>).</>, <>When <b>apoapsis</b> (highest point) is above the atmosphere, cut the engine (<K>X</K>).</>)}</li>
          <li>{L(<>Öte noktaya varınca yatay yak: <b>beri nokta (periapsis)</b> da atmosferin üstüne çıkınca yörüngedesin!</>, <>At apoapsis burn sideways: once <b>periapsis</b> (lowest point) is also above the atmosphere, you are in orbit!</>)}</li>
        </ol>
        <ul className="guide-list">
          <li>{L(<><b>Etki alanı (SOI):</b> bir gök cisminin çekiminin baskın olduğu bölge. Ay&apos;ın SOI&apos;sine girince artık Ay&apos;ın çevresinde dönersin.</>, <><b>Sphere of influence (SOI):</b> the region where a body&apos;s gravity dominates. Enter the Moon&apos;s SOI and you now orbit the Moon.</>)}</li>
          <li>{L(<><b>Transfer:</b> başka bir gök cismine gitmek için doğru anda yörüngende ileri yakarsın; hedefe giden elips yörüngeye geçersin.</>, <><b>Transfer:</b> to reach another body you burn prograde at the right moment and switch to an ellipse that meets the target.</>)}</li>
        </ul>
        <p className="guide-tip">{L('Kısayol: alttaki "Yörünge" düğmesi seni otomatik yörüngeye çıkarır, "Hedefe Git" seçili gezegene götürür, "Oto-İniş" yüzeye indirir.', 'Shortcut: the "Orbit" button at the bottom flies you to orbit, "Go to Target" takes you to the selected planet, "Auto-Land" puts you on the surface.')}</p>
      </>
    ),
  },
  {
    id: 'fly',
    icon: '🎮',
    title: ['Uçuş kontrolleri', 'Flight controls'],
    body: () => (
      <>
        <table className="guide-table keys">
          <tbody>
            <tr><td><K>W</K> <K>S</K></td><td>{L('Gaz artır / azalt', 'Throttle up / down')}</td></tr>
            <tr><td><K>Z</K> <K>X</K></td><td>{L('Tam gaz / motoru kes', 'Full throttle / cut engine')}</td></tr>
            <tr><td><K>A</K> <K>D</K></td><td>{L('Burnu sola / sağa çevir', 'Turn the nose left / right')}</td></tr>
            <tr><td><K>Boşluk</K></td><td>{L('Basılı tuttukça motor çalışır', 'Hold to fire the engine')}</td></tr>
            <tr><td><K>T</K></td><td>{L('Yön kilidi (ileri / geri / radyal)', 'Direction lock (prograde / retrograde / radial)')}</td></tr>
            <tr><td><K>P</K> <K>G</K> <K>O</K></td><td>{L('Paraşüt · iniş ayakları · güneş panelleri', 'Parachute · landing legs · solar panels')}</td></tr>
            <tr><td><K>R</K> + <K>I</K><K>J</K><K>K</K><K>L</K></td><td>{L('RCS aç ve yana/ileri kay (kenetlenme için)', 'Enable RCS and translate (for docking)')}</td></tr>
            <tr><td><K>M</K></td><td>{L('Uzay haritası', 'Space map')}</td></tr>
            <tr><td><K>,</K> <K>.</K></td><td>{L('Zamanı yavaşlat / hızlandır', 'Slow down / speed up time')}</td></tr>
            <tr><td><K>Tab</K></td><td>{L('Başka gemiye geç (ya da gemiye tıkla)', 'Switch ship (or click a ship)')}</td></tr>
            <tr><td>{L('Fare', 'Mouse')}</td><td>{L('Tekerlek: yakınlaş · sürükle: kamerayı kaydır · çift tık: rokete ortala · adaptöre tıkla: kademe ayır', 'Wheel: zoom · drag: pan the camera · double-click: re-center · click an adapter: stage')}</td></tr>
          </tbody>
        </table>
        <p className="guide-tip">
          {L(
            "Otomatik uçuşta (Yörünge / Hedefe Git) yerden 500 m'nin altında zaman 1×'e kilitlenir; yukarıda hızı sen seçersin, uzun süzülmelerde otopilot hızı kendisi de artırır.",
            'During autopilot (Orbit / Go to Target) time is locked to 1× below 500 m; above that you pick the speed, and the autopilot also speeds up long coasts by itself.',
          )}
        </p>
      </>
    ),
  },
  {
    id: 'money',
    icon: '💰',
    title: ['Nasıl para kazanılır', 'Earning money'],
    body: () => (
      <ul className="guide-cards">
        <li>
          <b>🎯 {L('Görevler', 'Missions')}</b>
          <span>{L('Uzaya çık (1.500 ₡), Dünya yörüngesi (6.000 ₡), Ay yörüngesi (10.000 ₡), Ay\'a iniş (20.000 ₡), Mars\'a iniş (80.000 ₡)… Uzak dünyalar çok daha fazla öder.', 'Reach space (1,500 ₡), Earth orbit (6,000 ₡), Moon orbit (10,000 ₡), Moon landing (20,000 ₡), Mars landing (80,000 ₡)… Distant worlds pay far more.')}</span>
        </li>
        <li>
          <b>🛰️ {L('ISS ikmali', 'ISS resupply')}</b>
          <span>{L('Kargoya "ISS İkmal Kargosu" yükle, istasyona kenetlen: paket başına 4.500 ₡.', 'Load "ISS Supply Cargo", dock with the station: 4,500 ₡ per pack.')}</span>
        </li>
        <li>
          <b>🏗️ {L('Koloni geliri', 'Colony income')}</b>
          <span>{L('Telemetri, Lab, Yaşam Küresi, Uzay Tarlası gibi yapılar saat başı gelir getirir; oyunu kapatsan da birikir.', 'Telemetry, Labs, Habitats, Space Farms earn money every hour — even while the game is closed.')}</span>
        </li>
        <li>
          <b>⛏️ {L('Madencilik', 'Mining')}</b>
          <span>{L('Maden Aracı yüzeyden maden çıkarır. Madeni roketine yükleyip Dünya\'ya getir ve sat.', 'A Mining Rover digs up ore. Load it into your rocket, bring it to Earth and sell it.')}</span>
        </li>
        <li>
          <b>♻️ {L('Araç kurtarma', 'Recovery')}</b>
          <span>{L('Dünya\'ya sağlam inen aracı kurtar: parça bedelinin %80\'i geri gelir.', 'Recover a craft that lands safely on Earth: get 80% of its part cost back.')}</span>
        </li>
      </ul>
    ),
  },
  {
    id: 'colony',
    icon: '🏠',
    title: ['Kolonileşme', 'Building colonies'],
    scene: 'land',
    body: () => (
      <>
        <ol className="guide-steps">
          <li>{L(<>Hangarda roketine <b>Kargo Gövdesi</b> ekle ve Kargo bölümünden götürmek istediğin yapıları seç (Güneş Paneli, Yaşam Küresi, Uzay İstasyonu…).</>, <>In the hangar add a <b>Cargo Bay</b> and pick the buildings you want to carry in the Cargo section (Solar Panel, Habitat, Space Station…).</>)}</li>
          <li>{L(<>Hedef gezegene <b>sağlam in</b>. Altta beliren <b>Kargodaki modülleri kur</b> düğmesine bas: yapılar boş yuvalara yerleşir.</>, <><b>Land safely</b> on the target. Press <b>Unload buildings from cargo</b>: buildings drop into empty slots.</>)}</li>
          <li>{L(<>Koloni panelinde yapıları sürükleyip yerini değiştirebilirsin. <b>Uzayda yalnızca getirdiğin yapıları kurabilirsin</b>; eksik olanı bir sonraki uçuşta getir.</>, <>In the Colony panel you can drag buildings around. <b>In space you can only build what you brought</b>; bring missing ones on your next flight.</>)}</li>
        </ol>
        <GuideScene scene="colony" height={170} />
        <ul className="guide-list">
          <li>{L(<><b>Elektrik:</b> her yapı elektrikle çalışır. Güneş Paneli üretir; üretim Güneş&apos;e uzaklığın karesiyle düşer (Mars&apos;ta yaklaşık %43). Reaktör güneşten bağımsızdır.</>, <><b>Power:</b> every building runs on electricity. Solar Panels make it; output falls with the square of the distance to the Sun (about 43% at Mars). The Reactor doesn&apos;t need the Sun.</>)}</li>
          <li>{L(<><b>Uzay İstasyonu</b> (−7 ⚡) çalışınca gezegen kolonileşir ve gelir getirir: yanına yeterli panel götür.</>, <>A working <b>Space Station</b> (−7 ⚡) colonizes the planet and earns income: bring enough panels with it.</>)}</li>
          <li>{L(<><b>Yakıt Tesisi</b> madenden roket yakıtı üretir (1 t maden → 4 t yakıt): koloniden yakıt alıp yola devam edebilirsin.</>, <>A <b>Fuel Plant</b> turns ore into rocket fuel (1 t ore → 4 t fuel): refuel at your colony and keep going.</>)}</li>
          <li>{L(<>Dünya&apos;da tesisler (Telemetri, Lab, Batarya, Güneş tarlası) doğrudan parayla kurulur.</>, <>On Earth, facilities (Telemetry, Lab, Battery, Solar farm) are bought directly with money.</>)}</li>
        </ul>
      </>
    ),
  },
  {
    id: 'mp',
    icon: '🪐',
    title: ['Çok oyunculu', 'Multiplayer'],
    body: () => (
      <ul className="guide-list">
        <li>{L('Bir oda kur ve kodu arkadaşlarına ver; herkes kendi rampasından kalkar.', 'Create a room and share the code; everyone launches from their own pad.')}</li>
        <li>{L(<>Uzaya çıkınca <b>Hedefe Git</b> hızlı yolculuk yapar: yol için gereken yakıt düşülür, gemi birkaç saniyede hedefin atmosferine varır; inişi sen yaparsın.</>, <>Once in space, <b>Go to Target</b> fast-travels: the fuel for the trip is deducted and the ship reaches the target&apos;s atmosphere in seconds; you do the landing.</>)}</li>
        <li>{L('Gezegene in, kargodan Uzay İstasyonu ve panelleri kur: çalışan istasyon gezegeni senin kolonin yapar. En çok koloni kuran kazanır.', 'Land, build a Space Station and panels from cargo: a working station makes the planet your colony. Whoever founds the most colonies wins.')}</li>
        <li>{L('Dikkat: roketler birbirine çarparsa iki taraf da hasar görür.', 'Careful: if rockets collide, both get damaged.')}</li>
      </ul>
    ),
  },
]

export default function HowToPlay({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(SECTIONS[0]!.id)
  const sec = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]!
  const i = SECTIONS.indexOf(sec)
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-label={en ? 'How to Play' : 'Nasıl Oynanır?'} data-no-i18n onClick={(e) => e.stopPropagation()}>
        <nav className="guide-nav">
          <h2>{L('Nasıl Oynanır?', 'How to Play')}</h2>
          {SECTIONS.map((s) => (
            <button key={s.id} className={s.id === active ? 'is-on' : ''} onClick={() => setActive(s.id)}>
              <span aria-hidden="true">{s.icon}</span> {en ? s.title[1] : s.title[0]}
            </button>
          ))}
        </nav>
        <article className="guide-body">
          <header>
            <h3>
              <span aria-hidden="true">{sec.icon}</span> {en ? sec.title[1] : sec.title[0]}
            </h3>
            <button className="dialog-close" aria-label={en ? 'Close' : 'Kapat'} onClick={onClose}>
              ×
            </button>
          </header>
          {sec.scene && <GuideScene key={sec.scene} scene={sec.scene} height={sec.scene === 'build' ? 300 : 240} />}
          <div className="guide-text">{sec.body()}</div>
          <footer>
            <button className="button button-secondary" disabled={i === 0} onClick={() => setActive(SECTIONS[i - 1]!.id)}>
              ← {L('Önceki', 'Previous')}
            </button>
            <span className="guide-count">{i + 1} / {SECTIONS.length}</span>
            {i < SECTIONS.length - 1 ? (
              <button className="button button-primary" onClick={() => setActive(SECTIONS[i + 1]!.id)}>
                {L('Sonraki', 'Next')} →
              </button>
            ) : (
              <button className="button button-primary" onClick={onClose}>
                {L('Hadi başlayalım!', "Let's go!")}
              </button>
            )}
          </footer>
        </article>
      </section>
    </div>
  )
}
