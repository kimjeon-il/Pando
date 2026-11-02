# R4 — archived editor source retirement (first pass)

Date: 2026-11-02
Branch: `work/r4-editor-source-retirement-20261102`
Baseline: `02880178eec647b04980f9d6bad628db30af516a`

## Scope and audit

The checked-in candidate tree has **153 files** (152 under `apps/editor/frontend/`, one `apps/editor/templates/index.html`; approximately 1.68 MB). It is not a self-contained unused tree: many modules are imported by research/GIS tools, build and fixture helpers, or historic tests. Removing all 153 without relocating those consumers would break legitimate non-editor workflows.

The Viewer and Windows reviewer do not ship the archived `app.js`, `bootstrap.js`, or `apps/editor/templates/index.html`. These three standalone product entrypoints are removed in this first pass.

## Active dependencies requiring migration before bulk removal

- `project-serializer.js`: `tests/helpers/core-startup.mjs`, `tools/builtin-world-compiler.mjs`, provenance and timeline tests. R3 still includes it in native verification hashes.
- `territorial-library.js`: multiple `tools/gis/**` scripts, `tools/build-builtin-world.mjs`, `scripts/lib/library-auto-inputs.mjs`, `tools/review/e3-revision-diff.mjs`, and geographic tests.
- `app-environment.js`: GIS/hydro fixture and world-dataset checks.
- `editing-domain.js`: historic draft/WASM tests and `scripts/p2-artifact-plan.mjs`.
- UI modules such as `app-tool-bindings.js`, `app-file-bindings.js`, `app-task-presentation.js`, `editor-workspace-presentation.js`, `mobile-sheet-controller.js`, and `confirm-modal-controller.js` remain referenced by older tests. Classify each test as retired versus still-active before removing its imported module.
- The archived modules import one another. A missing direct external reference is **not** proof that removing a single module is safe for still-running test entrypoints.

## Follow-up sequence

1. Migrate GIS, history, territorial-library, serializer and hydro helpers to a stable `tools/` or `shared/` owner; preserve exported APIs and verify source/shape parity.
2. Remove archived UI-only test groups from active CI and update their fixtures, scripts and workflow references without disabling Viewer/C++/GIS coverage.
3. Remove now-unreferenced archived UI controllers, draft/edit workers and old module entrypoints in cohesive dependency-closed batches.
4. Verify there are zero imports of deleted paths from active sources and tests. Run E5/E6/E7, native Windows artifact, C++/WASM and GIS regression gates.
5. Only then delete the remaining editor tree. Do not delete user files, GIS data or Windows reviewer sources.

**Status:** partial R4 cleanup. This is not a claim that all 153 candidates were removed.
