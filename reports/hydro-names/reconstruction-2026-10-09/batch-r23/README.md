# River-name reconstruction r23

Three new actual-inventory MAIN_RIV group investigations against immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. The live deployment was not checked and no historical verdict is restored.

## Reviewed scope

- **50798927: Mitchell River.** The complete selected path runs southeast from a far-northwestern headwater, turns south through the middle corridor, then bends east and southeast into the Gippsland Lakes coastal complex. Direct blue Mitchell river-line labels support Mitchell River in Victoria as a representative system identity. The long northwestern upper continuation is not individually named by the inspected maps; a modeled mainstem can include differently named feeder reaches and does not make every part Mitchell. Exact feeder-to-river name transitions, any river/storage interfaces and the final generalized line through lake or coastal water remain unassigned at reach level. Category: `supported_representative_system_identity`.
- **50798928: Tambo River.** The complete selected path runs southwest from its northeastern headwater, turns south, bows east in the middle course, then turns southwest and south toward the Gippsland Lakes coastal complex. Figure 5.31 explicitly labels the Tambo River D/S of Ramrod Creek monitoring site on the eastern channel, supporting Tambo River as a representative system identity in conjunction with the complete regional path comparison. The upstream continuation is not individually named throughout. A modeled mainstem can include differently named feeder reaches and does not establish a uniform river name. Exact feeder-to-river transitions, any river/storage interfaces and the final generalized line through lake or coastal water remain unassigned at reach level. Category: `supported_representative_system_identity`.
- **50800637: Latrobe River.** The complete selected path follows a long, nearly west-to-east corridor, with modest middle-course bends, a northeastern lower bend and a southeastern ending toward the Gippsland Lakes coastal complex. Direct blue La Trobe river-line wording and the Latrobe at Rosedale named monitoring site support Latrobe River as a representative system identity; the source also uses Latrobe in prose. The far-western upper continuation is not individually named throughout. A modeled mainstem can include differently named feeder reaches and does not establish a uniform river name. Exact feeder-to-river transitions, any river/storage interfaces and the lake-facing coastal ending remain unassigned at reach level. Category: `supported_representative_system_identity`.

Representative system identity is not a name assignment to every fragment, mainstem segment or tributary. The rendering role `mainstem` is a graph/display role, not naming evidence. Whole-group scalar names and Korean research names remain null; all-reach verification, formal registry approval and automatic/product application are false.

## Evidence limits

The public bibliography and page-specific observations are in `review/source-observations.json`. Actual retained source publications and complete selected baseline groups were inspected during research. Public evidence states the named-map scope and any upstream, tributary, reservoir or mouth limits. Multiple figures from one publication do not become independent naming authorities.

Private complete-path verification covers 3 fragments, 121 ordered line parts and 754 positions. Public files include only bounded identifier/count/bounds/name-state summaries. They contain no full river coordinate arrays, per-part paths or omitted private-source fingerprints. Original HydroRIVERS coordinate equality and surveyed current geometry were not established.

Run `python validate-package.py` for offline included-file integrity, summary consistency, review linkage and cumulative-count checks. The public validators cannot reproduce omitted complete-path, original map or original-decoder judgments. There is no private-cache replay interface in this package.

## Continuity and coverage

The prior 66 records are fixed through `1dd4a326287801853a0c2fa27186fae6aeda18c5`. This batch adds three distinct river groups for 69 total: 38 lakes and 31 river groups. Existing candidate scopes, Sandfly eastern-basin wording, Ohrid/Prespa candidate holds and known access-pending records remain preserved. The unavailable historical 504-target ledger is not restored.
The cumulative records include 67 non-access-pending records and 2 access-pending records. Non-access-pending is an accounting category, not a count of uniformly named or fully confirmed targets.
Of three current bounded attempts, 3 completed source-scope assessment and 0 remain source-access-limited. Completion is not a claim of uniform reach naming or approved scalar names.

## Recoverable remaining queue

The cumulative index and exact committed initial inventory recover 3,996 unrecorded targets: 3,424 river groups and 572 lakes. Run `python recover-remaining-queue.py --inventory INVENTORY.csv.gz --include-ids`. Remaining means absent from fresh reconstructed records, not historically never researched. Known access-pending IDs and scope holds remain separate from that unrecorded list.
