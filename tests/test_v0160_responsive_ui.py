import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class ResponsiveUiV0160Tests(unittest.TestCase):
    def test_three_layout_breakpoints_are_shared_with_runtime(self):
        self.assertIn("window.matchMedia('(max-width: 799px)')", APP)
        self.assertIn("window.matchMedia('(min-width: 800px) and (max-width: 1359px)')", APP)
        self.assertIn('#app[data-layout="wide"]', CSS)
        self.assertIn('#app[data-layout="compact"]', CSS)
        self.assertIn('#app[data-layout="mobile"]', CSS)

    def test_map_controls_are_split_without_changing_existing_ids(self):
        self.assertIn('id="mapCommandToolbar"', INDEX)
        self.assertIn('id="mapViewToolbar"', INDEX)
        for element_id in ("createMenuBtn", "undoBtn", "redoBtn", "zoomOutBtn", "zoomInBtn", "resetViewBtn", "projectionControl", "togglePanelBtn"):
            self.assertEqual(INDEX.count(f'id="{element_id}"'), 1)

    def test_map_uses_css_safe_insets_without_mutating_saved_view(self):
        for token in ("--map-safe-left", "--map-safe-right", "currentMapSafeInsets", "contentWidth", "contentHeight"):
            self.assertIn(token, CSS + APP)
        self.assertIn(".workspace.editor-drawer-open", CSS)
        self.assertIn(".workspace.layers-drawer-open", CSS)

    def test_compact_uses_rail_and_mobile_keeps_bottom_navigation(self):
        self.assertIn('class="adaptive-nav mobile-bottom-bar"', INDEX)
        self.assertIn('#app[data-layout="compact"] .adaptive-nav', CSS)
        self.assertIn('#app[data-layout="mobile"] .adaptive-nav', CSS)
        self.assertIn("if (layoutMode === 'wide')", APP)

    def test_selection_editor_only_auto_opens_in_wide_layout(self):
        self.assertIn("if (layoutMode === 'wide')", APP[APP.index("function openSelectionEditor"):APP.index("function toggleEditorPanel")])
        self.assertIn("editorPanelOpenReason = 'auto'", APP)
        self.assertIn("needs-attention", APP)


if __name__ == "__main__":
    unittest.main()
