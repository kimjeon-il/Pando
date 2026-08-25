from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")


class V0192LayerControlTests(unittest.TestCase):
    def test_layer_groups_use_one_folder_icon(self):
        self.assertIn('symbol id="icon-folder"', INDEX)
        self.assertEqual(INDEX.count('class="ui-icon layer-folder-icon"'), 7)
        self.assertEqual(INDEX.count('<use href="#icon-folder"/>'), 9)
        self.assertNotIn('class="layer-icon', INDEX)
        self.assertNotIn(".layer-icon", CSS)
        self.assertNotIn("layer-child-swatch", APP)
        self.assertNotIn(".layer-child-swatch", CSS)

    def test_country_lock_uses_open_and_closed_icons(self):
        self.assertIn('symbol id="icon-lock-open"', INDEX)
        self.assertIn('symbol id="icon-lock-closed"', INDEX)
        self.assertIn('class="layer-lock-control"', INDEX)
        self.assertIn('id="countriesLocked" type="checkbox" class="lock-toggle"', INDEX)
        self.assertIn(".lock-toggle:checked ~ .lock-open-icon", CSS)
        self.assertIn(".lock-toggle:checked ~ .lock-closed-icon", CSS)
        self.assertNotIn(".layer-folder-name::after", CSS)
        self.assertNotRegex(CSS, r'content:\s*["\']\s*잠금')
        self.assertIn("$('countriesLocked').addEventListener('change'", APP)

    def test_checkbox_uses_one_border_and_matching_checked_fill(self):
        base_rule = re.search(r'input\[type="checkbox"\]\s*\{([^}]*)\}', CSS)
        self.assertIsNotNone(base_rule)
        self.assertIn("box-shadow: none", base_rule.group(1))
        checkbox_rule = re.search(r'input\[type="checkbox"\]:checked\s*\{([^}]*)\}', CSS)
        self.assertIsNotNone(checkbox_rule)
        rule = checkbox_rule.group(1)
        self.assertIn("border-color: var(--accent-surface)", rule)
        self.assertIn("background: var(--accent-surface)", rule)
        self.assertIn("box-shadow: inset 0 0 0 1px var(--inset-highlight)", CSS)
        self.assertRegex(CSS, r'input\[type="radio"\]:checked\s*\{[^}]*border-color:\s*var\(--accent-border\)')

    def test_layer_children_have_delete_actions_without_duplicate_copy(self):
        tree_items = APP[APP.index("function layerTreeItems"):APP.index("function pruneLayerItemVisibility")]
        self.assertNotIn("사용자 지형지물", tree_items)
        self.assertNotIn("'국명'", tree_items)
        self.assertIn("'계산 중'", tree_items)
        self.assertIn('symbol id="icon-trash"', INDEX)
        self.assertIn("deleteButton.className = 'ui-button layer-child-delete'", APP)
        self.assertIn("deleteLayerTreeItem(deleteButton.dataset.layerItemDelete", APP)
        self.assertIn(".layer-child-delete", CSS)

    def test_build_version_is_updated(self):
        self.assertIn('data-app-version="0.24.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.24.0'", APP)


if __name__ == "__main__":
    unittest.main()
