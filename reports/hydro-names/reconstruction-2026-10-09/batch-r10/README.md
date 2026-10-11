# River-name reconstruction r10

Three new actual-inventory river-group investigations against immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. The live deployment was not checked.

## Reviewed identities

- **50766256: Collie River.** The complete east-to-west path, eastern southern arc and central bends agree regionally with the Collie drainage through the Collie town and Wellington Reservoir corridor toward Leschenault. Collie River is supported as representative identity. Collie River East is only a provisional regional association for the eastern continuation; the initial channel, branch transition, reservoir passage and estuary connector are not individually named. Category: `supported_representative_system_identity`.
- **50779535: Warren River.** The complete northeastern inland path bends south and then west through the lower valley toward the coast southwest of Pemberton, consistent with the Tone-to-Warren drainage. Warren River is supported as representative identity. The source distinguishes upstream Tone and the Tone-Perup confluence from downstream Warren; no selected part or exact transition is assigned. Category: `supported_representative_system_identity`.
- **50782443: Kalgan River.** The complete western inland extension, eastward course and southward then southwestward bend agree at catchment scale with the Kalgan drainage toward Stevens Farm and Oyster Harbour. Kalgan River is supported as representative identity. Exact western headwater names remain unresolved; the tidal lower river, receiving harbour and terminal continuation do not receive one blanket name. Category: `supported_representative_system_identity`.

A representative system or mainstem association does not give the same name to every source reach, tributary, connector or upper branch. All whole-group scalar fields and Korean research names are null, and every reach-name/automatic/product-application gate remains false. Ordinary official usage is distinguished from a formal naming instrument.

## Geometry and source scope

All three complete retained fragments were decoded and inspected locally. The three logical targets contain 36, 53 and 31 ordered parts, with 218, 306 and 181 positions respectively. All 120 ordered source reach IDs and 705 rendered positions are accounted for. Fragment role `mainstem` is baseline metadata, not proof that every part has the representative name. Endpoint facts are documented without repair or a surveyed-mouth claim. All three fragments have sea terminal metadata. A metadata role of mainstem does not turn an estuarine continuation into a uniformly named river channel. Original continental HydroRIVERS reach coordinates were not obtained, and their equality is not claimed.

Public geometry evidence contains identifiers, ordered-part counts and coordinate digests, together with a few whole-fragment bounds/endpoint facts. Complete coordinate arrays and per-part endpoint reconstruction are omitted. Full-local validation can reproduce the retained baseline decoder/coordinate checks from separate verified inputs; durable package-only validation cannot rehash omitted path coordinates or original source bodies.

Source artifacts identify the official publications actually used, map pages and scale/date limits, acquired body hashes and bounded naming observations. Regional maps support representative-course association only where shown; named neighboring rivers or tributaries are not converted to aliases. Unavailable or non-document responses do not supply naming evidence. Raw source PDFs/HTML, maps and crops are excluded.

## Recoverable cumulative queue

The preceding 27 logical targets are fixed through `ea66825657b0f7ff8e41616e375bf974cd4dbff1`. This batch adds three distinct river groups, for 30 reconstructed targets: 14 lake features and sixteen river groups. The index contains all 30 IDs and evidence locators, and pins the original committed inventory by path, commit, compressed-byte SHA-256 and Git blob SHA.

Run `python recover-remaining-queue.py --inventory INVENTORY.csv.gz --include-ids` with that exact initial inventory to rebuild the remainder offline. The output uses original inventory row order. There are 4,035 eligible targets absent from this fresh reconstructed index: 3,439 river groups and 596 lakes. This is not the historical never-reviewed count; unavailable past research is not silently restored or added.

Run `python validate-package.py` for included-file hashes, target/count/review linkage, rights checks and durable validation. The recovery script separately rechecks initial inventory bytes when supplied. Neither validator acquires external data.
