# Cross-platform code sharing boundary inventory (A0)

> **Archived architecture snapshot (2026-11-01).** The Web/Windows/Android editor architecture below is historical, not current product guidance. E7 replaced the native product with a Windows read-only reviewer; R2 retired the Android build and artifact contracts. See [Windows reviewer](windows-review-e5.md) and [E7 results](web-windows-final-regression-e7.md). Mobile Web remains supported.

Baseline: `work/ui` @ `c1b8d34e8f43fc609ae18de685a54b4bed06c8f5` (2026-11-01).

This inventory fixes the ownership boundary before further Web / Windows / Android code-sharing work. It is descriptive only: A0 does not change production behavior.

## 1. Separate product differences from platform differences

PandoLab currently has two product entry points:

- Web: `apps/viewer/` — read-only Viewer.
- Windows / Android: `apps/editor/` — editable native application.

The Viewer/Editor split is a product capability boundary, not a platform fork. Editor-only mutation, project save, GIS import, external library editing and related UI must not be moved into the Viewer merely to increase a sharing percentage.

The platform boundary is instead:

```text
shared frontend / Core
        |
        +-- browser transport (public Web)
        |
        +-- native transport (Windows + Android)
                 |
                 +-- Windows OS integration
                 +-- Android OS integration
```

Windows and Android are one frontend platform class (`native`) until an actual OS API requires a lower-level split.

## 2. Existing sharing that is already canonical

The following areas are already in the correct shared layer and are not migration targets:

| Area | Current owner | Ruling |
| --- | --- | --- |
| C++ document / geometry / temporal logic | `shared/core/` | Keep shared. |
| WASM bindings and generated Web core use | `shared/wasm/`, shared frontend loaders | Keep shared. |
| Map owner graph, resource loading, rendering helpers | `shared/frontend/js/modules/` | Keep shared. |
| Runtime metadata and versioned asset URLs | `src/runtime/runtime-context.js` | Keep as canonical runtime configuration owner. |
| File workflow orchestration | `src/ui/file-controller.js` | Keep shared; transports remain injected ports. |
| Browser project/view persistence | `src/data/browser-project-storage.js` | Keep shared. Native WebViews also use the browser storage model for Web-side autosave/view state. |
| Responsive layout detection | `src/ui/workspace-layout.js` | Keep device-independent; dimensions/input characteristics choose layout. |
| Mobile sheet presentation | `src/ui/mobile-sheet-presentation.js` | Keep shared. “Mobile” is a responsive layout, not an Android code path. |
| Shared UI fragments/styles | `shared/frontend/ui/`, `shared/frontend/css/` | Keep shared. |
| Native build identity/artifact selection | `apps/editor/native-contract.mjs`, related producer/artifact tooling | Already shares Windows/Android common native inputs. |

There are no exact duplicate frontend source blobs or same-basename source modules between `apps/viewer/`, `apps/editor/frontend/` and `shared/frontend/` at this baseline. The current split is therefore not hiding an obvious copy-and-paste frontend fork.

## 3. Current product composition

### Web Viewer

`src/app/viewer.js` hands off to `viewer-composition.js`. The Viewer constructs the shared `runtime-context`, browser file access, browser project/view storage, shared map owners and shared presentation/services.

Viewer-specific composition remains valid because the product is intentionally read-only.

### Native Editor

The native path is:

```text
Tauri/Rust shell
  -> apps/editor/native-platform-adapter.js
  -> apps/editor/startup.js composition root
  -> shared platform-runtime module registry
  -> apps/editor/frontend/js/app.js
  -> composeApplication(...)
  -> shared runtime-context + shared map owners
```

The same editor frontend is used by Windows and Android. OS-specific behavior is already mostly below the JS frontend.

## 4. Current platform-port surface

The former flat platform bag is gone. `src/runtime/platform-ports.js` validates one explicit schema with `resources`, `storage`, `files`, `library` and `world` groups.

`apps/editor/native-platform-adapter.js` is the only frontend runtime owner of raw Tauri/shell globals. Native ports are installed through module-scoped `platform-runtime.js`; browser execution resolves the same contract with `kind: 'browser'`. File access is separately governed by `file-access-contract.js`.

## 5. Native-only code that should remain native

### `apps/editor/native-storage.js`

This is already one Windows/Android implementation. Its chunk protocol, Base64 IPC encoding, Tauri command invocation and provider-path normalization are native transport concerns.

A0 ruling: do **not** move the whole module into `shared/frontend`. Browser file access does not need native IPC chunking, so doing so would relocate code without increasing actual sharing.

The shared boundary is the existing `fileAccess` interface used by `file-controller.js`.

Small transport-independent validators may be extracted later only when they remove real duplication.

### `apps/editor/network-guard.js`

This enforces the packaged native shell's request boundary and instruments native window/Worker traffic.

A0 ruling: keep it native. The public Web has a different network model, so moving this policy wholesale to `shared/frontend` would create a false common denominator.

### `apps/editor/runtime-profile.js`

This validates the packaged `map-data` resource profile and constructs native bundled-resource capabilities.

A0 ruling: keep it under the application shell for now. Windows and Android already share it, while the public Viewer does not use the same packaged-resource profile. Move only if a second non-native consumer appears.

### Native library bridge

`native-library-repository.js` is a Tauri command adapter and remains native/editor-specific. Library geometry/domain preparation can remain editor product code; it is already shared between Windows and Android.

## 6. OS-specific code that must remain split

### Android

Keep Android-specific:

- `src-tauri/android/` canonical Android overlay.
- Activity lifecycle and edge-to-edge integration.
- `OrientationPolicy.kt`.
- Android manifest/resources/signing/build configuration.
- SAF/provider URI handling and MIME-oriented picker filters.
- Provider writes where atomic sibling rename is unavailable.

`src-tauri/gen/android/` is generated scaffold material. `sync-android.mjs` copies the canonical Android overlay into it; it is not a second manually owned implementation.

### Windows

Keep Windows-specific:

- WebView2 data-directory integration.
- Windows installer/startup verification scripts.
- Windows file locking/reparse-point protections.
- Windows-native packaging/signing/artifact rules.

These are OS integration points, not frontend forks.

## 7. Cross-language native protocol

T4 added `apps/editor/document-transfer-contract.js` and a source-level JS/Rust synchronization test for 256 KiB chunks, the 256 MiB document limit, the 16-file GIS limit, read/write kinds, transfer command names and Tauri handler registration.

The JavaScript and Rust implementations intentionally remain separate. T6 closed the remaining perimeter: `network-guard.js` consumes the JavaScript contract, the synchronization test checks `src-tauri/build.rs`, and JS transport probes use the same command constants.

## 8. Confirmed change targets after A0

The inventory narrows the earlier refactor plan.

### T1 — Explicit platform-port contract

Implemented after A0. `src/runtime/platform-ports.js` is the canonical validator/factory, and runtime composition now consumes its nested `resources`, `storage`, `files`, `library` and `world` ports instead of the former flat property bag.

The contract separates:

- resource capabilities;
- file access;
- optional library access;
- startup/resource mode;
- native-only optional services.

Application modules consume the validated port only. They must not infer Windows/Android or inspect Tauri globals.

### T2 — Isolate raw native globals in the native shell adapter

Implemented. `apps/editor/native-platform-adapter.js` is the sole frontend runtime owner of raw Tauri and shell-injected capability/verification globals. It binds native IPC once, creates native file/library ports, and installs the validated platform contract into the module-scoped `platform-runtime.js` registry. `startup.js` now only composes profile, network policy, adapter output and bootstrap; `app.js` resolves the registered platform without a global platform handoff.

### T3 — Contract-level file-access consolidation, not transport merging

Implemented. `src/data/file-access-contract.js` now owns the required methods by product mode plus project/GIS selection, prepared-save and write-receipt validation. `platform-ports.js` and `file-controller.js` consume this same owner. `browser-file-access.js` and `native-storage.js` remain separate transports and are exercised by one shared contract suite.

### T4 — Native JS/Rust document-transfer protocol check

Implemented. `apps/editor/document-transfer-contract.js` is the JavaScript protocol owner for transfer command names, read/write kinds and numeric limits. `tests/unit/native-document-transfer-contract.test.mjs` parses `src-tauri/src/document_transfer.rs` and `src-tauri/src/lib.rs` and fails when Rust limits, supported kinds, `#[tauri::command]` functions or `generate_handler!` registration diverge. The native transport continues to be implemented separately in JavaScript and Rust.

## 9. Explicit non-targets

Do not perform the following as part of the sharing refactor:

- Do not merge Viewer and Editor product composition.
- Do not create Android-specific frontend business logic.
- Do not create Windows-specific frontend business logic.
- Do not move responsive mobile UI into Android code.
- Do not replace shared browser/WebView autosave with separate OS persistence without a product requirement.
- Do not move native network enforcement into the public Web.
- Do not move native IPC chunk transport into generic shared frontend code merely for directory symmetry.
- Do not add compatibility wrappers or keep both old and new platform-port paths after replacement.

## 10. Current completion state

A0 and T1-T4 are implemented. T5 completed the second residual-sharing audit and found no new Web/Windows/Android frontend fork.

T6-T10 are implemented. Renderer preparation presentation and reserved map-input targets are now product-owned hooks; the shared renderer/input modules no longer branch on Viewer versus Editor for those policies.

Detailed evidence is in `docs/architecture/platform-sharing-t5-audit.md`.
