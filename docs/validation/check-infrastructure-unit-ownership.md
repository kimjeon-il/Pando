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
