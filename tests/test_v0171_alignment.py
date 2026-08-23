import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0171AlignmentTests(unittest.TestCase):
    def test_panel_internal_dividers_are_removed(self):
        self.assertIn(".panel-section { padding: 15px; border-bottom: 0; }", CSS)
        self.assertIn(".editor-details[open] > summary { border-bottom: 0; }", CSS)
        self.assertIn(".mobile-sheet-header {", CSS)
        self.assertIn("border-bottom: 0;", CSS)

    def test_status_groups_keep_semantic_columns(self):
        self.assertIn(".status-view { grid-column: 1;", CSS)
        self.assertIn(".status-primary { grid-column: 2;", CSS)
        self.assertIn(".status-selection { grid-column: 3;", CSS)
        self.assertIn("padding-left: calc(var(--map-safe-left) + var(--ui-space-3));", CSS)
        self.assertIn("padding-right: calc(var(--map-safe-right) + var(--ui-space-3));", CSS)
        self.assertIn("transition: padding-left 170ms ease, padding-right 170ms ease;", CSS)
        self.assertIn('#app[data-layout="wide"] .map-bottom-status { left: 0; right: 0; }', CSS)

    def test_toolbar_and_scroll_gutters_are_symmetric(self):
        self.assertIn("scrollbar-gutter: stable both-edges", CSS)
        self.assertIn('#app[data-layout="compact"] .map-command-toolbar { left: calc(var(--map-safe-left) + 12px); gap: 0; }', CSS)
        self.assertIn('#app[data-layout="compact"] .map-command-toolbar #redoBtn { margin-left: var(--ui-space-1); }', CSS)
        self.assertIn('#app[data-layout="mobile"] .map-command-toolbar #redoBtn { margin-left: var(--ui-space-1); }', CSS)

    def test_version_is_updated(self):
        self.assertIn('data-app-version="0.18.0"', INDEX)
        self.assertIn("app.css?v=0.18.0", INDEX)


if __name__ == "__main__":
    unittest.main()
