from tests.application_source import assert_shell_versions, read_ui_sources
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSS = read_ui_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0171AlignmentTests(unittest.TestCase):
    def test_panel_internal_dividers_are_removed(self):
        self.assertRegex(CSS, r"\.panel-section\s*\{[^}]*border-bottom:\s*0;")
        self.assertRegex(CSS, r"\.editor-disclosure\s*>\s*summary\s*\{[^}]*border:\s*0;")
        self.assertRegex(CSS, r"\.surface-header\s*\{[^}]*border-bottom:\s*0;")

    def test_status_groups_use_one_left_aligned_safe_area_row(self):
        self.assertIn('class="status-inner"', INDEX)
        self.assertIn(".status-inner {", CSS)
        self.assertIn("left: var(--map-safe-left, 0);", CSS)
        self.assertIn("right: var(--map-safe-right, 0);", CSS)
        self.assertIn("display: flex;", CSS)
        self.assertIn("transition: left 170ms ease, right 170ms ease;", CSS)
        self.assertNotIn(".status-view { grid-column:", CSS)
        self.assertNotIn(".status-primary { grid-column:", CSS)
        self.assertNotIn(".status-selection { grid-column:", CSS)
        self.assertNotIn("#selectionStatus { margin-left: auto;", CSS)
        self.assertNotIn(".status-primary { grid-column: 2; justify-self: center; padding-inline: var(--ui-space-3); border-inline:", CSS)

    def test_toolbar_and_scroll_gutters_are_symmetric(self):
        scroll = (ROOT / "assets/css/components/dialogs.css").read_text(encoding="utf-8")
        self.assertIn("scrollbar-width: thin", scroll)
        self.assertNotIn("padding-inline-start: var(--ui-scrollbar-size)", CSS)
        self.assertNotIn("compact-primary-controls", CSS)
        self.assertIn(".map-command-toolbar {", CSS)
        self.assertIn("transform: translateX(-50%)", CSS)

    def test_version_is_updated(self):
        assert_shell_versions(self, ROOT, INDEX)


if __name__ == "__main__":
    unittest.main()
