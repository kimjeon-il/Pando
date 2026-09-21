from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
SURFACE = (ROOT / "assets/js/modules/surface-controller.js").read_text(encoding="utf-8")
SHEETS = (ROOT / "assets/js/modules/mobile-sheet-controller.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class WorkspaceSurfaceContracts(unittest.TestCase):
    def test_create_display_and_editor_use_current_panels_and_mobile_triggers(self):
        expected = {
            "create": ("createMenu", "mobileCreateBtn"),
            "display": ("mapDisplaySurface", "mobileDisplayBtn"),
            "editor": ("editorSurface", "mobileEditBtn"),
        }
        for surface, (panel, trigger) in expected.items():
            self.assertRegex(SURFACE, rf"{surface}[^\n]+{panel}")
            self.assertRegex(SURFACE, rf"{surface}[^\n]+{trigger}")
            self.assertIn(f'data-sheet-handle="{panel}"', INDEX)
            self.assertIn(f'id="{trigger}"', INDEX)
            self.assertIn(panel, SHEETS)

    def test_retired_layer_panel_contract_is_absent(self):
        retired = (
            "leftPanel",
            "mobileMapBtn",
            "mapLayersTabBtn",
            "mapViewTabBtn",
            "surface-map",
        )
        for token in retired:
            self.assertNotIn(token, INDEX)
            self.assertNotIn(token, SURFACE)

    def test_current_sheet_scroll_owners_use_shared_scroll_surfaces(self):
        self.assertIn('class="layer-search-results ui-scroll-surface hidden"', INDEX)
        self.assertIn('class="panel-section ui-panel--dense map-view-panel-section ui-scroll-surface"', INDEX)
        self.assertIn('class="surface-body editor-scroll-body ui-scroll-surface"', INDEX)
        self.assertIn("scrollbar-width: thin;", CSS)
        self.assertIn("scrollbar-color: var(--border-strong) transparent;", CSS)

    def test_all_current_mobile_sheet_handles_have_slider_semantics(self):
        handles = re.findall(r'<button[^>]+data-sheet-handle="([^"]+)"[^>]*>', INDEX)
        for panel in ("createMenu", "mapDisplaySurface", "editorSurface"):
            self.assertIn(panel, handles)
            tag = next(tag for tag in re.findall(r'<button[^>]+data-sheet-handle="[^"]+"[^>]*>', INDEX) if f'"{panel}"' in tag)
            self.assertIn('role="slider"', tag)
            self.assertIn('aria-valuemin="0"', tag)
            self.assertIn('aria-valuemax="2"', tag)


if __name__ == "__main__":
    unittest.main()
