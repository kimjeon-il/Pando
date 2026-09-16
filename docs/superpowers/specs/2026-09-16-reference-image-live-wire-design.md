# Reference Image Live-Wire Design

## Goal
Add a semi-automatic `자동 추적` tool for georeferenced reference images. The user clicks a first anchor on a visible image boundary, moves the pointer to preview the cheapest edge-following path, clicks to commit segments, and finishes with Enter or double-click before applying the resulting line to the existing draft editing flow.

## Interaction
- `자동 추적` is a separate tool from `선 보강`.
- It is enabled only when a reference image is selected, unlocked, and has a valid georeference warp.
- Left click: place first anchor or commit current segment.
- Pointer move: update live preview from active anchor to cursor.
- Backspace or Ctrl+Z: remove the last committed segment/anchor.
- Enter: finish and enter preview-ready state.
- Double-click: commit current segment and finish.
- Escape: cancel the whole live-wire session.
- Preview-ready actions: Apply, Redraw, Cancel.
- Applying uses `__PANDOLAB_REFERENCE_IMAGE_EDITING__` and therefore preserves the existing draft/preview workflow.

## Image analysis
Reuse the existing cached reference-image Sobel analysis. Extend the cached field to retain normalized Sobel X/Y components as well as gradient magnitude. Images remain downscaled to a maximum analysis dimension of 1024 px.

## Live-wire algorithm
- Internal coordinates are analysis-image pixels.
- Initial and subsequent anchors snap to the strongest nearby edge within an 8 px analysis radius.
- Build a local shortest-path tree with Dijkstra from the active anchor inside a bounded search box (default half-size 384 analysis px).
- 8-neighbor graph.
- Edge traversal cost combines:
  - gradient cost (dominant): prefer stronger edges;
  - direction cost: prefer motion along the local edge tangent;
  - turn cost: discourage zig-zagging;
  - weak cursor corridor bias: prefer paths roughly consistent with the user's intended direction without overriding strong boundaries.
- Pointer movement only backtracks the already-built parent tree where possible; when the target is outside the current local tree, rebuild around the anchor with a target-aware box/corridor.
- Return an explicit failure for unusably weak imagery or unreachable targets.

## Coordinate conversion
Screen pointer -> renderer `hitTestUv()` bridge -> source UV -> analysis pixel. Final segment pixels -> source pixels/UV -> existing `warp.project()` -> lon/lat -> existing draft bridge.

## Geometry output
Committed segments are stored separately so anchors are preserved. On finish, simplify each segment independently with RDP (default 1.5 source px), concatenate without duplicate anchor points, then project to lon/lat.

## UI rendering
Use a dedicated map overlay canvas. Draw committed path, current preview path, and anchor markers. Throttle pointer preview rendering with `requestAnimationFrame()`.

## Session invalidation
Cancel the session if the selected reference image changes, the image becomes locked, georeferencing becomes invalid, the panel closes, or another incompatible reference-image interaction starts.

## Scope
This version does not include ML segmentation, fully autonomous tracing to an unknown endpoint, Web Worker execution, or new persistent data formats. Only final lon/lat draft coordinates persist.

## Tests
Unit tests cover anchor snapping, straight/curved edge tracking, distant-edge avoidance/cursor bias, weak-image failure, direction field generation, undo-safe segment joining, and projection conversion. Browser regression covers ready/locked gating, start/cancel, live preview, segment commit/undo, finish, and apply into the existing draft bridge.
