# Independent map analysis

Map Toolkit reuses `plugins/pando-map-tools` for both local development and
private ChatGPT Work analysis. The private installation runs without PC Remote,
a ZIP upload, QGIS, an MCP server, an API key or a separate Python environment.
The source also retains the separately requested training skill; the cloud
analysis distribution excludes training code and environments.

## Private Work distribution

`tools/reference-analysis/package-private-plugin.mjs` builds from a full source
SHA already pushed to `origin/work/ui`, paired with its pinned library revision.
It collects the same source/dependency closure as `cloud-probe.mjs`, packages
verified common source/WASM, English/OSD OCR and place seeds, and lazily fetches
other requested OCR languages from pinned public library blobs. The pending
macro-v6 model is included only in the private archive, never application Git
or a public report. The managed analysis skill contains the engine and runtime
seed once; runtime preparation reuses a hash-keyed cache without copying weights.
The installation records the immutable code/data revisions and byte identities.

```powershell
node tools/reference-analysis/package-private-plugin.mjs --revision <pushed-full-SHA> --directory <private-new-output> --model <existing-private-manifest>
```

Upload the private archive with Plugin Creator's guarded update of the existing
Map Toolkit ID. Remove explicitly listed retired files in that same update.
Preserve the private audience and store account-specific IDs/links only in
platform settings. Do not silently publish the model or switch to a server when
private delivery is unavailable. Version 0.4.1 replaces the 0.4.0 delivery probe.

The analysis skill accepts an original attachment, URL or map-search request.
Codex uses existing web tools to select a source when extent, depicted period,
map type and rights are clear, asking only when interpretation is unresolved.
Survey/publication/revision dates and later historical reconstructions are
recorded separately. Bounded JPEG/PDF/PNG/WebP acquisition and training corpus
acquisition share `lib/map_source.py`; source bytes are never overwritten.
User maps and outputs remain private and are never automatically published.

The installed skill runs `<skill_root>/scripts/map.mjs` without local paths.
The same active Work environment can reload jobs on subsequent turns. Expired
environment recovery is outside the contract. Return actual downloads for the
GeoJSON, PNG, analysis JSON and report and verify their completion hashes.
Web/cloud checks do not establish phone selection or download behavior; those
require an actual phone with PC Remote disconnected.

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
