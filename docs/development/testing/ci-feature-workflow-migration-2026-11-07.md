# Feature-owned CI migration — 2026-11-07

Branch: `work/optimization`. No test suite or Actions workflow was executed during this change.

## Retired wrappers

- `.github/workflows/remote-development-p1.yml`
- `.github/workflows/remote-preview-p3.yml`
- `.github/workflows/remote-only-gate.yml`

Their one-off change classifiers and CI WASM cache (`p1-plan-remote-checks.mjs`, `p3-plan-remote.mjs`, `remote-only-ci-scope.mjs`, `remote-only-wasm-cache.mjs`) were removed. Live Codespaces preflight and its native-prohibition policy were preserved.

## Current owners

- `application-architecture.yml`: source-selected Node, native prerequisites and browser verification; `workflow_call` from the Viewer preview.
- `shared-core.yml`: source-diff-selected C++ Core/GIS tool builds on work branches, existing main and manual Core contracts retained.
- `generated-artifacts-p2.yml`: source-hashed WASM compilation, immutable data build and guarded publication. Dispatches `viewer-preview.yml` with exact result and source commits.
- `viewer-preview.yml`: branch-only static snapshot on source changes; defers until artifact publication when inputs are stale; manual specialized Chromium startup and calculation performance evidence remain available.
- `web-pages.yml`: unchanged main-only production deployment.

## Integrity and validation limitations

Workflows decreased 74 → 72 (three removed, one functional replacement).
The obsolete workflow name references were removed from active workflow sources and the central planner. Existing `p3-preview-server.mjs` and its safety tests are retained because they serve the live Codespaces dev server; they are not the deleted P3 CI pipeline.

The new workflow's `workflow_dispatch` entrypoint must exist on the repository's default branch before a P2 `gh workflow run viewer-preview.yml` handoff can operate. Until main adopts these changes and active work branches receive them, that handoff is not operational. No main merge or deployment was performed.

No unit, browser, native, integration or CI execution was performed; actual pass/fail and runtime effect are unverified.
