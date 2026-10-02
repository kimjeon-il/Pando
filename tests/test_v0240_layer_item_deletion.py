from __future__ import annotations
from tests.application_source import read_application_sources

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")


class V0240LayerItemDeletionTests(unittest.TestCase):
    def test_removed_item_tombstones_are_not_persisted_project_state(self):
        self.assertNotIn("function normalizeRemovedLayerItems(value)", APP)
        self.assertNotIn("name: 'removedLayerItems'", PROJECT_STATE)
        self.assertIn("...pickProjectFields(state", APP)
        self.assertNotIn("state.removedLayerItems", APP)
        self.assertNotIn("isLayerItemRemoved", APP)

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
