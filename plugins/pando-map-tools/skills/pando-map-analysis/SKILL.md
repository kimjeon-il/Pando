---
name: pando-map-analysis
description: Use when a user asks to turn a map image or PDF into georeferenced boundary data, revise extracted map candidates, or export them for ordinary GIS import.
---

Use this plugin's `../../scripts/map.mjs` with the existing permanent Pando
`work/ui` checkout passed as `--workspace`. It reuses that checkout's Node
dependencies, `build-native/python/Scripts/python.exe`, verified C++ WASM and
shared OCR/place/model files. No GIS application, server, browser or new Python
environment is needed. Training remains a separate explicitly requested task.

Keep jobs and results in a selected external report scope. Originals are read
only. For historical borders, first read the workspace's
`docs/historical-border-reconstruction-policy.md`. Preserve the source graph;
display generalization targets Natural Earth 1:10M and is not historical proof.

```powershell
node <plugin>/scripts/map.mjs analyze --workspace D:/dev/worktrees/ui --input <map> --job <external/job.json> --model <existing/boundary.manifest.json>
node <plugin>/scripts/map.mjs revise --workspace D:/dev/worktrees/ui --job <job> --changes <edits.json>
node <plugin>/scripts/map.mjs export --workspace D:/dev/worktrees/ui --job <job> --output <new external directory>
```

`analyze` also accepts `--languages eng,ell`, `--date YYYY-MM-DD`, `--page 1`,
`--rect '{"x":0,"y":0,"width":1000,"height":800}'`, `--max-pixels 4000000`,
and `--model <manifest>`. Multipage PDFs need an explicit 1-based page. The
existing macro-v6 model is provisional; do not mark it validated. Select the
existing manifest from the training reports and pass `--model` explicitly;
the canonical default location requires that report edition to be available.

Read diagnostics, original OCR text, location candidates, quality and preview.
Compare the map/legend and evidence before choosing a location or boundary.
If ambiguous, request only the missing region or points. Do not invent
positions, ownership, names, dates or missing coastline.

Edits are JSON objects or an array:

* `{"type":"control-points","mode":"affine","points":[{"id":"p1","image":[0.1,0.2],"coordinate":[12,45]},...]}`.
  Image values are UVs of the full EXIF-oriented original, not the crop.
  Partial controls are saved as `needs-georeference`; similarity needs two,
  affine/TPS three and projective four points. TPS benefits from additional
  distributed points. The numerical core rejects degenerate fits. Mapping edits
  reproject the existing pixel graph without running inference.
* `{"type":"boundary","command":{"type":"exclude","chainId":1}}`.
  The shared core also accepts `replace` with original-pixel `points`, `cut`
  with a pixel `point`, and `join` with `from`/`to` chainId and start/end.
  Graph edits rebuild IDs: read current IDs before the next edit.
* `{"type":"exclude-rect","rect":[0,0,500,200]}` excludes whole chains with
  vertices in this original-pixel rectangle; cut first for partial removal.
* `{"type":"live-wire","chainId":1,"anchors":[[0.1,0.2],[0.3,0.4]]}` traces
  full-original UV anchors with existing shared endpoints. `refine-line` with
  `chainId` and optional `corridorPixels` refines its current source-pixel path.
* `{"type":"linear-constraints","constraints":[...]}` uses the existing
  calibration contract (`id`, `enabled`, UV `image`, geographic `coordinates`)
  for TPS line constraints. `{"type":"location","index":0}` selects a current
  location hypothesis. `{"type":"region","rect":{"x":100,"y":200,"width":1000,"height":800}}`
  reanalyzes a panel, preserves earlier inference evidence and invalidates review.
* `{"type":"source-file","path":"D:/maps/moved.png"}` relinks a moved source
  only after exact SHA256 verification, preserving the pixel graph/history.
  `{"type":"model-file","path":"D:/materials/model/boundary.manifest.json"}`
  likewise relinks identical resources; both manifest and model bytes must
  match. It cannot promote a pending model or substitute new weights.
* Last, after comparing the current result:
  `{"type":"review","georeference":true,"boundaries":true,"selectedIds":["line:0","face:1"]}`.
  Later edits invalidate review. Open/cropped faces cannot export. Never claim
  extraction of an unobserved model channel.

Inspect previews and resulting geometry after revisions. Export only after
review. Check `complete.json` and all artifact hashes. Provide clickable links
to `features.geojson`, `preview.png`, `analysis.json`, `report.md` and describe
uncertainty. Failed/cancelled jobs cannot export. Pando uses its ordinary
**generic object** import, then edit, Undo/Redo, save/reopen. Do not add an app
bridge or a dedicated analysis review UI.

Publish/check completed evidence with the workspace's scoped report commands.
Keep originals, final jobs/history and designated evidence. Clean temporary
tiles and verification copies. Do not prepare the entire app runtime cache.
