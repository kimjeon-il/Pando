# QGIS MCP integration implementation plan

**Goal:** Install QGIS MCP, configure Codex, and round-trip Pando geometry through
the existing GIS import/export owners without copying models or training data.

**Design:** Reuse upstream QGIS MCP0.15.2 at commit
dae432367fcb2873a151b94c4faaadef2033cf9f. Install only QGIS LTR native dependencies
once in D:/dev/tools/osgeo4w. Run MCP in the existing work/ui Python3.12 training
environment; pin its source at D:/dev/tools/qgis-mcp. Use authenticated loopback
and the upstream compound-tool mode. No custom MCP protocol or second GIS engine.

Pando exchanges RFC7946 GeoJSON via its existing export/import paths. A small
developer CLI starts the managed QGIS profile, opens layers through upstream MCP,
exports EPSG4326, and restores QGIS JSON-field serialization before reimport.
Existing Core generic.import owns IDs, state, geometry checks and atomic Undo.
No country/library ownership is inferred or modified by this bridge.

**Constraints:** Preserve unrelated work/ui changes and model/data pairings.
Reuse the existing runtime, report helpers and fixed dependency paths. No full
app rebuild, new model/venv, unrequested main integration, or whole-suite hook.
Native dependency peak budget8GiB plus5GiB reserve; D: free27.45GiB before setup.
Automatic review blocked the OSGeo4W unattended installer. User must execute
that step directly; do not retry it through another launcher or package manager.

- [x] Verify/install pinned MCP dependency and register only its Codex config.
- [x] Add failing bridge tests for CRS rejection, source preservation, output
  collision, failed QGIS execution and literal Unicode/quote-safe code inputs.
- [x] Implement tools/qgis/bridge.py and bootstrap.py; reuse upstream client.
- [x] Run real MCP initialization/list tools, authenticated QGIS ping/layer/export.
- [x] Verify existing Pando import geometry, new IDs, provenance, atomic Undo/Redo.
- [x] Record actual checks and remaining limits in external reports. Remove
  verified disposable downloads and report any blocked temporary cleanup.

Ruling: the user already selected QGIS MCP plus reuse of the existing Pando
owners. The first integration uses standard GeoJSON file exchange; no new live
remote-edit command channel or duplicate application state is necessary.

Ruling: the actual editor exposed an existing import-service bug that applied a
Polygon-only validator to generic lines. Filter Polygon/MultiPolygon at that
existing owner, matching the committer. The focused regression failed before the
fix and passes while retaining invalid Polygon rejection. No parallel importer.

Evidence: Python bridge 8 passed; import-service plus Core exchange 12 passed;
actual QGIS-output editor test passed, including import, source/coverage, atomic
Undo/Redo and production GIS export. Pando's export reopened in QGIS with two
features. MCP stdio initialization lists 27 tools and system/get_qgis_info returns
QGIS3.44.15. Existing torch2.14.1+cu126 and CUDA remain available; pip check passes.
The one final fresh-context review found a cold-start boolean-return bug, fixed
with a failing-then-passing regression; no unresolved findings remain. Actual
integration also exposed cp949 output and OGR QVariantMap source errors, fixed
and verified against the same real operations. No map-model promotion occurred.

Final direct Codex tools also passed system info, layer list, opening Pando's
production export, querying its two features and removing the test layer.
External report scope: reports/development/qgis-mcp-20261024. Report-only archive
does not change the runtime pin. Download cache/installer/help logs (409,886,215
logical bytes) were deleted by the user after automatic review blocked deletion;
all target paths were then confirmed absent. Native runtime stays for current
QGIS execution. Separate scoped cleanup of 30,679 bytes of verified exchange/pyc
temporaries was also blocked; do not bypass it, and report those remaining files.
