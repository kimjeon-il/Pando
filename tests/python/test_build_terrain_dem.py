import importlib.util
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

import numpy as np
from PIL import Image
import rasterio


SPEC = importlib.util.spec_from_file_location(
    'build_terrain_dem', Path(__file__).parents[2] / 'tools' / 'build-terrain-dem.py')
dem = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dem)


class TerrainDemTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('PANDO_TERRAIN_DEM_RASTER_BINARY'), 'native DEM reader required')
    def test_native_stream_reuses_reader_and_rejects_invalid_source(self):
        fixture = Path(__file__).parents[1] / 'fixtures/terrain-dem-etopo-sparse.tif'
        with dem.NativeDemWindowReader(fixture, 43200, 21600) as reader:
            expected = np.array([[100, -20], [350, 25]], dtype=np.float32)
            np.testing.assert_array_equal(reader.read(0, 0, 2, 2), expected)
            np.testing.assert_array_equal(reader.read(0, 0, 2, 2), expected)
        oracle = json.loads((Path(__file__).parents[1] / 'fixtures/terrain-dem-raster-oracle.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'valid.tif'
            source.write_bytes(base64.b64decode(oracle['sources']['valid']))
            with self.assertRaisesRegex(RuntimeError, 'ETOPO|EPSG'):
                with dem.NativeDemWindowReader(source, 8, 4) as reader:
                    reader.read(0, 0, 2, 2)
            for case in oracle['cases']:
                source.write_bytes(base64.b64decode(oracle['sources'][case['source']]))
                with self.subTest(case=case):
                    if 'error' in case:
                        with self.assertRaisesRegex(RuntimeError, 'NoData|range'):
                            with dem.NativeDemWindowReader(source, case['width'], case['height'], strict=False) as reader:
                                reader.read(*case['box'])
                    else:
                        with dem.NativeDemWindowReader(source, case['width'], case['height'], strict=False) as reader:
                            self.assertEqual(reader.read(*case['box']).tobytes(), base64.b64decode(case['expected']))

    def test_asset_summary_uses_shared_node_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'0').mkdir()
            (root/'0/0-0.webp').write_bytes(b'tile')
            (root/'tint.webp').write_bytes(b'tint')
            self.assertEqual(dem.sha256(root/'0/0-0.webp'), '8b668b8994aa845107399994593d0ca831520be5257f005351a0ec13e97a39be')
            summary, reports = dem.asset_summary(root, [dict(id=0, columns=1, rows=1)])
            self.assertEqual(summary, '5ad4ffea29010ac414c267e6cdc850ba10a9bb44f7a1ea814eff2de470922833')
            self.assertEqual(reports, [dict(level=0, tileCount=1, bytes=4, maxTileBytes=4)])

    def test_generator_refuses_to_overwrite_existing_dataset(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            missing = root/'missing'
            with self.assertRaises(FileExistsError):
                dem.build(missing, missing, root, missing, missing)
            with self.assertRaises(FileExistsError):
                dem.rebuild_tint_release(missing, missing, missing, missing, root)

    def test_tint_zip_extraction_preserves_neighbor_and_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tiff = root / 'input.tif'
            with rasterio.open(tiff, 'w', driver='GTiff', width=4, height=2, count=3, dtype='uint8',
                               crs='EPSG:4326', transform=rasterio.transform.from_bounds(-180, -90, 180, 90, 4, 2)) as image:
                image.write(np.ones((3, 2, 4), dtype=np.uint8))
            original = tiff.read_bytes()
            archive = root / 'tint.zip'
            with zipfile.ZipFile(archive, 'w') as zip_file:
                zip_file.write(tiff, 'input.tif')
            tiff.write_bytes(b'protected neighbor')
            polygon = {'type': 'Polygon', 'coordinates': [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]}
            ice = root / 'ice.json'; ice.write_text(json.dumps({'features': [{'geometry': polygon}]}))
            land = root / 'land.json'; land.write_text(json.dumps({'type': 'FeatureCollection', 'features': [{'id': 'x', 'geometry': polygon}]}))
            def render(source, _ice, _land, output):
                self.assertNotEqual(Path(source.name).resolve(), tiff.resolve())
                self.assertEqual(Path(source.name).read_bytes(), original)
                output.write_bytes(b'rendered')
                return {'algorithm': 'fixture', 'validCells': 1, 'regionalFillCells': 0}
            with mock.patch.object(dem, 'TINT_WIDTH', 4), mock.patch.object(dem, 'TINT_HEIGHT', 2), mock.patch.object(dem, 'resample_tint', render):
                dem.build_tint(archive, root / 'output.webp', ice, land)
            self.assertEqual(tiff.read_bytes(), b'protected neighbor')
            with zipfile.ZipFile(archive, 'w') as zip_file:
                zip_file.writestr('../input.tif', original)
            with self.assertRaisesRegex(ValueError, 'ZIP|entry|path'):
                dem.build_tint(archive, root / 'other.webp', ice, land)
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as zip_file:
                zip_file.writestr('input.tif', original)
            with zipfile.ZipFile(archive) as zip_file:
                info = zip_file.getinfo('input.tif')
                offset = info.header_offset + 30 + len(info.filename.encode('utf-8')) + len(info.extra)
            corrupted = bytearray(archive.read_bytes()); corrupted[offset] ^= 1; archive.write_bytes(corrupted)
            with self.assertRaises(zipfile.BadZipFile):
                dem.build_tint(archive, root / 'other.webp', ice, land)
            self.assertEqual(tiff.read_bytes(), b'protected neighbor')
            self.assertFalse(list(root.glob('pando-tint-*')))

    def test_tint_average_does_not_dilute_a_small_island_with_white_sea(self):
        fixture = Path(__file__).parents[1] / 'fixtures/terrain-dem-tint'
        oracle = json.loads((fixture/'oracle.json').read_text())
        with tempfile.TemporaryDirectory() as folder, rasterio.open(fixture/'source.tif') as source:
            first, second = Path(folder)/'first.webp', Path(folder)/'second.webp'
            report = dem.resample_tint(source, fixture/'ice.geojson', fixture/'land.geojson', first, width=4, height=2)
            dem.resample_tint(source, fixture/'ice.geojson', fixture/'land.geojson', second, width=4, height=2)
            pixels = np.asarray(Image.open(first).convert('RGB'))
            np.testing.assert_array_equal(pixels.reshape(-1), oracle['rgb'])
            self.assertEqual(report, oracle['report'])
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with self.assertRaises(FileExistsError):
                dem.resample_tint(source, fixture/'ice.geojson', fixture/'land.geojson', first, width=4, height=2)

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

    def test_failed_native_webp_encoding_preserves_existing_tile(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tile.webp'; path.write_bytes(b'prior tile')
            failed = mock.Mock(returncode=1, stderr=b'encoder failure', stdout=b'')
            with mock.patch.object(dem.subprocess, 'run', return_value=failed):
                with self.assertRaisesRegex(RuntimeError, 'encoder failure'):
                    dem.save_and_verify_webp(np.zeros((2, 2, 4), dtype=np.uint8), path)
            self.assertEqual(path.read_bytes(), b'prior tile')
            self.assertEqual([item.name for item in Path(folder).iterdir()], ['tile.webp'])

    def test_shade_quantization_preserves_elevation_and_limits_error(self):
        values = np.array([[0, 120, -100, 300], [600, -500, 2200, -3500]], dtype=np.float32)
        rgba = dem.encode(values, 4, 2, 0)
        exact_shade = dem.shade(values, 4, 2, 0)
        expected = np.minimum(((exact_shade.astype(np.uint16) + 2) // 4) * 4, 255).astype(np.uint8)
        np.testing.assert_array_equal(rgba[:, :, 2], expected)
        decoded = rgba[:, :, 0].astype(np.int32)*256 + rgba[:, :, 1].astype(np.int32)-12000
        np.testing.assert_array_equal(decoded, values.astype(np.int32))
        self.assertLessEqual(np.abs(rgba[:, :, 2].astype(np.int16) - exact_shade.astype(np.int16)).max(), 2)
        np.testing.assert_array_equal(rgba[:, :, 2] % 4, 0)

    def test_coarse_polar_gutter_clamps_adjacent_shade(self):
        values = np.array([[100, 200, 300, 400], [200, 300, 400, 500],
                           [300, 400, 500, 600], [400, 500, 600, 700]], dtype=np.float32)
        rgba = dem.encode(values, 4, 2, -1)
        np.testing.assert_array_equal(rgba[0, :, 2], rgba[1, :, 2])
        np.testing.assert_array_equal(rgba[-1, :, 2], rgba[-2, :, 2])
        np.testing.assert_array_equal(rgba[1:-1, :, 2] % 4, 0)

    @unittest.skipUnless(os.environ.get('PANDO_TERRAIN_DEM_RASTER_BINARY'), 'native DEM reader required')
    def test_area_average_and_wrapped_gutter(self):
        values = np.array([[0, 2, 4, 6], [8, 10, 12, 14]], dtype=np.float32)
        transform = rasterio.transform.from_bounds(-180, -90, 180, 90, 4, 2)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'source.tif'
            with rasterio.open(path, 'w', driver='GTiff', width=4, height=2, count=1, dtype='float32',
                               crs='EPSG:4326', transform=transform, nodata=-99999) as source:
                source.write(values, 1)
            with dem.NativeDemWindowReader(path, 2, 1, strict=False) as reader:
                result = reader.read(-1, -1, 3, 2)
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
