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

    def test_each_supported_object_type_has_a_context_menu_delete_path(self):
        delete_logic = APP[APP.index("function deleteSelectedFromObjectMenu"):APP.index("function batchSetColor")]
        common_delete = APP[APP.index("function removeDrawingById"):APP.index("function deleteSelected()")]
        selected_delete = APP[APP.index("function deleteSelected()"):APP.index("function zoomBy")]
        self.assertIn("requestBatchDelete()", delete_logic)
        self.assertIn("deleteSelectedCountry()", delete_logic)
        self.assertIn("requestCountryRegionDivisionRemoval", delete_logic)
        self.assertIn("onConfirm: deleteSelected", delete_logic)
        self.assertIn("openConfirmModal", delete_logic)
        self.assertIn("state.selected.type === 'drawing'", selected_delete)
        self.assertIn("state.selected.type === 'distribution'", selected_delete)
        self.assertIn("state.selected.type === 'label'", selected_delete)
        self.assertIn("state.drawings = state.drawings.filter", common_delete)
        self.assertIn("state.labels = state.labels.filter", common_delete)
        self.assertIn("pruneAutoDrawingFolders();", common_delete)
        self.assertGreaterEqual(common_delete.count("recordHistory();"), 2)
        self.assertGreaterEqual(common_delete.count("queueAutosave();"), 2)

    def test_selected_deletion_marks_the_tree_dirty_before_clearing_selection(self):
        common_delete = APP[APP.index("function removeDrawingById"):APP.index("function deleteSelected()")]
        drawing_delete = common_delete[common_delete.index("function removeDrawingById"):common_delete.index("function removeLabelById")]
        label_delete = common_delete[common_delete.index("function removeLabelById"):]
        for block in (drawing_delete, label_delete):
            self.assertLess(block.index("markLayerTreeDirty();"), block.index("clearSelection(false)"))

    def test_country_lock_blocks_row_delete(self):
        country_delete = APP[APP.index("function requestDeleteCountry"):APP.index("function deleteSelectedCountry")]
        self.assertIn("if (state.countriesLocked)", country_delete)
        self.assertIn("openConfirmModal", country_delete)
        self.assertIn("실행취소로 복구할 수 있습니다", country_delete)
        self.assertIn("objectDeleteMenuBtn", APP)
        self.assertIn("objectRefLocked(primary)", APP)

    def test_virtualized_rows_share_the_same_context_menu_factory(self):
        virtualized = APP[APP.index("function renderVirtualizedLayerGroup"):APP.index("function renderTerrainLayerFolder")]
        self.assertIn("createLayerItemRow(group, items[index])", virtualized)
        self.assertIn("grid-template-columns: var(--ui-tree-check-size) minmax(0, 1fr) auto var(--ui-tree-action-size)", CSS)
        self.assertIn("#app[data-layout=\"mobile\"] .layer-child-menu", CSS)
        self.assertIn('symbol id="icon-more"', INDEX)


if __name__ == "__main__":
    unittest.main()
