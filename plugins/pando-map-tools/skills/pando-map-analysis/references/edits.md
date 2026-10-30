# Structured revisions

Edits are JSON objects or an array. Version 0.6.0 uses job schema 3; analyze a
new job after upgrading instead of rewriting an older job's schema/signature.

* `{"type":"control-points","mode":"affine","points":[{"id":"p1","image":[0.1,0.2],"coordinate":[12,45]},...]}`.
  Image values are UVs of the full EXIF-oriented original, not the crop.
  Partial controls are saved as `needs-georeference`; similarity needs two,
  affine/TPS three and projective four points. TPS benefits from additional
  distributed points. The numerical core rejects degenerate fits. Mapping edits
  reproject the existing pixel graph without running inference.
  Omit `mode` or use `auto` to compare the existing transforms in original
  source pixels. TPS is selected automatically only with passing cross-validation;
  its near-zero training residual is not accuracy evidence. Inspect
  `quality.modelComparison`, coverage, folds and independent checks before review.
  Controls outside a selected crop cannot recommend that panel.
* `{"type":"projection","projection":{"kind":"lcc","ellipsoid":"GRS80","lon0":-95,"lat0":49,"lat1":49,"lat2":77}}`
  changes the typed map projection using the existing controls. This example is
  a parameter contract, not a default for an unknown map. Longitude/latitude
  parameters use degrees; projected coordinates use metres. Supported kinds
  are `geographic`, `eqc`, `merc`, `lcc`, `laea`, `aeqd`, `stere` and `robin`;
  unsupported ellipsoid/domain combinations fail explicitly. This revision
  reprojects the saved pixel graph without repeating OCR or inference and
  invalidates review. Fixed-projection recommendations need six distinct points;
  unknown-projection selection reserves six fit, six selection and six
  confirmation points. Read the returned diagnostics before review.
* `{"type":"boundary","command":{"type":"exclude","chainId":1}}`.
  The shared core also accepts `replace` with original-pixel `points`, `cut`
  with a pixel `point`, and `join` with `from`/`to` chainId and start/end.
  Unrelated chains retain their exact vertices, class, confidence and IDs.
  A replacement keeps its ID unless intersections split it. New/split/merged
  paths receive monotonically allocated IDs; retired IDs are never reused.
  Faces are rebuilt from the current shared vectors. Read the returned
  `changeSet` and current IDs before the next edit or selection; every edit
  invalidates the previous review. Chain changes are in `changeSet.created`,
  `removed` and `modified`; face changes are in `changeSet.faces`.
  A cut removes a three-source-pixel interval around the nearest path location:
  an open line leaves two paths, while a closed ring becomes one open path.
  Joining two free open endpoints merges the paths with a new ID; a junction
  connection retains the original branches and adds an explicit connector.
* `{"type":"boundary","command":{"type":"add","semanticBits":1,"points":[[660,280],[662,320]],"reason":"Source-reviewed missing border stroke"}}`
  adds a manually reviewed missing line in original pixels. Select exactly one
  class: 1 international, 2 administrative or 4 coast. A source-review reason
  is required. This is manual correction, not model recognition or confidence
  evidence. The shared core validates bounds and rebuilds junctions/faces;
  read its new IDs before refining or selecting. Do not move an unrelated line
  with `replace`: it intentionally preserves existing shared endpoints.
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

Before review, the job preview shows diagnostic candidates. After review,
the preview and export highlight only the selected lines and polygon rings,
including holes, with control points and applicable diagnostics. They resolve
the same current selection; a stale/missing ID fails visibly. Re-export may
generate new Feature UUIDs while preserving geometry, source and review.

