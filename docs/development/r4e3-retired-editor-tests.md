# R4-E3 — retired graphical-editor tests, fixtures and obsolete CI

Baseline: `work/ui` `ebe2cfdc00ca7bf3483c66b7d973de6eae7bb6ac`.
Scope: legacy tests, CI diagnostics and editor-specific helper fixtures **only**. This stage does not remove any of the 103 archived editor source files.

## Inventory

- Removed 170 catalog-retired tests: **141 browser and 29 unit**, plus three old edit-only ABBA boundary/comparison tests.
- Retired 38 old editor-only UI/profiling workflows. Historical Git commits and Actions evidence remain available.
- Kept 15 current Viewer/GIS/Core workflows and reconfigured them to use supported Reviewer, time-axis, border and GPU regressions. Manual map-rendering now calls Viewer Canvas/GPU tests.
- Removed editor-only browser entrypoint, editing-state recovery and mobile/edit project fixtures, together with two retired browser comparison scripts.
- Preserved three old browser-source **text oracles** under `tests/fixtures/retired-browser-oracles/` because active `map-diagnostics.test.mjs` still checks deterministic instrumentation against these exact sources. They are not runnable test specs. The frozen GeoPackage writer/adapter sources remain test-only and untouched.
- No change to GIS source data, library pin, original historical maps, C++/WASM engine or Viewer/Windows app sources.

## Current acceptance

`node --test tests/unit/r4e3-retirement-boundaries.test.mjs` verifies that no retired executable remains and that active workflows do not invoke deleted test files. `node scripts/r4e3-retirement-inventory.mjs --check` verifies the catalog registers no retired tests. R4-B/R4-C GIS, country shared-border, GeoPackage Worker RPC, E5/E6/E7, native Core and Viewer tests remain the required correctness gates.

The 103 archived application source files are deliberately retained for **R4-E4/E5**; active unit tests that still read their UI modules must be evaluated before those files are deleted.

See the reproducible complete list at `docs/development/r4e3-retired-test-manifest.json`.
