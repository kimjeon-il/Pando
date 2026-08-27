import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class EditorLayoutV0163Tests(unittest.TestCase):
    def test_active_work_uses_one_task_dock_and_the_continuous_status_line(self):
        self.assertIn('id="currentToolStatus" class="current-tool-status"', INDEX)
        self.assertIn("$('currentToolStatus').textContent = currentName", APP)
        self.assertIn('class="mode-task-context"', INDEX)
        self.assertNotIn('id="currentTool"', INDEX)
        self.assertNotIn("map-context-panel", CSS + APP)

    def test_editor_stops_above_the_status_line_in_every_layout(self):
        self.assertIn(".map-bottom-status {", CSS)
        self.assertIn("right: 0;", CSS)
        self.assertIn("left: 0;", CSS)
        self.assertIn(".status-inner {", CSS)
        self.assertGreaterEqual(CSS.count("bottom: var(--ui-control-height);"), 2)
        self.assertIn("bottom: var(--mobile-nav-height);", CSS)
        self.assertIn("border-radius: var(--ui-radius-sheet) var(--ui-radius-sheet) 0 0;", CSS)

    def test_editor_density_is_compact_without_shrinking_controls(self):
        self.assertIn(".editor-view {", CSS)
        self.assertIn("gap: var(--ui-field-gap);", CSS)
        self.assertIn("padding: 0 var(--ui-panel-padding) var(--ui-panel-padding);", CSS)
        self.assertIn(".editor-section,\n.editor-danger-zone {", CSS)
        self.assertIn(".editor-action-button {", CSS)
        self.assertIn('--ui-control-height: 42px;', CSS)
        self.assertIn('--ui-touch-height: 48px;', CSS)


if __name__ == "__main__":
    unittest.main()
