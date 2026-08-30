from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
PHASE_CSS = (ROOT / "assets" / "css" / "phase1-ui-cleanup.css").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")


class V0180UiSystemTests(unittest.TestCase):
    def test_build_and_cache_revision_are_coherent(self):
        self.assertIn('data-app-version="0.30.0"', INDEX)
        for asset in ("app.css", "gis-io.js", "bootstrap.js"):
            self.assertIn(f"{asset}?v=0.30.0-r29", INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)

    def test_disclosures_use_one_svg_icon(self):
        toggles = re.findall(r'class="ui-button layer-folder-toggle"[^>]*>(.*?)</button>', INDEX)
        self.assertEqual(len(toggles), 10)
        self.assertTrue(all('class="ui-icon disclosure-icon"' in toggle for toggle in toggles))
        self.assertGreaterEqual(INDEX.count('class="ui-icon disclosure-icon"'), 15)
        self.assertNotIn('>›</button>', INDEX)
        self.assertNotIn("content: '⌄'", CSS)
        self.assertIn(".editor-disclosure > summary::-webkit-details-marker { display: none; }", CSS)

    def test_transient_button_flash_is_removed(self):
        self.assertNotIn("function flashButton", APP)
        self.assertNotIn("button-flash", CSS)

    def test_gis_import_layout_is_owned_by_the_canonical_dialog_stylesheet(self):
        for selector in ("#gisImportModal", "#gisImportForm"):
            self.assertNotIn(selector, PHASE_CSS)
        for selector in (
            "#gisImportModal .ui-dialog-card {",
            "#gisImportForm > .gis-import-content-rail {",
            "#gisImportModal .ui-dialog-actions {",
            "body[data-layout=\"mobile\"] #gisImportModal .ui-dialog-card {",
        ):
            self.assertIn(selector, CSS)

    def test_layer_hydration_is_scoped_and_present_in_initial_markup(self):
        self.assertIn('id="layerSection" class="panel-section ui-panel--dense layer-panel-section is-hydrating"', INDEX)
        self.assertIn('aria-busy="true"', INDEX)
        self.assertRegex(INDEX, r'id="layerSearchInput"[^>]*disabled')
        self.assertEqual(INDEX.count('class="layer-skeleton-group"'), 3)
        self.assertEqual(INDEX.count('class="layer-skeleton-row"'), 10)
        self.assertIn('.layer-panel-section.is-hydrating .layer-real-items { display: none; }', CSS)
        self.assertIn('async function completeLayerTreeHydration()', APP)
        self.assertNotIn('body.is-hydrating', CSS)

    def test_native_selection_controls_are_visually_normalized(self):
        self.assertIn('input[type="checkbox"],\ninput[type="radio"]', CSS)
        self.assertIn("appearance: none;", CSS)
        self.assertIn("select {", CSS)
        self.assertIn("icon-chevron-down", INDEX)

    def test_segmented_controls_share_one_rule(self):
        self.assertIn(".ui-segmented {", CSS)
        self.assertIn(".ui-segment-option {", CSS)
        self.assertIn('class="ui-segmented projection-control"', INDEX)
        self.assertIn('class="ui-segmented mode-method-switch hidden"', INDEX)

    def test_touch_controls_keep_shared_component_language(self):
        self.assertIn('#app[data-layout="mobile"] .icon-btn,', CSS)
        self.assertIn("width: var(--ui-touch-height);", CSS)
        self.assertIn('id="mobileZoomInBtn" class="ui-button icon-btn"', INDEX)
        self.assertIn('id="mobileZoomOutBtn" class="ui-button icon-btn"', INDEX)

    def test_korean_brand_uses_an_empty_reserved_icon_frame(self):
        self.assertIn('<link rel="icon" href="data:," />', INDEX)
        self.assertIn('<title>판도연구소 — 국가와 국경을 만드는 세계지도 편집기</title>', INDEX)
        self.assertIn('<div class="brand-mark" aria-hidden="true"></div>', INDEX)
        self.assertIn('<div><strong>판도연구소</strong></div>', INDEX)
        self.assertNotIn('icon-atlas', INDEX)
        self.assertRegex(CSS, r"\.brand-mark \{[^}]*width: 34px;[^}]*height: 34px;")

    def test_every_create_menu_entry_has_a_unique_semantic_icon(self):
        button_ids = (
            "addCountryBtn", "addTerritoryBtn", "addAdministrativeBtn", "addRegionBtn", "addFromLibraryBtn",
            "addDistributionBtn", "addLabelBtn",
            "addRiverBtn", "addLakeBtn",
        )
        expected_icons = (
            "icon-country", "icon-territory", "icon-administrative", "icon-region", "icon-library",
            "icon-language", "icon-place",
            "icon-river", "icon-lake",
        )
        actual_icons = []
        for button_id, expected_icon in zip(button_ids, expected_icons):
            match = re.search(
                rf'id="{button_id}"[^>]*>.*?<use href="#([^"]+)"/>.*?</button>',
                INDEX,
                re.DOTALL,
            )
            self.assertIsNotNone(match, button_id)
            actual_icons.append(match.group(1))
            self.assertIn(f'<symbol id="{expected_icon}"', INDEX)
        self.assertEqual(tuple(actual_icons), expected_icons)
        self.assertEqual(len(actual_icons), len(set(actual_icons)))


if __name__ == "__main__":
    unittest.main()
