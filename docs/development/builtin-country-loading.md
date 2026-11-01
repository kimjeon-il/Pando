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
- A non-cancellation failure stops scheduling countries and drains its current
  workers before returning the original error. Otherwise an immediate retry
  can join a different country's not-yet-settled failed request. Cancellation
  remains prompt and leaves shared requests usable by another active query.

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
- RED: c7811de, run 41258499389: the old packed reader failed 15 of 36 focused
  tests; 19 generation/catalog checks remained green.
- Initial GREEN: 20ab785, run 41258630548: all 36 focused tests passed, including
  actual Core-session autosave restoration and superseded baseline rollback.
- Final review: self-review (no subagent tool). Reader/assembly diff and cache
  owner reviewed separately. Found the immediate-retry pending-failure race.
- Regression RED: f36aacd, run 41258776888: 36 passed, only the deterministic
  pending-failure drain test failed (true !== false at line 30). The slow
  country's final 404 was deliberately held after the fast country failed.
- Ruling: drain active workers only on non-AbortError failures; preserve
  cancellation responsiveness and cross-query request sharing. No cache-owner
  rewrite, whole-world download fallback or retry of successful files.
- Final gate: the same read-only workflow runs all 37 focused tests with a
  15-second per-test timeout. Its conclusion, not this document, determines
  completion of the amended source. No live Web/App deployment claim.

Deferred to phase 3: pinned independent catalog activation; Web/App asset plans
and shell fixtures; deployed-network/browser/native packaging verification.
Deferred to phase 4: archived transport removal after confirming no active pins
or other consumers, and residual full integration cleanup.
