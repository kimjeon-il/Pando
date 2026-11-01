# T5 residual cross-platform sharing audit

Baseline: work/ui @ 34be2fbd7c34eda460be0569941d8195f580ae13 (2026-11-02 KST).

## Result

- Audited runtime/composition JS/MJS: 410 files (shared 231, editor frontend 151, viewer 8, editor shell 20).
- Exact cross-root duplicate Git blobs: 0.
- Cross-root same-basename JS/MJS/CSS/HTML collisions: 0.
- No new Windows-only or Android-only frontend business-logic fork found.
- Raw native globals remain isolated behind native-platform-adapter.js.

## T6 — P0 protocol perimeter

T4 synchronized the main document-transfer pair, but production command names remain duplicated in apps/editor/network-guard.js and apps/editor/src-tauri/build.rs. Tests also hardcode protocol commands in native-storage.test.mjs, native-map-plugin.mjs and territorial-names.spec.mjs.

Action: make network-guard consume DOCUMENT_TRANSFER_COMMANDS, extend the JS/Rust contract test to inspect build.rs, and make JS transport fixtures use contract constants.

## T7 — P1 stale native verification globals

native-platform-adapter.js exposes runtime.physicalImmediate and runtime.buildInfo, but neither has a current frontend consumer. The physical-immediate A/B path is stale: runtime_options.rs and measure-windows-startup.ps1 still drive it while full-world-probe no longer publishes physicalDeferredUntilReady.

Action: remove obsolete frontend injections and the unsupported physical-immediate benchmark branch. Keep Rust-side embedded build identity used by --build-info and artifact verification.

## T8 — P1 test fixture sharing

native-storage.test.mjs and file-access-contract.test.mjs each implement a native transfer simulator. Browser picker fixtures are also recreated in several file tests.

Action: create shared test helpers backed by document-transfer-contract.js and file-access-contract.js.

## T9 — P1 staging fixture closure

apps/editor/tests/helpers/world-fixture.mjs manually copies platform-ports.js, platform-runtime.js and runtime-context.js. T1/T2 already required manual edits to this list.

Action: derive the fixture runtime closure from the existing dependency catalog, or centralize the copied runtime-module list in one helper.

## T10 — P2 product-mode cleanup

map-renderer-composition.js still owns Viewer-specific map-preparation wording/UI and map-input-presentation.js contains editor-specific interactive-target policy. These are product differences, not OS forks.

Action: later inject product presentation/input hooks. Keep workspace-surfaces.js, project-session.js and Viewer/Editor top-level composition split.

## Order

T6 -> T7 -> T8 -> T9 -> T10.