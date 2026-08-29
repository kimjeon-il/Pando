from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
DRAWING_SERVICE = (ROOT / "assets" / "js" / "modules" / "drawing-service.js").read_text(encoding="utf-8")


class V0241DrawingFlatListTests(unittest.TestCase):
    def test_drawing_folder_state_is_removed(self):
        self.assertNotIn("name: 'drawingFolders'", PROJECT_STATE)
        self.assertNotIn("state.drawingFolders", APP)
        self.assertNotIn("pandolab_folder_id", INDEX)

    def test_geojson_import_adds_custom_drawings_to_the_flat_list(self):
        importer = APP[APP.index("async function importGeoJson"):APP.index("function gisExportCounts")]
        self.assertIn("drawingApplicationService.addMany(supported)", importer)
        self.assertIn("documentStore.replaceDrawings(normalizeDrawingCollection([...drawings(), ...normalized]))", DRAWING_SERVICE)
        self.assertIn("category: 'custom'", importer)
        self.assertIn("key === 'drawings'", importer)
        self.assertNotIn("createImportedDrawingFolder", importer)

    def test_editor_and_layer_tree_have_no_folder_controls(self):
        self.assertNotIn('id="drawingFolderInput"', INDEX)
        self.assertNotIn("data-drawing-folder-id", APP)
        self.assertNotIn("createDynamicDrawingFolderElement", APP)
        self.assertNotIn("drawingFolderStateKey", APP)


if __name__ == "__main__":
    unittest.main()
