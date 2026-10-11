# Complete selected lake geometry evidence

This component identifies exactly three actual-inventory lake records at immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`, in fixed order:

- `lakes_base:1159112291`: source ID 1159112291, baseline FID 15611, logical FID 4236; one Polygon, one ring, 51 positions including closure; stage 2.
- `lakes_base:1159112821`: source ID 1159112821, baseline FID 15649, logical FID 4274; one Polygon, one ring, 43 positions including closure; stage 2.
- `lakes_base:1159109155`: source ID 1159109155, baseline FID 15393, logical FID 4018; one Polygon, one ring, 124 positions including closure; stage 0.

Each selected logical target has exactly one retained baseline fragment. All matching fragments are included. The actual source names are `lake-419`, `lake-457` and `lake-201`, respectively. Source `name_ko`, `name_en` and `name_original` are empty strings. The core metadata retains each placeholder in `name`; the detail metadata has no name fields. Both layers and their exact merged decoder metadata are recorded separately with independent pins. Blank and absent fields are preserved. These facts identify selected objects; they establish no geographic name or naming verdict. Automatic application is false.

## Complete source and rendered evidence

`selected-lake-geometries.geojson` preserves every complete selected source feature JSON object byte-for-byte, including original numeric tokens, metadata, rings and coordinate order. `selected-baseline-rendered-geometries.geojson` contains the complete selected output of the hash-verified production decoder at the pinned baseline. Every rendered coordinate equals the corresponding original coordinate rounded to six decimal places. No geometry repair, simplification, reversal, coordinate sorting or removal of inconvenient portions was performed.

`geometry-reference.json` records source positions, separate identifier domains, metadata, bounds, original JSON hashes, canonical full-feature and geometry hashes, and ordered per-part/per-ring coordinate hashes. Source Feature.id is its `awId`; decoded Feature.id is its numeric baseline FID. Baseline FID and logical FID apply to the pinned baseline only.

`selected-inventory-records.json` retains the three exact selected inventory CSV rows. `geometry-duplicate-check.json` pins the previous index at immutable commit `480f9db0ea893051f9de9749e4786385d7daa45e` and retains its 30 prior awIds in order. The current three are mutually distinct, initially eligible lake records, and absent from that list. The current-three delta is 30 to 33 reconstructed targets and 4035 to 4032 remaining fresh-reconstruction targets: 3439 river groups and 593 lakes. Remaining means absent from the fresh reconstruction index, not historically never researched. No previous-target geometry or naming decision is revalidated here.

## Rights and acquisition

Natural Earth is the source attribution. The retained [official Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) place its vector and raster data in the public domain and permit electronic dissemination. `geometry-publication-rights.json` records the original official-page checksum, retrieval time, short excerpt and separate local reuse-check time. The full selected original and rendered lake features are included under those terms. Complete upstream sources, binary packs, index bodies and production decoder bodies are omitted. The terms do not establish rights for unrelated research maps or documents.

`geometry-request-receipts.json` distinguishes original acquisition from verified local reuse. This component made zero new external requests. No present deployment was checked or asserted equal to the pinned baseline. Geographic naming and source-map judgments are outside this component.

## Offline validation

Python 3 is required. From this directory run:

- `python -B validate-geometry-reference.py`
- `python -B test-geometry-reference.py`
- `python -B validate-geometry-reference.py --check-component-manifest`

Durable-only mode checks all included coordinates, ring and vertex order, original JSON token hashes, independent feature/hash pins, exact metadata and name state, selected inventory facts, pack receipts, current-three eligibility/delta facts and the prior30 duplicate list. It cannot reconstruct omitted full source assets or replay omitted decoder dependencies.

Optional original-input modes are local-only and make no network calls:

- `--input-cache INPUT_CACHE` verifies pinned source, metadata, index, shards and decoder dependencies, checks original source positions and complete selected-fragment membership, then replays the production decoder byte-for-byte. Node.js is additionally required.
- `--historical-input-root RECOVERED_REPOSITORY_ROOT` verifies the original inventory/summary bytes and selected exact CSV rows.
- `--previous-index PREVIOUS_INDEX_JSON` verifies prior index bytes, awId order and previous queue counts.

`geometry-validation.json` records successful durable and full-local checks and 25 rejected corruption fixtures, including 24 durable-only fixtures. These cover changed/reordered source vertices and tokens, a broken closure, changed feature IDs, wrong source IDs and target order, missing/duplicate rendered fragments, altered fragment counts, metadata and name states, ordered ring hashes, source position, inventory identity/category, prior duplicate list and current-three delta, pack offsets, false deployment claims and source-provenance URLs. Editable artifact receipts and selected reference fields are rebased where applicable, so semantic checks and independent pins remain effective. The full-local altered-worker fixture rejects changed production code before execution. Original input checksums remain unchanged.

`geometry-component-manifest.json` freezes only this geometry component. It excludes naming research, independent review, final batch results, the reconstructed index and the overall package manifest and validator. Ring closure, finite coordinates, geographic ranges, bounds, complete retained-fragment coverage and ordered source-to-rendered equality are checked. Full OGC topology validity, modern shoreline equality, or geographic naming scope is not asserted.
