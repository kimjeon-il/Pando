from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")


class V0241DrawingFolderTests(unittest.TestCase):
    def test_drawing_folders_are_optional_history_and_project_state(self):
        self.assertIn("name: 'drawingFolders', history: true, fallback: () => []", PROJECT_STATE)
        self.assertIn("drawingFolders: value => normalizeDrawingFolders(value)", APP)
        self.assertIn("state.drawingFolders = []", APP)

    def test_geojson_import_creates_a_file_folder_and_assigns_every_feature(self):
        importer = APP[APP.index("async function importGeoJson"):APP.index("function exportDrawingsGeoJson")]
        self.assertIn("createImportedDrawingFolder(file.name)", importer)
        self.assertIn("pandolab_folder_id: folder.id", importer)
        self.assertIn("state.drawingFolders.push(folder)", importer)
        self.assertIn("state.drawings.push(...supported)", importer)

    def test_editor_can_move_drawings_between_drawing_folders(self):
        self.assertIn('id="drawingFolderInput"', INDEX)
        self.assertIn("{ id: 'drawingFolderInput', field: 'pandolab_folder_id', commit: commitDrawingMeta }", APP)
        self.assertIn("if (value === DEFAULT_DRAWING_FOLDER_ID) delete f.properties.pandolab_folder_id", APP)
        self.assertIn("pruneAutoDrawingFolders();", APP)

    def test_dynamic_folders_reuse_the_common_layer_folder_components(self):
        dynamic_folder = APP[APP.index("function createDynamicDrawingFolderElement"):APP.index("function renderLayerTree")]
        self.assertIn("element.className = 'layer-folder'", dynamic_folder)
        self.assertIn("row.className = 'ui-row layer-folder-row'", dynamic_folder)
        self.assertIn("children.className = 'layer-children'", dynamic_folder)


if __name__ == "__main__":
    unittest.main()
