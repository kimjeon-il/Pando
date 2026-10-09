from __future__ import annotations
from tests.application_source import read_application_sources, read_ui_sources, read_module, function_source, assert_shell_versions

import gzip
import json
import re
import unittest
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).parents[1]
LAYER_MODEL = (ROOT / "assets/js/modules/layer-list-model.js").read_text(encoding="utf-8")
LAYER_CONTROLLER = (ROOT / "assets/js/modules/layer-tree-controller.js").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
CANVAS = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")
GPU = (ROOT / "assets" / "js" / "modules" / "gpu-map-renderer.js").read_text(encoding="utf-8")
RENDERING = read_module(ROOT, "rendering-domain.js")
COUNTRY_MODES = read_module(ROOT, "app-country-modes.js")
TERRAIN_MANIFEST = json.loads((ROOT / "assets" / "data" / "terrain" / "v0.12.6" / "manifest.json").read_text(encoding="utf-8"))
DATA = ROOT / "assets" / "data" / "hydro" / "v0.13.2"

def read_resource(spec):
    source = (DATA / spec["url"]).read_bytes()
    if "offset" in spec:
        start = int(spec["offset"])
        source = source[start:start + int(spec["bytes"])]
    assert len(source) == spec["bytes"]
    return source


def source_section(source: str, start: str, end: str) -> str:
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


class V0131RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
        cls.core = json.loads(gzip.decompress(read_resource(cls.manifest["metadata"]["core"])))["features"]
        cls.detail = json.loads(gzip.decompress(read_resource(cls.manifest["metadata"]["detail"])))["features"]

    def test_current_shell_and_v0131_assets_are_compatible(self):
        assert_shell_versions(self, ROOT, INDEX)
        self.assertIn("HYDRO_DATA_VERSION = '0.13.2'", APP)
        self.assertEqual(self.manifest["version"], "0.13.2")
        self.assertEqual(self.manifest["schema"], "pandolab-water-shards-v5")
        self.assertEqual(self.manifest["format"]["metadata"], 5)
        self.assertEqual(self.manifest["metadata"]["featureCount"], len(self.core))
        self.assertEqual(len(self.core), len(self.detail))
        self.assertLess(self.manifest["stats"]["compressedBytes"], 48 * 1024 * 1024)
        self.assertTrue(all(row["bytes"] <= 4 * 1024 * 1024 for row in self.manifest["shards"]))

    def test_terrain_toggle_settings_and_automatic_water_colour(self):
        self.assertNotIn('data-layer-group="terrain"', INDEX)
        self.assertIn('id="terrainDisplayOptions" class="terrain-display-options map-display-details"', INDEX)
        self.assertNotIn('id="terrainLayerSettingsTitle">지형</strong>', INDEX)
        self.assertNotIn('class="layer-style-editor terrain-settings"', INDEX)
        self.assertLess(INDEX.index('id="labelsVisible"'), INDEX.index('id="terrainNoneRadio"'))
        self.assertLess(INDEX.index('id="terrainNoneRadio"'), INDEX.index('id="distributionViewSettings"'))
        self.assertIn('<span>없음</span>', INDEX)
        self.assertIn('<span>흑백</span>', INDEX)
        self.assertIn('<span>색채</span>', INDEX)
        self.assertNotIn('국가색과 결합', INDEX)
        self.assertNotIn('지형색 강조', INDEX)
        self.assertNotIn('음영 강도', INDEX)
        for element_id in ("terrainNoneRadio", "terrainPoliticalRadio", "terrainPhysicalRadio"):
            self.assertIn(f'id="{element_id}"', INDEX)
        for removed_id in ("terrainStyleSelect", "terrainStrengthControl", "terrainStrengthInput", "riverColorSelect", "lakeColorSelect"):
            self.assertNotIn(f'id="{removed_id}"', INDEX)
        self.assertIn("automaticWaterColor", APP)
        self.assertIn("automaticWaterColor", CANVAS)
        self.assertNotIn("riverColor:", APP)
        self.assertNotIn("lakeColor:", APP)
        self.assertEqual(TERRAIN_MANIFEST["displayColors"]["oceanRepresentative"].lower(), "#6aa8d2")

    def test_ui_type_camera_and_country_selection_fill(self):
        for token in (
            "--ui-font-caption: var(--design-font-sm)",
            "--ui-font-body: var(--design-font-md)",
            "--ui-font-title: var(--design-font-xl)",
        ):
            self.assertIn(token, CSS)
        self.assertIn(".map-selection-outline", CSS)
        self.assertIn("syncSelectionEmphasis", RENDERING)
        self.assertIn("countryEmphasis", GPU)
        self.assertNotIn("path.country-highlight-fill", RENDERING)
        self.assertIn("gpuMapRenderer.setCountryEmphasis", RENDERING)
        self.assertIn("selection.syncGpuInteractionState", RENDERING)
        annex_entry = function_source(COUNTRY_MODES, "enterAnnexTerritoryMode")
        annex_donor = function_source(COUNTRY_MODES, "prepareAnnexSelection")
        self.assertNotIn("fitMapToFeature(", annex_entry)
        self.assertNotIn("fitMapToFeature(", annex_donor)

    def test_pointer_focus_layer_folders_and_water_labels_are_simplified(self):
        self.assertIn("html.keyboard-navigation", CSS)
        self.assertIn("document.addEventListener('pointerdown', disableKeyboardNavigation", APP)
        self.assertNotIn('class="layer-folder"', INDEX)
        self.assertNotIn("label: '강 · Hydro'", APP)
        self.assertNotIn("label: '호수 · Natural Earth'", APP)
        self.assertIn("label: '강', shortLabel: '강', sourceLabel: 'HydroRIVERS'", APP)
        self.assertIn("label: '호수', shortLabel: '호수', sourceLabel: 'Natural Earth'", APP)
        self.assertNotIn("HYDRO_FOLDER_STATE_PREFIX", APP)
        self.assertIn("name: '지형지물'", LAYER_MODEL)
        self.assertIn("hydroCategory === 'lake' ? '호수' : '강'", LAYER_MODEL)
        self.assertIn("name: meta.sourceLabel", APP)
        self.assertIn("layerGroup === 'hydro') bundles[1].items.push(item)", LAYER_MODEL)

    def test_hydro_uses_the_current_ocean_colour_without_intrinsic_alpha(self):
        lake_rule = source_section(CSS, ".hydro-lake-group {", "}")
        river_rule = source_section(CSS, ".hydro-river-group {", "}")
        self.assertIn("fill: var(--map-ocean)", lake_rule)
        self.assertIn("stroke: var(--map-ocean)", lake_rule)
        self.assertIn("fill-opacity: 1", lake_rule)
        self.assertIn("stroke: var(--map-ocean)", river_rule)
        self.assertIn("stroke-opacity: 1", river_rule)
        self.assertNotIn(".hydro-lake-group { fill: #376f91", CSS)
        self.assertNotIn(".hydro-river-group { stroke: #66b5e5", CSS)
        self.assertIn(".style('fill-opacity', lakeStyle.opacity)", RENDERING)
        self.assertIn(".style('stroke-opacity', lakeStyle.boundaryVisible ? lakeStyle.opacity : 0)", RENDERING)
        self.assertIn(".style('stroke-opacity', riverStyle.opacity)", RENDERING)

    def test_hydro_fragments_share_system_identity_and_roles(self):
        rivers = [row for row in self.core if row["category"] == "river"]
        systems = defaultdict(list)
        for row in rivers:
            self.assertEqual(row["awId"], f"hydro-system:{row['systemId']}")
            self.assertIn(row["role"], {"mainstem", "tributary"})
            self.assertEqual(row["mainstemNameKo"], row["name"])
            systems[row["systemId"]].append(row)
        self.assertEqual(len(systems), self.manifest["stats"]["riverSystemCount"])
        self.assertTrue(any({row["role"] for row in rows} == {"mainstem", "tributary"} for rows in systems.values()))
        self.assertLess(self.manifest["stats"]["riverSystemCount"], 8342)

    def test_korean_hydronyms_and_reviewed_danube_name(self):
        river_names = {row["name"] for row in self.core if row["category"] == "river"}
        lake_names = {row["name"] for row in self.core if row["category"] == "lake"}
        self.assertIn("도나우강", river_names)
        self.assertNotIn("다뉴브강", river_names)
        bad_suffix_spacing = re.compile(r"\s+(강|천|호|호수)$")
        self.assertFalse([name for name in river_names | lake_names if bad_suffix_spacing.search(name)])
        self.assertGreater(self.manifest["stats"]["namedRiverSystemCount"], 0)
        self.assertIn("미명명 수계", " ".join(river_names))
        oder_system_names = {
            row["systemId"]: row["name"]
            for row in self.core
            if row["category"] == "river" and row["systemId"] in {"20282220", "20282318", "20323928"}
        }
        self.assertEqual(oder_system_names["20282220"], "엘베강")
        self.assertEqual(oder_system_names["20282318"], "오데르강")
        self.assertEqual(oder_system_names["20323928"], "라인강")
        for name in ("욀뷔사우강", "코케매에니오키강", "퀴미요키강", "나르바강", "노르스트룀강", "시엔셀바강"):
            self.assertIn(name, river_names)

    def test_v0132_packages_all_six_resources_inside_one_binary(self):
        self.assertEqual(self.manifest["container"]["url"], "hydro.bin")
        self.assertEqual(self.manifest["container"]["format"], "byte-concatenated-subresources-v1")
        resources = [self.manifest["index"], self.manifest["metadata"]["core"],
                     self.manifest["metadata"]["detail"], *self.manifest["shards"]]
        end = 0
        for resource in resources:
            self.assertEqual(resource["offset"], end)
            self.assertEqual(resource["url"], "hydro.bin")
            end += resource["bytes"]
        self.assertEqual(end, self.manifest["container"]["bytes"])
        self.assertEqual((DATA / "hydro.bin").stat().st_size, end)

    def test_osm_provenance_and_segment_border_alignment_are_recorded(self):
        self.assertIn("OpenStreetMap contributors", README)
        self.assertIn("ODbL", README)
        self.assertIn("osmWaterways", self.manifest["sources"])
        self.assertEqual(self.manifest["selection"]["borderAlignment"]["revision"], 2)
        self.assertGreater(self.manifest["stats"]["borderAlignedLengthKm"], 40_000)
        self.assertGreater(self.manifest["stats"]["borderChangedCoordinateCount"], 0)
        self.assertGreater(self.manifest["stats"]["osmWaterwayMatchCount"], 0)

    def test_country_source_geometry_has_expected_shape(self):
        countries = json.loads((ROOT / "assets" / "data" / "countries-ne-5.1.1.geojson").read_text(encoding="utf-8"))
        self.assertEqual(len(countries["features"]), 258)

        def count_coordinates(value):
            if not isinstance(value, list):
                return 0
            if value and isinstance(value[0], (int, float)):
                return 1
            return sum(count_coordinates(item) for item in value)

        preview = json.loads((ROOT / "assets/data/world/current.json").read_text(encoding="utf-8"))
        expected_source_count = preview["assets"]["canonicalMesh"]["header"][6]
        self.assertEqual(sum(count_coordinates(row["geometry"]["coordinates"]) for row in countries["features"]), expected_source_count)


if __name__ == "__main__":
    unittest.main()
