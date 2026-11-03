# R4-E2 — active Core/GIS tests and helper migration

Baseline: `work/ui` `da8fb65732e43026a77d151253d4eb45ff27f2db`. Scope: Core and GIS *test imports and fixtures only*; no edits to GIS data, bundled Viewer, C++/WASM or native permissions.

## Work performed

1. **C++ territorial/distribution service adapters** were isolated under `tests/helpers/core-command-services`. The current Core tests, `current-command-fixture` and `web-full-document-fixture` no longer import the archived editor copies. They continue testing actual C++ `commandOwner` ACKs, invalidity, locks, ID, temporal rules, history and Undo/Redo.
2. **GIS importing/land transfer**: `gis-core-fixture` now instantiates test-owned import transaction and dependent land geometry adapters in `tests/helpers/core-gis-compat`; the compatibility GIS rows are loaded from the frozen R4-E1 GeoPackage fixture, not from `apps/editor/frontend`. The real C++ `ProjectDomain`, boundary geometry kernel and source-provenance assertions remain. `generic-provenance`, `import-service`, `gis-geometry-worker` and `land-relations-presentation` use those test helpers.
3. **Core-direct behavior**: hydro/label edit and delete, generic removal with selection anchors, generic-to-label atomic batch and label gesture tests now drive `ProjectDomain.executeCommand`, `labelGestureApply` and `undo/redo` directly. Frozen historical Web oracles remain as expected-result fixtures; no active Core test constructs their current editor UI factories.
4. **Save state observations** were isolated in a test-only helper, with Core save/project fixture tests re-pointed to it.
5. **Explicit remaining UI test queue**: the 19 archived Core/fixture category modules remain intact; old UI orchestration tests (country command menus, geometry/draft gesture editors, mutation forms, persistence UI) are pending R4-E3 retirement or semantic migration. They are NOT silently removed from the catalog.

## Why the old modules remain

The 103 archived files still exist and preserve exact historical behavior until R4-E3/E4 determine which UI tests to remove. Test-owned copies are compatibility oracles, *not production runtime*. After E3 it is appropriate to delete any duplicate test-owned helper that no longer has supported regression consumers, rather than preserving the editor in test fixtures forever.

## Validation gates

`tests/unit/r4e2-core-gis-boundaries.test.mjs` checks the migrated Core test subset for direct editor imports, verifies that test-only adapters are not linked into the Viewer product, and guards real Core semantics. The R4 editor source/GIS preservation workflow executes retained GIS R4-C plus targeted Core/WASM service, provenance, transaction, label, selection, and GeoPackage regression tests. R4 source audit still inventories all 103 old files and reports residual references.

No application source, Core/WASM native code, historical data, original archives, country flags, source pin or P6-3 delta protocol has been modified.
