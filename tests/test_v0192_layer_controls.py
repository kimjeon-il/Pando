from __future__ import annotations
from tests.application_source import assert_shell_versions, element_markup, function_source, read_application_sources, read_module, read_ui_sources

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = read_ui_sources(ROOT)
APP = read_application_sources(ROOT)


class V0192LayerControlTests(unittest.TestCase):
    def test_layer_groups_do_not_repeat_folder_icons(self):
        self.assertNotIn('symbol id="icon-folder"', INDEX)
        self.assertEqual(INDEX.count('class="ui-icon layer-folder-icon"'), 0)
        self.assertEqual(INDEX.count('<use href="#icon-folder"/>'), 0)
        self.assertNotIn('class="layer-icon', INDEX)
        self.assertNotIn(".layer-icon", CSS)
        self.assertNotIn("layer-child-swatch", APP)
        self.assertNotIn(".layer-child-swatch", CSS)

    def test_lock_is_owned_by_the_object_action_toolbar(self):
        self.assertIn('symbol id="icon-lock-open"', INDEX)
        self.assertIn('symbol id="icon-lock-closed"', INDEX)
        self.assertNotIn('id="countriesLocked"', INDEX)
        self.assertIn('id="objectLockBtn"', INDEX)
        self.assertNotIn(".layer-folder-name::after", CSS)
        self.assertNotRegex(CSS, r'content:\s*["\']\s*잠금')
        self.assertNotIn("state.countriesLocked", APP)

    def test_checkbox_uses_one_border_and_matching_checked_fill(self):
        controls = (ROOT / 'assets/css/primitives/controls.css').read_text(encoding='utf-8')
        base_rules = re.findall(r'input\[type="checkbox"\]\s*\{([^}]*)\}', controls)
        self.assertTrue(base_rules)
        self.assertIn("box-shadow: none", '\n'.join(base_rules))
        self.assertIn("border: 1px solid", controls)
        checkbox_rule = re.search(r'input\[type="checkbox"\]:checked\s*\{([^}]*)\}', CSS)
        self.assertIsNotNone(checkbox_rule)
        rule = checkbox_rule.group(1)
        self.assertIn("border-color: var(--accent-surface)", rule)
        self.assertIn("background: var(--accent-surface)", rule)
        self.assertIn("box-shadow: inset 0 0 0 1px var(--inset-highlight)", CSS)
        self.assertRegex(CSS, r'input\[type="radio"\]:checked\s*\{[^}]*border-color:\s*var\(--accent-surface\)')

    def test_layer_visibility_uses_eye_icons_without_changing_checkbox_state(self):
        visibility = element_markup(INDEX,'objectVisibilityBtn')
        self.assertIn('aria-pressed="false"', visibility)
        self.assertIn('href="#icon-eye"', visibility)
        self.assertIn('symbol id="icon-eye-off"', INDEX)
        self.assertIn('data-layer-visibility="countries"', INDEX)
        self.assertIn('data-layer-visibility="rivers"', INDEX)
        self.assertIn('data-layer-visibility="lakes"', INDEX)
        self.assertNotIn('class="layer-visibility-toggle"', INDEX)
        setter = function_source(read_module(ROOT,'app-map-settings.js'),'setLayerVisibility')
        self.assertIn('dependencies.projectState.state.layerVisibility[key] = visible', setter)
        self.assertIn('queuePresentationAutosave()', setter)
        self.assertNotIn('.checked =', setter)

    def test_search_rows_only_select_and_focus_objects(self):
        search = read_module(ROOT,'layer-tree-controller.js')
        row = function_source(search,'rowFor')
        self.assertIn('layer-search-result-select', row)
        self.assertIn('layer-search-focus-action', row)
        self.assertIn("row.setAttribute('aria-selected'", row)
        self.assertNotIn('menuButton', row)
        self.assertNotIn('locked', row)
        self.assertNotIn('visibility', row)

    def test_build_version_is_updated(self):
        assert_shell_versions(self, ROOT, INDEX)


if __name__ == "__main__":
    unittest.main()
