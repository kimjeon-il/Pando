# R4-E1 — GIS interoperability and GeoPackage compatibility separation

Branch scope: `work/ui` only. R4-E0 baseline: `b0acec34098ad2b8fa32321f54a4c27b73d1a073`.

## Results

- Extracted **six GIS-owned sources**: trusted country import identities; immutable import plans; structured vector target mapping; real GIS geometry RPC validator; verified lazy territorial-catalog loader; and canonical GIS Worker.
- The old editor implementations of country identity, import plans and readonly catalog loader now only forward to `tools/gis`. The old `import-service.js` forwards the moved Worker RPC while retaining the historic UI wizard service for later retirement.
- Repointed canonical GIS Worker parity tests (`gis-math-contract`, `gis-geometry-worker`) and test harness to **`tools/gis/gis-geometry-worker.js`** with C++/WASM geometry kernels unchanged. The previous editor Worker is still present but is no longer a required test entry.
- Copied the **existing GeoPackage encoder and classic GIS adapters byte-identically** into `tests/fixtures/geopackage/compat/worker/`. The interoperability fixture is the only reason to preserve old encoding behavior; this encoder is not promoted to a shipped product or new GIS runtime. `production-geopackage.mjs` and the current adapter/schema tests use the frozen fixture.
- The remaining editor-only mutation, native library write, geometry workspace and UI library ownership/service facades are **not** copied into `tools/gis`. Their E2/E3/E4 retirement dependencies are recorded in `r4-source-pruning.json`.

## Every original R4-E1 file classified

| Source | Decision |
| --- | --- |
| `gis-adapters.js` | Test-only preserved bytes; old source removed with E4/E5 |
| `country-import-identity.js` | Canonical `tools/gis/country-import-identity.js`, legacy shim until E5 |
| `gis-import-plan.js` | Canonical `tools/gis/gis-import-plan.js`, legacy shim |
| `gis-import-transaction.js` | Old edit commit; E2 migrate exact Core invariants, then delete |
| `import-plan.js` | Canonical `tools/gis/import-plan.js`, legacy shim |
| `import-service.js` | Real RPC moved to `tools/gis/gis-geometry-validator.js`, old wizard retained for E2/E3 |
| `library-geometry-context.js` | Editor geometry workspace, retire E4 |
| `library-ownership.js` | Old hierarchy parent selector; keep hierarchy/containment tests in E2/E3 |
| `native-library-repository.js` | Old native write/sync facade, retire E4; **never** add to Windows reviewer |
| `territorial-entity-loader.js` | Pure validated lazy loader moved to `tools/gis`; old native access adapter still retired |
| `territorial-library-service.js` | Compare existing `tools/gis/territorial-library.js` selectors and retire editor search service in E2 |
| `gis-geometry-worker.js` | Moved real GIS Worker test entry to `tools/gis/gis-geometry-worker.js` |
| `gis-gpkg-worker.js` | Frozen test-only GeoPackage writer bytes, retire old Worker in E4 |

## Acceptance

The R4-E1 gate executes trusted-id normalization, import plan, GeoPackage adapter/serializer byte parity, verified historical loader, live GIS Worker RPC and C++ geometry conservation checks. `tests/helpers/production-geopackage.mjs` must no longer read `apps/editor/frontend`. Run `R4 editor source pruning and GIS preservation`, `R4 archived editor source references audit`, and E6/E7 when merging. Keep `r4-source-pruning.json` at 50 removed / 103 remaining until E2-E5 and update only after the actual old file deletion.

No modification to original GIS source data, pinned library revision, C++/WASM binary code, Viewer map rendering, P6-3 Worker transfer protocol, native app identifier or Windows file permissions.
