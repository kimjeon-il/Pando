# Three-lake reference geometry, r02

This compact factual extraction covers source IDs `1159115267`, `1159123531`,
and `1159107099`. It establishes source geometry and immutable-baseline ID
lineage. It does not establish lake names.

## Baseline and acquisition scope

- Pando commit: `fd6744f5e72a0c1a107452dbde6d416ab57237db`.
- Hydro version: `0.13.1`. Its manifest points to the `0.13.0` index, detail
  metadata and geometry shards.
- All inputs were reused from previously acquired bytes and hash-verified
  again locally. This extraction made **zero new external requests**.
- Original acquisition times and the reuse-check time are recorded
  separately. Precise retrieval times for recovered inventory files are
  unavailable; their known recovery date and immutable byte hashes are
  retained without inventing timestamps.
- The recovered 2026-10-08 report describes the deployment observed then.
  **The current live deployment was not checked.**

## Complete selected shapes

`selected-lake-geometries.geojson` contains three complete source features.
Each feature's original JSON object is copied byte-for-byte, preserving
coordinate numeric tokens, ring/vertex order, IDs, properties, placeholder
names and blank name fields. Only the FeatureCollection wrapper and selected
feature ordering are newly assembled. The selection order is the ID order
above; original zero-based feature indices are 596, 1074 and 46.

Each geometry is a Polygon with one closed exterior ring and no holes.
Coordinate counts, including repeated closing coordinates, are 95, 184 and
88 respectively. The complete polygons must be consulted for any later
identity comparison; bounds and centers alone do not establish identity.

`selected-baseline-rendered-geometries.geojson` contains the corresponding
features actually decoded from the pinned baseline's compressed pack bytes
using its original production decoder. The shapes retain the source ring
and vertex order, with coordinates quantized to six decimal degrees. They
are decoded baseline features, not synthetic shapes or live-site captures.

## ID lineage

The baseline-specific `(source_id, fid, logicalFid)` joins are:

- `(1159115267, 15789, 4414)`
- `(1159123531, 16267, 4892)`
- `(1159107099, 15239, 3864)`

Each source-ID decimal string is joined to detail `sourceId`, and core and
detail are joined by `fid`. `awId`, `logicalFid`, source-ID hashes, bounds,
stages and available inventory fields are cross-checked against the
recovered priority candidates and CSV. All three fragment counts are one.
These FIDs are specific to this baseline, not permanent source identifiers.

The hash-verified shard `s0` contains all needed packs: pack 15 for
`1159115267`, pack 148 for `1159123531`, and pack 1 for `1159107099`.
Only those packs were decoded and only the target features were retained.
No other shard or river-source corpus is included.

## Evidence and verification files

- `geometry-reference.json`: source URLs and hashes, exact feature locators,
  complete metadata, geometry metrics, joins, precision comparisons and limits.
- `geometry-request-receipts.json`: compact original acquisition receipts and
  local reuse checks, with unknown wire HTTP statuses left null.
- `selected-pack-receipts.json`: actual pack offsets, lengths, stages and hashes.
- `geometry-publication-rights.json`: geometry-specific rights provenance.
- `extract-baseline-geometries.mjs`: offline adapter for the pinned production
  decoder; it fetches nothing and rejects changed decoder/input hashes.
- `validate-geometry-reference.py`: durable-file checks and optional original
  input, inventory and production-decoder replay checks.
- `test-geometry-reference.py`: validation and corrupt-fixture regression tests.
- `geometry-validation.json`: results from both validation modes and eight
  rejected corrupt fixtures.
- `geometry-component-manifest.json`: frozen SHA-256 pins for these component
  files, excluding the manifest itself.

Whole-file hashes cover saved bytes. Canonical geometry/feature hashes use
UTF-8 JSON with sorted object keys, no whitespace, `ensure_ascii=False` and
no non-finite values; arrays retain their order. Separate original-feature
JSON hashes cover exact original feature object bytes.

From this directory, run the self-contained durable checks:

```sh
python validate-geometry-reference.py
python test-geometry-reference.py
```

When the previously acquired complete assets and recovered repository files
are available, replay all checks without network access:

```sh
python validate-geometry-reference.py --input-cache INPUT_DIRECTORY --historical-input-root RECOVERED_REPOSITORY_DIRECTORY
python test-geometry-reference.py --input-cache INPUT_DIRECTORY --historical-input-root RECOVERED_REPOSITORY_DIRECTORY
```

Full-input mode requires Python 3.9+ and Node.js with the standard-library
modules used by the extractor. Durable mode uses Python only. Full inputs
are excluded from this compact package; `geometry-reference.json` identifies
all expected names, immutable source URLs and hashes. Replay decoding alone:

```sh
node extract-baseline-geometries.mjs INPUT_DIRECTORY OUTPUT_GEOJSON
```

Validation checks numeric bounds, ring closure, exact feature bytes,
metadata joins and decoder reproducibility. It is not a complete OGC
geometry-topology test or georeferencing of independent cartographic maps.

## Redistribution provenance

The pinned manifest and source features attribute these lake geometries to
Natural Earth 5.0.0 at 1:10m. The retained official
[Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/)
place all versions of its vector and raster map data in the public domain.
The rights file records the original acquisition timestamp, exact response
hash, a short excerpt and the separate reuse-check timestamp.

Made with Natural Earth. This statement applies to the selected lake
geometry and original factual extraction; it does not license unrelated
maps or documents. Full upstream assets and decoder dependencies are not
republished here.
