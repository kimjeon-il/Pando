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
