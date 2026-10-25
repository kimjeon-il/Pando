# Source and output layout

All permanent checkouts use the same layout. Editable source stays independent in each branch.

| Owner | Source | Published path |
| --- | --- | --- |
| Viewer | `apps/viewer/templates`, `apps/viewer/js`, `apps/viewer/css` | `/`, `/assets/...` |
| Editor | `apps/editor/frontend`, `apps/editor/templates` | App `/`, verification `/__editor/index.html` |
| Native platform | `apps/editor/src-tauri`, `apps/editor/*.js` | App only, `/shell/...` |
| Common frontend | `shared/frontend/js`, `css`, `ui`, `static` | `/assets/...` |
| C++ and WASM binding sources | `shared/core`, `shared/wasm`, `shared/tests`, `shared/third_party` | Not published as source |
| Verified WASM release inputs | `shared/frontend/static/wasm` | `/assets/wasm/...` |
| Library | Existing `assets/data`, reports and GIS mounts | Selected runtime assets only |

`scripts/lib/frontend-layout.mjs` owns source/public identity and product boundaries. `frontend-build.mjs` derives HTML, CSS bundles, build metadata and immutable Worker closures without writing source files. Pages and branch previews publish only the viewer closure. App staging uses the editor closure and its existing platform boundary. Data originals are never moved into frontend source.

## Commands

Run `pnpm.cmd deps:prepare` once per permanent checkout. It uses pnpm 11.19.0, the Pando store configured by the existing storage owner, and `enableGlobalVirtualStore`. Each checkout retains its own dependency links. The local reference is `.library-data/dependencies.json`; `.pnpmfile.mjs` loads it for ordinary pnpm commands. CI uses its own ephemeral store. Use `pnpm patch` for dependency edits; do not edit shared package bytes.

- `dev:web`: viewer on loopback port 4173, desktop and mobile behavior.
- `dev:editor`: editor on loopback port 4175.
- `dev:windows` and `dev:android`: verified CI native artifacts and the editor server.
- `build:web`: immutable viewer-only static output; the command prints its location.
- `build:windows` and `build:android`: request the matching CI offline artifact.

Native development uses Node, Git, browser, CI apps and ADB. Keep the existing GPU Python environment at `D:/dev/worktrees/ui/build-native/python`; no local compiler or SDK restoration is needed.

## Outputs and consumers

The existing storage owner (`tools/worktree-storage.mjs`) owns immutable blobs, frontend output views under its `frontend/<input-sha256>` directory and fixed per-checkout editor staging under `workspaces/<checkout-id>/editor`. In unconfigured CI checkouts, transient editor staging uses `.library-data/output/editor`.

`.library-data/frontend-artifacts.json` and `.library-data/native-artifacts.json` reference active immutable products. Runtime server leases are process-scoped under `.library-data/runtime-leases`; they protect pinned library materializations. Source watchers exclude these outputs, `node_modules`, staging and verification profiles. A source refresh prepares library data only when the branch pin changes.

Development native identity excludes JS/CSS, data pins and source HEAD. Offline identity includes staging inputs, data pin and HEAD because generated build metadata records the source commit. Shared C++ fingerprints include only C++/header/CMake sources; frontend changes do not select WASM compilation.

Generated outputs may be retired only after references, servers, native consumers and pending journals have been checked. Unique evidence and original bytes belong in the external library. Permanent worktrees and source are never deduplicated with writable hardlinks.
