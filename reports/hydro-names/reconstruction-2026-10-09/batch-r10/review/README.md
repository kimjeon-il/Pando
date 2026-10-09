# Independent r10 river review

Three fixed-order actual-inventory targets against immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `hydro-system:50766256`: **Collie River**, supported representative identity. The complete westward course agrees regionally with the Collie town, Wellington Reservoir and Leschenault corridor. Collie River East is a provisional association for the eastern continuation; its first channel and branch transition remain unresolved. Collie River South Branch, Brunswick, Harris and Bingham retain distinct names. Reservoir and estuary boundaries are not assigned to parts.
- `hydro-system:50779535`: **Warren River**, supported representative identity. The complete inland-to-coastal path agrees with the Tone-to-Warren corridor. Official wording places the Warren below the Tone-Perup confluence east of Manjimup. Perup, Wilgarup, Lefroy and Dombakup retain separate names. The selected-part confluence, name boundary and precise coastal mouth remain unverified.
- `hydro-system:50782443`: **Kalgan River**, supported representative identity. The complete western inland extension, eastward bend and southward lower route agree at catchment scale with the Kalgan drainage toward Stevens Farm and Oyster Harbour. The western starting channel remains unnamed by inspected maps. The lower tidal river, harbour and terminal continuation remain distinct, with no exact part-level transition.

Every finding uses `supported_representative_system_identity` with reach-name limits. No invented system suffix is added. Korean and scalar product fields are null; whole-group scalar, per-reach and automatic application are false. Formal naming register, current deployment and original continental HydroRIVERS coordinate equality remain unverified. No product or geometry modification occurred.

## Source and complete-path review

Six distinct supporting publications and one supplemental original page were independently inspected and rehashed with acquisition receipts: reused BoM assessment and SLUI38, Collie and Warren basin pages, Kalgan nutrient report and Oyster Harbour river-health article, plus the supplemental Warren site-list page. Shared BoM aliases and two figures count once. Supplemental monitoring-site listings are not counted as additional independent support. Distinct documents and shared departmental publishers do not imply independent surveys.

BoM assessment year 2012 and copyright year 2013 are separate. SLUI38 is January 2005. The Kalgan report covers 2019 data and is Issue 2, published August 2023. Web-page footer years are not original publication dates. Hosting, extraction and retrieval dates do not update publication dates. Interactive and embedded web maps were not inspected. No external request was made by this review.

All three complete baseline fragments were independently plotted and compared with retained regional, catchment and course evidence. Independent Python binary decoding and production-decoder replay cover **120 ordered parts and 705 coordinate positions**: Collie 36/218, Warren 53/306 and Kalgan 31/181. Exact metadata, every ordered part digest, source-ID order, whole feature/group hashes and internal joins are checked. All three fragments retain stage 3, mainstem role and sea-terminal metadata. Their source and rendered endpoints differ; those facts do not identify surveyed present-day river mouths.

Regional alignment supports representative identity; it does not name every part or establish a registered overlay, continuous flow, exact headwater transitions or geometry repair. Equal reach-ID and rendered-part counts do not prove original reach-coordinate correspondence. Basin labels, tributaries, reservoir passages and receiving estuaries remain distinct. The Kalgan report's flow label and approximate tidal length are not extended to all selected geometry.

## Membership and publication scope

The pinned previous index contains 27 distinct targets, none overlapping these three. Current initial-inventory rows independently establish three unique eligible river groups. Appending only this delta gives 30 distinct targets: 16 river groups and 14 lakes. Of 4,065 initially eligible targets, 4,035 remain absent from the fresh index: 3,439 river groups and 596 lakes. This does not restore the unavailable historical 504-record ledger or imply which targets were historically never reviewed. Prior source and geometry findings were not re-audited. The cumulative index and assembly/queue outputs remain outside the frozen review input set.

Twenty-two public inputs and 31 retained local assets are pinned. Published material contains compact original observations, URLs, IDs, counts, hashes and validators. Full coordinates, GeoJSON, binary packs, original PDF/HTML bodies, extracted text, maps and derivatives are withheld. No per-part endpoint array is published. Private retained-evidence mappings are not distributed.

## Offline replay

From this review directory:

    python -B validate-independent-review.py
    python -B test-independent-review.py

Durable-only mode checks exact frozen public bytes, naming/application gates, provenance joins and dates. It cannot rehash omitted coordinates or original source bodies. Recorded full-local checks describe completed review work, not checks repeated in durable-only mode.

Full replay with retained inputs, without network requests:

    python -B validate-independent-review.py --input-cache BASELINE_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT
    python -B test-independent-review.py --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT

The private source index maps pin IDs to relative retained filenames. Absolute paths and parent traversal are rejected. Partial option sets are labeled partial-local. Python 3 and Node.js are needed for full replay. Image hashing does not repeat human visual inspection. Thirty-five durable corruption tests and seven additional full-local tests cover roles, missing fragments, unsupported branch/flow/registry/application claims, boundaries, dates, body hashes, reuse and supplemental-page counting. Originals remain unchanged. The manifest pins seven review files and excludes itself.
