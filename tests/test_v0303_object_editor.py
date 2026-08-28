from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class ObjectEditorV0303Tests(unittest.TestCase):
    def form_markup(self, element_id: str) -> str:
        match = re.search(rf'<form id="{element_id}"[\s\S]+?</form>', INDEX)
        self.assertIsNotNone(match)
        return match.group(0)

    def test_removed_surfaces_have_no_dom_or_event_hooks(self):
        combined = INDEX + APP
        for element_id in (
            "historyTabBtn",
            "historyPanel",
            "countryComponentsSection",
            "countryComponentList",
            "regionLockedInput",
            "administrativeLockedInput",
            "historicalRegionLockedInput",
            "deleteCountryBtn",
            "deleteHistoricalRegionBtn",
            "objectFocusMenuBtn",
            "propertyAreaValue",
        ):
            self.assertNotIn(element_id, combined)
        self.assertNotIn("installAdvancedActionDisclosures", APP)
        self.assertNotIn("generated-advanced-actions", combined)

    def test_header_and_tabs_are_fixed_outside_the_scroll_body(self):
        header_index = INDEX.index('id="editorObjectHeader"')
        tabs_index = INDEX.index('class="ui-tabs editor-view-tabs hidden"')
        body_index = INDEX.index('id="editorScrollBody"')
        self.assertLess(header_index, tabs_index)
        self.assertLess(tabs_index, body_index)
        self.assertIn('class="editor-object-separator" aria-hidden="true">·</span>', INDEX)
        self.assertIn("document.querySelector('.editor-view-tabs')?.classList.toggle('hidden', !type)", APP)
        self.assertIn("$('editSheetTitle')?.classList.toggle('hidden', !!type)", APP)

    def test_target_information_forms_are_flat_and_ordered(self):
        country = self.form_markup("countryProperties")
        order = [
            'id="countryNameInput"',
            'id="capitalInput"',
            'id="countryColorTrigger"',
            'id="countryAreaValue"',
            'id="flagPreview"',
            'id="notesInput"',
            'id="countryCodeInput"',
        ]
        positions = [country.index(token) for token in order]
        self.assertEqual(positions, sorted(positions))
        for form_id in ("countryProperties", "regionProperties", "administrativeProperties", "historicalRegionProperties"):
            markup = self.form_markup(form_id)
            self.assertIn("editor-object-form", markup)
            self.assertNotIn('class="ui-card editor-section editor-section-primary"', markup)
        historical = self.form_markup("historicalRegionProperties")
        self.assertIn('<fieldset class="editor-period-group"><legend>유효 기간</legend>', historical)

    def test_flags_and_actions_use_the_compact_common_grammar(self):
        country = self.form_markup("countryProperties")
        self.assertRegex(country, r'id="flagUploadBtn"[^>]+aria-label="국기 변경"[^>]*><svg')
        self.assertRegex(country, r'id="flagRemoveBtn"[^>]+aria-label="국기 삭제"[^>]*><svg')
        self.assertNotRegex(country, r'>\s*국기 (?:변경|삭제)\s*</button>')
        for form_id in ("countryProperties", "regionProperties", "administrativeProperties", "historicalRegionProperties"):
            markup = self.form_markup(form_id)
            self.assertIn("editor-action-row", markup)
            self.assertNotIn("editor-action-grid", markup)
        self.assertIn("min-height: var(--ui-touch-height);", CSS)

    def test_context_menu_and_safe_fit_match_the_surface_contract(self):
        self.assertNotIn("지도에서 보기</button>", INDEX[INDEX.index('id="objectActionsMenu"'):INDEX.index('id="emptyProperties"')])
        self.assertIn('class="object-actions-separator" role="separator"', INDEX)
        self.assertIn("function currentObjectFitInsets()", APP)
        self.assertIn("panMapBy(safeCenterX - projectionCenterX, safeCenterY - projectionCenterY)", APP)
        self.assertIn("--map-safe-right: calc(var(--panel-right-width) + var(--ui-map-edge));", CSS)
        self.assertIn("top: var(--ui-map-edge);", CSS)
        self.assertIn("bottom: calc(30px + var(--ui-map-edge));", CSS)

    def test_structural_preview_and_two_mobile_snaps_are_present(self):
        self.assertIn("function buildTerritorialStructurePreview", APP)
        self.assertIn("현재 형상과 객체 ID 유지", APP)
        self.assertIn("하위 영역 ${childCount}개 유지", APP)
        self.assertIn("const SHEET_SNAP_RATIOS = Object.freeze([0.6, 1]);", APP)
        self.assertIn("const MOBILE_SHEET_DEFAULT_SNAP = 0;", APP)
        self.assertEqual(INDEX.count('aria-valuemax="1"'), 3)

    def test_geometry_and_internal_undo_engines_remain(self):
        self.assertIn("const MAX_HISTORY = 30", APP)
        self.assertIn("untouchedComponents", APP)
        self.assertIn("MultiPolygon", APP)
        self.assertIn("runTerritorialTransaction", APP)


if __name__ == "__main__":
    unittest.main()
