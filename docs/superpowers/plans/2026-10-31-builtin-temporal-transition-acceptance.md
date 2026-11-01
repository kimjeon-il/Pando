# 2026-11-01 stage-2 integration update

The historical proposal below is retained as the original review record. Main
502cc301 now owns P5-6 immutable source preparation, bounded cache, candidate
validation, atomic adoption and rollback. Stage 2 ports the missing delta and
identity-preservation intent into that existing owner, not a second transition
API. Old documentTransitionBaseline/transitionBuiltin and selection-key caching
are superseded. Initial load, user-file opening and editor paths retain complete
admission; only an explicit clean builtin Viewer date change keeps its identity.

The native candidate prepares and validates its authoritative delta before the
replacement transaction. Same-ID changed geometry without a new version is
rejected. Exact month/data/source identity, country-files-v1 and the data pin
5eb7be55208efaafe39bd5a65ec2f111d70b9053 remain unchanged. No cross-month source
handle equality is guessed. New tests cover delta publication, state ownership,
native/WASM equivalence and real desktop/mobile WebGL/Canvas transitions.

## Current acceptance: WIP, do not merge main

The implementation and source-matched WASM below are preserved for review, not
accepted for production. Main remains 502cc301; its stage-0 repair and stage-1
country loader/data pairing are unchanged.

Verified: four focused native targets; six native/WASM scenarios with 351 exact
paired calls; 85 affected JavaScript contracts; three actual-data WASM tests;
affected ESLint; independent Web/App country assets (278 countries, 291 physical
files, maximum 524288 bytes, no aggregate transport requests). Runs 41286450388,
41286848158 and 41287252232 retain those outputs. Test-harness corrections did
not modify the compiled source or weaken functional assertions.

Browser run 41287621774: five passed, one failed, retries=0. WebGL desktop and
mobile, Canvas mobile, failed/superseded source reads, and Canvas user-file
opening passed. Desktop Canvas stalled after Core adopted 2025-12: the displayed
month stayed 2026-10 and viewerStatus.ready stayed false for 90 seconds.
This is an unresolved presentation-acceptance failure, not a source-read or
delta transport failure. Its exact cause and baseline status are not proven.

Read-only diagnostic run 41288545729 passed the desktop case after startup
selected the canvas2d fallback (15 stale Worker frames). That pass is NOT a
production fix or proof that the initial failure is resolved. Production
renderer files are unchanged; no timeout, input or acceptance assertion was
relaxed, and the failing browser case remains enabled. Do not disable Worker
rendering to obtain acceptance.

Reproduce only the remaining desktop case using
pnpm exec playwright test tests/browser/builtin-temporal-transition.spec.mjs
--grep='canvas 1280px' --workers=1 --retries=0. Separate canvas-worker from
canvas2d when examining frame/scene provenance. Keep passed unchanged native
and source/data checks; rerun affected gates after an actual correction.

Author self-review only; no independent agent reviewer was available. No
latency target, full native-platform matrix or main/production deployment
success is claimed. The temporary write-enabled workflow is removed; unique
evidence and the original branch history remain retained.

---

# Builtin temporal transition: WIP, acceptance blocked

2026-10-31. This is a reviewable implementation, not a completed performance phase and not approved for main merge or production deployment.

## Implemented scope

The viewer's builtin temporal requests use a dedicated transition entry while keeping the existing serialized replacement, cancellation, checkpoint and rollback boundaries. Validated unchanged source selections can reuse their Core baseline. The C++ transition returns the existing authoritative change delta rather than a complete document snapshot; unchanged geometry coordinates are not retransmitted. Initial load, imported user files and editor paths keep their existing loading entry points. This does not eliminate all Core validation/candidate construction or renderer rebuild work. Initial loading visuals, prefetching and GPU incremental rendering are outside this stage.

## Verified evidence

- Native document_session_tests, project_codec_tests and web_storage_tests: 3 passed on the same C++ source.
- Source-matched WASM integrity, focused Node/WASM tests: 73 passed, 0 failed, 0 skipped.
- ESLint changed executable sources and existing command/Worker architecture checks passed.
- Additional local actual-WASM comparison: 50 synthetic historical queries matched the full-loading reference; 1 initial full baseline load followed by 49 dedicated transitions. Not a real-data latency benchmark.
- Dedicated Chromium WebGL desktop 1280px and touch/mobile 390px: 2 passed.

## Remaining blockers

Run 41148872501: dedicated WebGL/Canvas browser suite had 2 passed and 3 failed. Canvas desktop/mobile input and failure/supersession scenarios timed out on native click/tap handling. The product cause has not been resolved.

Run 41147093101: the wider candidate UI suite had 3 failures, including user-file readiness. Run 41148440127 baseline-ui used unmodified production source and original tests: 2 failed, 1 passed. The baseline user-file case passed, so the candidate user-file timeout cannot be dismissed as entirely pre-existing.

No claim is made that all tests pass, that there are no regressions, or that any latency target has been reached. Failed browser cases remain enabled in the final read-only verification workflow. No main merge or production deployment was performed by this task.

## Reproduction and handoff

Use tests/browser/builtin-temporal-transition.spec.mjs and tests/browser/timeline-controls.spec.mjs with Chromium and retries=0. Preserve the distinction between the original baseline, source-matched candidate and renderer modes. Do not bypass native input/actionability, remove failure cases or relax acceptance assertions to obtain a green result. Investigate the Canvas input timeout and independently clear the imported-file readiness regression before marking the stage complete.

The temporary write-enabled preparation workflow is replaced by a contents:read verification workflow in this WIP commit. It neither writes repository refs nor applies external candidate patches.
