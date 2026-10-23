# Macro-map continuation

User requests macro maps in preference to micro maps. Continue the already
authorized training workflow in work/ui, without another design questionnaire.

1. Select whole world/country source maps with visible source geometry and
   verified reuse terms. Start with CIA world political February2021 and NRCan
   Canada national map (PDF credits2024; landing page collection says2022).
   Do not count Semap city patches or US Topo sheets in this continuation.
2. Add a source-specific macro vector converter alongside the existing USGS and
   Semap importers, using the canonical corpus/trainer/inspection pipeline.
   Country fill adjacency provides conservative world-border supervision;
   explicitly catalogued source stroke signatures provide Canada boundary
   supervision. Uncertain exterior/coastal/text pixels remain unknown. This is
   source-derived training supervision, not independently reviewed ground truth.
3. Add macro-only admission to training and record the full-map scope in corpus
   metadata/checkpoint. Test selectors, unknown pixels, source/mask tampering,
   and rejection of micro/unknown scope before training.
4. Train actual weights from diverse-v2 on macro maps only; export actual ONNX,
   inspect identical source tiles against initializer, run local WASM parity.
   Archive/pin evidence externally, focused tests, fresh code review, local
   commits. Keep the model pending; do not promote it based on training fitting.

Ruling: two verified whole-map sources are a bounded macro-first pilot, not
evidence of broad atlas/language/historical coverage. Original acquisitions
without usable semantic geometry remain inventory and never count as training.
Ruling: source-colour adjacency is explicitly weak supervision. It does not
resolve sovereignty or disputed lines, and same-colour/obscured/sea boundaries
are not background truth. Costs if wrong: missed/ambiguous boundaries persist;
independent annotated macro maps are still required before model release.

Final review: Important macro admission hole reproduced: a Semap city source
could self-declare country scope in its manifest. Fix requires the source-bound
macro-vector-supervision annotation origin as well as extent/evidence, for both
primary and auxiliary inputs. Forged-scope regression observed RED then GREEN.
Ruling: other source origins cannot join macro-only training until they have an
explicit source-scope verification contract. Cost: some future legitimate macro
inputs need importer work first; current city/detail data cannot silently enter.
No deferred minor findings.
Ruling: weak supervision cannot settle same-colour/coastal/sovereignty ambiguity
or independent accuracy. Current PDF rendering was inspected, but arbitrary
future clipping configurations are not certified. Actual training/export/parity
are required below; unrelated runtime/UI/WIP stays outside this change.

Execution: two actual macro originals /44 supervised tiles, 8 epochs /352
attempted batches /349 successful optimizer updates /3 AMP skips. Selected
epoch7 loss1.144307216; validationLoss=null. Fine-tuning LR1e-5, encoder freeze2.
Actual ONNX WASM inference passed, finite1x7x512x512 outputs, maximum PyTorch
error0.000276804, external requests0. Same selected training-tile pixel Dice:
world international0 to .6481; Canada international0 to .2261/admin0 to .3265.
Canada predictions remain thick and confuse international/admin boundaries;
these weak-source fitting diagnostics do not establish independent quality.
Focused tests35 corpus/source +9 model/sampling/scope +3 Node package/gate passed.
Actual Semap source with forged country scope was rejected after the fix.
Regeneration removed11 unused derived draft files (1813297 bytes) before replacing
them with current legend-excluded derivatives. Original sources unchanged.
