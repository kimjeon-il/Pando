import importlib.util
import pathlib
import tempfile
import unittest
from PIL import Image
import fitz

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('map_raster', ROOT / 'plugins/pando-map-tools/lib/raster.py')
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


class RasterTests(unittest.TestCase):
    def test_crop_mapping_preserves_original_and_flattens_alpha(self):
        with tempfile.TemporaryDirectory(prefix='pando-raster-') as directory:
            path = pathlib.Path(directory) / 'original.png'
            Image.new('RGBA', (40, 20), (0, 0, 0, 0)).save(path)
            original = path.read_bytes()
            metadata, pixels = adapter.run({'action': 'read', 'path': str(path), 'rect': {'x': 10, 'y': 5, 'width': 20, 'height': 10}, 'maxPixels': 256})
            self.assertEqual(metadata['mapping']['rect']['x'], 10)
            self.assertEqual(metadata['originalWidth'], 40)
            self.assertEqual(pixels[:4], b'\xff\xff\xff\xff')
            self.assertEqual(path.read_bytes(), original)

    def test_pdf_requires_page_and_records_raster_coordinate_plane(self):
        with tempfile.TemporaryDirectory(prefix='pando-pdf-') as directory:
            path = pathlib.Path(directory) / 'map.pdf'
            document = fitz.open()
            document.new_page(width=100, height=60)
            document.new_page(width=80, height=40)
            document.save(path)
            document.close()
            with self.assertRaisesRegex(ValueError, 'explicit'):
                adapter.run({'action': 'read', 'path': str(path)})
            metadata, _ = adapter.run({'action': 'read', 'path': str(path), 'page': 2})
            self.assertEqual(metadata['mapping']['pdfDpi'], 144)
            self.assertEqual(metadata['mapping']['page'], 2)
            self.assertEqual(metadata['originalWidth'], 160)

    def test_exif_orientation_is_explicit(self):
        with tempfile.TemporaryDirectory(prefix='pando-exif-') as directory:
            path = pathlib.Path(directory) / 'map.jpg'
            image = Image.new('RGB', (40, 20), 'white')
            exif = image.getexif()
            exif[274] = 6
            image.save(path, exif=exif)
            metadata, _ = adapter.run({'action': 'read', 'path': str(path)})
            self.assertEqual((metadata['originalWidth'], metadata['originalHeight']), (20, 40))
            self.assertEqual(metadata['mapping']['encodedSize'], [40, 20])
            self.assertEqual(metadata['mapping']['exifOrientation'], 6)

    def test_oversized_original_is_rejected_before_expensive_recognition(self):
        with tempfile.TemporaryDirectory(prefix='pando-budget-') as directory:
            path = pathlib.Path(directory) / 'map.png'
            Image.new('RGB', (4200, 4200), 'white').save(path)
            with self.assertRaisesRegex(ValueError, '16MP'):
                adapter.run({'action': 'read', 'path': str(path)})


if __name__ == '__main__':
    unittest.main()
