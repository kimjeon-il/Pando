# Viewer validation consolidation — 2026-11-07

Source: `4f27dc9ac18fc2f6ca0163f8d33fea33e813d50f`. Inventory records every top-level unit, browser, and GitHub Actions workflow file; the companion JSON records its feature and disposition. This snapshot is an audit artifact, not a test allowlist or a runtime dependency.

## Baseline and planned changes

- Unit tests: **660**; browser specs: **38**; workflows: **84**.
- Phase 2: remove **13** tests that exclusively pin retired editing behavior, obsolete historical gates, or single-use diagnostic output. Do not delete GIS provenance, published data, native correctness or project safety tests just because their names contain old stage numbers.
- Phase 3: consolidate **12** unit feature families (absorbing 29 standalone files). Keep each original assertion as a separate named subtest in the survivor.
- Phase 4: consolidate **10** browser feature families (absorbing 22 standalone specs). Preserve backend-specific fixture scopes inside independent Playwright `test.describe` blocks.
- Workflow consolidation is **phase 6**: research/data-generation workflows have separate permissions and output semantics, so do not delete them during phases 1–4.

## Safety rules

1. Never silently drop a test body during consolidation. Preserve assertions, per-case failure evidence, and native prerequisite ownership.
2. Preserve live Viewer map loading, device-current date selection, date transitions, GPKG, GIS topology/area, Canvas/WebGL, Worker, DEM, recovery and review acceptance.
3. Avoid hardcoded hashes or frozen internal source-string anchors in new tests. Historical static input dates remain valid fixtures for calendar rollover.
4. Do not auto-register every test in a single huge suite: retain independent feature-level selectors so changed-file CI can still choose a bounded set. Later phases may implement test-name impact selection.
5. Updating catalog, package scripts and workflow references is mandatory when paths are removed. Do not execute full CI during this change set.

## Planned unit feature owners

- `tests/unit/camera-navigation.test.mjs` ← `tests/unit/camera-pan.test.mjs`
- `tests/unit/hydro-river-features.test.mjs` ← `tests/unit/hydro-lake-features.test.mjs`, `tests/unit/hydro-river-input.test.mjs`, `tests/unit/hydro-physical-replacement.test.mjs`
- `tests/unit/hydro-border-alignment.test.mjs` ← `tests/unit/hydro-border-partial.test.mjs`, `tests/unit/hydro-border-whole.test.mjs`
- `tests/unit/canvas-country-geometry.test.mjs` ← `tests/unit/canvas-coupled-land.test.mjs`, `tests/unit/canvas-stroke-preparation.test.mjs`
- `tests/unit/gpu-country-mesh-variants.test.mjs` ← `tests/unit/gpu-country-patch-presentation.test.mjs`, `tests/unit/gpu-country-culling.test.mjs`
- `tests/unit/builtin-month-clock.test.mjs` ← `tests/unit/builtin-clock-recovery.test.mjs`, `tests/unit/map-transition-clock-contract.test.mjs`
- `tests/unit/gpu-resource-owners.test.mjs` ← `tests/unit/gpu-resource-budget.test.mjs`, `tests/unit/gpu-renderer-lifecycle.test.mjs`
- `tests/unit/map-presentation-readiness.test.mjs` ← `tests/unit/map-visual-frame.test.mjs`, `tests/unit/map-visual-order.test.mjs`, `tests/unit/map-content-presentation.test.mjs`, `tests/unit/map-render-coordinator.test.mjs`
- `tests/unit/map-display-client.test.mjs` ← `tests/unit/map-display-menu-state.test.mjs`, `tests/unit/map-host.test.mjs`
- `tests/unit/core-hydro-create-wasm.test.mjs` ← `tests/unit/core-hydro-hidden-source-wasm.test.mjs`, `tests/unit/core-hydro-copy-history-wasm.test.mjs`
- `tests/unit/core-document-world-wasm.test.mjs` ← `tests/unit/core-document-batch-wasm.test.mjs`, `tests/unit/core-document-field-wasm.test.mjs`, `tests/unit/core-document-flag-wasm.test.mjs`, `tests/unit/core-document-view-selection-wasm.test.mjs`, `tests/unit/core-empty-document-wasm.test.mjs`
- `tests/unit/hydro-packfile.test.mjs` ← `tests/unit/hydro-packfile-builder.test.mjs`, `tests/unit/hydro-pack-layout.test.mjs`

## Planned browser feature owners

- `tests/browser/web-viewer.spec.mjs` ← `tests/browser/viewer-layout.spec.mjs`, `tests/browser/phone-landscape-surface-contract.spec.mjs`, `tests/browser/viewer-search-responsive.spec.mjs`, `tests/browser/viewer-globe-only.spec.mjs`
- `tests/browser/viewer-calendar.spec.mjs` ← `tests/browser/viewer-temporal-regressions.spec.mjs`, `tests/browser/temporal-map-presentation.spec.mjs`, `tests/browser/resource-dependency-reuse.spec.mjs`
- `tests/browser/terrain-zoom-continuity.spec.mjs` ← `tests/browser/terrain-inheritance.spec.mjs`, `tests/browser/terrain-progressive.spec.mjs`, `tests/browser/terrain-request-priority.spec.mjs`, `tests/browser/terrain-interaction-streaming.spec.mjs`
- `tests/browser/terrain-preview.spec.mjs` ← `tests/browser/terrain-preview-quality.spec.mjs`, `tests/browser/terrain-ocean-loading.spec.mjs`
- `tests/browser/viewer-renderer-recovery.spec.mjs` ← `tests/browser/gpu-scene-staging.spec.mjs`, `tests/browser/country-border-coverage.spec.mjs`
- `tests/browser/viewer-boundary-p4-5.spec.mjs` ← `tests/browser/korean-boundaries.spec.mjs`, `tests/browser/viewer-temporal-boundary-worker-rollback.spec.mjs`, `tests/browser/viewer-w2-p3-packet-reuse.spec.mjs`
- `tests/browser/viewer-review-e4.spec.mjs` ← `tests/browser/viewer-inspector.spec.mjs`
- `tests/browser/hydro-sdf-webgl.spec.mjs` ← `tests/browser/canvas-hydro-picking.spec.mjs`
- `tests/browser/viewer-startup-and-terrain.spec.mjs` ← `tests/browser/physical-land-time.spec.mjs`
- `tests/browser/viewer-project-open.spec.mjs` ← `tests/browser/viewer-canvas.spec.mjs`

## Obsolete inspection-only tests proposed for removal

- `tests/unit/web-draft-contract.test.mjs`
- `tests/unit/web-history-selection-contract.test.mjs`
- `tests/unit/web-flag-contract.test.mjs`
- `tests/unit/web-opaque-flag-contract.test.mjs`
- `tests/unit/web-selection-contract.test.mjs`
- `tests/unit/web-content-dirty-contract.test.mjs`
- `tests/unit/web-writer-clock-contract.test.mjs`
- `tests/unit/r4e2-core-gis-boundaries.test.mjs`
- `tests/unit/p7-retirement-closure.test.mjs`
- `tests/unit/p5-6-performance-review.test.mjs`
- `tests/unit/p3-presentation.test.mjs`
- `tests/unit/application-source-extraction.test.mjs`
- `tests/unit/hydro-batch03-receipt.test.mjs`

## Scope boundaries

Phase 1 is classification only; phases 2–4 implement the reviewed dispositions. This is intentionally more conservative than the aspirational 200–300 unit files because combining unrelated native tests would increase affected CI scope before the dependency planner is redesigned in phase 5.
