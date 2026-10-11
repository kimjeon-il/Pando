# Independent r05 lake review

Exactly three fresh inventory targets were checked, in fixed order, at immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `lakes_base:1159110371`: Artillery Lake principal-body association supported; possible southwestern downstream extra extent remains unresolved. The regional map spells the nearby smaller-lake label **Toura Lake**. No T’oula equivalence or proven composite is asserted.
- `lakes_base:1159109471`: Lac de Gras and Lac du Sauvage are separately named connected waters represented in the generalized footprint. The combined review description is an association, never an official composite or scalar feature name.
- `lakes_base:1159111751`: Yamba Lake principal-body association supported, with the southwest lobe associated with Daring Lake. Exact named subdivision and complete coverage remain unresolved.

All three findings are `whole_polygon_scope_hold`. Every whole-feature scalar name is null. Korean names, automatic application, product-name clearance, formal registry verification and exact shoreline claims are absent or false. These are fresh findings, not restoration of historical verdicts. No geometry or product files were changed.

## Evidence and checks

The independent Python decoder reproduced all three rendered features, including complete metadata, ring order and 114, 205 and 104 positions. All 423 source positions match the rendered positions after six-decimal quantization. Exact source IDs, logical FIDs, geometry FIDs, original source feature positions and selected inventory rows were checked. The previous index has 12 distinct targets, none repeated here: increment 3, cumulative 15.

Original PDFs, separate text extractions, acquisition receipts and inspected views were rehashed. The entire December 18, 2018 GNWT map, complete source-ring overlays and independent unoverlaid details were viewed. Conclusions distinguish actual blue-water shapes from label placement. The DIAND report confirms the Lac du Sauvage–Lac de Gras narrows; the station report confirms Yamba–Daring narrows. Parks Canada supplies Artillery and lower Lockhart context. The blank DIAND Map 1 frame was excluded.

The 1:400,000 map's embedded controls and Lambert transformation were checked, and all 423 positions were reprojected for numerical consistency. Tiny corner-fit residuals are not independent ground-control accuracy or shoreline certification. No measured overlap percentage or exact named-lake split is claimed.

`frozen-input-pins.json` covers 23 frozen public geometry/research inputs and 23 separate local evidence assets. `source-observations.json` records independent readings and visual limits. `independent-review.json` contains the bounded adjudication. Source bodies, full text, maps, photographs, raw packs and map-derived images are not distributed here. Selected Natural Earth geometries remain in the enclosing package under its recorded rights basis.

## Offline replay

From this directory:

    python validate-independent-review.py
    python test-independent-review.py

Durable-only mode checks included complete source/rendered geometries, frozen public hashes, source-provenance joins, projection consistency, prior exclusion metadata and naming gates. It does not claim to reopen original publications, original inventory assets or upstream binary packs.

Complete local replay uses already retained inputs:

    python validate-independent-review.py --input-cache INPUT_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT
    python test-independent-review.py --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT

The source index is an array of `{ "id": "PIN_ID", "local_file": "relative/file" }` entries. IDs match local evidence pins; paths must be relative beneath the supplied root without parent traversal. The cache supplies immutable assets named in `geometry-reference.json`, the recovered repository supplies the selected inventory files at their recorded repository paths, and the previous index supplies the pinned r04 bytes. Scripts do not fetch missing material. Python 3 handles the independent decoder; Node.js is additionally needed for production-decoder replay.

`review-validation.json` records passing durable-only and full-local runs. Twenty durable corruption fixtures reject naming clearance, invented Korean, scope/order/FID/count changes, interior coordinate and ring-order changes, dropped targets, shifted registration, source-byte changes and PDF/text hash confusion. A twenty-first full-local fixture rejects an altered original PDF byte. Temporary fixtures never modify original inputs. Hash replay does not repeat visual inspection.

The review manifest pins seven review files and excludes itself. No network requests, live-deployment verification, formal name registration, exact shoreline survey, geometry repair, or naming application occurred in this review.
