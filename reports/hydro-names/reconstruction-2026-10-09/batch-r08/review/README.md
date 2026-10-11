# Independent r08 river review

Fixed-order fresh actual-inventory targets against immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `hydro-system:50538951`: **Fortescue River**, supported representative-system identity. The upper river, Fortescue Marsh and lower river are hydrologically distinct across Goodiadarrie Hills; onward drainage from the Marsh is expected only in extreme floods. The easternmost headwater, marsh crossing and coastal connector remain unassigned.
- `hydro-system:50631583`: **Wooramel River**, supported representative-system identity. The complete westward corridor and southward coastal turn agree with regional course maps. Eastern headwater and joining-channel name transitions remain unresolved.
- `hydro-system:50691033`: **Greenough River**, supported representative-system identity. The complete southwest route and coastal turn agree with regional mapping and the official plateau-to-Cape Burney description. Exact upper-channel and joining-channel names remain unresolved.

Every finding uses `supported_representative_system_identity` with explicit reach-name limits. Korean and scalar product fields are null. Whole-group scalar application, per-reach application, automatic application and formal registry verification are false. No product or geometry modification occurred. The representative candidate names contain no invented system suffix.

## Evidence and limits

All three complete baseline fragments were compared with retained official maps and prose. Five unique original naming publications were independently read or viewed and rehashed with their original acquisition receipts. The BoM assessment appears under two research aliases, but is counted once. Its assessment year is 2012 and copyright year 2013. The two regional figures are one publication. HG34 is dated March 2009 internally, with February 2009 on the exterior cover. The DBCA management plan is September 2025; the WA inventory is 2014; the Greenough page has no established publication date. Upload folders and retrieval dates do not update these sources.

The previously acquired BoM and HG34 bytes were reused without redownloading; their original acquisition timestamps remain unchanged. The new target interpretations come from independent full-path and source inspection. No external requests were made during this review.

The BoM maps are low-resolution regional rasters. WA inventory labels and shaded management areas do not name every stream within them. DWER's Greenough prose supports its regional route, not every source reach. HG34's Millstream and lower Fortescue maps have local aquifer scopes. The DBCA plan independently identifies the Goodiadarrie Hills divide, upper–Marsh–lower distinction and separately named Weeli Wolli, Coondiner and Mindi Mindi creeks. A continuous rendered Fortescue path does not establish ordinary through-flow, a uniformly named channel or exact marsh geometry. Its qualified representative identity remains supported.

Independent Python binary decoding and production-decoder replay cover 376 ordered line parts and 2,043 coordinate positions: 209/1,038, 79/483 and 88/522. Metadata, source-ID order, each part digest, internal joins, complete feature hashes and whole-fragment endpoints are checked. Original continental HydroRIVERS reach coordinates remain unavailable. Equal source-ID and rendered-part counts do not establish the original reach-coordinate mapping. Source and rendered terminal metadata differ for all three rivers; neither is a surveyed present-day mouth.

The previous index contains 21 distinct targets, none overlapping this batch. Independent initial-inventory checks establish all 24 as distinct initially eligible targets: 10 river groups and 14 lakes. Of 4,065 initially eligible targets, 4,041 remain absent from the fresh index: 3,445 river groups and 596 lakes. This does not reconstruct the unavailable historical 504-record ledger or assert which targets were historically never reviewed. The cumulative index outside this frozen review input set is checked only through its previous-index membership and three-target increment.

Full river coordinates, GeoJSON, packs, original PDFs/HTML, extracted texts, maps and derivatives are not distributed. Public files contain original observations, source URLs, identifiers, counts, limited whole-fragment facts, hashes and validators. No per-part endpoint array is published. This review pins 22 public inputs and 25 retained local assets.

## Offline replay

From this review directory:

    python -B validate-independent-review.py
    python -B test-independent-review.py

Durable-only mode checks public facts, exact frozen input bytes, provenance joins, original acquisition/publication dates, metadata, scope and naming gates. It cannot independently recheck omitted complete river coordinates or original sources. Recorded full-local results describe the completed review, not work repeated in durable-only mode.

Complete local replay, using retained inputs without network requests:

    python -B validate-independent-review.py --input-cache BASELINE_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT
    python -B test-independent-review.py --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT

The local source index is an array of `{ "id": "PIN_ID", "local_file": "relative/file" }` entries beneath the supplied root. IDs match frozen local assets; absolute paths and parent traversal are rejected. The immutable cache supplies source assets; the recovered repository supplies the pinned initial inventory and summary. Python 3 and Node.js are needed for full replay. Partial options are labeled partial-local. Rehashing a map does not repeat human-readable visual inspection.

Twenty-two durable corruption fixtures and five additional full-local fixtures test unsupported application, Korean/registry/history claims, identifier/order/count mismatches, erased inflow distinctions, unsupported continuous flow, an erased Fortescue divide, incorrect source dates or hashes, overwritten original acquisition times, false cache reacquisition, and optional altered full geometry/source bytes. Originals are never changed. The manifest pins seven review files and excludes itself.
