# AI Agent Architecture & Contribution Guide (`AGENTS.md`)

This repository implements the **NASA Space Apps Challenge 2026 — Space Mission Design Game** following a strict **Data-Driven, Pure-Physics, Modular Architecture** so that any AI coding agent or human developer can extend it safely without breaking existing features.

## 1. Core Architectural Rules

1. **Data-Driven Catalog (`src/game/data.ts`)**:
   - All rocket bodies (`ROCKET_BODIES`), engines (`ROCKET_ENGINES`), fuel tanks (`FUEL_TANKS`), stabilizer fins (`AERODYNAMIC_FINS`), landing systems (`LANDING_SYSTEMS`), payloads (`PAYLOADS`), planets (`PLANETS`), missions (`MISSIONS`), and educational cards (`LEARNING_CARDS`) live in `src/game/data.ts`.
   - **How to add a new part or planet**: Append a single typed object to the corresponding array in `src/game/data.ts`. Both the Vehicle Assembly Building UI and the physics simulator will pick it up automatically.

2. **UI-Independent Pure Physics Engine (`src/game/calculations.ts`)**:
   - Never hardcode physics formulas inside React components or the Canvas animation loop.
   - `evaluateMission(configuration, targetPlanet)` is a pure, deterministic function returning `MissionEvaluation`.
   - It evaluates missions in four sequential stages (`FailureStage`):
     1. `LAUNCHPAD`: Checks fuel tank presence and Earth liftoff Thrust-to-Weight Ratio ($TWR = F_{thrust} / (m_{total} \times 9.81) \ge 1.0$).
     2. `ATMOSPHERE`: Checks aerodynamic stability — **Yellow Circle (CoM)** must stay above **Blue Triangle (CoP)** (`comPosition < copPosition`).
     3. `ORBIT`: Checks Tsiolkovsky Rocket Equation range ($\Delta v = I_{sp} \times 9.81 \times \ln(m_0 / m_f) \ge \Delta v_{required}$).
     4. `SURFACE`: Checks landing system compatibility with target atmosphere (`VACUUM` requires `RETROROCKET`; `THIN` Mars atmosphere requires `HEATSHIELD_SKYCRANE`) and target gravity landing TWR.

3. **Colony Energy & Inverse-Square Law (`evaluateColony` in `src/game/calculations.ts`)**:
   - Solar panel output scales by $1 / r^2$ where $r$ is `planet.distanceAU` ($1.0\text{ AU} \rightarrow 100\%$, $1.52\text{ AU Mars} \rightarrow 43.3\%$, $5.20\text{ AU Europa} \rightarrow 3.7\%$).
   - RTG nuclear generators (`scalesWithSolarDistance: false`) produce constant power at any distance.
   - If `netEnergy < 0`, `isBlackout` becomes `true` and colony per-turn credit/science income stops until net power is restored.

4. **Centralized State Store (`src/game/store.ts`)**:
   - Managed via Zustand (`useGameStore`).
   - Handles progressive cost loss (**15% fuel cost** on `LAUNCHPAD` abort/failure vs **100% build cost** in flight), Fail-Forward Telemetry Science XP rewards, anti-softlock NASA Emergency Grants, and 2D cross-section colony module placement.

## 2. Directory Map

- `src/game/types.ts` — Domain TypeScript interfaces and enums.
- `src/game/data.ts` — All game items, NASA planetary parameters, and learning cards.
- `src/game/calculations.ts` — Pure physics, TWR, CoM/CoP, Delta-V, $1/r^2$ solar flux, and `evaluateMission()`.
- `src/game/calculations.test.ts` — Vitest unit test suite covering Phase 1 & Phase 2 physics/gameplay.
- `src/game/store.ts` — Zustand state store and game loop actions.
- `src/components/Navbar.tsx` — Top Mission Control HUD & navigation.
- `src/components/RocketSprites.tsx` — Live SVG modular rocket stack & CoM (Yellow Circle) / CoP (Blue Triangle) visualizer.
- `src/components/AssemblyScreen.tsx` — 3-column Vehicle Assembly Building (VAB) & live TWR gauge.
- `src/components/FlightSimulator.tsx` — 60 FPS HTML5 Canvas launch, spin, orbit transfer, and planetary landing animation.
- `src/components/LearningCardModal.tsx` — Fail-forward post-flight analysis modal with NASA citations.
- `src/components/ColonyScreen.tsx` — Terraria-inspired 2D multi-story surface/underground planetary colony base.
- `src/components/TechTreeModal.tsx` — Telemetry Science XP R&D unlock modal.
- `src/components/EncyclopediaModal.tsx` — Interactive NASA NSSDC Planetary Fact Sheet reference modal.
- `public/assets/` — Generated pixel-art / 2.5D visual assets (`rocket-blueprint-showcase.jpg`, `colony-cross-section.jpg`, `solar-system-banner.jpg`).
