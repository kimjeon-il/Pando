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
