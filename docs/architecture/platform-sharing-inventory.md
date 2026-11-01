# Cross-platform code sharing boundary inventory (A0)

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
| Runtime metadata and versioned asset URLs | `shared/frontend/js/modules/runtime-context.js` | Keep as canonical runtime configuration owner. |
| File workflow orchestration | `shared/frontend/js/modules/file-controller.js` | Keep shared; transports remain injected ports. |
| Browser project/view persistence | `shared/frontend/js/modules/browser-project-storage.js` | Keep shared. Native WebViews also use the browser storage model for Web-side autosave/view state. |
| Responsive layout detection | `shared/frontend/js/modules/workspace-layout.js` | Keep device-independent; dimensions/input characteristics choose layout. |
| Mobile sheet presentation | `shared/frontend/js/modules/mobile-sheet-presentation.js` | Keep shared. “Mobile” is a responsive layout, not an Android code path. |
| Shared UI fragments/styles | `shared/frontend/ui/`, `shared/frontend/css/` | Keep shared. |
| Native build identity/artifact selection | `apps/editor/native-contract.mjs`, related producer/artifact tooling | Already shares Windows/Android common native inputs. |

There are no exact duplicate frontend source blobs or same-basename source modules between `apps/viewer/`, `apps/editor/frontend/` and `shared/frontend/` at this baseline. The current split is therefore not hiding an obvious copy-and-paste frontend fork.

## 3. Current product composition

### Web Viewer

`apps/viewer/js/viewer.js` hands off to `viewer-composition.js`. The Viewer constructs the shared `runtime-context`, browser file access, browser project/view storage, shared map owners and shared presentation/services.

Viewer-specific composition remains valid because the product is intentionally read-only.

### Native Editor

The native path is:

```text
Tauri/Rust shell
  -> apps/editor/startup.js
  -> native profile / file / library capabilities
  -> globalThis.__PANDOLAB_SHELL_PLATFORM__
  -> apps/editor/frontend/js/app.js
  -> composeApplication(...)
  -> shared runtime-context + shared map owners
```

The same editor frontend is used by Windows and Android. OS-specific behavior is already mostly below the JS frontend.

## 4. Current platform-port surface

The Editor currently consumes an implicit platform object rather than an explicitly validated contract. Current fields include:

- `builtinHydroAvailable`
- `builtinPlacesAvailable`
- `startupMesh`
- `storageNamespace`
- `fileAccess`
- `getLibraryRepository`
- `libraryGeometryContext`
- optional `builtinWorldLoader` support in shared map composition

Consumers include `resource-capabilities.js`, `map-owner-composition.js`, `app-composition.js`, history composition, GIS composition and progressive startup.

This is the main remaining architectural sharing target: one explicit platform-port contract should describe capabilities and services without exposing Tauri globals to application code.

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

`native-storage.js` and `src-tauri/src/document_transfer.rs` intentionally meet at a protocol boundary:

- 256 KiB transfer chunks.
- 256 MiB document limit.
- document kind names.
- begin/append/finish/read/abort command lifecycle.

The two languages cannot literally share implementation code. Future work should verify this protocol contract rather than trying to merge JS and Rust source.

## 8. Confirmed change targets after A0

The inventory narrows the earlier refactor plan.

### T1 — Explicit platform-port contract

Highest priority.

Add one canonical validator/factory for the application-facing platform object. It should separate:

- resource capabilities;
- file access;
- optional library access;
- startup/resource mode;
- native-only optional services.

Application modules consume the validated port only. They must not infer Windows/Android or inspect Tauri globals.

### T2 — Isolate raw native globals in the native shell adapter

`apps/editor/startup.js` currently reads `__TAURI_INTERNALS__`, `PANDOLAB_NATIVE_LIBRARY_AVAILABLE` and builds `__PANDOLAB_SHELL_PLATFORM__`.

Create/extend one native platform adapter so raw shell globals are interpreted once. `startup.js` becomes a composition root; editor application code receives the resulting immutable ports.

The current `app.js` global handoff is part of this target.

### T3 — Contract-level file-access consolidation, not transport merging

Keep:

- `browser-file-access.js` as browser transport.
- `native-storage.js` (or a later semantic rename) as native transport.

Strengthen one shared file-access contract and reuse the same contract tests against browser and simulated native adapters. Extract code only where both adapters actually duplicate semantics.

### T4 — Native JS/Rust document-transfer protocol check

Add focused checks that the command names, chunk limit, document limit and supported kinds stay synchronized across JS and Rust.

This is safer and smaller than moving native transport code into the Web layer.

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

## 10. A0 completion state

A0 changes no runtime source. The next implementation step should start with **T1 explicit platform-port contract**, followed by **T2 native shell adapter isolation**. The previously proposed broad file-I/O extraction and unconditional relocation of runtime-profile/network policy are not justified by the current source: those components are already shared where they have real consumers.
