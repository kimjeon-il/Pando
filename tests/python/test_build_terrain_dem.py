import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

import numpy as np
from PIL import Image


SPEC = importlib.util.spec_from_file_location(
    'build_terrain_dem', Path(__file__).parents[2] / 'tools' / 'build-terrain-dem.py')
dem = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dem)


class TerrainDemTest(unittest.TestCase):
    def test_native_level_refuses_existing_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'0').mkdir()
            tile = root/'0/0-0.webp'
            tile.write_bytes(b'protected')
            with self.assertRaisesRegex(RuntimeError, 'exist|EEXIST'):
                dem.generate_level(root/'missing.tif', root, dict(id=0, width=1, height=1, tileSize=1, columns=1, rows=1))
            self.assertEqual(tile.read_bytes(), b'protected')

    @unittest.skipUnless(os.environ.get('PANDO_TERRAIN_DEM_RASTER_BINARY'), 'native DEM reader required')
    def test_native_inspection_validates_etopo_source(self):
        fixture = Path(__file__).parents[1] / 'fixtures/terrain-dem-etopo-sparse.tif'
        self.assertEqual(dem.inspect_source(fixture), dict(width=43200, height=21600, nodata=-32768, dtype='int16'))
        with self.assertRaisesRegex(ValueError, 'DEM|ETOPO|EPSG'):
            dem.inspect_source(Path(__file__).parents[1] / 'fixtures/terrain-dem-tint/source.tif')


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
        fixture = Path(__file__).parents[1] / 'fixtures/terrain-dem-tint'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tiff = root / 'input.tif'
            original = (fixture/'source.tif').read_bytes()
            archive = root / 'tint.zip'
            with zipfile.ZipFile(archive, 'w') as zip_file:
                zip_file.writestr('input.tif', original)
            tiff.write_bytes(b'protected neighbor')
            ice, land = fixture/'ice.geojson', fixture/'land.geojson'
            with mock.patch.object(dem, 'TINT_WIDTH', 4), mock.patch.object(dem, 'TINT_HEIGHT', 2):
                report = dem.build_tint(archive, root / 'output.webp', ice, land)
            self.assertEqual(report['sourceEntry'], 'input.tif')
            self.assertEqual(tiff.read_bytes(), b'protected neighbor')
            with zipfile.ZipFile(archive, 'w') as zip_file:
                zip_file.writestr('../input.tif', original)
            with self.assertRaisesRegex(RuntimeError, 'ZIP|entry|path'):
                dem.build_tint(archive, root / 'other.webp', ice, land)
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as zip_file:
                zip_file.writestr('input.tif', original)
            with zipfile.ZipFile(archive) as zip_file:
                info = zip_file.getinfo('input.tif')
                offset = info.header_offset + 30 + len(info.filename.encode('utf-8')) + len(info.extra)
            corrupted = bytearray(archive.read_bytes()); corrupted[offset] ^= 1; archive.write_bytes(corrupted)
            with self.assertRaisesRegex(RuntimeError, 'CRC|size'):
                dem.build_tint(archive, root / 'other.webp', ice, land)
            self.assertEqual(tiff.read_bytes(), b'protected neighbor')
            self.assertFalse(list(root.glob('.pando-tint-*')))

    def test_tint_average_does_not_dilute_a_small_island_with_white_sea(self):
        fixture = Path(__file__).parents[1] / 'fixtures/terrain-dem-tint'
        oracle = json.loads((fixture/'oracle.json').read_text())
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder)/'first.webp', Path(folder)/'second.webp'
            with mock.patch.object(dem, 'TINT_WIDTH', 4), mock.patch.object(dem, 'TINT_HEIGHT', 2):
                report = dem.build_tint(fixture/'source.zip', first, fixture/'ice.geojson', fixture/'land.geojson')
                dem.build_tint(fixture/'source.zip', second, fixture/'ice.geojson', fixture/'land.geojson')
            pixels = np.asarray(Image.open(first).convert('RGB'))
            np.testing.assert_array_equal(pixels.reshape(-1), oracle['rgb'])
            self.assertEqual({key: report[key] for key in oracle['report']}, oracle['report'])
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with self.assertRaises(FileExistsError):
                dem.build_tint(fixture/'source.zip', first, fixture/'ice.geojson', fixture/'land.geojson')










if __name__ == '__main__':
    unittest.main()
