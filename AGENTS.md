# AGENTS.md ? PandoLab / world-map

These instructions apply to the entire repository unless a deeper `AGENTS.md`
or `AGENTS.override.md` provides more specific rules.

## Branch and permanent worktree policy (mandatory)

Read [docs/branch-policy.md](docs/branch-policy.md) before choosing a branch or
local worktree. Web lives at the repository root, the application in
`apps/web-shell/`, and common C++ in `shared/`; all use the same commit and branch:

- Reuse the long-lived branches `work/ui`, `work/objects`, `work/gis`, and
  `work/places` according to the task's primary purpose; `main` is the
  stable integration branch.
- Before local changes, run `git worktree list --porcelain` and inspect the
  assigned worktree's branch, `git status --short --branch`, and uncommitted or
  untracked files. Reuse the existing permanent worktree for that branch.
- Reuse existing permanent worktrees and fixed per-worktree build directories.
  Do not create a new workspace, repository clone, branch, worktree, or build
  directory for each task. Create a missing permanent worktree only when the
  work cannot be handled in an existing appropriate workspace.
- After a task, leave permanent worktrees and branches in place for the next
  task. Removing or pruning them requires explicit user approval.
- Never discard unrelated or uncommitted work, including via automatic stash,
  `git clean`, `git reset --hard`, force checkout, force push, or force
  worktree removal. Request explicit user approval for destructive operations
  affecting protected work or data; verified unused, reproducible cache and
  generated-file cleanup follows the policy below without separate approval.
- Synchronize the latest `main` **into** the appropriate `work/*` branch
  only after checking the local and remote state; preserve unfinished work and
  resolve conflicts without silently choosing one side.
- Never merge `work/*` into `main`, commit directly to `main`, deploy, or
  transfer changes between categories without explicit user instructions.
- Verify Web and App changes independently even though they share a commit.
- Exception branches or temporary worktrees require a concrete reason why an
  existing workspace cannot handle the work, and user approval. Do not delete
  them automatically after integration.

## Storage and generated-file cleanup (mandatory)

- Before large builds, downloads, or copies, check free space on the target
  drive. Avoid duplicate outputs and unnecessary full copies; reuse existing
  dependencies, data caches, and incremental build directories where valid.
- When cleanup is needed, unused caches, temporary files, duplicate generated
  outputs, and failed-operation remnants may be removed without separate user
  approval, including files from earlier tasks, after verifying both that they
  are reproducible and that no current build, running app, verification
  workflow, or other worktree depends on them.
- Preserve active incremental build caches and outputs required for current
  execution or verification. Being generated or Git-ignored alone does not
  establish that a file is unused or safe to remove.
- Protect source files, user data, uncommitted or untracked work, original
  materials and evidence, and permanent worktrees and branches. Discarding
  these still requires explicit user approval.
- Before deletion, verify each target's purpose, resolve its absolute path, and
  confirm it stays within the intended cache, build, or temporary-file location.
  Do not traverse junctions or symbolic links into another repository or shared
  cache.
- After cleanup, report the removed targets and measured storage reclaimed.


## External library data and reports (mandatory)

- `kimjeon-il/PandoLab-library-data` owns library objects, runtime data, original GIS sources and all reports/evidence. This repository contains app/web code, generators, contracts, fixtures, tests and development specifications only.
- The data repository is storage only. Do not run tests, validators, GIS regeneration or check workflows there. Run only narrowly relevant application checks in Pando.
- `config/library-data.json` pins the paired data revision for this branch. Run `node tools/library-data.mjs` to prepare the fixed ignored data cache and mounts. Never add mounted data to app Git.
- Stored reports belong to the external checkout's `reports/`, following its README and TEMPLATE. `tools/report-paths.mjs` and `tools/report_paths.py` share the central raw originals in the shared library root `reports/`, with explicit read/write access, `.owners.json` revisions, `.variants/<sha256>` editions and independent `.edits/<branch>` work. Runtime preparation must not restore all reports. Use `node tools/library-data.mjs --store --include-prefix=reports/<scope>` to archive selected changes; report-only storage leaves the runtime pin unchanged. Missing unhydrated reports are not deletions; explicit removals require `--remove-path=reports/<file>` after the original has been explicitly preserved elsewhere or removed from the working scope. Keep sources, revision, scope and unverified claims; preserve historical compressed evidence and all unique original bytes.
- Keep branch-specific data/WASM pairings; do not replace a work branch pin with main's pin without reviewing the actual data changes.

### Report task completion (mandatory)

- Writing or editing a report/evidence file is not task completion. After finishing the task's selected report scopes, run `node tools/library-data.mjs --publish-reports --include-prefix=reports/<scope>`. This single operation archives originals, commits only those reports to the shared library main, pushes, and verifies the remote bytes. Run it again after any later report edit, including final evidence updates.
- Use `node tools/library-data.mjs --check-reports --include-prefix=reports/<scope>` for a fresh completion check. Record the verified library commit and scope in the final response. A local file, local commit, or successful application deployment alone does not establish remote report archival.
- Publishing completed task-owned report scopes has standing user authorization. This does not authorize publishing unfinished drafts, other tasks' scopes, runtime data changes, private application commits, application main integration, or deployment. Keep branch-specific runtime pins and other work intact.
- Scope completion explicitly; never publish all reports merely to hide a missing selected scope. Do not publish on every file write or run a background full-project watcher. Report-only completion must not prepare/copy runtime datasets.
- If storage is locked, main diverges, or publication/remote verification fails, preserve originals and pending commits, report the exact incomplete step, and do not claim report completion. Do not remove another writer's lock, stash/reset work, force-push, or silently include unrelated unpublished history.


### Report subjects and independent editions

Use only `reports/borders`, `reports/hydro`, `reports/places`, `reports/terrain`,
`reports/map-analysis` and `reports/development` for new report scopes. Borders
use `history`, `reconstruction` and `validation`; hydro uses `names`,
`calibration`, `connectivity` and `releases`; map-analysis uses `corpus`, `models`
and `reports`; development uses `ui`, `rendering`, `performance`, `ci`,
`integrations`, `releases`, `storage` and `native`. Keep attachments with their
report and use Node/Python report helpers with these canonical paths; do not
recreate retired categories or legacy aliases. Keep runtime/GIS mounts fixed.
Runtime pins and report revisions are independent. Preserve each owner's
report revision and its `refs/pando/reports/<owner>` protection during runtime
preparation/storage and publish only explicitly completed report scopes.

## Historical GIS reconstruction policy (mandatory)

For **all historical borders, coastlines, reclamations, river boundaries,
territorial polygons and administrative boundaries**, read and follow
[docs/historical-border-reconstruction-policy.md](docs/historical-border-reconstruction-policy.md)
**before researching, digitizing, simplifying or validating geometry**.

- Prioritize macro territorial history: state formation, dissolution, division,
  merger and major territorial gains/losses. Verify the dates and ownership of
  the selected events.
- Match presentation detail to **Natural Earth 1:10,000,000 (1:10M)**. This is a
  cartographic generalization target, not a uniform positional accuracy,
  deletion distance, or a claim that modern data proves historical boundaries.
- Normally omit small parcel exchanges, minor boundary adjustments, deposition,
  erosion, river shifts and seasonal water-level/flow changes. Retain small
  events only when they explain state existence or historically important
  city/island attribution; record the reason for each such exception.
- Choose period-appropriate sources sufficient to reconstruct the major route.
  No detailed source scale is mandatory. Investigate finer maps only for a
  concrete important question; do not trace every bend or boundary marker.
- Compare generalized output with the Natural Earth 1:10M reference at the same
  extent and projection. Stop when the selected history and recognizable shape
  are supported and topology is valid. Maximum app zoom and subpixel deviations
  do not impose further historical reconstruction work.
- Preserve original evidence and master geometry. Generalize a separate display
  derivative, treating shared boundaries consistently and retaining required
  territories and connections. Do not automatically simplify existing vectors.
- Record sources, dates, scope omissions, important exceptions and actual checks.
  Distinguish visual review from independent measurement; never claim unrun
  checks passed. Renderer/mesh accuracy checks remain separate and unchanged.

## Project status

PandoLab is under active development and has no compatibility commitment to
older development builds, old saved-project files, retired schemas, retired
DOM structures, or previous internal APIs.

Unless the user explicitly requests compatibility for a specific format or
version, prefer breaking obsolete development formats over carrying legacy
support forward.

## Core engineering rules

### 1. Do not add legacy support

- Do not add backward-compatibility branches, deprecated aliases, fallback
  field names, old DOM selectors, duplicate APIs, old schema readers, or old
  behavior unless the user explicitly asks for a specific compatibility target.
- Do not add migrations for obsolete development-only project schemas unless
  explicitly requested.
- Do not preserve old saved-project formats merely because older builds may
  have produced them.
- Do not keep compatibility code "just in case".
- Do not keep both old and new implementations active after a refactor.
- When a model, field, API, selector, file layout, or workflow is replaced,
  update current callers and remove the obsolete form.
- Import/export code should support the current documented format only unless
  the task explicitly requires another format/version.
- Prefer deleting obsolete development compatibility code over extending it.

### 2. Do not create spaghetti architecture

- Before adding a new implementation, find the existing canonical owner of the
  same responsibility.
- Extend, replace, or simplify the canonical implementation instead of creating
  a parallel helper/service/controller.
- Each mutable piece of application state must have one canonical owner.
- UI, domain logic, persistence, rendering, data loading, and import/export
  must remain separate responsibilities.
- Avoid circular update paths where UI updates domain state which updates a
  second controller which writes back into the UI or original state.
- Avoid wrapper chains that merely forward calls without enforcing a real
  architectural boundary.
- Do not add a new abstraction merely to avoid modifying the correct existing
  module.

## Canonical ownership

- Keep one source of truth for selection, visibility, lock state, geometry,
  object identity, revisions, loading state, and editor/workflow state.
- DOM classes, `checked`, `dataset`, rendered elements, and presentation caches
  are not canonical application state.
- Rendering code must not mutate canonical project/model data.
- Model/service code must not directly manipulate DOM when a presentation
  layer already owns that responsibility.
- Do not keep multiple caches/maps representing the same fact unless their
  ownership and invalidation relationship is explicit.
- When duplicate state exists, consolidate it instead of adding synchronization
  code between duplicates.

## Reuse and replacement

- Search for an existing implementation before adding new code.
- If a new implementation supersedes an old one, remove the obsolete code,
  callers, exports, handlers, selectors, and tests in the same change when safe.
- Prefer deleting obsolete conditions over wrapping them in another condition.
- Do not leave dead aliases, retired state fields, unused exports, old event
  handlers, or duplicate code paths after a refactor.
- Do not create temporary compatibility wrappers unless the user explicitly
  requests a staged migration.
- Generated files are not source-of-truth files. Modify their source and
  regenerate them.

## Dependency wiring

- Required dependencies must fail visibly when missing.
- Do not use optional chaining to silently hide a missing required dependency.
- Verify service/domain/capability-port wiring against the actual implementation
  being called.
- Do not reuse a function only because its signature happens to fit if its
  semantics or ownership are different.
- Remove forwarding layers that provide no meaningful boundary.
- Keep object identity explicit. Do not casually mix:
  - `feature.id`
  - `properties.pandolab_id`
  - logical IDs
  - FIDs / `__fid`
  - source IDs
  - display IDs
- Convert between ID domains explicitly at well-defined boundaries.

## Async and errors

- Every Promise started from an event handler must be awaited or have an
  explicit rejection handler.
- Do not use bare `void asyncFunction()` unless that function contains its own
  complete error boundary.
- Expected operation failures should be handled by an operation-specific error
  boundary and error code.
- `PL-RUNTIME-001` is a last-resort global safety net, not normal control flow.
- Do not swallow unexpected failures with only `console.warn()`, `null`, or
  `false` when the caller needs to know the operation failed.
- Worker errors must propagate to the responsible operation layer with enough
  context to identify the failed operation.
- Preserve the underlying technical error in diagnostics even when the
  user-facing message is simplified.

## UI and interaction

- Do not create a second application state in DOM attributes or CSS classes.
- Event handlers should call the canonical command/workflow entrypoint rather
  than reimplementing domain logic.
- When a UI action starts an async workflow, handle failure at the UI/domain
  boundary instead of letting it become an unhandled rejection.
- Keep responsive layouts on the same behavioral model; do not implement
  separate desktop/mobile business logic unless strictly necessary.
- Do not retain old selectors or alternate DOM paths for removed UI.

## Rendering

- Keep one visual owner for each rendered geometry whenever possible.
- Do not let SVG, Canvas, and WebGL independently render and own the same visual
  state without an explicit ownership/fallback rule.
- Renderer code may derive presentation data but must not become the canonical
  owner of project data.
- Cache invalidation must be explicit and tied to a canonical revision/source.
- If a renderer path replaces another renderer path, remove the obsolete visual
  ownership path rather than keeping both active.

## Refactoring discipline

Before a non-trivial change:

1. Locate the current canonical owner of the behavior.
2. Find all direct and indirect callers.
3. Check related state, event handlers, workers, persistence, and tests.
4. Check whether another implementation already performs the same job.
5. Decide whether to modify, replace, merge, or delete existing code.
6. Implement the smallest coherent change.
7. Remove obsolete code created by that change.
8. Verify the real affected workflow.

Do not perform unrelated broad refactors in the same change unless they are
required to remove a duplicated or obsolete implementation introduced by the
change.

## Testing

## Testing and verification

- Run only the checks that are relevant to the files and behavior changed.
- Do not run the entire test suite, all architecture checks, or unrelated
  validation commands by default.
- Choose the smallest set of checks that can reasonably detect regressions
  caused by the current change.
- Expand the test scope only when:
  - the change crosses multiple architectural boundaries
  - shared infrastructure was modified
  - a relevant focused test fails
  - the affected dependency graph is broad
  - the user explicitly requests a full verification

Examples:

- CSS/UI-only change:
  run the relevant UI checks and focused browser test if interaction changed.

- Local JavaScript logic change:
  run lint/checks for the affected code and the relevant unit tests.

- Browser interaction change:
  run the focused Playwright test for that workflow.

- Worker/rendering change:
  run the relevant worker/renderer checks and focused regression tests.

- Project-wide architecture or shared-state change:
  run broader architecture and unit checks as justified by the impact.

- Do not run expensive unrelated tests merely to increase the number of
  passing checks.

- Tests must verify actual behavior, not merely DOM existence.
- Editing tests should verify resulting model/geometry/state and undo when
  applicable.
- Add a focused regression test for a reproduced bug when practical.

### Keep tests aligned with the current implementation

- Updating affected tests is a required part of every behavior, model, schema,
  API, dependency-wiring, Worker-payload, or asset-version change. Update test
  fixtures, mocks, assertions, snapshots, and test names in the same change;
  do not defer this work to a later cleanup.
- Find tests for direct and indirect consumers before changing a contract.
  Use current canonical model factories and real services where practical.
  Test doubles must provide the actual required dependencies and current
  payloads, not retired fields, APIs, or duplicate model logic.
- When replacing a contract, update its tests and remove obsolete assertions.
  Preserve valid checks for invalid input, locks, atomicity, geometry results,
  and Undo/Redo. Prefer observable behavior over source-text or formatting
  assertions when the behavior can reasonably be exercised.
- Investigate failures before changing expectations. Confirm whether the
  implementation regressed or the intended contract changed. Do not blindly
  update snapshots, weaken assertions, skip tests, or restore legacy product
  behavior merely to make a test pass.
- During merges, rebases, and integration, review affected test diffs as well
  as product diffs. Preserve previously accepted test fixes and ensure test
  expectations match the final integrated behavior and asset versions.
- Run the smallest relevant checks for the updated tests. Keeping tests current
  does not require running the full suite or unrelated expensive checks.

- A task is not complete merely because the selected checks pass.
  Verify the affected user workflow when the change alters user-visible
  behavior.

## Completion standard

A task is complete only when:

- the canonical implementation is clear
- no unnecessary parallel implementation was introduced
- obsolete code from the change was removed
- no unnecessary legacy support was added
- async failures are contained at the correct boundary
- relevant tests/checks pass
- affected tests use the current contracts and retain valid regression coverage
- the affected user workflow was actually verified
- only checks relevant to the actual change were run; unrelated expensive
  checks were not run without a concrete reason

## Default decision rule

When choosing between:

A. adding another fallback, wrapper, compatibility branch, deprecated alias,
   or parallel implementation

and

B. simplifying the canonical implementation and updating current callers

prefer **B**.

Use **A** only when the user explicitly requires a concrete compatibility
target.
