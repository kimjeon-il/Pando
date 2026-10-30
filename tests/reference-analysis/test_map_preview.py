import importlib.util
import io
import pathlib
import tempfile
import unittest

from PIL import Image

ADAPTER = pathlib.Path(__file__).resolve().parents[2] / 'plugins/pando-map-tools/lib/raster.py'
spec = importlib.util.spec_from_file_location('map_preview_adapter', ADAPTER)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class SelectedPreviewTests(unittest.TestCase):
    def render(self, selected):
        with tempfile.TemporaryDirectory(prefix='map-preview-') as folder:
            path = pathlib.Path(folder) / 'original.png'
            Image.new('RGB', (100, 100), 'white').save(path)
            job = {'source': {'width': 100, 'height': 100, 'mapping': {}},
                   'graph': {'chains': [{'id': 1, 'points': [[20, 85], [70, 85]], 'semanticBits': 1}],
                             'unresolved': [{'point': [45, 85], 'reason': 'open-boundary'}]}}
            _, binary = adapter.run({'action': 'preview', 'path': str(path), 'job': job,
                                     'selectedGeometry': selected})
            return Image.open(io.BytesIO(binary)).convert('RGB')

    def test_selected_polygon_and_hole_exclude_other_candidate_pixels(self):
        image = self.render([{'type': 'Polygon', 'coordinates': [
            [[10, 30], [80, 30], [80, 75], [10, 75], [10, 30]],
            [[40, 45], [60, 45], [60, 60], [40, 60], [40, 45]]]}])
        self.assertNotEqual(image.getpixel((10, 60)), (255, 255, 255))
        self.assertNotEqual(image.getpixel((50, 45)), (255, 255, 255))
        self.assertEqual(image.getpixel((50, 50)), (255, 255, 255))
        self.assertEqual(image.getpixel((30, 85)), (255, 255, 255))
        self.assertEqual(image.getpixel((45, 80)), (255, 255, 255))

    def test_unreviewed_preview_retains_candidate_diagnostics(self):
        image = self.render(None)
        self.assertNotEqual(image.getpixel((30, 85)), (255, 255, 255))


if __name__ == '__main__':
    unittest.main()
