# Independent map analysis

`plugins/pando-map-tools` provides the `pando-map-analysis` skill alongside the
existing training skill. Analysis runs in Node and the existing Python runtime;
Pando, QGIS, a browser, a server and an additional environment are not required.
An installed plugin binds to the existing `work/ui` checkout with `--workspace`.
Its cache contains code/instructions only. OCR packs, place shards and model
weights are read from their existing shared locations, never copied into it.

## Mobile access

Use a Codex/Remote conversation connected to this PC and request "Map Toolkit으로
첨부한 지도를 분석해줘". The host runs the same installed plugin with
`--workspace D:/dev/worktrees/ui`; the phone does not need the analysis runtime.
Keep the host online. Use the attached original file when it is accessible and
return the preview and GeoJSON through supported conversation file delivery.
If either attachment access or delivery is unavailable, report that limitation
instead of substituting a Windows path and claiming the phone workflow passed.

This local installation is separate from the account's general ChatGPT plugin
list. Uploading its skills does not deploy the local runtimes, models or shared
data to a cloud conversation. Mobile standalone execution and account-directory
registration are not established by a successful host-side runtime check.
See [remote connections](https://learn.chatgpt.com/docs/remote-connections) and
[local plugin packaging](https://developers.openai.com/plugins/build/plugins).

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
Jobs bind the plugin calculation helpers, dependency lock and loaded core
manifest. Missing or changed runtime identities are rejected before revision or
export; analyze a new job after upgrading these resources. Analysis rechecks
source, data-pin, OCR, place-manifest and model signatures before completion.
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

## Application boundary

Analysis and numerical adapters live in the plugin; common C++/WASM and global
place search remain shared. Pando contains no reference-image panel, overlay,
analysis Worker or OCR/model bundle. Project/autosave/GeoPackage attachment fields
from the retired development feature are explicitly rejected. Original files and
existing saved projects are never deleted or silently migrated.

The pre-cutover Windows and Android landscape workflows exported the active
image collections before isolation and passed import/edit/Undo/Redo/save/reopen.
Independent model/historical accuracy remains separate from this workflow proof.

Training parity also runs through tools/reference-analysis/verify-trained-onnx.mjs
with local paths and the same Node WASM runtime, without a browser or server.
