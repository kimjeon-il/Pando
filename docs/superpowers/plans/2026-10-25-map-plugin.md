# Independent reference-map plugin

Approved spec: the user's 2026-10-25 migration plan in this conversation.

## Task 1: independent runtime
Reuse work/ui. Add Node CLI analyze/revise/export, Pillow/PyMuPDF raster adapter,
local Tesseract Node workers, existing core loader and ORT WASM. Reuse canonical
layout, OCR normalization, place matching, graph and numerical algorithms.
No QGIS, browser, daemon, MCP server, new environment or full data preparation.
Verify resource hashes and preserve unvalidated model status.

## Task 2: review and export
Persist one signed job snapshot with immutable source identity, original pixel
graph, structured revisions, georeferencing diagnostics and provenance. Reuse
segmentation when only mapping changes. Reject cancelled, failed, stale and
unreviewed exports. Emit standard WGS84 GeoJSON, preview, analysis and report.
Exercise real OCR/inference and manual correction, not only mocks.

## Task 3: existing import workflow
Verify generic import, edit, atomic Undo/Redo and save/reopen with real plugin
output. Cover holes, islands, lines, shared edges and dateline. Verify Windows
and Android landscape. No dedicated analysis import surface.

## Task 4: cutover
Only after Task 3 passes, preserve active source/calibration assets with the
existing export API, move remaining canonical analysis owners into the plugin,
and delete app reference-image UI, state, persistence, workers and assets.
Reject obsolete persisted fields explicitly. Preserve user projects/originals.

## Completion
Focused tests and one fresh review; no application main merge/deployment.
Publish only completed task evidence scopes using existing report tools.
Clean task-owned temporary data, report measured storage changes and unrun gates.
