# Map Toolkit georeference quality implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with TDD and one final fresh review. Preserve the permanent work/ui checkout and unrelated WIP.

**Goal:** Improve the existing private Map Toolkit's measured registration and boundary-candidate quality, retaining review and private file delivery.

**Architecture:** Keep OCR policy, numerical georeferencing, job state and training in their current owners. Repair the frontend-layout wiring first. Compare existing WASM transforms with held-out source-pixel error; never use TPS training residual as validation. Reuse current acquisition/corpus/training/evaluation owners.

**Tech stack:** Existing Node, Tesseract, C++/WASM, Pillow/PyMuPDF and existing training Python/CUDA. No new server, GIS application or environment.

**Spec:** The user's accepted next-step sequence in this conversation: registration first (OCR script, symbol/control position, transform choice); then text/grid/frame false positives with diverse macro maps; then fixed held-out evaluation and Pando workflow verification. The earlier private Work plan remains binding for transport, privacy, model approval and storage.

## Constraints and review focus

- Source in work/ui; no main integration or app build. Preserve other app/rendering/icon changes.
- Analysis and learning data remain external; private model stays private and pending/trainingOnly/releaseApproved:false.
- Current frontend owners are shared/frontend and apps/editor; remove retired filesystem paths from plugin/runtime packaging rather than adding compatibility aliases.
- Explicit OCR languages must remain explicit. Weak OSD must not discard much stronger recognition evidence, nor load every language for an unknown script.
- Crops, degenerate/clustered controls, mixed scripts and nonlinear overfitting require meaningful tests.
- Correcting registration must reuse the pixel graph and invalidate review. Do not restamp old jobs or reuse old producer signatures.
- No broad data audit: inspect selected source/label records and required dependencies. No independence claims from training labels.
- Task-owned temporary files are cleaned; originals, labels, evaluation evidence and active runtime/training state are protected.

## Task 1 — Repair current source/packaging wiring

Files: plugin lib/workspace.mjs, engine.mjs, jobs.mjs; tools/reference-analysis/runtime-assets.mjs, package-private-plugin.mjs, cloud-probe.mjs; directly affected map unit tests.

- [ ] Reproduce missing assets/js/modules/temporal.js through the existing production-job test (already RED).
- [ ] Replace retired module/WASM filesystem paths with canonical shared/frontend paths. Reuse scripts/lib/frontend-layout.mjs's WASM root.
- [ ] Update current source-closure assertions and prove no retired assets/js tree is packaged; instantiate the current signed WASM without rebuilding.
- [ ] Run focused plugin/packaging checks and commit task-owned files only.

## Task 2 — Use recognition evidence for OCR language choice

Files: existing lib/analysis/ocr-catalog.mjs, lib/engine.mjs; tests/unit/map-analysis-ocr-catalog.test.mjs and direct engine tests.

Interface: a catalog-owned pure selection function receives observed orientation/probe scores and optional explicit languages, and returns the actual bounded sequential recognition list.

- [ ] Add failing cases for the observed English/Cyrillic disagreement, correct non-Latin probes, explicit languages and unknown/empty probes.
- [ ] Preserve original OSD evidence; choose/add recognition languages from meaningful probe evidence without overwriting source text or indiscriminately loading packs.
- [ ] Re-run actual selected Canada OCR and record languages, detected names and resource hashes at default analysis size.

## Task 3 — Validate transform selection and control placement

Files: existing lib/analysis/georef.mjs as quality/selection owner; jobs.mjs and engine.mjs as callers; affected map-plugin/georef tests and selected small fixtures.

Interfaces: georeferenceQuality(points,mode,source) delegates numerical work to WASM. Selection returns warp, quality and model-comparison diagnostics. Job state remains owned by jobs.mjs.

- [ ] Reproduce the prior controls/affine residual without loading an old job as current state.
- [ ] Add failing tests for selecting the simplest validated transform, nonlinear overfit, crop pixel scaling and folded/degenerate fits.
- [ ] Evaluate existing similarity/affine/projective/TPS fits through existing WASM source-pixel cross validation, selecting nonlinear only with actual validation improvement.
- [ ] Compare actual source city symbols with supplied points; keep corrected observations and independent check points separate.
- [ ] Verify registration-only revisions preserve raw/pixel graph hashes and source signatures and clear prior review.

## Task 4 — Boundary supervision and fixed evaluation

Owners: tools/reference-analysis/{corpus,macro,train,evaluation,inspect-checkpoint}.py and existing plugin inference/graph modules. External selected corpus/model/report scopes own generated data.

- [ ] Inspect the selected diverse macro-map labels and model errors against source legends, distinguishing real reviewed truth from weak stroke supervision.
- [ ] Freeze source-family splits and evaluation inputs before optimizing; retain unclear text/line overlaps as unknown.
- [ ] Add only evidence-supported text/grid/frame hard negatives through existing label/training owners, with focused regression tests for changed logic.
- [ ] If valid supervised inputs exist, run bounded diverse macro training from the admitted checkpoint, compare on unchanged evaluation targets and verify ONNX/WASM parity. Missing independent labels are a reported gate, not invented evaluation success.

## Task 5 — Private runtime and user workflow verification

- [ ] Run focused changed-code tests, a fresh final code review and selected actual map checks; retain failing accuracy gates honestly.
- [ ] Commit/push only task-owned source to work/ui, package the immutable source and required data only, and update the same private Map Toolkit through its existing creator workflow.
- [ ] Check actual Work analysis/revision/file return and existing Pando generic import. Never infer phone success from desktop; retain the previous user's phone evidence only for unchanged transport, disclose any new unverified behavior.
- [ ] Publish/check only reports/development/integrations/map-toolkit-georeference-quality (and explicitly completed selected corpus/model scopes), preserve the runtime pin and clean ended outputs.
