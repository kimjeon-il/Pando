# Independent map analysis

`plugins/pando-map-tools` provides the `pando-map-analysis` skill alongside the
existing training skill. Analysis runs in Node and the existing Python runtime;
Pando, QGIS, a browser, a server and an additional environment are not required.
An installed plugin binds to the existing `work/ui` checkout with `--workspace`.
Its cache contains code/instructions only. OCR packs, place shards and model
weights are read from their existing shared locations, never copied into it.

The CLI has three entrypoints:

```powershell
node plugins/pando-map-tools/scripts/map.mjs analyze --input D:/maps/map.jpg --job D:/materials/map/job.json --model D:/materials/model/boundary.manifest.json --languages eng
node plugins/pando-map-tools/scripts/map.mjs revise --job D:/materials/map/job.json --changes D:/materials/map/edits.json
node plugins/pando-map-tools/scripts/map.mjs export --job D:/materials/map/job.json --output D:/materials/map/export
```

All commands accept `--workspace`. Analysis accepts PNG/JPEG/WebP or a selected
PDF page, an optional date, language list and original-pixel source rectangle.
Raster source coordinates are EXIF-oriented pixels; encoded dimensions and EXIF
orientation are retained. A PDF's raster DPI is recorded. Original files are
read only. `--max-pixels` bounds the working raster (default 4MP, maximum 16MP).
The current C++ graph editor also limits the original pixel grid to 16MP.

`analysis.json`/job JSON owns source and resource hashes, OCR original text,
layout/grid candidates, location hypotheses, original-pixel inference master,
current edited graph, calibration, diagnostics and structured revision history.
Changing only calibration never runs OCR/inference again. Changing a region
reruns analysis and retains its earlier inference in `inferenceHistory`.
Every graph rebuild can change candidate IDs; read current IDs before editing.
The skill documents the structured revision commands, including Live-Wire,
line refinement, TPS line constraints and explicit final review/selection.

Pending models can generate **provisional candidates**. This permission does
not change approval/evaluation status. Classes absent from supervision are
masked and do not contribute candidate confidence. Ambiguous or unsupported
locations remain unresolved; provide reviewed control points or select a valid
hypothesis. A manual review does not establish positional or historical accuracy.

Export requires current calibration and boundary review. It writes into a new
directory atomically after all four artifacts and a completion manifest exist:
`features.geojson`, `preview.png`, `analysis.json`, `report.md`, `complete.json`.
Failures/cancellation remove staging output; existing destinations are rejected.
Source evidence can be supplied with `--provenance <json>`. Names, national
ownership and validity dates are never assigned automatically.

Use Pando's ordinary GIS import with **generic objects**, its existing vector
editor, atomic import Undo/Redo and GeoPackage save/reopen. No analysis format,
app delivery bridge or dedicated review surface is added.

## Transition gate

The app reference-image feature stays active until real Windows and Android
landscape import/edit/Undo/Redo/save/reopen checks pass. Only then may source and
calibration assets be preserved and the old UI/state/Worker/persistence/assets
be deleted in one transition. The current plugin reuses canonical analysis
helpers during this explicitly staged transition; algorithms are not duplicated.
Model accuracy/release evaluation remains independent of this workflow gate.
