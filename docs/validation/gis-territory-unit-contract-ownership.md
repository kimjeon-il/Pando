# GIS and territorial unit contract consolidation
Owner: `work/optimization`. Baseline: `0c62a76765b7c2f5f4eb5d41c288d4a4c08efb33`, 459 root unit suites.

## P0 functional ownership / scope
The first-pass filename inventory is 240 candidate suites: polygon 15,
boundary 24, Hydro 57, source 76,
territorial/country 68. This is a **candidate count**, not 240
independent GIS contracts. Reassign cross-domain render, project, QGIS integration,
Worker infrastructure and timeline UI checks by their actual operation.

Current product: browser Viewer with **no border drawing/editing UI**. Preserve
displayed country borders, geometry data conversion/validation, original-source
reconstruction, canonical territory changes through sanctioned Core commands,
and temporal geometry provenance. Do not re-enable manual border cutting,
drag handles, edit previews or editor-only undo/redo.

There are no tracked Python `.py` or `.ipynb` sources in the checked
`tools/`, `tests/`, `scripts/`, `apps/` or `shared/` trees.
Retired Python / Shapely executable comparisons must not be reintroduced.
The retained 1922 Caspian historic JSON oracle requires a **source-baseline**
migration; preserve independently pinned factual constraints and input hashes
without describing an old Python run as a current Python execution.
Review all consumers, native prerequisites and workflows before deleting
the old fixture path.

## Contract owners (one current owner for each old identity)
- **P2 polygon**: rings, wrapping, holes, spherical area, validation, clipping
  and prepared input. Native Core/WASM polygon tests have their own prerequisites.
- **P3 boundary**: contact topology, owner pairs, identical shared edges,
  subdivision, compact/index packets and visible borders. No edit-mode cases.
- **P4 country**: identities, parent relations, date-scoped geometry,
  immutable version history, Core entity storage and materialized world data.
- **P5 Hydro**: archive evidence, river graph/outlets, named chains, source
  selection, packfile, calibration, native connectivity. Preserve source bytes.
- **P6 provenance**: LSIB original archive proof, Natural Earth/historical
  sources, reviewed policy, Caspian physical constraints, German coastline,
  Baikonur treaty/imagery, external archive hashes and native source parity.
- **Cross-domain**: renderer, product UI, app project files, generic source
  analyzer and independent QGIS service execution keep separate owners.

Do not combine tests that require different native binaries or independent
source-vs-derivative calculations purely to reduce file count. Keep a
`// Original feature contract: <filename>.test.mjs` marker in the new
owner. Use same-prerequisite suites and share detached test fixtures,
not mutable globals. A registration from a retired physical file must be
remapped in CI, scripts and `application-checks.json`.

## Execution plan
P0 inventory/retirement boundaries (this record);
P1 shared detached fixtures; P2 polygon; P3 boundary; P4 country;
P5 Hydro; P6 original GIS source proof; P7 physical-path migration,
direct-workflow refs, prerequisite ownership and closing report.

The user's rule is **deferred validation**: no Node, Native, Playwright,
CI or full test execution during this work. Source review is not a passing
test result. Baseline fixture integrity and full performance measurements
remain unverified until the final consolidated verification.

## P0–P7 implementation record (source changes only)

The implementation was committed in ordered batches on `work/optimization`:

| Phase | Applied source change |
| --- | --- |
| P0 | `64c73fdc`: identified the 240 GIS/territorial candidates and excluded retired Python executables and border-editing UI |
| P1 | `f5086671`: introduced detached polygon rectangle fixtures for independent boundary contracts |
| P2 | `cf1741fd`: consolidated prepared polygon inputs and spherical metric contracts |
| P3 | `dc9c00f9`: consolidated boundary topology, contact, compact row and display contracts |
| P4 | `f03e4b3f`–`37765267`: consolidated country lineage, territorial storage, historical display and built-in world contracts |
| P5 | `b21b6d85`–`d4b1c879`: consolidated Hydro chain, independent evidence, calibration and viewport contracts |
| P6 | `5d784703`–`9fd1544c`: consolidated historical sources, LSIB and Baikonur evidence, and migrated the pinned Caspian reference to a Python-free native-baseline fixture |
| P7 | `1054cd07`–`36b0a91f`: remapped test selection, native prerequisites, direct CI references and remaining obsolete border-cut test entrypoints |

At `36b0a91f35ed730518c303a533dea8ca254b8829`, the tracked root unit-test directory has **397** `*.test.mjs` files, compared with **459** at the P0 baseline. This is a net reduction of **62 physical suites**, not a claim that 62 distinct verification cases were deleted.

The retired `tests/unit/edit-preparation.test.mjs` and
`tests/unit/map-editing-foundation.test.mjs` entrypoints are absent;
retained geometry validation, shared-boundary presentation and read-only
product contracts belong to active owners. The historical
`gis-caspian-1922-python-native-oracle.json` fixture is absent and the
remaining frozen source evidence is in
`gis-caspian-1922-native-baseline.json`. This does not reintroduce a
Python runtime or a border-editing UI.

**Deferred verification:** No Node unit suite, native/C++/WASM build,
browser test, CI execution, end-to-end contract audit or performance
benchmark was run for this migration, per the requested all-at-once
verification policy. The changes and their source-level ownership are
committed; behavioral correctness, prerequisite isolation and stale
references still require the final consolidated verification. Do not
treat the static review as a test pass.
