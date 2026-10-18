# Retire the Qt application

Approved baseline: `43d13b10ef0276ada9dd91430d59b3266ae7e286`, fast-forwarded into the existing `work/ui` worktree.

Goal: `apps/web-shell` is the only application. Remove the complete old application tree, app-only tools/tests/reports and CI paths without changing the current Web/Tauri implementation, shared algorithms, saved formats or performance work.

- [x] Confirm a clean worktree and fast-forward to the approved baseline.
- [x] Remove the entire native tree and old-app-only artifacts. Extract only dependencies used by current Web/shared code to their current owners.
- [x] Separate retained headless CI from retired Qt jobs; update active planners, tests and development guidance.
- [x] Run bounded configuration/staging/fixture/publication checks, verify protected Git blob identities, and record removal/preservation evidence under `reports/`.

Ruling: the user explicitly superseded preservation with "보존하지 말고 / 다 지우라고 / 옛날 앱 관련된거 전부". Remove the full old app, including its independent engine, data, tools and tests. Preserve current Web/shared algorithms and data in their canonical owners; only required fixture/source metadata dependencies are extracted byte-for-byte.

Ruling: old Qt-bound geometry adapters are retired with their application; the existing shared geometry kernels and their frozen fixtures remain the computational authority. Do not port or change geometry algorithms in this task.

No Qt application, real-world performance workload, full test suite, SDK cleanup, cache cleanup, main integration, push, deployment or portable creation is authorized here. The machine-readable protected-file inventory is `build-native/qt-retirement/preservation-baseline.json`.

Verification: see reports/development/testing/qt-app-retirement-2026-10-18.md. Core configuration and focused static/publication checks pass; four core-dependent files are blocked by stale WASM source provenance (baseline geometry source plus moved test fixture CMake path). No build, application run or publishing was performed.
