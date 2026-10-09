# River-name reconstruction r07

Three new actual-inventory river-group investigations against immutable Pando baseline `fd6744f5e72a0c1a107452dbde6d416ab57237db`. The live deployment was not checked.

## Reviewed identities

- **50668155: Murchison River.** The selected generalized route has the lower southwest Murchison corridor and coastal setting at Kalbarri. Its full shape is consistent with the regional system. The eastern initial branch, its southward turn and subsequent northern arc are not established as Murchison-named throughout; exact transitions with joining rivers remain unresolved. Category: `supported_representative_system_identity`.
- **50611851: Gascoyne River.** The long westward route, marked northward middle bend and Carnarvon coastal approach agree with the mapped Gascoyne corridor. Lyons remains a separately mapped river. Exact names and transitions along the selected eastern headwater branch remain unverified. Category: `supported_representative_system_identity`.
- **50552041: Ashburton River.** The full eastern-interior route bends south then west, crosses the northwest-trending Ashburton valley, and turns north across the coastal plain toward Onslow. The 1988 whole-corridor maps and 2009 lower-river map support this representative identity; far-upstream name boundaries and the rendered coastal connector remain unestablished. Category: `supported_representative_system_identity`.

A representative system or mainstem association does not give the same name to every source reach, tributary, connector or upper branch. All whole-group scalar fields and Korean research names are null, and every reach-name/automatic/product-application gate remains false. Ordinary official usage is distinguished from a formal naming instrument.

## Geometry and source scope

All three complete retained fragments were decoded and inspected locally: 314, 252 and 181 ordered parts, with 1,406, 1,246 and 1,029 positions respectively. All 747 ordered source reach IDs and 3,681 rendered positions are accounted for. Fragment role `mainstem` is baseline metadata, not proof that every part has the representative name. Source-record and rendered sea endpoints differ and are documented without repair. Original continental HydroRIVERS reach coordinates were not obtained, and their equality is not claimed.

Public geometry evidence contains identifiers, ordered-part counts and coordinate digests, together with a few whole-fragment bounds/endpoint facts. Complete coordinate arrays and per-part endpoint reconstruction are omitted. Full-local validation can reproduce the retained baseline decoder/coordinate checks from separate verified inputs; durable package-only validation cannot rehash omitted path coordinates or original source bodies.

Source artifacts identify the official publications actually used, map pages and scale/date limits, acquired body hashes and bounded naming observations. Regional maps support representative-course association only where shown; named neighboring rivers or tributaries are not converted to aliases. Unavailable or non-document responses do not supply naming evidence. Raw source PDFs/HTML, maps and crops are excluded.

## Recoverable cumulative queue

The preceding 18 logical targets are fixed through `9727db6a8f55a61dffed63109df5596f901f5af6`. This batch adds three distinct river groups, for 21 reconstructed targets: 14 lake features and seven river groups. The index contains all 21 IDs and evidence locators, and pins the original committed inventory by path, commit, compressed-byte SHA-256 and Git blob SHA.

Run `python recover-remaining-queue.py --inventory INVENTORY.csv.gz --include-ids` with that exact initial inventory to rebuild the remainder offline. The output uses original inventory row order. There are 4,044 eligible targets absent from this fresh reconstructed index: 3,448 river groups and 596 lakes. This is not the historical never-reviewed count; unavailable past research is not silently restored or added.

Run `python validate-package.py` for included-file hashes, target/count/review linkage, rights checks and durable validation. The recovery script separately rechecks initial inventory bytes when supplied. Neither validator acquires external data.
