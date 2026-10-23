# Reference-map training and evaluation

Run these tools from the PandoLab worktree. The library checkout is storage only.
Original maps, annotations, checkpoints, ONNX weights and reports belong in the
external library, not application Git. Use `tools/report-paths.mjs` for complete
report originals; the readable archive pages may contain abbreviated text.

## Current state

The application can run local OCR, georeference checks, semantic inference and
shared boundary review. The bundled OCR catalog has 29 recognition variants plus
OSD. There is no reviewed segmentation corpus or approved release checkpoint in
the current data. `verify-model.py` exports an untrained interface diagnostic into
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

Native runtime proof uses the full-world shell and an explicit small source map:
set `PANDOLAB_SHELL_PROFILE=full-world` and `PANDOLAB_REFERENCE_PROBE_SOURCE` before
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
Top-level dependency versions are in `requirements.txt`. The installed CPU
environment verifies architecture/export; CUDA training dependencies and real
device profiling are separate checks.

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
