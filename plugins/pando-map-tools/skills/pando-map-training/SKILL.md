---
name: pando-map-training
description: Use when the user requests Pando reference-map dataset preparation, diverse macro-map training, checkpoint comparison or ONNX verification.
---

# Pando map training

Use existing Pando command-line tools through the built-in Codex terminal.
This skills-based plugin needs no QGIS, additional desktop app, MCP server,
new virtual environment, background daemon or full application build.

The permanent implementation checkout on this PC is D:/dev/worktrees/ui.
Respect its AGENTS.md and preserve unrelated work. Reuse
build-native/python/Scripts/python.exe and its existing CUDA installation.
Never install a desktop GIS application merely to use this plugin.

## Sources and labels

The canonical owners in tools/reference-analysis/ are acquire-sources.mjs,
macro.py, corpus.py, train.py, inspect-checkpoint.py and verify-trained-onnx.mjs.
Read their current README and CLI arguments; extend these owners only when a
concrete missing capability requires it. Do not create a parallel training engine.

Resolve external data with tools/report-paths.mjs or tools/report_paths.py and
explicit read/write access. Run code in the app checkout, not the data store.
Keep original maps, annotations, models and reports in external library storage.
Hydrate requested scopes only; reuse source bytes and dependencies.

Prioritize actual world/continent/country maps with different institutions,
production families, scripts, projections, colour/monochrome and scan conditions.
Do not count rescans, translated variants or augmentation as separate originals.
Admit only rights-verified sources and source-bound labels. Unknown dates and
unobserved classes stay unknown. Unlabelled inventory candidates do not train.

Review source/target overlays, legends, text overlaps and disputed marks before
training. Source depiction is not legal attribution. Verify exclusion rectangles
against actual positive/known pixels. For sparse printed strokes, use bounded
known bands where appropriate rather than invented whole-sheet negative truth.
Validate with the current corpus owner before training.

## Train and inspect

Use train.py train --training-only --macro-only --balance-sources with an explicit
admitted corpus and a new output path. An actual prior checkpoint is usable
only with complete transitive source/family/edition/duplicate lineage. Otherwise
start from the verified public encoder; do not restamp missing lineage. Add
--augment-conditions when scan/photometric diversity is requested; coordinates
and labels stay unchanged. Select epochs, learning rate and encoder freeze for
the actual data. Record attempted batches, successful updates and AMP skips.
Use a separate frozen validation corpus and validation-loss early stopping.
Final-test sheets must not enter training or model selection. Source review
records the actual agent/human/publisher identity and exact known/unknown class
regions. Partial source review may train and produce scoped diagnostics but
cannot qualify whole-map accuracy. Keep the current private default until the
frozen per-map/map-macro precision, recall and confounder gates pass.

Read the initializer reports. Refuse rejected or aborted checkpoints; correct
labels and restart from the last admitted predecessor rather than continuing
weights already trained on rejected targets. Cancel only owned training jobs.

Run focused condition/macro/model checks for actual changes. After real GPU
training, export ONNX and inspect identical unaugmented targets against the actual
baseline with inspect-checkpoint.py. Verify ONNX/PyTorch parity locally using
verify-trained-onnx.mjs in the existing Node WASM runtime. Pass local model and
diagnostic paths; no browser, static server or --base argument is used.

Training-tile fitting is not held-out accuracy. Keep trainingOnly true,
evaluationStatus pending, releaseApproved false and map application not-applied
until independent evaluation and actual device checks justify a separately
authorized release. Keep weights in the shared model scope. Provisional plugin
use requires review and never promotes the model approval fields.

Archive selected external corpus/model/report prefixes using the existing library
storage command. Keep active/best checkpoints and designated evaluation evidence;
clean ended temporary renders and reproducible intermediates. Report blocked
deletion with exact sizes and never bypass execution review. Do not merge main,
publish a model, deploy or rebuild installers without that scope.
