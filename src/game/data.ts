import type { PartDef, PartInst } from './types'

/** Parça kütleleri, itkiler ve fiyatlar oyun varsayımıdır; Isp oranları gerçek motor sınıflarını izler. */
export const INITIAL_MONEY = 34_000
export const GRID_W = 20
export const GRID_H = 40

export const PARTS: PartDef[] = [
  // Komuta
  { id: 'capsule', name: 'Mürettebat Kapsülü', kind: 'command', category: 'Komuta', w: 2, h: 2, mass: 1.2, cost: 1800, ecCap: 60, desc: 'Gemiyi kontrol eder. Tepki tekerleği ve küçük batarya içerir.' },
  { id: 'probe', name: 'Sonda Çekirdeği', kind: 'command', category: 'Komuta', w: 2, h: 1, mass: 0.3, cost: 900, ecCap: 30, desc: 'İnsansız, hafif kontrol birimi.' },
  { id: 'probe-ai', name: 'Yapay Zeka Sondası', kind: 'command', category: 'Komuta', w: 2, h: 1, mass: 0.25, cost: 2200, ecCap: 120, desc: 'Yüksek batarya kapasiteli gelişmiş derin uzay kontrol birimi.' },
  { id: 'nose', name: 'Burun Konisi', kind: 'nose', category: 'Komuta', w: 2, h: 2, mass: 0.15, cost: 150, desc: 'Atmosferde sürüklenmeyi azaltır.' },
  // Yakıt
  { id: 'tank-s', name: 'Tank S', kind: 'tank', category: 'Yakıt', w: 2, h: 1, mass: 0.2, fuel: 2, cost: 300, desc: '2 t yakıt.' },
  { id: 'tank-m', name: 'Tank M', kind: 'tank', category: 'Yakıt', w: 2, h: 2, mass: 0.4, fuel: 4, cost: 550, desc: '4 t yakıt.' },
  { id: 'tank-l', name: 'Tank L', kind: 'tank', category: 'Yakıt', w: 2, h: 3, mass: 0.6, fuel: 6, cost: 800, desc: '6 t yakıt.' },
  { id: 'tank-xl', name: 'Tank XL', kind: 'tank', category: 'Yakıt', w: 2, h: 4, mass: 0.8, fuel: 8, cost: 1000, desc: '8 t yakıt.' },
  { id: 'tank-xxl', name: 'Süper Tank XXL', kind: 'tank', category: 'Yakıt', w: 2, h: 5, mass: 1.4, fuel: 14, cost: 1800, desc: '14 t yakıt; gezegenler arası ağır görevler için.' },
  { id: 'tank-slim', name: 'İnce Tank', kind: 'tank', category: 'Yakıt', w: 1, h: 2, mass: 0.2, fuel: 2, cost: 320, desc: '2 t yakıt, 1 kare genişlik.' },
  // Motorlar
  { id: 'titan', name: 'Titan (kalkış)', kind: 'engine', category: 'Motorlar', w: 2, h: 3, mass: 3.0, thrust: 480, ispVac: 265, ispSL: 240, cost: 2600, desc: 'Çok yüksek itki, çok yakıt yakar. Dünya\'dan kalkış için.' },
  { id: 'hawk', name: 'Hawk (orta)', kind: 'engine', category: 'Motorlar', w: 2, h: 2, mass: 1.4, thrust: 180, ispVac: 285, ispSL: 235, cost: 1400, desc: 'Dengeli: yan iticiler ve ikinci kademe.' },
  { id: 'aerospike', name: 'Aerospike (çoklu)', kind: 'engine', category: 'Motorlar', w: 2, h: 2, mass: 1.1, thrust: 240, ispVac: 340, ispSL: 305, cost: 2400, desc: 'Venüs ve Dünya gibi yoğun atmosferlerde bile verimli motor.' },
  { id: 'frontier', name: 'Frontier (vakum)', kind: 'engine', category: 'Motorlar', w: 2, h: 2, mass: 0.6, thrust: 60, ispVac: 345, ispSL: 100, cost: 1200, desc: 'Düşük itki ama uzayda çok verimli. Atmosferde gücünü kaybeder.' },
  { id: 'kolibri', name: 'Kolibri (mini)', kind: 'engine', category: 'Motorlar', w: 1, h: 1, mass: 0.15, thrust: 16, ispVac: 315, ispSL: 140, cost: 450, desc: 'Küçük iniş araçları için.' },
  { id: 'ion', name: 'İyon Motoru', kind: 'engine', category: 'Motorlar', w: 1, h: 1, mass: 0.12, thrust: 1.6, ispVac: 2100, ispSL: 2100, ecUse: 8, cost: 2200, desc: 'Minik itki, devasa verim. Elektrik ister: batarya + panel/RTG.' },
  { id: 'nerva', name: 'NERVA (nükleer)', kind: 'engine', category: 'Motorlar', w: 2, h: 3, mass: 2.2, thrust: 140, ispVac: 760, ispSL: 160, cost: 4800, desc: 'Nükleer termal motor: dış gezegenler ve geri dönüş için dev Δv.' },
  // Kademe
  { id: 'decoupler', name: 'Dikey Kademe Adaptörü', kind: 'decoupler', category: 'Kademe', w: 2, h: 1, mass: 0.1, cost: 200, desc: 'Üst ve alt gövdeyi bağlar. Uçuşta tıkla: alt kademe ayrılır.' },
  { id: 'radial', name: 'Yatay Kademe Adaptörü', kind: 'radialDecoupler', category: 'Kademe', w: 1, h: 1, mass: 0.05, cost: 150, desc: 'Yan iticiyi ana gövdeye bağlar. Uçuşta tıkla: yan gövde ayrılır.' },
  // Güç
  { id: 'solar', name: 'Güneş Paneli', kind: 'solar', category: 'Güç', w: 1, h: 2, mass: 0.06, ecGen: 5, cost: 500, desc: 'Tıklayınca açılır/kapanır. Üretim Güneş\'e uzaklığın karesiyle azalır.' },
  { id: 'solar-xl', name: 'Geniş Güneş Paneli', kind: 'solar', category: 'Güç', w: 1, h: 3, mass: 0.12, ecGen: 15, cost: 1300, desc: 'Yüksek çıkışlı açılır güneş kanadı.' },
  { id: 'rtg', name: 'RTG Nükleer Pil', kind: 'rtg', category: 'Güç', w: 1, h: 2, mass: 0.25, ecGen: 4, cost: 2600, desc: 'Güneş\'ten bağımsız sürekli elektrik üretir (Jüpiter/Satürn için ideal).' },
  { id: 'battery', name: 'Batarya', kind: 'battery', category: 'Güç', w: 2, h: 1, mass: 0.2, ecCap: 240, cost: 350, desc: 'Elektrik depolar.' },
  { id: 'rcs', name: 'RCS İticisi', kind: 'rcs', category: 'Güç', w: 1, h: 1, mass: 0.05, cost: 220, desc: 'Yan iticiler: R ile aç; I/J/K/L ile öteleme. Görselde kısa hava akışı püskürtür.' },
  // İniş
  { id: 'chute', name: 'Paraşüt', kind: 'chute', category: 'İniş', w: 2, h: 1, mass: 0.1, cost: 300, desc: 'Yalnızca atmosferde çalışır (Dünya, Venüs, Mars, Titan).' },
  { id: 'leg', name: 'İniş Ayağı', kind: 'leg', category: 'İniş', w: 1, h: 2, mass: 0.08, legTolerance: 14, cost: 180, desc: '14 m/s hıza kadar sert inişlere dayanır.' },
  { id: 'heavy-leg', name: 'Ağır İniş Ayağı', kind: 'leg', category: 'İniş', w: 1, h: 2, mass: 0.18, legTolerance: 24, cost: 450, desc: 'Güçlendirilmiş amortisör: 24 m/s hıza kadar güvenli iniş.' },
  // Kargo
  { id: 'cargo', name: 'Kargo Gövdesi', kind: 'cargo', category: 'Kargo', w: 2, h: 2, mass: 0.4, cargoCap: 4, cost: 600, desc: '4 t üs modülü veya maden taşır.' },
  { id: 'cargo-lg', name: 'Büyük Kargo Gövdesi', kind: 'cargo', category: 'Kargo', w: 2, h: 3, mass: 0.8, cargoCap: 10, cost: 1400, desc: '10 t modül veya maden taşır; büyük koloniler kurmak için.' },
  // Silahlar (12 özgün FTL tarzı uzay & koloni kuşatma silahı)
  {
    id: 'gun-vulcan', name: 'Vulcan Zincir Topu', kind: 'weapon', category: 'Silahlar', w: 1, h: 2, mass: 0.25, cost: 900, hp: 90,
    desc: 'FTL zincir mekanizması: 0.42 sn ile başlar, basılı tuttukça dönüp 0.065 sn seri ateşe çıkar (240 mermi).',
    weapon: { kind: 'ballistic', group: 1, dmg: 11, cooldown: 0.42, minCooldown: 0.065, spinRate: 0.24, speed: 820, ttl: 2.3, spread: 0.04, ammo: 240, ecUse: 0.2, recoil: 0.35, gimbal: 2.35, color: '#fbbf24' },
  },
  {
    id: 'gun-twin', name: 'İkili Seri Top', kind: 'weapon', category: 'Silahlar', w: 2, h: 2, mass: 0.55, cost: 1600, hp: 130,
    desc: '3 atışlık seri salvoyla (Burst) ateşlenen 30mm çift namlu top (150 mermi).',
    weapon: { kind: 'ballistic', group: 1, dmg: 22, colonyMult: 1.2, cooldown: 1.35, burstCount: 3, burstInterval: 0.09, speed: 860, ttl: 2.8, splash: 4, spread: 0.018, ammo: 150, ecUse: 0.5, recoil: 0.7, gimbal: 2.2, color: '#fb923c' },
  },
  {
    id: 'gun-heavy', name: '120mm Kuşatma Topu', kind: 'weapon', category: 'Silahlar', w: 2, h: 3, mass: 1.2, cost: 2800, hp: 180,
    desc: 'Yerçekimiyle yay çizen dev patlayıcı obüs: koloni binalarına 1.8× hasar ve sert geri tepme (24 mermi).',
    weapon: { kind: 'ballistic', group: 3, dmg: 185, colonyMult: 1.8, cooldown: 1.6, speed: 580, ttl: 5.5, splash: 34, spread: 0.006, ammo: 24, ecUse: 1.5, recoil: 22, gimbal: 0.65, gravityScale: 1.0, color: '#f97316' },
  },
  {
    id: 'gun-flak', name: 'Şarapnel Topu (Flak)', kind: 'weapon', category: 'Silahlar', w: 2, h: 2, mass: 0.65, cost: 1900, hp: 140,
    desc: 'FTL tarzı 9 parçacıklı hava patlamalı top: nişan alınan noktada ve yaklaşmada infilak eder (45 mermi).',
    weapon: { kind: 'flak', group: 1, dmg: 18, cooldown: 1.75, speed: 670, ttl: 2.0, splash: 15, pellets: 9, spread: 0.22, ammo: 45, ecUse: 0.9, recoil: 5.5, gimbal: 2.1, proximity: 26, color: '#fde047' },
  },
  {
    id: 'gun-railgun', name: 'Elektromanyetik Raylı Top', kind: 'weapon', category: 'Silahlar', w: 2, h: 4, mass: 1.5, cost: 4200, hp: 170,
    desc: '0.9 sn bobin şarjıyla 2.800 m/s hipersonik mızrak atar! Kalkanın %65\'ini ve 3 parçayı birden deler (16 mermi).',
    weapon: { kind: 'railgun', group: 1, dmg: 260, colonyMult: 1.35, shieldPierce: 0.65, overpenetrate: 3, chargeTime: 0.9, cooldown: 1.6, speed: 2800, ttl: 2.2, splash: 8, spread: 0.001, ammo: 16, ecUse: 24, recoil: 14, gimbal: 0.35, color: '#38d9e8' },
  },
  {
    id: 'gun-laser', name: 'Odak Lazeri', kind: 'weapon', category: 'Silahlar', w: 1, h: 2, mass: 0.35, cost: 2400, hp: 100,
    desc: 'Sınırsız cephane! Basılı tuttukça kesintisiz yakan odak ışını çıkarır (elektrik harcar).',
    weapon: { kind: 'beam', group: 1, dmg: 11, cooldown: 0.1, chargeTime: 0.2, beamSustain: true, beamWidth: 2.4, speed: 0, range: 2500, ttl: 0.18, ecUse: 1.9, gimbal: 2.4, color: '#fb7185' },
  },
  {
    id: 'gun-beam', name: 'Dev Ölüm Lazeri', kind: 'weapon', category: 'Silahlar', w: 2, h: 3, mass: 1.15, cost: 4600, hp: 160,
    desc: '1.1 sn reaktör şarjıyla 1.4 sn boyunca 3,5 km dev süpürücü ölüm ışını ateşler! Zırh ve kolonileri biçer (∞).',
    weapon: { kind: 'beam', group: 3, dmg: 32, colonyMult: 1.6, overpenetrate: 4, chargeTime: 1.1, beamDuration: 1.4, beamWidth: 9.5, cooldown: 2.0, speed: 0, range: 3500, ttl: 0.24, splash: 14, ecUse: 24, gimbal: 1.15, color: '#e879f9' },
  },
  {
    id: 'gun-plasma', name: 'Plazma Topu', kind: 'weapon', category: 'Silahlar', w: 2, h: 2, mass: 0.75, cost: 3100, hp: 140,
    desc: 'Kalkanlara 2.4× hasar veren aşırı sıcak plazma küresi ve gövdede süren yanma hasarı (50 atış).',
    weapon: { kind: 'plasma', group: 1, dmg: 95, shieldMult: 2.4, colonyMult: 1.15, burnDot: 2.4, cooldown: 1.0, speed: 490, ttl: 4.0, splash: 18, spread: 0.01, ammo: 50, ecUse: 9, recoil: 3.0, gimbal: 2.2, color: '#4ade80' },
  },
  {
    id: 'gun-rocketpod', name: 'Roket Salvo Podu', kind: 'weapon', category: 'Silahlar', w: 1, h: 3, mass: 0.5, cost: 2100, hp: 110,
    desc: 'Tek tetikte peş peşe 5 patlayıcı mini roket salvosu yağdırır (45 roket).',
    weapon: { kind: 'rocket', group: 2, dmg: 44, colonyMult: 1.3, cooldown: 1.6, burstCount: 5, burstInterval: 0.08, speed: 500, ttl: 4.4, splash: 20, spread: 0.08, ammo: 45, ecUse: 0.4, recoil: 1.1, gimbal: 0.45, gravityScale: 0.25, color: '#ff8a3d' },
  },
  {
    id: 'gun-missile', name: 'Güdümlü Füze Rampası', kind: 'weapon', category: 'Silahlar', w: 2, h: 3, mass: 0.95, cost: 3800, hp: 145,
    desc: 'Sınırlı 8 füze! Kalkanların %75\'ini deler, imlece yakın düşmana kilitlenip sert manevrayla kovalar.',
    weapon: { kind: 'missile', group: 2, dmg: 195, shieldPierce: 0.75, colonyMult: 1.2, cooldown: 1.9, speed: 560, ttl: 8.5, splash: 26, spread: 0.02, ammo: 8, ecUse: 2, recoil: 1.5, gimbal: 0.85, turnRate: 3.4, gravityScale: 0.15, proximity: 8, color: '#f43f5e' },
  },
  {
    id: 'gun-torpedo', name: 'Nükleer Kuşatma Torpidosu', kind: 'weapon', category: 'Silahlar', w: 2, h: 3, mass: 1.4, cost: 4400, hp: 175,
    desc: 'Sınırlı 4 ağır savaş başlığı: koloni binalarına 2.8× yıkım ve 56 m nükleer şok dalgası!',
    weapon: { kind: 'torpedo', group: 3, dmg: 420, colonyMult: 2.8, cooldown: 3.2, speed: 240, ttl: 12.0, splash: 56, spread: 0.008, ammo: 4, ecUse: 3.0, recoil: 4.5, gimbal: 0.5, gravityScale: 0.9, color: '#ef4444' },
  },
  {
    id: 'gun-emp', name: 'EMP İyon Topu', kind: 'weapon', category: 'Silahlar', w: 2, h: 2, mass: 0.7, cost: 2900, hp: 130,
    desc: 'Gövdeyi az çizer ama kalkana +120 iyon şoku vurur, silah şarjını sıfırlar ve taretleri 4.5 sn kilitler (20 atış).',
    weapon: { kind: 'emp', group: 3, dmg: 10, shieldMult: 3.2, shieldFlat: 120, resetCharge: true, cooldown: 1.5, speed: 720, ttl: 3.2, splash: 38, spread: 0.01, ammo: 20, ecUse: 12, recoil: 1.5, gimbal: 2.2, empDrain: 90, empStun: 4.5, color: '#60a5fa' },
  },
  // Savunma
  {
    id: 'armor-plate', name: 'Titanyum Zırh Plakası', kind: 'armor', category: 'Savunma', w: 2, h: 1, mass: 0.35, cost: 420, hp: 320,
    armor: { absorb: 0.55, hardness: 4 },
    desc: 'Yüksek dayanımlı zırh (320 HP): bitişiğindeki parçalara gelen hasarın %55\'ini üstlenir.',
  },
  {
    id: 'armor-side', name: 'Yan Zırh Plakası', kind: 'armor', category: 'Savunma', w: 1, h: 2, mass: 0.3, cost: 400, hp: 300,
    armor: { absorb: 0.55, hardness: 4 },
    desc: 'Dikey zırh (300 HP): tankların ve kargonun yanına takılır, komşu hasarın %55\'ini üstlenir.',
  },
  {
    id: 'armor-light', name: 'Hafif Zırh Karosu', kind: 'armor', category: 'Savunma', w: 1, h: 1, mass: 0.12, cost: 180, hp: 140,
    armor: { absorb: 0.45, hardness: 2 },
    desc: 'Ucuz ve hafif (140 HP): boşlukları kapatır, komşu hasarın %45\'ini üstlenir.',
  },
  {
    id: 'armor-heavy', name: 'Kompozit Reaktif Zırh', kind: 'armor', category: 'Savunma', w: 2, h: 1, mass: 0.8, cost: 1100, hp: 640,
    armor: { absorb: 0.7, hardness: 10 },
    desc: 'Ağır ama çok sağlam (640 HP): komşu hasarın %70\'ini üstlenir, her isabetten 10 hasarı siler.',
  },
  {
    id: 'shield-gen', name: 'Enerji Kalkanı Jeneratörü', kind: 'shield', category: 'Savunma', w: 2, h: 1, mass: 0.45, cost: 2600, hp: 140, shieldCap: 200,
    desc: 'Roket çevresinde +200 HP yenilenen plazma kalkanı oluşturur (elektrik harcar).',
  },
  // Dron Fırlatıcılar (Roket başına en fazla 1 adet; 1 elektrikli fan-air dron taşır)
  {
    id: 'drone-bay-s', name: 'Mini Keşif Dron Fırlatıcı', kind: 'droneBay', category: 'Dron', w: 1, h: 1, mass: 0.9, cost: 3200, hp: 140,
    desc: '1 adet elektrikli fan-pervaneli Keşif Dronu Mk-I fırlatır (3.5 t kargo). Dron silahsızdır; uzay sınırına çıkarsa uyarı verip parçalanır.',
    droneSpec: { tier: 1, ammo: 1, cooldown: 2.5, ecUse: 6, launchSpeed: 24, cargoCap: 3.5, thrust: 145, fuelCap: 0, hp: 160, color: '#38bdf8', name: 'Keşif Dronu Mk-I' },
  },
  {
    id: 'drone-bay-m', name: 'Kargo Dron Fırlatıcı', kind: 'droneBay', category: 'Dron', w: 1, h: 2, mass: 1.8, cost: 6800, hp: 200,
    desc: '1 adet elektrikli fan-pervaneli Nakliye Dronu Mk-II fırlatır (7.5 t kargo). Diğer çeyreklere Uzay İstasyonu ve panel taşıyıp kolonileştirir.',
    droneSpec: { tier: 2, ammo: 1, cooldown: 3.0, ecUse: 10, launchSpeed: 28, cargoCap: 7.5, thrust: 265, fuelCap: 0, hp: 260, color: '#34d399', name: 'Nakliye Dronu Mk-II' },
  },
  {
    id: 'drone-bay-l', name: 'Ağır Koloni Dron Hangarı', kind: 'droneBay', category: 'Dron', w: 2, h: 2, mass: 3.2, cost: 12000, hp: 280,
    desc: '1 adet ağır fan-rotorlu Koloni Dronu Mk-III fırlatır (14 t kargo). Uzay İstasyonu + Rampa + Reaktör taşıyıp uzak çeyreğe otonom uçar.',
    droneSpec: { tier: 3, ammo: 1, cooldown: 3.5, ecUse: 14, launchSpeed: 32, cargoCap: 14.0, thrust: 480, fuelCap: 0, hp: 380, color: '#f59e0b', name: 'Koloni Dronu Mk-III' },
  },
]

/** Fırlatma rampasından roket olmadan doğrudan kaldırılan otonom dronların maliyet ve özellikleri. */
export const PAD_DRONE_SPECS: Record<1 | 2 | 3, { tier: 1 | 2 | 3; name: string; cost: number; cargoCap: number; thrust: number; hp: number; color: string }> = {
  1: { tier: 1, name: 'Keşif Dronu Mk-I', cost: 2400, cargoCap: 3.5, thrust: 145, hp: 160, color: '#38bdf8' },
  2: { tier: 2, name: 'Nakliye Dronu Mk-II', cost: 5200, cargoCap: 7.5, thrust: 265, hp: 260, color: '#34d399' },
  3: { tier: 3, name: 'Koloni Dronu Mk-III', cost: 9500, cargoCap: 14.0, thrust: 480, hp: 380, color: '#f59e0b' },
}

/** Elektrikli fan-air gezegen dronları (roket iticisi/yakıtı kullanmaz; montaj paletinde görünmez). */
export const DRONE_PARTS: PartDef[] = [
  { id: 'drone-core-1', name: 'Dron Beyni Mk-I', kind: 'command', category: 'Dron', w: 2, h: 1, mass: 0.3, cost: 0, hp: 90, ecCap: 120, ecGen: 6, desc: 'Otonom quad-rotor uçuş bilgisayarı.' },
  { id: 'drone-cargo-1', name: 'Dron Kargo Mk-I', kind: 'cargo', category: 'Dron', w: 2, h: 1, mass: 0.2, cost: 0, hp: 80, cargoCap: 3.5, desc: '3.5 t hafif dron yük askısı.' },
  { id: 'drone-bat-1', name: 'Lityum Güç Paketi Mk-I', kind: 'battery', category: 'Dron', w: 2, h: 1, mass: 0.25, cost: 0, hp: 80, ecCap: 160, desc: 'Fan pervaneleri için yüksek yoğunluklu elektrik hücresi.' },
  { id: 'drone-fan-1', name: 'Quad-Fan Pervane Mk-I', kind: 'engine', category: 'Dron', w: 2, h: 1, mass: 0.3, cost: 0, hp: 80, thrust: 145, ecUse: 2.2, electricFan: true, ispVac: 1, ispSL: 1, desc: '4× elektrikli hava fanı rotorları ve iniş kızağı (roket yakıtı yakmaz).' },

  { id: 'drone-core-2', name: 'Dron Beyni Mk-II', kind: 'command', category: 'Dron', w: 2, h: 1, mass: 0.4, cost: 0, hp: 140, ecCap: 180, ecGen: 10, desc: 'Gelişmiş otonom dron çekirdeği.' },
  { id: 'drone-cargo-2', name: 'Dron Kargo Mk-II', kind: 'cargo', category: 'Dron', w: 2, h: 1, mass: 0.35, cost: 0, hp: 120, cargoCap: 7.5, desc: '7.5 t orta dron yük askısı.' },
  { id: 'drone-bat-2', name: 'Lityum Güç Paketi Mk-II', kind: 'battery', category: 'Dron', w: 2, h: 1, mass: 0.35, cost: 0, hp: 115, ecCap: 260, desc: 'Uzun menzilli fan pervanesi bataryası.' },
  { id: 'drone-fan-2', name: 'Quad-Fan Pervane Mk-II', kind: 'engine', category: 'Dron', w: 2, h: 1, mass: 0.45, cost: 0, hp: 115, thrust: 265, ecUse: 3.0, electricFan: true, ispVac: 1, ispSL: 1, desc: 'Güçlü kanallı elektrik fan rotorları ve iniş kızağı.' },

  { id: 'drone-core-3', name: 'Dron Beyni Mk-III', kind: 'command', category: 'Dron', w: 2, h: 1, mass: 0.5, cost: 0, hp: 200, ecCap: 280, ecGen: 15, desc: 'Ağır koloni dronu yapay zeka çekirdeği.' },
  { id: 'drone-cargo-3', name: 'Dron Kargo Mk-III', kind: 'cargo', category: 'Dron', w: 2, h: 1, mass: 0.5, cost: 0, hp: 180, cargoCap: 14.0, desc: '14 t ağır koloni yük askısı.' },
  { id: 'drone-bat-3', name: 'Lityum Güç Paketi Mk-III', kind: 'battery', category: 'Dron', w: 2, h: 1, mass: 0.45, cost: 0, hp: 165, ecCap: 420, desc: 'Ağır turbo-fan güç modülü.' },
  { id: 'drone-fan-3', name: 'Quad-Fan Pervane Mk-III', kind: 'engine', category: 'Dron', w: 2, h: 1, mass: 0.6, cost: 0, hp: 165, thrust: 480, ecUse: 4.0, electricFan: true, ispVac: 1, ispSL: 1, desc: 'Ağır yük kaldırmalı dört kanallı hava fanı sistemi.' },
]

export function droneDesign(tier: 1 | 2 | 3): PartInst[] {
  return [
    { def: `drone-core-${tier}`, x: 6, y: 8 },
    { def: `drone-cargo-${tier}`, x: 6, y: 9 },
    { def: `drone-bat-${tier}`, x: 6, y: 10 },
    { def: `drone-fan-${tier}`, x: 6, y: 11 },
  ]
}

/** ISS parçaları: montaj paletinde görünmez, yalnızca istasyonu oluşturur. */
export const STATION_PARTS: PartDef[] = [
  { id: 'iss-core', name: 'ISS Ana Modül', kind: 'station', category: 'Komuta', w: 2, h: 3, mass: 4, cost: 0, ecCap: 200, desc: 'Uluslararası Uzay İstasyonu ana modülü.' },
  { id: 'iss-node', name: 'ISS Kenetlenme Kapısı', kind: 'station', category: 'Komuta', w: 2, h: 1, mass: 1, cost: 0, desc: 'Gemilerin kenetlendiği kapı.' },
  { id: 'iss-wing', name: 'ISS Güneş Kanadı', kind: 'station', category: 'Komuta', w: 4, h: 2, mass: 1, cost: 0, desc: 'İstasyonun güneş panelleri.' },
]

/** Yağma modu uzay üssü parçaları: montaj paletinde görünmez. */
export const OUTPOST_PARTS: PartDef[] = [
  { id: 'base-core', name: 'Üs Çekirdeği', kind: 'station', category: 'Komuta', w: 4, h: 4, mass: 40, cost: 0, hp: 1500, ecCap: 2000, desc: 'Uzay üssünün çekirdeği: yok edilirse üs yağmalanır.' },
  { id: 'base-wing', name: 'Üs Güneş Kanadı', kind: 'station', category: 'Komuta', w: 4, h: 2, mass: 4, cost: 0, hp: 260, desc: 'Üssün güneş panelleri.' },
  { id: 'base-dock', name: 'Üs Rıhtımı', kind: 'station', category: 'Komuta', w: 4, h: 1, mass: 6, cost: 0, hp: 420, desc: 'Gemilerin ikmal aldığı rıhtım.' },
  {
    id: 'base-turret', name: 'Üs Savunma Tareti', kind: 'weapon', category: 'Silahlar', w: 2, h: 2, mass: 3, cost: 0, hp: 280,
    desc: 'Üssü kendiliğinden savunan çift namlulu taret.',
    weapon: { kind: 'ballistic', group: 1, dmg: 11, cooldown: 0.24, speed: 850, ttl: 1.5, spread: 0.035, gimbal: Math.PI, color: '#7dd3fc' },
  },
]
/** Üs seviyesine göre tasarım: Lv1 2 taret -> Lv5 10 taret + 8 kalkan + tam ağır zırh kalesi. */
export function outpostDesign(level: number): PartInst[] {
  const d: PartInst[] = [
    { def: 'armor-heavy', x: 4, y: 0 },
    { def: 'armor-heavy', x: 6, y: 0 },
    { def: 'base-core', x: 4, y: 1 },
    { def: 'base-wing', x: 0, y: 2 },
    { def: 'base-wing', x: 8, y: 2 },
    { def: 'base-turret', x: 2, y: 4 },
    { def: 'base-turret', x: 8, y: 4 },
    { def: 'base-dock', x: 4, y: 5 },
  ]
  if (level >= 2) {
    d.push({ def: 'base-turret', x: 0, y: 4 }, { def: 'base-turret', x: 10, y: 4 }, { def: 'shield-gen', x: 4, y: 6 }, { def: 'shield-gen', x: 6, y: 6 })
  }
  if (level >= 3) {
    d.push(
      { def: 'armor-heavy', x: 0, y: 1 }, { def: 'armor-heavy', x: 2, y: 1 }, { def: 'armor-heavy', x: 8, y: 1 }, { def: 'armor-heavy', x: 10, y: 1 },
      { def: 'base-turret', x: 0, y: 6 }, { def: 'base-turret', x: 10, y: 6 }, { def: 'shield-gen', x: 4, y: 7 }, { def: 'shield-gen', x: 6, y: 7 },
    )
  }
  if (level >= 4) {
    d.push(
      { def: 'armor-heavy', x: 2, y: 0 }, { def: 'armor-heavy', x: 8, y: 0 },
      { def: 'shield-gen', x: 2, y: 6 }, { def: 'shield-gen', x: 8, y: 6 },
      { def: 'base-turret', x: 4, y: 8 }, { def: 'base-turret', x: 6, y: 8 },
    )
  }
  if (level >= 5) {
    d.push(
      { def: 'armor-heavy', x: 0, y: 0 }, { def: 'armor-heavy', x: 10, y: 0 },
      { def: 'shield-gen', x: 2, y: 7 }, { def: 'shield-gen', x: 8, y: 7 },
      { def: 'armor-plate', x: 2, y: 8 }, { def: 'armor-plate', x: 8, y: 8 },
      { def: 'base-turret', x: 0, y: 8 }, { def: 'base-turret', x: 10, y: 8 },
    )
  }
  return d
}
export const OUTPOST_MAX_LEVEL = 5
export const OUTPOST_UPGRADE_COST = [0, 14_000, 28_000, 48_000, 75_000]
export const OUTPOST_INCOME_PER_MIN = [0, 3_000, 6_000, 10_000, 16_000, 25_000]
export const OUTPOST_REPAIR_RATE = [0, 14, 22, 32, 45, 62]
export const OUTPOST_LOOT_BONUS = [1, 1, 1.12, 1.25, 1.4, 1.6]

export const ISS_DESIGN: PartInst[] = [
  { def: 'iss-wing', x: 0, y: 0 },
  { def: 'iss-core', x: 4, y: 0 },
  { def: 'iss-wing', x: 6, y: 0 },
  { def: 'iss-node', x: 4, y: 3 },
]
export const ISS_ALTITUDE_M = 75_000

export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries([...PARTS, ...STATION_PARTS, ...OUTPOST_PARTS, ...DRONE_PARTS].map((p) => [p.id, p]))

export function partDef(id: string): PartDef {
  const d = PART_BY_ID[id]
  if (!d) throw new Error(`Bilinmeyen parça: ${id}`)
  return d
}

/** Hazır gelen "Selene I": Ay'a gidip dönebilen üç kademeli roket. */
export const DEFAULT_DESIGN: PartInst[] = [
  { def: 'chute', x: 6, y: 1 },
  { def: 'capsule', x: 6, y: 2 },
  { def: 'cargo', x: 6, y: 4 },
  { def: 'solar', x: 5, y: 4 },
  { def: 'solar', x: 8, y: 4 },
  { def: 'tank-m', x: 6, y: 6 },
  { def: 'rcs', x: 5, y: 6 },
  { def: 'rcs', x: 8, y: 6 },
  { def: 'leg', x: 5, y: 7 },
  { def: 'leg', x: 8, y: 7 },
  { def: 'frontier', x: 6, y: 8 },
  { def: 'decoupler', x: 6, y: 10 },
  { def: 'tank-l', x: 6, y: 11 },
  { def: 'hawk', x: 6, y: 14 },
  { def: 'decoupler', x: 6, y: 16 },
  { def: 'tank-xl', x: 6, y: 17 },
  { def: 'tank-xl', x: 6, y: 21 },
  { def: 'titan', x: 6, y: 25 },
  { def: 'radial', x: 5, y: 22 },
  { def: 'radial', x: 8, y: 22 },
  { def: 'nose', x: 3, y: 18 },
  { def: 'tank-l', x: 3, y: 20 },
  { def: 'hawk', x: 3, y: 23 },
  { def: 'nose', x: 9, y: 18 },
  { def: 'tank-l', x: 9, y: 20 },
  { def: 'hawk', x: 9, y: 23 },
]

export const SHIP_SLOT_COUNT = 5

/** Pioneer: ucuz, iki kademeli; Dünya yörüngesi ve Ay yakın geçişi için. */
const PIONEER_DESIGN: PartInst[] = [
  { def: 'chute', x: 6, y: 9 },
  { def: 'capsule', x: 6, y: 10 },
  { def: 'tank-m', x: 6, y: 12 },
  { def: 'leg', x: 5, y: 13 },
  { def: 'leg', x: 8, y: 13 },
  { def: 'frontier', x: 6, y: 14 },
  { def: 'decoupler', x: 6, y: 16 },
  { def: 'tank-l', x: 6, y: 17 },
  { def: 'tank-xl', x: 6, y: 20 },
  { def: 'titan', x: 6, y: 24 },
]

/** Atlas Kargo: iki kargo gövdeli (8 t) ağır Ay yük taşıyıcısı. */
const ATLAS_DESIGN: PartInst[] = [
  { def: 'capsule', x: 6, y: 0 },
  { def: 'cargo', x: 6, y: 2 },
  { def: 'solar', x: 5, y: 2 },
  { def: 'solar', x: 8, y: 2 },
  { def: 'cargo', x: 6, y: 4 },
  { def: 'tank-l', x: 6, y: 6 },
  { def: 'leg', x: 5, y: 8 },
  { def: 'leg', x: 8, y: 8 },
  { def: 'frontier', x: 6, y: 9 },
  { def: 'decoupler', x: 6, y: 11 },
  { def: 'tank-xl', x: 6, y: 12 },
  { def: 'hawk', x: 6, y: 16 },
  { def: 'decoupler', x: 6, y: 18 },
  { def: 'tank-xl', x: 6, y: 19 },
  { def: 'tank-xl', x: 6, y: 23 },
  { def: 'titan', x: 6, y: 27 },
  { def: 'radial', x: 5, y: 24 },
  { def: 'radial', x: 8, y: 24 },
  { def: 'nose', x: 3, y: 18 },
  { def: 'tank-l', x: 3, y: 20 },
  { def: 'tank-xl', x: 3, y: 23 },
  { def: 'titan', x: 3, y: 27 },
  { def: 'nose', x: 9, y: 18 },
  { def: 'tank-l', x: 9, y: 20 },
  { def: 'tank-xl', x: 9, y: 23 },
  { def: 'titan', x: 9, y: 27 },
]

export interface ShipPreset {
  id: string
  name: string
  desc: string
  design: PartInst[]
}

/** Hızlı başlangıç için hazır gemiler (yalnızca başlangıç teknolojisindeki parçalar). */
export const SHIP_PRESETS: ShipPreset[] = [
  { id: 'selene', name: 'Selene I', desc: 'Üç kademeli Ay gidiş-dönüş roketi, 4 t kargo.', design: DEFAULT_DESIGN },
  { id: 'pioneer', name: 'Pioneer', desc: 'Ucuz ve hafif: Dünya yörüngesi, Ay yakın geçişi.', design: PIONEER_DESIGN },
  { id: 'atlas', name: 'Atlas Kargo', desc: 'Ağır yük taşıyıcı: Ay\'a 8 t üs modülü indirir.', design: ATLAS_DESIGN },
]

const INTERCEPTOR_DESIGN: PartInst[] = [
  { def: 'nose', x: 6, y: 5 },
  { def: 'capsule', x: 6, y: 7 },
  { def: 'gun-laser', x: 5, y: 7 },
  { def: 'gun-laser', x: 8, y: 7 },
  { def: 'shield-gen', x: 6, y: 9 },
  { def: 'battery', x: 6, y: 10 },
  { def: 'solar', x: 5, y: 9 },
  { def: 'solar', x: 8, y: 9 },
  { def: 'tank-xl', x: 6, y: 11 },
  { def: 'gun-vulcan', x: 5, y: 11 },
  { def: 'gun-vulcan', x: 8, y: 11 },
  { def: 'rcs', x: 5, y: 14 },
  { def: 'rcs', x: 8, y: 14 },
  { def: 'hawk', x: 6, y: 15 },
  { def: 'decoupler', x: 6, y: 17 },
  { def: 'tank-xl', x: 6, y: 18 },
  { def: 'tank-xl', x: 6, y: 22 },
  { def: 'titan', x: 6, y: 26 },
  { def: 'radial', x: 5, y: 22 },
  { def: 'radial', x: 8, y: 22 },
  { def: 'nose', x: 3, y: 18 },
  { def: 'tank-l', x: 3, y: 20 },
  { def: 'hawk', x: 3, y: 23 },
  { def: 'nose', x: 9, y: 18 },
  { def: 'tank-l', x: 9, y: 20 },
  { def: 'hawk', x: 9, y: 23 },
]

const GUNSHIP_DESIGN: PartInst[] = [
  { def: 'nose', x: 6, y: 5 },
  { def: 'armor-plate', x: 6, y: 7 },
  { def: 'capsule', x: 6, y: 8 },
  { def: 'gun-twin', x: 4, y: 8 },
  { def: 'gun-twin', x: 8, y: 8 },
  { def: 'shield-gen', x: 6, y: 10 },
  { def: 'battery', x: 6, y: 11 },
  { def: 'rtg', x: 5, y: 10 },
  { def: 'rtg', x: 8, y: 10 },
  { def: 'tank-xl', x: 6, y: 12 },
  { def: 'gun-plasma', x: 4, y: 12 },
  { def: 'gun-plasma', x: 8, y: 12 },
  { def: 'gun-flak', x: 4, y: 14 },
  { def: 'gun-flak', x: 8, y: 14 },
  { def: 'armor-plate', x: 6, y: 16 },
  { def: 'aerospike', x: 6, y: 17 },
  { def: 'decoupler', x: 6, y: 19 },
  { def: 'tank-xl', x: 6, y: 20 },
  { def: 'tank-xl', x: 6, y: 24 },
  { def: 'titan', x: 6, y: 28 },
  { def: 'radial', x: 5, y: 22 },
  { def: 'radial', x: 8, y: 22 },
  { def: 'nose', x: 3, y: 18 },
  { def: 'tank-xl', x: 3, y: 20 },
  { def: 'titan', x: 3, y: 24 },
  { def: 'nose', x: 9, y: 18 },
  { def: 'tank-xl', x: 9, y: 20 },
  { def: 'titan', x: 9, y: 24 },
]

const SIEGE_DESIGN: PartInst[] = [
  { def: 'nose', x: 6, y: 5 },
  { def: 'capsule', x: 6, y: 7 },
  { def: 'gun-emp', x: 4, y: 7 },
  { def: 'gun-beam', x: 8, y: 7 },
  { def: 'shield-gen', x: 6, y: 9 },
  { def: 'cargo', x: 6, y: 10 },
  { def: 'solar', x: 5, y: 10 },
  { def: 'solar', x: 8, y: 10 },
  { def: 'battery', x: 6, y: 12 },
  { def: 'tank-xl', x: 6, y: 13 },
  { def: 'gun-torpedo', x: 4, y: 13 },
  { def: 'gun-missile', x: 8, y: 13 },
  { def: 'heavy-leg', x: 5, y: 16 },
  { def: 'heavy-leg', x: 8, y: 16 },
  { def: 'aerospike', x: 6, y: 17 },
  { def: 'decoupler', x: 6, y: 19 },
  { def: 'tank-xxl', x: 6, y: 20 },
  { def: 'titan', x: 6, y: 25 },
  { def: 'radial', x: 5, y: 21 },
  { def: 'radial', x: 8, y: 21 },
  { def: 'nose', x: 3, y: 18 },
  { def: 'tank-xl', x: 3, y: 20 },
  { def: 'titan', x: 3, y: 24 },
  { def: 'nose', x: 9, y: 18 },
  { def: 'tank-xl', x: 9, y: 20 },
  { def: 'titan', x: 9, y: 24 },
]

export const COMBAT_PRESETS: ShipPreset[] = [
  { id: 'interceptor', name: 'Avcı Mk-II', desc: 'FTL Vulcan + Sürekli Odak Lazeri + Kalkan + Ay menzili.', design: INTERCEPTOR_DESIGN },
  { id: 'gunship', name: 'Savaş Gemisi', desc: 'Seri İkili Top + Plazma Yanığı + Hava Patlamalı Flak + Zırh.', design: GUNSHIP_DESIGN },
  { id: 'siege', name: 'Kuşatma Gemisi', desc: 'Dev Ölüm Lazeri + Güdümlü Füze + EMP + Nükleer Torpido.', design: SIEGE_DESIGN },
]

/** Yağma modu gemileri: uzayda üsten doğar, kademe ve iniş takımı gerekmez. */
const RAIDER_DESIGN: PartInst[] = [
  { def: 'nose', x: 6, y: 5 },
  { def: 'capsule', x: 6, y: 7 },
  { def: 'gun-vulcan', x: 5, y: 7 },
  { def: 'gun-vulcan', x: 8, y: 7 },
  { def: 'cargo', x: 6, y: 9 },
  { def: 'solar', x: 5, y: 9 },
  { def: 'solar', x: 8, y: 9 },
  { def: 'tank-l', x: 6, y: 11 },
  { def: 'armor-side', x: 5, y: 11 },
  { def: 'armor-side', x: 8, y: 11 },
  { def: 'hawk', x: 6, y: 14 },
]
const HAULER_DESIGN: PartInst[] = [
  { def: 'armor-plate', x: 6, y: 4 },
  { def: 'capsule', x: 6, y: 5 },
  { def: 'shield-gen', x: 6, y: 7 },
  { def: 'battery', x: 6, y: 8 },
  { def: 'rtg', x: 5, y: 7 },
  { def: 'rtg', x: 8, y: 7 },
  { def: 'cargo-lg', x: 6, y: 9 },
  { def: 'gun-vulcan', x: 5, y: 9 },
  { def: 'gun-vulcan', x: 8, y: 9 },
  { def: 'cargo', x: 6, y: 12 },
  { def: 'armor-side', x: 5, y: 12 },
  { def: 'armor-side', x: 8, y: 12 },
  { def: 'tank-l', x: 6, y: 14 },
  { def: 'aerospike', x: 6, y: 17 },
]
const BRUISER_DESIGN: PartInst[] = [
  { def: 'armor-heavy', x: 6, y: 4 },
  { def: 'capsule', x: 6, y: 5 },
  { def: 'gun-twin', x: 4, y: 5 },
  { def: 'gun-twin', x: 8, y: 5 },
  { def: 'shield-gen', x: 6, y: 7 },
  { def: 'battery', x: 6, y: 8 },
  { def: 'rtg', x: 5, y: 7 },
  { def: 'rtg', x: 8, y: 7 },
  { def: 'cargo', x: 6, y: 9 },
  { def: 'gun-plasma', x: 4, y: 9 },
  { def: 'gun-plasma', x: 8, y: 9 },
  { def: 'tank-xl', x: 6, y: 11 },
  { def: 'armor-side', x: 5, y: 11 },
  { def: 'armor-side', x: 8, y: 11 },
  { def: 'aerospike', x: 6, y: 15 },
]
export const LOOT_PRESETS: ShipPreset[] = [
  { id: 'raider', name: 'Akıncı', desc: 'Ucuz ve çevik: çift Vulcan, 4 t kargo, yan zırh.', design: RAIDER_DESIGN },
  { id: 'hauler', name: 'Nakliyeci', desc: '14 t kargo, kalkan ve zırh: az silah, çok ganimet.', design: HAULER_DESIGN },
  { id: 'bruiser', name: 'Yıkıcı', desc: 'İkili top + plazma + kalkan + ağır zırh: üs baskını için.', design: BRUISER_DESIGN },
]

export function partMaxHp(defId: string): number {
  const d = partDef(defId)
  if (d.hp !== undefined) return d.hp
  if (d.kind === 'command') return d.id === 'capsule' ? 240 : 110
  if (d.kind === 'tank') return Math.round(75 + (d.fuel ?? 2) * 10)
  if (d.kind === 'engine') return Math.round(85 + d.mass * 35)
  if (d.kind === 'cargo') return 150
  if (d.kind === 'station') return 600
  return Math.max(55, Math.round(50 + d.w * d.h * 20))
}
