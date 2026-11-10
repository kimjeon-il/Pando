# Stage 5 — Common map project lifecycle, source-scoped resources

Branch: `work/optimization`. This report describes the **focused** source and contract verification only. It is not a whole-browser, GIS, or WebAssembly release sign-off.

## Already unified before this work

- `builtinActive` was removed; the accepted C++ project document is the single authority for identity, cursor and project generations.
- `createProjectOpenAdapter` normalizes default-world and GeoPackage readers into the same `ProjectDomain.open` / C++ replacement / rollback transaction.
- `createProjectMonthClock` sends date changes to the accepted C++ cursor without replacing the project; only initial default-world admission and explicitly returning from an imported file open the manifest-backed default world.
- Project scope keys isolate search rows and C++ selection acknowledgements by project ID, document ID and generation.

## Follow-up changes

1. `2f326db6` — remove the executable `projectSetup.sourceMode === 'builtin'` renderer branch. Every project's prepared scene is content-admitted by geometry/hierarchy/hash, with normal mesh preparation on cache miss. Retire `prepareTemporalBuiltin({transition:true})` before it could rebuild a dated document; legacy serialized `sourceMode` remains readable.
2. `ccc9945b`, `94c86d9d` — bind the physical/Hydro renderer to the reader admitted by the shared map replacement lifecycle; invalidate old historical masks and selection references when importing another document. Superseded Hydro fetch/Worker acknowledgements cannot install into the next project.
3. `7360db4f`, `63f4f65e`, `acbd19e4` — add narrowly scoped Hydro generation, source-mode, and historical-water regression contracts.
4. `53f5a2be`, `656614c7`, `cdabbd71` — clear prior Places Worker tasks, caches, label references and search rows at every project replacement. Builtin labels are excluded from a user file's visual output while project-authored labels remain visible. A superseded search result cannot publish after a new reader is admitted.
5. `6aaf4297` — bind asynchronous historical-water activation callbacks to the originating project epoch, including rapid default → file → default transitions.
6. `b66bf33a`, `97cd550d`, `8ee92a17` — regression guards for pending Places Worker reset and source-epoch barriers. The `place-runtime` functional test needs a source-matched native/WASM prerequisite; it was not falsely counted as passing in a JS-only run.

## Focused verification

- [Stage5 source-matched JS-only check](https://github.com/kimjeon-il/Pando/actions/runs/42633166433): 25 tests passed, zero failures.
- [Final post-Places/Hydro epoch fix targeted check](https://github.com/kimjeon-il/Pando/actions/runs/42634857459): 26 tests passed, zero failures.
- Includes the explicitly listed project-open-adapter, map-project-identity, prepared-mesh-loader, project-source guard, stale-Hydro Worker, frontend-build and Pages staging contracts. The last run also checks syntax for the changed Viewer/Places/Hydro/ProjectDomain modules.
- No full test suite, browser matrix, native rebuild or GIS regeneration was requested or executed here.

## Remaining verification boundaries

The JS-only suite proves source selection and project-generation guards, **not** full real-browser rendering or the native-backed `tests/unit/rendering/place-runtime.test.mjs` test. That test was updated with a pending Worker reset scenario but requires a freshly source-matched compiled C++/WASM Core. Before release, run a narrowly selected source-matched Core + imported project/default-world browser transition smoke, rather than a whole suite. External project manifests and precompiled Workers must be published from the same source revision.

No `main` merge and no deployment.
