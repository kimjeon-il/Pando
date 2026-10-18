import importlib.util
import tempfile
import unittest
from pathlib import Path


class ReportPathsTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((Path(__file__).resolve().parents[1] / 'tools/report_paths.py').is_file(), 'report path resolver has not been implemented')
        spec = importlib.util.spec_from_file_location('report_paths', Path(__file__).resolve().parents[1] / 'tools/report_paths.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_existing_pando_uses_original_paths_for_inputs_and_outputs(self):
        self.assertEqual(self.module.report_path('docs/place-data-audit.md', self.root), self.root / 'docs/place-data-audit.md')
        self.assertEqual(self.module.report_path('assets/data/research/siachen', self.root), self.root / 'assets/data/research/siachen')

    def test_migrated_tree_uses_canonical_reports_even_for_new_outputs(self):
        marker = self.root / 'reports/places/source-manifest.json'
        marker.parent.mkdir(parents=True)
        marker.write_text('{}')
        self.assertEqual(self.module.report_path('docs/place-data-audit.md', self.root), self.root / 'reports/places/place-data-audit.md')
        self.assertEqual(self.module.report_path('assets/data/research/siachen/new-output.json', self.root), self.root / 'reports/research/siachen/new-output.json')

    def test_unrelated_geometry_path_is_preserved(self):
        marker = self.root / 'reports/places/source-manifest.json'
        marker.parent.mkdir(parents=True)
        marker.write_text('{}')
        for path in ['tools/historical-library/sources/german-coastline/change-events.json',
                     'tools/historical-library/land-borders/master.geojson']:
            self.assertEqual(self.module.report_path(path, self.root), self.root / path)

    def test_transitional_file_is_read_from_existing_new_location(self):
        file = self.root / 'reports/research/country-default-colors.json'
        file.parent.mkdir(parents=True)
        file.write_text('{}')
        self.assertEqual(self.module.report_path('docs/research/country-default-colors.json', self.root), file)


if __name__ == '__main__':
    unittest.main()
