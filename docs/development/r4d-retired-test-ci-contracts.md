# R4-D — historical editor test / CI retirement

Baseline: R4-C on `work/ui`, 50/153 editor sources deleted, 103 remaining.
Scope: CI and test registration only. No GIS source changes, Core/WASM changes, Viewer UI changes, Windows identifiers, historical data or library pins.

## Changes

- Removed 11 obsolete P8 graphical-editor and 2026-10 temporary integration workflows. Their historical run logs and commits remain in GitHub.
- Promoted `tests/browser/button-consistency.spec.mjs` to active Viewer UI checks. Editor radio-row tests remain retired.
- Normalized the application catalog and test runner: `pnpm test:unit` / `pnpm test:browser` select only catalogued active tests; manual performance probes remain opt-in.
- R4 validation preserves canonical GIS spatial calculations and C++/WASM authority. Old draft/edit UI tests are not invoked as R4 source-pruning gates.
- Added `scripts/r4d-check-retired-tests.mjs` with a stable inventory of retired vs active tests still referencing the archived editor. Its output is the migration list for R4-E.
- The retired frontend files stay in the repository until dependency-closed R4-E deletion. A retained archived test is not evidence that the corresponding UI still ships.

## Validation policy

Run `node scripts/r4d-check-retired-tests.mjs --check`, `node --test tests/unit/r4d-legacy-ci-boundaries.test.mjs`, R4-B/R4-C unit checks and the E5/E7 Viewer/Windows tests.
The R4-D report intentionally displays the remaining active test imports that still need migration or retirement before R4-E; it does not silently discard valuable GIS coverage.

Do not remove `tools/gis`, the C++/WASM calculation engine, original GIS data, date-line/hole/shared-border checks, actual GIS Worker parity, Viewer or Windows reviewer functionality.
