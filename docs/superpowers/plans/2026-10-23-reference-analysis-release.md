# Reference analysis main integration and follow-up

Approved by user: publish the current implementation to main/Pages, then continue
the existing reference-image analysis plan. Execute inline on permanent work/ui;
main is the clean integration checkout. No unrelated GIS integration or portable
app distribution.

- [ ] Review and commit only reference-analysis sources, dependencies, current
  generated Worker/WASM assets, tests and paired data pin.
- [ ] Publish paired library revision b4c115dc2b9b0ddea4261475807b86f9af2d836a
  before publishing code that consumes it; fast-forward only, preserve remote work.
- [ ] Generate build metadata after the implementation commit, verify it, and
  commit generated outputs separately.
- [ ] Verify the committed viewer artifact and relevant browser checks, integrate
  work/ui into main, push, then verify Actions and the actual deployed build.
- [ ] Build and probe the exact integrated Windows source using its fixed build
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
