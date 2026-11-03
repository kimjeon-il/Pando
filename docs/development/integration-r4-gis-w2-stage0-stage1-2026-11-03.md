# R4 / GIS / W2 temporary integration — Stage 0/1

Date: 2026-11-03. Repository: `kimjeon-il/Pando`.
Temporary integration branch: `integration/r4-gis-w2-20261103`.
Frozen source baseline: `main@b917ddb7485f4bab3446aa31050270f5b2aa7a45`.

## Stage 0 — audit and scope freeze

The latest `main` is a descendant of every reviewed source branch below. GitHub compare `main...<branch>` returned **ahead=0** for each branch, so there is nothing to merge or cherry-pick into the integration branch:

- `work/gis` (behind 108), `work/ui` (behind 161), `work/objects` / `work/places` (behind 247 each).
- `work/w2-p6-3-geometry-delta-20261103` (behind 190).
- `work/r4e0-dependency-audit-20261103`, `work/r4e1-gis-interop-20261103`, both `work/r4e2-*` and both `work/r4e3-*` branches; all ahead=0.
- `fix/r1-*`, `fix/r2-*`, `fix/r3-*`, `fix/r4-*`, `work/r4-editor-source-retirement-20261102`, `work/r4d-editor-test-ci`; all ahead=0.

These comparisons cover **committed remote history**, not unrelated uncommitted local worktree changes; no uncommitted work is discarded. No force pushes, old-branch rewrites, `main` changes or production deployment are part of these stages.

## Stage 1 — integrated GIS and Python-free baseline

Since the GIS commits are already included in the baseline, the Stage 1 deliverable is verification on that same immutable source tree, not a second merge.

- Project-owned tracked Python scripts and Python interpreter invocation have already been retired according to `docs/development/gis-python-p4.md`. Verify this independently through the repository's executable regression `tests/unit/python-bridge-retirement.test.mjs`, which checks tracked file extensions, GitHub workflows, package scripts, CMake/shell entrypoints and project-owned JS launch points.
- Run `gis-source-isolation` and `gis-source-launcher` tests, and the synthetic 36-source-member hash-failure test `p1-hydro-source-receipts`; the latter is **not** verification of the official original 36 files.
- Validate GIS source dry-run dispatch with no `--execute`; build and test the configured C++ `pando-core` and `pando-gis-tools` presets.
- Execution recipe: `.github/workflows/integration-r4-gis-w2-stage1.yml`, scoped to the temporary branch. Tests have to be judged from their actual GitHub Actions result, not from the existence of this file.
- The application source currently pins external library `PandoLab-library-data@0388abf78dff4ea4835e36b01de67d10703ac596`. Retain this pin. Do not substitute the historical P1 verification pin `91c127ddbae902405de6e35b38940a59a8c0d021` to claim current-pair parity.

## Verification boundaries that remain open

- Official HydroRIVERS SHP/SHX/DBF/PRJ original bytes (9 regions × 4 members) are still not independently verified in the earlier P1 report because of HTTP 403. Full regeneration from the 9 originals plus other supporting originals was not run.
- DEM all-tiles byte/format/seam verification and NOAA source SHA were shown in the prior P1 report, **not** full original-to-1,280-tile pixel-by-pixel regeneration.
- Stage 1 must not be labeled an end-to-end source reproduction or deployed-data change. Current OSM/attribution and map performance experiments are later stages.
- GitHub connector can inspect committed remote history but cannot attest to uncommitted worktree contents. No local checkout or native execution is claimed in this audit.

## Stage 1 verified run (2026-11-03)

- Source commit under test: `48f9a78439def8a842157110c54ded9e02458509`.
- [Integration CI #41580591771](https://github.com/kimjeon-il/Pando/actions/runs/41580591771): **SUCCESS** (both jobs). GIS/Python contract suite 21 passed / 0 failed; C++ `pando-core` 3 CTest passed / 0 failed; C++ `pando-gis-tools` 1 CTest passed / 0 failed. Configured source dry-run checks also succeeded.
- [P4 GIS source #41580591816](https://github.com/kimjeon-il/Pando/actions/runs/41580591816): **SUCCESS**; the earlier [P4 run #41580466367](https://github.com/kimjeon-il/Pando/actions/runs/41580466367) reported 20 passed / 0 failed.
- [P3 remote preview #41580591803](https://github.com/kimjeon-il/Pando/actions/runs/41580591803) **FAILED on branch naming**, `P3_UNSUPPORTED_PREVIEW_BRANCH: integration/r4-gis-w2-20261103`. This does not negate the passed GIS/C++ tests, but the P3 branch whitelist requires a separately tested integration-branch accommodation before later Web preview validation.
- [Draft PR #19](https://github.com/kimjeon-il/Pando/pull/19) was closed **unmerged** at 2026-11-03 04:55:55 UTC and its temporary branch disappeared. The verified source commit remained reachable; the branch was subsequently restored at that exact commit. Closure/deletion cause was not established. The PR remains closed and is not evidence of a main merge.
- This evidence note is documentation-only and does not change the tested GIS/C++ source or external library pin.

Do not merge the temporary branch into `main` or deploy it without separate authorization.