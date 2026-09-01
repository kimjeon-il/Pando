from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
GENERIC_FEATURE_SERVICE = (ROOT / "assets" / "js" / "modules" / "generic-feature-service.js").read_text(encoding="utf-8")


class V0241GenericFeatureFlatListTests(unittest.TestCase):
    def test_genericFeature_folder_state_is_removed(self):
        self.assertNotIn("name: 'genericFeatureFolders'", PROJECT_STATE)
        self.assertNotIn("state.genericFeatureFolders", APP)
        self.assertNotIn("pandolab_folder_id", INDEX)

    def test_geojson_import_adds_canonical_genericFeatures_to_the_flat_list(self):
        importer = APP[APP.index("async function importGeoJson"):APP.index("function gisExportCounts")]
        self.assertIn("genericFeatureService.addMany(supported)", importer)
        self.assertIn("documentStore.replaceFeatures(normalizeGenericFeatureCollection([...genericFeatures(), ...normalized]))", GENERIC_FEATURE_SERVICE)
        self.assertIn("role: p.role || 'generic'", importer)
        self.assertIn("key === 'genericFeatures'", importer)
        self.assertNotIn("createImportedGenericFeatureFolder", importer)

    def test_editor_and_layer_tree_have_no_folder_controls(self):
        self.assertNotIn('id="genericFeatureFolderInput"', INDEX)
        self.assertNotIn("data-generic-feature-folder-id", APP)
        self.assertNotIn("createDynamicGenericFeatureFolderElement", APP)
        self.assertNotIn("genericFeatureFolderStateKey", APP)


if __name__ == "__main__":
    unittest.main()
