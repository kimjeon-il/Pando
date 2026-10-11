# Independent r12 findings and public validation

- `lakes_base:1159108391`: generalized Montreal Lake identity supported
- `lakes_base:1159112839`: generalized Wapawekka Lake identity supported
- `lakes_base:1159112207`: Wood–Mirond compound-feature name-scope hold

All three historical full-feature assessments are completed; none of these three is source-access-limited. The third polygon reaches separately labelled Wood Lake and Mirond Lake waters, plus unassigned central and southwestern extent. It requires follow-up before any naming or geometry change. The supported labels do not establish an exhaustive two-lake union. Pelican Narrows remains a settlement label, not a lake name.

Scalar and language-form outputs remain null. Product-name approval, automatic application, geometry repair, formal registry verification and exact-shoreline claims remain false. Cold Lake `lakes_base:1159112821` remains a separate carried-forward source-access-limited follow-up, outside this batch and not reassessed. Recorded cumulative counts are 33 prior targets plus these 3, or 36 including holds; they do not count verified scalar names.

## Historical assessment and included evidence

The independent review inspected the original WSA map and complete source and baseline shapes. The map was printed November 25, 2014 at 1:1,750,000. Its 2025 URL folder does not change that date. All three naming findings rely on this one publication. The ECCC letter-D station index supplies no target corroboration.

The source and baseline polygons have one ring each, containing 81, 45 and 151 positions including closure. Every ordered included source position matches its included baseline at six-decimal precision. This verifies the selected representations, not surveyed shorelines or equality with a current deployment.

The original publications and inspection materials are not included. The historical source review is recorded as a past assessment. The current public validator does not reopen omitted publications, repeat visual inspection, reproduce map-name judgments or re-audit prior targets. Bibliographic references and original factual observations remain available for readers to evaluate those limits.

## Public-only verification

Run from this directory with Python 3:

    python validate-independent-review.py
    python test-independent-review.py

The validator reads only included public files. It checks file integrity, all 277 ordered source/baseline positions, geometry identity joins, factual correspondence between research and review records, official source metadata, current completion/access flags, the compound hold and carried-forward Cold Lake gap. It has no original-source replay mode and makes no network requests.

`public-input-pins.json` lists only included input files. Each research manifest covers included files in its own directory. The review manifest covers the seven other review files, excluding itself. `review-validation.json` records current public-only checks and corruption tests separately from the historical assessment. Passing these checks verifies internal consistency and included-file integrity, not the independent truth of the source interpretation.
