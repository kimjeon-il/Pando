from __future__ import annotations

import importlib.util
import pathlib
import unittest

from shapely.geometry import MultiPolygon, Polygon


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "build_german_empire_1914_base.py"
SPEC = importlib.util.spec_from_file_location("german_empire_1914_base", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


CORRECTION = {
    "longitude": {"intercept": -0.0268725, "slope": 0.0011841},
    "latitude": {"intercept": -0.1088705, "slope": 0.0024464},
}


class GermanEmpire1914BaseTests(unittest.TestCase):
    def test_axis_correction_uses_separate_coefficients(self):
        lon, lat = MODULE.corrected_xy(10.0, 50.0, CORRECTION)
        self.assertAlmostEqual(lon, 9.9849685, places=10)
        self.assertAlmostEqual(lat, 50.0134495, places=10)
        wrong_lat_using_longitude_coefficients = 50.0 - 0.0268725 + 50.0 * 0.0011841
        self.assertNotAlmostEqual(lat, wrong_lat_using_longitude_coefficients, places=6)

    def test_coordinate_tree_preserves_extra_ordinates(self):
        result = MODULE.transform_coordinate_tree([10.0, 50.0, 123.0], CORRECTION)
        self.assertEqual(result[2], 123.0)
        self.assertAlmostEqual(result[0], 9.9849685, places=10)
        self.assertAlmostEqual(result[1], 50.0134495, places=10)

    def test_heligoland_selection_requires_two_components(self):
        main = Polygon([(7.88, 54.18), (7.90, 54.18), (7.90, 54.20), (7.88, 54.20), (7.88, 54.18)])
        dune = Polygon([(7.915, 54.185), (7.93, 54.185), (7.93, 54.20), (7.915, 54.20), (7.915, 54.185)])
        mainland = Polygon([(8.5, 54.5), (8.6, 54.5), (8.6, 54.6), (8.5, 54.6), (8.5, 54.5)])
        patch = {
            "selectionBbox": [7.85, 54.16, 7.95, 54.21],
            "expectedComponents": 2,
            "insidePoints": {},
        }
        result = MODULE.extract_heligoland(MultiPolygon([main, dune, mainland]), patch)
        self.assertEqual(len(result.geoms), 2)
        self.assertEqual(tuple(round(value, 3) for value in result.bounds), (7.88, 54.18, 7.93, 54.2))


if __name__ == "__main__":
    unittest.main()
