# Independent r07 river review

Fixed-order fresh actual-inventory targets against immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `hydro-system:50668155`: **Murchison River**, supported representative-system identity. The eastern initial branch and precise transitions with joining rivers remain unresolved; Hope, Roderick and Sandford are distinct names.
- `hydro-system:50611851`: **Gascoyne River**, supported representative-system identity. The whole westward corridor and Carnarvon approach agree, while eastern headwater names remain unresolved. Lyons is distinct.
- `hydro-system:50552041`: **Ashburton River**, supported representative-system identity. The regional southeast-to-northwest corridor and lower northward route agree. Named tributaries, far-upstream transitions and the rendered coastal connector do not receive automatic names.

Every finding uses `supported_representative_system_identity` with explicit reach-name limits. Korean and scalar product fields are null. Whole-group scalar application, per-reach application, automatic application and formal registry verification are false. No product or geometry modification occurred.

## Evidence and limits

All three complete baseline fragments were compared with retained official maps and prose. Five original naming-source bodies were independently read or viewed and rehashed with acquisition receipts. The two BoM figures belong to one publication: the assessment year is 2012 and copyright year 2013. The lower Gascoyne factsheet is dated February 2015. The Ashburton survey is the June 1988 revised edition; HG34 is dated March 2009 internally, with February 2009 on the exterior cover. Upload-folder and retrieval dates do not update their content.

The BoM maps are low-resolution regional rasters. The Lower Gascoyne aquifer management map is local and does not mark river-name boundaries. The Ashburton regional survey supplies the broader route context that its lower-river study alone cannot establish. The monitoring-report request returned generic HTML and is excluded from naming evidence. No new external requests were made during independent review.

Independent Python binary decoding and production-decoder replay cover 747 ordered line parts and 3,681 coordinate positions: 314/1,406, 252/1,246 and 181/1,029. Metadata, source-ID order, each part digest, internal joins, complete feature hashes and whole-fragment endpoints are checked. Original continental HydroRIVERS reach coordinates remain unavailable. Equal source-ID and rendered-part counts do not establish the original reach-coordinate mapping. Source and rendered terminal metadata differ for all three rivers; neither is a surveyed present-day mouth.

The previous index contains 18 distinct targets, none overlapping this batch. Independent initial-inventory checks establish all 21 as distinct initially eligible targets: 7 river groups and 14 lakes. Of 4,065 initially eligible targets, 4,044 remain absent from the fresh index: 3,448 river groups and 596 lakes. This does not reconstruct the unavailable historical 504-record ledger or assert which targets were historically never reviewed. The cumulative index and queue helper are outside this frozen review input set.

Full river coordinates, GeoJSON, packs, original PDFs/HTML, extracted texts, maps and derivatives are not distributed. Public files contain original observations, identifiers, counts, limited whole-fragment facts, hashes and validators. No per-part endpoint array is published. This review pins 24 public inputs and 22 retained local assets.

## Offline replay

From this review directory:

    python -B validate-independent-review.py
    python -B test-independent-review.py

Durable-only mode checks public facts, exact frozen input bytes, provenance joins, dates, metadata, scope and naming gates. It cannot independently recheck omitted complete river coordinates or source bodies. Recorded full-local results describe the completed review, not work repeated in durable-only mode.

Complete local replay, using retained inputs without network requests:

    python -B validate-independent-review.py --input-cache BASELINE_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT
    python -B test-independent-review.py --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT

The local source index is an array of `{ "id": "PIN_ID", "local_file": "relative/file" }` entries beneath the supplied root. IDs match frozen local assets; absolute paths and parent traversal are rejected. The immutable cache supplies the named source assets; the recovered repository supplies the pinned initial inventory and summary. Python 3 and Node.js are needed for full replay. Partial options are labeled partial-local. Rehashing a map does not repeat human-readable visual inspection.

Nineteen durable corruption fixtures and five additional full-local fixtures test unsupported application, Korean/registry/history claims, identifier/order/count mismatches, erased tributary distinctions, incorrect source dates or hashes, a generic redirect promoted to evidence, and optional altered full geometry/source bytes. Originals are never changed. The manifest pins seven review files and excludes itself.
