# Pre-transfer cleanup implementation record

Goal: execute the approved audit cleanup in order, preserving current workflows.
Scope: product-unused APIs; Generic v1 compatibility; worker RPC; native/Core GIS input contracts; retired report paths.
Constraints: defer naming-only subunit changes; update affected tests/checkers together; focused checks only; no main merge or deployment.
Execution: inline, using the user's explicit approval of the five-step audit.

1. Remove product-unused APIs and their exclusive tests. Preserve production helpers and historical oracle fixtures.
2. Require Generic v2 and canonical source provenance; remove role/topology UI. External GIS attributes belong in source.details, not compatibility fields.
3. Use worker-rpc envelopes on both sides; preserve cancellation, revision fences, transferables and errors.
4. Use general/regional GIS targets with explicit parent relations. Remove obsolete aliases and Country input DTO; preserve current subunits presentation groups.
5. Replace old report-path arguments with current paths and remove old-layout detection. Update workflows and path checks.

Verification: run only touched unit/architecture tests and native targets if the build environment is available. Record unavailable tools honestly.

## Progress
- Baseline: work/objects fast-forwarded to main 214e5e19; no pre-existing local changes.
- Step 1: removed unused registry/ref/snapshot/ribbon APIs and CPU-only terrain publication, including exclusive tests and mutation-runner count. Initial focused run: 7 pass; 2 files blocked by missing eslint (dependency setup pending).
- Step 2: strict Generic v2 and provenance aliases rejected; legacy role/topology DOM removed; GIS attributes preserved as source.details.attributes. 11 focused unit tests and provenance audit pass. Combined Step 1 checks: 32 pass; Core-dependent tests require build-native WASM. Packaged WASM verifies Generic import/undo/redo and deletion; 2 selection tests reject the fixture catalog (CORE_SELECTION_CATALOG), outside changed paths. Qt/CMake unavailable locally.
- Step 3: all five geometry Workers and callers use canonical RPC; codecs and old listeners removed. 55 focused RPC/real-worker tests pass (including actual geometry preparation, cancellation and commit/discard). Consumer tests cover audit clearing, river generation fences and mesh installation. Worker architecture and scoped lint pass.
- Step 4: native/Core GIS targets use general/regional; hierarchy is expressed by parent IDs, with retired aliases rejected. Country DTO and overloads removed; production bootstrap/preview uses canonical documents and affected fixtures use typed identities/geometries/static records. Retired label namespaces and Generic GeoPackage columns removed; Web/native exporters and contract checks updated together. Shared Core builds; native core/model/GIS tests, source admission and current Web/Core GIS parity pass. Qt application compilation remains unavailable (Qt development packages absent).
- Step 5: report callers/workflow artifacts name current reports/ paths; old-layout detection, --native CLI alias and relocation map removed. 151 mapped files relocated or deduplicated only when bytes match (historical content preserved). Ruling: some mapped outputs had not physically moved, so relocation was required before removing fallback; leaving them would break consumers. 18 focused path/place/coast tests, 2 Python path tests and default-color input check pass. Workflow artifact paths are literals instead of unevaluated shell substitutions. Native place test now uses the monorepo report root directly.
- Additional Step 4 verification: Core GeoPackage boundary tests pass 3/3, including absence of retired Generic columns; shared Core and Web input/output checks are independently exercised. Full Qt build and repackaged WASM are not available in this environment.
- Final review: one fresh reviewer found external GeoJSON source attributes were mistaken for internal provenance. Reproduced with string/null/arbitrary-object source values, then fixed by recognizing canonical provenance and preserving external source under details.attributes. Focused Generic/provenance tests pass 17/17; provenance audit and lint pass. No other important/critical or minor findings reported.
- Final checker alignment: removed the deleted snapshot function's storage-access exemption; removed Generic/ribbon declarations now belong to the forbidden runtime symbol list. Same-commit place parity passes (24 source pins, 22 batches); its 4 unit tests pass. All changed JavaScript lint passed.
