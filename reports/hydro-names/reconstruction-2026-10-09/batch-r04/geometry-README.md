# Selected mixed geometry evidence

This component covers exactly three inventory records at baseline commit `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `hydro-system:70152112`: logical FID 2966, geometry FIDs 9228–9230, 188 source reach IDs, 1,279 decoded coordinates. All three retained roles are `mainstem`.
- `lakes_base:1159123163`: logical FID 4869, geometry FID 16244, one source ring with 92 positions including closure.
- `lakes_base:1159123567`: logical FID 4894, geometry FID 16269, one source ring with 208 positions including closure.

Identifiers, full geometry and baseline metadata establish the selected object, not its geographic name. No historical name verdict, centroid inference, automatic application, product edit or current deployment observation is claimed.

## Rights and included evidence

Natural Earth lake source feature JSON objects are copied byte-for-byte from the pinned source inside `selected-lake-geometries.geojson`. Every part, ring, vertex, numeric token and order is preserved. `selected-baseline-lake-geometries.geojson` contains the actual pinned production-decoder output for the two lakes, and all coordinates match the source rounded to six decimals. Cached official Natural Earth terms place the data in the public domain. Attribution and source-term receipts are retained in `geometry-publication-rights.json`.

HydroRIVERS full coordinates, the mixed decoded GeoJSON, binary packs and whole-target plots are deliberately excluded. Public river evidence consists of own factual extracts: exact identifier lists and their order, role/fragment metadata, counts, bounds, bounded endpoints and full-geometry hashes. Open redistribution permission for the full river coordinate arrays has not been established. A previously captured HydroSHEDS license text extraction is identified only as a tool-text capture; no original license PDF-byte checksum is claimed. No license PDF was requested for this component.

The last river fragment's sea render endpoint differs from the source endpoint retained in baseline metadata. Adjacent fragment endpoints match. These observations are a limited naming-scope check, not geometry repair, original HydroRIVERS shapefile equivalence, a per-reach coordinate-boundary mapping or a full topology audit. One representative system name does not automatically name every source reach.

## Offline validation

Run `python validate-geometry-reference.py` or `python test-geometry-reference.py` in this directory. Python 3 is required. Durable-only validation fully inspects the included lake coordinates and exact source JSON objects. It verifies published river facts, identity joins, source-ID order and recorded hashes, but cannot recompute omitted full river-coordinate hashes without those coordinates.

For a complete replay, supply `--input-cache INPUT_CACHE`, containing the immutable assets named and hashed in `geometry-reference.json`. Node.js is additionally required. The validator verifies all assets before executing the pinned production decoder, then recomputes every selected lake and river metric and full-geometry hash. Neither script fetches inputs. Adding `--historical-input-root RECOVERED_REPOSITORY_ROOT` verifies only the selected rows in the recovered priority/CSV inventory and its baseline summary. The recovered inventory assets remain external to this compact component.

The complete source inputs, original rights documents and local research plots are not required for durable-only validation. Component hashes are frozen in `geometry-component-manifest.json`; `geometry-validation.json` records both successful modes and six bounded corruption checks.
