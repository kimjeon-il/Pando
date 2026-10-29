# Pando / QGIS MCP

## Native bridge under migration

The native bridge has a separate configuration at `.library-data/qgis-native.json`
and does not replace the existing MCP connection below. Its JSON fields are
`host` (`127.0.0.1`), `port`, a private random `token`, `qgisRoot`,
`profilesRoot`, `profile`, and `artifactDirectory`. Use absolute Windows paths
and a dedicated profile; the verified plugin artifact must match this checkout's
source and QGIS 3.44.15 / Qt 5.15.13. Keep the token in the ignored config.

```powershell
node tools/qgis/native-bridge.mjs start
node tools/qgis/native-bridge.mjs status
node tools/qgis/native-bridge.mjs open 'D:/path/to/pando-layer.geojson'
node tools/qgis/native-bridge.mjs export --layer QGIS_LAYER_ID --output 'D:/path/to/qgis-result.geojson'
node tools/qgis/native-bridge.mjs normalize 'D:/path/to/qgis-export.geojson' --output 'D:/path/to/normalized.geojson'
```

Startup refuses an occupied port with an unexpected or unauthenticated service,
and never rewrites an existing unrelated profile. QGIS executes operations on
its main thread; mixed-geometry GeoJSON opens without a sublayer dialog. The
native MCP server can be started separately with `node tools/qgis/native-mcp.mjs`;
it uses `PANDO_QGIS_NATIVE_CONFIG` when set, otherwise the default config above.
It exposes only start, status, open, export and normalize. It is not yet an MCP
replacement: the upstream editing and processing tools remain active until
their used capabilities have been migrated and tested.

QGIS operations use upstream `nkarasiak/qgis-mcp` 0.15.2, commit
`dae432367fcb2873a151b94c4faaadef2033cf9f`. Native QGIS LTR lives once at
`D:/dev/tools/osgeo4w`; the upstream plugin source lives at
`D:/dev/tools/qgis-mcp`. MCP reuses `build-native/python/Scripts/python.exe`.
No model weights, GIS datasets, CUDA environment or app package is duplicated.
The installed native version is QGIS 3.44.15-Solothurn. The first Windows launch
can take several minutes while native libraries initialize; reuse that session.

Codex user config registers `qgis` with authenticated loopback and upstream
compound mode (27 tools). Local settings and token are in ignored
`.library-data/qgis.json`. New MCP configuration may require refreshing MCP
connections or reopening Codex before tools appear in an existing chat.

From this permanent work/ui checkout in PowerShell:

```powershell
$qgisPython = 'D:/dev/worktrees/ui/build-native/python/Scripts/python.exe'
& $qgisPython tools/qgis/bridge.py start
& $qgisPython tools/qgis/bridge.py status
& $qgisPython tools/qgis/bridge.py open 'D:/path/to/pando-layer.geojson'
& $qgisPython tools/qgis/bridge.py export --layer QGIS_LAYER_ID --output 'D:/path/to/qgis-result.geojson'
node tools/qgis/normalize.mjs 'D:/path/to/qgis-export.geojson' --output 'D:/path/to/normalized.geojson'
```

Use Pando's existing GIS export (GeoJSON bundle or GeoPackage), and open an
exported layer in QGIS. The `open` command returns QGIS's layer ID. Process/edit
through existing QGIS MCP tools. `export` writes GeoJSON explicitly in EPSG:4326,
checks source geometry in QGIS and restores the JSON source field serialized by
OGR, including QGIS QVariantMap fields, using the same Node normalization as the
standalone command. It refuses existing outputs. Its private intermediate export
is removed on success or failure. Input data is unchanged. The normalization
command only restores JSON fields/checks geographic coordinates; it never
reprojects. Wide integer IDs are preserved when reading and writing JSON.

Import the result through Pando's GIS import dialog as 기타 객체 (`generic`).
The existing importer preserves source IDs/attributes, creates fresh internal
IDs and applies the selected objects in one Core command with Undo/Redo. It does
not change country/library ownership. Reimport currently creates new objects;
there is no implicit live synchronization or in-place merge with existing IDs.

Existing reference-map tools remain canonical in `tools/reference-analysis/`.
Run them using the same Python and report helpers. QGIS MCP provides GIS
processing/review, not an automatic approval of pending boundary weights or
historical attribution. Original maps, models and reports stay in the external
library store. Do not install GeoAI/SAM or another model environment for this
integration without a concrete additional task.

Focused verification:

```powershell
& $qgisPython -m unittest discover -s tests/python -p test_qgis_bridge.py
node --test tests/unit/qgis-normalize.test.mjs tests/unit/qgis-pando-exchange.test.mjs
pnpm.cmd exec playwright test tests/browser/qgis-pando-exchange.spec.mjs
```

Set `PANDOLAB_QGIS_EXCHANGE_FILE` to an actual bridge export to run the editor
test against real QGIS output. The default synthetic fixture tests application
mechanics and makes no historical-map accuracy claim.
Set `PANDOLAB_QGIS_PANDO_EXPORT` to a new output path to retain the production
GeoJSON layer exported by the editor test for reopening in QGIS. Existing paths
are refused. The test verifies geometry, provenance, new IDs, one Undo/Redo and
the production GIS export. The installed QGIS and actual-output editor round
trip were verified on 2026-10-24; GeoPackage attribute round trips were not tested.
