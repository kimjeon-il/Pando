# GPU scene stroke domain staging (M3)

M3 implements the roadmap's stroke resource swap: keep the last presented scene
stroke domain while its replacement uploads, and promote only the domain drawn
in an actually presented frame. This extends the existing renderer and upload
scheduler. It does not stage polygon/country meshes or terrain, change model or
project persistence APIs, or establish full map continuity.

## Owners and resource identity

- `app-gpu-scene.js` owns the desired scene domains.
- `render-scene.js` preserves each stroke's domain, logical visual key, object
  reference and aggregate continuity owner IDs in immutable packets.
- `gpu-map-renderer.js` owns a presentation cache of the stroke resources actually
  displayed. It is not another project or desired-scene owner.
- `gpu-scene-preparation.js` selects a complete prepared candidate domain or an
  eligible previous domain. Preparation and upload callbacks do not promote it.
- `gpu-stroke-renderer.js` retains desired and presented resource keys together;
  canceled uploads cannot allocate or publish a superseded resource afterward.

Logical visual keys are unchanged. Physical keys are
`scene-stroke:<projectGeneration>:<sourceKey>`, where the existing source key
includes geometry revision, LOD and projection. Uploading a new same-key visual
therefore cannot overwrite its displayed predecessor's buffers. Draw coverage
converts physical keys to logical keys explicitly using the prepared packet.

## Preparation, drawing and retirement

A domain uses its candidate only when every required stroke is prepared. Other
domains can become ready independently. A previously displayed fallback is
project-generation checked, and current visual/object identities and aggregate
owner IDs must still authorize its display. Deletion, hiding, zero width/alpha,
an empty domain, reset and disposal do not preserve obsolete strokes. Adding an
owner can retain a still-valid aggregate. Removing an owner invalidates an
indivisible aggregate buffer until its filtered successor is ready, rather than
leaving deleted segments visible.

If a prepared candidate's actual draw fails, the existing base pass redraws the
eligible previous domain once before publishing the frame. That domain is
excluded from the frame's promotion list. Technical diagnostics preserve the
operation stage, physical key and underlying error/stack through
`reportOperationError` (`PL-GPU-STROKE-001`). If the previous draw also fails or
there is no eligible previous domain, the staging texture is not published.
A whole-scene texture may be preserved only if its strokes still satisfy the
current display eligibility; it cannot resurrect deleted or hidden strokes.
The failure remains latched through the renderer's final return, even if an old
texture could be preserved or the prior coverage result was null. Such a frame
does not acknowledge preview presentation or promote/release candidate resources.

After successful current-frame presentation, the renderer records the selected
domains and releases their replaced buffers. Wrong-frame and wrong-project
results cannot commit. No separate render loop or controller is introduced.

## Verification checkpoint

- Remote main confirmed at execution:
  `e76857ae11b32ca9edb6da8beb1569e6308df598`.
- M2 parent/checkpoint, committed and pushed before M3:
  `231ea1e62add4c5d4380952df3949b2f530bb116`.
- Branch/worktree: `codex/m2-preview-handoff`; the primary checkout, other
  worktrees and ignored evidence remain preserved.
- Exact M3 candidate SHA and SHA-256 evidence inventory are written after the
  clean commit to `test-results/m3-delivery.json`. This avoids a self-referential
  document hash. M2's fixed `test-results/m2-delivery.json` is preserved.

Focused checks only; counts below are per command, not the full suite:

| Command | Pass / fail / skip | Evidence |
| --- | --- | --- |
| `node --test` with the eight files below | 79 / 0 / 0 | `test-results/m3-focused-final.log` |
| `pnpm exec playwright test tests/browser/gpu-scene-staging.spec.mjs --output=test-results/m3-real-gpu-final` | 1 / 0 / 0 | `test-results/m3-real-gpu-final.log`, `gpu-domain-frames.json` |
| `pnpm exec playwright test tests/browser/renderer-migration-gaps.spec.mjs --grep=Canvas.receives --output=test-results/m3-scene-pixels` | 1 / 0 / 0 | `test-results/m3-scene-pixels.log` |
| `pnpm exec playwright test tests/browser/territorial-boundary-continuity.spec.mjs --grep=webgl2 --output=test-results/m3-ui-final-accepted` | 1 / 0 / 0 | `test-results/m3-ui-final-accepted.log`, `m3-failed-scene-publication.json` |
| Changed JS files: `pnpm exec eslint` (13 files) | exit 0 | `test-results/m3-eslint-final.log` |
| Final observer/cancellation browser edits: `pnpm exec eslint` (2 files) | exit 0 | `test-results/m3-browser-eslint-completion.log` |
| Workflow YAML parse, scoped job/commands and always evidence upload | 1 / 0 / 0 | `test-results/m3-workflow-check.log` |

```sh
node --test tests/unit/gpu-scene-staging.test.mjs \
  tests/unit/gpu-prepared-draw.test.mjs tests/unit/gpu-base-scene-order.test.mjs \
  tests/unit/render-scene.test.mjs tests/unit/gpu-stroke-renderer.test.mjs \
  tests/unit/gpu-upload-staging.test.mjs \
  tests/unit/territorial-boundary-continuity.test.mjs \
  tests/unit/edit-preview-presentation.test.mjs
pnpm exec playwright test tests/browser/territorial-boundary-continuity.spec.mjs \
  --grep=webgl2 --output=test-results/m3-ui-final-accepted
```

The real WebGL test uses the production scene builder, shared upload scheduler,
stroke preparation and base pass. It reads actual pixels through partial upload,
complete upload followed by injected GL draw failure, successful replacement,
deletion and superseded upload cancellation. It demonstrates the resource/draw
mechanism, separately from the actual application UI and Worker checks.

Failing regressions were recorded before corrections: baseline staging, owner
removal/addition, deleted distribution siblings, failed draw recovery and whole
scene cache eligibility. Earlier logs are retained. An initial UI publication
observer failed by comparing a frame ID across multiple render invocations;
the updated observer distinguishes each invocation and still requires the
actual failed invocation to return failure and never publish its staging texture.
That failed run is `test-results/m3-ui-observer-red.log`; it is not a passing run.
An interrupted setup run is also preserved and not counted as a pass.
The final UI command passed both delayed Worker phases: 13 child-create and 18
region-redraw boundary submissions, each across six view revisions and with
zero upload misses while waiting. The injected unrecoverable GPU draw invocation
returned failure and did not publish a staging texture; a later normal invocation
presented the new geometry. This is not a full M7 continuous gesture matrix.

The existing Application Architecture workflow now has a path-scoped M3 job for
these focused units, the three browser commands and always-uploaded evidence.
Remote CI has not run for this branch-only checkpoint. Existing broader jobs
and assertions were not weakened.

Not executed: full unit/browser suite, full architecture commands, remote CI,
live release, a full M2 browser matrix after M3, or the M7 drag-to-upload-to-frame
end-to-end continuity matrix. Full verification remains reserved for M7.
M4 visual roles/order, M5 style rules and M6 frame audit remain separate work.
There is no main merge or deployment in this checkpoint.
