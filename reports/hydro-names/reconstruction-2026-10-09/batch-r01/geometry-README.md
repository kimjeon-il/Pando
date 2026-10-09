# Three-lake reference geometry reconstruction

This is a compact factual reconstruction for source IDs `1159109497`,
`1159106899`, and `1159107065`. It establishes geometry and ID lineage only.
Lake-name identity findings are separate evidence and are not inferred here.

## Baseline and scope

- Immutable Pando commit: `fd6744f5e72a0c1a107452dbde6d416ab57237db`
- Hydro manifest version: `0.13.1`; its manifest points to the `0.13.0`
  index, detail metadata, and geometry shards.
- The newly retrieved manifest, lake source, core, and detail bytes match
  hashes in the recovered 2026-10-08 inventory summary. Index and the one
  necessary shard match the pinned manifest hashes.
- The recovered report described the deployment it observed on 2026-10-08.
  **The current live deployment was not checked.** A repository baseline
  match does not establish the commit or contents currently served online.
- No product data, names, deployment, or missing 504-record research ledger
  was changed or recreated by this geometry extraction.

## Files

- `selected-lake-geometries.geojson`: three complete, unmodified original
  source features. Full coordinate precision, part/ring/vertex order, source
  properties, original IDs, and blank name fields are preserved.
- `selected-baseline-rendered-geometries.geojson`: the corresponding three
  features decoded from the immutable baseline, with exact core/detail
  metadata. These are baseline rendered shapes, not live-site observations.
- `geometry-reference.json`: input and output hashes, exact feature locators,
  ID joins, part/ring/coordinate counts, bounds, precision comparison, rights,
  and explicit limits.
- `selected-pack-receipts.json`: exact selected pack IDs, offsets, lengths,
  and hashes within the fully hash-verified shard.
- `geometry-request-receipts.json`: compact request/time/result/byte/hash
  receipts; no raw source corpus or response headers.
- `validate-geometry-reference.py`: offline package and optional full-input
  checks using only the Python standard library.
- `extract-baseline-geometries.mjs`: offline Node adapter for the pinned
  production decoder; it does not implement an alternative geometry codec
  or fetch anything.

Each source geometry is a Polygon with one exterior ring and no holes.
Coordinate counts, including ring closure, are 173, 104, and 105 in the
order listed above. Each baseline rendered ring retains the exact source
vertex order, rounded to six decimal degrees. Original source coordinates
are never replaced by the rounded display geometry.

## ID joins

Join `String(source.properties.source_id)` to detail `sourceId`, then join
core/detail on `fid`. Check `awId`, `logicalFid`, and source hashes together.
The three `(source_id, fid, logicalFid)` mappings are:

- `(1159109497, 15421, 4046)`
- `(1159106899, 15218, 3843)`
- `(1159107065, 15236, 3861)`

These FIDs are baseline-specific. They are not permanent source identities.
Geometry hashes use UTF-8 JSON with sorted object keys, no whitespace,
`ensure_ascii=False`, and no non-finite values; arrays retain original order.
Whole-file hashes instead cover the exact saved bytes.

## Verification

From this directory, validate the compact package:

```sh
python validate-geometry-reference.py
```

When the excluded complete inputs are available, also validate each input
hash and exact original-feature/core/detail join:

```sh
python validate-geometry-reference.py --input-cache .input-cache
```

The source asset entries in `geometry-reference.json` give immutable public
URLs and expected hashes. To repeat baseline decoding, place those exact
assets under the listed local names in an input directory, then run:

```sh
node extract-baseline-geometries.mjs INPUT_DIRECTORY OUTPUT_GEOJSON
```

Only shard `s0` was required. Its complete 4,169,624-byte hash was checked,
then only packs 0, 1, and 3 were decoded and only the three target features
were retained. No other shards or HydroRIVERS source corpus were acquired.
Full inputs and raw request responses are intentionally excluded from this
publishable package. These checks do not constitute a complete OGC topology
validation or georeferencing of the official maps used in name research.

## Geometry redistribution provenance

The pinned manifest and each original feature attribute the lake data to
Natural Earth 5.0.0 at 1:10m. The official [Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/),
read on 2026-10-09, place all versions of its raster and vector map data in
the public domain and allow modification and electronic dissemination.
`geometry-reference.json` records the exact short excerpt and response hash.
Made with Natural Earth.

This rights statement concerns the selected Natural Earth-derived geometry
and our factual extraction. It does not cover unrelated evidence documents
or authorize copying raw maps/PDFs gathered by the name researchers.
