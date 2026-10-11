# Independent review: Nura, Flinders and Sarysu baseline groups

This bounded review covers only systems 30624681, 50488324 and 40182409 at immutable baseline fd6744f5e72a0c1a107452dbde6d416ab57237db.

- Nura remains a provisional representative-system candidate. Written name usage is supported, but no external map was successfully inspected and river-versus-terminal-lake naming scope is unresolved.
- Flinders has strong regional representative-system/mainstem support. Its separately classified western tributary fragments do not inherit the representative name.
- Sarysu has qualified representative-system support. Named upstream components and the episodic terminal-lake connection prevent a uniform reach-name assignment.

All Korean research names are null. No whole-group scalar name, per-reach name assignment, automatic application or product change is approved. The current deployment and original HydroRIVERS shapefile-coordinate equality were not verified.

## Evidence and scope

`frozen-input-pins.json` pins 19 public source, finding and geometry inputs. It separately pins 10 local original bodies or text captures and 13 independently inspected local views. Nura's four source hashes identify exact tool-returned text captures, not original PDF or HTTP response bytes. A blank Sarysu page and the field-site table are explicitly not counted as maps.

`source-observations.json` records independent reading and full-map observations. `independent-review.json` states the resulting bounded decisions. Full geometry contains nine fragments, 678 line parts and 4,220 coordinate positions. Independent Python binary decoding matches the retained full geometry, its part/coordinate order, bounds, endpoint joins, roles and source-ID metadata. The pinned production decoder was also replayed. Equal source-ID and line-part counts do not independently establish the original source reach-to-coordinate mapping.

Complete coordinate arrays, GeoJSON, source bodies and map images remain outside the public package because standalone redistribution has not been cleared. This package contains factual summaries, identifiers, counts, bounds/endpoints, hashes and validation code.

## Offline replay

Durable-only validation requires Python 3 and performs no network requests:

    python review/validate-independent-review.py
    python -B review/test-independent-review.py

This mode checks the public facts, frozen hashes, identifier joins and naming gates. It does not re-read unpublished complete coordinates, original source bodies, text captures or map images. Stored successful-review results describe the recorded review run, not work repeated by durable-only validation.

Optional complete local replay also needs Node.js, the complete pinned immutable input cache, retained geometry, selected historical inventory originals and the retained evidence assets:

    python review/validate-independent-review.py --input-cache BASELINE_CACHE --historical-input-root RECOVERED_ROOT --local-geometry LOCAL_GEOMETRY --local-source-index SOURCE_INDEX --local-source-root SOURCE_ROOT
    python -B review/test-independent-review.py --local-geometry LOCAL_GEOMETRY

The local source index is a JSON array of objects with `id` and `local_file`; IDs match `local_evidence_assets` in the public pins. Relative paths are resolved against `SOURCE_ROOT`. The index and underlying files are not distributed. Missing local inputs are not fetched or substituted. Partial options produce a truthfully labeled partial-local result.

The 10 bounded corrupt fixtures cover unsupported name/application clearance, altered source metadata, missing fragments or parts, reversed part order, a changed interior coordinate and reordered source IDs. They operate on copies and leave original inputs unchanged.
