from __future__ import annotations

import gzip
import json
import re
import unittest
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
CANVAS = (ROOT / "assets" / "js" / "workers" / "canvas-render-worker.js").read_text(encoding="utf-8")
TERRAIN_MANIFEST = json.loads((ROOT / "assets" / "data" / "terrain" / "v0.12.6" / "manifest.json").read_text(encoding="utf-8"))
DATA = ROOT / "assets" / "data" / "hydro" / "v0.13.0"


def source_section(source: str, start: str, end: str) -> str:
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


class V0130RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
        cls.core = json.loads(gzip.decompress((DATA / cls.manifest["metadata"]["core"]["url"]).read_bytes()))["features"]
        cls.detail = json.loads(gzip.decompress((DATA / cls.manifest["metadata"]["detail"]["url"]).read_bytes()))["features"]

    def test_v0140_shell_and_v0130_assets_are_compatible(self):
        self.assertIn('data-app-version="0.25.0"', INDEX)
        self.assertIn("v0.25.0", APP[:200])
        self.assertIn("HYDRO_DATA_VERSION = '0.13.0'", APP)
        self.assertEqual(self.manifest["version"], "0.13.0")
        self.assertEqual(self.manifest["schema"], "atlaswright-water-shards-v5")
        self.assertEqual(self.manifest["format"]["metadata"], 5)
        self.assertEqual(self.manifest["metadata"]["featureCount"], len(self.core))
        self.assertEqual(len(self.core), len(self.detail))
        self.assertLess(self.manifest["stats"]["compressedBytes"], 48 * 1024 * 1024)
        self.assertTrue(all(row["bytes"] <= 4 * 1024 * 1024 for row in self.manifest["shards"]))

    def test_terrain_folder_and_automatic_water_colour(self):
        self.assertIn('data-layer-group="terrain"', INDEX)
        self.assertLess(INDEX.index('data-layer-group="countries"'), INDEX.index('data-layer-group="terrain"'))
        self.assertLess(INDEX.index('data-layer-group="terrain"'), INDEX.index('data-layer-group="drawings"'))
        for element_id in ("terrainVisible", "terrainPoliticalRadio", "terrainPhysicalRadio", "terrainStrengthControl"):
            self.assertIn(f'id="{element_id}"', INDEX)
        for removed_id in ("terrainStyleSelect", "riverColorSelect", "lakeColorSelect"):
            self.assertNotIn(f'id="{removed_id}"', INDEX)
        self.assertIn("automaticWaterColor", APP)
        self.assertIn("automaticWaterColor", CANVAS)
        self.assertNotIn("riverColor:", APP)
        self.assertNotIn("lakeColor:", APP)
        self.assertEqual(TERRAIN_MANIFEST["displayColors"]["oceanRepresentative"].lower(), "#6aa8d2")

    def test_ui_type_camera_and_country_selection_fill(self):
        for token in (
            "--ui-font-caption: 13px",
            "--ui-font-body: 15px",
            "--ui-font-title: 18px",
        ):
            self.assertIn(token, CSS)
        self.assertIn(".country-highlight-fill.selected", CSS)
        self.assertIn("path.country-highlight-fill", APP)
        self.assertIn("feature => path(feature)", APP)
        annex_entry = source_section(APP, "function enterAnnexTerritoryMode", "function toggleAnnexDonor")
        annex_donor = source_section(APP, "function toggleAnnexDonor", "function enterCountryCoastEdit")
        self.assertNotIn("focusCountry(", annex_entry)
        self.assertNotIn("focusCountry(", annex_donor)

    def test_pointer_focus_layer_folders_and_water_labels_are_simplified(self):
        self.assertIn("html.keyboard-navigation", CSS)
        self.assertIn("document.addEventListener('pointerdown', disableKeyboardNavigation", APP)
        self.assertRegex(CSS, r"\.layer-folder\s*\{[^}]*border:\s*0;")
        self.assertNotIn("label: '강 · Hydro'", APP)
        self.assertNotIn("label: '호수 · Natural Earth'", APP)
        self.assertIn("label: '강', shortLabel: '강', sourceLabel: 'HydroRIVERS'", APP)
        self.assertIn("label: '호수', shortLabel: '호수', sourceLabel: 'Natural Earth'", APP)

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

        self.assertEqual(sum(count_coordinates(row["geometry"]["coordinates"]) for row in countries["features"]), 548_466)


if __name__ == "__main__":
    unittest.main()
