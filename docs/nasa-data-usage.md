# NASA data usage report

NASA pages and the JPL Horizons API were checked on 2026-11-14. There is no runtime NASA API call; verified results are stored locally. PDF guides/orbital tables mentioned in the request were not present in the project or accessible attachments, so no values were taken from PDFs.

| NASA source | Verified fact | Game module/mechanic | Units | Status |
|---|---|---|---|---|
| [NASA/NSSDC Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | Metric comparison lists approximate surface gravity: Earth 9.8, Moon 1.6, Mars 3.7 | `src/game/data.ts`, `src/flight/mission.ts`: destination gravity; Earth launch TWR/vertical flight | m/s² | Integrated (rounded) |
| [NASA Moon: By the Numbers](https://science.nasa.gov/moon/by-the-numbers/) | Equatorial surface gravity is 1.624 m/s² (about one-sixth of Earth's) | `src/game/data.ts`, `src/flight/mission.ts`: Moon destination gravity, rounded to 1.62 m/s² | m/s² | Integrated (rounded) |
| [NASA Glenn: Moon](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/moon/) | Moon has no appreciable atmosphere; no aerodynamic drag and powered landing is required | `src/flight/mission.ts`: no parachute-only lunar landing; `FlightScreen` learning copy | Qualitative | Integrated as a simplified rule |
| [NASA Science: Landing on Mars, a Tricky Feat](https://science.nasa.gov/solar-system/skywatching/night-sky-network/landing-on-mars-a-tricky-feat/) | Mars atmosphere is thin: heat shield protects entry, parachute alone cannot safely land, and powered/other deceleration is used | `src/flight/mission.ts`: Mars heat-shield and powered-descent checks | Qualitative | Integrated as a simplified rule |
| [NASA Glenn: Free Falling Objects](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/free-falling-objects/) | Weight relation W=mg; Earth surface g is about 9.8 m/s² and differs on Moon/Mars | `src/game/calculations.ts`, `src/flight/physics.ts`: TWR and gravity explanation | N, kg, m/s² | Integrated; game uses rounded 9.81 |
| [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) for Earth (399) and Mars (499), Sun-centered (`500@10`) | Geometric osculating elements from DE441 / Mars `mar099`, epoch 2026-11-14 00:00 TDB; J2000 ecliptic, ICRF | `src/data/planetary-reference.json` → `src/data/planetaryReference.ts` validation → `src/visualization/kepler.ts` → mission map preview | `a`: au; `e`: dimensionless; angles: deg; period: day; epoch: JDTDB | Integrated; one epoch snapshot, not a future ephemeris |
| [NASA NSSDC Earth Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html), [Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html), [Mars Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) | Representative solar irradiance: Earth 1361, Moon 1361, Mars 586.2 | JSON → `src/economy/solarEnergy.ts` irradiance ratio → colony energy production and mission power forecast | W/m² input; abstract game energy units/turn output | Integrated; NSSDC fact-sheet values; representative/mean-distance context, not local weather or surface availability |

## JPL Horizons query record

The API was queried with `EPHEM_TYPE=ELEMENTS`, `COMMAND=399` and `499`, `CENTER=500@10`, `TLIST=2026-11-14`, `TLIST_TYPE=CAL`, `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=ICRF`, and `OUT_UNITS=AU-D`. Horizons returned epoch JD(TDB) **2461358.5**, Sun (10) as center, “Ecliptic of J2000.0”, geometric osculating elements, and the solution identifiers shown in the JSON. Orbital parameters (semimajor axis, eccentricity, inclination, ascending node, argument of periapsis, mean anomaly, mean motion, and period) are copied from this response. See [`src/data/planetary-reference.json`](../src/data/planetary-reference.json).

The Kepler display propagates this single osculating snapshot with the two-body elliptic Kepler equation. It does not query Horizons over time and is not an N-body ephemeris, transfer trajectory, launch window, or mission solver. The Moon is not plotted as a heliocentric planet; lunar-orbit data is not included.

## Solar power data path

The NSSDC flux values are imported through the validated local JSON. The game scales its abstract baseline of **20 energy units per panel per turn at 1361 W/m²** by `target irradiance / Earth irradiance`. The 20-unit baseline, equipment demands (rover 4, greenhouse 6, habitat 12 units/turn), storage behavior, and production gating are gameplay assumptions—not NASA electrical performance or hardware consumption data. On an energy deficit, rover/greenhouse output pauses for that colony turn and the UI explains the shortfall. Adding solar panels still adds the existing catalog mass and cost.

## Game assumptions (not NASA data)

- Rocket body/engine/tank/payload masses, engine thrust and propellant flow, rocket manufacturing costs, 1,000-credit starting budget, 15% pad-cancellation penalty, 100-credit/150-science success reward, and 250-credit one-time support are game design values.
- Moon 600 m/s and Mars 1,000 m/s Delta‑V mission thresholds are illustrative scenario gates, not NASA requirements or real transfer/landing budgets.
- Atmospheric drag coefficient, reference areas, density profile, time scale, and vertical flight model are simplified gameplay approximations, not a validated atmosphere or trajectory model.
- Colony output per successful mission turn uses a 20-unit solar-panel baseline at Earth flux (scaled by the NASA Earth/Mars irradiance ratio), 10 minerals per rover, and 8 food per greenhouse. These quantities, their units as abstract game resources, and all economy rules are invented game values.
- Power conversion from NASA W/m² to abstract energy units, and equipment power demands, are invented gameplay assumptions. NASA irradiance is an input for relative scaling only.
- TWR success thresholds and landing equipment checks are educational abstractions; a passing result is not proof of mission feasibility.

## Scientific limitations

The Phaser flight is a one-dimensional vertical ascent from Earth with simplified drag, fixed Earth gravity, and fuel burn. It does not calculate an Earth–Moon/Mars transfer, orbital insertion, re-entry, or a physical landing. The Kepler preview is an approximate two-body propagation from one epoch. Solar irradiance is a representative top-of-atmosphere/mean-distance value and ignores latitude, season, atmosphere, dust, shadowing, panel orientation/efficiency, storage losses, and day/night duty cycle. No engine-specific NASA performance data, verified delta‑V budget, cost dataset, or validated habitat power budget is integrated. No NASA affiliation or endorsement is implied; recheck sources before submission.
