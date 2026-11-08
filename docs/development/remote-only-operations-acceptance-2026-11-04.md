# Remote-only operations acceptance — 2026-11-04

Source: `work/remote-only`; immutable implementation baseline
`9c2d7f1d379a31c384491073ff23f6bb6ab7d88b`. This document is a documentation-only commit
probe, **not** a runtime or artifact modification.

## Confirmed remote CI results

- The full ordinary P3 web-contracts job passed on the implementation
  baseline: https://github.com/kimjeon-il/Pando/actions/runs/41847728306
  The earlier `ceb8431` P3 run was cancelled when a source fix was pushed
  and is not represented as a pass.
- Remote-only contract tests verify local native/SDK blocking, detached-HEAD
  policy, immutable artifact ownership, modified-byte refusal and resumable
  cleanup. Contract run:
  https://github.com/kimjeon-il/Pando/actions/runs/41847728215
- C++ GIS, ABI/source-verified WASM cache reuse and desktop WebGL / mobile
  Canvas Worker integration were exercised by the same remote-only workflow.
  Reusing WASM did not skip its GIS/Viewer regression checks.
- Windows **same-commit cache reuse** was proven on `ceb8431` with the
  successful rerun of the Windows job: the exact cached executable was
  validated, Rust compilation skipped, and the real WebView2 GUI rechecked.
  https://github.com/kimjeon-il/Pando/actions/runs/41844594642

## Actual documentation-only push probe

The commit adding this Markdown file changes no non-document inputs.
The remote-only scope job must emit `run_heavy=false`; its
`wasm-compile-and-smoke`, `windows-real-webview2` and dependent
`viewer-map-integration` jobs must be marked **skipped**, while the
lightweight `contract` job continues to pass. Ordinary P1/P2/P3
source-aware planners should also avoid unnecessary compilation and
browser regression. The push workflow itself is the authoritative
evidence, not a simulated invocation of the scope planner.

A manually dispatched full acceptance remains allowed; documentation-only
automatic skipping does not override explicit verification requests.

## Cleanup and remaining limits

- `node tools/data/worktree-storage.mjs --retire-native` is a **dry-run**.
  `--retire-native --apply` retires only unreferenced, immutable,
  manifest-verified native views and requires a separate opt-in.
  `--prune-blobs` has its own independent dry-run/apply and digest guards.
- Test fixtures demonstrated protection of referenced artifacts,
  interruption/resume journals, unexpected-file refusal and blob retention
  until independently checked. No actual user PC paths have been scanned
  or deleted by this migration; physical freed GiB remains unknown.
- Project-owned entrypoints reject local SDK/bootstrap and native preparation
  on this branch. This cannot block arbitrary external OS commands.
- Codespaces *live editing and automatic reload* still require a real
  Codespaces terminal execution, independent from these GitHub Actions tests.
- CI caches and short-lived Actions artifacts are reproducible acceleration,
  **not** the permanent home of unique GIS originals or release evidence.
- No `main` merge, public Pages deployment, plugin update, or local
  SDK/cache deletion was performed as part of this acceptance.
