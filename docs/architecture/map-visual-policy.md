# Common map visual policy — M4, M5 and M6

## M4: visual order

`layer-presentation.js` owns an immutable visual role table. It is presentation
policy and adds no project fields, controller, render loop or geometry owner.
GPU base passes, Canvas Worker/direct fallback passes, selection stroke channels,
interaction fill priorities, SVG interaction layers and overlay packet ordering
derive their sequence from this policy. Labels remain the top SVG presentation.

Canvas paints country fills before territorial fills. GPU claims territorial
pixels before country pixels using its existing stencil: these opposite submission
orders implement the same visible territorial owner. Independent overlays retain
their existing group/object order and their base water/border protection. The
policy therefore represents this mixed overlay domain explicitly; it does not
flatten every object's fill and stroke into separate global queues.

Hydro uses lake fill, lake boundary, river, then border river on all paths. Canvas
Worker receives the current derived policy in its production scene message; it
does not import an ESM controller or maintain a second rule. SVG hover and
selection move into the existing interaction root with preview, handles, draft,
snap and labels. Existing layer references, masks and single-owner suppression
remain in use. GPU front-to-back fill claims and M3 stroke staging are unchanged.

### M4 execution evidence (2026-10-06)

- Remote main checked at execution: `e76857ae11b32ca9edb6da8beb1569e6308df598`.
- M4 parent / retained M3 checkpoint: `5b11879f82efe8aac324e31d60be2bccfbcf7aee`.
- Branch/worktree: `codex/m2-preview-handoff`; no main merge or deployment.
- Candidate SHA and exact source/evidence hashes: `test-results/m4-delivery.json`,
  generated after the M4 checkpoint commit. M5 is a separate successor checkpoint.
- RED: `node --test tests/unit/map-visual-order.test.mjs`: 0 pass, 1 fail, 0 skip.
- Focused units: 64 pass, 0 fail, 0 skip. Command:
  `node --test tests/unit/map-visual-order.test.mjs tests/unit/gpu-base-scene-order.test.mjs tests/unit/gpu-prepared-draw.test.mjs tests/unit/interaction-roles.test.mjs tests/unit/map-interaction-style.test.mjs tests/unit/gpu-scene-staging.test.mjs tests/unit/render-channel-ownership.test.mjs tests/unit/selection-overlay-plan.test.mjs`.
  Final log: `test-results/m4-final-unit64.log`.
- Actual Canvas Worker/WebGL pixel and SVG interaction-root order regression:
  `pnpm exec playwright test tests/browser/renderer-migration-gaps.spec.mjs --grep='Canvas receives' --output=test-results/m4-accepted-pixels`:
  1 pass, 0 fail, 0 skip; log `test-results/m4-accepted-pixels.log`.
- WebGL real selection pixels and GPU/SVG owner suppression passed in
  `test-results/m4-selection-retry.log` (1 pass); its Canvas case failed before
  the protection scope repair. This is not a two-test passing run.
- Final Canvas SVG selection UI (selection, flat/globe transition, no duplicate outline):
  `pnpm exec playwright test tests/browser/selection-interaction-style.spec.mjs --grep='renderer fallback draws a single' --output=test-results/m4-svg-accepted`: 1 pass, 0 fail, 0 skip.
- Changed-file ESLint: 17 files, exit 0; scoped workflow YAML: 1 pass; `git diff --check`: exit 0.
- Earlier UI startup failures included a shared Playwright server shutting down while a concurrent command still fetched the canonical mesh (`Failed to fetch`). Final UI command used its own port, 4187. The SVG fixture now supplies its expected selection color explicitly; current default accent is blue.
- Review found Canvas phases bypassing policy dispatch. Moving those operations
  into the dispatch initially scoped the protection mask too narrowly; ESLint and
  the Canvas UI caught it. The mask now remains available to both overlay and
  emphasis painting. Earlier failures/logs are retained, not deleted or skipped.

Full suite, broad architecture checks, deployment and remote CI execution were
not run. The scoped CI job covers these focused regressions and uploads evidence.
M4 proves order/ownership in the checked paths, not whole-map temporal continuity;
M6 frame audit and M7 end-to-end/full verification remain outstanding.

## M5: CSS stroke policy

`map-interaction-style.js` now resolves current base and interaction stroke roles
through `resolveMapStrokeStyle`. Current callers/tests replace the retired
`interactionRoleStyle` API; no alias, wrapper or second policy is retained.
Country, internal country, subunit, subunit-internal, region, generic,
distribution, river, lake boundary, hover, selection and direct editing use this
policy. The current fixed layer widths, colors, role priorities and dash patterns
remain; no width setting or persistence/model API is added.

Policy widths, dash lengths and casing/cutout widths are CSS pixels. View scaling
uses `MapVisualFrame.cssScale`, independent of DPR. The GPU stroke boundary scales
these values once by DPR; hydro ribbons/picking and native country line submission
use the same CSS-to-device boundary. SVG primary/secondary and direct boundary
editing use the same resolved CSS styles. Shared boundary editing retains its
`[6,3]` dash. The obsolete SVG boundary CSS widths are removed from the source and
`node scripts/build-ui-bundle.mjs` regenerates the bundle.

Country shared batches apply effective per-owner opacity exactly once. Their
theme ink is unmultiplied; native and pending country outlines use the resolved
`borderAlpha`. A production theme/packet regression verifies opacity 0.5 produces
0.46 on all these paths instead of 0.23 or 0.92.

### M5 execution evidence (2026-10-06)

- M5 parent / fixed M4 checkpoint: `c6c62664fdae5b39ed8f839411cce5d3dba13a14`.
- Candidate SHA, exact source/evidence hashes and command results:
  `test-results/m5-delivery.json`, generated after the M5 commit.
- Initial policy RED: 0 pass, 3 fail, 0 skip (`test-results/m5-red.log`).
- Actual GPU RED: 6 CSS px at DPR 1 became 3 CSS px at DPR 2
  (`test-results/m5-dpr-red.log`); current pixels are 6 at both DPRs.
- Production opacity RED: shared 0.23 versus expected 0.46; review exposed a
  pending-packet regression, 0.92 versus 0.46. Both production paths now pass
  (`test-results/m5-opacity-red.log`, `m5-pending-opacity-red.log`,
  `m5-opacity-final.log`).
- Review also exposed unscaled SVG coast/shared editing. A real D3/SVG production
  rendering-domain test at DPR 2/overview zoom, with selection outlines disabled,
  failed before the repair and now matches the edited GPU packet's path, color,
  width, alpha and shared dash (`m5-boundary-red.log`, `m5-boundary-accepted.log`).
  The test checks exact SVG width and computed width; CSSOM's six-significant-digit
  formatting is accounted for separately.
- Final focused unit command: 123 pass, 0 fail, 0 skip, exit 0:
  `node --test tests/unit/map-stroke-style.test.mjs tests/unit/map-interaction-style.test.mjs tests/unit/interaction-roles.test.mjs tests/unit/country-shared-boundary.test.mjs tests/unit/territorial-boundary-continuity.test.mjs tests/unit/edit-preview-presentation.test.mjs tests/unit/edit-preview-controller.test.mjs tests/unit/map-visual-order.test.mjs tests/unit/gpu-base-scene-order.test.mjs tests/unit/gpu-prepared-draw.test.mjs tests/unit/gpu-scene-staging.test.mjs tests/unit/gpu-stroke-renderer.test.mjs tests/unit/selection-overlay-plan.test.mjs tests/unit/render-channel-ownership.test.mjs`.
  Log: `test-results/m5-final-units.log`.
- `pnpm exec playwright test tests/browser/renderer-migration-gaps.spec.mjs --grep='shared stroke policy|multiply strokes|Canvas receives' --output=test-results/m5-stroke-pixels`:
  3 pass, 0 fail, 0 skip. Covers actual DPR width, multiply/AA pixels and production
  Canvas Worker/WebGL mixed overlay pixels; `test-results/m5-stroke-pixels.log`.
- `pnpm exec playwright test tests/browser/selection-interaction-style.spec.mjs --grep='WebGL2 country selection|renderer fallback draws a single' --output=test-results/m5-selection-ui`:
  2 pass, 0 fail, 0 skip. Actual GPU selection pixels/single visual owner and SVG
  fallback widths through flat/globe transitions; `test-results/m5-selection-ui.log`.
- `pnpm exec playwright test tests/browser/edit-preview-handoff.spec.mjs --grep='river hands.*outlines on' --output=test-results/m5-edit-ui`:
  2 pass, 0 fail, 0 skip. Actual WebGL2/Canvas UI edits, production Worker/file
  path, last coordinates, matching committed geometry/display frame, one history
  step and Undo/Redo; `test-results/m5-edit-ui.log` and its JSON evidence.
- `pnpm exec playwright test tests/browser/renderer-migration-gaps.spec.mjs --grep='boundary edit SVG' --output=test-results/m5-boundary-accepted`:
  1 pass, 0 fail, 0 skip. Browser role fallback evidence described above.
- Changed JavaScript/test ESLint: 18 files, exit 0
  (`test-results/m5-final-eslint.log`); focused workflow YAML: 1 pass;
  `git diff --check`: exit 0. Scoped CI includes current M4/M5 dependencies,
  regressions and evidence upload. Remote CI was not executed.

### Limits

The existing native `GL_LINES` country path still obeys the driver's supported
line-width range; requesting the common width does not establish identical
subpixel rasterization on every driver. This work does not replace that geometry
or GPU resource path. General frame enforcement (M6), whole-map continuity,
terrain continuity, every editing-tool/browser combination and the final full
regression (M7) are not claimed. Full suite/broad architecture checks, main merge,
deployment and packaging were not run. Saving, time semantics and activation
policy are unchanged.

## M6: one frame for visual projection

The existing coordinator prepares one view snapshot for every render request,
including overlay-only style requests. `rendering-domain.js` rejects a missing or
unbranded frame at its frame boundary. SVG geometry, points, labels, country patch
paths and the globe shell consume its path/coordinate projectors and CSS values;
they no longer read live projection fallbacks. Label layout uses the frame's
scale, zoom, viewport and safe insets. It does not start a second projection pass.

Frame preparation captures the renderer's existing adaptive DPR policy and raw
source DPR separately. GPU/Canvas backing dimensions use the captured render DPR;
terrain source resolution uses the captured source DPR. `MapVisualFrame` gains a
`createCanvasPath(context)` capability, wired to the same snapshot projection as
its SVG path. Direct Canvas drawing and its protection mask use that capability.
The Canvas Worker receives the current `renderProjection` contract exclusively
from the frame, including translation, scale, viewport, safe inset and revisions.
Project generation zero is retained instead of replaced by a truthy fallback.

Canvas initialization before the first coordinator frame creates transport and
scene state without fabricating a view. View requests wait for a frame; hydro
viewport requests also wait for a snapshot. Country data completion, patch
previews, territorial/generic merge targets, hydro initialization and audit
changes request the coordinator instead of invoking a renderer without a frame.
Obsolete public direct rendering methods are removed with their callers and tests.
The existing domain, preview controller, scene staging and frame acceptance
owners remain unchanged. No model or persistence API is changed.

Live projection reads remain in canonical view preparation, pointer inversion,
hit/query operations and viewport data loading (`placeView`). These are input or
loading operations, not an alternate visual renderer. Their results are rendered
through the coordinator frame. M6 does not merge terrain/object LOD or introduce
a new renderer, resource owner or render loop.

### M6 execution evidence (2026-10-06)

- Remote main: `e76857ae11b32ca9edb6da8beb1569e6308df598`.
- Fixed parent / M5: `385141b9946bd91e1a740f5ef6fe1ad2daa0d1d9`.
- Branch/worktree remains `codex/m2-preview-handoff`. The exact M6 candidate,
  committed source hashes and execution artifacts are recorded after commit in
  `test-results/m6-delivery.json`. Older stage evidence is preserved.
- RED: focused frame consumer regression: 0 pass, 2 fail, 0 skip
  (`test-results/m6-red.log`). It reproduces accepting a missing frame and
  evaluating live projection even when a valid frame is supplied. Final coverage
  also exercises the real renderer's DPR cap through production frame preparation.
- Final focused units: 139 pass, 0 fail, 0 skip (`m6-final-units.log`):
  `node --test tests/unit/visual-frame-consumers.test.mjs tests/unit/map-visual-frame.test.mjs tests/unit/map-render-coordinator.test.mjs tests/unit/map-label-visibility.test.mjs tests/unit/edit-preview-presentation.test.mjs tests/unit/territorial-boundary-continuity.test.mjs tests/unit/domain-split-contract.test.mjs tests/unit/editing-render-packet.test.mjs tests/unit/distribution-selection.test.mjs tests/unit/label-shell-performance.test.mjs tests/unit/gpu-hydro-preparation.test.mjs tests/unit/gpu-renderer-lifecycle.test.mjs tests/unit/country-mesh-zoom-runtime.test.mjs tests/unit/country-shared-boundary.test.mjs tests/unit/app-map-audit.test.mjs`.
- WebGL2, Canvas Worker and forced direct Canvas UI: frame IDs/revisions, globe
  circle coordinates/radius, backing dimensions, real Worker projection payloads,
  rotation/zoom and flat/globe transitions:
  `pnpm exec playwright test tests/browser/visual-frame-sync.spec.mjs --output=test-results/m6-accepted-frames`.
  3 pass, 0 fail, 0 skip (`m6-accepted-frames.log`); per-backend
  `M6-view-frame-proof.json` files are included in the delivery manifest.
- Actual river editing in WebGL2 and Canvas, production Workers, moved line,
  committed geometry, one history step and Undo/Redo: 2 pass, 0 fail, 0 skip:
  `pnpm exec playwright test tests/browser/edit-preview-handoff.spec.mjs --grep='river hands.*outlines on' --output=test-results/m6-edit-ui`.
  Log: `m6-edit-ui.log`; per-backend handoff JSONs are retained.
- Changed JS/test ESLint: 25 files, exit 0 (`m6-final-eslint.log`); focused CI YAML
  parse/path/job checks: 1 pass (`m6-workflow.log`); diff check: exit 0.
- Review identified stale numeric Canvas calls, a Worker projection-field
  mismatch and direct country/merge rendering callbacks. These are repaired at
  their current owners; the retired paths are removed rather than aliased.
  Earlier failures (`m6-focused-first.log`, `m6-visual-frames.log`) are retained.
  The first Canvas UI assertion compared an accepted old frame with a newly
  requested zoom; it now waits for matching view revision before comparing actual
  geometry values. Direct Canvas startup also caught a missing frame in country
  patch publication; its async callback now invalidates the coordinator.

Full suite/broad architecture checks, remote CI, main merge, deployment and
packaging are not run. M7 still owns the final full regression and the complete
drag/Worker/topology/GPU-upload/display continuity proof. This stage establishes
the checked projection/frame consumers, not uninterrupted rendering of every
map element, terrain coverage or driver-independent line rasterization.
