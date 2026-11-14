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
  earth: { radiusKm: 6371.0, gravity: 9.8, smaAU: 1.00000261, ecc: 0.01671123, periodDays: 365.256, L0: 100.46457166, Ldot: 35999.37244981, peri0: 102.93768193, atmoKm: 100, scaleHeightKm: 8.5, rho0: 1.217 },
  moon: { radiusKm: 1737.4, gravity: 1.62, smaKm: 384_400, ecc: 0.0549, periodDays: 27.3217 },
  mars: { radiusKm: 3389.5, gravity: 3.71, smaAU: 1.52371034, ecc: 0.0933941, periodDays: 686.98, L0: -4.55343205, Ldot: 19140.30268499, peri0: -23.94362959, atmoKm: 125, scaleHeightKm: 11.1, rho0: 0.02 },
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
}

export type BodyId = 'sun' | 'earth' | 'moon' | 'mars'

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

const earthRadius = REAL.earth.radiusKm * 1000 * SCALE.radius
const moonRadius = REAL.moon.radiusKm * 1000 * SCALE.radius
const marsRadius = REAL.mars.radiusKm * 1000 * SCALE.radius
const earthMu = muFromSurface(REAL.earth.gravity, earthRadius)
const moonMu = muFromSurface(REAL.moon.gravity, moonRadius)
const marsMu = muFromSurface(REAL.mars.gravity, marsRadius)

const earthOrbit = planetOrbit(REAL.earth)
const marsOrbit = planetOrbit(REAL.mars)
/** Güneş μ'sü Dünya'nın (ölçekli) yörüngesinden türetilir: μ = n²·a³. */
const sunMu = earthOrbit.n * earthOrbit.n * earthOrbit.a ** 3
/** Ay yörüngesi gerçek periyottan (27,32 gün → 27,32 oyun saati) türetilir: a = (μ/n²)^(1/3). */
const moonN = meanMotion(REAL.moon.periodDays)
const moonA = Math.cbrt(earthMu / (moonN * moonN))

/** Laplace etki alanı: r_SOI = a·(m/M)^(2/5). */
function soi(a: number, mu: number, parentMu: number) {
  return a * (mu / parentMu) ** 0.4
}

export const BODIES: Record<BodyId, BodyDef> = {
  sun: {
    id: 'sun', name: 'Güneş', parentId: null, radius: 2.2e7, mu: sunMu, gravity: 274, soi: Infinity,
    atmoHeight: 0, scaleHeight: 1, rho0: 0, orbit: null, landable: false,
    colors: { base: '#ffd76a', light: '#fff6c9', dark: '#ff9d2e', sky: '#000000', map: '#ffd76a' }, orePrice: 0,
  },
  earth: {
    id: 'earth', name: 'Dünya', parentId: 'sun', radius: earthRadius, mu: earthMu, gravity: REAL.earth.gravity,
    soi: soi(earthOrbit.a, earthMu, sunMu),
    atmoHeight: REAL.earth.atmoKm * 1000 * SCALE.atmosphere,
    scaleHeight: REAL.earth.scaleHeightKm * 1000 * SCALE.atmosphere * 1.75,
    rho0: REAL.earth.rho0, orbit: earthOrbit, landable: true,
    colors: { base: '#3f8fd8', light: '#8fd0ff', dark: '#173f73', sky: '#5aa9ee', map: '#6fb0ff' }, orePrice: 0,
  },
  moon: {
    id: 'moon', name: 'Ay', parentId: 'earth', radius: moonRadius, mu: moonMu, gravity: REAL.moon.gravity,
    soi: soi(moonA, moonMu, earthMu), atmoHeight: 0, scaleHeight: 1, rho0: 0,
    orbit: { a: moonA, e: REAL.moon.ecc, argp: rad(40), M0: rad(150), n: moonN }, landable: true,
    colors: { base: '#a9adb6', light: '#e3e6ec', dark: '#5d6170', sky: '#000000', map: '#c9ccd4' }, orePrice: 420,
  },
  mars: {
    id: 'mars', name: 'Mars', parentId: 'sun', radius: marsRadius, mu: marsMu, gravity: REAL.mars.gravity,
    soi: soi(marsOrbit.a, marsMu, sunMu),
    atmoHeight: 22_000, scaleHeight: 5_500, rho0: REAL.mars.rho0, orbit: marsOrbit, landable: true,
    colors: { base: '#c8643c', light: '#f0a070', dark: '#6e2f1c', sky: '#d9a06e', map: '#e07b50' }, orePrice: 1500,
  },
}

export const BODY_LIST: BodyDef[] = [BODIES.sun, BODIES.earth, BODIES.moon, BODIES.mars]

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
