# P0–P2 focused recovery evidence — 2026-11-09

> Historical recovery snapshot. **Its incomplete-work section is superseded** by [P1-3–P2-2 focused closure](./optimization-p1-p2-closure-2026-11-09.md), including final source changes and targeted CI evidence.\n\nBranch: `work/optimization`. This report records actual changes and *focused* CI; it does not claim a full test run, full GIS regeneration, native C++ regression, browser pixel comparison, or production deployment.

## Completed source changes

- P0-1 `2edaa82e11`: repaired Pages staging fixture and existing tests against current Viewer/Worker/project ownership.
- P0-2 `fa032497f9`: restored long-lived-branch affected checks while preserving unique specialized source gates.
- P0-3 `edbd11f780`: registered `projects/**` and added a project-manifest selector regression.
- P1-1 `b887526ab8`: terrain runtime uses selected project catalog; only explicit development overrides can bypass it.
- P1-2 `a5650a0340`: reject mismatched rivers/lakes catalogs in the project manifest validator, not after a partial runtime startup.
- P1-3 `177114f84f`: reject incompatible Hydro schema/metadata and mismatched physical-land/terrain lineage at build; publish selected Hydro version in immutable build metadata, not the hardcoded default version.
- P1-5 `63b5cfbee8`: select the same project in browser verification and library CLI (legacy GIS/report purpose remains separately selectable).
- P2-1 `e696b97813`: move place-name period calculation to data and resource update key policy to runtime; retain UI/rendering compatibility re-exports without duplicating calculations.
- P2-2 `93388b3f53`: assert that overlapping check groups and a direct binding select a unit test only once. The shared planner's existing set-based deduplication remains the execution owner.

## Focused CI results

- `8ce2afa162`: [P0-1, P0-3, P1-1, P1-2 focused suite](https://github.com/kimjeon-il/Pando/actions/runs/42613873341) **passed**.
- `0a8f5f824`: [expanded focused suite](https://github.com/kimjeon-il/Pando/actions/runs/42614248869) failed because the Pages synthetic Hydro fixture lacked the newly required metadata. Corrected in `46cbc9953b`.
- `1dca3d4114`: [focused suite after fixture repair](https://github.com/kimjeon-il/Pando/actions/runs/42614360000) failed only because an unrelated Places catalog test read an unmounted external `urban-lifetimes-v1.json`. That test was removed from this no-data focused job; it must run with the pinned library materialized, not be treated as passing.
- `16bf4b9945`: [final selected P0/P1/P2 suites](https://github.com/kimjeon-il/Pando/actions/runs/42614455020) **passed**. Covered Pages staging, project change selection/deduplication, terrain/Hydro manifest validation, frontend build coherence, and place-runtime ownership.

## Incomplete work and risk

1. **P1-4 is not complete**. The C++ `pandolab-project-state` schema still stores `projectSetup.sourceMode` (builtin/empty) without a durable map-project content identity. A full cross-project import/replacement policy requires a source-identity contract in the native document serializer, migration behavior for old saved files, and focused rollback/Worker-staleness tests. Do not add an ad hoc JS-only `projectId` field to native project JSON.
2. **P1-5 legacy compatibility**: the non-project materialization fallback still exists for GIS/research and older tools. Audit every remaining call site before requiring a project ID globally.
3. **P2-1 ownership**: the largest `physical-resources.js` owner still combines physical data preparation, hydro presentation admission, and C++ timeline projections. The pure policy moves reduce cross-layer imports but do not constitute a complete responsibility split.
4. **P2-2 full duplicate inventory**: 68 workflows and 46 registered check groups need a per-assertion owner audit before removing more specialized/manual workflows. A successful deduplication test does not prove every historical CI condition has been merged. Preserve unique native/GIS/publication gates.
5. **Deployment gate**: no `main` merge or live deployment; browser and native replacement regressions still require separately selected checks before release.

The correct status is **P0-1–P0-3 and P1-1–P1-3 source repairs with passing focused checks; P1-5 and P2-1 partial normalization; P2-2 deduplication verified but full consolidation outstanding; P1-4 outstanding**.

## Follow-up publication ownership correction

The shared Application CI on `16bf4b9945` found a **duplicate published module name** for `src/runtime/resource-update-policy.js` and the retained rendering compatibility facade. `78bb2f076a` renamed the runtime source to `src/runtime/resource-dependency-policy.js` and updated the facade and place consumer; the immutable module namespace is now distinct. The preceding focused suite success did not catch this publication-index collision. This correction requires a successful current-head source-layout check before the branch can be considered CI-clean.
