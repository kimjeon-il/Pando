# P1-3 through P2-2 focused closure — 2026-11-09

Branch: `work/optimization`. This is a source-and-contract closure report, **not** a whole-repository, full browser, full GIS, or live publication certification. The earlier P0–P2 recovery report records historical, superseded limitations.

## Implementation sequence

| Stage | Committed implementation | Actual boundary |
| --- | --- | --- |
| P1-3 catalog compatibility | `4e13a3efcd`, `177114f84f` | `scripts/lib/map-catalog-coherence.mjs` checks world/territorial/prepared-mesh schema, selected territorial and physical-land catalog SHA-256 input fingerprints, physical-land/terrain lineage, Hydro manifest schema/version, and place/lifetime schemas before Viewer build. Project identity digest and selected source revisions are placed in build metadata. |
| P1-4 durable project identity and rollback | `c0234a7140`, `d4a9ccfe31`, `906a312b34`, `c6a8985ec7` | Native C++ v14 codec persists `mapProjectIdentity = {projectId, manifestSha256, dataRevision}`; Viewer validates imports against selected map, migrates only unbound default-world documents, preserves current C++ replacement/rollback and rejects stale/foreign candidates before adoption. Builtin reader and GeoPackage file reader share the Core replacement transaction, **not** a parser. |
| P1-5 source-aware consumers | `19aa81fca4`, `e954aeac99`, `63b5cfbee8` | Viewer runtime and browser verification select project-specific library catalogs; missing Viewer project no longer falls back to unbound data. Generator compatibility explicitly uses `viewer-legacy` or scoped GIS/reports preparation. |
| P2-1 source/presentation ownership | `ae9a2d669f`, `89c059db85`, `dd46af0091`, `03ae4baa02` | Immutable water model remains in data, replacement presentation remains in rendering, and land/preview source loading, retries and caches are in `src/data/physical-asset-reader.js`. `src/rendering/physical-map-controller.js` coordinates accepted timeline/selection and scene changes. Worker policy is generated from its canonical executable implementation, not a UI re-export facade. |
| P2-2 unique check owner audit | `79bc7dec0c`, `8c67bd0e1b`, `145ae96bd1`, `32ef3c902f`, `9b9b48b5ba` | Shared check catalog owns automatic test selection and exact tests are deduplicated. Audit inventories every workflow's jobs and tests; comparison preserves differences in job environment, conditions, matrices, steps, action arguments, platforms and disjoint literal branch/path selectors. Unique GIS/native/Pages specialized gates are preserved. |

## Executed focused evidence

- [Final P1-3/P1-4/P1-5/P2-1/P2-2 selected JavaScript checks](https://github.com/kimjeon-il/Pando/actions/runs/42628960869): **41 tests passed, 0 failed** across five explicitly named test invocations. No full test catalog was requested.
- [Native C++ project codec target](https://github.com/kimjeon-il/Pando/actions/runs/42627967045): **project-codec succeeded**, with only `project_codec_tests` built and executed. Whole C++ or WASM suites were not run in this verification.
- Workflow owner report in the focused run: **71 workflows, 138 jobs, 25 automatic, 46 manual-only, 42 tests referenced by multiple workflows, 0 exact overlapping automatic job duplicates, 0 audit issues**.
- Source-only fixes to the classic Worker resource policy and Pages fixture address the previously observed immutable Worker closure failures. The selected build/Pages contract suite passed; no claim is made about all browser shards or a production publish.

## Boundaries and remaining deployment checks

This closure proves named source and contract behaviors at the checked commits. It does **not** certify exhaustive semantic equivalence of independent GIS data collections, all 42 shared test references as redundant, complete browser presentation, or a full native/GIS test matrix. The map-catalog verifier checks explicit cross-catalog provenance links, not unmodelled correlations. Before a `main` merge or live release, use separately scoped current-head Viewer import/rollback browser smoke and source-matched native/WASM checks if relevant native or compiled inputs changed. Do not replace specialized GIS/publication gates with an unverified generic unit test.

No `main` merge and no web deployment were performed during this work.
