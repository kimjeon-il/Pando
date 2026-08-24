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
        self.assertEqual(INDEX.count('class="ui-icon layer-folder-icon"'), 5)
        self.assertEqual(INDEX.count('<use href="#icon-folder"/>'), 5)
        self.assertNotIn('class="layer-icon', INDEX)
        self.assertNotIn(".layer-icon", CSS)

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

    def test_checked_checkbox_keeps_neutral_outer_border(self):
        checkbox_rule = re.search(r'input\[type="checkbox"\]:checked\s*\{([^}]*)\}', CSS)
        self.assertIsNotNone(checkbox_rule)
        rule = checkbox_rule.group(1)
        self.assertIn("border-color: var(--ui-control-border-hover)", rule)
        self.assertIn("background: var(--accent-surface)", rule)
        self.assertNotIn("border-color: var(--accent-border)", rule)
        self.assertRegex(CSS, r'input\[type="radio"\]:checked\s*\{[^}]*border-color:\s*var\(--accent-border\)')

    def test_build_version_is_updated(self):
        self.assertIn('data-app-version="0.21.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.21.0'", APP)


if __name__ == "__main__":
    unittest.main()
