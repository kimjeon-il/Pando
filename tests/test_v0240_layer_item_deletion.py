from __future__ import annotations
from tests.application_source import function_source, read_application_sources, read_module, read_ui_sources

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets" / "js" / "modules" / "project-state.js").read_text(encoding="utf-8")


class V0240LayerItemDeletionTests(unittest.TestCase):
    def test_removed_item_tombstones_are_not_persisted_project_state(self):
        self.assertNotIn("name: 'removedLayerItems'", PROJECT_STATE)
        self.assertNotIn('state.removedLayerItems', APP)
        self.assertNotIn('isLayerItemRemoved', APP)
        serializer = read_module(ROOT, 'app-map-settings.js')
        self.assertIn('dependencies.projectServices.pickProjectFields', serializer)
        self.assertIn('dependencies.projectState.state', serializer)

    def test_built_in_hydro_has_visibility_without_an_object_menu(self):
        search = read_module(ROOT, 'layer-tree-controller.js')
        row = function_source(search, 'rowFor')
        self.assertIn("row.setAttribute('role', 'option')", row)
        self.assertIn('objectSearchSelect', row)
        self.assertIn('objectSearchFocus', row)
        self.assertNotIn('locked', row)
        self.assertNotIn('visibility', row)
        self.assertIn('id="objectVisibilityBtn"', INDEX)
        self.assertIn('id="objectLockBtn"', INDEX)

    def test_virtualized_rows_share_the_same_context_menu_factory(self):
        search = read_module(ROOT, 'layer-tree-controller.js')
        commit = function_source(search, 'commitRows')
        self.assertIn('rows.map(rowFor)', commit)
        self.assertNotIn('createLayerItemRow', APP)
        self.assertNotIn('renderVirtualizedLayerGroup', APP)
        self.assertIn('.layer-search-result', CSS)
        self.assertIn('objectSearchSelect', search)
        self.assertIn('objectSearchFocus', search)


if __name__ == "__main__":
    unittest.main()
