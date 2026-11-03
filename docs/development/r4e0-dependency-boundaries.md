# R4-E0 — archived editor dependency closure and deletion decision ledger

Baseline: `work/ui` `ee6efddb7335a6665647cc69951e40103830c3e8`.
Scope: **audit, decisions and reproducible validation only**. No editor deletions, GIS data edits, Core/WASM changes, native identity changes, or Viewer/UI changes.

## Complete source decision inventory

`docs/development/r4e0-source-dispositions.json` is the machine-readable per-file ledger. It identifies **exactly 103** historical source paths: 97 under `apps/editor/frontend/js/modules`, five old Workers, and one GIS adapter. Every path has one explicit disposition; none is approved for deletion merely by being classified.

| Proposed treatment | Files | Earliest phase | Deletion prerequisite |
| --- | ---: | --- | --- |
| GIS or GeoPackage interoperability candidate | 13 | E1 | Check canonical equivalents first; migrate unique GIS/Worker/GeoPackage behavior and preserve fixtures |
| Legacy Core command/test-fixture adapter | 19 | E2 | Keep distinct C++/WASM, source/date and transaction invariants in canonical tests |
| Already extracted GIS forwarding shim | 8 | E5 | Directly import the stable `tools/gis` owner and remove shim-existence assertions |
| Editor-only Worker orchestration | 3 | E4 | Ensure its consumers and performance/source probes use supported Viewer/GIS Worker contracts or are retired |
| Graphical editor UI, state and presentation | 60 | E4 | Remove obsolete UI assertions and verify functional replacements where meaningful |
| **Total** | **103** | | |

A disposition is a *planned action*, not permission for a bulk delete. References can be actual module imports, classic `importScripts`, `new URL`/Worker references, source inspections, test fixtures, CI paths or plain documentation. An externally referenced file is not necessarily a live product dependency.

## Automated evidence and gates

Run `node scripts/r4e0-dependency-audit.mjs --check --output test-results/r4e0-dependency-map.json` and `node --test tests/unit/r4e0-dependency-audit.test.mjs`. The report lists, for every baseline file, classified incoming references (source, owner, line and reference kind), internal outgoing/incoming edges, its strongly connected deletion component, blockers, category and next stage.

The audit fails when a new archived source is unclassified, an inventoried source disappears without being recorded in `docs/development/r4-source-pruning.json`, a classification is unknown, a canonical invariant disappears, or an archived module does not parse. It reports broad/dynamic references for investigation instead of silently treating them as safe.

R4-D's conservative audit identified 93 directly mentioned sources, 119 active test files with legacy path mentions and two potentially unreferenced nodes after conservative reachability. Those numbers are **not deletion approvals**: the R4-E0 report distinguishes imports from source inspections and documents strongly connected groups. An output artifact attached to the R4 source-audit CI is the current per-file evidence.

## Ordered execution hand-off

**E1:** Migrate GIS validator Worker RPC, GeoPackage producer/reader, source identity/date selectors, and independent GIS parsing/plan tests. Do not duplicate existing `tools/gis` calculations and do not substitute JavaScript mathematics for C++ kernels.

**E2:** Update active Core/WASM tests and helpers; decide for each existing test whether it checks supported semantics, a safe fixture, or an obsolete editor command. Keep negative/atomicity, history, exact-date, hole, dateline, shared-boundary and river partition coverage.

**E3:** Retire editor-only tests and helper entrypoints, adjust `application-checks.json` and workflow paths, and remove source-inspection assertions about old modules. Validate the test runner selects only supported tests.

**E4:** Delete UI/draft/presentation modules and obsolete workers only in dependency-closed batches, taking strongly connected cycles together. Assert no external executable import or surviving source-inspection reference before committing each batch.

**E5:** Remove remaining forwarding shims, storage-access allowlist rows, obsolete lint/AST scan roots, R4-C shim-presence assertions, and retired-source-specific CI. Update `r4-source-pruning.json` to 153 removed / 0 remaining without altering historical data.

**E6:** Run GIS geometry/Worker/GeoPackage regression, Core/WASM and E6/E7 Windows/WebView2/Chromium gates. Verify `apps/editor/frontend` and `apps/editor/templates` no longer contain tracked files; verify Viewer build and Windows reviewer retain their external source revision and permissions.


## Reproduced audit evidence (R4-E0 CI)

The updated AST/Worker inspection passed in GitHub Actions run [41555182668](https://github.com/kimjeon-il/Pando/actions/runs/41555182668), with the complete JSON evidence attached as `r4e0-dependency-map-41555182668`.

| Field | Observed |
| --- | ---: |
| Baseline editor files / current files | 103 / 103 |
| Files with active non-documentation incoming references | 90 |
| Classified active incoming references (not unique source files) | 207 |
| Archived-test references | 46 |
| Resolved inter-editor-file edges | 104 |
| Resolved strongly connected multi-file groups | 0 |
| Broad path/glob references requiring final cleanup | 28 |
| Unresolved dynamic import expressions needing review | 14 |
| E0 inventory assertion tests | 4 passed, 0 failed |

**Interpretation:** the 90 sources are blocked by active tests, helpers or repository contracts, **not** by the deployed Viewer itself. The active reference count includes source-inspection strings and policy mentions; it is not evidence of 207 live runtime imports. The zero-SCC result applies to the currently resolved graph only and must be rechecked after each migration.

The 14 still-dynamic expressions occur in the old `ui-runtime.js`, edit/river Workers, the `tests/helpers/editing-domain.mjs` fixture, and retired composition/capability-port tests. Do not assume those paths are safe without inspecting their runtime expressions. Broad path references also include audit/CI globs and are explicitly addressed in E5.

The planned dispositions remain fixed at 13 GIS interop, 19 Core/test fixtures, 8 canonical forwarders, 3 retired Workers and 60 editor UI modules. **No one of these classifications authorizes deletion until its dependent tests and source-read contracts are migrated.**

## Modification boundaries

Do not touch `main`, `work/gis`, external GIS library pins, country/terrain/hydro source data, original GIS reports, compiled C++/WASM, Windows app identifiers/permissions or the concurrent P6-3 performance protocol in R4-E0.
