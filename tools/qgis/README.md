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
node tools/qgis/native-bridge.mjs project
node tools/qgis/native-bridge.mjs active-layer
node tools/qgis/native-bridge.mjs active-layer --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs transform --source-crs EPSG:4326 --target-crs EPSG:3857 --points '[[127,37]]'
node tools/qgis/native-bridge.mjs layers --offset 0 --limit 50
node tools/qgis/native-bridge.mjs algorithms --search buffer --offset 0 --limit 50
node tools/qgis/native-bridge.mjs buffer --layer QGIS_LAYER_ID --distance 50 --output 'D:/path/to/new-buffer.geojson'
node tools/qgis/native-bridge.mjs clip --layer QGIS_LAYER_ID --overlay POLYGON_LAYER_ID --output 'D:/path/to/new-clip.geojson'
node tools/qgis/native-bridge.mjs schema --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs set-visibility --layer QGIS_LAYER_ID --visible false
node tools/qgis/native-bridge.mjs remove-layer --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs features --layer QGIS_LAYER_ID --offset 0 --limit 10 --geometry
node tools/qgis/native-bridge.mjs select --layer QGIS_LAYER_ID --fids '["1","2"]'
node tools/qgis/native-bridge.mjs select --layer QGIS_LAYER_ID --expression '"name" = ''map'''
node tools/qgis/native-bridge.mjs selection --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs clear-selection --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs begin-edit --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs add-field --layer QGIS_LAYER_ID --field label --field-type string
node tools/qgis/native-bridge.mjs rename-field --layer QGIS_LAYER_ID --field label --new-field new_label
node tools/qgis/native-bridge.mjs delete-field --layer QGIS_LAYER_ID --field label
node tools/qgis/native-bridge.mjs set-attribute --layer QGIS_LAYER_ID --fid 1 --field name --json '"새 이름"'
node tools/qgis/native-bridge.mjs set-geometry --layer QGIS_LAYER_ID --fid 1 --wkt 'POINT (127 37)'
node tools/qgis/native-bridge.mjs delete-feature --layer QGIS_LAYER_ID --fid 1
node tools/qgis/native-bridge.mjs add-feature --layer QGIS_LAYER_ID --wkt 'POINT (127 37)' --json '{"name":"새 피처"}'
node tools/qgis/native-bridge.mjs undo-edit --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs redo-edit --layer QGIS_LAYER_ID
# Choose one ending for the session:
node tools/qgis/native-bridge.mjs rollback-edit --layer QGIS_LAYER_ID
# node tools/qgis/native-bridge.mjs commit-edit --layer QGIS_LAYER_ID
node tools/qgis/native-bridge.mjs open 'D:/path/to/pando-layer.geojson'
node tools/qgis/native-bridge.mjs open-raster 'D:/path/to/map.tif'
node tools/qgis/native-bridge.mjs raster-info --layer QGIS_RASTER_LAYER_ID
node tools/qgis/native-bridge.mjs raster-sample --layer QGIS_RASTER_LAYER_ID --x 10.5 --y 19.5 --band 1
node tools/qgis/native-bridge.mjs export --layer QGIS_LAYER_ID --output 'D:/path/to/qgis-result.geojson'
node tools/qgis/native-bridge.mjs normalize 'D:/path/to/qgis-export.geojson' --output 'D:/path/to/normalized.geojson'
```

Startup refuses an occupied port with an unexpected or unauthenticated service,
and never rewrites an existing unrelated profile. It reuses the configured
authenticated instance and refuses to start another while a different QGIS
process is running. QGIS executes operations on
its main thread; mixed-geometry GeoJSON opens without a sublayer dialog. The
native MCP server can be started separately with `node tools/qgis/native-mcp.mjs`;
it uses `PANDO_QGIS_NATIVE_CONFIG` when set, otherwise the default config above.
It exposes start, status, project, layer, field and feature inspection, selection, managed editing, open, export and normalize. It is not yet an MCP
replacement: the upstream editing and processing tools remain active until
their used capabilities have been migrated and tested.
Native selection accepts QGIS feature IDs as decimal strings, preserving signed
64-bit values, or a QGIS expression validated against the layer before use.
Coordinate transformation accepts one to 10,000 XY pairs, requires explicit
source and target CRSs, and refuses fallback datum transformations.
Clip requires an existing polygon overlay in the same CRS as its input. It
writes only a new EPSG:4326 GeoJSON and leaves both source layers unchanged.
Feature reads return a bounded page with exact JSON attributes, optional WKT in
the layer CRS and string QGIS FIDs. Filtered pages report `hasMore` without a
whole-layer filtered count.
Visibility reports both the layer's checked state and effective visibility;
a hidden parent group can keep a checked layer hidden.
Layer removal removes only the project layer, preserves its source file, and
refuses editable, modified or temporary layers to protect unsaved data.
Algorithm discovery lists providers currently registered in QGIS and does not
install missing providers. Buffer distances use the input layer's CRS units;
buffer output is normalized to EPSG:4326 and refuses an existing destination.
Raster sampling uses the raster layer's coordinate reference system and returns
`valid: false` and a null value for NoData or points outside its extent.
If an export or buffer request times out or loses its connection before QGIS replies, the
reported scratch directory is preserved because QGIS may still be writing it.
Attribute and geometry changes require an edit session started by the native bridge. An existing
QGIS edit session is not taken over. Changes stay in the QGIS edit buffer and
use its Undo history until an explicit commit or rollback; either action also
affects any other edits made to the same QGIS layer in that session. Commit
writes through the layer's provider, so it can change the underlying source.
Feature deletion has the same edit-session and undo/rollback boundary; it does
not write the provider until the session is explicitly committed.
Feature addition accepts a two-dimensional EPSG:4326 WKT and exact JSON object
of existing field names and values. It returns the QGIS edit-buffer FID as a
decimal string; providers may assign a different persistent FID at commit.
Field additions, renames and deletions use that same undoable edit session; available
types are string, integer, int64, double and boolean.
QGIS may change GeoPackage file bytes when an edit session starts or rolls back,
even when its features and schema are restored. Use a working copy when exact
original file bytes must remain unchanged.
Geometry edits use a valid two-dimensional EPSG:4326 WKT geometry of the
existing feature's type. QGIS transforms it into the layer's CRS before editing.
Attribute values are exact JSON text so integers are not rounded in transit;
unsupported type conversions are rejected. For a negative numeric CLI value,
use the equals form, for example `--json=-1`.

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
