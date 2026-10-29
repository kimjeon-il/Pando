# Map Toolkit 0.5.0 quality implementation

Approved in chat on 2026-10-29. Execute inline with focused TDD and one final fresh review. Reuse permanent work/ui; preserve unrelated native, icon and rendering work. No application main integration or installers.

## Goal and fixed decisions

- Joint georeference and boundary-model improvement, private Work delivery.
- Eighteen new macro originals: train/validation/test six each; four modern and two historical, three colour and three monochrome in each split. Production families/editions/duplicate originals never cross splits or ancestral training lineage. Freeze source/legend labels before predictions; reviewer kind is agent, not human.
- Analysis-only global gazetteer from pinned cities500, original aliases and evidenced historical names; reuse verified source parsing and analysis normalization. Do not weaken display-city approval or trigger allCountries audit.
- C++ forward/inverse projection and warp composition: spherical eqc/Robinson/LAEA/AEQD; sphere/ellipsoid Mercator/LCC/polar stereographic. No pyproj runtime, new environment, GIS application or server. Typed units/domain/datum diagnostics; geographic projection, fit, quality, meshes and boundary export share one owner.
- Fixed-projection automatic fit needs six points, 20 percent hull and cross-validation P95 at most eight original pixels. Unknown projection/parameter selection needs 18 distinct controls split 6/6/6. No manufactured independent points from PDF metadata.
- Canonical corpus/trainer/evaluator gain per-channel known/unknown masks, truthful review identity and transitive source lineage. Recover macro-v6 lineage before inheritance; otherwise initialize public pretrained encoder with verified new lineage. Missing lineage never becomes independence by changing flags.
- Train batch one, learning rate 1e-4, maximum20 epochs, encoder freeze2, validation patience5. Seven channels, 512px tiles/64px overlap, existing GPU. Test only after candidate/threshold freeze; retain pending/trainingOnly/releaseApproved:false.
- Boundary admission: per-channel map-macro precision .95/recall .85 and per-map .90/.75 floor. Tolerance max(2px,half original stroke width), unknown pixels excluded, empty truth does not count as perfect; confounder false positives must not regress. Below-gate candidate does not replace current private default.
- Work analyze/revise/export remain; explicit projection revision, new job contract, signed artifact pairing; reproject without OCR/inference. Verify actual cloud files/next turn and ordinary Pando import/edit/history/save/reopen; claim physical phone checks only when observed.
- Scoped report completion: reports/development/integrations/map-toolkit-quality-v2. Publish and check completed evidence only. Clean verified ended copies; do not bypass prior rejected deletion. Check expected peak plus5GiB headroom before1GiB growth.

## Tasks and checks

- [ ] Corpus review, known masks, lineage, full-sheet metrics and frozen evaluation admission; focused Python regressions.
- [ ] Verified sharded gazetteer build/search and engine/runtime wiring; exact/fuzzy/multilingual/ambiguous/cancellation/hash tests.
- [ ] C++ projection/warp/quality/graph composition and plugin revision; independent reference vectors and affected georef/import tests; affected WASM only.
- [ ] Acquire/review18 source-disjoint macro originals and labels, train/evaluate/export actual candidate with held-out evidence and ONNX parity. Unsupported/uncertain inputs remain unapproved.
- [ ] Focused regression, final fresh review, immutable source push and private0.5.0 artifact installation/readback, actual Work/Pando flow, report publication/check and cleanup accounting.
