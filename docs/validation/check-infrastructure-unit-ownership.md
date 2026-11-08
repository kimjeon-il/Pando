# Check infrastructure contract consolidation (P0–P6)

Branch: `work/optimization`. Baseline: `c1119ec59858dee679308c5e031b0d1615bfb4b7`, 397 root unit suites. The existing 616 original unit identities remain the historical comparison set.

## P0: inventory and ownership boundaries

| Domain | Production owner | Current verification owner | Rule |
| --- | --- | --- | --- |
| Repository inventory / affected checks | `scripts/plan-application-checks.mjs`, `scripts/lib/check-impact.mjs` | `e7-application-check-planner`, `check-impact`, `check-automation` | Original contract identities resolve to current runnable suites; no blanket native rebuild |
| Execution / phasing | `scripts/run-application-checks.mjs`, `scripts/run-active-tests.mjs` | `check-runner`, `current-browser-contracts` | Full and affected runs share unit batching and explicit failure states |
| Native / WASM prerequisites | `scripts/prepare-native-test-tools.mjs`, `scripts/lib/native-test-prerequisites.mjs` | `native-check-prerequisites`, `core-prerequisite` | No local toolchain installation, select only source-pinned native inputs |
| Isolation | `scripts/lib/unit-test-isolation.mjs` | `check-runner` | Shared Git/report worktrees cannot overlap; pure data fixtures may run concurrently |
| Workflow and references | `scripts/lib/workflow-reference-integrity.mjs`, `application-checks.json` | `check-automation`, `e7-application-check-planner` | Workflow executable and focused trigger references point to active owners |
| Fixtures | `tests/helpers/**` | Owning feature suites | Share immutable inputs/factories, not global mutable test state |

## Migration steps

- **P0**: record current ownership and baseline; do not repeat domain tests.
- **P1**: reuse private, bounded temporary workspace helpers only where fixtures actually duplicate their lifecycle.
- **P2**: centralize unit contract marker resolution, negative cases and priority rules without changing current test identities.
- **P3**: centralize grouping, concurrency and process boundaries across selected and full unit execution. Do not silently treat skipped native tests as passed.
- **P4**: isolate only actual shared resources. Preserve transactional cleanup; keep independent and in-memory tests parallelizable.
- **P5**: preserve prerequisite inheritance through consolidated suites, constrain tool-specific environments, and reject local native preparation.
- **P6**: connect the CI and package entrypoints to these same owners; remove obsolete paths and ensure source changes select their own checks.

Out of scope: re-enabling retired Python modules, Windows/Android editor products, border drawing and manual border editing, replacing original GIS source evidence, modifying production GIS or rendering behavior, re-implementing the already-consolidated feature suites.

## Deferred validation

Per user request, no Node tests, Native/C++/WASM build, Playwright, CI execution, or benchmarks will run until the all-area consolidation completes. Committed source changes are not proof of passing tests. The final run must separately verify contract coverage, native prerequisites, resource isolation, direct workflow references, and selection correctness.

## P0–P6 source implementation record

The work is committed in sequence on the same `work/optimization` branch:

- **P0:** current 397-file baseline and responsibility matrix recorded.
- **P1:** `tests/helpers/check-workspace-fixture.mjs` centralizes owned temporary directories and cleanup for runner, native and frontend test fixtures.
- **P2:** `scripts/lib/unit-contract-owners.mjs` is the single source for old marker identity → executable test ownership, reused by the selector and inventory audit.
- **P3:** `scripts/lib/unit-test-batches.mjs` groups unit tests by prerequisite set and limited batch size; full and affected runs share that batching policy. A local full run must not count native checks as successes without CI preparation.
- **P4:** explicit shared-report worktree isolation ownership and duplicate suite rejection prevent ordinary unit batches from overlapping global report fixtures.
- **P5:** GitHub Actions full unit runs use the canonical native/Core prerequisite executor, preserve caller-provided unit flags and request GIS native development libraries for territorial recipe consumers when needed.
- **P6:** the check catalog maps changes in the new infrastructure modules to their owning regression tests; the `check:ci-inventory` script names the current runner/native suites; the application workflow validates executable references before selection.

This is a source change and review record only. **No Node/Native/WASM/CI/Playwright tests or performance measurements were executed**; behavioral pass/fail and isolation under actual parallel CI remain unverified until the user's final combined check run. P7 final consolidation and full verification remain separate work.

## P7 consolidated infrastructure suites

Moved the reverse impact-graph and group-selection cases from
`check-impact.test.mjs` into `e7-application-check-planner.test.mjs`, and
the Native scope/pinned toolchain cases from `native-build-scope.test.mjs`
into `native-check-prerequisites.test.mjs`. Both original feature contract
markers remain in the current executable owner. Source bindings now point to
current suite files. No assertions or test scenarios were intentionally removed.

The source consolidation changes the physical suite count from 397 to 395.
This count is not a substitute for the pending full runtime verification.

## P7 final ownership and full-check execution gate

The original reverse-impact and native scope cases moved into the canonical
`e7-application-check-planner` and `native-check-prerequisites` suites,
reducing physical unit suites to 395 while preserving their contract markers.
`scripts/check-test-consolidation.mjs` statically audits all 616 original
contract identities, GIS remaps, concrete script/workflow test references
and runnable workflow entrypoints.

Only a pushed `work/optimization` commit containing `[full-check]` opts the
Application Architecture workflow into the complete catalog. Normal pushes
and PRs retain affected-only selection. Explicit workflow input scopes still
take precedence. Static audit and source commits do not prove tests pass.

Full-catalog CI verification was requested after P7 at this branch revision.
Conclusions and any corrective commits must be reported separately; this line
is not a passing check result.

The first full-catalog CI attempt identified false positives in executable
path detection (matrix shard arguments and SDK-managed zlib port). The
reference scanner now scopes both cases to repository-owned executable paths.
The complete catalog is requested again; runtime results remain pending.

A further full-catalog check now includes the restored automation regression
suite and validates its matrix/SDK path handling before other check phases.

The full-catalog selection also exposed duplicate ESM import declarations in
newly migrated P7 suites; all former imports now share one module-level owner.
Request a fresh full-catalog run on this corrected commit.


## P7 full-catalog CI findings (2026-11-08)

The GitHub Actions full-catalog run [42438512208](https://github.com/kimjeon-il/Pando/actions/runs/42438512208) at `72a56df507db093c79c41939124d8fa2f43c33de` **failed**. The selection job passed; the non-browser job and all three browser shards failed. This is actual execution evidence, not a static estimate.

Confirmed blocker classes from job logs:

1. **Pinned library materialization:** `assets/data/builtin-world/display-policy-v1.json` and `assets/data/places/urban-lifetimes-v1.json` were unavailable in the CI runtime even though those files are present in the pinned library repository tree. The Viewer closure fails closed rather than publishing an incomplete bundle. Investigate archive index/materialization and the source revision; do not silently delete required assets or synthesize placeholder content.
2. **Stale removed export:** `object-catalog.js` imported the removed `BUILTIN_SUBUNITS` constant. Its current catalog now derives the source ID from each live territorial feature's stored metadata.
3. **Temporal precision:** `core-document-world-wasm` still expected a year-only query despite the current month-only query contract. The test now uses a canonical month and checks that the year-only query is rejected.
4. **Post-consolidation expectations:** `current-browser-contracts` referenced a removed Hydro physical file and asserted over 600 physical suites. It now resolves original contract owners and checks the original identity count instead.
5. **Other failures:** stale territorial index, GIS historical fixtures and additional generated-world/Native/GPKG cases are not certified as resolved by the preceding changes.

Corrective source commits were applied after the failing run; the latest full CI must be read independently. Do not claim the suite passed until the new run is complete and all selected jobs succeed.


## Active-test pruning review (after the 616-identity gate removal)

The historical requirement to preserve every original suite was retired. The
original `unit-contract-identities.json`, GIS basename remap, original-name
selection alias and marker-only contract audit were removed.

Reviewed concrete test bodies and retired six low-value unit entrypoints:

- `web-document-seed`: only reasserted a fixture's collection presence and
  immutability; current project serialization and Core tests cover the behavior.
- `web-map-presentation-contract` and `web-object-removal-original`:
  frozen, historical Web oracle behaviors rather than active Viewer semantics;
  their dedicated helper modules and explicit Shared Core workflow calls retired.
- `platform-portability`: fixed 14-sample count was not real cross-platform parity.
- `compiler-deactivation`: old compiler cache deactivation is covered by the
  current remote-only-native and worktree-storage ownership tests.
- `large-data-layout`: legacy-layout equality and ad hoc scan benchmark are
  superseded by actual label-layout contracts and performance verification.

Retained after source review: the hydro fingerprint and geometry-version cache
cases, native LSIB independent evidence, read-only GPKG attachment rejection,
Native/Core command-ownership failures, DEM path security, and native source
sampling cases. The deletion policy is evidence-based, not a fixed target count.
This is source editing only: no unit, browser, Native or CI tests were executed.
