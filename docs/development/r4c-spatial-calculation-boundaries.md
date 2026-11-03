# R4-C — GIS spatial calculation separation

Baseline: `work/ui` 2026-11-03; scoped cleanup of 106 archived graphical-editor files.
Status: implemented in a branch-local commit; final CI to determine acceptance.

## Canonical calculation modules (C++/WASM still performs authoritative mathematics)

| New canonical source | Responsibility | Previous editor source |
| --- | --- | --- |
| `tools/gis/geometry-metrics.js` | Great-circle line and polygon-area adapters; C++ owns measurement | `geometry-metrics.js` (deleted) |
| `tools/gis/geometry-validation.js` | Country structure/overlap, component pairs and opt-in affected scopes; C++ owns geometry checks and spatial candidates | `gis-geometry-validation.js` (deleted) |
| `tools/gis/country-import-merge.js` | Country identity, overlay planning and affected-area accounting using C++ merge plan | Extracted from `import-service.js` |
| `tools/gis/territorial-batch-calculation.js` | Deterministic country/donor replacement, source preservation, precision discard and scope validation | Extracted from `map-edit-library-calculation.js` |
| `tools/gis/territory-component-plan.js` | Read-only, independent polygon component preparation and residual/sliver conservation | `territory-component-plan.js` (deleted) |
| `tools/gis/country-geometry-calculator.js` | Deterministic country cut/merge/new-country geometry; sole precision retry uses canonical C++ polygon wrapper | Calculation extracted from `map-edit-country-commands.js` |

The GIS-only calculation modules do not depend on the graphical editor's DOM, Worker orchestration, draft data models or native IPC. Legacy `map-edit-country-commands.js`, `polygon-clipping-calculation.js`, and `river-territory-partition.js` now contain only forwarding exports to their canonical GIS counterparts until the archived Worker and UI are removed. The archived `map-edit-library-calculation.js` retains only the legacy Worker export bridge, which is scheduled for deletion alongside its Worker in R4-D/E.

`coast-reconciliation.js`, `geometry-snap.js`, `boundary-preparation.js`, `geometry-segment-index.js` and other draft/edit-only functions remain in the unshipped editor tree; they have no current GIS CLI consumers and should **not** be copied into tools/gis merely to preserve obsolete editing behavior. R4-D/E should classify their tests and retire them with the editor.

## Safety and invariant checks

- Keep C++ spatial owner functions `displayLineDistancesKm`, `displayGeometryAreasKm2`, `validateGisGeometry`, `GisOverlapCandidates`, `planGisCountryMerge`, `planGisCountryGeometry`, `gisCountryMergeCanCommit` unchanged.
- Preserve Natural Earth source geometry, dateline behavior, polygons with holes, generated DDR shared-border precision, Russia/Serbia river partitions and actual GisOverlapCandidates worker parity.
- Do not alter historical territory source files, external library revision, GIS report data, C++ or WASM binaries, Viewer rendering, Windows reviewer permissions, or native app identifier.
- The retired graphical editor source count is now 103 from the 153 baseline (47 existing removals + 3 current removals). The previous report's 45 removals omitted the already removed `app.js` and `templates/index.html`, both now indexed.
- Regression: R4-C module tests, `gis-math-contract`, `gis-geometry-worker`, `import-service`, `library-shared-border-precision`, `territory-component-plan`, and existing E5/E6/E7 viewer/Windows gates.
