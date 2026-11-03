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

## R4-E migration inventory

The R4-D audit on the preserved R4-C tree found **120 active test files containing references** to legacy editor paths and 155 such references in retired test files; this broad count includes source-inspection strings as well as imports. Treat it as a conservative migration queue, not proof that 120 shipped modules depend on the old editor. R4-E must separately classify direct imports, source inspections, and GIS/Worker parity fixtures before deleting the 103 remaining source files.

The default unit runner uses batches of at most 120 spec paths to avoid exceeding Windows process command-line limits, while browser suites keep a single Playwright invocation.
