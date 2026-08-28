import gzip
import hashlib
import json
import unittest
from pathlib import Path

from shapely.geometry import shape


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
COUNTRY_GEOMETRY = (ROOT / "assets/js/modules/country-geometry.js").read_text(encoding="utf-8")
COUNTRIES = json.loads((ROOT / "assets/data/countries-ne-5.1.1.geojson").read_text(encoding="utf-8"))
PREVIEW_COUNTRIES = json.loads(gzip.decompress((ROOT / "assets/data/countries-preview-v0.30.0.geojson.gz").read_bytes()))


def polygons(geometry):
    return [geometry.get("coordinates", [])] if geometry.get("type") == "Polygon" else geometry.get("coordinates", [])


def ring_area(ring):
    return sum(
        ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
        for index in range(len(ring) - 1)
    ) / 2


class BorneoGeometryRegressionTests(unittest.TestCase):
    def assert_collection_is_canonical(self, collection):
        self.assertEqual(len(collection["features"]), 258)
        duplicate_hits = []
        for feature in collection["features"]:
            geometry = feature.get("geometry") or {}
            feature_id = feature["properties"].get("editor_id")
            self.assertIn(geometry.get("type"), {"Polygon", "MultiPolygon"}, feature_id)
            self.assertTrue(shape(geometry).is_valid, feature_id)
            for polygon_index, polygon in enumerate(polygons(geometry)):
                self.assertTrue(polygon, (feature_id, polygon_index))
                for ring_index, ring in enumerate(polygon):
                    self.assertGreaterEqual(len(ring), 4, (feature_id, polygon_index, ring_index))
                    self.assertEqual(ring[0], ring[-1], (feature_id, polygon_index, ring_index))
                    self.assertGreaterEqual(len({tuple(point) for point in ring[:-1]}), 3, (feature_id, polygon_index, ring_index))
                    area = ring_area(ring)
                    self.assertGreater(abs(area), 1e-14, (feature_id, polygon_index, ring_index))
                    self.assertEqual(area < 0, ring_index == 0, (feature_id, polygon_index, ring_index))
                    for vertex_index in range(1, len(ring)):
                        if ring[vertex_index - 1] == ring[vertex_index]:
                            duplicate_hits.append((feature_id, polygon_index, ring_index, ring[vertex_index]))
        self.assertEqual(duplicate_hits, [])

    def test_canonical_and_preview_country_assets_are_strictly_valid(self):
        self.assert_collection_is_canonical(COUNTRIES)
        self.assert_collection_is_canonical(PREVIEW_COUNTRIES)

    def test_egypt_canonical_geometry_is_unchanged(self):
        egypt = next(feature for feature in COUNTRIES["features"] if feature["properties"].get("editor_id") == "EGY")
        encoded = json.dumps(egypt["geometry"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.assertEqual(hashlib.sha256(encoded).hexdigest(), "513e81cd5b16c86d59e048f90ee4c51d3a114f50a357cdb5e4ffd1aad7a33576")
        self.assertNotIn([35.429207, 22.97833], egypt["geometry"]["coordinates"][0][0])

    def test_borneo_shared_coordinate_is_not_consecutively_duplicated(self):
        target = [117.703608, 4.163415]
        for feature in COUNTRIES["features"]:
            if feature["properties"].get("editor_id") not in {"IDN", "MYS"}:
                continue
            for polygon in polygons(feature["geometry"]):
                for ring in polygon:
                    self.assertFalse(any(left == target and right == target for left, right in zip(ring, ring[1:])))

    def test_runtime_normalizer_removes_consecutive_duplicates(self):
        self.assertIn("!coordinatesNear(ring[ring.length - 1], coordinate)", COUNTRY_GEOMETRY)
        self.assertIn("ring[ring.length - 1] = ring[0].slice()", COUNTRY_GEOMETRY)

    def test_coast_edit_only_blocks_new_structured_issues(self):
        self.assertIn("structuredValidationBaseline = new Set", APP)
        self.assertIn("!structuredValidationBaseline.has(structuredGeometryIssueKey(issue))", APP)


if __name__ == "__main__":
    unittest.main()
