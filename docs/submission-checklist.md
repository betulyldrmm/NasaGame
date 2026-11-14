# Submission checklist

## Build and play

- [ ] `npm install` completes from a clean checkout.
- [ ] `npm run build` completes without TypeScript errors.
- [ ] `npm test` passes.
- [ ] Test the full path: home → assembly → mission setup → launch → result → base → new mission.
- [ ] Verify one successful Moon mission awards exactly once and deposits cargo.
- [ ] Verify a scientific failure (for example, Mars without a heat shield/powered descent) and the full flight-cost loss.
- [ ] Verify ramp cancellation loses 15%, unaffordable launches are blocked, and research support is offered only when eligible.
- [ ] Refresh during/after a mission and confirm LocalStorage restores progress; check duplicate result opening does not pay twice.
- [ ] Check desktop and narrow mobile layouts, Phaser loading/error feedback, and the 2.5D preview fallback.

## Science and presentation

- [ ] Review every NASA-linked fact against the primary source in `docs/nasa-data-usage.md`.
- [ ] Keep NASA-derived rounded physical facts separate from game values and identify the simplified 1D flight and Delta‑V limitations in the demo.
- [ ] Confirm no gameplay text implies NASA endorsement or mission-design accuracy.
- [ ] Rehearse `docs/demo-script.md` in 2–3 minutes.
- [ ] Ensure both Turkish and English project descriptions are available in `README.md`.

## Release hygiene

- [ ] Confirm the intended branch and a clean/understood Git worktree before packaging.
- [ ] Verify no secrets, local environment files, or unnecessary generated files are included.
- [ ] Confirm current Node/npm requirements and provide the install/run commands.
- [ ] Recheck NASA source URLs and date the report before final submission.
