# AI Agent Architecture & Contribution Guide (`AGENTS.md`)

This repository implements the **NASA Space Apps Challenge 2026 — Space Mission Design Game** following a strict **Data-Driven, Pure-Physics, Modular Pixel-Art Architecture** compatible with `origin/feature/flight` so that any AI coding agent or human developer can extend it safely.

## 1. Core Architectural Rules

1. **Data-Driven Catalog (`src/game/data.ts`)**:
   - All rocket bodies (`ROCKET_BODIES`), engines (`ROCKET_ENGINES`), fuel tanks (`FUEL_TANKS`), payloads (`PAYLOADS`), and target planets (`PLANETS`) live in `src/game/data.ts`.
   - **How to add a new part or planet**: Append a single typed object to the corresponding array in `src/game/data.ts`. Both the assembly builder and the flight simulator will pick it up automatically.

2. **UI-Independent Pure Physics Engine (`src/game/calculations.ts` & `src/flight/physics.ts`)**:
   - Never hardcode physics formulas inside React components.
   - `calculateTotalMass`, `calculateTWR`, `calculateRocketCost`, `calculateCoMAndCoP`, and `calculateSolarEfficiency` live in `src/game/calculations.ts`.
   - `stepFlightPhysics`, `calculateDeltaVCapacity`, and `getEffectiveGravity` live in `src/flight/physics.ts`.
   - `evaluateMissionOutcome` in `src/flight/mission.ts` evaluates liftoff TWR, aerodynamic stability (Yellow CoM above Blue CoP), Tsiolkovsky Delta-V range, and Fail-Forward NASA learning cards.

3. **Pixel-Art Visuals & Interactive Gameplay**:
   - All SVG schematics use `shapeRendering="crispEdges"` and `image-rendering: pixelated`.
   - The Phaser 3 flight engine (`src/components/PhaserFlightView.tsx` & `src/flight/FlightScene.ts`) uses `pixelArt: true, antialias: false, roundPixels: true` and supports both vertical launch and a **Spaceflight Simulator** style planetary landing phase (throttle slider, `A`/`D` steering, auto-pilot toggle, parachute/heatshield/retro-thrusters, `< 8 m/s` safe landing check).
   - Both the Rocket Schematic (`src/components/RocketPreview2D.tsx`) and the Planetary Base Builder (`src/components/ColonyScreen.tsx`) support **Space Engineers / Terraria** style click-to-build block/part interaction.

## 2. Directory Map

- `src/game/types.ts` — Domain TypeScript interfaces (`RocketBody`, `RocketEngine`, `FuelTank`, `Payload`, `Planet`, `RocketConfiguration`).
- `src/game/data.ts` — Rocket parts catalog and NASA planetary parameters (Earth, Moon, Mars).
- `src/game/calculations.ts` & `src/game/calculations.test.ts` — Pure TWR, mass, cost, CoM/CoP, and $1/r^2$ solar efficiency functions + unit tests.
- `src/game/assemblyStore.ts` & `src/game/assemblyStore.test.ts` — Zustand store (`useRocketAssembly`) for rocket assembly, landing gear flags, budget, and 2D colony grids.
- `src/visualization/rocketModel.ts` & `src/visualization/rocketModel.test.ts` — Pure visual model mapper (`getRocketModelSpec`).
- `src/flight/physics.ts` & `src/flight/physics.test.ts` — Euler flight integration and Tsiolkovsky Delta-V calculation.
- `src/flight/mission.ts` & `src/flight/mission.test.ts` — Mission evaluation and fail-forward educational cards.
- `src/flight/FlightScene.ts` — Phaser 3 pixel-art launch & Spaceflight Simulator interactive planetary landing scene.
- `src/components/IntroCutscene.tsx` — Animated 3-stage pixel-art intro cutscene.
- `src/components/RocketPreview2D.tsx` — Interactive pixel-art rocket schematic (click nose/tank/fins/engine to cycle, Yellow CoM & Blue CoP markers).
- `src/components/AssemblyScreen.tsx` — Sleek dark-theme rocket builder matching `origin/feature/flight`.
- `src/components/FlightScreen.tsx` & `src/components/PhaserFlightView.tsx` — Flight & SFS landing HUD, throttle slider, steering controls, and fail-forward learning card overlay.
- `src/components/ColonyScreen.tsx` — Terraria / Space Engineers 2D surface & underground pixel block colony builder with $1/r^2$ solar power, RTG, and ore mining.
- `public/assets/` — Generated pixel-art / 2.5D visual assets (`rocket-blueprint-showcase.jpg`, `colony-cross-section.jpg`, `solar-system-banner.jpg`).
