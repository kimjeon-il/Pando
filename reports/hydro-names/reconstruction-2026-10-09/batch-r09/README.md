# River-name reconstruction r09

Three new actual-inventory river-group investigations against immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. The live deployment was not checked.

## Reviewed identities

- **50737565: Moore River.** The complete northern inland loop and long southward route turn west and southwest to Guilderton, agreeing with official Moore regional mapping and course descriptions. Moore River is a representative system identity only. Marchagee, Coonderoo, Moore River North and East Branch retain distinct names; the northern extension and exact branch transitions are unresolved. Category: `supported_representative_system_identity`.
- **50756799: Murray River.** The complete Western Australian route agrees regionally with the Hotham-to-Murray corridor through the Darling Range toward Pinjarra and Peel Inlet. Both joined baseline mainstem fragments are reviewed, including the short northward terminal continuation. Murray River is a representative identity; Hotham, Williams, estuary and ocean-connector naming remain separate and no exact name boundary is assigned. Category: `supported_representative_system_identity`.
- **50782475: Gordon-Frankland River.** The complete inland-to-southwest route and distinctive middle westward bend agree with Gordon mapping and the downstream Frankland corridor. Gordon-Frankland River is the source wording for the combined main channel and supports representative combined-system identity. Gordon River, Frankland River and Nornalup Inlet remain distinct; the northern starting extension and exact named transitions are unresolved. Category: `supported_representative_system_identity`.

The western Murray target includes a short stage-2 estuarine-to-ocean continuation; the river name is not approved for that continuation. Official sources also distinguish its Hotham/Williams headwaters. WRM44 uses Gordon-Frankland River for the combined main channel, while distinguishing Gordon upstream, Frankland downstream and the receiving Nornalup Inlet. These source distinctions remain explicit rather than being replaced by the initial name hints.


A representative system or mainstem association does not give the same name to every source reach, tributary, connector or upper branch. All whole-group scalar fields and Korean research names are null, and every reach-name/automatic/product-application gate remains false. Ordinary official usage is distinguished from a formal naming instrument.

## Geometry and source scope

All four complete retained fragments were decoded and inspected locally. The three logical targets contain 103, 71 and 66 ordered parts, with 561, 423 and 412 positions respectively. The middle target has two fragments with 70 and 1 parts, containing 418 and 5 positions. All 240 ordered source reach IDs and 1,396 rendered positions are accounted for. Fragment role `mainstem` is baseline metadata, not proof that every part has the representative name. Endpoint facts are documented without repair or a surveyed-mouth claim. FID7072 has no terminal metadata; the other three fragments have sea terminals. A metadata role of mainstem does not turn an estuarine continuation into a uniformly named river channel. Original continental HydroRIVERS reach coordinates were not obtained, and their equality is not claimed.

Public geometry evidence contains identifiers, ordered-part counts and coordinate digests, together with a few whole-fragment bounds/endpoint facts. Complete coordinate arrays and per-part endpoint reconstruction are omitted. Full-local validation can reproduce the retained baseline decoder/coordinate checks from separate verified inputs; durable package-only validation cannot rehash omitted path coordinates or original source bodies.

Source artifacts identify the official publications actually used, map pages and scale/date limits, acquired body hashes and bounded naming observations. Regional maps support representative-course association only where shown; named neighboring rivers or tributaries are not converted to aliases. Unavailable or non-document responses do not supply naming evidence. Raw source PDFs/HTML, maps and crops are excluded.

## Recoverable cumulative queue

The preceding 24 logical targets are fixed through `d6a86e96d5ec746d9497ecafa7b597244e195e4b`. This batch adds three distinct river groups, for 27 reconstructed targets: 14 lake features and thirteen river groups. The index contains all 27 IDs and evidence locators, and pins the original committed inventory by path, commit, compressed-byte SHA-256 and Git blob SHA.

Run `python recover-remaining-queue.py --inventory INVENTORY.csv.gz --include-ids` with that exact initial inventory to rebuild the remainder offline. The output uses original inventory row order. There are 4,038 eligible targets absent from this fresh reconstructed index: 3,442 river groups and 596 lakes. This is not the historical never-reviewed count; unavailable past research is not silently restored or added.

Run `python validate-package.py` for included-file hashes, target/count/review linkage, rights checks and durable validation. The recovery script separately rechecks initial inventory bytes when supplied. Neither validator acquires external data.
