# Reference Image Live-Wire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an anchor-based live-wire edge tracer for georeferenced reference images and apply the traced line through the existing draft editing bridge.

**Architecture:** Extend the existing Sobel cache with X/Y direction components, add a pure `reference-image-live-wire.js` shortest-path module, and add a dedicated controller/canvas for user interaction. Reuse the existing renderer hit-test bridge, georef warp, reference-image store, and draft editing bridge.

**Tech Stack:** Browser ES modules, Canvas 2D, TypedArray, Node `node:test`, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-09-16-reference-image-live-wire-design.md`

## Global Constraints
- Work only on `feature/georeferenced-image-overlays`; do not modify `main`.
- No ML model or new dependency.
- Analysis maximum dimension remains 1024 px.
- Final persisted geometry remains lon/lat coordinates only.
- Preserve existing `선 보강` behavior.

---

### Task 1: Direction-aware edge field

**Files:**
- Modify: `assets/js/modules/reference-image-line-refiner.js`
- Modify: `tests/unit/reference-image-line-refiner.test.mjs`

**Interfaces:**
- Produces: gradient field properties `gradientX: Float32Array`, `gradientY: Float32Array` normalized consistently with `gradient`.

- [ ] Add a failing unit test asserting Sobel X/Y components exist and indicate the expected normal direction on a vertical synthetic edge.
- [ ] Run the focused unit test and confirm failure because direction arrays are absent.
- [ ] Store normalized Sobel X/Y arrays while preserving existing `gradient` semantics and cache behavior.
- [ ] Run the existing line-refiner test file and confirm all tests pass.
- [ ] Commit.

### Task 2: Pure live-wire algorithm

**Files:**
- Create: `assets/js/modules/reference-image-live-wire.js`
- Create: `tests/unit/reference-image-live-wire.test.mjs`

**Interfaces:**
- `snapLiveWireAnchor(field, point, { radius = 8 }) -> [x,y]`
- `buildLiveWireTree(field, anchor, options) -> tree`
- `traceLiveWirePath(tree, target, options) -> { ok, reason, points, meanEdgeStrength }`
- `simplifyLiveWireSegments(segments, { tolerance = 1.5 }) -> points`
- `analysisPointFromUv(field, uv) -> [x,y]`
- `sourcePixelsFromAnalysis(field, points) -> [[x,y], ...]`

- [ ] Add failing tests for anchor snap, curved-edge following, target-direction/corridor preference at a branch, weak-image rejection, and segment simplification preserving anchors.
- [ ] Run tests and confirm the module import/behaviors fail.
- [ ] Implement bounded 8-neighbor Dijkstra with gradient/direction/turn/cursor-bias cost and parent backtracking.
- [ ] Run focused live-wire tests and line-refiner tests; confirm green.
- [ ] Commit.

### Task 3: Live-wire interaction controller

**Files:**
- Create: `assets/js/modules/reference-image-live-wire-controller.js`
- Modify: `assets/js/modules/reference-image-bootstrap.js`
- Modify: `assets/js/modules/reference-image-line-refine-controller.js`
- Modify: `assets/css/features/reference-images.css`

**Interfaces:**
- Global debug API: `__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__` with `active()`, `phase()`, `cancel()`, `requestRender()`, `destroy()`.
- Reuses `__PANDOLAB_REFERENCE_IMAGE_HIT_TEST_UV__` and `__PANDOLAB_REFERENCE_IMAGE_EDITING__`.

- [ ] Add a browser regression test that expects the `자동 추적` controls and ready/locked gating; verify it fails before controller wiring.
- [ ] Implement source loading, hit-test/UV conversion, cached edge field acquisition, anchor placement, tree construction, RAF-throttled preview, click segment commit, Backspace/Ctrl+Z undo, Enter/double-click finish, Apply/Redraw/Cancel, invalidation on lock/selection/georef/panel changes, and overlay rendering.
- [ ] Wire the controller from bootstrap and add crosshair CSS.
- [ ] Make `선 보강` and `자동 추적` mutually exclusive; remove the duplicate `redraw()` definition already present in the line-refine controller while touching that file.
- [ ] Run syntax checks and focused browser/unit tests.
- [ ] Commit.

### Task 4: Browser apply regression and final verification

**Files:**
- Modify/Create: `tests/browser/reference-image-live-wire.spec.mjs`

**Interfaces:**
- The browser test may replace the draft bridge with a capture stub only at the integration boundary, while exercising real reference-image UI, georef, hit testing, edge analysis, and live-wire controller behavior.

- [ ] Extend the browser test to trace a synthetic high-contrast boundary, commit a segment, undo/recommit, finish, apply, and verify lon/lat coordinate delivery.
- [ ] Run all reference-image unit tests plus the focused Playwright specs.
- [ ] Compare the feature branch against its pre-live-wire head and verify only intended files changed.
- [ ] Confirm `main` was not targeted by any write.
- [ ] Commit any final test stabilization only if needed.
