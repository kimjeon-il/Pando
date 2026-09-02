import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class MobileStatusV0164Tests(unittest.TestCase):
    def test_status_bar_has_three_semantic_groups_in_one_inner_row(self):
        self.assertIn('class="status-inner"', INDEX)
        self.assertIn('class="status-group status-view"', INDEX)
        self.assertIn('class="status-group status-primary hidden"', INDEX)
        self.assertIn('class="status-group status-selection hidden"', INDEX)
        self.assertIn(".status-group:not(.hidden) ~ .status-group:not(.hidden)::before", CSS)
        self.assertNotIn("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);", CSS)

    def test_status_background_reaches_edges_and_content_uses_safe_insets(self):
        self.assertIn(".map-bottom-status {", CSS)
        self.assertIn("left: var(--map-safe-left, 0px);", CSS)
        self.assertIn("right: var(--map-safe-right, 0px);", CSS)
        self.assertNotIn('#app[data-layout="compact"] .map-bottom-status { left: 0; right: 0; }', CSS)

    def test_mobile_sheet_header_uses_one_shared_row(self):
        canonical = CSS[CSS.index('/* ===== Canonical workspace surfaces ===== */'):]
        self.assertIn(".surface-header {", canonical)
        self.assertIn("grid-template-columns: minmax(0, 1fr) auto;", canonical)
        self.assertIn("flex-basis: var(--ui-surface-header-height-mobile);", canonical)
        self.assertIn("padding-block: calc(var(--ui-surface-mobile-handle-space) + var(--ui-space-2)) var(--ui-space-2);", canonical)
        self.assertIn("padding: 0 var(--ui-surface-content-rail-x);", canonical)
        self.assertIn("calc(100dvh - var(--ui-topbar-height) - var(--mobile-nav-height))", CSS)

    def test_empty_mobile_history_toolbar_is_hidden(self):
        self.assertIn("history-empty", INDEX)
        self.assertIn("classList.toggle('history-empty'", APP)
        self.assertIn('#app[data-layout="mobile"] .map-command-toolbar.history-empty { display: none; }', CSS)


if __name__ == "__main__":
    unittest.main()
