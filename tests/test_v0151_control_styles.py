from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0151ControlStyleTests(unittest.TestCase):
    def test_projection_buttons_are_compact_but_mobile_labels_remain(self):
        self.assertIn("width: var(--ui-control-height);", CSS)
        self.assertIn(".projection-btn > span { display: none; }", CSS)
        self.assertIn('#app[data-layout="mobile"] .projection-btn > span { display: inline; }', CSS)
        self.assertIn('aria-label="지구본 투영"', INDEX)
        self.assertIn('aria-label="평면 투영"', INDEX)

    def test_layer_search_uses_shared_svg_icon(self):
        self.assertIn('<symbol id="icon-search"', INDEX)
        self.assertIn('class="ui-icon layer-search-icon"', INDEX)
        self.assertNotIn('<span aria-hidden="true">⌕</span>', INDEX)
        self.assertIn(".layer-search-icon {", CSS)
        self.assertIn("width: 20px;", CSS)

    def test_mobile_auxiliary_buttons_use_theme_tokens(self):
        self.assertIn('#app[data-layout="mobile"] .mobile-zoom-dock button,', CSS)
        self.assertIn('#app[data-layout="mobile"] .mobile-sheet-header button {', CSS)
        self.assertIn("border: 1px solid var(--border);", CSS)
        self.assertIn("background: var(--panel-2);", CSS)


if __name__ == "__main__":
    unittest.main()
