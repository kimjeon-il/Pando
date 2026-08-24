import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0171AlignmentTests(unittest.TestCase):
    def test_panel_internal_dividers_are_removed(self):
        self.assertIn(".panel-section { padding: 15px; border-bottom: 0; }", CSS)
        self.assertIn(".editor-disclosure > summary {", CSS)
        disclosure_rules = CSS[CSS.rindex(".editor-disclosure > summary {"):]
        self.assertIn("border: 0;", disclosure_rules[:500])
        self.assertIn(".mobile-sheet-header {", CSS)
        self.assertIn("border-bottom: 0;", CSS)

    def test_status_groups_use_one_left_aligned_safe_area_row(self):
        self.assertIn('class="status-inner"', INDEX)
        self.assertIn(".status-inner {", CSS)
        self.assertIn("left: var(--map-safe-left, 0px);", CSS)
        self.assertIn("right: var(--map-safe-right, 0px);", CSS)
        self.assertIn("display: flex;", CSS)
        self.assertIn("transition: left 170ms ease, right 170ms ease;", CSS)
        self.assertNotIn(".status-view { grid-column:", CSS)
        self.assertNotIn(".status-primary { grid-column:", CSS)
        self.assertNotIn(".status-selection { grid-column:", CSS)
        self.assertNotIn("#selectionStatus { margin-left: auto;", CSS)
        self.assertNotIn(".status-primary { grid-column: 2; justify-self: center; padding-inline: var(--ui-space-3); border-inline:", CSS)

    def test_toolbar_and_scroll_gutters_are_symmetric(self):
        self.assertIn("scrollbar-gutter: stable both-edges", CSS)
        self.assertIn('#app[data-layout="compact"] .map-command-toolbar { left: calc(var(--map-safe-left) + 12px); gap: 0; }', CSS)
        self.assertIn('#app[data-layout="compact"] .map-command-toolbar #redoBtn { margin-left: var(--ui-space-1); }', CSS)
        self.assertIn('#app[data-layout="mobile"] .map-command-toolbar #redoBtn { margin-left: var(--ui-space-1); }', CSS)

    def test_version_is_updated(self):
        self.assertIn('data-app-version="0.22.0"', INDEX)
        self.assertIn("app.css?v=0.22.0", INDEX)


if __name__ == "__main__":
    unittest.main()
