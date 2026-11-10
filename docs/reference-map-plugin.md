# Map Toolkit and Pando shared tooling

Map Toolkit analysis, training, tests and private releases are owned by the
[private Map Toolkit repository](https://github.com/kimjeon-il/map-toolkit).
Its permanent local checkout is `D:/dev/Map Toolkit`. Pando does not contain
an analysis panel, OCR/model runtime, training environment or plugin release runner.

Pando 0.36.0 ships one read-only Web Viewer with a built-in, read-only inspector. The earlier separate Windows reviewer was retired; its E3 review records remain historical evidence. The current Viewer can open GeoPackage projects but does not expose general
GeoJSON object import, editing, Undo/Redo or project saving. Android native was
retired. The retained Core import/edit/persistence tests are regression-only
and do not establish that those UI features exist. Map Toolkit is used entirely
inside Codex and GPT for analysis, review and file export. The Pando web Viewer
only displays completed projects; plugin-specific import, editing and application
acceptance are outside its product scope. Unsupported retired reference-image attachments remain
explicitly rejected. Do not restore obsolete editor UI or compatibility readers
as a side effect of the plugin separation.

## Shared dependency contract

`tools/build/package-shared-toolkit.mjs REVISION NEW_ARCHIVE` packages reviewed
Pando source plus existing CI-produced WASM and Linux/Windows image/PDF/preview
artifacts. It checks source identities, native manifests and the compiled core.
It never compiles, installs an SDK, includes plugin code/model weights or
hydrates the entire library. Shared image and label primitives also serve
Pando terrain and hydro generation and must remain here.

The manifest pins interface version 1, Pando repository/commit, archive size/hash,
a complete file-inventory hash, required source identities and licenses.
`tools/data/shared-toolkit.mjs` validates paths, locks and every byte before use.
The consumer rejects changed files and unknown interfaces. Update the shared
artifact and the independent consumer pin deliberately; a moving branch is
not a runtime dependency.

Shared library/report helpers accept the independent `map-toolkit` report
owner in its configuration. Existing Pando owners, locks, data pins and central
report originals retain their ownership. No whole-library checkout is required.

## Automatic release on Codex completion

Completed Map Toolkit work follows its own AGENTS.md and existing guarded
private release runner, with focused checks, a pushed private source SHA and
exact archive read-back. Keep the same private personal plugin identity,
audience, display name and icon. Account IDs and authentication remain outside
Git. A Pando file save or push does not refresh the installed plugin.

This separation does not approve pending weights or historical accuracy.
Reports/evidence live in the external library under
`reports/development/integrations/map-toolkit-separation`. Native builds use
explicitly selected registered CI checks; no full-project validation,
application main integration or application deployment is implied.
