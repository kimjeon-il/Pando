# Macro training continuation through the Codex plugin

The user clarified that Codex must use a plugin without a separate QGIS app.
Pando Map Tools is a skills-based plugin that reuses the existing CLI and CUDA
environment. No additional QGIS operations or installations are needed.
The initial macro-v5 run was stopped after epoch3: its GSI exclusion missed 38
positive pixels beside a disputed-island label. Preserve the consumed labels as
rejected evidence, correct exclusions in a distinct supervision edition and
restart from macro-v4 into macro-v6. Verify target and known pixels in normalized
x0.28..0.42/y0.46..0.56 are zero before restarting.

Continue the existing macro-v4 checkpoint in the permanent work/ui environment.
Keep the reviewed runtime/data pairing. Main has two new integration commits but
merging currently overlaps unrelated unfinished report-path changes; do not stash
or mix that work into this training task. Source/data scope remains training only.

- Reuse four existing original groups and their five publisher variants.
- Add actual GSI Japanese national relief/bathymetry and NRCan Africa continental
  map originals, with source-specific weak supervision and rights/hash records.
  Exclude legends, uncertain/disputed marks and logos. A national affiliation
  symbol is source depiction, not a legal maritime-border or sovereignty claim.
- Use existing Python image tools to inspect matching image/mask grids and real
  target overlays. Keep immutable PDF originals and the admitted masks.
- Extend the canonical MapTiles training owner with deterministic paired scan
  conditions: colour/grayscale, brightness, contrast, blur, resolution and JPEG.
  Preserve target/validity/position; do not count augmentation as new originals.
- Balance originals, initialize macro-v4, train a corrected macro-v6 checkpoint, export
  ONNX and compare selected identical supervised tiles before/after. Preserve
  pending/not-applied status; this is not independent held-out evaluation.
- Reuse existing Python/CUDA, fixed development server, report helpers and data
  store. Expected peak additional storage <=2GiB; D free29.3GiB, exceeds peak+5.
- Run focused corpus/augmentation checks, actual GPU training and ONNX parity.
  Archive selected reports/materials, clean task temporaries and report blocked
  cleanup explicitly. Do not build apps or integrate main for this task.
