# Continue diverse real-map training

User: maximize real map-condition diversity and continue actual training.

1. Reuse work/ui, its trained v1 checkpoint and the existing Semap source pool.
   Extend the canonical importer to recognize licensed compound institution IDs,
   inspect author train labels before images, discard uninformative candidates,
   and select distinct originals across all verified unrestricted/attribution
   institutions. Cap the first continuation at 96 actual originals to bound GPU
   and storage use. This is a concrete continuation, not an endless unattended job.
2. Reuse original bytes and immutable labels already acquired. Add an expanded
   manifest beside the old one; no full archive or duplicate source corpus.
   Tighten validation by recomputing Semap class conversion from its original
   author label and verifying rights/author split. Producer code hash records
   provenance; changing selection code must not invalidate unchanged semantics.
3. Balance source items and corpora during mixed fine-tuning, preserve genuine
   boundary supervision, expose a lower fine-tuning learning rate, and record
   exact sampling, attempted batches, successful updates and overflow skips.
4. Actually train, export pending ONNX, inspect diverse real-source predictions,
   compare fixed training diagnostics, run actual local ORT WASM parity, then
   archive sources/weights/evidence and pin the external data. Focused tests only.

Ruling: existing approved scope and 'continue' authorize this bounded expansion
without another design questionnaire. Semap supervises only hydro/transport;
additional map images cannot manufacture missing national-boundary/coast truth.
Unknown historical dates, languages and production families stay unknown. No
claim of independent evaluation, all-script coverage or release approval follows
from more training, lower training loss or sample-institution counts.

Ruling: preserve current-schema producer hashes as immutable provenance, validate
the actual source-label conversion rather than require a hash of the latest
selection script. This strengthens supervision checks without legacy aliases.

Final review: fixed premature first-tile deduplication. Candidate filtering now
retains alternate author-train tiles; an original is counted once only after an
informative tile is accepted. Regression observed RED then GREEN, plus an
end-to-end empty-first/informative-second fixture; corpus/source suite 32/32.

Final: Ruling: regraded conditional corpus quota balance from Minor to Important
because equal corpus contribution is an explicit sampling guarantee for valid
inputs. A common quota covers the largest original count in either corpus;
1-versus-99-source regression observed 50:99 RED, equal quotas GREEN. Model suite
7/7. This does not change the planned quota for the actual current corpora.

Observed HTTP ranges advertised 320811/366254 bytes but a single read delivered
309520/362964 bytes. Strict length guards rejected them. Added bounded range
retries, transfers no larger than 128KiB, and complete reads until EOF or the
expected-size guard. Truncated bodies are never passed into ZIP processing.
Source reuse now checks remote member CRC/size. Focused short-read, alternate
range, corruption and partial-read regressions were observed RED then GREEN.

Final: Ruling: publication rights remain grounded in the authors' pinned
institution table, not a new independent legal opinion; pending models remain
unapproved. Acquisition establishes member identity and validation recomputes
labels; coordinated replacement of all sources and their recorded identities is
not claimed to be detected. Cost if wrong: compromised provenance or distribution
terms would require a new review before model publication.

Acquisition finished with 82 informative originals from 9 institutions, 318
supervised auxiliary tiles; no duplicate original groups. 468 total tiles with
the 5 USGS sheets, 234 sampled tiles per corpus per epoch. All 82 raster images
have non-neutral scan chroma; visually many are single-ink/sepia engravings. Do
not claim independently tested pure-grayscale input or non-Latin script coverage.
Actual GPU continuation started with 6 epochs, batch1, LR3e-5, encoder unfrozen,
source-balanced coverage. First epoch: 468 batches, 463 updates, 5 AMP skips,
training loss2.387675567. Logs and final weights stay in models/diverse-v2.

Ruling: Semap road-network labels include streets, squares, walkways and bridges
per its source ontology. Their area masks differ from thin USGS road strokes;
record the auxiliary semantic scope and do not treat improved fitting as proof
of international-boundary quality or release criteria.

Execution finished: 6 epochs / 2808 attempted batches / 2801 successful updates /
7 AMP skips, selected epoch5 training loss1.571620424, validationLoss=null. Actual
ONNX export passed; real local ORT WASM CPU output was finite, shape1x7x512x512,
maximum PyTorch error0.000169039, external requests0. Same-tile before/after
diagnostics cover all 5 USGS plus82 auxiliary originals. Exact-pixel training
Dice improved for auxiliary hydro (.2097 to .2923), decreased for auxiliary
transport (.1708 to .1280). USGS international/admin Dice improved while their
recall decreased; USGS hydro/transport Dice decreased. These are selected training
tiles with no boundary tolerance, not independent accuracy or release criteria.
Ruling: preserve this genuinely trained continuation with its regressions as
pending evidence; do not promote it over the previous model or tune thresholds
to hide the trade-off. Independent diverse border labels/evaluation remain open.

Final focused verification: 32 corpus/source tests +7 model/sampler tests +3 Node
release/packaging/tile tests passed. Acquisition logs were archived byte-for-byte;
4 unused build-log copies removed (35090 bytes). No original/material/checkpoint
or unrelated worker output deleted. Model previews capped at29 for87 diagnostics.
