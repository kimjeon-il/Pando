from __future__ import annotations

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class StatusLayoutV0191Tests(unittest.TestCase):
    def test_status_content_uses_one_ordered_inner_row(self):
        inner_start = INDEX.index('<div class="status-inner">')
        status_end = INDEX.index('</main>', inner_start)
        markup = INDEX[inner_start:status_end]
        self.assertLess(markup.index('id="statusView"'), markup.index('id="statusPrimary"'))
        self.assertLess(markup.index('id="statusPrimary"'), markup.index('id="statusSelection"'))

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

    def test_separators_and_mobile_coordinate_priority_follow_visibility(self):
        self.assertIn(".status-group:not(.hidden) ~ .status-group:not(.hidden)::before", CSS)
        self.assertIn(".status-item:not(.hidden) ~ .status-item:not(.hidden)::before", CSS)
        self.assertNotIn("#zoomStatus", INDEX + APP + CSS)
        self.assertIn("$('statusView')?.classList.toggle('coordinates-active', showCoordinates);", APP)

    def test_version_is_updated(self):
        self.assertIn('data-app-version="0.30.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)
        self.assertIn("app.css?v=0.30.0-r28", INDEX)


if __name__ == "__main__":
    unittest.main()
