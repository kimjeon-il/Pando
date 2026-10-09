# Independent r09 river review

Three fixed-order actual-inventory targets against immutable baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`:

- `hydro-system:50737565`: **Moore River**, supported representative identity. Marchagee, Coonderoo, Moore River North, Moore River East Branch and Gingin Brook retain distinct source names. The full northern loop, southward route and coastal turn were inspected; exact upstream name boundaries remain unresolved.
- `hydro-system:50756799`: **Murray River**, supported representative identity in **Western Australia**. The full inland route is regionally consistent with Hotham-to-Murray, continuing toward Peel Inlet and the Mandurah estuary corridor. Hotham and Williams remain separate names. Both fragments retain their actual `mainstem` metadata; the short second fragment is not reclassified. Its precise channel name and river/estuary boundaries are unverified. This is not a Murray-Darling finding.
- `hydro-system:50782475`: **Gordon-Frankland River**, directly supported source wording for the combined main channel. The distinctive middle bend matches Gordon mapping; Gordon River, downstream Frankland River and Nornalup Inlet remain distinct. The northern extension, transition north of Muir Highway and inlet connectors have no verified part-level name assignments.

Every finding uses `supported_representative_system_identity` with reach-name limits. No invented system suffix is added. Korean and scalar product fields are null; whole-group scalar, per-reach and automatic application are false. Formal name registry, current deployment and original continental HydroRIVERS coordinate equality remain unverified. No product or geometry modification occurred.

## Source and complete-path review

Seven unique original naming publications were independently read or viewed and rehashed with original acquisition receipts: one reused BoM assessment, SLUI38, three Moore/Murray/Peel-Harvey web pages, WRM44 and the DBCA marine-park page. Two BoM aliases and two figures are one publication. Assessment year 2012 and copyright year 2013 are separate. SLUI38 is January 2005; WRM44 is September 2004. The Peel-Harvey landing page was published 1 August 2021 and updated 9 June 2023. The other web pages have no established original publication date. Hosting-folder, scanning and retrieval dates do not update publication dates. The Peel-Harvey linked technical report was not acquired or inspected. Interactive maps were not inspected. No external request was made by this review.

All four complete baseline fragments were plotted independently and compared with retained regional, catchment, course and estuary evidence. Independent Python binary decoding and production-decoder replay cover **240 ordered parts and 1,396 coordinate positions**: 103/561,70/418,1/5 and66/412. Group totals are 103/561,71/423 and66/412. Exact metadata, every ordered part digest, source-ID order, whole feature/group hashes, internal part joins and the Murray fragment join are checked. FID 7072 has no terminal field; 7039,7073 and 7099 have sea-terminal metadata. Their source and rendered endpoints differ. Such metadata does not identify a surveyed present-day named river mouth.

Regional alignment supports representative identity; it does not name every part or establish a registered overlay, continuous flow, exact headwater transitions or geometry repair. Equal reach-ID and rendered-part counts do not prove original reach-coordinate correspondence. River and basin labels are distinguished. Estuary/inlet connectors do not automatically inherit river names.

## Membership and publication scope

The fixed previous index contains 24 distinct targets, none overlapping these three. Independent initial-inventory checks establish all 27 as unique initially eligible targets: 13 river groups and 14 lakes. Of 4,065 initially eligible targets, 4,038 remain absent from the fresh index: 3,442 river groups and 596 lakes. This does not restore the unavailable historical 504-record ledger or imply which targets were historically never reviewed. The cumulative index and assembly/queue outputs remain outside the frozen review input set.

Twenty-two public inputs and 34 retained local assets are pinned. Published material contains original compact observations, URLs, IDs, counts, hashes and validators. Full coordinates, GeoJSON, binary packs, original PDF/HTML bodies, extracted text, maps and derivatives are withheld. No per-part endpoint array is published. Private local evidence mappings are not distributed.

## Offline replay

From this review directory:

    python -B validate-independent-review.py
    python -B test-independent-review.py

Durable-only mode checks exact frozen public bytes, naming/application gates, provenance joins and dates. It cannot rehash omitted coordinates or original source bodies. Recorded full-local checks describe completed review work, not checks repeated in durable-only mode.

Full replay with retained inputs, without network requests:

    python -B validate-independent-review.py --input-cache BASELINE_CACHE --historical-input-root RECOVERED_REPOSITORY --prior-index PREVIOUS_INDEX --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT
    python -B test-independent-review.py --local-geometry RETAINED_GEOJSON --local-source-index LOCAL_INDEX --local-source-root LOCAL_ROOT

The private source index maps pin IDs to relative retained filenames. Absolute paths and parent traversal are rejected. Partial option sets are labeled partial-local. Python 3 and Node.js are needed for full replay. Image hashing does not repeat human visual inspection. Twenty-seven durable corruption tests and seven additional full-local tests cover roles, missing fragments, unsupported name/flow/registry/application claims, boundaries, dates, source hashes, reuse and optional full local bytes. Originals remain unchanged. The manifest pins seven review files and excludes itself.
