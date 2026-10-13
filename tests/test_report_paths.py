import importlib.util
import tempfile
import unittest
from pathlib import Path


class ReportPathsTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('report_paths', Path(__file__).resolve().parents[1] / 'tools/report_paths.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_explicit_current_path_does_not_depend_on_existing_files(self):
        path = 'reports/research/country-default-colors.json'
        self.assertEqual(self.module.report_path(path, self.root), self.root / path)
        old = self.root / 'docs/research/country-default-colors.json'
        old.parent.mkdir(parents=True)
        old.write_text('{}')
        self.assertEqual(self.module.report_path(path, self.root), self.root / path)

    def test_retired_locations_are_rejected(self):
        for path in ['docs/place-data-audit.md', 'assets/data/research/siachen',
                     'native/tools/historical-library/land-borders', 'native/reports/places/source-manifest.json',
                     'reports/../docs/report.json']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.module.report_path(path, self.root)


if __name__ == '__main__':
    unittest.main()
