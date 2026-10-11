# Lake-name reconstruction r34

Three new Manitoba lake inventory features were assessed against official-hosted public map evidence and complete immutable baseline polygons. Source observations identify the actual inspected publications, their cartographic scope and limits. The geometry reference remains Pando v0.13.1 at fd6744f5e72a0c1a107452dbde6d416ab57237db. The previously published [compact correspondence note](https://github.com/kimjeon-il/Pando/blob/1a3b4b3437000b4bcf3913a287316d1ab5f65897/reports/hydro-names/reconstruction-2026-10-09/batch-r30/packed-payload-correspondence.json) records v0.13.2 manifest/hash preservation and the three r29 IDs. No current live binary or renderer equivalence is asserted. No historical verdict is restored.

## Findings

- **1159109169: Kississing Lake.** The complete selected generalized footprint supports Kississing Lake as a bounded water identity. The island-studded basin, narrow arms and peninsula margins are heavily generalized; several fine northern and southern shoreline extensions are omitted. Islands are not represented as holes. The exact Kississing River transition and complete detailed named-lake extent are not verified. Exact extent and product-name application are not approved. Category: `supported_generalized_water_identity`.
- **1159109861: Clearwater Lake.** The complete selected generalized footprint supports Clearwater Lake as a bounded water identity. Fine northern bays, islands and peninsulas, southwestern/southern shoreline extensions and the southeastern projection are generalized or omitted. The exact connection toward Cormorant Lake and complete detailed named-lake extent are not verified. Exact extent and product-name application are not approved. Category: `supported_generalized_water_identity`.
- **1159109871: Cormorant Lake.** The complete selected generalized footprint supports Cormorant Lake as a bounded water identity. The long northern and northwestern extensions, intricate shoreline indentations and eastern hook are generalized or omitted, and islands are not represented as holes. The exact adjoining-water boundaries and complete detailed named-lake extent are not verified. Exact extent and product-name application are not approved. Category: `supported_generalized_water_identity`.

## Scope and continuity

Generalized identity does not establish surveyed shoreline agreement, exact name partitions, formal registry status or product-ready scalar names. Korean names and whole-feature scalar names remain null; automatic and product application are false.
The index contains 99 distinct targets: 43 river groups and 56 lake features. It preserves 97 non-access-pending records, 2 access-pending records and 27 scope holds. Non-access-pending is an accounting category, not a count of confirmed names. Earlier records and the Richmond/Hastings assessment histories are preserved; the unavailable historical 504-target ledger is not added.
The exact original inventory and cumulative index recover 3,966 unrecorded targets: 3,412 river groups and 554 lakes. Pending IDs and scope holds remain separately recoverable.

## Public verification

Run `python validate-package.py` for included-file integrity, current-result consistency and cumulative accounting. `recover-remaining-queue.py` uses the exact initial inventory. Public validators do not replay omitted source maps, complete polygons, compressed component bytes or original decoder inputs. Only own factual findings, bibliography, bounded metadata are included; the earlier public payload-correspondence note is linked without duplicating it; original map bodies, crops, full lake coordinates and private-input fingerprints are omitted.
