# AGENTS.md ? PandoLab / world-map

These instructions apply to the entire repository unless a deeper `AGENTS.md`
or `AGENTS.override.md` provides more specific rules.

## Branch and permanent worktree policy (mandatory)

Read [docs/branch-policy.md](docs/branch-policy.md) before choosing a branch or
local worktree. These rules apply to this repository and its independently
managed Web/App counterpart:

- Reuse the long-lived branches `work/ui`, `work/objects`, `work/gis`, and
  `work/places` according to the task's primary purpose; `main` is the
  stable integration branch.
- Before local changes, run `git worktree list --porcelain` and inspect the
  assigned worktree's branch, `git status --short --branch`, and uncommitted or
  untracked files. Reuse the existing permanent worktree for that branch.
- Create a permanent worktree only if it does not yet exist and is needed for
  local work. Do not generate new branches/worktrees per task by default.
- After a task, leave the worktree in place for the next task. Do not
  automatically delete/prune worktrees, branches, directories, caches, or
  locally generated files.
- Never discard unrelated or uncommitted work, including via automatic stash,
  `git clean`, `git reset --hard`, force checkout, force push, or force
  worktree removal. Request explicit user approval for destructive operations.
- Synchronize the latest `main` **into** the appropriate `work/*` branch
  only after checking the local and remote state; preserve unfinished work and
  resolve conflicts without silently choosing one side.
- Never merge `work/*` into `main`, commit directly to `main`, deploy, or
  transfer changes between categories without explicit user instructions.
- Web and App are separate repositories: matching branch names do not imply
  matching code or commits. Verify and maintain each repository independently.
- Exception branches or temporary worktrees require a concrete need and user
  approval. Do not delete them automatically after integration.


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
