# Independent country loading — phase 2

## Approved scope and rollout boundary

Continue the approved country-file split on permanent `work/gis`, after
`44d5230`. Change the shared builtin loader and its focused contracts only.
No source GIS edits, main integration, deployment, runtime data regeneration,
paired library pin change, asset-plan rewrite or full browser/native matrix.
Phase 3 must switch the pinned catalog and Web/App packaging together. The
new reader deliberately does not support packed indexes; until that cutover,
the working branch's old paired dataset cannot be used by the new reader.
Do not interpret this intermediate source commit as a deployable code/data pair.

## Implementation plan

1. Write direct-request, immutable-cache, failure/retry and supersession tests.
   Run the branch-scoped read-only workflow and observe the old reader fail.
2. Replace `loadTransport`/byte slicing with country-file requests through the
   existing stored asset loader. Validate the independent catalog and each
   selected country's identity/schema. Keep six shared in-flight reads and
   deduplicate overlapping month queries. Check supersession before and after
   asynchronous reads and before returning a scene, including empty queries.
3. Use revision-scoped cache for the catalog and the existing immutable cache
   for content-hashed country paths. Preserve storage-failure fallback and
   per-file integrity/retry behavior; do not create a second cache owner.
4. Run only generation/catalog and direct-loader/Core-session tests, review
   the diff separately, and verify the work/gis ref without merging main.

## Interface decisions

- `createBuiltinWorldLoader` keeps its existing caller interface and returns
  `loadIndex` and `loadProject`. `loadProject` still returns project/fingerprint.
- The runtime catalog requires `storageLayout: country-files-v1`, schema 2,
  independent gzip descriptors, exact content hash paths and positive sizes.
  Reject transport/offset metadata and unsafe/duplicate country descriptors.
- A country requires schema 2, matching identity, geometry/source arrays and
  the current schema-3 timeline record arrays. The existing assembly owns
  temporal projection, names, flags, parents and scene geometry selection.
- Pending country reads are shared resources, not owned by a month query.
  Superseding one query must not abort a shared fetch still needed by another.
  Successful country bytes may remain cached, but no stale scene may publish.
- Any missing/corrupt required country fails the entire query. A subsequent
  retry reuses successful countries instead of redownloading them all.

## Execution ledger

- Source of authority: the user's approved four-phase plan and explicit phase-2
  continuation. Phase-1 generation remains the catalog contract owner.
- Remote workspace: GitHub work/gis. No existing local worktree is mounted in
  this chat; local GitHub DNS is unavailable. Use authenticated GitHub writes
  and its focused CI, without modifying the user's other local worktrees.
- Pre-flight: phase-1 output is independent while pinned data and packaging
  remain packed. Keep activation in phase 3, do not add a packed fallback.
- Review focus: cross-revision cache reuse; failure isolation; pending-query
  deduplication; last-read/empty-query supersession; strict descriptor checks.
- Verification command: the existing builtin-country-publication workflow,
  now including builtin-world-loader and builtin-country-loading tests.
