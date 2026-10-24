# Central library reports implementation ledger

Goal: move original reports and private evidence into the shared library, remove verified duplicate working copies, and keep branch edits isolated.

User-approved plan: central `reports/` contains full originals; `.variants/<sha256>` preserves other editions; `.edits/<branch>` contains actual unfinished work; private originals move to `private-evidence/<owner>/<source revision>`.

## Execution

- Existing permanent workspace: `D:/dev/worktrees/ui`, `work/ui`; main is already an ancestor. Preserve unrelated application/map-settings changes.
- Task 1: implement/test central ownership, read/write access, verified migration and report-only storage.
- Task 2: update consumers, server and scoped cleanup command; update current tests and documentation.
- Task 3: preview, apply relocation/deletion, verify every retained source hash and all branch reads, remove obsolete outputs, report measured bytes.
- Final review and focused verification before completion.

## Rulings

- Source evidence and historical archive revisions remain recoverable. No worktree, runtime dataset, WASM pairing or unrelated source is removed.
- Read directory requests may materialize only that requested subtree when a branch differs; these views are reproducible and explicitly accounted for by the cleanup command.
- Raw reports are stored directly in the data Git tree; old archive entries are still decoded according to their recorded encoding because existing pins are preserved.
- The data repository runs no tests or generators. All migration/storage commands execute from PandoLab.
- An inactive unfinished edition is preserved as a variant. Only the registered active unfinished source becomes a branch edit, so old work cannot override the current archived edition.
- Other chats may write independent central edits during this operation. Their files and unrelated staged app changes remain outside the publication scope.

## Evidence

- New regression fixture uses genuine app/data Git worktrees; initially fails because centralization is not implemented.
- Canonical storage/helper/cleanup changes and affected consumer deltas installed in all five existing permanent worktrees; no branches merged and no app code committed by this task.
- Serial centralization, library-data and report-path tests: 18 passed. After atomic recovery metadata changes, three focused recovery/migration cases passed again.
- Preview/place runtime cases: nine passed. Reference-cache cleanup test passed separately; seven Python macro cases and training-tool imports passed in the existing environment.
- Actual scoped apply re-inventoried 22,325 source files, including concurrent additions. Moved 1,094,536,674 bytes and deleted 4,027,913,140 duplicate bytes; measured drive free-space increase during apply was 3,433,054,208 bytes.
- All five legacy `.working` directories and completion markers removed. Independent verification matched every source to 3,798 retained destinations; all five runtime pins/mounts, library metadata, non-report archive entries and WASM hashes remained unchanged.
- Nine branch reads, Python read access, five HTTP serving/private-path checks and actual macro-v2 ONNX graph loading plus HEAD/206 range bytes passed. Parent/child directory-view ownership regression was reproduced and fixed; both view cases passed.
- Source acquisition, image preparation, corpus and publisher CLI paths now use the same owner. Their 22 focused Python tests passed; the five current Python helper tests and one actual historical-report consumer passed. The latter retried once after an independent prepare lock ended.
- Raw originals stored in data commit `c50b9cdb4b09dd3c3bae786d901b2c2b403688de`; final audit evidence stored in data commit `547ce5e6d57c4c47093bc470fedf9ec9e71c4b56`. App changes remain unstaged alongside preserved concurrent work.
- Audit: `D:/dev/PandoLab-library-data/reports/reference-analysis/library-centralization-20261024/README.md`. Temporary evidence edits were byte-compared with both Git and central files, then removed (40,448 bytes). Required repeated logical paths total 16,851,901 bytes; independent editable work and model-specific evidence paths remain separate.
