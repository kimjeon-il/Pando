# Phase 7 — legacy test support cleanup (2026-11-07)

Source: `f9f977661bf41bfd6a5c9a6496d4301efe0d20fa`, branch: `work/optimization`.

## Scope

Removed 31 obsolete test-support and archive files (approximately 256 KiB of tracked sources and fixtures). This removes:
- Six Chromium CPU/profiling/long-frame helper modules whose source-anchored diagnostic specs were retired.
- Eight abandoned GPU recovery experiment, patch, and inspection helpers. **Retained `tests/helpers/gpu-recovery-source-harness.mjs`** because `gpu-shared-pass-initialization.test.mjs` still imports it.
- Seven original Web editing/history/flag contract helpers associated with deleted editor-specific unit tests.
- One Windows file-dialog harness and two historical R4 retirement audits that referenced removed tests and retired-only owner modes.
- Archived GPU candidate fragments and retired browser-source snapshots.

## Preserved

The current browser helpers `synthetic-dem-terrain.mjs`, `viewer-acceptance.mjs`, and `viewing-display.mjs` remain. Legacy-named but active GIS/Core support, including `legacy-project-autosave.mjs`, `map-transition-baseline.mjs`, and current `web-core-contract.mjs`, remains in place.

Removed the duplicate npm script `check:startup-performance`, which only reran `e7-application-check-planner.test.mjs` already covered by `check:domains`. Deleted a redundant retired-Editor source check in the remote-only workflow; `tests/unit/runtime/remote-only-contract.test.mjs` and runtime boundary checks remain.

Added a dynamic browser-helper reachability assertion in the existing CI inventory test to prevent obsolete Chromium diagnostic helpers from accumulating again. The assertion discovers present browser spec files and follows helper references without hardcoded helper names.

## Dependencies

No packages were removed from `package.json` or `pnpm-lock.yaml` without proven source-level non-use. Dependencies used by live front-end compilation, linting, GIS/TopoJSON, ZIP generation and the QGIS MCP bridge must not be treated as dead merely because Windows/Editor were retired. The package manager lock remains unchanged.

## Validation status

No full CI or browser suite was run. The changes have not received runtime verification; review and focused validation are required before merging into `main`.

## Removed paths

- `tests/browser/helpers/long-animation-frame-diagnostics.mjs`
- `tests/browser/helpers/map-diagnostics.mjs`
- `tests/browser/helpers/native-action-cpu-profile.mjs`
- `tests/browser/helpers/native-action-diagnostics.mjs`
- `tests/browser/helpers/native-action-timeline.mjs`
- `tests/browser/helpers/soviet-memory-attribution.mjs`
- `tests/helpers/fix-viewer-recovery-environment.mjs`
- `tests/helpers/gpu-recovery-viewer-admission-fix.mjs`
- `tests/helpers/gpu-recovery-viewer-admission.test.mjs`
- `tests/helpers/gpu-recovery-viewer-fix.mjs`
- `tests/helpers/gpu-recovery-viewer-presentation.test.mjs`
- `tests/helpers/gpu-recovery-viewer-progress.test.mjs`
- `tests/helpers/inspect-viewer-recovery.mjs`
- `tests/helpers/prepare-gpu-recovery-candidate.mjs`
- `tests/helpers/native-file-dialog.ps1`
- `tests/helpers/web-content-dirty-contract.mjs`
- `tests/helpers/web-draft-contract.mjs`
- `tests/helpers/web-flag-contract.mjs`
- `tests/helpers/web-history-selection-contract.mjs`
- `tests/helpers/web-opaque-flag-contract.mjs`
- `tests/helpers/web-selection-contract.mjs`
- `tests/helpers/web-writer-clock-contract.mjs`
- `scripts/r4d-check-retired-tests.mjs`
- `scripts/r4e3-retired-test-audit.mjs`
- `tests/fixtures/gpu-recovery/README.md`
- `tests/fixtures/gpu-recovery/candidate-source.gz.part1`
- `tests/fixtures/gpu-recovery/candidate-source.gz.part2`
- `tests/fixtures/gpu-recovery/candidate-source.gz.part3`
- `tests/fixtures/retired-browser-oracles/country-map-substrate.source.txt`
- `tests/fixtures/retired-browser-oracles/edit-preview-handoff.source.txt`
- `tests/fixtures/retired-browser-oracles/interaction-unification.source.txt`
