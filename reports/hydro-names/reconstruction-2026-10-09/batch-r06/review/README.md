# Independent r06 lake review

Exactly three new actual-inventory targets, fixed order, against immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `lakes_base:1159109553`: generalized **Dore Lake** identity supported. Only the unaccented spelling has direct source support here.
- `lakes_base:1159110303`: generalized **Ennadai Lake** identity supported across adjoining 65C and 65F sheets. Separately mapped North End Lake is east of the northeastern arm; its label does not establish an included second lake.
- `lakes_base:1159108091`: generalized **Naknek Lake** identity supported with an explicit named-subbasin caution. The northwestern lobe includes the locally labeled Johnny's Lake basin. Its independent formal-lake status and exact name extent remain unestablished.

All three use the comparable research category `supported_generalized_water_identity`. The more detailed source category and Naknek review status are retained. Product scalar names, unsupported Korean and language-form fields are null. Automatic application, product-name clearance, registry verification and exact shoreline claims are false. These are fresh investigations, not restoration of historical verdicts. No product or input geometry was edited.

## Evidence and limits

The complete original source features, source feature positions, exact IDs, logical FIDs, geometry FIDs and rendered metadata were independently checked. An independent Python binary decoder reproduced all three baseline features. Every ordered source coordinate matches its rendered counterpart after six-decimal quantization: 101, 192 and 96 positions, 389 total. The previous index has 15 distinct targets and no overlap: increment 3, cumulative 18. Only this incremental exclusion was checked; no whole-history reaudit is claimed.

Twelve original acquired bodies were independently read or viewed and rehashed, with their acquisition receipts. They include catalogs and government-use pages as well as five map publications. Five maps are not five independent naming sources: the Ennadai pair are complementary sheets of the same series, and NPS publications share an agency context. Text-only reads are distinguished from actual map-pixel inspection.

The WSA map is printed November 25, 2014; its URL folder year does not update the map. Ennadai sheets have 1979 thematic content and a base noting information current as of 1963. The Naknek guide is printed February 2013, has a 2011 third-party copyright notice, and warns that many labels are local. Later PDF metadata or retrieval dates are not asserted as source currency.

The full shapes and their surrounding lakes were compared visually. No registered raster overlay, datum-transformed shoreline fit, measured intersection score, current legal name boundary, formal naming instrument, or present registry status was established. Island and shoreline detail omitted by the generalized one-ring source polygons remains a limitation. The USGS Iliuk point is supporting local usage, not full-footprint proof.

The review pins 25 frozen public geometry/research files and 44 retained local assets. Original PDFs, HTML, full extracted text, map images and derivatives are not distributed. Public review files contain only original factual observations and bounded provenance. Selected public-domain source geometries remain in the enclosing geometry package under its documented rights basis.

## Offline replay

From this directory:

    python validate-independent-review.py
    python test-independent-review.py

Durable-only mode checks complete included source/rendered geometry, exact frozen public bytes, research-to-shape joins, naming gates, source dates, map-versus-text inspection roles and prior exclusion metadata. It does not reopen omitted original publications, inventory files or binary inputs.

Full-local mode uses retained inputs without fetching anything:

    python validate-independent-review.py --input-cache INPUT_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT
    python test-independent-review.py --local-source-index LOCAL_INDEX_JSON --local-source-root LOCAL_EVIDENCE_ROOT

The source index is an array of `{ "id": "PIN_ID", "local_file": "relative/file" }` entries beneath the supplied local root. IDs match frozen local pins. Paths must be relative, without parent traversal. The input cache supplies the immutable assets listed in `geometry-reference.json`; the recovered repository supplies its recorded inventory files; the prior index supplies the pinned r05 bytes. Python 3 is required; production-decoder replay also uses Node.js.

`review-validation.json` records durable-only and full-local replay plus 24 durable corruption fixtures and one additional full-local altered-original-byte fixture. Tests reject unsupported naming, erased subbasin qualification, false registry/restoration claims, wrong IDs/order/counts, changed interior coordinates or ring order, mismatched source hashes, wrong whole-shape evidence, confused source dates and introduced prior duplicates. Temporary fixtures do not modify originals. Hash replay does not repeat visual inspection.

The manifest pins seven review files and excludes itself. No network request, live-deployment check, formal registry check, geometry repair, or naming application occurred in this review.
