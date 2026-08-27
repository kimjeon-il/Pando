from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")


class V0240LayerItemDeletionTests(unittest.TestCase):
    def test_removed_items_are_optional_persisted_project_state(self):
        self.assertIn("function normalizeRemovedLayerItems(value)", APP)
        self.assertIn("name: 'removedLayerItems', history: true", PROJECT_STATE)
        self.assertIn("...pickProjectFields(state", APP)
        self.assertIn("removedLayerItems: value => normalizeRemovedLayerItems(value)", APP)
        self.assertIn("normalizeRemovedLayerItems(null)", APP)

    def test_each_supported_layer_type_has_a_delete_path(self):
        delete_logic = APP[APP.index("function deleteLayerTreeItem"):APP.index("function deleteSelected()")]
        common_delete = APP[APP.index("function removeDrawingById"):APP.index("function deleteLayerTreeItem")]
        self.assertIn("deleteTerritorialUnit(TERRITORIAL_UNIT_TYPES.COUNTRY, key)", delete_logic)
        self.assertIn("group === 'historicalRegions'", delete_logic)
        self.assertIn("state.removedLayerItems.drawings[key] = true", delete_logic)
        self.assertIn("state.removedLayerItems.countryLabels[key] = true", delete_logic)
        self.assertIn("removeDrawingById(key", delete_logic)
        self.assertIn("removeLabelById(key", delete_logic)
        self.assertIn("state.drawings = state.drawings.filter", common_delete)
        self.assertIn("state.labels = state.labels.filter", common_delete)
        self.assertIn("pruneAutoDrawingFolders();", common_delete)
        self.assertGreaterEqual(delete_logic.count("recordHistory();") + common_delete.count("recordHistory();"), 4)
        self.assertGreaterEqual(delete_logic.count("queueAutosave();") + common_delete.count("queueAutosave();"), 4)

    def test_selected_deletion_marks_the_tree_dirty_before_clearing_selection(self):
        common_delete = APP[APP.index("function removeDrawingById"):APP.index("function deleteLayerTreeItem")]
        drawing_delete = common_delete[common_delete.index("function removeDrawingById"):common_delete.index("function removeLabelById")]
        label_delete = common_delete[common_delete.index("function removeLabelById"):]
        for block in (drawing_delete, label_delete):
            self.assertLess(block.index("markLayerTreeDirty();"), block.index("clearSelection(false)"))

    def test_country_lock_blocks_row_delete(self):
        country_delete = APP[APP.index("function requestDeleteCountry"):APP.index("function deleteSelectedCountry")]
        self.assertIn("if (state.countriesLocked)", country_delete)
        self.assertIn("openConfirmModal", country_delete)
        self.assertIn("실행취소로 복구할 수 있습니다", country_delete)
        self.assertIn("deleteButton.disabled = group === 'countries' && state.countriesLocked", APP)

    def test_virtualized_rows_share_the_same_delete_button_factory(self):
        virtualized = APP[APP.index("function renderVirtualizedLayerGroup"):APP.index("function renderTerrainLayerFolder")]
        self.assertIn("createLayerItemRow(group, items[index])", virtualized)
        self.assertIn("grid-template-columns: var(--ui-tree-check-size) minmax(0, 1fr) auto var(--ui-tree-action-size)", CSS)
        self.assertIn("#app[data-layout=\"mobile\"] .layer-child-delete", CSS)
        self.assertIn('symbol id="icon-trash"', INDEX)


if __name__ == "__main__":
    unittest.main()
