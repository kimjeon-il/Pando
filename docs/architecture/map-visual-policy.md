# Common map visual policy — M4 and M5

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
