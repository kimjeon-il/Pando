# River-name reconstruction r08

Three new actual-inventory river-group investigations against immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. The live deployment was not checked.

## Reviewed identities

- **50538951: Fortescue River.** The complete southeastern-interior path turns northwest along the Fortescue valley and north into the coastal plain southwest of Karratha. Regional DBCA and BoM maps plus Millstream and lower-river cartography support Fortescue River as its representative identity. Upper river, Marsh and lower river are hydrologically distinct; the easternmost headwater, marsh crossing and coastal connector have no established individual name assignments. Category: `supported_representative_system_identity`.
- **50631583: Wooramel River.** The complete long westward route south of the Gascoyne system, including its coastward south bend, agrees with the Wooramel-labelled regional river course. The separate WA resource inventory corroborates this regional location and official usage. The eastern initial channel and exact interior joining-channel or headwater transitions remain unverified. Category: `supported_representative_system_identity`.
- **50691033: Greenough River.** The complete inland-to-southwest route and its final west/northwest coastal turn agree with the Greenough course on regional maps and DWER prose linking plateau headwaters, Waterloo Range and Cape Burney. This supports representative mainstem identity, while exact headwater and joining-channel name boundaries remain unresolved. Category: `supported_representative_system_identity`.

Fortescue has an additional hydrologic limit: the [DBCA 2025 management plan](https://www.dbca.wa.gov.au/media/6162/download), PDF page 25 / printed page 17, separates the upper river and Marsh from the lower river at Goodiadarrie Hills. Onward discharge is expected only in extreme floods. A continuous baseline line is not evidence of ordinary continuous flow through the Marsh.


A representative system or mainstem association does not give the same name to every source reach, tributary, connector or upper branch. All whole-group scalar fields and Korean research names are null, and every reach-name/automatic/product-application gate remains false. Ordinary official usage is distinguished from a formal naming instrument.

## Geometry and source scope

All three complete retained fragments were decoded and inspected locally: 209, 79 and 88 ordered parts, with 1,038, 483 and 522 positions respectively. All 376 ordered source reach IDs and 2,043 rendered positions are accounted for. Fragment role `mainstem` is baseline metadata, not proof that every part has the representative name. Source-record and rendered sea endpoints differ and are documented without repair. Original continental HydroRIVERS reach coordinates were not obtained, and their equality is not claimed.

Public geometry evidence contains identifiers, ordered-part counts and coordinate digests, together with a few whole-fragment bounds/endpoint facts. Complete coordinate arrays and per-part endpoint reconstruction are omitted. Full-local validation can reproduce the retained baseline decoder/coordinate checks from separate verified inputs; durable package-only validation cannot rehash omitted path coordinates or original source bodies.

Source artifacts identify the official publications actually used, map pages and scale/date limits, acquired body hashes and bounded naming observations. Regional maps support representative-course association only where shown; named neighboring rivers or tributaries are not converted to aliases. Unavailable or non-document responses do not supply naming evidence. Raw source PDFs/HTML, maps and crops are excluded.

## Recoverable cumulative queue

The preceding 21 logical targets are fixed through `fef2fb3fc52a276fb0059ce66474116de08137d1`. This batch adds three distinct river groups, for 24 reconstructed targets: 14 lake features and ten river groups. The index contains all 24 IDs and evidence locators, and pins the original committed inventory by path, commit, compressed-byte SHA-256 and Git blob SHA.

Run `python recover-remaining-queue.py --inventory INVENTORY.csv.gz --include-ids` with that exact initial inventory to rebuild the remainder offline. The output uses original inventory row order. There are 4,041 eligible targets absent from this fresh reconstructed index: 3,445 river groups and 596 lakes. This is not the historical never-reviewed count; unavailable past research is not silently restored or added.

Run `python validate-package.py` for included-file hashes, target/count/review linkage, rights checks and durable validation. The recovery script separately rechecks initial inventory bytes when supplied. Neither validator acquires external data.
