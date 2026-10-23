# Reference analysis main integration and follow-up

Approved by user: publish the current implementation to main/Pages, then continue
the existing reference-image analysis plan. Execute inline on permanent work/ui;
main is the clean integration checkout. No unrelated GIS integration or portable
app distribution.

- [x] Review and commit only reference-analysis sources, dependencies, current
  generated Worker/WASM assets, tests and paired data pin.
- [x] Publish paired library revision b4c115dc2b9b0ddea4261475807b86f9af2d836a
  before publishing code that consumes it; fast-forward only, preserve remote work.
- [x] Generate build metadata after the implementation commit, verify it, and
  commit generated outputs separately.
- [x] Verify the committed viewer artifact and relevant browser checks, integrate
  work/ui into main, push, then verify Actions and the actual deployed build.
- [x] Build and probe the exact integrated Windows source using its fixed build
  directory. Preserve the missing-model gate and releaseReady=false.
- [ ] Continue reviewed real-map annotation, family-separated training/evaluation
  and ONNX export using the approved plan. No synthetic/diagnostic weights may
  become release weights. Android budgets require an attached actual device.

Verification gates: relevant reference/project/place tests; packaging and viewer
dependency closure; actual local OCR/Worker, crop/package roundtrip, boundary
review/Undo/Redo/autosave; final native runtime and live Pages build identity.
Original materials and reports remain in the external library. Clean verified
unused generated outputs without discarding protected work or active caches.

Pre-publication viewer checks exposed two existing contract violations: stored
builtin baselines rejected signed/extended months despite the temporal contract,
and viewer workspace preferences opened the editor database. Use the canonical
temporal parser and the viewer's own preference database; retain the original
browser checks for BCE navigation, unchanged document/autosave and editor DB
isolation. This repair is required before publishing the current viewer.

Ruling: automatic tool policy blocked deleting the superseded local Pages stage.
Preserve it; verify final committed dependencies/hashes without another local
copy and let the existing Actions gate create/verify the final artifact before
deployment. Do not bypass the deletion rejection or create duplicate stages.

Release checkpoint: main baf1cbb77b2b589fd17a301a56275aa993d6153c and paired
data b4c115dc were published. Pages run 39890722250 succeeded; its final evidence
records 1701 files/204439626 bytes and excludes the editor/OCR distributions.
Actual public desktop/mobile search, BCE/CE navigation and viewer storage checks
passed. The matching full-world WebView2 probe passed with 61 OCR detections,
one offline place match, two records sharing one source, zero blocked requests,
PL-REF-MODEL-MISSING and releaseReady=false.

CI follow-up: repair the missing pinned-data action before architecture planning,
the small-project fixture's missing required OCR assets, and the old source-text
expectation that forwarded image attachments into Core import validation.
Fifty relevant Node tests pass, retaining data exclusion, ownership, tamper and
schema checks. The official Linux rebuild differs from the Windows-built WASM
by 115 instruction bytes, while the source/compiler/ABI identity and JavaScript
bytes match. Relinking with one Binaryen/EMCC worker did not remove the host
difference. Package the source-verified official CI artifact without weakening
the exact-byte gate; revalidate and rebuild the native shell for that pair.
The separate P2 prepared-mesh generation fails its boundary-edge validation;
do not alter GIS data or call that check passed.

Corpus continuation: existing corpus.py prepares empty, unreviewed original-pixel
labels and a current-schema draft from verified acquired sources without copying
images. Preserve manual edits, provenance, unknown dates and split/family review.
Eighteen Python tests pass. Actual Persian/Urdu map OCR diagnostics run offline,
but there are no transcribed ground truths or reviewed seven-channel labels.
The weak OSD script predictions on those maps are recorded for later quality
work; explicit-language diagnostics are not automatic-script accuracy evidence.

Ruling: the automatic check-budget hook rejected a broad check-plan listing.
Do not retry it. Use the file-specific verification above and report remaining
CI failures separately. No training accuracy or Android budget claim is made.
