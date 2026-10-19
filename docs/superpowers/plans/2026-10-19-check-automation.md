# Code and check automation implementation plan

Spec: user-approved plan in the conversation, 2026-10-19.
Goal: one application check catalog, one dependency selector and one execution path for local and CI.

1. Discover all current unit/browser tests; classify automatic checks and named manual diagnostics. Fail missing references, unknown tests and unclassified product changes. Reuse current AST and runtime asset catalogs. Prove selection via failing regression tests first.
2. Add check:affected / --list / --base; compare local merge-base plus staged/unstaged/untracked and CI event SHAs. Reject unavailable history. Deduplicate prerequisites/commands and propagate failures. Wire existing P1/P3/application CI without changing native/artifact ordering.
3. Remove replaced YAML/selector lists. Keep independent expectations, current factories and asset preflights. Run focused selector/runner/CI tests and representative actual product workflows; record existing failures accurately.

Constraints: reuse work/ui; preserve unrelated WIP; no hooks/watchers, automatic expectation updates, main integration, remote publication or public deployment. Native and research workflows keep their existing owners. Reports belong in reports/ and its index.
