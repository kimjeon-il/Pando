# Independent r13 findings and public validation

- `lakes_base:1159110463`: generalized Calcasieu Lake identity supported
- `lakes_base:1159107033`: generalized Lake Maurepas identity supported
- `lakes_base:1159110475`: whole-polygon naming-scope hold; Lake Salvador is associated with the main southern basin

All three bounded whole-feature assessments are completed. Salvador still requires follow-up: the complete map footprint includes an unassigned northern lobe and connecting water, and no second named constituent or exhaustive union is established. Six unavailable auxiliary publications were not used as evidence. The acquired CPRA map covers the whole footprint, so this naming-scope hold is distinct from an uninspected access gap.

The coastal and estuarine context is retained. No uniform freshwater classification or salinity measurement is claimed. All scalar/language outputs remain null. Product-name approval, automatic application, geometry repair, formal registry and exact-shoreline claims remain false.

The three current targets are distinct from the prior 36. Together they make 39 recorded targets, including holds. Cold Lake remains one separate carried-forward access gap and was not reassessed. Seven earlier scope holds are preserved; Salvador adds an eighth. These totals do not count approved names.

## Historical assessment and limits

The review inspected complete original and baseline outlines and actual acquired map pixels. The NOAA overview supports Calcasieu regional correspondence with channel, marsh and northern-edge limits. May 2022 is its compilation/final-review month, not a confirmed publication date. The CPRA FY 2024 plan supports Maurepas and the Salvador scope assessment; its URL date is not a verified printed date. The May 2011 state plan supplies independent name and coastal context. Repeated CPRA panels count as one publication.

The three source and baseline rings contain 34, 26 and 41 positions including closure. Every ordered source position matches the included baseline after six-decimal quantization. The baseline is pinned to `fd6744f5e72a0c1a107452dbde6d416ab57237db`; current live deployment was not checked. This verifies the selected representations, not surveyed shorelines or precise name boundaries.

Original publications and inspection materials are omitted. The included factual record documents the past assessment; public validation cannot reopen omitted sources, repeat visual inspection, reproduce name judgments or re-audit prior targets.

## Included-file verification

Run with Python 3:

    python validate-independent-review.py
    python test-independent-review.py

The validator reads only included files and makes no network requests. It checks 15 included input-file pins, research/review manifests, 101 ordered positions, identity joins, research/review factual linkage, source bibliography, access/completion flags and preserved follow-up categories. Mutation tests check these bounds without treating byte integrity as proof of source interpretation.

The review manifest covers its seven other included files and excludes itself. Passing validation means included-file integrity and consistency; it does not independently establish the truth of the historical cartographic interpretation.
