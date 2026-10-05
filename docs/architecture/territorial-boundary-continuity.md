# Territorial boundary continuity (M1)

`rendering-domain.js` owns both territorial boundary topology and its presentation
batches. Its cache is the currently presented topology. `pendingTerritorialBoundary`
is a single preparation candidate; beginning preparation does not clear the cache
or publish an empty scene domain.

A candidate has a unique request identity and a reset epoch. A successful Worker
response stages segments and requests repaint through the existing coordinator.
The next territorial render checks the current input signature and promotes only
the matching candidate. Superseded requests, a return to an earlier input,
project reset and disposal cannot republish an obsolete candidate.

During preparation the old topology is filtered through current entity existence,
layer/item visibility and boundary styles. Removing all polygon children clears
it immediately. An empty successful result clears it when promoted. Unexpected
failures retain the old topology and emit a diagnostic with the technical message
and stack. A failed candidate is not retried every frame; changed input can start
a new candidate. Cancellation invalidates the request without a failure diagnostic
or an automatic retry repaint.

`getTerritorialBoundaryStats()` keeps its existing fields and adds:

- `pendingInputSignature`: candidate input signature, or an empty string.
- `pendingStatus`: `idle`, `preparing`, `ready` or `failed`.

No model API or saved-project format changes are involved.

## Verification scope

The focused units use the current entity store/repository and canonical boundary
topology calculator. They cover staging and promotion, reversed delivery, repeated
inputs, project reset/disposal, deletion/visibility, empty results, failed results,
diagnostics/retry suppression, style-only changes and unchanged project content.

The browser regression creates a real child through the UI, copies it to a region,
creates a nested child and redraws the region through the existing UI. It runs the
production map-edit Worker and delays delivery of its boundary result at
`prepareEditDisplay` for both nested creation and redraw. Test
instrumentation observes scene publication and actual WebGL stroke drawing or
accepted Canvas bitmap presentation. It checks retained topology during rotation
and zoom, waiting for the zoomed frame before rotating so Canvas view coalescing
cannot hide the intermediate projection. It then releases the result and checks
that the final drawn packet contains the newly published boundary coordinates.
Terrain is disabled to isolate this boundary workflow.

Software Chromium exceeded the production client's 3-second initial Worker-ready
deadline during setup on this Windows host. The fixture gives that handshake a
30-second budget; it keeps the production calculator, codec, scheduler and result
path. Product timeouts are unchanged. These focused checks do not verify the
production 3-second cold-start requirement.

Run from the worktree root:

```powershell
node --test tests/unit/territorial-boundary-continuity.test.mjs tests/unit/domain-split-contract.test.mjs tests/unit/empty-territorial-boundary.test.mjs tests/unit/render-channel-ownership.test.mjs
pnpm.cmd exec playwright test tests/browser/territorial-boundary-continuity.spec.mjs
pnpm.cmd exec eslint assets/js/modules/rendering-domain.js tests/unit/territorial-boundary-continuity.test.mjs tests/unit/domain-split-contract.test.mjs tests/browser/territorial-boundary-continuity.spec.mjs
```

The existing Application Architecture workflow contains a path-scoped
`boundary-continuity` job with these checks and browser evidence upload.

## Execution evidence (2026-10-05)

- Base: `f80de2493a012df198fde1bcadf2289d841d4220`, verified remote main.
- Branch: `codex/m1-boundary-continuity`, isolated worktree.
- Previous terrain branch at `fa37a22` preserved separately.
- Initial regression: 3 passed, 13 failed, 0 skipped, reproducing premature
  clearing and invalidation defects before the product change.
- Focused final units: 50 passed, 0 failed, 0 skipped.
- Final browser checks used the same spec in separate renderer runs:

  | Command | Passed | Failed | Skipped |
  | --- | ---: | ---: | ---: |
  | `pnpm.cmd exec playwright test tests/browser/territorial-boundary-continuity.spec.mjs --grep '^webgl2'` | 1 | 0 | 0 |
  | `pnpm.cmd exec playwright test tests/browser/territorial-boundary-continuity.spec.mjs --grep '^canvas'` | 1 | 0 | 0 |

  Each case exercises both nested child creation and region redraw. The Windows
  runs used `PANDOLAB_TEST_PORT=4209` and `4208` respectively. Test output and
  screenshots are retained locally under ignored `test-results/m1-webgl-sequential`
  and `test-results/m1-canvas-sequential`; logs have matching `.log` names.

  | Renderer / phase | Retained drawing frames | Distinct view revisions |
  | --- | ---: | ---: |
  | WebGL2 / child-create | 10 | 6 |
  | WebGL2 / region-redraw | 20 | 6 |
  | Canvas / child-create | 4 | 3 |
  | Canvas / region-redraw | 2 | 2 |

  All recorded boundary scene publications during the hold remain nonempty.
  Observed boundary drawing frames contain drawable packets; WebGL2 recorded no
  missing boundary resource keys. Canvas checks accepted bitmap frames and their actual
  boundary coordinates, rather than certifying GPU upload behavior. Final drawn
  coordinates match the promoted scene in both paths. Pending/completed captures
  also show the retained outline and subsequent replacement.
- Changed-file ESLint: exit 0, no errors.
- CI YAML parsing and focused-job wiring assertions: passed locally.
- `git diff --check`: passed.

An earlier browser attempt passed WebGL2 but failed the Canvas multiple-view
assertion because fast camera changes coalesced into one displayed view. The
fixture now waits for each actual presentation and retains the original assertion.
The final runs above supersede that failed attempt.

M1 verifies the boundary topology preparation interval and its next-render
promotion. Edit preview handoff (M2) and GPU resource replacement (M3) remain
separate work. This evidence does not claim frame-perfect GPU upload continuity,
terrain repair, style/layer unification, a full-suite pass or a live release.
Remote CI, main integration and deployment are not part of this execution.
