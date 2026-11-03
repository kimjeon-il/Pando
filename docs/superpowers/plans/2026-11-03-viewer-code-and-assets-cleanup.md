# Viewer Code and Asset Cleanup Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes for tracking.

**Goal:** Remove retired editor code, stale checks, duplicate asset planning, and demonstrably unused delivered resources while preserving the current Viewer and Windows review workflows.

**Architecture:** The Viewer product graph in `scripts/lib/frontend-build.mjs` and `scripts/lib/product-assets.mjs` becomes the sole list of delivered assets. Windows staging consumes that graph instead of independently enumerating the full GIS library. Runtime data and prepared polygon meshes remain where a current loader uses them; historical public URL retention is tracked separately from active product files.

**Tech Stack:** JavaScript ES modules, CSS, Node.js checks, Rust/Tauri, Web Viewer, WASM.

**Spec:** User-requested four-part audit in this conversation, based on `integration/r4-gis-w2-20261103` at `874444a2dba8deabcbd2d43b812c9d77864486c9`.

## Global constraints

- Recheck `git worktree list --porcelain`, branch/remote head, status, and the nine pre-existing dirty paths before editing. Keep their owners' changes; do not stash, reset, clean, or replace them.
- Use the existing permanent worktree and branch. Do not merge to `main`, deploy, or publish runtime GIS data as a side effect.
- The external library repository owns original GIS and runtime data. Change the application delivery graph, not the library's source archive, unless a separately verified unused-object manifest justifies data cleanup.
- Run only the smallest relevant checks and required incremental preparation. No full suite, full build matrix, or whole-catalog GIS validation without an explicit request.
- A missing text reference is a candidate, not proof: include ESM imports, classic Workers, runtime URL construction, generated HTML/CSS, tests, native staging, and deployment contracts before deleting.
- Keep the Viewer read-only and retain the shared C++/WASM core, historic dates, correction drafts, provenance, and native diagnostic permissions.

## Review focus

- A historical date with a split country asset must still load the correct dated identities and geometry; verify with a focused built-in world loader test.
- A prepared polygon mesh hit and miss must both render the same geometry; verify with the prepared-mesh unit test and one focused Viewer map workflow.
- A Windows offline `map-data` build must start at `review.html` without any retired editor bootstrap; verify with the focused staging tests.
- A formerly published GIS URL may be retained by the Pages archive contract even when absent from the active Viewer graph; verify the release manifest gate separately before changing protection rules.
- Existing dirty UI edits must survive every task byte-for-byte except for explicitly reconciled changes in those same files; inspect the task-scoped diff and status after each task.

---

### Task 1: Repair checks left pointing at the retired editor tree

**Files:** `scripts/check-js.mjs`, `scripts/check-ui-spacing.mjs`, `eslint.config.js`, `scripts/library-auto-sync.mjs`; focused tests for these scripts where present.

- [ ] Capture the current dirty diff, then remove the nonexistent `apps/editor/frontend/js` walk from the two checks. Preserve the ongoing `check-ui-spacing.mjs` changes.
- [ ] Remove the obsolete ESLint paths. Review the auto-sync input hash separately: remove the retired path only if its omission cannot change the identity of an active generated input.
- [ ] Verify the removed-directory case with a small synthetic fixture or focused test; run `node --check` on changed scripts and the affected UI spacing check. Do not use the repository-wide `check-js.mjs` scan as a default gate.
- [ ] Review and commit only task-owned hunks after the existing dirty-file owner has been reconciled; otherwise leave the change uncommitted and explicitly record the overlap.

### Task 2: Retire product-excluded startup and test-only remnants

**Files:** `apps/editor/startup.js`, `apps/editor/runtime-profile.js`, affected `apps/editor/tests/*`, `apps/editor/src-tauri/src/storage.rs`, affected native tests, `shared/frontend/js/modules/territorial-name-presentation.js`, browser TopoJSON bundles, affected source inventories/contracts.

- [ ] Rebuild the entrypoint and reference manifest from `apps/viewer/js/viewer.js`, `apps/editor/stage.mjs`, the Viewer asset graph, Rust navigation, CI, and tests. Mark each candidate as runtime, test-only, archive contract, or orphan.
- [ ] Remove the already empty territorial-name presentation file only after integrating its existing dirty change. Update tests/inventories that explicitly require that source path.
- [ ] Remove `startup.js` and `runtime-profile.js` together only after replacing tests that import them with assertions against the current `review.html` entrypoint; retain any fixture logic still needed in test helpers.
- [ ] Delete the three browser TopoJSON bundles only after confirming they are absent from the product closure and no packaging contract names them. Leave the npm TopoJSON packages used by GIS tools intact.
- [ ] For Rust `atomic_copy` and `sync_file`, remove production helpers and their obsolete tests together if no native command, migration, or recovery path calls them. Keep `atomic_write` and `read_bounded`.
- [ ] Run affected Node unit tests, Rust storage tests, and current entrypoint/stage tests. Do not run the full suite.

### Task 3: Collapse Viewer-dead editor branches and CSS

**Files:** `shared/frontend/js/modules/navigation-bindings.js`, `workspace-surfaces.js`, `browser-file-access.js`, `file-controller.js`, `browser-project-storage.js`, `preferences-dialog.js`, `preference-presentation.js`, `map-workspace-host.js`, `platform-ports.js`, `product-mode-policy.js`, `resource-capabilities.js`, related ports/callers/tests, `shared/frontend/css/components/editor-shell.css`, `scripts/lib/ui-source-catalog.mjs`.

- [ ] Trace every `productMode === 'editor'` and editor-only port from the sole active Viewer composition. Remove branches and callers only where no current test, native verification flow, or GIS tool needs the behavior. Keep a required platform boundary if it still carries real Viewer behavior.
- [ ] Remove `bindSurfaceTabs`, `openSelectionEditor`, `syncEditingSurfaces`, editor panel setup, and their unused dependency ports where the final call graph proves they are unreachable. Update the current tests to assert Viewer behavior, not retired editor behavior.
- [ ] Classify all selectors in `editor-shell.css` against current Viewer HTML, generated markup, JS class creation, and CSS imports. Remove unused rules, then split or rename the remaining shared stylesheet only if it clarifies ownership; do not delete the whole file from a literal-string count.
- [ ] Reconcile the pre-existing `editor-shell.css` and adjacent dirty UI edits before changing their hunks.
- [ ] Run changed-file lint, relevant UI/component checks, and focused browser interaction checks for menu, search, responsive layout, and map display.

### Task 4: Use one active asset closure for Web and Windows

**Files:** `scripts/lib/product-assets.mjs`, `scripts/lib/frontend-build.mjs`, `apps/editor/stage.mjs`, `apps/editor/world-data-plan.mjs`, affected build metadata/stage/Pages contracts and tests.

- [ ] Preserve `selectFrontendProduct(snapshot, 'viewer', {readRuntimeAsset})` as the canonical selected-file interface. Have Windows staging consume the same selected paths and verified bytes; remove the independent file enumeration in `world-data-plan.mjs` once its useful world summary and integrity checks have one owner.
- [ ] Check each runtime manifest against actual Viewer and Worker consumers. Retain `builtin-world` and `world/current` assets read by loaders. Retain prepared meshes keyed by current geometry digests and maintain the tested on-demand build fallback.
- [ ] Remove the 287 territorial-library files from the active Viewer/Windows closure only after current loaders, offline review, source SHA validation, and focused stage tests demonstrate that no product path reads them. Leave the library archive and GIS generation inputs intact.
- [ ] Review the flag, font, vendor, and physical-asset closures for paths included solely by unconditional directory selection. Replace only such over-inclusion with verified references, preserving dynamically selected flags and Worker dependencies.
- [ ] Resolve GDAL's remaining Pages protection explicitly: it is outside the current Viewer closure, but release checks still require its historical URLs. Retain archived public bytes where the release contract requires them; remove obsolete active-package or source copies only after the archive and focused release checks account for those URLs.
- [ ] Keep old public URLs and Pages archive locks separate from the active Viewer closure. Change a protection rule only with a targeted release-manifest test that still accounts for retained historical URLs. Do not deploy.
- [ ] Compare before/after active file counts and bytes using the same snapshot and pinned data revision. Run focused frontend product-output, Windows staging, prepared-mesh, and Viewer map tests. Report active-package savings separately from Git-tracked-file changes and measured disk space.

### Task 5: Resolve test-only GIS code without weakening current contracts

**Files:** the `tools/gis/*` candidates in the four-part audit, their direct tests/helpers, and the retirement/CI source inventories that reference them.

- [ ] For each candidate, distinguish an active GIS command dependency from a test fixture or retired audit. Move genuine test helpers under `tests/helpers/` only when they still protect a current contract; remove tests and implementation together when both test only obsolete editing behavior.
- [ ] Keep active generators and validators, including `geometry-validation.js`, `territorial-library.js`, and `map-edit-geometry.js`, unless a current caller is replaced in the same change.
- [ ] Run the smallest tests for changed GIS helpers and the exact affected CI inventory check. Do not regenerate or validate the whole GIS catalog.

### Completion gate

- [ ] Recompute the Viewer entrypoint graph, CSS inclusion, Windows stage paths, and data family counts from the final branch state. Every removed path must have no current runtime, build, test, or retained archive consumer.
- [ ] Review source and test diffs together; preserve existing dirty work and native permissions. Confirm affected Web and Windows workflows independently.
- [ ] Report removed source paths, removed active-package paths/bytes, retained functional data, tests run, and any uncertain candidates. Do not claim full-project validation.
