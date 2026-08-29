from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")


class V0192LayerControlTests(unittest.TestCase):
    def test_layer_groups_do_not_repeat_folder_icons(self):
        self.assertNotIn('symbol id="icon-folder"', INDEX)
        self.assertEqual(INDEX.count('class="ui-icon layer-folder-icon"'), 0)
        self.assertEqual(INDEX.count('<use href="#icon-folder"/>'), 0)
        self.assertNotIn('class="layer-icon', INDEX)
        self.assertNotIn(".layer-icon", CSS)
        self.assertNotIn("layer-child-swatch", APP)
        self.assertNotIn(".layer-child-swatch", CSS)

    def test_country_lock_is_only_an_object_menu_action(self):
        self.assertIn('symbol id="icon-lock-open"', INDEX)
        self.assertIn('symbol id="icon-lock-closed"', INDEX)
        self.assertNotIn('id="countriesLocked"', INDEX)
        self.assertIn('id="objectLockMenuBtn"', INDEX)
        self.assertNotIn(".layer-folder-name::after", CSS)
        self.assertNotRegex(CSS, r'content:\s*["\']\s*잠금')
        self.assertNotIn("state.countriesLocked", APP)
        self.assertIn("function isCountryLocked(id)", APP)

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

    def test_layer_visibility_uses_eye_icons_without_changing_checkbox_state(self):
        self.assertEqual(INDEX.count('class="layer-visibility-toggle"'), 8)
        self.assertEqual(INDEX.count('class="layer-visibility-control"'), 8)
        self.assertIn('symbol id="icon-eye"', INDEX)
        self.assertIn('symbol id="icon-eye-off"', INDEX)
        self.assertIn('.layer-visibility-control:has(.layer-visibility-toggle:not(:checked))', CSS)
        self.assertIn("visibility.className = 'layer-visibility-toggle'", APP)
        self.assertIn("createSvgIcon(document, 'icon-eye'", APP)
        self.assertIn('function syncLayerVisibilityToggle(input)', APP)
        self.assertIn("input.dataset.tooltip = input.checked ? `${label} 숨기기` : `${label} 표시`", APP)

    def test_layer_children_use_context_menus_without_duplicate_copy(self):
        tree_items = APP[APP.index("function layerTreeItems"):APP.index("function pruneLayerItemVisibility")]
        self.assertNotIn("사용자 지형지물", tree_items)
        self.assertNotIn("'국명'", tree_items)
        self.assertIn("'계산 중'", tree_items)
        self.assertIn('symbol id="icon-more"', INDEX)
        self.assertIn("menuButton.className = 'ui-button layer-child-menu'", APP)
        self.assertIn("openObjectActionsMenu();", APP)
        self.assertIn(".layer-child-menu", CSS)

    def test_build_version_is_updated(self):
        self.assertIn('data-app-version="0.30.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)


if __name__ == "__main__":
    unittest.main()
