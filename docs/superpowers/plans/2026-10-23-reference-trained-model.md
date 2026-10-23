# Actual reference-boundary training checkpoint

User request: add an actually trained model. Continue the approved reference-image
plan inline on permanent work/ui. Main publication is outside this continuation.

1. Acquire a small, pinned set of official USGS US Topo layered GeoPDFs. Keep
   publisher metadata, original PDF bytes, rights, hashes and map dates in the
   external library. Inspect the actual OCG names and rendered content.
2. Extend the existing acquisition/corpus/training owners with focused failing
   tests. Derive masks from the publisher's International, State/County, Hydro,
   Transportation and Frame layers. Keep source text regions separate and ignore
   ambiguous occluded pixels. Missing semantic channels remain unsupervised.
3. Train the existing MobileNetV3 U-Net with real map rasters and source-derived
   masks, using the fixed Python environment and GTX1650 when supported. Keep
   exact step counts, seed, data/label hashes, loss, covered channels and weights.
4. Export actual trained ONNX weights and run real ONNX inference, separate from
   the earlier random interface diagnostic. Report the numerical/runtime result
   and inspect prediction overlays on real source maps.
5. Store weights, sources, derived labels and evidence externally, scoped to this
   topic. Clean completed task temporary outputs. Run only affected tests.

Ruling: publisher-authored PDF layers provide source-derived training labels;
they are not human-reviewed segmentation annotations or independent evaluation
truth. Permit this exact verified provenance only in an explicit training-only
mode. Ordinary corpus evaluation and application release gates remain strict.
Do not invent reviewed=true, independent train/validation/test map families,
unlabelled coast targets, achieved quality thresholds or Android evidence.

The resulting first checkpoint is genuinely trained on real maps. It remains
pending independent historical/script-family evaluation and device profiling.
Do not install unapproved weights at the application release manifest path or
flip releaseApproved/evaluationStatus merely to enable the product UI.

2026-10-23 continuation after user steering: prefer genuinely diverse map
conditions over more similar sheets. Add a bounded real-only Semap subset from
seven permitted institutions (six represented in the actual 24-item subset),
one patch per original source item, author train partition
only. Preserve author image-rights table and manual source labels. Supplement
water/road supervision only; Semap does not label international, administrative,
coast, text or frame semantics. Keep those channels unknown in this auxiliary
corpus. Source families, language and exact dates remain unresolved, not invented.
Use the actual trained USGS checkpoint to initialize mixed-corpus fine-tuning.

Ruling: real historical-map auxiliary classes improve condition coverage, but do
not establish cross-family boundary accuracy. No synthetic samples, source test
patches, duplicate pages or image recolorings count as new map diversity.

Final review found AMP can skip an optimizer update despite a finite loss. Add
explicit attempted-batch/successful-update/skipped-update counters with a
finite-loss/overflow regression. The completed first-stage count is 1800 attempted
batches; its successful update count was not recorded and must remain unknown.
Subsequent mixed-corpus training records the exact separate counters. Preserve
existing pending checkpoint files during startup instead of overwriting them.

New-scope review found that permitting checkpoint initialization in ordinary
training could hide previous exposure to future validation/test sheets. Restrict
initialization to training-only until lineage independence is verified; the
focused promotion-rejection regression was observed RED then GREEN. Empty
auxiliary-validity tiles are excluded (also RED then GREEN): the actual 24-item
inventory contributes 17 labelled items / 65 tiles, alongside 5 USGS / 150 tiles.
No claim is made about the seven unlabelled auxiliary source items learning a
semantic class. The source contact sheet records genuinely different scans.

Main advanced concurrently to 37dac212 (historical reconstruction documentation
only). After local/remote and changed-path checks, main was fast-forwarded into
work/ui without discarding task edits. No work/ui-to-main integration occurred.
