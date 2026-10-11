from __future__ import annotations
from tests.application_source import read_application_sources, read_module, function_source

import gzip
import json
import re
import struct
import unittest
from pathlib import Path

from shapely.geometry import shape


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
RENDERING = (ROOT / "assets" / "js" / "modules" / "rendering-domain.js").read_text(encoding="utf-8")
RENDERER = (ROOT / "assets" / "js" / "modules" / "gpu-map-renderer.js").read_text(encoding="utf-8")
CANVAS = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")
CORE = (ROOT / "assets" / "js" / "workers" / "gpu-mesh-core.js").read_text(encoding="utf-8")
LOADER = (ROOT / "assets" / "js" / "workers" / "data-loader-worker.js").read_text(encoding="utf-8")
STORED_ASSETS = read_module(ROOT, "stored-asset-loader.js")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
COMMITS = read_module(ROOT, "app-country-commits.js")
PREVIEW = read_module(ROOT, "app-geometry-preview.js")
CODEC = read_module(ROOT, "country-mesh-codec.js")
TERRAIN = read_module(ROOT, "gpu-terrain-preparation.js")
BASE_PASS = read_module(ROOT, "gpu-base-scene-pass.js")


def section(source: str, start: str, end: str) -> str:
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


class V0126RuntimeTests(unittest.TestCase):
    def test_annex_render_succeeds_before_history_commit(self):
        annex = function_source(COMMITS, "prepareAnnexSelectionPreview")
        self.assertIn("dependencies.geometryOperations.beginWorkerGeometryPreview", annex)
        self.assertIn("invalidateTerritorialPatch?.('territory-annex-committed');", annex)
        preview = PREVIEW[PREVIEW.index("async function beginWorkerGeometryPreview"):]
        self.assertLess(preview.index("await applyResult(result);"), preview.index("mapEditClient.commit(requestId);"))
        self.assertLess(preview.index("mapEditClient.commit(requestId);"), preview.index("commitHistorySnapshot(snapshot);"))
        labels = RENDERING
        self.assertLess(labels.index("selection.exit().remove();"), labels.index("enter.append('text').attr('class', 'country-label')"))
        self.assertIn("Array.isArray(anchor)", labels)

    def test_notifications_do_not_append_raw_internal_messages(self):
        self.assertNotRegex(APP, r"setActionStatus\([^\n]*(?:error|message)\.message")
        self.assertIn("reportOperationError", APP)
        self.assertIn("오류 코드 PL-RUNTIME-001", APP)

    def test_polar_closure_edges_are_excluded_from_all_stroke_paths(self):
        self.assertIn("MESH_ALGORITHM_REVISION = 3", CORE)
        self.assertIn("expected.length === headerWords", LOADER)
        self.assertIn("expected.every((value, index) => header[index] === value)", LOADER)
        self.assertIn("header[7] !== 3", CODEC)
        self.assertIn("decodeCountryMesh", RENDERER)
        self.assertIn("isArtificialPolarClosureEdge(a, b)", CORE)
        self.assertIn("countryOutlineFeature(feature)", RENDERER)
        self.assertIn("countryOutlineFeature(feature)", CANVAS)

        raw = gzip.decompress((ROOT / "assets" / "data" / "world-mesh-v0.12.6.bin.gz").read_bytes())
        magic, mesh_format, _countries, vertex_count, triangle_count, line_count, source_count, revision = struct.unpack_from("<8I", raw, 0)
        self.assertEqual(magic, 0x434D4731)
        self.assertEqual(mesh_format, 2)
        self.assertEqual((source_count, revision), (548454, 3))
        header_bytes = 48 if mesh_format >= 2 else 32
        positions = struct.unpack_from(f"<{vertex_count * 2}i", raw, header_bytes)
        country_bytes = vertex_count * 2
        offset = header_bytes + vertex_count * 8 + ((country_bytes + 3) & ~3) + triangle_count * 4
        lines = struct.unpack_from(f"<{line_count}I", raw, offset)
        for left, right in zip(lines[::2], lines[1::2]):
            a = (positions[left * 2] / 1e6, positions[left * 2 + 1] / 1e6)
            b = (positions[right * 2] / 1e6, positions[right * 2 + 1] / 1e6)
            self.assertFalse(abs(abs(a[1]) - 90) <= 1e-7 or abs(abs(b[1]) - 90) <= 1e-7)
            self.assertFalse(abs(abs(a[0]) - 180) <= 1e-7 and abs(abs(b[0]) - 180) <= 1e-7)
            self.assertLessEqual(abs(a[0] - b[0]), 180)

    def test_egypt_country_geometry_has_no_self_intersecting_border_gap(self):
        countries = json.loads((ROOT / "assets" / "data" / "countries-ne-5.1.1.geojson").read_text(encoding="utf-8"))
        egypt = next(feature for feature in countries["features"] if feature["id"] == "EGY")
        self.assertTrue(shape(egypt["geometry"]).is_valid)
        main_ring = egypt["geometry"]["coordinates"][0][0]
        self.assertNotIn([35.429207, 22.97833], main_ring)

    def test_world_assets_use_stable_content_cache_without_app_version(self):
        self.assertIn("const MANIFEST_URL = versionedDataUrl('../../data/world/current.json')", LOADER)
        self.assertIn("cachePolicy: 'immutable'", LOADER)
        self.assertIn("worldAssetUrl(spec, worldDataRoot)", LOADER)
        self.assertIn("const IMMUTABLE_WORLD_CACHE_NAME = 'pandolab-world-content-v1'", STORED_ASSETS)
        self.assertIn("const DATA_CACHE_NAME = DATA_CACHE_PREFIX + dataRevision", STORED_ASSETS)
        self.assertIn("const DATA_CACHE_PREFIX = 'pandolab-data-'", STORED_ASSETS)
        self.assertNotIn("const DATA_CACHE_PREFIX", LOADER)

    def test_land_only_relief_and_automatic_water_colours(self):
        manifest = json.loads((ROOT / "assets" / "data" / "terrain" / "v0.12.6" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "0.12.6")
        self.assertIn("drainage-free", manifest["channels"]["rgb"])
        self.assertIn("HYP_HR_SR.tif", {row["file"] for row in manifest["sources"]})
        self.assertIn("stencil: true", RENDERER)
        self.assertIn("gl.stencilFunc(gl.EQUAL, 1", BASE_PASS)
        self.assertIn("style === 'political'", CANVAS)
        self.assertEqual(manifest["displayColors"]["oceanRepresentative"].lower(), "#6aa8d2")
        for element_id in ("riverColorSelect", "lakeColorSelect"):
            self.assertNotIn(f'id="{element_id}"', INDEX)
            self.assertNotIn(element_id, APP + RENDERER)
        self.assertIn("automaticWaterColor", APP)
        self.assertIn("automaticWaterColor", CANVAS)

    def test_terrain_quality_uses_progressive_levels_and_transient_retry(self):
        level = function_source(TERRAIN, "terrainLevelForView")
        self.assertIn("physicalScale / frameDpr", level)
        self.assertIn("sourceDpr", level)
        self.assertNotIn("meshQuality", level)
        self.assertNotIn("dataReadiness", level)
        self.assertIn("terrainFetchQueue", TERRAIN)
        self.assertIn("terrainTileFailures", TERRAIN)
        self.assertIn("terrainRenderedLevel", TERRAIN)
        self.assertIn("terrainLevelForView(projection, message.terrainDpr || dpr)", CANVAS)
        self.assertIn("terrainFetchQueue", CANVAS)
        self.assertIn("terrainFailures", CANVAS)
        self.assertIn("attempts <= 3", TERRAIN)
        self.assertIn("attempts <= 3", CANVAS)


if __name__ == "__main__":
    unittest.main()
