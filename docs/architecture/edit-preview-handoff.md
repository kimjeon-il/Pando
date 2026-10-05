# Direct edit preview handoff (M2)

The existing edit preview controller owns one geographic stroke session. Ending
a drag freezes its last coordinates while the existing computation and display
paths prepare a successor. Rendering releases that stroke only after the same
session/revision or committed object geometry is presented in a MapVisualFrame.

## Ownership and lifetime

- `edit-preview-controller.js`: `dragging`, `pending-result`, `successor-ready`,
  then release; monotonically increasing session IDs and project generation.
- `editing-domain.js`: gesture replacement, cancellation/reset/disposal and one
  detached object geometry transaction. The internal presentation refresh now
  also invalidates object vertex packets when the canonical selection changes.
- `app-domain-assembly.js`: boundary/coastline retain the stroke across both
  `boundary-move` and `territorial-edit`. Preview packets carry session ID,
  revision and old/new boundaries, including area-preserving shared-border moves.
  Hydro moves update one stroke session and commit one history snapshot only
  after validation succeeds; a click or return to the original coordinate
  preserves dirty/history/redo state.
- `rendering-domain.js`: the existing GPU coverage and SVG ownership paths
  establish successor presentation. Worker completion or packet construction
  alone does not release a preview. Canvas interaction, view and country frame
  submissions use the existing accepted-frame queue before their SVG overlays
  can acknowledge it. A later redraw that supersedes an interaction submission
  must also enter that queue; otherwise an accepted successor could be lost.
  Submitting another frame at the same view/projection must not discard a
  still-current frame that the Canvas transport actually displays. Its identity
  is retired after acceptance; incompatible views/generations are discarded.
  A shell/label-only commit must not retire any still-pending earlier bitmap.
  Every new boundary row must have healthy current-frame stroke coverage; an
  unrelated ownership descendant cannot retire the moved line. SVG paths must
  match the current frame projection. With selection outlines disabled, the
  existing vertex editing layer owns a committed hydro editing stroke, rather
  than treating vertex dots as proof that the replacement line was painted.

Tool/target change, hidden/deleted target, reset/dispose, invalid/no-change result
or cancellation removes the attempted direct stroke. A stale reply cannot update
or retire a newer session. Hard GPU errors, missing coverage and deferred
submissions are not successor presentation. Error boundaries preserve the
technical error and stack. Pending presentation adds no project/history item.
Object drags revalidate the current source identity, geometry identity/revision,
visibility and lock policy during movement and before committing. A hidden,
deleted, replaced, newly locked or externally revised target cannot publish the
detached drag or add a history item. Hidden hydro has no editing handles.

This change does not alter the project format or model APIs. Terrain, visual
style/layer ordering, main body geometry staging and GPU resource replacement are
outside M2. Direct stroke handoff is not whole-map or upload continuity (M3).

## Verification and evidence

Base: `e76857ae11b32ca9edb6da8beb1569e6308df598`, verified remote main at
execution start and rechecked during execution. Work is isolated in
`codex/m2-preview-handoff`; the primary checkout and other worktrees/artifacts
remain intact. No main merge or deployment is included.

The delivered candidate is pinned in the final report and local
`test-results/m2-delivery.json`, generated after the final commit. That file
records the exact SHA and hashes of the tested files, commands, logs and evidence.

Local execution: 2026-10-06 KST, Node 24 and pnpm 11.19.0. The workflow uses
Node 22; remote execution of that environment has not been verified.

The focused Node command is the M2 workflow job's 14-file list. The complete
unit suite is not part of this command.

```powershell
node --test tests/unit/edit-preview-handoff.test.mjs tests/unit/edit-preview-presentation.test.mjs tests/unit/edit-preview-controller.test.mjs tests/unit/app-geometry-preview.test.mjs tests/unit/editing-vertex-transaction.test.mjs tests/unit/editing-interaction-events.test.mjs tests/unit/editing-render-packet.test.mjs tests/unit/map-render-coordinator.test.mjs tests/unit/map-visual-frame.test.mjs tests/unit/territorial-boundary-continuity.test.mjs tests/unit/empty-territorial-boundary.test.mjs tests/unit/render-channel-ownership.test.mjs tests/unit/domain-split-contract.test.mjs tests/unit/capability-ports-contract.test.mjs
```

Command to reproduce all focused browser cases:

```powershell
$env:PANDOLAB_TEST_PORT='4212'
pnpm.cmd exec playwright test tests/browser/edit-preview-handoff.spec.mjs --output=test-results/m2-browser-final
```

The initial browser matrix was collected in these two focused invocations:

```powershell
$env:PANDOLAB_TEST_PORT='4212'
pnpm.cmd exec playwright test tests/browser/edit-preview-handoff.spec.mjs --grep=geometry --output=test-results/m2-hydro-accepted
pnpm.cmd exec playwright test tests/browser/edit-preview-handoff.spec.mjs --grep=results --output=test-results/m2-boundary-accepted
```

The latter invocation reproduced one final Canvas shared-boundary failure:
the transport displayed frame 98, while submission of frame 99 at the same view
had already discarded frame 98 from the accepted-frame queue. A new unit RED
reproduced the lost acknowledgement, then passed with the queue correction.
Only the affected Canvas paths were rerun after this final Canvas-only change;
the six WebGL2 cases were already verified and were not unnecessarily repeated.

```powershell
$env:PANDOLAB_TEST_PORT='4212'
pnpm.cmd exec playwright test tests/browser/edit-preview-handoff.spec.mjs --grep=canvas --output=test-results/m2-canvas-final
```

That run exposed two browser sequencing problems before any matching successor
bitmap was accepted: a coastline assertion started its 30-second handoff clock
while the Canvas bitmap was still queued, and a shared-border setup clicked a
prepared projection before the focused view was displayed (selecting DNK rather
than the asserted POL). The test now awaits a real accepted focused view before
target selection, then a real accepted successor frame before the unchanged
handoff/coordinate/revision assertions. The observer records the production
presentation method's return value; it does not invent acceptance. These two
boundary cases alone were rerun after the test sequencing correction:

```powershell
$env:PANDOLAB_TEST_PORT='4212'
pnpm.cmd exec playwright test tests/browser/edit-preview-handoff.spec.mjs --grep=canvas.*results --output=test-results/m2-canvas-boundary-final
```

| Recorded local invocation | Pass | Fail | Skip | Evidence under `test-results/` |
| --- | ---: | ---: | ---: | --- |
| Focused units (14 files, after final correction) | 127 | 0 | 0 | `m2-focused-unit-final.log` |
| Initial river/lake matrix, both renderers, outlines on/off | 8 | 0 | 0 | `m2-hydro-accepted.log`, `m2-hydro-accepted/` |
| Initial coastline/shared-boundary matrix, before final correction | 3 | 1 | 0 | `m2-boundary-accepted.log`, `m2-boundary-accepted/` |
| Canvas paths after product correction, before boundary sequencing correction | 4 | 2 | 0 | `m2-canvas-final.log`, `m2-canvas-final/` |
| Canvas coastline/shared boundary, after accepted-frame sequencing | 1 | 1 | 0 | `m2-canvas-boundary-final.log`, `m2-canvas-boundary-final/` |
| Canvas world shared boundary, after label-only queue correction | 0 | 1 | 0 | `m2-canvas-shared-final.log`, `m2-canvas-shared-final/` |
| Canvas static shared boundary, legal interior vertex | 1 | 0 | 0 | `m2-canvas-static-completion.log`, `m2-canvas-static-completion/` |
| Canvas world shared boundary, completion rerun | 1 | 0 | 0 | `m2-canvas-world-completion.log`, `m2-canvas-world-completion/` |
| Changed-file ESLint (14 files, workflow's exact list) | exit 0 | 0 | 0 | `m2-eslint-final.log` |
| Updated browser observer/static fixture ESLint | exit 0 | 0 | 0 | `m2-browser-eslint-completion.log` |
| Workflow YAML parse and focused job/evidence wiring | 1 | 0 | 0 | `m2-workflow-check.log` |

Initial RED checks reproduced premature direct stroke release. Subsequent
production browser failures exposed a missing lifecycle snapshots dependency,
stale object vertex presentation after selection and Canvas successors omitted
from the accepted-frame queue. Focused regressions also rejected unrelated
partial boundary coverage, stale SVG projection, hidden/deleted/replaced/locked
or revised drag targets and missing outline-off successor strokes. These were
corrected in the existing owners before final verification; assertions were not
removed or skipped. Interrupted intermediate runs are not final passes or skips.
Their diagnostic logs remain local artifacts, including
`m2-canvas-same-view-red.log` and the failing shared boundary's
`handoff-debug.json`/`failure-observations.json` in `m2-boundary-accepted/`.

The final Canvas coastline evidence records accepted frame 93 with both 93 and
94 still in the queue at acceptance. It releases the matching direct stroke in
frame 93 while frame 94 remains pending. This exercises the same-view queue
regression with the production Worker and a real displayed successor.

The remaining startup failure then showed accepted Canvas frames 77/78 missing
from the domain queue. The newly added pruning incorrectly ran on a later
label-only shell commit too. A separate unit RED (`m2-canvas-label-prune-red.log`)
reproduced this introduced regression. Pruning earlier bitmap identities now
runs only after actual Canvas presentation; the focused units and the failed
shared-boundary browser case alone were rerun. Earlier successful browser paths
were not rerun after this final queue cleanup correction. The evidence records
these stages explicitly; it is not a single post-final-change matrix invocation.

The previous world-data shared-border run failed before editing, waiting for the
focused Canvas bitmap. Its failure remains recorded; no product root cause is
inferred from that timeout. The completion rerun passed unchanged, with both
production Worker calculations, geographic projection while pending, and actual
successor-frame handoff. A separate current-schema static file adds a legal
interior shared-border vertex and passed the same assertions. Initial static
setup probes failed selection and rejected an outer endpoint move; they remain
in local logs, rather than being counted as passes. An interrupted static run
has no result and is not a skip.

The completed focused coverage consists of six WebGL2 cases from the earlier
runs and seven Canvas cases (four hydro, coastline, world shared border and
static shared border) from the recorded reruns. This is aggregated per-case
evidence, not thirteen tests from one final-source invocation. The last product
correction is Canvas-only queue retirement; its focused unit regressions and
both shared-border completion cases passed. The user requires M3 through M7 to
continue on this same branch after this M2 commit. Whole-map/GPU-resource
continuity remains outside the completed M2 scope.

The boundary/coastline browser cases drag actual UI handles, compute with the
production map-edit Worker, delay delivery of both results, rotate/zoom while
pending and verify geographic coordinates against the accepted frame's GPU draw
or visible SVG path. The changed point itself must exist in the displayed
successor; another object's line is insufficient. Applying the successor also
checks one history entry.

Hydro cases write the current static exchange fixture through the production
GeoPackage codec, load it with the file UI, select and drag actual river/lake
vertices, check one preview session/history entry, commit geometry identity,
handoff frame, Undo/Redo, and a no-change click preserving redo. Hydro geometry
commit is synchronous; it does not use a fictitious calculation Worker. These
cases check the existing subsequent rendering/presentation path.

The browser observes production modules without substituting calculation or
render results. Its map-edit Worker ready timeout is 30 seconds for cold browser
startup, so this evidence does not certify the production 3-second startup limit.
The Canvas browser backend is `canvas-worker`; synchronous `canvas2d` fallback
was not independently exercised in the browser. Waiting for actual bitmap
acceptance is a test availability budget, not a frame delivery latency guarantee.
Screenshots and geographic/frame/revision records are local ignored artifacts.
The handoff JSON records the edited coordinates, matching revision, actual
presentation frame and projected SVG or GPU draw. Hydro end-of-test screenshots
are taken after Undo/Redo, so those screenshots alone do not prove the handoff.
The existing Application Architecture workflow includes the path-scoped
`preview-handoff` job and always uploads browser evidence.

This branch push does not run that workflow: its existing triggers are main
pushes and pull requests. No pull request, main merge or deployment is created
as part of this delivery.

Remote CI, live release and full regression are not implied by local results.
The user reserved full verification for the end of M7.

## Separately discovered issue

An initial setup probe using river creation found an existing error in
`app-country-commits.js`'s `scheduleMultiDraftPreview`: it constructs the
validation Feature only for polygons and reports an error for a valid river
LineString. M2 does not modify that creation flow. Hydro editing uses a current
project loaded through the real file/GeoPackage path instead. This creation
issue remains open and is not reported as fixed or passed.
