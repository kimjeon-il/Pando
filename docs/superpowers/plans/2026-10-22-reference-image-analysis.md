# Reference image automatic analysis implementation

Approved specification: user-provided implementation plan, 2026-10-22. Implement inline on the permanent work/ui worktree. No main integration or deployment.

## Required behavior

Offline Windows/Android image georeferencing without initial region hints, followed by unprompted whole-map semantic boundary extraction, review, and atomic creation of generic lines/polygons. Preserve manual calibration and image history. Reuse Core numerics/topology, Worker RPC, generic command ownership, and Live-Wire correction. Web remains viewer-only.

OCR includes Latin, Korean, Chinese, Japanese, Arabic, Persian, Urdu, modern/ancient Greek, Russian, Ukrainian, Hebrew, Armenian, Georgian, Hindi and Bengali, plus Latin-language historical-map packs and vertical CJK/Korean variants. Preserve original text and images. Original maps, labels, learned weights and evidence belong to the pinned external library; application code owns generators, training, validation and tests.

## Execution tasks

1. Restore the existing editing-presentation regression fixture; establish corpus manifest and evaluation contracts with no tile/source leakage.
2. Package pinned offline Tesseract runtime/languages, normalize OCR coordinates/RTL text, build global place matching.
3. Extend Core georeference quality: competing correspondences, source-pixel cross validation, distributed controls, fold detection and ambiguous-result handling.
4. Implement MobileNetV3 U-Net training/export/evaluation and tiled ONNX inference. Missing/unvalidated real weights must fail visibly, never substitute random weights.
5. Convert semantic masks into one Core-owned boundary graph and closed faces, preserving holes and shared edges.
6. Integrate cancellable analysis/review into the existing reference controller and apply selected generic features atomically with provenance.
7. Run affected units, focused browser workflows, offline runtime integration and available real-app checks; report unavailable real corpus/device validation independently.

## Acceptance

Automatic recommendation requires >=6 correspondences, >=20% image coverage, source-pixel cross-validation p95 <=8 and no fold. Dataset-level targets: correct region >=95%, wrong automatic region recommendations zero; boundary precision >=95%, recall >=85%, tolerance max(2 source px, half stroke width). These are targets, not measured results. Independent historical geometry is required for any 0.5 CSS px claim.

Android targets: one tile at a time, 512px tiles/64px overlap; release OCR before loading segmentation; 8MP analysis <=180s and additional memory <=384MiB on a 4GB device. Test actual model/OCR, cancellation, stale results, generic atomic apply, undo/redo, save/reopen. Never report mocked inference as real-model verification.

## Approved continuation 2026-10-23

Continue inline in the existing UI worktree; preserve all current work.

1. Fix reference place queries: all names, independent of viewport/month/language and identity publication; reuse Worker RPC/scheduler cancellation.
2. Add shared original sources with pixel sourceRect views. Insets are separate image records, not nested mutable warp owners. Include crops in signatures, history, inference reuse, rendering and tracing.
3. Detect frame/legend/inset candidates and coordinate labels/grid intersections. Ambiguous datum/prime meridian or regions require review; never guess absolute controls.
4. Store shared source bytes once in canonical project packages, restore crops/calibration and created feature provenance; transient inference buffers are not persisted.
5. Prepare licensed corpus and reviewed labels, then train/evaluate/export the existing semantic model. No human-review or release claims for automatic draft labels.
6. Verify actual full-world offline Windows/Android flow and budgets. Small-project disables builtin places and is not global-georeferencing evidence. Clean unused test outputs after each step without backup copies.

Interface rulings: preserve one warp per record; UVs and graph pixels refer to the effective crop, with explicit crop offset for original source pixels. Existing reference analysis service/controller remain owners. Reuse canonical place and project-package infrastructure rather than new caches or persistence paths.

## Initial evidence (2026-10-22 historical snapshot)

HEAD 2bb8bc58967b2740bfd71f919210d3783d7802d4, clean work/ui, origin/main and origin/work/ui aligned. Library 36818f327b5d7a423dbf51db79106197786b69f6 contains no annotation/traineddata/ONNX entries. Existing editing-bridge test fails because its presentation fixture omits required editingDomain.snapshot; implementation must not weaken product dependencies.


## Implementation checkpoint (not release complete)

Implemented: 29 local OCR recognition packs plus OSD, sequential loading and vertical-page modes; overview cardinal orientation with low-confidence OCR comparison and inverse source-coordinate restoration; spatially balanced OCR deduplication before the detection limit and fair global search query passes; dedicated Worker RPC/scheduler; Core source-pixel quality gate; semantic-mask shared graphs, conservative supported dash-gap connection, holes and dateline projection; controller-owned review, location choice, source-pixel exclude/cut/join/Live-Wire replacement, review Undo/Redo, selected atomic generic import; training/export and full-sheet tolerant evaluation code. Exported weights remain unapproved until genuine corpus/model/device evaluation.

Continuation engineering implemented: viewport/presentation-independent read-only place search; shared immutable source/crop views and independent inset records; conservative straight-frame/legend candidates and review; explicit hemisphere/DMS graticule labels and visible intersections gated on source CRS confirmation; shared-source GeoPackage attachments, file/autosave/cold startup restoration, transactional image adoption/rollback and late-save dirty guards. A single clear main frame continues automatically; ambiguous panels require review. Renderer and auxiliary tracing use the same decoded-source owner.

Still open: reviewed seven-channel corpus labels, actual segmentation training/export, fixed dataset location/boundary targets, broader historical layout/OCR accuracy, curved/oblique graticules and non-WGS84/unknown coordinate systems, Android offline native execution and memory/time budgets. Browser crop/save/clear/actual GeoPackage reopen and boundary edit/Undo/Redo/autosave/reload are verified with real Core/Worker behavior and fixture OCR/inference where declared. Windows full-world genuine local OCR/search/shared-source package proof passed in the final native binary:61 detections,1 offline Seoul match,2 records sharing1 source,0 blocked requests, model explicitly missing. None of this certifies learned model accuracy or historical truth.

Safety limits: analysis rejects sources above 16MP before allocating tiled inference buffers; release Android budget is still unmeasured. No random model is shipped to make extraction appear available. Current missing-model failure is intentional and user-visible.

Training runs from this application checkout with tools/reference-analysis/requirements.txt in the fixed per-worktree build-native/python environment. Use corpus.py --corpus <external manifest> first, then train.py train/evaluate/export; originals, reviewed labels, checkpoints, ONNX and evaluation reports go to the external library. Pending model manifests cannot enter app packaging.

App packaging owns only manifest-listed offline OCR/model files and checks their hashes. The public viewer excludes editor modules and the OCR/AI distributions. App stage budget accounts for the exact added runtime and weight bytes separately. Library storage supports --include-prefix to avoid absorbing unrelated materialized GIS/report work. No main integration, public push or deployment was performed.

Continuation checkpoint, 2026-10-23: 211 focused Node tests, 7 corpus/evaluation Python tests and 8 browser scenarios passed; after the final review fixes, the 3 affected OCR/Worker/review scenarios passed again. All 29 recognition packs genuinely initialized/recognized sequentially offline; this checks runtime compatibility, not script-specific historical accuracy. Actual archived-map rotation and dedicated Worker OCR passed. A second read-only review found late import ACK state overwrite and OCR truncation before deduplication; both were reproduced and corrected. Inactive tracing tools now stop overwriting the next workflow's status.

Reviewed graph edits retain the immutable inferred graph and a command log; the Core rasterizes the current reviewed chains on the original source-pixel grid and reuses its single topology owner with automatic gap filling disabled. This deliberately preserves original raster evidence and shared-face reconstruction at the cost of subpixel vector precision in the review derivative; it is not cadastral or historical ground truth. The raw graph is reused after calibration-only changes without model inference.

Inventory correction: report attachments are included alongside source-directory candidates. The current scan found 4 original candidates, 76 report-evidence candidates and 37 source-reference entries. Most report attachments are application/comparison screenshots; none are promoted to reviewed map labels automatically. Genuine training/evaluation remains unavailable.

Heavy model checks are separate from the default suite. The remaining Python model tests still use the fixed training environment. For the current native diagnostic export and Node/WASM interface check, follow `tools/reference-analysis/README.md`. Diagnostic weights never substitute for a validated release model.
