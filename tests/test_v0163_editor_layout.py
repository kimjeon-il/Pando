from tests.application_source import read_application_sources, read_ui_sources
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)


class EditorLayoutV0163Tests(unittest.TestCase):
    def test_active_work_uses_one_task_dock_and_the_continuous_status_line(self):
        self.assertNotIn('id="currentToolStatus" class="current-tool-status"', INDEX)
        self.assertNotIn('id="statusPrimary"', INDEX)
        self.assertIn('class="mode-editing-context hidden"', INDEX)
        self.assertNotIn('id="currentTool"', INDEX)
        self.assertNotIn("map-context-panel", CSS + APP)

    def test_editor_stops_above_the_status_line_in_every_layout(self):
        layout = (ROOT / 'assets/css/layout/surfaces.css').read_text(encoding='utf-8')
        self.assertIn('bottom: var(--ui-shell-statusbar-height)', layout)
        self.assertIn('[data-layout="wide"] .workspace-surface', layout)
        self.assertIn('[data-layout="compact"] .workspace-surface', layout)
        self.assertIn('[data-layout="mobile"] .workspace-surface', layout)
        self.assertIn('bottom: var(--mobile-nav-height)', layout)
        self.assertIn('--ui-surface-radius-top-left: var(--ui-radius-sheet)', layout)
        self.assertIn('--ui-surface-radius-top-right: var(--ui-radius-sheet)', layout)

    def test_editor_density_is_compact_without_shrinking_controls(self):
        self.assertIn(".editor-view {", CSS)
        self.assertIn("gap: var(--ui-space-6);", CSS)
        self.assertIn("padding-inline-end: var(--ui-surface-content-rail-x);", CSS)
        self.assertIn("padding-inline-start: var(--ui-surface-content-rail-x);", CSS)
        self.assertIn("padding-block: 0 var(--ui-surface-content-padding-bottom);", CSS)
        self.assertIn(".editor-section {", CSS)
        self.assertIn(".editor-action-row {", CSS)
        self.assertIn('--ui-control-height: var(--design-control-md);', CSS)
        self.assertIn('--ui-touch-height: var(--design-touch-height);', CSS)


if __name__ == "__main__":
    unittest.main()
