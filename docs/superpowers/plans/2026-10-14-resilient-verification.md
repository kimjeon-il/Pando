# Resilient verification implementation plan

**Goal:** Keep checks stable across behavior-preserving refactors while detecting broken runtime contracts.

**Architecture:** Use the existing production contracts and fixture owners. Source checks inspect syntax and dependency boundaries; behavior tests keep independently specified results. CI calls one importable selector rather than embedding and re-parsing programs.

**Spec:** User-approved proposal in this conversation, 2026-10-14.

**Constraints:** Reuse work/objects; preserve unrelated work and report paths; run only focused checks; no full CI or deployment. One subagent at most. Existing data provenance and invalid-input/atomicity/Undo coverage remain.

- [x] Implement `parseJavaScript(source, options)` and `walkJavaScript(sourceCode, visitor)` with ESLint; verify comments, formatting, aliases and syntax failures using small fixtures.
- [x] Replace Worker/version implementation-string assertions with AST dependency rules and existing runtime contract checks.
- [x] Parse CSS structure with PostCSS and derive current UI bundle requirements from its source catalog; keep deliberate CSS policies.
- [x] Improve shared-core prerequisite diagnostics and run preflight once before dependent CI suites.
- [x] Replace representative UI/Native source-format assertions with structural or runtime contracts, preserving relevant behavior checks.
- [x] Extract CI scope/browser planning to `scripts/plan-application-checks.mjs`; test inputs and outputs and YAML semantics, remove PR-specific automatic concurrency.
- [x] Verify each changed check family once after its changes; expand only for a concrete failure. Review the final diff for weakened expectations and duplicate inventories.

Verification is limited to parser/check regressions, existing Worker/version consumers, affected UI/Native guards, CI planner tests, lint on changed files and diff checks. Native execution is reported separately from JS checks of native source. No whole application suite is implied.

## Verification result

- Worker/schema ownership, UI architecture/layering/components/information checks and actual shared-core preflight passed.
- CI planner/YAML behavior: 17 tests passed; actual mesh transfer/detachment: 1 passed.
- Focused Worker, project schema/serialization, parser/CSS, import, Native source-boundary and actual WASM document tests passed.
- The stale Worker fixture initially failed because it lacked the browser WASM loading port. Connecting the current verified Node port restored all 10 lifecycle cases in about 2.2 seconds.
- Final review caught an import-dependent Worker ownership bypass. The guard now applies independently of imports; dedicated ownership is declared with a reason in the canonical source, and a focused regression covers removed/barrel imports.
- No full suite, remote CI, Qt execution, native compilation or deployment was performed. Native source guards do not imply a passing Qt workflow.
- Remaining source-text tests outside these affected families are unchanged. This change reduces their shared causes of drift without claiming an exhaustive conversion.
