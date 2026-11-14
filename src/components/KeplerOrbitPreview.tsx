import { useMemo, useState } from 'react'
import { PLANETARY_REFERENCE } from '../data/planetaryReference'
import { calculateHeliocentricPosition } from '../visualization/kepler'
import { messages } from '../i18n/tr'

type OrbitDestination = 'moon' | 'mars'
interface KeplerOrbitPreviewProps { destination: OrbitDestination }

const WIDTH = 640
const HEIGHT = 360
const CENTER_X = WIDTH / 2
const CENTER_Y = HEIGHT / 2
const SCALE = 102

function orbitPath(orbit: typeof PLANETARY_REFERENCE.orbits.earth): string {
  const periodDays = orbit.orbitalPeriodDays
  return Array.from({ length: 181 }, (_, index) => {
    const point = calculateHeliocentricPosition(orbit, periodDays * index / 180)
    return `${index === 0 ? 'M' : 'L'} ${(CENTER_X + point.xAu * SCALE).toFixed(2)} ${(CENTER_Y - point.yAu * SCALE).toFixed(2)}`
  }).join(' ') + ' Z'
}

function KeplerOrbitPreview({ destination }: KeplerOrbitPreviewProps) {
  const [daysFromEpoch, setDaysFromEpoch] = useState(0)
  const earthOrbit = PLANETARY_REFERENCE.orbits.earth
  const marsOrbit = PLANETARY_REFERENCE.orbits.mars
  const earthPath = useMemo(() => orbitPath(earthOrbit), [earthOrbit])
  const marsPath = useMemo(() => orbitPath(marsOrbit), [marsOrbit])
  const earth = calculateHeliocentricPosition(earthOrbit, daysFromEpoch)
  const mars = calculateHeliocentricPosition(marsOrbit, daysFromEpoch)
  const earthX = CENTER_X + earth.xAu * SCALE
  const earthY = CENTER_Y - earth.yAu * SCALE
  const marsX = CENTER_X + mars.xAu * SCALE
  const marsY = CENTER_Y - mars.yAu * SCALE
  const selectedTitle = destination === 'moon' ? messages.orbitMoonTarget : messages.orbitMarsTarget

  return <section className="kepler-orbit-panel" aria-label={messages.orbitHeading}>
    <div className="kepler-orbit-heading"><div><span className="section-index">MAP</span><h3>{messages.orbitHeading}</h3></div><span className="kepler-epoch">JPL · 2026-11-14 TDB</span></div>
    <svg className="kepler-orbit-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Dünya ve Mars'ın yaklaşık yörünge konumları, ${daysFromEpoch >= 0 ? '+' : ''}${daysFromEpoch} gün`}>
      <defs>
        <radialGradient id="orbit-sun-glow"><stop offset="0" stopColor="#fff3b0"/><stop offset="0.55" stopColor="#ffad57"/><stop offset="1" stopColor="#ffad57" stopOpacity="0.1"/></radialGradient>
      </defs>
      <rect width={WIDTH} height={HEIGHT} rx="8" fill="#080f20"/>
      <path d={marsPath} className={`orbit-track mars-track ${destination === 'mars' ? 'selected' : ''}`}/>
      <path d={earthPath} className={`orbit-track earth-track ${destination === 'moon' ? 'selected' : ''}`}/>
      <circle cx={CENTER_X} cy={CENTER_Y} r="18" fill="url(#orbit-sun-glow)"/>
      <circle cx={CENTER_X} cy={CENTER_Y} r="6" fill="#ffad57"/>
      <circle cx={earthX} cy={earthY} r={destination === 'moon' ? 8 : 6} className="orbit-body earth-body"/>
      <circle cx={marsX} cy={marsY} r={destination === 'mars' ? 8 : 6} className="orbit-body mars-body"/>
      <text x={CENTER_X + 12} y={CENTER_Y + 22} className="orbit-label">☉</text>
      <text x={earthX + 10} y={earthY - 8} className="orbit-label">{messages.orbitEarth}</text>
      <text x={marsX + 10} y={marsY - 8} className="orbit-label">{messages.orbitMars}</text>
    </svg>
    <div className="orbit-legend"><span><i className="earth-dot"/> {messages.orbitEarth}</span><span><i className="mars-dot"/> {messages.orbitMars}</span><b>{selectedTitle}</b></div>
    <label className="orbit-date-control"><span>{messages.orbitEpochOffset}: <b>{daysFromEpoch >= 0 ? '+' : ''}{daysFromEpoch}</b></span>
      <input type="range" min="-800" max="800" step="1" value={daysFromEpoch} onChange={(event) => setDaysFromEpoch(Number(event.target.value))} aria-label="JPL epoch tarihinden gün farkı"/>
    </label>
    {destination === 'moon' && <p className="orbit-caveat">{messages.orbitMoonCaveat}</p>}
    <p className="orbit-caveat">{messages.orbitScienceNote}</p>
  </section>
}

export default KeplerOrbitPreview
