from tests.application_source import element_markup, read_application_sources, read_module, read_ui_sources
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)


class ResponsiveUiV0160Tests(unittest.TestCase):
    def test_three_layout_breakpoints_are_shared_with_runtime(self):
        self.assertIn("window.matchMedia('(max-width: 799px)')", APP)
        self.assertIn("window.matchMedia('(min-width: 800px) and (max-width: 1359px)')", APP)
        self.assertIn('[data-layout="wide"]', CSS)
        self.assertIn('[data-layout="compact"]', CSS)
        self.assertIn('[data-layout="mobile"]', CSS)

    def test_shared_map_controls_have_one_owner(self):
        for element_id in ('createMenuBtn','undoBtn','redoBtn','resetViewBtn','projectionControl'):
            self.assertEqual(INDEX.count(f'id="{element_id}"'), 1)
        self.assertNotIn('id="mapCommandToolbar"', INDEX)
        self.assertIn('ui-floating-toolbar', INDEX)
        self.assertIn('ui-button icon-btn', element_markup(INDEX, 'undoBtn'))
        self.assertNotIn('id="zoomInBtn"', INDEX)
        self.assertNotIn('id="zoomOutBtn"', INDEX)

    def test_map_uses_css_safe_insets_without_mutating_saved_view(self):
        for token in ("--map-safe-left", "--map-safe-right", "currentMapSafeInsets", "contentWidth", "contentHeight"):
            self.assertIn(token, CSS + APP)
        self.assertIn(".workspace.editor-drawer-open", CSS)
        self.assertIn(".workspace.layers-drawer-open", CSS)

    def test_mobile_keeps_bottom_navigation_without_a_compact_duplicate(self):
        self.assertRegex(INDEX, r'class="[^"]*adaptive-nav[^"]*mobile-bottom-bar[^"]*"')
        self.assertNotIn("compact-primary-controls", INDEX + CSS)
        source = (ROOT / "assets/css/components/mobile-sheets.css").read_text(encoding="utf-8")
        self.assertIn('[data-layout="mobile"] .mobile-bottom-bar', source)
        self.assertIn("grid-template-columns: repeat(5, minmax(0, 1fr))", source)
        self.assertIn("if (dependencies.surfaces.layoutMode === 'wide')", APP)

    def test_selection_auto_opens_editor_on_non_wide_layouts(self):
        source = read_module(ROOT, "app-workspace-surfaces.js")
        selection_editor = source[source.index("function openSelectionEditor"):source.index("function openSurface")]
        self.assertIn("layoutMode !== 'wide'", selection_editor)
        self.assertIn("surfaceState.editorManuallyCollapsed", selection_editor)
        self.assertIn("openSurface('editor', { automatic: true })", selection_editor)
        self.assertIn("surfaceController", selection_editor)

    def test_mobile_gesture_scope_keeps_map_gestures_separate(self):
        viewport = (ROOT / "assets/css/components/map-viewport.css").read_text(encoding="utf-8")
        feedback = (ROOT / "assets/css/components/feedback.css").read_text(encoding="utf-8")
        self.assertRegex(viewport, r"\.map-stage\s*\{[^}]*touch-action: none")
        self.assertRegex(viewport, r"\.map-svg\s*\{[^}]*touch-action: none")
        self.assertIn("touch-action: pan-x pan-y", feedback)
        self.assertIn("overscroll-behavior: none", viewport)


if __name__ == "__main__":
    unittest.main()
