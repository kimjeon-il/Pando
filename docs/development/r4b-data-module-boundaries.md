# R4-B — GIS data module boundary

Status: extracted on `fix/r4-editor-source-retirement-20261102`, pending full Viewer/Windows/GIS regression.

## Canonical owners

| Data responsibility | Canonical module |
| --- | --- |
| Historical entity/index normalization and day-precision geometry | `tools/gis/territorial-library.js`, `territorial-index-entry.js` |
| Source evidence/provenance downgrade on changed coordinates or periods | `tools/gis/territorial-library-provenance.js` |
| Published historical project template (no autosave) | `tools/gis/project-template-compiler.js` |
| Deterministic source baseline SHA-256 | `shared/frontend/js/modules/project-baseline-fingerprint.js` |
| Generic Feature v2 schema, source provenance and normalization | `shared/frontend/js/modules/generic-feature-normalization.js` |

## Retired application adapters isolated to tests

- `tests/helpers/legacy-project-autosave.mjs` preserves the former full/delta autosave test API, delegating project creation to the production compiler.
- `tests/helpers/generic-feature-command-service.mjs` preserves Core command/ACK/undo regression tests; it is not a public Viewer or GIS publication import.
- Removed the two mixed data/editor modules previously parked at `tools/gis/project-serializer.js` and `tools/gis/generic-feature-service.js`.

The unchanged shared C++/WASM Core still validates time, geometric revisions, commands, and data admission. No direct editing or GIS rewrite is enabled in the Viewer.

## Data-invariance gates

1. Exact `JSON.stringify` project template output parity with the old compatible serializer, including field order, schema, timestamps and geometry references.
2. Stable baseline hashes independent of object key and input feature order; modified metadata/geometry changes the digest.
3. Generic Feature schema v2 canonical keys, provenance, rejects duplicate IDs and forbidden fields; no input mutation in collection normalization.
4. Historical library day-precision validity boundary inclusion, no rewritten source geometry.
5. No imports from retired editor source in canonical modules; no direct Core mutation commands in normalization; active GIS and Windows staging tests must pass.
6. Run `node --test tests/unit/r4b-data-module-boundaries.test.mjs`, R4 pruning/architecture CI, current historical GIS and Windows E5/E6/E7.

The pre-existing R4 source-pruning count (45 of 153) remains unchanged; this stage is **module separation**, not a claim of full R4 deletion. The remaining archived editor tree is a later R4-D/E concern.
