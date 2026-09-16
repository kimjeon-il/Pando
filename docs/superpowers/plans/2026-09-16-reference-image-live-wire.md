# Reference Image Live-Wire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an anchor-based live-wire edge tracer for georeferenced reference images and apply the traced line through the existing draft editing bridge.

**Architecture:** Add a live-wire-specific cached Sobel field that retains magnitude plus signed X/Y direction, a pure `reference-image-live-wire.js` shortest-path module, and a dedicated controller/canvas. Reuse the existing renderer hit-test bridge, georef warp, reference-image store, coordinate projection helper, and draft editing bridge without changing the existing `선 보강` field contract.

**Tech Stack:** Browser ES modules, Canvas 2D, TypedArray, Node `node:test`, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-09-16-reference-image-live-wire-design.md`

## Global Constraints
- Work only on `feature/georeferenced-image-overlays`; do not modify `main`.
- No ML model or new dependency.
- Analysis maximum dimension remains 1024 px.
- Final persisted geometry remains lon/lat coordinates only.
- Preserve existing `선 보강` behavior.

---

### Task 1: Pure direction-aware live-wire engine

**Files:**
- Create: `assets/js/modules/reference-image-live-wire.js`
- Create: `tests/unit/reference-image-live-wire.test.mjs`

**Interfaces:**
- `buildReferenceImageLiveWireField(imageData, options) -> field`
- `getReferenceImageLiveWireField(image, { maxDimension = 1024 }) -> field`
- `snapLiveWireAnchor(field, point, { radius = 8 }) -> [x,y]`
- `buildLiveWireTree(field, anchor, options) -> tree`
- `traceLiveWirePath(tree, target, options) -> { ok, reason, points, meanEdgeStrength }`
- `simplifyLiveWireSegments(segments, { tolerance = 1.5 }) -> points`
- `analysisPointFromUv(field, uv) -> [x,y]`
- `sourcePixelsFromAnalysis(field, points) -> [[x,y], ...]`

- [x] Add failing tests for signed Sobel directions, anchor snap, curved-edge following, target-direction/corridor preference, weak-image rejection, anchor-preserving simplification, and coordinate conversion.
- [x] Run the focused test before implementation and confirm RED (`ERR_MODULE_NOT_FOUND`).
- [x] Implement cached Sobel analysis and bounded 8-neighbor Dijkstra with gradient/direction/turn/cursor-bias cost and parent backtracking.
- [x] Run focused live-wire tests and confirm 7/7 pass.
- [x] Commit test before implementation, then commit implementation.

### Task 2: Live-wire interaction controller

**Files:**
- Create: `assets/js/modules/reference-image-live-wire-controller.js`
- Modify: `assets/js/modules/reference-image-bootstrap.js`
- Modify: `assets/css/features/reference-images.css`

**Interfaces:**
- Global debug API: `__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__` with `active()`, `phase()`, `segmentCount()`, `previewPointCount()`, `cancel()`, `requestRender()`, `destroy()`.
- Reuses `__PANDOLAB_REFERENCE_IMAGE_HIT_TEST_UV__` and `__PANDOLAB_REFERENCE_IMAGE_EDITING__`.

- [x] Add a browser regression before controller wiring that expects `자동 추적` controls and ready/locked gating.
- [x] Implement source loading, hit-test/UV conversion, cached edge analysis, anchor placement, target-aware tree construction, RAF-throttled preview, click segment commit, Backspace/Ctrl+Z undo, Enter/double-click finish, Apply/Redraw/Cancel, invalidation on lock/selection/georef/panel changes, and overlay rendering.
- [x] Wire the controller from bootstrap and add crosshair CSS.
- [x] Block `자동 추적` while GCP placement, placement editing, or `선 보강` is active; disable conflicting controls while live-wire is active.
- [x] Run `node --check` on the new engine/controller.
- [x] Run a 512×512 synthetic performance probe (field ~29 ms, local Dijkstra ~49 ms, backtrack ~0.5 ms in the available container).

### Task 3: Browser apply regression and final verification

**Files:**
- Create: `tests/browser/reference-image-live-wire.spec.mjs`

**Interfaces:**
- The browser test replaces the draft bridge with a capture stub only at the integration boundary while exercising reference-image UI, georef, edge analysis, live-wire state transitions, undo, finish, and apply.

- [x] Add regression steps for ready/locked gating, start/cancel, first anchor, live preview, commit, Backspace undo, recommit, finish, apply, and coordinate delivery.
- [ ] Run the focused Playwright test in a full repository checkout/browser environment.
- [ ] Run the repository's full test suite.
- [x] Compare against pre-live-wire head `727f05531ee8b06410cc6f5193b9c723e62d12b5`; only intended live-wire files/docs/tests plus bootstrap/CSS changed.
- [x] Confirm all writes targeted `feature/georeferenced-image-overlays`; `main` was not targeted.
- [x] Check current feature HEAD for CI statuses/workflow runs; none are attached because there is no open PR and the existing workflows do not run this branch on push.
