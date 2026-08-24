from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0240LayerItemDeletionTests(unittest.TestCase):
    def test_removed_items_are_optional_persisted_project_state(self):
        self.assertIn("function normalizeRemovedLayerItems(value)", APP)
        self.assertIn("removedLayerItems: state.removedLayerItems", APP)
        self.assertIn("removedLayerItems: deepClone(state.removedLayerItems)", APP)
        self.assertIn("normalizeRemovedLayerItems(project.removedLayerItems)", APP)
        self.assertIn("normalizeRemovedLayerItems(restored.removedLayerItems)", APP)
        self.assertIn("normalizeRemovedLayerItems(null)", APP)

    def test_each_supported_layer_type_has_a_delete_path(self):
        delete_logic = APP[APP.index("function deleteLayerTreeItem"):APP.index("function deleteSelected()")]
        self.assertIn("requestDeleteCountry(key)", delete_logic)
        self.assertIn("state.removedLayerItems.drawings[key] = true", delete_logic)
        self.assertIn("state.removedLayerItems.countryLabels[key] = true", delete_logic)
        self.assertIn("state.drawings = state.drawings.filter", delete_logic)
        self.assertIn("state.labels = state.labels.filter", delete_logic)
        self.assertGreaterEqual(delete_logic.count("recordHistory();"), 4)
        self.assertGreaterEqual(delete_logic.count("queueAutosave();"), 4)

    def test_country_lock_blocks_row_delete(self):
        country_delete = APP[APP.index("function requestDeleteCountry"):APP.index("function deleteSelectedCountry")]
        self.assertIn("if (state.countriesLocked)", country_delete)
        self.assertIn("openConfirmModal", country_delete)
        self.assertIn("실행취소로 복구할 수 있습니다", country_delete)
        self.assertIn("deleteButton.disabled = group === 'countries' && state.countriesLocked", APP)

    def test_virtualized_rows_share_the_same_delete_button_factory(self):
        virtualized = APP[APP.index("function renderVirtualizedLayerGroup"):APP.index("function renderTerrainLayerFolder")]
        self.assertIn("createLayerItemRow(group, items[index])", virtualized)
        self.assertIn("grid-template-columns: 18px minmax(0, 1fr) auto var(--ui-control-height)", CSS)
        self.assertIn("#app[data-layout=\"mobile\"] .layer-child-delete", CSS)
        self.assertIn('symbol id="icon-trash"', INDEX)


if __name__ == "__main__":
    unittest.main()
