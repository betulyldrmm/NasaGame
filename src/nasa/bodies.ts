/**
 * NASA verileri → oyun evreni.
 *
 * Gerçek değerler (REAL) NASA kaynaklarından alınır, sonra tek bir yerde (SCALE) oyun
 * ölçeğine indirgenir. Oranlar korunur; mutlak boyutlar oynanabilirlik için küçültülür.
 *
 * Kaynaklar:
 *  - NASA NSSDC Planetary Fact Sheets (yarıçap, yüzey çekimi, atmosfer)
 *    https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 *  - NASA JPL SSD "Keplerian Elements for Approximate Positions of the Major Planets"
 *    (J2000 elemanları + yüzyıllık değişim hızları) https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *  - NASA mission-viz (WSMV) gezegen yörünge parametreleri tablosu (e, sma, period)
 *    https://nasa.github.io/mission-viz/
 */

export const G0 = 9.80665

/** Gerçek dünya değerleri (SI; km belirtilmedikçe). */
export const REAL = {
  mercury: { radiusKm: 2439.7, gravity: 3.7, smaAU: 0.38709927, ecc: 0.20563593, periodDays: 87.969, L0: 252.2503235, Ldot: 149472.67411175, peri0: 77.45779628 },
  venus: { radiusKm: 6051.8, gravity: 8.87, smaAU: 0.72333566, ecc: 0.00677672, periodDays: 224.701, L0: 181.9790995, Ldot: 58517.81538729, peri0: 131.60246718, atmoKm: 120, scaleHeightKm: 15.9, rho0: 4.2 },
  earth: { radiusKm: 6371.0, gravity: 9.8, smaAU: 1.00000261, ecc: 0.01671123, periodDays: 365.256, L0: 100.46457166, Ldot: 35999.37244981, peri0: 102.93768193, atmoKm: 100, scaleHeightKm: 8.5, rho0: 1.217 },
  moon: { radiusKm: 1737.4, gravity: 1.62, smaKm: 384_400, ecc: 0.0549, periodDays: 27.3217 },
  mars: { radiusKm: 3389.5, gravity: 3.71, smaAU: 1.52371034, ecc: 0.0933941, periodDays: 686.98, L0: -4.55343205, Ldot: 19140.30268499, peri0: -23.94362959, atmoKm: 125, scaleHeightKm: 11.1, rho0: 0.02 },
  ceres: { radiusKm: 469.7, gravity: 0.28, smaAU: 2.7675, ecc: 0.0758, periodDays: 1681.63, L0: 153.9, Ldot: 7820.2, peri0: 73.6 },
  jupiter: { radiusKm: 69_911, gravity: 24.79, smaAU: 5.202887, ecc: 0.04838624, periodDays: 4332.59, L0: 34.39644051, Ldot: 3034.74612775, peri0: 14.72847983 },
  ganymede: { radiusKm: 2634.1, gravity: 1.428, smaKm: 1_070_400, ecc: 0.0013, periodDays: 7.1546 },
  saturn: { radiusKm: 58_232, gravity: 10.44, smaAU: 9.53667594, ecc: 0.05386179, periodDays: 10_759.22, L0: 49.95424423, Ldot: 1222.49362201, peri0: 92.59887831 },
  titan: { radiusKm: 2574.7, gravity: 1.352, smaKm: 1_221_870, ecc: 0.0288, periodDays: 15.945, atmoKm: 100, scaleHeightKm: 21, rho0: 1.4 },
  sun: { radiusKm: 695_700 },
} as const

/** Oyun ölçeği: her satır bir tasarım kararıdır, raporda (docs/) açıklanır. */
export const SCALE = {
  /** Gezegen yarıçapları 1/20.225 → Dünya 315 km (Ay ve Mars aynı oranla). */
  radius: 315 / 6371,
  /** 1 AU = 1.000.000 km (1/149,6). */
  auMeters: 1.0e9,
  /** 1 gerçek gün = 1 oyun saati → yörünge periyotları 1/24. */
  secondsPerRealDay: 3600,
  /** Atmosfer kalınlığı ve ölçek yüksekliği (Dünya 100 km → 30 km). */
  atmosphere: 0.3,
} as const

/** Oyunun başlangıç tarihi: NASA Space Apps 2026 (14 Kasım 2026, 12:00 TT). */
export const EPOCH_JD = 2461359.0
const J2000_JD = 2451545.0

export interface OrbitDef {
  /** yarı-büyük eksen (m) */
  a: number
  e: number
  /** günberi boylamı (rad) */
  argp: number
  /** t=0 anındaki ortalama anomali (rad) */
  M0: number
  /** ortalama hareket (rad/s) */
  n: number
}

export interface BodyDef {
  id: BodyId
  name: string
  parentId: BodyId | null
  radius: number
  /** kütleçekim parametresi μ = g·R² (m³/s²) */
  mu: number
  gravity: number
  /** etki alanı (SOI) yarıçapı; Güneş için Infinity */
  soi: number
  atmoHeight: number
  scaleHeight: number
  rho0: number
  orbit: OrbitDef | null
  landable: boolean
  colors: { base: string; light: string; dark: string; sky: string; map: string }
  orePrice: number
  /** Yüzey üssü pasif gelir çarpanı */
  incomeMult: number
}

export type BodyId = 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars' | 'ceres' | 'jupiter' | 'ganymede' | 'saturn' | 'titan'

const rad = (deg: number) => (deg * Math.PI) / 180
const T_CENTURIES = (EPOCH_JD - J2000_JD) / 36525

function muFromSurface(gravity: number, radius: number) {
  return gravity * radius * radius
}

/** Kepler'in 3. yasası: n = 2π / T. */
function meanMotion(periodDays: number) {
  return (2 * Math.PI) / (periodDays * SCALE.secondsPerRealDay)
}

/** JPL yaklaşık elemanları: L(T) = L0 + Ldot·T, M = L − ϖ. */
function planetOrbit(p: { smaAU: number; ecc: number; periodDays: number; L0: number; Ldot: number; peri0: number }): OrbitDef {
  const L = p.L0 + p.Ldot * T_CENTURIES
  const M = (((L - p.peri0) % 360) + 360) % 360
  return { a: p.smaAU * SCALE.auMeters, e: p.ecc, argp: rad(p.peri0), M0: rad(M), n: meanMotion(p.periodDays) }
}

const scaledRadius = (radiusKm: number) => radiusKm * 1000 * SCALE.radius
const mercuryRadius = scaledRadius(REAL.mercury.radiusKm)
const venusRadius = scaledRadius(REAL.venus.radiusKm)
const earthRadius = scaledRadius(REAL.earth.radiusKm)
const moonRadius = scaledRadius(REAL.moon.radiusKm)
const marsRadius = scaledRadius(REAL.mars.radiusKm)
const ceresRadius = scaledRadius(REAL.ceres.radiusKm)
const jupiterRadius = scaledRadius(REAL.jupiter.radiusKm)
const ganymedeRadius = scaledRadius(REAL.ganymede.radiusKm)
const saturnRadius = scaledRadius(REAL.saturn.radiusKm)
const titanRadius = scaledRadius(REAL.titan.radiusKm)

const mercuryMu = muFromSurface(REAL.mercury.gravity, mercuryRadius)
const venusMu = muFromSurface(REAL.venus.gravity, venusRadius)
const earthMu = muFromSurface(REAL.earth.gravity, earthRadius)
const moonMu = muFromSurface(REAL.moon.gravity, moonRadius)
const marsMu = muFromSurface(REAL.mars.gravity, marsRadius)
const ceresMu = muFromSurface(REAL.ceres.gravity, ceresRadius)
const jupiterMu = muFromSurface(REAL.jupiter.gravity, jupiterRadius)
const ganymedeMu = muFromSurface(REAL.ganymede.gravity, ganymedeRadius)
const saturnMu = muFromSurface(REAL.saturn.gravity, saturnRadius)
const titanMu = muFromSurface(REAL.titan.gravity, titanRadius)

const mercuryOrbit = planetOrbit(REAL.mercury)
const venusOrbit = planetOrbit(REAL.venus)
const earthOrbit = planetOrbit(REAL.earth)
const marsOrbit = planetOrbit(REAL.mars)
const ceresOrbit = planetOrbit(REAL.ceres)
const jupiterOrbit = planetOrbit(REAL.jupiter)
const saturnOrbit = planetOrbit(REAL.saturn)

/** Güneş μ'sü Dünya'nın (ölçekli) yörüngesinden türetilir: μ = n²·a³. */
const sunMu = earthOrbit.n * earthOrbit.n * earthOrbit.a ** 3
/** Uyduların yörüngeleri gerçek periyotlarından türetilir: a = (μ/n²)^(1/3). */
const moonN = meanMotion(REAL.moon.periodDays)
const moonA = Math.cbrt(earthMu / (moonN * moonN))
const ganymedeN = meanMotion(REAL.ganymede.periodDays)
const ganymedeA = Math.cbrt(jupiterMu / (ganymedeN * ganymedeN))
const titanN = meanMotion(REAL.titan.periodDays)
const titanA = Math.cbrt(saturnMu / (titanN * titanN))

/** Laplace etki alanı: r_SOI = a·(m/M)^(2/5). */
function soi(a: number, mu: number, parentMu: number) {
  return a * (mu / parentMu) ** 0.4
}

export const BODIES: Record<BodyId, BodyDef> = {
  sun: {
    id: 'sun', name: 'Güneş', parentId: null, radius: 2.2e7, mu: sunMu, gravity: 274, soi: Infinity,
    atmoHeight: 0, scaleHeight: 1, rho0: 0, orbit: null, landable: false,
    colors: { base: '#ffd76a', light: '#fff6c9', dark: '#ff9d2e', sky: '#000000', map: '#ffd76a' }, orePrice: 0, incomeMult: 0,
  },
  mercury: {
    id: 'mercury', name: 'Merkür', parentId: 'sun', radius: mercuryRadius, mu: mercuryMu, gravity: REAL.mercury.gravity,
    soi: soi(mercuryOrbit.a, mercuryMu, sunMu), atmoHeight: 0, scaleHeight: 1, rho0: 0,
    orbit: mercuryOrbit, landable: true,
    colors: { base: '#9e978e', light: '#d6cfc7', dark: '#4f4a44', sky: '#000000', map: '#b7afa6' }, orePrice: 2200, incomeMult: 2.5,
  },
  venus: {
    id: 'venus', name: 'Venüs', parentId: 'sun', radius: venusRadius, mu: venusMu, gravity: REAL.venus.gravity,
    soi: soi(venusOrbit.a, venusMu, sunMu),
    atmoHeight: REAL.venus.atmoKm * 1000 * SCALE.atmosphere,
    scaleHeight: REAL.venus.scaleHeightKm * 1000 * SCALE.atmosphere * 1.1,
    rho0: REAL.venus.rho0, orbit: venusOrbit, landable: true,
    colors: { base: '#d9a65b', light: '#f6d69d', dark: '#7b5222', sky: '#e2b068', map: '#e5b873' }, orePrice: 1800, incomeMult: 2.0,
  },
  earth: {
    id: 'earth', name: 'Dünya', parentId: 'sun', radius: earthRadius, mu: earthMu, gravity: REAL.earth.gravity,
    soi: soi(earthOrbit.a, earthMu, sunMu),
    atmoHeight: REAL.earth.atmoKm * 1000 * SCALE.atmosphere,
    scaleHeight: REAL.earth.scaleHeightKm * 1000 * SCALE.atmosphere * 1.75,
    rho0: REAL.earth.rho0, orbit: earthOrbit, landable: true,
    colors: { base: '#3f8fd8', light: '#8fd0ff', dark: '#173f73', sky: '#5aa9ee', map: '#6fb0ff' }, orePrice: 0, incomeMult: 1.0,
  },
  moon: {
    id: 'moon', name: 'Ay', parentId: 'earth', radius: moonRadius, mu: moonMu, gravity: REAL.moon.gravity,
    soi: soi(moonA, moonMu, earthMu), atmoHeight: 0, scaleHeight: 1, rho0: 0,
    orbit: { a: moonA, e: REAL.moon.ecc, argp: rad(40), M0: rad(150), n: moonN }, landable: true,
    colors: { base: '#a9adb6', light: '#e3e6ec', dark: '#5d6170', sky: '#000000', map: '#c9ccd4' }, orePrice: 420, incomeMult: 1.5,
  },
  mars: {
    id: 'mars', name: 'Mars', parentId: 'sun', radius: marsRadius, mu: marsMu, gravity: REAL.mars.gravity,
    soi: soi(marsOrbit.a, marsMu, sunMu),
    atmoHeight: 22_000, scaleHeight: 5_500, rho0: REAL.mars.rho0, orbit: marsOrbit, landable: true,
    colors: { base: '#c8643c', light: '#f0a070', dark: '#6e2f1c', sky: '#d9a06e', map: '#e07b50' }, orePrice: 1500, incomeMult: 2.2,
  },
  ceres: {
    id: 'ceres', name: 'Ceres', parentId: 'sun', radius: ceresRadius, mu: ceresMu, gravity: REAL.ceres.gravity,
    soi: soi(ceresOrbit.a, ceresMu, sunMu), atmoHeight: 0, scaleHeight: 1, rho0: 0,
    orbit: ceresOrbit, landable: true,
    colors: { base: '#7d8594', light: '#bcc4d2', dark: '#3e4450', sky: '#000000', map: '#9aa3b2' }, orePrice: 2600, incomeMult: 2.8,
  },
  jupiter: {
    id: 'jupiter', name: 'Jüpiter', parentId: 'sun', radius: jupiterRadius, mu: jupiterMu, gravity: REAL.jupiter.gravity,
    soi: soi(jupiterOrbit.a, jupiterMu, sunMu), atmoHeight: 60_000, scaleHeight: 14_000, rho0: 0.4,
    orbit: jupiterOrbit, landable: false,
    colors: { base: '#d29e6c', light: '#f3d8b6', dark: '#804c2c', sky: '#c99464', map: '#dba97a' }, orePrice: 0, incomeMult: 0,
  },
  ganymede: {
    id: 'ganymede', name: 'Ganimed', parentId: 'jupiter', radius: ganymedeRadius, mu: ganymedeMu, gravity: REAL.ganymede.gravity,
    soi: soi(ganymedeA, ganymedeMu, jupiterMu), atmoHeight: 0, scaleHeight: 1, rho0: 0,
    orbit: { a: ganymedeA, e: REAL.ganymede.ecc, argp: rad(25), M0: rad(80), n: ganymedeN }, landable: true,
    colors: { base: '#8e8a83', light: '#cfc9be', dark: '#474542', sky: '#000000', map: '#b7b2a8' }, orePrice: 3600, incomeMult: 3.5,
  },
  saturn: {
    id: 'saturn', name: 'Satürn', parentId: 'sun', radius: saturnRadius, mu: saturnMu, gravity: REAL.saturn.gravity,
    soi: soi(saturnOrbit.a, saturnMu, sunMu), atmoHeight: 65_000, scaleHeight: 16_000, rho0: 0.35,
    orbit: saturnOrbit, landable: false,
    colors: { base: '#dfc48c', light: '#faecc6', dark: '#8d7244', sky: '#d4b87e', map: '#ead099' }, orePrice: 0, incomeMult: 0,
  },
  titan: {
    id: 'titan', name: 'Titan', parentId: 'saturn', radius: titanRadius, mu: titanMu, gravity: REAL.titan.gravity,
    soi: soi(titanA, titanMu, saturnMu),
    atmoHeight: REAL.titan.atmoKm * 1000 * SCALE.atmosphere,
    scaleHeight: REAL.titan.scaleHeightKm * 1000 * SCALE.atmosphere,
    rho0: REAL.titan.rho0, orbit: { a: titanA, e: REAL.titan.ecc, argp: rad(110), M0: rad(210), n: titanN }, landable: true,
    colors: { base: '#cf873c', light: '#f4bc74', dark: '#6d4016', sky: '#d99648', map: '#e09a4a' }, orePrice: 4500, incomeMult: 4.5,
  },
}

export const BODY_LIST: BodyDef[] = [
  BODIES.sun,
  BODIES.mercury,
  BODIES.venus,
  BODIES.earth,
  BODIES.moon,
  BODIES.mars,
  BODIES.ceres,
  BODIES.jupiter,
  BODIES.ganymede,
  BODIES.saturn,
  BODIES.titan,
]

export function childrenOf(id: BodyId): BodyDef[] {
  return BODY_LIST.filter((b) => b.parentId === id)
}

/** Güneş'e uzaklığa göre 1/r² güneş paneli verimi (1 AU = 1.0). */
export function solarFlux(distanceToSunM: number): number {
  const au = Math.max(0.05, distanceToSunM / SCALE.auMeters)
  return 1 / (au * au)
}

/** Oyun saniyesini takvim tarihine çevirir (1 oyun saati = 1 gerçek gün). */
export function gameDate(timeS: number): Date {
  const days = timeS / SCALE.secondsPerRealDay
  return new Date(Date.UTC(2026, 10, 14, 12) + days * 86_400_000)
}
