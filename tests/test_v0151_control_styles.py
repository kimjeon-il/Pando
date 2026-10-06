from tests.application_source import element_markup, read_application_sources, read_ui_sources
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
CSS = read_ui_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0151ControlStyleTests(unittest.TestCase):
    def test_projection_buttons_are_compact_but_mobile_labels_remain(self):
        source = (ROOT / "assets/css/components/panels.css").read_text(encoding="utf-8")
        self.assertIn(".map-view-projection-slot .projection-btn", source)
        self.assertIn("min-height: var(--design-command-row-min-height)", source)
        self.assertIn("grid-template-columns: repeat(2, minmax(0, 1fr))", source)
        self.assertRegex(source, r"\.projection-btn > span\s*\{\s*display: inline")
        self.assertIn('aria-label="지구본 투영"', INDEX)
        self.assertIn('aria-label="평면지도 투영"', INDEX)

    def test_layer_search_uses_shared_svg_icon(self):
        self.assertIn('<symbol id="icon-search"', INDEX)
        self.assertIn('class="ui-icon layer-search-icon"', INDEX)
        self.assertNotIn('<span aria-hidden="true">⌕</span>', INDEX)
        self.assertIn(".layer-search-icon {", CSS)
        self.assertIn("width: var(--ui-icon-size);", CSS)

    def test_mobile_auxiliary_buttons_use_theme_tokens(self):
        for element_id in ('resetViewBtn','objectSearchBtn','createMenuBtn'):
            markup = element_markup(INDEX, element_id)
            self.assertIn('ui-button', markup)
            self.assertIn('aria-label', markup)
        self.assertIn('background: var(--ui-control-bg)', CSS)
        self.assertIn('border: 1px solid var(--ui-control-border)', CSS)
        for retired in ('mobileZoomInBtn','mobileZoomOutBtn','mobileWorldBtn'):
            self.assertNotIn(f'id="{retired}"', INDEX)

    def test_mobile_zoom_dock_uses_shared_shell_without_duplicate_scale(self):
        self.assertNotIn('id="mobileZoomValue"', INDEX)
        self.assertNotIn('mobileZoomValue', read_application_sources(ROOT))
        self.assertNotIn('mobile-zoom-dock', INDEX)
        self.assertEqual(INDEX.count('id="resetViewBtn"'), 1)
        self.assertIn('ui-floating-toolbar', INDEX)
        self.assertIn('reset-view-command', element_markup(INDEX, 'resetViewBtn'))

    def test_mobile_sheet_close_buttons_use_shared_icons(self):
        self.assertEqual(INDEX.count('class="ui-button icon-btn sheet-close-btn"'), 2)
        for element_id in ("objectSearchCloseBtn", "mapDisplayCloseBtn"):
            markup = element_markup(INDEX, element_id)
            self.assertIn('href="#icon-close"', markup)
            self.assertIn("aria-label", markup)
        self.assertNotIn('id="mobileCloseLeftBtn"', INDEX)
        self.assertIn('[data-layout="mobile"] .surface-header .sheet-close-btn', CSS)
        self.assertIn('[data-layout="mobile"] .surface-header .sheet-drag-handle', CSS)


if __name__ == "__main__":
    unittest.main()
