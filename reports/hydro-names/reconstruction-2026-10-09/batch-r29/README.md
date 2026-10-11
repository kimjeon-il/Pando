# Lake-name reconstruction r29

Three new Alaska lake inventory features were assessed against retained official National Park Service Katmai maps and complete immutable baseline polygons. The geometry reference remains Pando v0.13.1 at fd6744f5e72a0c1a107452dbde6d416ab57237db; correspondence to the latest packed web data is not verified here. No historical verdict is restored.

## Findings

- **1159109687: Nonvianuk Lake.** The complete west-to-east generalized footprint has a broad rounded western basin and a narrower eastern continuation. Its position south of Kukaklek Lake, west of the separately mapped Kulik Lake, and east of the Nonvianuk River matches the water polygon directly labelled NONVIANUK LAKE on the official Katmai park map. The complete source and rendered ring support Nonvianuk Lake as a generalized water identity. This is a regional visual correspondence, not a surveyed shoreline or exact lake-to-river boundary. Category: `supported_generalized_water_identity`.
- **1159111345: No single name assigned.** The complete generalized footprint begins with a northwestern north-south arm, bends southeast into a long eastward middle basin, and turns southeast again at its eastern end. The official Katmai park map labels the northwestern water LAKE COVILLE and the eastward/southeastern water LAKE GROSVENOR, with a narrow connection near Grosvenor Lodge. Both mapped waters correspond to portions of this single continuous inventory ring. No one-name identity for the complete polygon is established; Lake Coville and Lake Grosvenor are retained as separately labelled component waters. The precise inter-lake or connecting-channel name boundary is unresolved. Category: `compound_feature_name_scope_hold`.
- **1159111357: Lake Brooks.** The complete compact southwest-to-northeast generalized footprint matches the water directly labelled LAKE BROOKS on the official Katmai park map. Its northeastern end lies by Brooks River and Brooks Camp, southwest of the Naknek Lake and Iliuk Arm waters shown separately on the map. The full-lake page of the Naknek boating guide supplies additional regional shoreline and Brooks Camp context, without providing another certified selected-lake name in this review. The complete source and rendered ring support Lake Brooks as a generalized water identity, with exact shoreline, islands and lake-to-river boundary unverified. Category: `supported_generalized_water_identity`.

## Scope and continuity

Generalized identity does not establish surveyed coastline agreement, exact name partitions, formal registry status or product-ready scalar names. Korean names and whole-feature scalar names remain null; automatic and product application are false.
The index contains 84 distinct targets: 43 river groups and 41 lake features. It preserves 82 non-access-pending records, 2 access-pending records and 25 scope holds. Non-access-pending is an accounting category, not a count of confirmed names. Earlier records and the Richmond/Hastings assessment histories are preserved; the unavailable historical 504-target ledger is not added.
The exact original inventory and cumulative index recover 3,981 unrecorded targets: 3,412 river groups and 569 lakes. Pending IDs and scope holds remain separately recoverable.

## Public verification

Run `python validate-package.py` for included-file integrity, current-result consistency and cumulative accounting. `recover-remaining-queue.py` uses the exact initial inventory. Public validators do not replay omitted source maps, complete polygons or original decoder inputs. Only own factual findings, official bibliography and bounded metadata are included; original map bodies, crops, full lake coordinates and private-input fingerprints are omitted.
