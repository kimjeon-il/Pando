# R4-E4/E5 legacy editor source elimination — pending final acceptance

Date: 2026-11-03. Baseline: `main@c6b91ee1f8b09808f71a1d021bcb9db2c5ef2f7b`.

The archived, unshipped `apps/editor/frontend/` and `apps/editor/templates/` source closure is removed from this integration branch: **153/153 baseline sources retired (74 in this batch)**. The retired-editor suite ledger is updated to **260 deleted suites** (74 newly disposed). The remaining Core, GIS, canonical Viewer and Windows reviewer sources and pinned runtime data are preserved. The classified old editor UI/command/preview tests have canonical C++/GIS/Viewer alternatives. The three preserved independent Core draft tests in `core-document-draft-wasm.test.mjs` require removal of the retired facade imports, not deletion. Historical archived source stays in Git history.

The exact deletion list is in `r4-source-pruning.json`. The source closure deletion is **not** proof of Viewer/Windows acceptance. Regenerate E0 reference audit, test catalog, all current unit/gate CI, E7 Chromium Viewer, Windows Tauri/WebView2, and R4 deletion proof. Do not merge to `main` until these checks pass. Any pre-existing obsolete source tests outside the E0 direct-reference list must be migrated/retired explicitly and the corresponding lints/CI updated; never mask missing production imports.
