from __future__ import annotations
from tests.application_source import read_application_sources

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class StatusLayoutV0191Tests(unittest.TestCase):
    def test_status_content_uses_one_ordered_inner_row(self):
        inner_start = INDEX.index('<div class="status-inner">')
        status_end = INDEX.index('</main>', inner_start)
        markup = INDEX[inner_start:status_end]
        self.assertLess(markup.index('id="projectSaveStatus"'), markup.index('id="statusView"'))
        self.assertLess(markup.index('id="statusView"'), markup.index('id="statusSelection"'))

    def test_status_bar_has_one_unqualified_base_rule(self):
        self.assertEqual(len(re.findall(r"(?m)^\.map-bottom-status\s*\{", CSS)), 1)
        self.assertIn(".status-inner {", CSS)
        self.assertIn("display: flex;", CSS)
        self.assertIn("left: var(--map-safe-left, 0px);", CSS)
        self.assertIn("right: var(--map-safe-right, 0px);", CSS)

    def test_legacy_distributed_alignment_is_removed(self):
        self.assertNotIn("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);", CSS)
        self.assertNotRegex(CSS, r"\.status-(?:view|primary|selection)\s*\{[^}]*grid-column")
        self.assertNotIn("#selectionStatus { margin-left: auto;", CSS)
        self.assertNotRegex(CSS, r"\.status-primary\s*\{[^}]*border-inline")

    def test_separators_and_status_visibility_follow_preferences(self):
        self.assertIn(".status-group:not(.hidden) ~ .status-group:not(.hidden)::before", CSS)
        self.assertNotIn("#zoomStatus", INDEX + APP + CSS)
        self.assertNotIn('coordStatus', INDEX + APP)
        self.assertNotIn('statusPrimary', INDEX)
        self.assertIn('preferencesStatusBarVisibleInput', INDEX)

    def test_version_is_updated(self):
        self.assertIn('data-app-version="0.30.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)
        self.assertIn("app.css?v=0.30.0-r44", INDEX)


if __name__ == "__main__":
    unittest.main()
