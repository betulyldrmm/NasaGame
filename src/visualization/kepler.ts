import type { KeplerOrbitRecord } from '../data/planetaryReference'

const degreesToRadians = (degrees: number) => degrees * Math.PI / 180
const radiansToDegrees = (radians: number) => radians * 180 / Math.PI

export interface HeliocentricPositionAu {
  xAu: number
  yAu: number
  zAu: number
  radiusAu: number
}

/** Newton iteration for the elliptic Kepler equation M = E - e sin(E). */
export function solveKeplerEquation(meanAnomalyRadians: number, eccentricity: number): number {
  if (!Number.isFinite(meanAnomalyRadians) || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError('Kepler solver requires a finite anomaly and elliptic eccentricity in [0, 1).')
  }
  const mean = ((meanAnomalyRadians % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  let eccentricAnomaly = eccentricity < 0.8 ? mean : Math.PI
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const correction = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - mean)
      / (1 - eccentricity * Math.cos(eccentricAnomaly))
    eccentricAnomaly -= correction
    if (Math.abs(correction) < 1e-12) return eccentricAnomaly
  }
  return eccentricAnomaly
}

/** Propagates one osculating orbit as a two-body Kepler illustration, not an ephemeris or transfer solver. */
export function calculateHeliocentricPosition(orbit: KeplerOrbitRecord, daysFromEpoch: number): HeliocentricPositionAu {
  if (!Number.isFinite(daysFromEpoch)) throw new RangeError('Orbit time offset must be finite days.')
  const meanAnomaly = degreesToRadians(orbit.meanAnomalyDegAtEpoch + orbit.meanMotionDegPerDay * daysFromEpoch)
  const eccentricAnomaly = solveKeplerEquation(meanAnomaly, orbit.eccentricity)
  const radiusAu = orbit.semiMajorAxisAu * (1 - orbit.eccentricity * Math.cos(eccentricAnomaly))
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + orbit.eccentricity) * Math.sin(eccentricAnomaly / 2),
    Math.sqrt(1 - orbit.eccentricity) * Math.cos(eccentricAnomaly / 2),
  )
  const argumentLatitude = degreesToRadians(orbit.argumentPeriapsisDeg) + trueAnomaly
  const ascendingNode = degreesToRadians(orbit.longitudeAscendingNodeDeg)
  const inclination = degreesToRadians(orbit.inclinationDeg)
  const xAu = radiusAu * (Math.cos(ascendingNode) * Math.cos(argumentLatitude) - Math.sin(ascendingNode) * Math.sin(argumentLatitude) * Math.cos(inclination))
  const yAu = radiusAu * (Math.sin(ascendingNode) * Math.cos(argumentLatitude) + Math.cos(ascendingNode) * Math.sin(argumentLatitude) * Math.cos(inclination))
  const zAu = radiusAu * Math.sin(argumentLatitude) * Math.sin(inclination)
  return { xAu, yAu, zAu, radiusAu }
}

export function meanAnomalyAfterDays(orbit: KeplerOrbitRecord, daysFromEpoch: number): number {
  return radiansToDegrees(degreesToRadians(orbit.meanAnomalyDegAtEpoch + orbit.meanMotionDegPerDay * daysFromEpoch))
}
