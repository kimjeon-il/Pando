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

# Builtin temporal transition — implementation stage 1

Scope: viewer year/month navigation uses a dedicated Core baseline transition instead of the whole-document load protocol. Startup and user-file opening retain their existing contracts. Do not change geometry, date semantics, loading animation, prefetch, or main.

## Approach

The current built-in source is a single-date snapshot. Cursor-only navigation is invalid. Retain date-specific selection and the existing serialized replacement/rollback boundary. Add a native transition of an admitted baseline which emits the existing canonical delta protocol, rather than exporting and receiving a complete document/geometry archive. Preserve the viewer document identity on temporal changes. A complete candidate must validate and its delta must serialize before committing. Unchanged geometry allocations in the accepted JS read model survive.

Reuse the already admitted immutable baseline only when a newly evaluated complete selection key (manifest revision, country content hashes, active source/temporal record indexes) matches. A live baseline handle must also match. Never cache arbitrary handles or infer equality from year/country IDs alone. State changes keep the existing full validated source preparation.

Viewer navigation calls a dedicated domain transition entry but shares the canonical open and command queues. Same request/generation/renderer-presentation checks and rollback apply. Keep the existing post-transaction renderer/catalog hydration order in this stage; moving catalog admission into replacement would reenter its pending command queue. Renderer update deduplication is a separate later change. No background work is required for correctness.

## Tasks and verification gates

1. Add failing native transition and JS ABI/domain tests. Run the native baseline and existing timeline tests first.
2. Add the shared native candidate builder and delta transition, exposing it through the existing Worker ABI/client/policy. Verify native all-or-nothing failure, unchanged geometry delta, changed geometry, epoch rejection, clean history, identity and rollback.
3. Connect the viewer-only domain entry and source-selection reuse. Verify complete selection changes, cancellation, failed-source retry, stale-handle invalidation and single initial load vs subsequent transitions.
4. Run focused native/Node/actual browser tests with source-matched WASM, lint affected files, inspect diffs, publish only to work/objects with expected-SHA lease. Do not merge/deploy. Report measured packet reduction separately from unmeasured end-to-end latency.

## Explicit limitations

This stage does not introduce per-country GPU updates, prefetch or a second timeline engine. Core still validates a changed candidate. A dedicated delta transport is not a claim that all candidate construction/revalidation has disappeared. No unconditional 100ms or zero-bug guarantee.
