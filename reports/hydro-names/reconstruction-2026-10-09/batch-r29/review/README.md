# Independent lake-name review r29

Three new Katmai-region inventory targets add three distinct records, taking reconstructed coverage from 81 to 84. Every selected source and baseline-rendered polygon part and ring was considered in the retained independent review.

- lakes_base:1159109687: Nonvianuk Lake; supported_generalized_water_identity.
- lakes_base:1159111345: separate Lake Coville and Lake Grosvenor component associations; compound_feature_name_scope_hold, with no single candidate name.
- lakes_base:1159111357: Lake Brooks; supported_generalized_water_identity.

Each target has one polygon and one ring. Position counts, including ring closure, are 29, 34 and 15, totaling 78. The single Coville–Grosvenor ring spans two separately labelled waters; a completed correspondence review does not resolve the precise inter-lake naming boundary or approve one name for that polygon.

The official NPS Katmai park map supplies the direct naming evidence. The Naknek boating guide supplies limited regional context. These two retained publications are not two established independent cartographic sources. No new external requests were made. The source bibliography and own factual observations are in source-observations.json.

Formal-registry decisions, exact shorelines, name boundaries, Korean forms and scalar product-name application are not approved. All product-name fields remain null and automatic application is false. The 24 prior scope holds and two pending-access IDs are preserved without reassessment; this batch adds one scope hold.

Run `python -B validate-independent-review.py` and `python -B test-independent-review.py` from this directory. The validator checks only included factual linkage, bounded metadata, arithmetic and included-file byte integrity. It does not reopen original maps, recompute omitted complete polygons or replay the production decoder. Original maps, crops, full coordinates, private paths and omitted-input fingerprints are excluded. The pins cover only the nine included geometry-component files; the review manifest covers the seven other review files and excludes itself.
