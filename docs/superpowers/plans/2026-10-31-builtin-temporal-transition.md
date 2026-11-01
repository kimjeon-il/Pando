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

Local native document_session_tests and temporal_adopt_tests passed with the new
rejection and delta/rollback regressions. Source-matched WASM and browser gates
remain pending until the stage-2 integration workflow records their results.
No performance latency claim is made. No independent agent reviewer is available;
final review is an explicit author review, separate from implementation.

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
