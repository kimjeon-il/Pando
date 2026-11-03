# Map Toolkit Baseline Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair native packaging and complete an explicitly authorized, content-proven private release transition without weakening the default ancestry guard.

**Architecture:** Keep source closure in runtime-assets.mjs. Add one pure, tightly bounded transition validator beside the release coordinator; the coordinator owns authenticated snapshot/archive handling and invokes the existing producer. The optional transition is recomputed, never trusted as a saved boolean.

**Tech Stack:** Existing Node ESM, node:test, crypto, Git and pinned yazl 3.3.1; no new production dependency.

**Spec:** docs/superpowers/specs/2026-11-03-map-toolkit-baseline-design.md

## Global Constraints
- Preserve old branches/index, active developer-source jobs, plugin identity/private audience, data/model/native/WASM identities and both manifests.
- No deletion, force push, synthetic ancestry merge, silent guard skip, installed-cache edits or public deployment.
- Account identities and proof snapshots stay outside app Git.
- Use focused tests only.

## Review Focus
- Legacy manifest fields excluded by the existing fingerprint must be compared independently.
- Entire account archive inventory and preserved non-owned extras must be checked.
- Stale or replayed evidence must never authorize a new current release.
- Exactly six additions and their derived catalogue rows are allowed, not arbitrary archive changes.
- Runtime package/lock/dependency identities must survive source-only package-script differences.

## Task 1: Native closure regression
Files: tools/reference-analysis/runtime-assets.mjs; tests/unit/map-cloud-probe.test.mjs.
- [x] Observe three real-module native-input assertions fail against the duplicated list.
- [x] Replace that list with canonical native source arrays.
- [x] Run cloud-probe and release tests (21 pass), scoped eslint and diff checks.
- [x] Verify native artifacts against collected-source fixture and include evidence in focused release checks.

## Task 2: Transition proof
Files: new tools/reference-analysis/private-release-baseline.mjs; new tests/unit/map-plugin-baseline.test.mjs.
Interface: verifyNativeSourceBaseline({remote, archiveFiles, previousCandidate, candidate, branch, producerSha256}) returns a derived proof with preserved-extra hashes; it accepts actual byte maps/candidates, not caller-provided exclusions.
- [x] Write positive synthetic exact-six repair and the negative cases in the spec.
- [x] Run tests and observe missing validator failure.
- [x] Implement complete inventory, manifest/receipt, candidate-equivalence, exact six-file/catalogue-delta and extra-preservation checks.
- [x] Run tests, including source-only script projection and changed generated dependency/lock negatives.

## Task 3: Explicit coordinator integration
Files: tools/reference-analysis/release-private-plugin.mjs; tools/reference-analysis/package-private-plugin.mjs; tests/unit/map-plugin-release.test.mjs; docs/reference-map-plugin.md.
- [x] Write failing tests for explicit transition input, default ancestry rejection, stale proof, preserved compatibility manifest and full readback inventory.
- [x] Add explicit archive/release arguments, exact archive reading, old-candidate reconstruction and fresh proof derivation. Preserve default ancestor path.
- [x] Add migration-only compatibility-manifest preservation. Bind proof to plan/new receipt; include preserved extras in verification, not upload deletions.
- [x] Test normal releases remain unchanged, transition receipt/readback is exact, races reject and unrelated post-transition ancestry rejects.
- [x] Run all three focused test files, scoped eslint and diff checks; obtain independent review before commit/push/package.

## Task 4: Authorized release and evidence
- [ ] Freshly check remote branch/account state, reconcile concurrent work, commit and push only reviewed GIS changes without force.
- [ ] Prepare pinned metadata/resources without restoring unrelated GIS datasets; run verified focused commands.
- [ ] Obtain exact account archive/full inventory via Plugin Creator, prepare transition and inspect archive/manifest/full-delta proof with reviewer.
- [ ] Guarded update existing plugin, read back exact release and verify its archive including extras.
- [ ] Exercise the packaged runtime; separately report any installed-cache refresh limitation.
- [ ] Publish/check only completed external engineering report scope, remove ended task-owned release copies and retain active analysis sources.

### Required additional gates from design review
- Before building archiveFiles, reject duplicate/control-character paths, symlink/hardlink and special archive entry types for both supported formats; add crafted archive regressions.
- Compare old/new candidate bytes with only outer manifest version and runtime codeRevision normalized. Nested manifest version and all protected payloads remain exact.
- After packaging, compare actual package entries and inventory against the previously proved candidate before upload; inject a changed artifact in a focused test and require rejection. Recompute bindings on archive readback.
