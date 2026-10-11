# Complete selected lake geometry evidence

This component identifies exactly three actual-inventory lake records at immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `lakes_base:1159110371`: source ID 1159110371, baseline FID 15485, logical FID 4110; one Polygon part, one ring, 114 positions including closure.
- `lakes_base:1159109471`: source ID 1159109471, baseline FID 15419, logical FID 4044; one Polygon part, one ring, 205 positions including closure.
- `lakes_base:1159111751`: source ID 1159111751, baseline FID 15571, logical FID 4196; one Polygon part, one ring, 104 positions including closure.

All matching baseline fragments are included. The actual source names are `lake-293`, `lake-227` and `lake-379`, respectively. Source `name_ko`, `name_en` and `name_original` are empty strings; those fields are absent from the decoded baseline metadata, whose `name` values retain the same labels. Exact fields and their presence are recorded without filling blanks. These facts establish selected objects, not geographic names or a naming verdict. Automatic application is false.

## Full source and rendered evidence

`selected-lake-geometries.geojson` preserves each complete selected source feature JSON object byte-for-byte, including original numeric tokens, metadata and coordinate order. `selected-baseline-rendered-geometries.geojson` contains complete actual production-decoder output from hash-verified immutable packs. Every rendered coordinate matches the corresponding source coordinate rounded to six decimal places. Neither geometry is repaired, simplified, reordered or replaced by a centroid or outline fragment.

`geometry-reference.json` gives exact source feature positions, baseline IDs and metadata, bounds, counts, original JSON hashes, canonical full-feature/geometry hashes and ordered per-part/per-ring coordinate hashes. Source Feature.id is its `awId`; decoded Feature.id is its numeric baseline FID. These identifier domains are explicitly separate.

`selected-inventory-records.json` retains the three exact CSV rows and normalized selected facts. `geometry-duplicate-check.json` records the previous index's immutable URL, byte hash and all 12 prior awIds in index order. The selected three are mutually distinct and have no overlap with that list. Prior names are not used as identity evidence.

## Rights and acquisition

Natural Earth is the source attribution. Previously acquired [official Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) place its vector and raster data in the public domain and permit electronic dissemination. `geometry-publication-rights.json` retains the original official-page checksum, acquisition time, short excerpt and separate reuse-check time. Only the three selected source and baseline lake features and bounded factual extracts are included. Complete upstream sources, binary packs, index bodies and production decoder bodies are excluded.

`geometry-request-receipts.json` distinguishes original acquisition times from local reuse checks. This geometry work made no new external requests. It did not check the current deployment or establish its equality to the immutable baseline. Source-map research and geographic naming judgments are outside this component.

## Offline validation

Python 3 is required. From this directory, run:

- `python -B validate-geometry-reference.py`
- `python -B test-geometry-reference.py`
- `python -B validate-geometry-reference.py --check-component-manifest`

The durable-only checks inspect every included source and rendered coordinate, ring and vertex; compare original JSON token hashes and separate fixed feature/hash pins; verify exact recorded metadata/name state, selected inventory facts, pack receipts and the prior12 duplicate list. They do not reconstruct omitted original full source files or execute decoder inputs that are absent from this compact component.

Add `--input-cache INPUT_CACHE` to recheck all named immutable source/metadata/index/shard/decoder assets and replay the production decoder. Node.js is additionally required for this mode. Add `--historical-input-root RECOVERED_REPOSITORY_ROOT` to verify the original inventory/summary files and exact selected CSV rows. Add `--previous-index PREVIOUS_INDEX_JSON` to verify the original previous index bytes and its awId order. These scripts read local inputs only and never fetch them. Optional original inputs are not needed for durable-only validation.

`geometry-validation.json` records successful durable and full-cache modes plus 14 rejected corruption fixtures, 13 of which require only the durable component. Fixture artifact receipts are refreshed where applicable, and several editable reference fields are also rebased, so rejections test independent pins and semantic checks. The optional altered-worker fixture confirms the changed production worker is rejected before it can execute. Original cache checksums are compared before and after testing. `geometry-component-manifest.json` freezes only the geometry component files.

Ring closure, finite coordinates, geographic ranges, bounds, complete selected-fragment coverage and ordered geometry equality are checked. A complete OGC topology audit is not claimed.
