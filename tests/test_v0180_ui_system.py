from __future__ import annotations
from tests.application_source import assert_shell_versions, element_markup, function_source, read_application_sources, read_ui_sources

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
LAYER_MODEL = (ROOT / "assets/js/modules/layer-list-model.js").read_text(encoding="utf-8")
LAYER_CONTROLLER = (ROOT / "assets/js/modules/layer-tree-controller.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = read_ui_sources(ROOT)
DIALOG_CSS = (ROOT / "assets/css/components/dialogs.css").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
LAYER_TREE = (ROOT / "assets" / "js" / "modules" / "layer-tree-controller.js").read_text(encoding="utf-8")


class V0180UiSystemTests(unittest.TestCase):
    def test_build_and_cache_revision_are_coherent(self):
        assert_shell_versions(self, ROOT, INDEX)

    def test_disclosures_use_one_svg_icon(self):
        self.assertNotIn('>›</button>', INDEX)
        self.assertNotIn("content: '⌄'", CSS)
        self.assertIn('icon-chevron-down', element_markup(INDEX, 'gisAdvancedMapping'))
        self.assertIn('disclosure-icon', element_markup(INDEX, 'gisAdvancedMapping'))
        self.assertIn('summary::-webkit-details-marker', CSS)
        self.assertIn('display: none', CSS)

    def test_transient_button_flash_is_removed(self):
        self.assertNotIn("function flashButton", APP)
        self.assertNotIn("button-flash", CSS)

    def test_gis_import_layout_is_owned_by_the_canonical_dialog_stylesheet(self):
        modals = (ROOT / 'assets/css/components/modals.css').read_text(encoding='utf-8')
        for selector in ('.gis-import-dialog .ui-dialog-card', '.gis-import-form > .gis-import-content-rail', '.gis-import-dialog .ui-dialog-actions'):
            self.assertIn(selector, DIALOG_CSS)
            self.assertNotIn(selector, modals)
        self.assertIn('gis-import-content-rail', element_markup(INDEX, 'gisImportForm'))
        self.assertFalse((ROOT / 'assets/css/phase1-ui-cleanup.css').exists())

    def test_layer_hydration_is_scoped_and_present_in_initial_markup(self):
        section = element_markup(INDEX, 'objectSearchSection')
        self.assertIn('object-search-section is-hydrating', section)
        self.assertIn('aria-busy="true"', section)
        self.assertRegex(element_markup(INDEX,'layerSearchInput'), r'\bdisabled\b')
        self.assertIn('async function completeHydration', LAYER_TREE)
        hydration = function_source(LAYER_TREE,'completeHydration')
        self.assertIn("setAttribute('aria-busy', 'false')", hydration)
        self.assertIn('elements.search.disabled = false', hydration)
        self.assertNotIn('body.is-hydrating', CSS)

    def test_native_selection_controls_are_visually_normalized(self):
        for input_type in ('checkbox','radio'):
            self.assertIn(f'input[type="{input_type}"]', CSS)
        self.assertIn('appearance: none', CSS)
        self.assertIn('select {', CSS)
        self.assertIn('icon-chevron-down', INDEX)

    def test_segmented_controls_share_one_rule(self):
        self.assertIn(".ui-segmented {", CSS)
        self.assertIn(".ui-segment-option {", CSS)
        self.assertIn('class="ui-segmented projection-control"', INDEX)
        methods = element_markup(INDEX,'modeMethodSwitch')
        self.assertIn('role="radiogroup"', methods)
        self.assertEqual(re.findall(r'type="radio"[^>]*value="([^"]+)"', methods), ['line','polygon','components'])

    def test_touch_controls_keep_shared_component_language(self):
        self.assertIn('min-height: var(--ui-touch-height)', CSS)
        for element_id in ('resetViewBtn','objectSearchBtn','createMenuBtn'):
            self.assertIn('ui-button', element_markup(INDEX,element_id))
        self.assertIn('touch-action: manipulation', CSS)
        self.assertNotIn('mobileZoomInBtn', INDEX)

    def test_browser_metadata_keeps_the_name_while_topbar_omits_branding(self):
        self.assertIn('<link rel="icon" href="data:," />', INDEX)
        self.assertIn('<title>판도연구소 — 국가와 국경을 만드는 세계지도 편집기</title>', INDEX)
        self.assertNotIn('class="brand"', INDEX)
        self.assertNotIn('class="brand-mark"', INDEX)
        self.assertNotIn('icon-atlas', INDEX)

    def test_every_create_menu_entry_has_a_unique_semantic_icon(self):
        button_ids = (
            "addEntityBtn", "addFromLibraryBtn",
            "addDistributionBtn", "addLabelBtn",
            "addRiverBtn", "addLakeBtn",
        )
        expected_icons = (
            "icon-territory", "icon-library",
            "icon-area-draw", "icon-place",
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

    def test_create_routes_and_shared_category_labels(self):
        self.assertIn('id="createBuildPanel"', INDEX)
        self.assertIn('id="addEntityBtn"', INDEX)
        self.assertIn('id="addFromLibraryBtn"', INDEX)
        for retired in ("addCountryBtn", "addSubunitBtn", "addRegionBtn"):
            self.assertNotIn(f'id="{retired}"', INDEX)
        self.assertEqual(
            re.findall(r'class="create-menu-group-title">([^<]+)', INDEX),
            [],
        )
        self.assertNotIn('>영토</span>', INDEX)
        self.assertNotIn('>자료</span>', INDEX)
        self.assertNotIn('>지도 요소</span>', INDEX)


if __name__ == "__main__":
    unittest.main()
