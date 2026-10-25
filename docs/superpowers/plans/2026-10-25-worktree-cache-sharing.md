# Permanent Worktree Cache Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share immutable staging and compiler outputs across the five permanent worktrees and actually remove verified redundant copies.

**Architecture:** Keep library-data as library owner; extend its immutable content primitives with explicit owned external views. A worktree-storage owner manages application blobs, local compiler-cache activation, recovery and inventory; existing stage/build/cleanup entrypoints use it.

**Tech Stack:** Node.js, PowerShell, pnpm, NTFS hardlinks, sccache 0.19.0, Cargo and CMake/Emscripten.

**Spec:** ../specs/2026-10-25-worktree-cache-sharing-design.md

## Global Constraints

- Preserve all permanent branches, worktrees, WIP, runtime pins, active incremental builds, SDKs, Python/training environments and original evidence.
- Application blobs: `D:/build/cache/pandolab/blobs`; compiler cache: `D:/build/cache/pandolab/sccache`, initial cap **2GiB**.
- sccache tool: `D:/build/toolchains/sccache/0.19.0`; ZIP SHA-256 `28be8c61f6b2c89b9eb2869f6af7f78e6f992e78a8abae0ce855fcc129cbeac1`.
- Peak additional initial budget **3GiB** plus **5GiB** free headroom; recheck before applying.
- No installers, training, published WASM regeneration, history expiration/prune, main integration or deployment.
- Report scope: `reports/development/storage/permanent-worktree-cache-20261025`; publish and freshly check that scope.

## Review Focus

- Windows readonly hardlink deletion must restore pool and remaining views after interruption (Task 1).
- A root or nested junction must never redirect apply outside an owned destination (Tasks 1 and 4).
- Existing different wrappers/server configuration must fail without modifying them (Task 2).
- Stale hashes, active stage/build writers and branch-private bytes must be preserved (Tasks 3 and 4).
- Path normalization must not change observable `__FILE__`, `file!()`, `env!()` or dependency paths (Task 5).

### Task 1: Explicit immutable view ownership and recovery

**Files:** Modify `tools/library-content.mjs`; test `tests/unit/library-content.test.mjs`.

**Interfaces:** Preserve current string-root API. Add explicit store configuration `{root, blobDirectory, viewRoots}` for owned application stores, and external-view operations `linkContentView`, `removeContentView`, `makeContentViewPrivate`, restricted to an existing plain ownership marker. Library pool paths remain unchanged.

- [ ] Add failing tests: external owned views share IDs; writes fail; private edits isolate; unknown markers, root/nested junctions and corrupt pool bytes fail; interrupted permission recovery restores readonly.
- [ ] Run `node --test tests/unit/library-content.test.mjs` and observe RED.
- [ ] Implement scoped external views using the existing content owner, with permission journal including exact target/store ownership.
- [ ] Run the same focused test and observe GREEN; commit task-owned files.

### Task 2: Local compiler-cache owner and build entrypoints

**Files:** Create `tools/worktree-storage.mjs`, `tools/compiler-cache.ps1`, `cmake/compiler-cache.cmake`, `tests/unit/worktree-storage.test.mjs`; modify `config/toolchain-versions.json`, `CMakeLists.txt`, App `dev.ps1`, `src-tauri/build-android.ps1`, `packaged-artifacts.mjs` and native test entrypoints found by caller search.

**Interfaces:** `compilerCacheEnvironment({root,env}) -> env`; CLI `--activate-compiler-cache`, `--compiler-env`, `--with-compiler-cache -- command args`. Read local activation from common Git config; verify tool version/digest, cache size, owned server endpoint; preserve current incremental settings and fail on conflicting wrappers.

- [ ] Add failing tests for unconfigured hosts, exact environment, independent targets, wrapper conflicts, corrupt/missing activated tool, command exit propagation and local activation ownership.
- [ ] Run `node --test tests/unit/worktree-storage.test.mjs` and observe RED.
- [ ] Implement compiler setup and standard entrypoints without changing shared source fingerprints; no global environment mutation.
- [ ] Verify tests GREEN, parse PowerShell, inspect CMake configure on the fixed probe path; commit.

### Task 3: Share immutable App staging

**Files:** Modify `apps/web-shell/stage.mjs`, `tools/worktree-storage.mjs`, `tools/library-data.mjs`; add focused tests in `apps/web-shell/tests/stage.test.mjs` and `tests/unit/worktree-storage.test.mjs`.

**Interfaces:** `writeStagedContent({root,directory,path,bytes,source})`, `removeStagedDirectory({root,directory})`. Existing stage lock/ownership remains authoritative. Library source reuse validates record hash and file ID; private inputs use app immutable snapshots. Existing synthetic tests remain isolated and never access real host cache.

- [ ] Add failing tests: two independent stages share IDs; staging deletion preserves readonly peers; modified/private source does not leak; unknown outputs and active lock survive.
- [ ] Run the focused tests RED; integrate snapshot/pool reuse and permission-safe stage removal.
- [ ] Run `node --test apps/web-shell/tests/stage.test.mjs tests/unit/worktree-storage.test.mjs tests/unit/library-content.test.mjs` GREEN; commit.

### Task 4: Preview/apply and actual migration

**Files:** Extend `tools/worktree-storage.mjs`, existing `tools/cleanup-reference-analysis-caches.ps1`; test `tests/unit/worktree-storage.test.mjs`.

**Interfaces:** CLI `--preview` (default) / `--apply` enumerates permanent worktrees and only recognized owned stage outputs; explicit hash/identity journal records each conversion. Cleanup script `-WorktreeStorageOnly [-Apply]` dispatches this owner. Inventory lists protected generated outputs separately. `--resume` repairs journaled operations before new mutation.

- [ ] Add failing synthetic tests for stale records, active process/lease, path escapes, interruption before/after link replacement, idempotent apply, peak limits and byte accounting.
- [ ] Implement and run tests GREEN; commit.
- [ ] Recheck all WIP, pin/mount/process/lease state and free space; install verified sccache and activate local compiler cache.
- [ ] Preview/apply active stage sharing, pnpm native-store reuse and verified obsolete generated outputs; record every applied/skipped target with exact reason and bytes. Never remove unique or active data.

### Task 5: Real consumers, compiler probes and completion

**Files:** Add `tools/verify-compiler-cache.mjs`; document commands in `docs/worktree-storage.md`; update this plan's execution ledger.

**Interfaces:** Small actual C++/Rust library probes in fixed `build-native/cache-probe` in two existing roots. Check hit/miss stats, changed source/header/options, execution, dep-info and macro/environment identity; do not normalize unsafe paths merely to get hits.

- [ ] Run actual compiler and staging/development-file reads; verify unchanged runtime pins, existing WIP, source and staged bytes, readonly IDs and separate writable state.
- [ ] Review whole branch with a fresh reviewer, address important findings with focused regression tests.
- [ ] Remove own probes/downloads, completed journals and verified unused copies; retain only currently consumed build caches and audit evidence.
- [ ] Measure logical removal, file-ID deduplication and D: free-space change separately; publish selected report and run fresh `--check-reports`; commit and push task-owned source branch.

## Execution ledger

- Design approved by user on 2026-10-25. Native in-session execution follows the existing implementation request; no further plan approval round is needed.
- Baseline: clean work/objects at `83a2e102`; other branches at synchronized `93b6e1b1`; UI WIP protected. All five materialized runtime mounts verified at `127e51c3`; sampled manifest has identical readonly file ID across views.
- Task 1 complete: `95d6df0b`; immutable view tests RED to GREEN, 7/7.
- Task 2 complete: `42bf5bc5`; compiler environment/exit tests RED to GREEN. Official archive installed and owned server reports 2GiB at port 42427.
- Task 3 complete: `66a48d88`; actual stage ownership/read-only/private copy tests GREEN with existing stage tests.
- Task 4 implementation and first apply complete: 3,630 staged files converted, all five pnpm lockfiles unchanged; independent views use one native store. Extra 803 app blobs identical to archived library bytes were replaced and removed: 253,035,104 logical bytes, measured +254,701,568 drive bytes for that prune operation.
- Task 5 in progress: 34 focused tests pass; 11 actual native/Rust/CMake probe scenarios pass and probe output directories removed.
- Ruling: keep Rust cwd in its native key and test shared registry-style dependency source/cwd with separate branch outputs — sccache 0.19.0 deliberately keys workspace cwd; weakening it would risk wrong macro/debug paths. Branch workspace incremental state remains independent; cross-workspace crate cache hits are not promised.
- Ruling: share source-identified retired Qt runtime SDK files without removing unique SDK bytes or their logical replay paths — original Qt 6.8.3 installation is not currently available, so deletion of unique SDK bytes would lose local recovery. Unknown-identity runtime folders remain protected.
- Interrupted migration re-preview: owned app hardlink removal changes the peer inode ctime. Regression now checks file ID/size/mtime/hash for known owned app links while retaining full identity checks for private files. Interrupted journal resumes are tested after a target unlink.
- Pnpm offline-only install found missing locked packages; repaired using frozen lockfile and prefer-offline imports, with lifecycle scripts disabled. No package version or lockfile changed.
- Final review: fresh read-only reviewer reviewed `93b6e1b1..087ecae0`, independently confirmed 34 focused tests, found two blocking recovery defects and one minor C-only launcher conflict check.
- Final: fixed pending-journal blob GC protection — sole recoverable blob regression RED to GREEN; full relevant suite 36/36.
- Final: fixed dead migration stage lease recovery and lease acquisition during journal resume — actual child process termination regression RED to GREEN; full relevant suite 36/36. Unknown/live-owner locks are preserved.
- Final: minor (deferred): CMake checks configured C++ launcher conflicts but not an independently configured C launcher from CMake cache. Current root enables only CXX, so no current C compilation is affected; a future C-language target needs that guard before using this integration.
- Final: Ruling: verify ongoing operations and compiler/tool provenance with direct local evidence rather than reviewer reruns — review was read-only and deliberately excluded ongoing apply/install/push; actual audits, hashes and command results remain completion evidence — a missing operational check would invalidate only that completion claim and must remain disclosed.
- Ruling: Emscripten 4.0.20 internal Clang is correctly wrapped but sccache bypasses unsupported `-Xclang` flags — preserve compiler semantics rather than changing flags for hits — WASM gets no compiler-cache speedup with this pinned tool; native C++ and Rust cache sharing remain verified.
