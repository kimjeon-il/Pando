# Viewer application module ownership (2026-11-09, work/optimization)

This document describes the **current Web Viewer**, not the retired Editor or Windows runtime. The original `assets/js/app.js` / `app-composition.js` map below was historical and is no longer authoritative.

## Published entry and layout

- `src/app/index.html` is the HTML shell. `src/app/viewer.js` is published as `assets/js/viewer.js`; the entry preflights the shared WASM then dynamically imports `src/app/viewer-composition.js`.
- `src/app/map-owner-composition.js` constructs the read-only map owners; `src/app/viewer-map.js` wires the map session, and `src/app/application-lifecycle.js` owns startup and disposal. App owners must not redefine data catalogs or geometry algorithms.
- `src/document/` owns the C++-backed project session, temporal and territorial document semantics; it does not own the contents of a map dataset. `src/document/builtin-session.js` selects a project-declared territorial catalog.
- `src/data/` owns resource manifests, prepared data, place runtime and its lifetime policy, physical layer services, immutable asset loading, and file readers. `src/data/gpkg-read-core.js` is the one canonical GPKG read implementation; the duplicate Worker-location copy was retired.
- `src/map/` owns camera, projection, input, spatial selection and hit testing. `src/geometry/` owns geometry mathematics and native geometry source.
- `src/rendering/` owns GPU/Canvas rendering, layer presentation, map visual frame, resource admission and render scheduling. It does not own project data catalogs or a separate copy of the place/terrain schema.
- `src/runtime/` owns platform ports, Worker RPC, shared core loading, runtime context and idle map-work scheduling.
- `src/ui/` owns Viewer surfaces, controllers, CSS and fragments.

Source modules from these directories are published through `scripts/lib/frontend-layout.mjs` into the stable `assets/js/modules/` and `assets/js/workers/` namespaces. A source **move between domains is not an asset URL rename**. Always verify both static ESM imports and classic Worker `importScripts` / dynamic imports before deleting old source owners.

## Data contract and operational boundaries

The selected `projects/<projectId>/manifest.json` declares resource catalogs for the world, territories, rivers, lakes, places, place lifetimes, terrain, physical land and prepared meshes. `src/data/map-project-manifest.js` validates the ID, roles and safe paths; `scripts/lib/frontend-build.mjs` builds only the selected project's runtime closure.

The shared GIS library archive and project sessions are different owners. Dataset catalogs contain the individual objects, coordinates and dates. The project manifest points to catalogs instead of cloning their content, and Viewer consumers are read-only.

`scripts/run-application-checks.mjs` is the common affected-check executor. Independent native builds, immutable artifact publication, on-demand GIS research, and production Pages deployment retain separate operational boundaries. They are not replaceable merely because filenames or check inputs overlap.

## Stage 3 moves and invariants

- Moved the map work scheduler to `src/runtime/map-work-scheduler.js`.
- Moved place RPC runtime and lifetime catalog validation to `src/data/place-runtime.js` and `src/data/place-lifetime-policy.js`.
- Moved terrain manifest and physical-layer service into `src/data/`.
- Removed the byte-identical unconsumed `src/data/workers/gpkg-read-core.js`, preserving `src/data/gpkg-read-core.js`.
- Preserved the generated module URL names, Worker RPC protocols, existing C++ document owner and GIS source-pinning rules.

All subsequent moves require verification of publishing closures, reverse imports, Worker startup, and relevant CI. Large-domain all-at-once rearrangements and destructive cleanup without executable evidence are not permitted.
