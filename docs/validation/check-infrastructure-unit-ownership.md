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
