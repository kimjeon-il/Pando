# Architecture Check Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking. The user's existing instruction is to finish all remaining preflight work with agents; use the current permanent `work/ui` checkout and preserve unrelated staged fixes.

**Goal:** Run the complete existing Architecture selection in bounded isolated CI jobs and require every selected phase to pass.

**Architecture:** Keep the canonical plan unchanged. Add explicit non-browser/browser execution phases to the same runner and use Playwright's native sharding across at most eight CI runners, each with one browser worker. Preserve the `checks` job as the aggregate gate.

**Tech Stack:** Node.js, existing Node test runner, locked Playwright 1.62.1, GitHub Actions, existing YAML parser.

**Spec:** `docs/superpowers/specs/2026-11-01-architecture-check-execution-design.md`

## Global Constraints

- No product, data-pin, GIS-generation, assertion, retry, test-timeout, or canonical selection changes.
- Keep 31 manual specs and the two explicitly deferred timeline cases excluded.
- Default local/P3 execution remains `all`; new phases are explicit.
- Browser jobs retain `--workers=1` and `fail-fast: false`; per-job timeout stays 45 minutes.
- Unit batches and command/native work run once. Browser jobs prepare only their declared browser prerequisites.
- Do not commit/push from a subagent. Stage only owned paths; root publishes after independent review.

## Review Focus

- Invalid or incompatible phase/shard values fail before spawning commands.
- A malformed, missing, failed, or cancelled required phase cannot produce a successful aggregate gate.
- A legitimate empty phase is skipped without pretending it executed.
- Browser prerequisite failure blocks the browser; unrelated command/unit prerequisites are not built again in every shard.
- Every shard receives the same full canonical selected spec list and an explicit shard identity; no case list is narrowed to hide failures.

### Task 1: Canonical execution phases

**Files:** `scripts/run-application-checks.mjs`, `tests/unit/check-runner.test.mjs`; existing `tests/unit/native-check-prerequisites.test.mjs` only if required to preserve its workflow-consumer contract.

**Interface:** Extend `executePlan(plan, options)` with `phase: 'all' | 'non-browser' | 'browser'` (default `'all'`) and optional `shard: 'current/total'`. Add matching `--phase` and `--shard` CLI options; shard is valid only in browser phase. Emit phase/shard evidence without replacing the complete selection plan. Use a bounded matrix of 1 through `min(8, selectedBrowserSpecCount)` for nonempty browser selection.

- [ ] Add behavioral regressions using the existing injected command runner: default command sequence unchanged; non-browser invokes the original commands/units and no Playwright; browser invokes only declared browser prerequisites and Playwright with the original full spec list, `--workers=1`, and its `--shard` argument.
- [ ] Add regressions for invalid phase, zero/malformed/out-of-range shard, incompatible non-browser shard, failed browser prerequisites, and empty browser scope. Run the focused test directly with Node and record the intended failures.
- [ ] Implement the phase/shard interface and plan-derived CI outputs. Do not change `selectionRequest`, ownership, group modes, or the planner's selected files.
- [ ] Run `node tests/unit/check-runner.test.mjs` and the relevant existing native-prerequisite regressions; require all actual cases to pass. Run changed-file lint and whitespace checks.

### Task 2: Isolated workflow execution and aggregate gate

**Files:** `.github/workflows/application-architecture.yml`, `tests/unit/check-automation.test.mjs`, `tests/unit/current-browser-contracts.test.mjs`; Task 1 files only for shared interface corrections. The current-browser consumer contract follows the actual phase executors and preserves the separate diagnostic jobs.

**Interface:** The selection job exposes whether non-browser/browser work exists and the bounded browser matrix. One non-browser job invokes `--phase non-browser`; browser matrix jobs invoke `--phase browser --shard current/total`. Final `checks` depends on selection and both phase jobs, and accepts `skipped` only for a phase whose canonical selection is empty.

- [ ] Add workflow regressions for nonempty bounded matrix, `fail-fast: false`, phase arguments, one-worker preservation, artifact-name separation, unchanged diagnostic jobs, and prerequisite preparation before each actual executor.
- [ ] Exercise the aggregate step with success, failure, cancellation, missing output, and legitimate empty-phase status inputs. Demonstrate the old workflow cannot meet the new execution contract before implementation.
- [ ] Reuse the existing checkout, pinned-data, install, and prerequisite steps. Upload non-browser evidence and each browser shard's evidence plus existing failure traces/screenshots under distinct names. Keep final `checks` fail-closed even when prerequisite jobs fail.
- [ ] Run `node tests/unit/check-automation.test.mjs`, the runner/native prerequisite tests, YAML parsing, changed-file lint, and `git diff --check`. Use approved subprocess escalation if the local Git fixture requires it.
- [ ] Hand exact staged blobs, actual case counts, limitations, and the complete phase/matrix/gate diff to an independent reviewer. Root publishes only after findings close.

### Task 3: Actual CI verification

- [ ] Publish the reviewed candidate with the existing `[p2-wasm-only]` scope control; preserve the runtime data pin and avoid GIS generation.
- [ ] Inspect exact-head non-browser evidence and all selected browser shard results. Treat mocks, plans, partial shards, cancellation, and skips separately from completed checks.
- [ ] Fix only demonstrated remaining failures, retain original assertions, and rerun affected checks. Require the aggregate Architecture gate before main integration and public Viewer verification.
