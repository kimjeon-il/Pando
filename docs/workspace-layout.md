# Source and output layout — active Viewer paths and archived workspace map

**Current source ownership (2026-11-11):** The only shipping product is the Web Viewer. The permanent worktree layout is governed by [branch-policy.md](branch-policy.md), and the current product module inventory is [app-module-ownership.md](app-module-ownership.md). The `apps/viewer`, `apps/editor`, `shared/frontend`, `shared/core` paths in the original layout below belong to an archived, retired product structure.

| Current owner | Source and published responsibility |
| --- | --- |
| Viewer entry, HTML and composition | `src/app/index.html`, `src/app/viewer.js`, `src/app/viewer-composition.js` |
| UI / CSS / fragments | `src/ui/` |
| Document / C++ and WASM | `src/document/` and domain-specific `src/*/native/` |
| Map, geometry, rendering, runtime | `src/map/`, `src/geometry/`, `src/rendering/`, `src/runtime/` |
| GIS source/build/check helpers | `tools/`, `scripts/`, `config/`, `contracts/` |
| Pinned GIS data and report originals | external `PandoLab-library-data`, selected through `config/library-data.json` |

Current supported scripts: `pnpm deps:prepare`, `pnpm dev:web`, `pnpm build:web`. The repository's `package.json` and `scripts/lib/frontend-layout.mjs` own actual script names and published paths. **There is no active `dev:editor`, `dev:windows` or `build:windows` script.** Local build restrictions and cache-cleanup protections remain governed by [AGENTS.md](../AGENTS.md) and [worktree-storage.md](worktree-storage.md).

## Historical Web/App/Windows workspace and staging decisions (preserved)
The original instructions below are a dated architectural snapshot, **not current checkout paths, build commands or a new SDK installation instruction**. They are retained for tracing prior toolchain, input identity and evidence decisions.

All permanent checkouts use the same layout. Editable source stays independent in each branch.

| Owner | Source | Published path |
| --- | --- | --- |
| Viewer | `apps/viewer/templates`, `apps/viewer/js`, `apps/viewer/css` | `/`, `/assets/...` |
| Archived editor source | `apps/editor/frontend`, `apps/editor/templates` | Not published or packaged |
| Windows reviewer shell | `apps/editor/src-tauri`, `apps/editor/*.mjs`, `apps/editor/review-probe.js` | Viewer-derived `/review.html`, optional `/shell/...` |
| Common frontend | `shared/frontend/js`, `css`, `ui`, `static` | `/assets/...` |
| C++ and WASM binding sources | `shared/core`, `shared/wasm`, `shared/tests`, `shared/third_party` | Not published as source |
| Verified WASM release inputs | `shared/frontend/static/wasm` | `/assets/wasm/...` |
| Library | Existing `assets/data`, reports and GIS mounts | Selected runtime assets only |

`scripts/lib/frontend-layout.mjs` owns source/public identity and product boundaries. `frontend-build.mjs` derives HTML, CSS bundles, build metadata and immutable Worker closures without writing source files. Pages and branch previews publish only the Viewer closure. Windows staging packages that same Viewer closure with a restricted Tauri boundary. The archived editor closure is not a product output; Android native packaging is retired. Data originals remain in their source owner.

## Commands

Run `pnpm.cmd deps:prepare` once per permanent checkout. It uses pnpm 11.19.0, the Pando store configured by the existing storage owner, and `enableGlobalVirtualStore`. Each checkout retains its own dependency links. The local reference is `.library-data/dependencies.json`; `.pnpmfile.mjs` loads it for ordinary pnpm commands. CI uses its own ephemeral store. Use `pnpm patch` for dependency edits; do not edit shared package bytes.

- `dev:web`: viewer on loopback port 4173, desktop and mobile behavior.
- `dev:editor`: legacy command name for the Windows review development server on loopback port 4175.
- `dev:windows`: source-verified Windows reviewer executable and its local review server.
- `build:web`: immutable viewer-only static output; the command prints its location.
- `build:windows`: Windows-only offline CI installer artifact.

Native reviewer development uses Node, Git, browser and source-pinned Windows CI artifacts; ADB/Android SDK is no longer required. Existing GPU Python/GIS environments and historical caches must not be auto-deleted.

## Outputs and consumers

The existing storage owner (`tools/data/worktree-storage.mjs`) owns immutable blobs, frontend output views under its `frontend/<input-sha256>` directory and fixed per-checkout editor staging under `workspaces/<checkout-id>/editor`. In unconfigured CI checkouts, transient editor staging uses `.library-data/output/editor`.

`.library-data/frontend-artifacts.json` and `.library-data/native-artifacts.json` reference active immutable products. Runtime server leases are process-scoped under `.library-data/runtime-leases`; they protect pinned library materializations. Source watchers exclude these outputs, `node_modules`, staging and verification profiles. A source refresh prepares library data only when the branch pin changes.

Development native identity excludes JS/CSS, data pins and source HEAD. Windows `offline`/`verification` identities include the actual Viewer/shared frontend, relevant native staging tools, pinned library config, source-matched WASM assets and dependency lockfile; they do **not** recursively hash the archived `apps/editor/frontend` or `apps/editor/templates` trees. The canonical baseline fingerprint now lives at `src/document/project-baseline-fingerprint.js`, loaded by the verification fixture; the GIS template compiler is `tools/gis/project-template-compiler.js`, and historic autosave is test-only; the verification probe itself is hashed only in verification mode. The whitelist is `nativePackagedInputPaths` in `apps/editor/native-contract.mjs`. Both packaged identities also retain `source-commit` because the embedded native build and staged metadata identify the exact Git revision; therefore a **new Git commit still changes packaged identity**, even if it only modifies archived sources. Cross-commit binary reuse would require a separately reviewed provenance/packaging design. Shared C++ fingerprints include only C++/header/CMake sources; frontend changes do not automatically select WASM compilation.

Generated outputs may be retired only after references, servers, native consumers and pending journals have been checked. Unique evidence and original bytes belong in the external library. Permanent worktrees and source are never deduplicated with writable hardlinks.
