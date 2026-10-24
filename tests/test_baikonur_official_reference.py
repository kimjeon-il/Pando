"""Tests for the OSM-free Baikonur research reference, not canonical borders."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "tools/gis/baikonur_official_reference.py"


class BaikonurOfficialReferenceTests(unittest.TestCase):
    def test_treaty_anchors_and_only_supported_connections(self):
        spec = importlib.util.spec_from_file_location("baikonur_official_reference", MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        obj = module.reference()
        self.assertFalse(obj["properties"]["openStreetMapDataUsed"])
        self.assertIn("INCOMPLETE", obj["properties"]["status"])
        self.assertEqual(len(obj["features"]), 31 + 29)
        anchors = [row for row in obj["features"]
                   if row["properties"]["kind"] == "official-anchor"]
        straight = [row for row in obj["features"]
                    if row["properties"]["kind"] == "treaty-straight-segment"]
        self.assertEqual(len(anchors), 31)
        self.assertEqual(len(straight), 29)
        self.assertEqual(anchors[0]["geometry"]["coordinates"], [63.01805556, 45.70277778])
        self.assertEqual(anchors[16]["geometry"]["coordinates"], [63.72916667, 45.73472222])
        self.assertEqual(anchors[30]["geometry"]["coordinates"], [63.21944444, 45.6])
        edges = {(row["properties"]["fromPoint"], row["properties"]["toPoint"]) for row in straight}
        self.assertNotIn((17, 18), edges)
        self.assertNotIn((31, 1), edges)
        self.assertEqual({(17, 18), (31, 1)}, set(module.RIGHT_BANK_REACHES))
        self.assertFalse(any(row["geometry"]["type"] == "Polygon" for row in obj["features"]))


if __name__ == "__main__":
    unittest.main()
