# Reference-map training and evaluation

Run these tools from the PandoLab worktree. The library checkout is storage only.
Original maps, annotations, checkpoints, ONNX weights and reports belong in the
external library, not application Git. Use `tools/report-paths.mjs` for complete
report originals; the readable archive pages may contain abbreviated text.

## Current state

The application can run local OCR, georeference checks, semantic inference and
shared boundary review. The bundled OCR catalog has 29 recognition variants plus
OSD. There is no independently reviewed segmentation corpus or approved release
checkpoint in the current data. Publisher-derived training is available below.
`verify-model.py` exports an untrained interface diagnostic into
the fixed ignored build directory; it is never a release model.

`prepare-reference-analysis-assets.mjs` applies the documented
`raw-worker-lifecycle-v1` hook to the pinned Tesseract 7 browser distribution.
It requires one exact upstream anchor and records the patch in the runtime
manifest. This exposes the raw Worker before initialization so the OCR operation
can own startup cancellation, language-load failures and later Worker crashes.
The same owner releases the local WebView2 Blob bootstrap and error listeners;
no global Worker replacement or alternate OCR implementation is installed.

The pinned source catalog and `acquire-sources.py` add actual Persian/Urdu map
seeds to an external inventory. They record item rights, uncertain dates, exact
download hashes and whether a file is an official downsample. They never create
labels or mark a corpus reviewed. Arabic sources with unresolved item rights are
listed but skipped. Existing originals are verified rather than overwritten;
failed downloads remove only their own exclusively created `.part` file.

```powershell
& build-native/python/Scripts/python.exe tools/reference-analysis/acquire-sources.py --output EXTERNAL_LIBRARY_REPORTS/reference-analysis/corpus/sources
& build-native/python/Scripts/python.exe tools/reference-analysis/prepare-analysis-images.py --sources EXTERNAL_LIBRARY_REPORTS/reference-analysis/corpus/sources
```

The second command preserves the master and makes an 8MP app input only when
needed, using reduced JPEG decoding. It records separate horizontal/vertical
original-pixel ratios and keeps source-family identity. Inventory distinguishes
masters, official downsample candidates and these app derivatives. No training
labels or accuracy results are inferred from a resized map.

Native runtime proof uses the map-data shell and an explicit small source map:
set `PANDOLAB_SHELL_PROFILE=map-data` and `PANDOLAB_REFERENCE_PROBE_SOURCE` before
the fixed Windows build, then run it with `--probe-auto --probe-reference-analysis
--probe-profile-id reference-analysis --diagnostic-output ABSOLUTE_REPORT_PATH`.
This exercises genuine local OCR, moving-view independent place search and
shared-source packaging. Its `releaseReady` remains false: it does not certify a
trained boundary model or Android memory/time targets.

## Corpus contract

A corpus manifest uses `schemaVersion: 1` and `sheets`. Each sheet records:

```json
{
  "id": "series-edition-sheet",
  "familyId": "cartographic-production-family",
  "editionId": "publication-edition",
  "duplicateGroup": "original-sheet-and-rescans",
  "split": "train",
  "image": "sources/sheet.png",
  "sha256": "SHA256_OF_ORIGINAL_BYTES",
  "annotations": "labels/sheet.json",
  "mapKind": "monochrome",
  "script": "Arabic",
  "language": "fas",
  "source": {
    "url": "ORIGINAL_SOURCE_URL",
    "license": "VERIFIED_USAGE_CONDITIONS",
    "surveyed": null,
    "published": "PUBLICATION_DATE",
    "revised": null
  }
}
```

All three split sets must have separate real map families. A family, edition or
duplicate group cannot cross train/validation/test. Arabic, Persian and Urdu use
separate evaluation groups. The language catalog is read from the same generated
runtime manifest as the application. A screenshot or a linked source is an
inventory candidate, not an annotated original.

Labels use EXIF-oriented original pixel coordinates and dimensions:

```json
{
  "schemaVersion": 1,
  "reviewed": false,
  "width": 1600,
  "height": 1200,
  "lines": [
    { "kind": "international", "points": [[120, 140], [180, 210]], "width": 3 }
  ],
  "ignore": [[[300, 200], [340, 200], [340, 250], [300, 250]]]
}
```

The example coordinates are schema illustrations. They are not training labels.
Set `reviewed: true` only after reviewing actual source annotations. Channels are
`international, administrative, coast, hydro, transport, text, frame`; overlapping
semantics are allowed. Record the original line width, and mark genuinely
unreadable areas in `ignore`. City symbols, original transcriptions, independent
georeference check points and source-date evidence must also be retained with the
corpus; the segmentation line schema does not replace their independent review.

Prepare a draft directly from the verified acquired JPEG sources, without making
another image copy:

```powershell
& build-native/python/Scripts/python.exe tools/reference-analysis/corpus.py --prepare-review EXTERNAL_LIBRARY_REPORTS/reference-analysis/corpus/sources
```

This writes `labels/<source-id>.json` and `corpus.draft.json` beside `sources/`.
Labels start empty and `reviewed: false`, using header-only original dimensions.
The draft uses the current corpus contract, with `split`, `editionId` and
`mapKind` left unset for review. It cannot pass the training validator. Publication
uncertainty and official-downsample status remain in the source metadata. A
runtime analysis derivative is not substituted for the original coordinate grid.
Rerunning verifies source hashes and dimensions while preserving edited labels
and draft metadata. A changed inventory or identity fails for inspection.

Review all seven overlapping classes, unreadable `ignore` regions, city symbols,
original transcriptions and independent check points. Confirm map production
family/edition/duplicates before assigning disjoint train/validation/test sets.
Keep unconfirmed dates unset. Promote a completed draft to `corpus.json` only
after actual annotation review and successful `--corpus` validation; the draft
command never performs that promotion or approves a model. The acquired samples
alone do not provide the three independent families needed for training.

## Commands

The fixed development environment is `build-native/python/Scripts/python.exe`.
Top-level dependency versions are in `requirements.txt`. CPU verifies
architecture/export; install matching official CUDA PyTorch/torchvision wheels
in this same environment for GPU training. Check the interpreter's ABI, available
disk space and the GPU's supported architecture before installing. Do not create
another virtual environment or retain downloaded wheel copies.

```powershell
$trainingPython = 'D:/dev/worktrees/ui/build-native/python/Scripts/python.exe'
$corpusPath = 'EXTERNAL_LIBRARY_CORPUS/corpus.json'
$checkpointPath = 'EXTERNAL_LIBRARY_WEIGHTS/boundary.pt'
$evaluationPath = 'EXTERNAL_LIBRARY_REPORTS/boundary-evaluation.json'
$onnxPath = 'EXTERNAL_LIBRARY_RUNTIME/boundary.onnx'

& $trainingPython tools/reference-analysis/corpus.py --corpus $corpusPath
& $trainingPython tools/reference-analysis/train.py train --corpus $corpusPath --output $checkpointPath --batch 1
& $trainingPython tools/reference-analysis/train.py evaluate --corpus $corpusPath --checkpoint $checkpointPath --output $evaluationPath
& $trainingPython tools/reference-analysis/train.py export --checkpoint $checkpointPath --output $onnxPath
```

Export deliberately produces a pending, unapproved manifest. Do not change those
fields merely to enable the UI. Release requires independent region accuracy,
map-family/script boundary metrics, topology validity and genuine Windows/Android
offline/performance evidence from the approved plan. Application packaging rejects
pending weights. App inference expects `boundary.onnx` and its
`boundary.manifest.json` under the pinned `reference-analysis/v1` data directory.

The evaluator blends the complete original sheet before calculating distance
tolerance `max(2px, original stroke width / 2)`; it does not count overlapping tile
predictions multiple times. Generated inference masters stay in original pixels.
The review derivative keeps its immutable master and edit commands. Historical
attribution and historical screen-space geometry accuracy are separate evaluations.

## Publisher-derived first training checkpoint

`usgs-source-catalog.json` pins five actual US Topo GeoPDFs with download hashes,
publication dates and reuse conditions. Keep original PDFs and generated
`notices/` together: map-specific third-party credits still apply. `publisher.py`
uses their optional-content layers, with imagery and shaded relief switched off,
to create source-derived multi-label training masks. International and state/
county boundaries, hydrography, transport, glyph boxes and map frame are distinct
channels. Boundary pixels covered by text are ignored. Coast is unobserved;
water polygons are not silently relabelled as coastline.

```powershell
$publisherCorpus = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/corpus/usgs-publisher'
$firstModel = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/models/usgs-publisher-v1'
& $trainingPython tools/reference-analysis/acquire-sources.py --catalog tools/reference-analysis/usgs-source-catalog.json --output "$publisherCorpus/sources"
& $trainingPython tools/reference-analysis/publisher.py --sources "$publisherCorpus/sources"
$env:TORCH_HOME = "$firstModel/encoder"
& $trainingPython tools/reference-analysis/train.py train --training-only --corpus "$publisherCorpus/corpus.training.json" --output "$firstModel/boundary.pt" --epochs 12 --batch 1 --device cuda
& $trainingPython tools/reference-analysis/train.py export --checkpoint "$firstModel/boundary.pt" --output "$firstModel/boundary.onnx"
& $trainingPython tools/reference-analysis/inspect-checkpoint.py --corpus "$publisherCorpus/corpus.training.json" --checkpoint "$firstModel/boundary.pt" --onnx "$firstModel/boundary.onnx" --output "$firstModel/diagnostics"
```

All five maps share one production family, so all belong to `train`. The explicit
`--training-only` path validates PDF, generator, source metadata and raster hashes;
it never sets human `reviewed` or manufactures validation/test splits. The normal
corpus validator/evaluator rejects this training-only corpus and checkpoint.
Training uses CUDA mixed precision when available, six-channel validity, capped
positive class weights and a suppressed unobserved coast output. Checkpoint
selection uses training loss only, with `validationLoss: null`. The data identity
includes image/annotation/raster/source bytes, not just the manifest. Preserve the
encoder's upstream URL, hash and terms with the training evidence.

The inspection command checks ONNX structure and writes actual-map prediction
overlays plus float32 inputs/PyTorch logits for a real ORT WASM parity check.
Those selected training-tile diagnostics measure execution and fitting only;
they do not measure held-out accuracy, generalization or historical correctness.
Keep pending trained weights in the external model directory. Do not place them
at the active `reference-analysis/v1` release path before independent evaluation
and device checks pass.

## Diverse real-map auxiliary training

The user's condition-diversity requirement takes precedence over adding more
similar US Topo sheets. `semap.py` selects informative distinct originals across
twelve permitted institution IDs, including compound French/German IDs, in the
authors' Semap real-image training partition. It checks labels before downloading
images, requiring supervised pixels on at least 3% and hydro/transport pixels on
at least 0.5% of the patch. Pages and tiles from one item count once. Synthetic samples, original validation/test
samples, restricted/non-commercial/unclear image-rights rows and unreviewed
semantic substitutions are excluded. Exact HTTP ranges retrieve selected ZIP
members; the 2GB image ZIP and unrelated large model are never downloaded. Range
lengths, member ZIP CRCs and local SHA256 hashes are checked. Whole large-archive
MD5 verification is not claimed for these partial downloads. Preserve the pinned
author documentation, image-rights table, original patch and original label PNG.

Semap's manually annotated water/road classes provide auxiliary `hydro` and
`transport` supervision. Explicit built/non-built pixels provide their negatives;
background and contours stay ignored. All five other output channels are unknown
on these patches. Different source institutions are not asserted to be independent
production families, languages or historical dates. Unknown language/script/date
remain `und`/`Unknown`/null and do not count as script evaluation coverage. The
color/monochrome field records a raster-chroma heuristic for inventory only.

```powershell
$auxiliaryCorpus = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/corpus/semap-diverse'
$auxiliaryManifest = "$auxiliaryCorpus/corpus.expanded.training.json"
$previousModel = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/models/diverse-v1'
$diverseModel = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/models/diverse-v2'
& $trainingPython tools/reference-analysis/semap.py --output $auxiliaryCorpus --per-institution 12 --maximum-maps 96 --manifest-name corpus.expanded.training.json
& $trainingPython tools/reference-analysis/train.py train --training-only --corpus "$publisherCorpus/corpus.training.json" --auxiliary-corpus $auxiliaryManifest --initialize-checkpoint "$previousModel/boundary.pt" --output "$diverseModel/boundary.pt" --epochs 6 --batch 1 --device cuda --balance-sources --learning-rate 0.00003 --freeze-encoder-epochs 0
& $trainingPython tools/reference-analysis/train.py export --checkpoint "$diverseModel/boundary.pt" --output "$diverseModel/boundary.onnx"
& $trainingPython tools/reference-analysis/inspect-checkpoint.py --corpus "$publisherCorpus/corpus.training.json" --auxiliary-corpus $auxiliaryManifest --checkpoint "$diverseModel/boundary.pt" --baseline-checkpoint "$previousModel/boundary.pt" --onnx "$diverseModel/boundary.onnx" --output "$diverseModel/diagnostics"
& $trainingPython tools/reference-analysis/inspect-checkpoint.py --corpus "$publisherCorpus/corpus.training.json" --auxiliary-corpus $auxiliaryManifest --view-corpus auxiliary --checkpoint "$diverseModel/boundary.pt" --baseline-checkpoint "$previousModel/boundary.pt" --onnx "$diverseModel/boundary.onnx" --output "$diverseModel/auxiliary-diagnostics"
node tools/reference-analysis/verify-trained-onnx.mjs --base http://127.0.0.1:4287/ --model reports/reference-analysis/models/diverse-v2/boundary.onnx --diagnostics reports/reference-analysis/models/diverse-v2/diagnostics --output "$diverseModel/onnx-wasm-parity.json"
```

The last command needs a local static server for this worktree. It checks the
trained ONNX hash, actual output shape/finite values and PyTorch numerical parity,
blocks external requests and records timing. It does not bypass the application's
release gate. Fine-tuning records attempted batches, successful optimizer updates
and AMP-overflow skips separately; the original first-stage run's successful
update count was not recorded and must not be reconstructed from batch count.

The expanded manifest reuses the original pool and old immutable labels instead
of copying another corpus. Cached members must match remote ZIP CRC/length.
Validation pins rights/partition files and recomputes current semantic masks from
the original author PNG. A producer code hash is immutable provenance, not a
requirement that historical selection code equal the latest implementation.
Changed semantic conversion still fails. Ordinary independent-evaluation and
application release gates remain strict.

`--balance-sources` visits at least one tile from every original each epoch,
balances corpus quotas and samples additional originals uniformly, so a large
USGS sheet cannot outweigh many small historical originals by tile count alone.
Sampling is deterministic per epoch/seed and recorded in the checkpoint. The
lower continuation learning rate and encoder-freeze duration are also recorded.
Before/after inspection uses the actual initializer on identical training tiles;
it measures fitting only, never independent accuracy or model-release approval.

Dataset citation: Petitpierre, Gomez Donoso and Kriesel, *Semantic Segmentation Map
Dataset (Semap)*, EPFL, [pinned record 19048095](https://zenodo.org/records/19048095),
annotations CC BY 4.0, image reuse conditions in the authors' `license_images.md`.

## Macro-first continuation

`macro-source-catalog.json` pins whole published world/continent/country
maps, distinct from the city patches and detailed US Topo sheets above. Acquire
the catalogued PDFs with `acquire-sources.py`; run `macro.py` from this app checkout
against the external sources directory. It reuses the current raster corpus,
trainer, inspection and ONNX verification owners. No product/runtime owner changes.

The CIA world map uses conservative adjacency of the actual printed country-fill
palette: clear interiors supply negatives and visible seams between
different fills supply positives. Sea/coast, same-colour seams, text holes and
ambiguous pixels remain unknown. The Canada national map uses source-legend
stroke signatures including colour, width and dash pattern; visible source colour
is checked because PDF drawing extraction can expose clipped/hidden paths. The
legend and unclassified boundary marks are excluded. These masks are explicitly
`source-derived-weak`, not independently reviewed truth or historical attribution.
Validation recomputes source image/masks/statistics; source and rights metadata,
PDF bytes and whole-map scope are hash-bound in the corpus fingerprint.

```powershell
$macroCorpus = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/corpus/macro-political'
$macroModel = 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/models/macro-v2'
& $trainingPython tools/reference-analysis/acquire-sources.py --catalog tools/reference-analysis/macro-source-catalog.json --output "$macroCorpus/sources"
& $trainingPython tools/reference-analysis/macro.py --sources "$macroCorpus/sources" --manifest-name corpus.conditions.training.json
& $trainingPython tools/reference-analysis/train.py train --training-only --macro-only --corpus "$macroCorpus/corpus.conditions.training.json" --initialize-checkpoint 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/models/macro-v1/boundary.pt' --output "$macroModel/boundary.pt" --epochs 8 --batch 1 --device cuda --balance-sources --learning-rate 0.00001 --freeze-encoder-epochs 2
& $trainingPython tools/reference-analysis/train.py export --checkpoint "$macroModel/boundary.pt" --output "$macroModel/boundary.onnx"
& $trainingPython tools/reference-analysis/inspect-checkpoint.py --corpus "$macroCorpus/corpus.conditions.training.json" --checkpoint "$macroModel/boundary.pt" --baseline-checkpoint 'EXTERNAL_LIBRARY_REPORTS/reference-analysis/models/macro-v1/boundary.pt' --onnx "$macroModel/boundary.onnx" --output "$macroModel/diagnostics"
```

Macro scope records a verified whole-map extent, not a count of cropped tiles or
rotation/colour variants. The conditions manifest has three distinct originals
(CIA world 2021, CIA Asia 2013, NRCan Canada) and four publisher input variants.
The Canada colour and monochrome PDFs share duplicateGroup and production family;
the existing sampler balances original groups, not colour variants. Asia adds
azimuthal equal-area projection and printed colour-border seams, with its
disputed India/Pakistan/China area excluded. This does not establish broad
language, atlas-family or historical coverage. Only international/administrative
channels have supervision; the other
channels remain unobserved/suppressed in this continuation. Keep pending weights
outside the active runtime path. Reuse `verify-trained-onnx.mjs` for actual local
WASM parity, and report source-tile fitting separately from independent accuracy.

Use a distinct safe `--manifest-name` when expanding the source inventory. An
existing different manifest or changed raster/annotation is never overwritten.
Recorded generator hashes remain immutable provenance when source recomputation
confirms that all supervision is unchanged. Current selection/CLI edits do not
invalidate unchanged source labels.

For a supervision revision, place alternate full `.source.json` records in a
contained directory such as `recipes/seams-r4/` and pass
`--metadata-directory "$macroCorpus/recipes/seams-r4"` with a new
`--manifest-name corpus.seams.training.json`. Names must match original metadata
filenames. Only `id` (which must be distinct) and `supervision` may change;
original group, publisher, rights, source hash and all other fields remain fixed.
The importer reuses the original PDF, JPEG and notices and writes separate
hash-bound masks/annotation. Original metadata, manifests and checkpoints remain
immutable. This changes training labels, not the count of independent maps.
Wider palette adjacency is still weak supervision and can join narrow water
gaps. Inspect targets and compare both checkpoints against the same revised
targets; scores measured against different masks are not comparable.

The publisher-diversity continuation adds the Geoscience Australia folio map,
edition 3 (GEOCAT 73102), with its printed CC BY 3.0 Australia notice retained.
The full-country source includes relief tints, roads, railways and rivers. Only
the visibly matching state-boundary stroke supplies administrative supervision;
the legend/footer is excluded. Its PDF rotation is applied to image, boundary
and glyph-exclusion planes together, without interpolation or writing the PDF.
Normalized exclusion rectangles refer to the final visibly oriented image.

After acquiring the expanded catalog into the same source directory, preserve
the prior manifests and use `--manifest-name corpus.publishers.training.json`
with the existing `--metadata-directory` seam recipe. This is five publisher
inputs and four distinct original groups; Canada colour/monochrome remain one
group. It adds a production family, not independent accuracy or non-Latin
coverage. Continue from the actual macro-v3 checkpoint with original-group
balancing, and compare both checkpoints against these identical targets.

## Macro condition continuation through the Codex plugin

The expanded catalog also pins the GSI Japanese national relief/bathymetry map
and NRCan Africa continental reference map. GSI's printed country-affiliation
marks are source-depicted symbols, not asserted legal maritime borders. Uncertain
marks, broad disputed areas, legends and credits are excluded. Its sparse stroke
supervision uses `knownBandRadiusPixels: 8`: pixels outside the observed band are
unknown rather than invented whole-map negatives. Africa supplies conservative
country-fill seams, with sea/coast, same-colour boundaries and hatched areas left
unknown. Neither is independently reviewed evaluation truth.

The local `pando-map-tools` Codex plugin uses these existing command-line owners
and the existing Python/CUDA environment. It requires no QGIS, new desktop app
or MCP server. Check source/mask dimensions, render overlays with existing Python
image tools and inspect the actual pixels. Pixel-grid alignment is not geographic
registration, historical validation or a model quality score.

An exclusion correction uses `--metadata-directory` with a distinct supervision
id; source image/original metadata and consumed masks remain immutable. The first
GSI run, macro-v5, was stopped because its disputed-island exclusion missed 38
positive pixels. Do not export or initialize from that rejected checkpoint. Use
the corrected exclusion x0.28..0.42/y0.46..0.56, verify target and validity there
are zero, and restart from the last admitted macro-v4 checkpoint into macro-v6.

`train.py train --augment-conditions` varies colour/grayscale, brightness,
contrast, saturation, blur, resolution and JPEG compression using a deterministic
paired recipe for the tile and overview. It does not change coordinates, masks,
validity, sampler membership or source identity. Recipes vary by epoch/tile and
are recorded in the checkpoint. These are synthetic acquisition conditions, not
additional original maps, languages or evaluation groups. Evaluation and inspection
remain unaugmented. Combine it with `--macro-only --balance-sources`, continue from
the actual admitted prior checkpoint, and use a new output directory.
