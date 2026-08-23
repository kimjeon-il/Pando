import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class EditorLayoutV0163Tests(unittest.TestCase):
    def test_default_work_state_uses_the_continuous_status_line(self):
        self.assertIn('id="currentToolStatus" class="current-tool-status"', INDEX)
        self.assertIn("$('currentToolStatus').textContent = currentName", APP)
        self.assertIn(".map-context-panel { display: none; }", CSS)
        self.assertIn(".map-context-panel.has-active-context", CSS)

    def test_editor_stops_above_the_status_line_in_every_layout(self):
        self.assertIn('#app[data-layout="wide"] .map-bottom-status { left: var(--panel-left-width); right: 0; }', CSS)
        self.assertIn('#app[data-layout="compact"] .map-bottom-status { left: 0; right: 0; }', CSS)
        self.assertGreaterEqual(CSS.count("bottom: 42px;"), 3)
        self.assertIn("bottom: calc(104px + env(safe-area-inset-bottom));", CSS)

    def test_editor_density_is_compact_without_shrinking_controls(self):
        self.assertIn(".editor-header { padding: 12px 14px 10px; }", CSS)
        self.assertIn(".editor-form { padding: 10px; gap: 9px; }", CSS)
        self.assertIn(".editor-card { padding: 11px; }", CSS)
        self.assertIn(".country-action-btn.annex-action { min-height: 68px; padding: 8px; }", CSS)
        self.assertIn('#app[data-layout="mobile"] .editor-form .field-group input[type="text"]', CSS)


if __name__ == "__main__":
    unittest.main()
