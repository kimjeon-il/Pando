from __future__ import annotations

import json
import unittest
from pathlib import Path

from pyproj import Geod, Transformer
from shapely.geometry import Point, box, shape
from shapely.ops import transform, unary_union


ROOT = Path(__file__).parents[1]
PILOT_PATH = ROOT / "assets/data/territorial-entities/source/countries/state-deutsche-demokratische-republik.json"
COUNTRIES_PATH = ROOT / "assets/data/territorial-entities/source/countries/state-DEU.json"
PILOT = json.loads(PILOT_PATH.read_text(encoding="utf-8"))
COUNTRIES = json.loads(COUNTRIES_PATH.read_text(encoding="utf-8"))
ENTITY = PILOT
GEOMETRY = shape(ENTITY["geometryVersions"][0]["geometry"])
CANONICAL_DEU = shape(next(item["geometry"] for item in COUNTRIES["geometryVersions"] if item["datePrecision"] == "current"))
RECIPE = json.loads((ROOT / "tools/historical-library/east-germany-1989.recipe.json").read_text(encoding="utf-8"))
PREVIOUS = shape(json.loads((ROOT / RECIPE["sources"]["previousDdr"]["path"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
TO_EQUAL_AREA = Transformer.from_crs(4326, 3035, always_xy=True).transform


def projected_area_km2(geometry):
    return abs(transform(TO_EQUAL_AREA, geometry).area) / 1_000_000


class EastGermanyHistoricalLibraryTests(unittest.TestCase):
    def test_identity_dates_aliases_and_instantiation_policy(self):
        self.assertEqual(ENTITY["names"]["en"], "German Democratic Republic")
        self.assertEqual(ENTITY["names"]["ko"], "독일 민주공화국")
        self.assertEqual(ENTITY["names"]["de"], "Deutsche Demokratische Republik")
        self.assertEqual(set(ENTITY["alternateNames"]), {"동독", "East Germany", "DDR", "GDR", "Ostdeutschland"})
        self.assertEqual(ENTITY["lifetime"]["validFrom"], "1949-10-07")
        self.assertEqual(ENTITY["lifetime"]["validTo"], "1990-10-02")
        self.assertEqual(ENTITY["metadata"]["dissolutionDate"], "1990-10-03")
        self.assertEqual(ENTITY["metadata"]["referenceDate"], "1989-04-25")
        self.assertEqual(ENTITY["instantiation"], {
            "mode": "territory-replacement",
            "countryUpdates": {"DEU": {"name": "독일 연방공화국"}},
        })

    def test_geometry_is_valid_bounded_and_inside_canonical_germany(self):
        self.assertEqual(GEOMETRY.geom_type, "MultiPolygon")
        self.assertTrue(GEOMETRY.is_valid)
        area, _ = Geod(ellps="WGS84").geometry_area_perimeter(GEOMETRY)
        self.assertGreaterEqual(abs(area) / 1_000_000, 108_000)
        self.assertLessEqual(abs(area) / 1_000_000, 109_000)
        # GEOS overlays can leave near-collinear sub-picometre strips. Reprojecting
        # their differently segmented edges turns them into artificial area.
        self.assertTrue(GEOMETRY.difference(CANONICAL_DEU.buffer(3e-12)).is_empty)
        self.assertLess(len(json.dumps(ENTITY).encode("utf-8")), 6 * 1024 * 1024)

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

    def test_changes_are_confined_to_admitted_sections_and_preserve_holes(self):
        admitted = unary_union([box(*section["bounds"]) for operation in RECIPE["operations"]
                                if operation["operation"] == "boundary-supplement" for section in operation["sections"]])
        delta = GEOMETRY.symmetric_difference(PREVIOUS)
        self.assertGreater(projected_area_km2(delta), 0)
        self.assertLess(projected_area_km2(delta.difference(admitted)), 1e-6)
        old_holes = unary_union([shape({"type": "Polygon", "coordinates": [list(ring.coords)]})
                                 for polygon in PREVIOUS.geoms for ring in polygon.interiors])
        new_holes = unary_union([shape({"type": "Polygon", "coordinates": [list(ring.coords)]})
                                 for polygon in GEOMETRY.geoms for ring in polygon.interiors])
        self.assertLess(projected_area_km2(old_holes.symmetric_difference(new_holes)), 1e-6)
        for name, bounds in {"coast": (9, 53.86, 15.5, 55.5), "Elbe-Neuhaus": (10.25, 52.7, 12, 53.44),
                             "West Berlin": (12.9, 52.3, 13.8, 52.8)}.items():
            with self.subTest(name=name):
                self.assertLess(projected_area_km2(delta.intersection(box(*bounds))), 1e-6)

    def test_adopted_lsib_arcs_are_shared_and_not_shifted_by_the_vg25_step(self):
        # Endpoints may be interpolated crossing points; the adopted reference
        # line, rather than membership in its vertex set, owns the shared arc.
        for section in RECIPE["operations"][-2]["sections"]:
            region = box(*section["bounds"])
            shared = GEOMETRY.boundary.intersection(CANONICAL_DEU.boundary.buffer(3e-12)).intersection(region)
            old_shared = PREVIOUS.boundary.intersection(CANONICAL_DEU.boundary.buffer(3e-12)).intersection(region)
            self.assertGreater(shared.length, old_shared.length + 0.1)

    def test_hornburg_supplement_changes_real_geometry_and_preserves_other_sectors(self):
        # Freeze the already accepted LSIB/VG25 result. This catches source-only
        # recipe edits and accidental changes outside the newly admitted area.
        baseline_path = ROOT / "tools/historical-library/sources/east-germany/ddr-before-remaining-vg25.geojson"
        baseline = shape(json.loads(baseline_path.read_text(encoding="utf-8"))["features"][0]["geometry"])
        region = box(10.55, 51.98, 10.91, 52.09)
        delta = baseline.symmetric_difference(GEOMETRY)
        self.assertGreater(projected_area_km2(delta.intersection(region)), 0.01)
        self.assertTrue(delta.difference(region.buffer(3e-12)).difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertLess(baseline.boundary.difference(region).hausdorff_distance(
            GEOMETRY.boundary.difference(region)), 3e-11)
        self.assertEqual(len(GEOMETRY.geoms), len(baseline.geoms))
        for name, bounds in {"Wendebach-Werra": (9.7, 50.8, 10.3, 51.45),
                             "Ohre-Droemling": (10.7, 52.3, 11.3, 52.9),
                             "northern-shores": (10.5, 53.4, 11.2, 54.1)}.items():
            with self.subTest(held=name):
                self.assertTrue(delta.intersection(box(*bounds)).difference(baseline.boundary.buffer(3e-12)).is_empty)

    def test_admitted_inland_sections_reuse_the_pinned_vg25_derivative(self):
        # This checks which source line was applied, not historical positional
        # accuracy: the documentary admission has no independent period vector.
        source = json.loads((ROOT / RECIPE["sources"]["vg25EasternLands"]["path"]).read_text(encoding="utf-8"))
        to_wgs84 = Transformer.from_crs(25832, 4326, always_xy=True).transform
        reference = transform(to_wgs84, unary_union([shape(feature["geometry"]) for feature in source["features"]]))
        reference = reference.simplify(RECIPE["boundarySupplement"]["presentationToleranceDegrees"], preserve_topology=True).boundary
        for section in RECIPE["operations"][-1]["sections"]:
            region = box(*section["bounds"])
            with self.subTest(section=section["id"]):
                shared = GEOMETRY.boundary.intersection(reference.buffer(3e-11)).intersection(region).length
                previous_shared = PREVIOUS.boundary.intersection(reference.buffer(3e-11)).intersection(region).length
                self.assertGreater(shared, previous_shared + 0.0001)


if __name__ == "__main__":
    unittest.main()
