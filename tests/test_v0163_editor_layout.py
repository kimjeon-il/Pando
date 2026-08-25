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
        self.assertGreaterEqual(CSS.count("bottom: 42px;"), 3)
        self.assertIn("bottom: var(--mobile-nav-height);", CSS)
        self.assertIn("border-radius: 16px 16px 0 0;", CSS)

    def test_editor_density_is_compact_without_shrinking_controls(self):
        self.assertIn(".editor-view {", CSS)
        self.assertIn("gap: 12px;", CSS)
        self.assertIn("padding: 0 16px 16px;", CSS)
        self.assertIn(".editor-section,\n.editor-danger-zone {", CSS)
        self.assertIn(".editor-action-button {", CSS)
        self.assertIn('#app[data-layout="mobile"] .editor-field input[type="text"]', CSS)


if __name__ == "__main__":
    unittest.main()
