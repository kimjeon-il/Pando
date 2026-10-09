# Independent three-target review

This review covers exactly the r04 inventory selection at immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. Current deployment equality is unchecked.

- `hydro-system:70152112`: Attawapiskat representative-name candidate retained. Whole-group and per-reach naming remain held. The three fragments contain 188 parts and 1,279 positions; all retained roles are mainstem. Acquired park mapping does not establish the complete named headwater-to-sea route.
- `lakes_base:1159123163`: Kamianske Reservoir identity supported for the generalized principal-body polygon. Its 92-position ring omits the charted narrow upper reservoir and is not the complete physical boundary. One adjacent duplicate is preserved.
- `lakes_base:1159123567`: Portuguese reservoir usage `Theodomiro Carneiro Santiago (Emborcação)` is supported textually, with whole-feature extent held. The new 208-position target was selected by exact numeric Natural Earth `ne_id`; no recovered historical verdict is asserted. The source alternate `Theodomiro Sampaio` remains uncorroborated.

These are research findings. Every automatic, scalar-product and whole-group application flag is false. Korean names remain null. No product or geometry changes were made.

## What was checked

`frozen-input-pins.json` fixes 23 submitted public input files and separately identifies 28 local evidence assets by hash and kind. The source bodies and views themselves are absent. `source-observations.json` records independent readings and visual scope. `independent-review.json` contains the adjudication and identifier joins.

A separate Python decoder parsed the selected immutable binary packs, including polygon rings, line parts, vertex order and width-profile structure. Its five features exactly matched the retained production-decoder result and original metadata joins. All selected lake source features were independently joined to the original source collection, and selected inventory rows were checked without reopening the whole historical investigation. Full river source-shapefile equivalence remains unverified.

The complete Pipestone zoning page and Kamianske chart were viewed, including the latter’s full-resolution title, graticule, insets and imprint. Source-data plots of every selected part were inspected. The Kamianske ring overlay is approximately registered, not surveyed. The Emborcação material includes no inspected primary map. Hash verification of retained view files does not repeat visual review.

## Offline replay

From this directory:

    python validate-independent-review.py
    python test-independent-review.py

Default mode independently checks included source/baseline lake geometries and invokes the frozen geometry component validator. It checks submitted hashes, published facts, source-key joins and naming gates. It does not claim to recheck omitted river coordinates, raw publications, DBF subsets or original inventory assets.

Optional complete local replay:

    python validate-independent-review.py --input-cache INPUT_CACHE --historical-input-root RECOVERED_REPOSITORY --local-geometry SELECTED_MIXED_GEOJSON --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT
    python test-independent-review.py --local-geometry SELECTED_MIXED_GEOJSON

`INPUT_CACHE` contains the exact immutable filenames/hashes listed in `geometry-reference.json`. `RECOVERED_REPOSITORY` supplies the three original inventory assets at their recorded repository paths. `SELECTED_MIXED_GEOJSON` has the unpublished full-geometry hash recorded in the pins. Node.js is required only for production-decoder replay; Python 3 handles the independent decoder and public checks.

`LOCAL_INDEX_JSON` is an array of objects with an `id` matching a local-evidence pin and a relative `local_file` beneath `LOCAL_EVIDENCE_ROOT`. Absolute paths and parent traversal are rejected. Existing authorized source bytes must be supplied locally; these scripts do not fetch or suggest retrying failed publications. The DBF check reparses the retained original header and record only. It cannot rehash the absent full DBF or independently relocate that row in the absent stream.

`review-validation.json` records both modes and 16 rejected bounded corruptions, including scope/clearance changes, ring/part reversal, interior coordinate changes, a missing fragment, role and source-ID-order changes, and frozen source-byte tampering. Durable-only tests exercise ten fixtures; six full-river fixtures require the optional local geometry.

## Redistribution and limits

Only own factual observations, bounded metadata, hashes, public citations and scripts appear here. The surrounding package includes selected public-domain Natural Earth lake coordinates. Complete river coordinates, packs, third-party HTML/PDF/chart bytes and map-derived rasters remain local. No full original PDF hash is inferred from tool text, and the whole-stream Natural Earth DBF acquisition hash is not a claim of a new local full-file rehash.

No network requests, current-deployment checks, formal naming registration, full physical-boundary certification, whole-history audit, geometry repair or naming application occurred in this independent review.
