from tests.application_source import element_markup, read_application_sources, read_module, read_ui_sources
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)


class MobileStatusV0164Tests(unittest.TestCase):
    def test_status_bar_has_save_view_and_selection_groups_in_one_inner_row(self):
        self.assertIn('class="status-inner"', INDEX)
        self.assertIn('id="projectSaveStatus" class="ui-status status-group project-save-status"', INDEX)
        self.assertIn('class="status-group status-view"', INDEX)
        self.assertIn('class="status-group status-selection hidden"', INDEX)
        self.assertNotIn('id="statusPrimary"', INDEX)
        self.assertNotIn('id="coordStatus"', INDEX)
        self.assertIn(".status-group:not(.hidden) ~ .status-group:not(.hidden)::before", CSS)
        self.assertNotIn("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);", CSS)

    def test_status_background_reaches_edges_and_content_uses_safe_insets(self):
        self.assertIn(".map-bottom-status {", CSS)
        self.assertIn("left: var(--map-safe-left, 0);", CSS)
        self.assertIn("right: var(--map-safe-right, 0);", CSS)
        self.assertNotIn('.app-root[data-layout="compact"] .map-bottom-status { left: 0; right: 0; }', CSS)

    def test_mobile_sheet_header_uses_one_shared_row(self):
        layout = (ROOT / "assets/css/layout/surfaces.css").read_text(encoding="utf-8")
        self.assertRegex(layout, r'\[data-layout="mobile"\] \.surface-header\s*\{[^}]*display: grid')
        self.assertIn("grid-template-columns: minmax(0, 1fr)", layout)
        self.assertIn("grid-template-rows: minmax(var(--ui-touch-height), auto)", layout)
        self.assertIn("min-height: var(--ui-touch-height)", layout)
        self.assertIn("touch-action: none", layout)
        self.assertIn("100dvh - var(--ui-shell-topbar-height) - var(--mobile-nav-height)", layout)

    def test_history_controls_are_shared_and_call_the_project_domain(self):
        self.assertNotIn("history-empty", INDEX)
        self.assertNotIn('id="mapCommandToolbar"', INDEX)
        self.assertEqual(INDEX.count('id="undoBtn"'), 1)
        self.assertEqual(INDEX.count('id="redoBtn"'), 1)
        self.assertIn("ui-button icon-btn", element_markup(INDEX, "undoBtn"))
        self.assertIn("undo: metadata => travelHistory('undo', metadata)", read_module(ROOT,'project-domain.js'))
        self.assertIn("redo: metadata => travelHistory('redo', metadata)", read_module(ROOT,'project-domain.js'))


if __name__ == "__main__":
    unittest.main()
