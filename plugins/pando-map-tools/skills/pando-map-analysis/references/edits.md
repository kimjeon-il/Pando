# Structured revisions

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

