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
        # An exported library without Git has central originals and no branch state.
        self.library = self.root / '.library-data/repository'
        self.library.mkdir(parents=True)

    def test_reads_the_canonical_original_in_an_exported_library(self):
        original = self.library / 'reports/borders/data/country-default-colors.json'
        original.parent.mkdir(parents=True)
        original.write_bytes(b'{"original":true}\n')
        resolved = self.module.report_path('reports/borders/data/country-default-colors.json', access='read', root=self.root)
        self.assertEqual(resolved.read_bytes(), original.read_bytes())

    def test_new_output_uses_the_current_report_mapping(self):
        resolved = self.module.report_path('reports/borders/reconstruction/siachen/new-output.json', access='write', root=self.root)
        self.assertEqual(resolved, self.library / 'reports/borders/reconstruction/siachen/new-output.json')

    def test_access_is_required(self):
        with self.assertRaises(TypeError):
            self.module.report_path('reports/new.json', root=self.root)

    def test_cli_input_siblings_use_the_resolved_report_directory(self):
        source = self.root / 'reports/map-analysis/corpus/corpus.json'
        resolved = self.module.report_argument(source, access='read', siblings=True, root=self.root)
        self.assertEqual(Path(resolved), self.library / 'reports/map-analysis/corpus/corpus.json')

    def test_an_explicit_input_outside_the_report_mount_is_preserved(self):
        source = self.root / 'sources/master.geojson'
        self.assertEqual(self.module.report_argument(source, access='read', root=self.root), str(source))


if __name__ == '__main__':
    unittest.main()
