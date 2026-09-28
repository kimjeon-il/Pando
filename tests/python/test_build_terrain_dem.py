import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.vrt import WarpedVRT


SPEC = importlib.util.spec_from_file_location(
    'build_terrain_dem', Path(__file__).parents[2] / 'tools' / 'build-terrain-dem.py')
dem = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dem)
VERIFY_SPEC = importlib.util.spec_from_file_location(
    'verify_terrain_dem', Path(__file__).parents[2] / 'tools' / 'verify-terrain-dem.py')
verifier = importlib.util.module_from_spec(VERIFY_SPEC)
VERIFY_SPEC.loader.exec_module(verifier)


class TerrainDemTest(unittest.TestCase):
    def test_signed_elevation_and_byte_boundary(self):
        values = np.array([[-12000, -11745, -11744, 0, 53535]], dtype=np.float32)
        rgba = dem.encode(values, 5, 1, 0)
        restored = rgba[:, :, 0].astype(np.int32)*256 + rgba[:, :, 1].astype(np.int32)-12000
        np.testing.assert_array_equal(restored, values.astype(np.int32))
        np.testing.assert_array_equal(rgba[:, :, 3], 255)
        self.assertEqual((int(rgba[0, 1, 0]), int(rgba[0, 1, 1])), (0, 255))
        self.assertEqual((int(rgba[0, 2, 0]), int(rgba[0, 2, 1])), (1, 0))

    def test_webp_roundtrip_and_reproducibility(self):
        values = np.array([[0, 1, -1], [120, -100, 300]], dtype=np.float32)
        rgba = dem.encode(values, 3, 2, 0)
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder)/'a.webp', Path(folder)/'b.webp'
            dem.save_and_verify_webp(rgba, first)
            dem.save_and_verify_webp(rgba, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            np.testing.assert_array_equal(np.asarray(Image.open(first).convert('RGBA')), rgba)

    def test_shade_quantization_preserves_elevation_and_limits_error(self):
        self.assertTrue(hasattr(dem, 'quantize_shade'))
        shades = np.array([[0, 1, 2, 3, 4, 253, 254, 255]], dtype=np.uint8)
        np.testing.assert_array_equal(dem.quantize_shade(shades),
                                      [[0, 0, 4, 4, 4, 252, 255, 255]])
        values = np.array([[0, 120, -100, 300], [600, -500, 2200, -3500]], dtype=np.float32)
        rgba = dem.encode(values, 4, 2, 0)
        exact_shade = dem.shade(values, 4, 2, 0)
        decoded = rgba[:, :, 0].astype(np.int32)*256 + rgba[:, :, 1].astype(np.int32)-12000
        np.testing.assert_array_equal(decoded, values.astype(np.int32))
        self.assertLessEqual(np.abs(rgba[:, :, 2].astype(np.int16) - exact_shade.astype(np.int16)).max(), 2)
        np.testing.assert_array_equal(rgba[:, :, 2] % 4, 0)

    def test_coarse_polar_gutter_clamps_adjacent_shade(self):
        values = np.array([[100, 200, 300, 400], [200, 300, 400, 500],
                           [300, 400, 500, 600], [400, 500, 600, 700]], dtype=np.float32)
        exact = np.full(values.shape, 213, dtype=np.uint8)
        with patch.object(dem, 'shade', return_value=exact):
            rgba = dem.encode(values, 4, 2, -1)
        np.testing.assert_array_equal(rgba[0, :, 2], rgba[1, :, 2])
        np.testing.assert_array_equal(rgba[-1, :, 2], rgba[-2, :, 2])
        self.assertFalse(np.array_equal(rgba[0, :, 2], exact[0, :]))
        np.testing.assert_array_equal(rgba[1:-1, :, 2] % 4, 0)

    def test_verifier_rejects_off_grid_published_shade(self):
        self.assertTrue(hasattr(verifier, 'validate_shade_values'))
        verifier.validate_shade_values(np.array([[0, 4, 252, 255]], dtype=np.uint8), 4)
        with self.assertRaises(ValueError):
            verifier.validate_shade_values(np.array([[0, 3, 252]], dtype=np.uint8), 4)
        verifier.validate_shade_values(np.array([[3, 3, 3], [0, 4, 252]], dtype=np.uint8), 4,
                                       excluded_rows=(0,))

    def test_verifier_compares_every_channel_to_reference(self):
        self.assertTrue(hasattr(verifier, 'compare_reference_tile'))
        reference = np.array([[[12, 255, 127, 255]]], dtype=np.uint8)
        optimized = np.array([[[12, 255, 128, 255]]], dtype=np.uint8)
        verifier.compare_reference_tile(optimized, reference, 'tile')
        altered_elevation = optimized.copy()
        altered_elevation[0, 0, 1] = 254
        with self.assertRaises(ValueError):
            verifier.compare_reference_tile(altered_elevation, reference, 'tile')
        altered_shade = optimized.copy()
        altered_shade[0, 0, 2] = 132
        with self.assertRaises(ValueError):
            verifier.compare_reference_tile(altered_shade, reference, 'tile')

    def test_area_average_and_wrapped_gutter(self):
        values = np.array([[0, 2, 4, 6], [8, 10, 12, 14]], dtype=np.float32)
        transform = rasterio.transform.from_bounds(-180, -90, 180, 90, 4, 2)
        with MemoryFile() as memory:
            with memory.open(driver='GTiff', width=4, height=2, count=1, dtype='float32',
                             crs='EPSG:4326', transform=transform, nodata=-99999) as source:
                source.write(values, 1)
                with WarpedVRT(source, crs=source.crs,
                               transform=rasterio.transform.from_bounds(-180, -90, 180, 90, 2, 1),
                               width=2, height=1, resampling=Resampling.average) as vrt:
                    result = dem.read_vrt_pixels(vrt, 2, 1, -1, -1, 3, 2)
                    np.testing.assert_allclose(result[1], [9, 5, 9, 5])
                    np.testing.assert_allclose(result[0], result[1])
                    np.testing.assert_allclose(result[2], result[1])

    def test_range_and_nodata_are_not_silently_zeroed(self):
        with self.assertRaises(ValueError):
            dem.encode(np.array([[-12001]], dtype=np.float32), 1, 1, 0)

    def test_reconcile_gutters_uses_published_neighbor_and_is_stable(self):
        level = {'id': 0, 'columns': 2, 'rows': 2}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'0').mkdir()
            for row in range(2):
                for column in range(2):
                    pixels = np.full((4, 4, 4), 10 + row*2 + column, dtype=np.uint8)
                    pixels[:, :, 3] = 255
                    dem.save_and_verify_webp(pixels, root/'0'/f'{column}-{row}.webp')
            self.assertEqual(dem.reconcile_gutters(root, level), 4)
            self.assertEqual(dem.reconcile_gutters(root, level), 0)
            def read(column, row):
                return np.asarray(Image.open(root/'0'/f'{column}-{row}.webp').convert('RGBA'))
            west, east = read(0, 0), read(1, 0)
            north, south = read(0, 0), read(0, 1)
            np.testing.assert_array_equal(west[:, -1], east[:, 1])
            np.testing.assert_array_equal(east[:, -1], west[:, 1])
            np.testing.assert_array_equal(north[-1, :], south[1, :])


if __name__ == '__main__':
    unittest.main()
