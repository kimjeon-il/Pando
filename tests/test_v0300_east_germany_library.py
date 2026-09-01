from __future__ import annotations

import json
import unittest
from pathlib import Path

from pyproj import Geod, Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform, unary_union


ROOT = Path(__file__).parents[1]
PILOT_PATH = ROOT / "assets" / "data" / "historical-library-pilot.json"
COUNTRIES_PATH = ROOT / "assets" / "data" / "countries-ne-5.1.1.geojson"
PILOT = json.loads(PILOT_PATH.read_text(encoding="utf-8"))
COUNTRIES = json.loads(COUNTRIES_PATH.read_text(encoding="utf-8"))
ENTITY = next(item for item in PILOT["entities"] if item["libraryId"] == "historical-country:east-germany")
GEOMETRY = shape(ENTITY["geometryVersions"][0]["geometry"])
CANONICAL_DEU = shape(next(
    item["geometry"] for item in COUNTRIES["features"] if item["id"] == "DEU"
))
TO_EQUAL_AREA = Transformer.from_crs(4326, 3035, always_xy=True).transform


def projected_area_km2(geometry):
    return abs(transform(TO_EQUAL_AREA, geometry).area) / 1_000_000


class EastGermanyHistoricalLibraryTests(unittest.TestCase):
    def test_identity_dates_aliases_and_instantiation_policy(self):
        self.assertEqual(ENTITY["canonicalName"], "German Democratic Republic")
        self.assertEqual(ENTITY["displayNames"]["ko"], "독일 민주 공화국")
        self.assertEqual(ENTITY["displayNames"]["de"], "Deutsche Demokratische Republik")
        self.assertEqual(set(ENTITY["alternateNames"]), {"동독", "East Germany", "DDR", "GDR"})
        self.assertEqual(ENTITY["startDate"], "1949-10-07")
        self.assertEqual(ENTITY["endDate"], "1990-10-02")
        self.assertEqual(ENTITY["metadata"]["dissolutionDate"], "1990-10-03")
        self.assertEqual(ENTITY["metadata"]["referenceDate"], "1989-04-25")
        self.assertEqual(ENTITY["instantiation"], {
            "mode": "country-territory-priority",
            "countryUpdates": {"DEU": {"name": "독일 연방공화국"}},
        })

    def test_geometry_is_valid_bounded_and_inside_canonical_germany(self):
        self.assertEqual(GEOMETRY.geom_type, "MultiPolygon")
        self.assertTrue(GEOMETRY.is_valid)
        area, _ = Geod(ellps="WGS84").geometry_area_perimeter(GEOMETRY)
        self.assertGreaterEqual(abs(area) / 1_000_000, 108_000)
        self.assertLessEqual(abs(area) / 1_000_000, 109_000)
        self.assertLessEqual(projected_area_km2(GEOMETRY.difference(CANONICAL_DEU)), 1e-6)
        self.assertLess(PILOT_PATH.stat().st_size, 2 * 1024 * 1024)

    def test_reference_points_and_west_berlin_exclusion(self):
        inside = {
            "Rostock": (12.0991, 54.0924),
            "Potsdam": (13.0645, 52.3906),
            "Magdeburg": (11.6276, 52.1205),
            "Leipzig": (12.3731, 51.3397),
            "Dresden": (13.7373, 51.0504),
            "Erfurt": (11.0299, 50.9848),
            "Alexanderplatz": (13.4132, 52.5219),
            "Amt Neuhaus": (10.928, 53.285),
        }
        for name, coordinates in inside.items():
            with self.subTest(name=name):
                self.assertTrue(GEOMETRY.covers(Point(*coordinates)))
        self.assertFalse(GEOMETRY.covers(Point(13.304, 52.503)))

    def test_subtraction_is_an_exact_puzzle_partition(self):
        remainder = CANONICAL_DEU.difference(GEOMETRY)
        self.assertLessEqual(projected_area_km2(GEOMETRY.intersection(remainder)), 0.001)
        reconstructed = unary_union([GEOMETRY, remainder])
        self.assertLessEqual(projected_area_km2(reconstructed.symmetric_difference(CANONICAL_DEU)), 0.001)

    def test_shared_external_vertices_are_canonical_vertices(self):
        canonical_vertices = set()
        polygons = CANONICAL_DEU.geoms if CANONICAL_DEU.geom_type == "MultiPolygon" else [CANONICAL_DEU]
        for polygon in polygons:
            for ring in (polygon.exterior, *polygon.interiors):
                canonical_vertices.update((round(x, 12), round(y, 12)) for x, y in ring.coords)
        shared = GEOMETRY.boundary.intersection(CANONICAL_DEU.boundary)
        lines = shared.geoms if hasattr(shared, "geoms") else [shared]
        shared_vertices = {
            (round(x, 12), round(y, 12))
            for line in lines if hasattr(line, "coords")
            for x, y in line.coords
        }
        self.assertTrue(shared_vertices)
        self.assertTrue(shared_vertices.issubset(canonical_vertices))


if __name__ == "__main__":
    unittest.main()
