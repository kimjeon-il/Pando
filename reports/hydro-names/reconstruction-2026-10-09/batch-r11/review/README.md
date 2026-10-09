# Independent r11 lake review

Three fresh actual-inventory targets in fixed order against baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `lakes_base:1159112291`: generalized **Dauphin Lake** identity supported by complete watershed-plan map panels and separate federal hydrometric usage.
- `lakes_base:1159112821`: **Cold Lake** remains an unresolved lead. The full geometry is checked, but official full-waterbody map correspondence is not completed. Source access is limited and follow-up remains required.
- `lakes_base:1159109155`: generalized **Deschambault Lake** identity supported by the full WSA mapped waterbody and federal station-name usage. Nearby Jan, Wood, Wapawekka and Mirond waters are distinguished.

These are two completed generalized correspondence assessments plus one bounded, source-limited unresolved record. The cumulative count of 33 is a count of fresh recorded research verdicts, including holds and unresolved cases, not 33 verified names. The prior 30 IDs are used only for incremental exclusion and category accounting. No previous target's naming or geometry was re-reviewed.

All product scalar-name and language-form fields are null. Automatic application, product-name approval, formal registry verification and exact shoreline claims are false. No product geometry was edited or repaired.

## Independent checks and evidence

The complete original Natural Earth features, exact source IDs, source positions, baseline FIDs, logical FIDs, metadata and every ordered coordinate were checked. An independent Python binary decoder reproduced all three baseline polygons: 51, 43 and 124 positions, 218 total. Every source coordinate matches the retained baseline after six-decimal quantization. Whole-source and baseline plots were visually inspected.

Four original naming-source bodies were read and rehashed: the Manitoba watershed plan, its distinct ECCC station index, the WSA map and a second ECCC station index. The two map publications supply three inspected panels, not three independent sources. Original map pixels were viewed, including independent page renders and full Deschambault context details. Generalized whole-waterbody correspondence is separate from a surveyed shoreline or a georeferenced overlay; none of those precision claims is made.

The Manitoba plan's printed publication date was not established. January 2016 creation and December 2017 modification are PDF metadata only. WSA prints November 25, 2014 at 1:1,750,000; its 2025 URL folder does not update the map. Both ECCC pages show September 11, 2026 modification, which does not establish a formal naming decision. Reused WSA and ECCC original acquisition times remain their earlier October 9 retrieval times.

Cold Lake has only a retained pre-denial web text capture. It contains the name and a July 24, 2019 completion imprint but cannot resolve which occurrence labels the lake versus the community. Three original-publication acquisitions returned HTTP 403 and supplied no original bytes or body hashes. The earlier screenshot attempt supplied a reference without usable pixels. Text-capture hashes are not original-PDF hashes. The WSA western edge does not provide a complete named Cold Lake view.

An intended Manitoba highway-map request instead returned generic ministry HTML. That fifth retained response body is excluded from naming evidence. Original bodies, full extracted text, map images, crops and failure receipts are not distributed. Only original factual observations, bounded provenance and the enclosing geometry component's permitted selected public-domain lake features are public.

## Offline replay

From this directory:

    python validate-independent-review.py
    python test-independent-review.py

Durable-only mode verifies all included complete source and rendered coordinates, exact frozen public bytes, naming and geometry joins, source dates, unresolved-source gates and incremental duplicate/queue facts. It does not reopen omitted original publications, original inventory or baseline binary assets. Hash replay does not repeat visual inspection.

Full-local mode adds retained inputs without any network requests:

    python validate-independent-review.py --input-cache INPUT_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT
    python test-independent-review.py --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT

The local source index is an array of `{ "id": "PIN_ID", "local_file": "relative/file" }` entries under the supplied root. IDs match frozen local assets. Paths must be relative without parent traversal. Python 3 is required; production-decoder replay also uses Node.js.

The review freezes 26 public geometry/research input files and 28 retained local assets. Full-local inventory accounting independently verifies 5,173 unique initial rows, 4,065 eligible targets, 33 recorded verdicts (17 lakes, 16 river groups), and 4,032 unrecorded targets (593 lakes, 3,439 river groups). The source-limited Cold record remains follow-up-required despite exclusion from the unrecorded queue.

`review-validation.json` records durable and full-local checks, 40 durable corruption fixtures and one additional altered-original-byte fixture in full-local mode. Fixtures reject erased Cold follow-up, fabricated map pixels/body hashes/completion, promoted unresolved verdicts, incorrect dates, prior duplicates, queue changes, unsupported naming and changed ordered coordinates. The tests never modify retained originals.

Exactly eight public review files are included. The manifest pins seven and excludes itself. No live-deployment check, new source request, formal registry check, geometry modification or automatic naming application occurred in this independent review.
