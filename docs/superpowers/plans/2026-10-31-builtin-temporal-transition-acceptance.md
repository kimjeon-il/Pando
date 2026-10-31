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
