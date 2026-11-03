# R4-E4/E5 deletion-closed first batch

Date: 2026-11-03, main baseline `c6b91ee1f8b09808f71a1d021bcb9db2c5ef2f7b`.

The R4-E0 dependency audit confirmed 103 legacy sources, no shipped Viewer/Windows runtime imports, and 15 sources with no external blocking references. Those 15 were removed in this strictly dependency-closed batch; their file names and exact source inventory appear in `r4-source-pruning.json`. Canonical GIS, Core/WASM, Viewer, Windows Tauri, pinned library assets and GeoPackage frozen fixtures were not modified.

**Remaining 88 files are deliberately retained**, because the audit found 92 active test source consumers plus policy/workflow/test-helper references. The unfinished E4/E5 source deletions require migration/retirement of those references and the Viewer/Windows regression gates. This first batch is not an E4/E5 completion claim.
