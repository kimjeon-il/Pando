# Automatic library-data reflection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** GitHub canonical data edits start generation and validation automatically, then publish only a complete compatible version without a per-edit manual button.

**Architecture:** A notifier-only data-repository workflow sends an exact revision to an application-owned reconciler. The reconciler reuses official derivation functions, tracks desired versus completed publication state, preserves the existing work-branch P2 guard, and separates production data-only publication from ordinary source development. Production activation remains disabled while implementation is prepared on work/gis.

**Tech Stack:** Existing Node 24 ES modules, node:test, GitHub Actions, Git non-force/CAS publication, current library storage owner.

**Spec:** `docs/superpowers/specs/2026-11-01-automatic-library-data.md` (local approved-direction design; A selected 2026-11-01 10:18:28 UTC).

## Global Constraints
- Changes only on work/gis; no main writes, merging, live Pages dispatch, credential creation or registration in this preparation task.
- Data repository is storage-only; its workflow sends notifications and does not run validators or generators.
- Existing P2 main guard and loader/editor behavior stay unchanged.
- Production owner is separately gated disabled by default; work/gis can only validate and connect a paired data revision; it does not deploy a hosted preview.
- No arbitrary repository, ref, path, URL or commands from event payload/data.
- Preserve complete previous live version until verified replacement; preserve unrelated metadata/reports and concurrent edits.
- Existing G geometry/source/evidence is reused; old one-off candidate workflow is not a required normal editing step.
- New cross-repository Actions permission must be explicitly approved before provisioning. Fail clearly if absent.

## Review Focus
1. Data publication succeeds but app pin or Pages fails: retry the missing phase without a new source event.
2. Older dispatch arrives after a newer edit: reconcile current desired state, never overwrite newer work.
3. Hash-addressed objects are edited without updating the canonical index: reject inconsistency, do not hide it.
4. Generated/report-only commits: no regeneration loop, but pending publication recovery still runs.
5. A work-branch event or forged payload requests production: reject before credentials or writes.

### Task 1: Trusted event and reconciliation contract
Files: create `scripts/lib/library-auto-sync.mjs`, `tests/unit/library-auto-sync.test.mjs`, `config/library-auto-sync.json`.
Interfaces: `validateSyncRequest(request, policy)` returns fixed repo/branch/SHA tuple; `planSync({desired, completed, available, policy})` returns `noop|derive|connect|deploy|verify|blocked` and exact expected revisions.
- [x] RED tests: unknown repo/ref, invalid SHA, production disabled, stale event, reports-only no-op, missing prior-phase recovery.
- [x] Implement pure policy/state logic. Default production enabled=false; work/gis never returns deploy.
- [x] GREEN focused tests. No remote operations in this task.

### Task 2: Canonical input verification and derivation adapter
Files: create `scripts/lib/library-auto-inputs.mjs`, `tests/unit/library-auto-inputs.test.mjs`; reuse current native library/index materialization and artifact graph APIs.
Interfaces: `inspectCanonicalInputs({revision, baselineRevision, readBlob})` returns validated source fingerprint, changed entity IDs, required families and immutable input records. Use existing territorial-entity-sources normalization. Read library.json/entities and referenced content-hash objects from the exact candidate revision; project changed existing countries into source/countries. Read indexHash views explicitly; view changes require full official compiler. If native and archive source both changed, accept only semantically equal contents; otherwise reject. New/deleted countries and other data families initially fail unsupported without publication.
- [x] RED tests: object hash mismatch, missing index member, duplicate identity, source/index conflict, unchanged/report-only commits, unsupported changed data family.
- [x] Implement fixed canonical-source readers with no data-provided executable behavior. Support territorial/native changes first only if scope confirmed; otherwise refuse unsupported families explicitly.
- [x] Reuse official source construction, graph generation and validations; no runtime hash substitution or blanket golden-fixture update.
- [x] GREEN integrity tests plus G previous/current dates and unrelated-country preservation.

### Task 3: Recoverable application publication owner
Files: create `scripts/library-auto-sync.mjs`, `scripts/lib/library-auto-publication.mjs`, `tests/unit/library-auto-publication.test.mjs`; narrowly extend `tools/library-data.mjs` expected-revision guard to validated explicit branch if required (current unpublished guard is work/gis-specific).
Interfaces: `reconcileLibraryData({request, policy, adapters})` consumes Task1/2 results. Adapters expose readHeads, derive, storeCompleteData, updatePairedPin, dispatchPages, verifyLive and read/write durable receipts.
- [x] RED tests cover each operation failing, recovery after data/app success, simultaneous HEAD changes, non-force CAS failure, production-disabled refusal, and no unrelated app-path writes.
- [x] Implement separate production data-only owner; do not remove the P2 main guard. Official stage/validate functions remain owners of generation.
- [x] Persist phases in content-addressed/pinned receipts, not a disposable runner-only journal; recover from existing Git commits plus current pin and live evidence.
- [x] GREEN failure-injection tests. Use assets/data/generated-artifacts/p2-manifest.json bounded autoPublication receipt alongside existing family receipts, committed with complete outputs. Record input data SHA/fingerprint, generating app SHA and generator identity; do not embed the resulting commit SHA (self-reference). Infer complete-data/pin/deploy phases from Git, pin, and verified live evidence.

### Task 4: Notify and execute automatically, activation disabled
Files: data repo `.github/workflows/notify-library-data.yml`; app `.github/workflows/library-data-auto-sync.yml`; tests `tests/unit/library-auto-workflows.test.mjs`; modify app docs/branch-policy.md and docs/library-data.md only to describe the narrow inactive new contract.
- [x] RED tests for fixed receiver/ref, production disabled, absent-secret fail-closed, no generators in data workflow, no work/gis deployment, source-fingerprint loop prevention.
- [x] Add notifier on approved data branches. New secret is referenced only, never created/read/exposed by this task.
- [x] App orchestration uses exact data/app SHAs and runs necessary generation in Pando. Automatically calls Pages only after activation and production eligibility; no dependence on bot push triggering another workflow.
- [x] Include automatic recovery of incomplete phases; use an application-owned infrequent safety reconciliation schedule alongside immediate notifications, disabled with production activation. The schedule recovers lost events/cancellation; no indefinite runner loop.
- [x] GREEN workflow contract tests and local dry-run. No production dispatch.

### Task 5: Review, bounded work/gis publication and handoff
- [x] Independent security/correctness review of event trust, permission boundaries, phases, source adapters and unchanged default behavior.
- [x] Run focused automatic/library guard tests (164 passed); full pnpm bootstrap is environment-blocked and was not retried.
- [ ] Refresh both remote heads; preserve simultaneous changes; commit only reviewed code/docs on work/gis with non-force expected SHA.
- [ ] Report exact readiness: implementation tested, notification credential missing/unconfigured, production disabled, G runtime not yet applied unless independently completed.
- [ ] Obtain later separate authorization for credential creation/registration and production installation/activation. Do not call the website automatically updated before actual live verification.

## Bounded decisions and remaining activation
- Initial scope is existing territorial/native countries and world view; unsupported families fail closed. No all-data promise.
- Receipt extension and recovery sweep accompany immediate notification; no extra journal branch. Independent workflow review remains required.
- Production policy deployment/main activation is explicitly deferred, not silently authorized by choosing immediate notification.

## Verification status (preparation)
As of 2026-11-01, contract/input/publication/runtime/executor focused tests pass (164 after final review corrections). Actual 286-country native projection including approved G inputs matches prior official generator input SHA values. Remote end-to-end generation/publication and production activation are not claimed by injected executor tests. Workflow and executor independent review corrections passed. Actual 286-country native adapter validation accepted exactly one test-only AND vertex edit. Supported official scoped compilation (AND/KOR/USA) changed AND geometryRef from 386ef168… to 94afd2ba… while KOR/USA compiled bytes remained identical. This is real compiler execution, not a full-world eight-family or remote publication claim.
