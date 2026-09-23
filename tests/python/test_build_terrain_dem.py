import importlib.util
from pathlib import Path
import tempfile
import unittest

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
