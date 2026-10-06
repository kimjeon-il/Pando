from __future__ import annotations
from tests.application_source import function_source, read_application_sources, read_module

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
GENERIC_FEATURE_SERVICE = (ROOT / "assets" / "js" / "modules" / "generic-feature-service.js").read_text(encoding="utf-8")


class V0241GenericFeatureFlatListTests(unittest.TestCase):
    def test_genericFeature_folder_state_is_removed(self):
        self.assertNotIn("name: 'genericFeatureFolders'", PROJECT_STATE)
        self.assertNotIn("state.genericFeatureFolders", APP)
        self.assertNotIn("pandolab_folder_id", INDEX)

    def test_geojson_import_adds_canonical_genericFeatures_to_the_flat_list(self):
        transaction = read_module(ROOT,'gis-import-transaction.js')
        importer = function_source(transaction,'importGeoJson')
        self.assertIn('genericFeatureService.addMany(supported)', importer)
        self.assertIn('documentStore.replaceFeatures(normalizeGenericFeatureCollection([...genericFeatures(), ...normalized]))', GENERIC_FEATURE_SERVICE)
        self.assertIn('supported.push(normalizeGenericFeatureSemantics(f))', importer)
        self.assertIn('const sourceId = String(f.id', importer)
        self.assertIn('sourceId,', importer)
        self.assertNotIn('createImportedGenericFeatureFolder', importer)
        self.assertIn("mutateDocument({ type: 'generic-feature-import'", function_source(GENERIC_FEATURE_SERVICE,'addMany'))

    def test_editor_and_layer_tree_have_no_folder_controls(self):
        self.assertNotIn('id="genericFeatureFolderInput"', INDEX)
        self.assertNotIn("data-generic-feature-folder-id", APP)
        self.assertNotIn("createDynamicGenericFeatureFolderElement", APP)
        self.assertNotIn("genericFeatureFolderStateKey", APP)


if __name__ == "__main__":
    unittest.main()
