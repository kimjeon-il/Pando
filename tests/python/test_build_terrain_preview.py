"""Focused contracts for the DEM-derived, independently usable preview."""

import importlib.util
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build-terrain-preview.py"
spec = importlib.util.spec_from_file_location("build_terrain_preview", SCRIPT)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class TerrainPreviewTests(unittest.TestCase):
    def test_dem_color_and_gray_alpha_use_elevation_and_tint(self):
        source = np.zeros((2, 2, 4), dtype=np.uint8)
        source[:, :, 3] = 255
        source[:, :, 2] = 128
        source[:, :, 0] = 12000 // 256
        source[:, :, 1] = 12000 % 256
        below_sea = 8000
        source[0, 1, 0] = below_sea // 256
        source[0, 1, 1] = below_sea % 256
        tint = np.full((2, 2, 3), [100, 150, 200], dtype=np.uint8)
        land = np.array([[True, False], [True, True]])

        actual = preview.compose_preview_rgba(source, tint, land, 0, 0, 2, 2)

        self.assertEqual(actual.shape, (2, 2, 4))
        self.assertTrue(np.all(actual[:, :, 3] == 128))
        ratio = min(1.2, max(0.5, (128 / 255) / (0.42 + 0.58 * 0.70710678)))
        self.assertEqual(tuple(actual[0, 0, :3]), tuple(np.rint(np.array([100, 150, 200]) * ratio).astype(np.uint8)))
        self.assertNotEqual(tuple(actual[0, 1, :3]), tuple(actual[0, 0, :3]))

    def test_land_mask_hole_and_dateline_are_preserved(self):
        countries = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {
            "type": "Polygon", "coordinates": [
                [[170, 20], [-170, 20], [-170, -20], [170, -20], [170, 20]],
                [[175, 10], [175, -10], [-175, -10], [-175, 10], [175, 10]],
            ]}}]}
        mask = preview.rasterize_land_mask(countries, 0, 0, 360, 180, 360, 180)
        self.assertEqual(mask.shape, (180, 360))
        self.assertTrue(mask[90, 351])
        self.assertFalse(mask[90, 359])
        self.assertTrue(mask[90, 7])
        self.assertFalse(mask[90, 180])

    def test_lossless_preview_preserves_gray_alpha(self):
        pixels = np.zeros((3, 4, 4), dtype=np.uint8)
        pixels[:, :, :3] = [100, 150, 200]
        pixels[:, :, 3] = [[0, 4, 128, 255], [32, 64, 96, 127], [250, 255, 20, 30]]
        encoded = preview.encode_webp(pixels)
        decoded = np.asarray(Image.open(__import__("io").BytesIO(encoded)).convert("RGBA"))
        np.testing.assert_array_equal(decoded, pixels)


if __name__ == "__main__":
    unittest.main()
