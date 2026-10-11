# River-name reconstruction r20

Three new actual-inventory MAIN_RIV group investigations against immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. The live deployment was not checked and no historical verdict is restored.

## Reviewed scope

- **50624422: Mary River.** The complete selected path extends north from the southern inland headwater through a long northward course, then bends northeast toward the Great Sandy Strait. The directly mapped Mary River monitoring site at Miva, lower-river course and surrounding coastline support Mary River as a representative system identity. The southern upper reaches, any feeder naming transitions and coastal continuation are not assigned individual names. The selected mainstem role does not establish a uniform name for all 49 parts. Category: `supported_representative_system_identity`.
- **50663106: Brisbane River.** The complete selected path includes a western upper extension, a northeastward upper bend, the southward middle corridor and a winding eastward lower course toward Moreton Bay. The directly mapped Brisbane River monitoring site at Savages Crossing and whole-path regional correspondence support Brisbane River as a representative system identity. The upper western feeder remains unnamed. Wivenhoe is storage context; neither reservoir passages nor the exact name transition and coastal endpoint receive reach-level names. The modeled mainstem role is not proof of uniform Brisbane naming. Category: `supported_representative_system_identity`.
- **50668362: Logan River.** The complete selected path runs from a southwestern upper extension through a northerly inland corridor, then northeast and east toward the southern Moreton Bay margin. The directly mapped Logan River monitoring site at Yarrahappini and surrounding course support Logan River as a representative system identity. Logan-Albert is a regional catchment grouping, not a compound name assigned to this path. Southwestern headwater or feeder reaches, possible storage-related transitions and the coastal ending remain individually unnamed. No Albert reach assignment is made. Category: `supported_representative_system_identity`.

Representative system identity is not a name assignment to every fragment, mainstem segment or tributary. The rendering role `mainstem` is a graph/display role, not naming evidence. Whole-group scalar names and Korean research names remain null; all-reach verification, formal registry approval and automatic/product application are false.

## Evidence limits

The public bibliography and page-specific observations are in `review/source-observations.json`. Actual retained source publications and complete selected baseline groups were inspected during research. Public evidence states the named-map scope and any upstream, tributary, reservoir or mouth limits. Multiple figures from one publication do not become independent naming authorities.

Private complete-path verification covers 3 fragments, 159 ordered line parts and 1,068 positions. Public files include only bounded identifier/count/bounds/name-state summaries. They contain no full river coordinate arrays, per-part paths or omitted private-source fingerprints. Original HydroRIVERS coordinate equality and surveyed current geometry were not established.

Run `python validate-package.py` for offline included-file integrity, summary consistency, review linkage and cumulative-count checks. The public validators cannot reproduce omitted complete-path, original map or original-decoder judgments. There is no private-cache replay interface in this package.

## Continuity and coverage

The prior 57 records are fixed through `57f20ae532ef66469ea2687c5ba428d3bf257756`. This batch adds three distinct river groups for 60 total: 38 lakes and 22 river groups. Existing candidate scopes, Sandfly eastern-basin wording, Ohrid/Prespa candidate holds and known access-pending records remain preserved. The unavailable historical 504-target ledger is not restored.
The cumulative records include 58 non-access-pending records and 2 access-pending records. Non-access-pending is an accounting category, not a count of uniformly named or fully confirmed targets.
Of three current bounded attempts, 3 completed source-scope assessment and 0 remain source-access-limited. Completion is not a claim of uniform reach naming or approved scalar names.

## Recoverable remaining queue

The cumulative index and exact committed initial inventory recover 4,005 unrecorded targets: 3,433 river groups and 572 lakes. Run `python recover-remaining-queue.py --inventory INVENTORY.csv.gz --include-ids`. Remaining means absent from fresh reconstructed records, not historically never researched. Known access-pending IDs and scope holds remain separate from that unrecorded list.
