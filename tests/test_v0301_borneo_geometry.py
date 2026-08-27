import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
COUNTRY_GEOMETRY = (ROOT / "assets/js/modules/country-geometry.js").read_text(encoding="utf-8")
COUNTRIES = json.loads((ROOT / "assets/data/countries-ne-5.1.1.geojson").read_text(encoding="utf-8"))


class BorneoGeometryRegressionTests(unittest.TestCase):
    def test_known_borneo_duplicate_is_limited_to_indonesia_and_malaysia(self):
        duplicate_hits = []
        for feature in COUNTRIES["features"]:
            geometry = feature.get("geometry") or {}
            polygons = [geometry.get("coordinates", [])] if geometry.get("type") == "Polygon" else geometry.get("coordinates", [])
            for polygon_index, polygon in enumerate(polygons):
                for ring_index, ring in enumerate(polygon):
                    for vertex_index in range(1, len(ring)):
                        if ring[vertex_index - 1] == ring[vertex_index]:
                            duplicate_hits.append((feature["properties"].get("editor_id"), polygon_index, ring_index, ring[vertex_index]))

        self.assertEqual(duplicate_hits, [
            ("IDN", 0, 0, [117.703608, 4.163415]),
            ("MYS", 0, 0, [117.703608, 4.163415]),
        ])

    def test_runtime_normalizer_removes_consecutive_duplicates(self):
        self.assertIn("!coordinatesNear(ring[ring.length - 1], coordinate)", COUNTRY_GEOMETRY)
        self.assertIn("ring[ring.length - 1] = ring[0].slice()", COUNTRY_GEOMETRY)

    def test_coast_edit_only_blocks_new_structured_issues(self):
        self.assertIn("structuredValidationBaseline = new Set", APP)
        self.assertIn("!structuredValidationBaseline.has(structuredGeometryIssueKey(issue))", APP)


if __name__ == "__main__":
    unittest.main()
