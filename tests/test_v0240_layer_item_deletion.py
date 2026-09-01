from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")
GENERIC_FEATURE_SERVICE = (ROOT / "assets" / "js" / "modules" / "generic-feature-service.js").read_text(encoding="utf-8")


class V0240LayerItemDeletionTests(unittest.TestCase):
    def test_removed_item_tombstones_are_not_persisted_project_state(self):
        self.assertNotIn("function normalizeRemovedLayerItems(value)", APP)
        self.assertNotIn("name: 'removedLayerItems'", PROJECT_STATE)
        self.assertIn("...pickProjectFields(state", APP)
        self.assertNotIn("state.removedLayerItems", APP)
        self.assertNotIn("isLayerItemRemoved", APP)

    def test_each_supported_object_type_has_a_context_menu_delete_path(self):
        delete_logic = APP[APP.index("function deleteSelectedFromObjectMenu"):APP.index("function batchSetColor")]
        common_delete = APP[APP.index("function removeGenericFeatureById"):APP.index("function deleteSelected()")]
        selected_delete = APP[APP.index("function deleteSelected()"):APP.index("function zoomBy")]
        self.assertIn("requestBatchDelete()", delete_logic)
        self.assertIn("deleteSelectedCountry()", delete_logic)
        self.assertIn("requestTerritorialUnitDivisionRemoval", delete_logic)
        self.assertIn("onConfirm: deleteSelected", delete_logic)
        self.assertIn("openConfirmModal", delete_logic)
        self.assertIn("state.selected.domain === 'generic'", selected_delete)
        self.assertIn("state.selected.domain === 'distribution'", selected_delete)
        self.assertIn("state.selected.domain === 'label'", selected_delete)
        self.assertIn("genericFeatureService.remove", common_delete)
        self.assertIn("documentStore.replaceFeatures(genericFeatures().filter", GENERIC_FEATURE_SERVICE)
        self.assertIn("state.labels = state.labels.filter", common_delete)
        self.assertNotIn("pruneAutoGenericFeatureFolders", common_delete)
        self.assertGreaterEqual(common_delete.count("recordHistory();"), 2)
        self.assertGreaterEqual(common_delete.count("queueAutosave();"), 2)

    def test_selected_deletion_marks_the_tree_dirty_before_clearing_selection(self):
        common_delete = APP[APP.index("function removeGenericFeatureById"):APP.index("function deleteSelected()")]
        genericFeature_delete = common_delete[common_delete.index("function removeGenericFeatureById"):common_delete.index("function removeLabelById")]
        label_delete = common_delete[common_delete.index("function removeLabelById"):]
        for block in (genericFeature_delete, label_delete):
            self.assertLess(block.index("markLayerTreeDirty();"), block.index("clearSelection(false)"))

    def test_per_country_lock_blocks_row_delete(self):
        country_delete = APP[APP.index("function requestDeleteCountry"):APP.index("function deleteSelectedCountry")]
        self.assertIn("requireCountriesUnlocked([key], '삭제')", country_delete)
        self.assertIn("openConfirmModal", country_delete)
        self.assertIn("실행취소로 복구할 수 있습니다", country_delete)
        self.assertIn("objectDeleteMenuBtn", APP)
        self.assertIn("objectRefLocked(primary)", APP)

    def test_built_in_hydro_has_visibility_without_an_object_menu(self):
        row_factory = APP[APP.index("function createLayerItemRow"):APP.index("function renderVirtualizedLayerGroup")]
        self.assertIn("const ref = layerItemObjectRef(itemGroup, item.id)", row_factory)
        self.assertIn("if (hasMenu) row.append(menuButton)", row_factory)
        self.assertIn("group === 'hydro' && HYDRO_LAYER_META[key]", APP)
        self.assertIn("group === 'hydro' && hydroEditById(key)", APP)
        self.assertNotIn("hydro-layer:", APP)

    def test_virtualized_rows_share_the_same_context_menu_factory(self):
        virtualized = APP[APP.index("function renderVirtualizedLayerGroup"):APP.index("function renderLayerFolderContents")]
        self.assertIn("createLayerItemRow(group, items[index])", virtualized)
        self.assertIn("grid-template-columns: var(--ui-tree-action-size) minmax(64px, 1fr) minmax(0, 42%) var(--ui-tree-action-size)", CSS)
        self.assertIn("grid-template-columns: var(--ui-tree-action-size-touch) minmax(0, 1fr) auto var(--ui-tree-action-size-touch)", CSS)
        self.assertIn("#app[data-layout=\"mobile\"] .layer-child-menu", CSS)
        self.assertIn('symbol id="icon-more"', INDEX)


if __name__ == "__main__":
    unittest.main()
