from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class V0151ControlStyleTests(unittest.TestCase):
    def test_projection_buttons_are_compact_but_mobile_labels_remain(self):
        self.assertIn("width: calc(var(--ui-control-height) * 2);", CSS)
        self.assertIn("height: var(--ui-control-height);", CSS)
        self.assertIn(".projection-btn + .projection-btn { border-left: 1px solid var(--border); }", CSS)
        self.assertIn("padding: 3px;", CSS)
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

    def test_mobile_zoom_dock_uses_shared_shell_without_duplicate_scale(self):
        self.assertNotIn('id="mobileZoomValue"', INDEX)
        self.assertNotIn("mobileZoomValue", (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8"))
        self.assertIn("grid-template-rows: repeat(3, var(--ui-touch-height));", CSS)
        self.assertIn("padding: 3px;", CSS)
        self.assertIn("background: var(--toolbar-bg);", CSS)

    def test_mobile_sheet_close_buttons_use_shared_icons(self):
        self.assertEqual(INDEX.count('class="ui-button icon-btn sheet-close-btn"'), 2)
        self.assertIn('id="mobileCloseLeftBtn" class="ui-button icon-btn sheet-close-btn"', INDEX)
        self.assertIn('id="mobileCloseRightBtn" class="ui-button icon-btn sheet-close-btn"', INDEX)
        self.assertNotIn('aria-label="지도·레이어 창 닫기">닫기</button>', INDEX)
        self.assertNotIn('aria-label="편집창 닫기">닫기</button>', INDEX)
        self.assertIn('.mobile-sheet-header .sheet-close-btn {', CSS)
        self.assertIn('width: var(--ui-touch-height);', CSS)


if __name__ == "__main__":
    unittest.main()
