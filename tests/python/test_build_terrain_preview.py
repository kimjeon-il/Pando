"""Focused contracts for the DEM-derived, independently usable preview."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image


SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build-terrain-preview.py"
spec = importlib.util.spec_from_file_location("build_terrain_preview", SCRIPT)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class TerrainPreviewTests(unittest.TestCase):
    def test_source_contract_uses_only_required_dem_and_tint_pins(self):
        countries = b'{"type":"FeatureCollection","features":[]}'
        tint_hash = preview.sha256(b"tint")
        dem = {"version": "0.13.3", "representation": "dem-relief-v1",
               "levels": [{"id": 0, "rows": 1, "columns": 1}, {"id": 1, "rows": 1, "columns": 1}],
               "tint": {"sha256": tint_hash}}
        pins = {"assets": [{"path": path, "bytes": 4, "sha256": tint_hash} for path in [
            "terrain/v0.13.0/0/0-0.webp", "terrain/v0.13.0/1/0-0.webp", "terrain/v0.13.3/tint.webp"]]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, inventory, land = root / "source.json", root / "pins.json", root / "land.json"
            source.write_text(json.dumps(dem), encoding="utf-8")
            inventory.write_text(json.dumps(pins), encoding="utf-8")
            land.write_bytes(countries)
            with patch.multiple(preview, DEM_MANIFEST=source, DEM_INVENTORY=inventory,
                                LAND_MASK=land, LAND_MASK_SHA256=preview.sha256(countries)):
                _, assets, actual_countries = preview._source_contract()
                self.assertEqual(len(assets), 3)
                self.assertEqual(actual_countries["features"], [])
                pins["assets"].append(pins["assets"][0])
                inventory.write_text(json.dumps(pins), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "source pins"):
                    preview._source_contract()
                pins["assets"].pop()
                pins["assets"][-1]["sha256"] = "0" * 64
                inventory.write_text(json.dumps(pins), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "tint pin"):
                    preview._source_contract()

    def test_cached_source_keeps_byte_and_hash_verification_without_download(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            data = b"tiny DEM source"
            (cache / "tile.webp").write_bytes(data)
            pin = {"bytes": len(data), "sha256": preview.sha256(data)}
            self.assertEqual(preview._source_bytes("tile.webp", "https://unused.invalid", pin, cache), data)
            (cache / "tile.webp").write_bytes(b"x" * len(data))
            with self.assertRaisesRegex(ValueError, "Cached DEM source differs"):
                preview._source_bytes("tile.webp", "https://unused.invalid", pin, cache)

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
