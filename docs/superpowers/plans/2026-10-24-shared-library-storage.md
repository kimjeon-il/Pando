# Shared library storage execution ledger

Goal: finish the user-approved relocation, active-cache sharing and verified deletion outside legacy .working, preserving every unique original and all branch runtime/WASM pairings.

## Approved design and tasks

- [x] Immutable SHA-256 content pool; readonly hardlinked files, private writable copies and interruption-safe unlink/replacement.
- [x] Per-owner runtime views, JS/Python scoped write leases and affected producer/staging consumers.
- [x] Scoped library cleanup preview/apply, resumable file migration and offline Git object repacking without losing any local object.
- [x] Focused regression checks and final fresh-context review; actual Web/App consumer checks remain in the apply step.
- [x] Actual shared-library relocation/deletion, independent byte/file-ID/runtime/Git verification, evidence storage and temporary cleanup.

## Constraints and rulings

- Reuse D:/dev/worktrees/ui and every existing permanent worktree. Preserve unrelated WIP, including ongoing macro/QGIS work. Do not merge, push, deploy or build WASM/packages.
- The data repository is storage only; invoke every migration, check and test from PandoLab.
- The immutable content implementation is a file primitive used by the existing library-data owner. A separate scoped cleanup module owns the one-off migration/Git maintenance; it does not introduce a second runtime data owner.
- Ruling: a formerly shared dirty cache is visible to every owner that mounted it. Preserve those exact visible bytes in each owner's independent view rather than guessing which branch authored them.
- All physical deletions require a retained byte/hash-equal copy or verified local Git recovery; unknown unique data remains protected. No full-repository backups.
- Whole-branch final review only, as required by executing-plans. No implementer subagents.

## Evidence

- Core/storage/runtime focused tests: 13/13 passed, including Python scope writes, all-local-object/unreachable/promisor preservation and actual old-cache deletion in synthetic repositories.
- Content/publisher/consumer focused tests: 21/21 passed before review fixes; final affected report/staging checks running.
- Final fresh-context reviewer found four Important issues plus stale locks. Fixed in one pass: current owner edits and conflicting legacy editions are both preserved; disk peak includes private/extra copies; Git restore paths explicitly disable lazy fetch; missing repack staging is resumable; verified dead lock owners can be reclaimed. Each reproduced RED before its fix and the 13/13 focused run then passed.
- Python preview/report checks: 10 passed; unchanged DEM numerical tests cannot import rasterio in the existing Python environment. No environment was reinstalled for an I/O wrapper change.
- Live preview found concurrent GIS pin advancement and a fourth legacy cache. Ruling: apply snapshots the latest pins and bytes rather than enforcing the older investigation snapshot, so unrelated ongoing work is preserved.
- Final focused core/report/runtime/storage/App suite passed 57/57. A real Web mount regression reproduced HTTP 403, then passed after restricting the external-read exception to that owner's configured runtime paths; unrelated external junctions remain forbidden. Its focused regression and the 20 affected Web/App checks passed.
- Installed 44 task files across the other four permanent worktrees (176 installations), plus the Web resolver follow-up. Branch-specific GIS generator WIP was patched in place; every target was hash-guarded and all initial branch source versions were compared. No app commit/push/merge/deployment was performed.
- Actual apply completed at 2026-10-24T16:25:02.355Z with operation 74bb763e-dfdf-45a3-9ebf-310b19c87104. It retained 14,455 local objects, replaced four legacy caches and verified 3,991 immutable report/private originals plus 12,557 runtime files. Deleted 15,024 files / 10,553,802,221 logical bytes; file-ID payload reduction was 7,265,687,829 bytes and measured D: free-space increase during this phase was 4,468,162,560 bytes. These are different metrics.
- Full private audit records and historical migration/finalize indexes live under D:/dev/PandoLab-library-data/private-evidence/storage-migrations/74bb763e-dfdf-45a3-9ebf-310b19c87104/. The cleanup command now stores and seals its audit beside those private indexes rather than leaving diagnostic copies in unfinished report edits. Focused storage tests passed 2/2 after this change.
- Final readonly/COW/selective-partial-clone regressions were narrowly installed into the four other existing worktrees without transferring concurrent report-organization implementation. The focused 34-case check passed 32 cases in the main run; its two Python checks passed separately after specifying their existing runtime variables. No environment was reinstalled.
- Later concurrent GIS generators used real write leases to detach their scope and edit private files while peer views and original pool bytes remained unchanged. Later WASM builds by other tasks are recorded separately from the migration checkpoint; no rollback or build was performed by this task.
- Independent verification confirmed all original editions, old-cache recovery bytes, immutable pool hashes, runtime file IDs and private isolation. All original local Git objects survived and full Git fsck passed. Consumer verification resumed after the concurrent report-organization transaction; real Python originals, Web original/runtime HTTP and App map-data staging/HTTP all passed. The existing App development server completed its normal file-watch refresh, error=null, and served the same runtime hash without restarting its native workflow.
- Final immutable topology check at 2026-10-24T17:49:32.280Z covered 15,395 readonly view files with zero unexpected readonly duplicates. Mutable equal-byte copies remain independent by design; the earlier full duplicate scan accounted for 83,044,452 extra payload bytes in writable branch edits and metadata. Active GIS output scopes were preserved and excluded from claims about finished new content.
- Final audit, phase snapshots, complete deletion list and source-install provenance are in the private evidence folder linked above. Removed 24 task-owned temporary files / 17,845,278 bytes after comparing retained audit copies. Final D: free space measured immediately after this cleanup was 33,006,985,216 bytes; the net change since apply start was 3,398,180,864 bytes including later concurrent work. The migration-only measured increase remains 4,468,162,560 bytes. No migration journal, repack staging, verification server or own temporary script remains.
- Ruling: immutable assembled report read views share the pool too. Direct writes are rejected; deliberate independent replacement remains detectable and protected. Existing callers already request independent write paths, so this removes another original-byte duplicate without changing their logical paths.
