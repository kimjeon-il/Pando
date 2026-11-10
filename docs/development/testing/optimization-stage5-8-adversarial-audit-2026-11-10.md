# Adversarial audit of optimization stages 5–8 (2026-11-10)

Branch: `work/optimization`. This report distinguishes confirmed code defects, missing source material, and unverified release acceptance. No merge into `main`.

## Evidence and fixes

1. **Stage 6 legacy indexed geometry fast-path failure — fixed in `4537dcc8`.** The pinned P2 generation run [42723254259](https://github.com/kimjeon-il/Pando/actions/runs/42723254259) failed at `metadataOnlyTerritorialProjection` with `Territorial geometry resource: invalid geometry resource identity`. The current descriptor must pass strict identity validation. A *previous* index row with no valid immutable geometry receipt must instead return `null`, forcing the existing canonical source materialization, hash and geometry validation. Added regression tests for a legacy receipt and a corrupt current receipt; do not treat a missing prior receipt as permission to reuse coordinates.

2. **Stage 6 / stage 8 source-vs-Viewer artifact ownership — unresolved release prerequisite, not an excuse to suppress checks.** The pinned `PandoLab-library-data` revision `a53f9b319b23678e82c4b9ffdb9f824a040ca5f3` contains `assets/data/world/current.json` and the generated territorial v2 index, but does not contain `assets/data/territorial-entities/generated/current-world.geojson` or `assets/data/world/build-input.json`. The Viewer runtime deliberately excludes these GIS authoring intermediates. The [application checks 42723253913](https://github.com/kimjeon-il/Pando/actions/runs/42723253913) still invoke the C++ canonical country validator, which requires the missing `current-world.geojson` and fails; the C++ validator self-test passes. Do not fabricate an empty canonical source, mark the check successful, or copy a second independent source of truth into Viewer data. The GIS authoring checkout must produce/verify the source-owned current-world projection before the full country validity gate is claimed.

3. **Stage 5 project transitions — existing source-level focused evidence, browser acceptance still pending.** [Stage 5 report](optimization-stage5-project-lifecycle-2026-11-09.md) records default/user project replacement, stale Hydro/Places epoch guards and source-matched targeted JS tests. The latest application workflow can skip browser tests for source-only changes; this is not proof of default → file → default behavior in a real browser with source-matched C++/WASM.

4. **Stage 7 rendering/Worker duplication — retain the existing owners.** The active Viewer composes `projectSourceRuntime` and `territorialSceneRuntime` directly, with one accepted C++ document. No evidence justifies deleting the GPU renderer, prepared mesh inputs or Canvas Worker; source-only checks cannot establish memory or visual parity.

5. **Stage 8 retirements — no unconditional data deletion.** The retired `builtin-session`, `builtin-month-clock` and legacy P4 fixed-version workflows were removed; GIS subunit identity is shared via `src/document/territorial-display-identity.js`, while the active generator retains its merge function. The pinned external library and Git history are preserved. A repository-wide binary/coordinate duplicate audit has not been executed, so the absence of independent duplicate canons is not yet certified.

## Verification policy and remaining acceptance

- Focused stage 5 and stage 6 workflows are rerun by this audit commit, without enabling a duplicate standing CI owner.
- The P2 artifact workflow on `4537dcc8` is asynchronous; report its result only after GitHub records a conclusion. A previous failed run does not establish that the new fallback works.
- A successful metadata-only unit test proves a guarded fast path, **not** a full real-data generation. Full acceptance requires source-matched GIS inputs, current-world and mesh receipts, project transition browser smoke, and validation of source/release ownership.
- `main` was already eight commits ahead of the optimization branch's merge base at audit start. Reconcile those changes before any eventual merge; do not force-push or silently overwrite `main`.
