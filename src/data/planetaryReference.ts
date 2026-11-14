import rawReference from './planetary-reference.json'

export interface KeplerOrbitRecord {
  target: string
  ephemerisSolution: string
  semiMajorAxisAu: number
  eccentricity: number
  inclinationDeg: number
  longitudeAscendingNodeDeg: number
  argumentPeriapsisDeg: number
  meanAnomalyDegAtEpoch: number
  meanMotionDegPerDay: number
  orbitalPeriodDays: number
}

export interface SolarIrradianceRecord {
  target: string
  valueWm2: number
  measure: string
  source: string
  sourceUrl: string
  referenceDate: string
}

export interface VerifiedPlanetaryReference {
  schemaVersion: number
  retrievedAt: string
  orbitEpoch: { calendar: string; timeScale: 'TDB'; julianDay: number }
  orbitFrame: {
    origin: string
    referenceSystem: 'ICRF'
    referencePlane: string
    ephemerisType: string
    distanceUnit: 'au'
    angleUnit: 'deg'
    timeUnit: 'day'
    source: string
    apiUrl: string
    documentationUrl: string
    query: string
  }
  orbits: Record<'earth' | 'mars', KeplerOrbitRecord>
  solarIrradiance: Record<'earth' | 'moon' | 'mars', SolarIrradianceRecord>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Scientific reference ${path} must be a non-empty string.`)
}

function requirePositive(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TypeError(`Scientific reference ${path} must be a positive finite number.`)
}

function requireFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Scientific reference ${path} must be a finite number.`)
}

/** Runtime-checks imported JSON so malformed or unitless scientific inputs fail early. */
export function validatePlanetaryReference(value: unknown): asserts value is VerifiedPlanetaryReference {
  if (!isRecord(value)) throw new TypeError('Scientific reference must be a JSON object.')
  requirePositive(value.schemaVersion, 'schemaVersion')
  requireString(value.retrievedAt, 'retrievedAt')

  const epoch = value.orbitEpoch
  if (!isRecord(epoch) || epoch.timeScale !== 'TDB') throw new TypeError('Scientific orbit epoch must use TDB.')
  requireString(epoch.calendar, 'orbitEpoch.calendar')
  requirePositive(epoch.julianDay, 'orbitEpoch.julianDay')

  const frame = value.orbitFrame
  if (!isRecord(frame)) throw new TypeError('Scientific orbit frame metadata is missing.')
  const expectedFrameValues = {
    origin: 'Sun (10)', referenceSystem: 'ICRF', referencePlane: 'Ecliptic of J2000.0',
    distanceUnit: 'au', angleUnit: 'deg', timeUnit: 'day',
  }
  for (const [key, expected] of Object.entries(expectedFrameValues)) {
    if (frame[key] !== expected) throw new TypeError(`Scientific reference orbitFrame.${key} must be ${expected}.`)
  }
  for (const key of ['ephemerisType', 'source', 'apiUrl', 'documentationUrl', 'query']) requireString(frame[key], `orbitFrame.${key}`)

  if (!isRecord(value.orbits)) throw new TypeError('Scientific orbit records are missing.')
  for (const body of ['earth', 'mars'] as const) {
    const orbit = value.orbits[body]
    if (!isRecord(orbit)) throw new TypeError(`Scientific orbit ${body} is missing.`)
    requireString(orbit.target, `orbits.${body}.target`)
    requireString(orbit.ephemerisSolution, `orbits.${body}.ephemerisSolution`)
    for (const key of ['semiMajorAxisAu', 'orbitalPeriodDays', 'meanMotionDegPerDay'] as const) requirePositive(orbit[key], `orbits.${body}.${key}`)
    for (const key of ['eccentricity', 'inclinationDeg', 'longitudeAscendingNodeDeg', 'argumentPeriapsisDeg', 'meanAnomalyDegAtEpoch'] as const) requireFinite(orbit[key], `orbits.${body}.${key}`)
    if ((orbit.eccentricity as number) < 0 || (orbit.eccentricity as number) >= 1) throw new RangeError(`Scientific orbit ${body} must be an ellipse for this Kepler visualizer.`)
  }

  if (!isRecord(value.solarIrradiance)) throw new TypeError('Scientific solar irradiance records are missing.')
  for (const body of ['earth', 'moon', 'mars'] as const) {
    const irradiance = value.solarIrradiance[body]
    if (!isRecord(irradiance)) throw new TypeError(`Scientific solar irradiance for ${body} is missing.`)
    requireString(irradiance.target, `solarIrradiance.${body}.target`)
    requirePositive(irradiance.valueWm2, `solarIrradiance.${body}.valueWm2`)
    for (const key of ['measure', 'source', 'sourceUrl', 'referenceDate']) requireString(irradiance[key], `solarIrradiance.${body}.${key}`)
    if (!(irradiance.sourceUrl as string).startsWith('https://')) throw new TypeError(`Scientific source URL for ${body} must use HTTPS.`)
  }
}

validatePlanetaryReference(rawReference)

export const PLANETARY_REFERENCE: VerifiedPlanetaryReference = rawReference
