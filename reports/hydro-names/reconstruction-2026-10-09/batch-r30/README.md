# Lake-name reconstruction r30

Three new Alaska lake inventory features were assessed against the Alaska DNR-hosted Wood-Tikchik State Park map and complete immutable baseline polygons. The map uses third-party TOPO! cartography; official hosting does not establish a formal naming-registry decision. The geometry reference remains Pando v0.13.1 at fd6744f5e72a0c1a107452dbde6d416ab57237db. A separate compact note records published-manifest/hash correspondence with v0.13.2 and the three prior r29 IDs. No current live binary or renderer equivalence is asserted. No historical verdict is restored.

## Findings

- **1159110649: Upnuk Lake.** The complete selected generalized footprint supports Upnuk Lake as a bounded water identity at this map scale. The narrow mapped western-arm continuation extends beyond the generalized selected outline; no entire detailed named-lake coverage is claimed. Exact extent and product-name application are not approved. Category: `supported_generalized_water_identity`.
- **1159107913: Chikuminuk Lake.** The complete selected generalized footprint supports Chikuminuk Lake as a bounded water identity at this map scale. Mapped islands, detailed western shoreline branches and the southeast rapid/river connection are not resolved; no entire detailed named-lake coverage or exact lake-to-river boundary is claimed. Exact extent and product-name application are not approved. Category: `supported_generalized_water_identity`.
- **1159110611: Lake Chauekuktuli.** The complete selected generalized footprint supports Lake Chauekuktuli as a bounded water identity at this map scale. Fine western inlet and arm details, irregular margins and eastern connections are generalized; no entire detailed named-lake coverage or exact connecting-channel name boundary is claimed. Exact extent and product-name application are not approved. Category: `supported_generalized_water_identity`.

## Scope and continuity

Generalized identity does not establish surveyed shoreline agreement, exact name partitions, formal registry status or product-ready scalar names. Korean names and whole-feature scalar names remain null; automatic and product application are false.
The index contains 87 distinct targets: 43 river groups and 44 lake features. It preserves 85 non-access-pending records, 2 access-pending records and 25 scope holds. Non-access-pending is an accounting category, not a count of confirmed names. Earlier records and the Richmond/Hastings assessment histories are preserved; the unavailable historical 504-target ledger is not added.
The exact original inventory and cumulative index recover 3,978 unrecorded targets: 3,412 river groups and 566 lakes. Pending IDs and scope holds remain separately recoverable.

## Public verification

Run `python validate-package.py` for included-file integrity, current-result consistency and cumulative accounting. `recover-remaining-queue.py` uses the exact initial inventory. Public validators do not replay omitted source maps, complete polygons, compressed component bytes or original decoder inputs. Only own factual findings, bibliography, bounded metadata and an explicitly scoped note citing public payload hash declarations are included; original map bodies, crops, full lake coordinates and private-input fingerprints are omitted.
