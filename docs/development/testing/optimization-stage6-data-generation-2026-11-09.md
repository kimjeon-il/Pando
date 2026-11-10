# Stage 6 — project-selected generation inputs and immutable runtime derivatives

Branch: `work/optimization` · 2026-11-09

## Ownership boundary

**Authoring/generation inputs:** `projects/<projectId>/generation-inputs.json` (not published by the Viewer), pointing to territorial source descriptors/coordinate resources, the generated-v2 source index, canonical current-world projection, view/policy/display policy, and the world derivation recipe. The generator validates that the receipt belongs to the same project ID as `projects/<id>/manifest.json`.

**Viewer publication:** the existing `projects/<projectId>/manifest.json` owns runtime catalog roles only. The existing `collectRuntimeDataAssets`, pinned archive verification, and Pages release process select its actual country/terrain/Hydro/place and immutable derived geometry. GIS source coordinates and private generation recipes are never catalogued as release dependencies.

Do not combine these manifests or duplicate GIS authored coordinates inside the Viewer.

## Metadata-only / immutable reuse

- `generated/v2` source descriptors use a previous validated geometry-resource SHA, byte count, logical reference and stored geometry bounds as a fast path. The previous descriptor archive bytes must themselves match the prior index SHA and size. A metadata-only change reads **zero original geometry payloads** and does not invoke full coordinate normalization. The small descriptor/index may still change and be gzipped; the original coordinate resource is neither generated nor re-gzipped. A source geometry resource change falls back to normal source decoding, bounds calculation, and strict validation.
- The full **builtin world** compiler now uses its existing on-disk previous index when available (not merely scoped builds) and reuses its geometry asset records by content SHA. Its existing `encodeBuiltinCountries` reuses the same immutable geometry asset and only emits an updated country metadata descriptor when names/properties change. A changed geometry hash generates the new asset.
- The **prepared polygon mesh** builder accepts `--project=<projectId>`, uses that project's territorial, physical land, prepared-mesh and source-index catalogs, and uses the selected project's display policy for country adjacency. Its existing geometry digest storage/reuse remains authoritative; an unchanged mesh is not recompressed.
- The **prepared country scene** builder accepts `--project=<projectId>`, uses its world and territorial runtime catalogs, and validates previous immutable scene content SHA, selected fill/boundary/hierarchy identity, reference month, canonical mesh algorithm and source provenance. On an identical scene it avoids a mesh rebuild or gzip and updates only the small catalog receipt. An existing API consumer can lazily request a decoded packet; the no-packet metadata-only CLI path never decompresses it.
- Existing GIS retirement checks, manual Hydro generation, authored geometry versions, immutable data pins, and Pages transfer hash verification remain unchanged.

## Focused verification

- [Stage 6 focused contract run](https://github.com/kimjeon-il/Pando/actions/runs/42641784618): **12 selected unit tests passed, zero failed**. This includes the metadata-only source selector, the full-country geometry reuse encoder, project generation input / Viewer release separation, and verified prepared scene reuse. Explicit changed-generator `node --check` and ESLint checks also succeeded.
- The same run checked the workflow-ownership audit CLI; it reported no exact overlapping automatic jobs and no reference issues.

**No entire GIS source rebuild, historical-world recomputation, full mesh regeneration, full test suite, main merge, or Pages deployment** was performed.

## Scope limits

This is validated at the generator source/contract level. A source-matched GIS + C++/WASM end-to-end generation on real data is not claimed. The Pages deployer still creates a complete staged site by copying the verified selected immutable runtime assets; this is existing release packaging, **not** coordinate generation or re-compression. Avoid changing that established deployment behavior without a separate approved optimization. Actual published network transfer efficiency requires its own measurement.
