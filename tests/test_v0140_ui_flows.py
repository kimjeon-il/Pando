from __future__ import annotations
from tests.application_source import element_markup, read_application_sources, read_module, read_ui_sources

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


def source_section(source: str, start: str, end: str) -> str:
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


class V0140UiFlowTests(unittest.TestCase):
    def test_scroll_containers_reserve_scrollbar_space(self):
        source = (ROOT / "assets/css/components/dialogs.css").read_text(encoding="utf-8")
        self.assertIn(".ui-scroll-surface", source)
        self.assertIn("scrollbar-width: thin;", source)
        self.assertIn("::-webkit-scrollbar-thumb", source)
        self.assertIn(".gis-import-content-rail", source)
        self.assertNotIn("scrollbar-gutter: stable both-edges", source)

    def test_typography_uses_semantic_scale(self):
        for token in (
            "--ui-font-map: var(--map-font-body)",
            "--ui-font-caption: var(--design-font-sm)",
            "--ui-font-label: var(--design-font-md)",
            "--ui-font-body: var(--design-font-md)",
            "--ui-font-section: var(--design-font-lg)",
            "--ui-font-title: var(--design-font-xl)",
            "--ui-font-modal-title: var(--design-font-xl)",
        ):
            self.assertIn(token, CSS)

    def test_territory_method_switch_is_explicit(self):
        for element_id in ("modeMethodSwitch", "modeDirectLineMethodInput", "modePolygonMethodOption", "modePolygonMethodInput", "modeComponentsMethodInput", "modeRiverBoundaryOption", "modeRiverBoundaryInput"):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertNotIn('id="modeRiverMethodBtn"', INDEX)
        self.assertNotIn('id="modeSelectionSummary"', INDEX)
        self.assertNotIn('id="modeSecondaryBtn"', INDEX)
        self.assertIn("(0, dependencies.territorySelectionB.territorySelectionSelectMethod)('line')", APP)
        self.assertIn("['line', 'polygon', 'components'].includes(method)", APP)
        self.assertNotIn("'river-partitions'", APP)
        self.assertIn(">선 그리기</span>", INDEX)
        self.assertIn(">영역 그리기</span>", INDEX)
        self.assertIn(">영역 선택</span>", INDEX)
        self.assertIn("하천을 경계로 사용", INDEX)
        self.assertIn("useRiverBoundaries: false", APP)
        self.assertIn("function toggleRiverBoundaries", APP)
        self.assertNotIn("toggleAnnexRiverBoundaries", APP)
        self.assertNotIn("개 점 연결", APP)
        self.assertIn(".mode-method-switch {", CSS)
        self.assertIn("width: 100%;", CSS)
        self.assertIn('id="modeTaskInstruction"', INDEX)
        self.assertNotIn("mode-command-visible", APP + CSS)

    def test_merge_finishes_without_prompt_or_confirmation(self):
        merge = read_module(ROOT, "app-country-commits.js")
        merge = merge[merge.index("async function completeCountryMerge"):]
        self.assertNotIn("prompt(", merge)
        self.assertNotIn("confirm(", merge)
        self.assertIn("state.mergeTargetCountryIds", merge)
        self.assertIn("operation: 'merge'", merge)
        self.assertIn("await", merge)
        self.assertIn("beginWorkerGeometryPreview", merge)

    def test_annex_and_merge_support_multiple_targets(self):
        for token in ("sourceCountryIds,", "mergeTargetCountryIds: []", "function toggleSourceCountry", "function toggleMergeTarget", "operation: 'annex'", "operation: 'merge'"):
            self.assertIn(token, APP)
        picking = read_module(ROOT, "app-object-picking.js")
        self.assertIn("toggleMergeTarget", picking)
        self.assertIn("clickedCountry", picking)
        self.assertNotIn("annexDonorCountryIds", APP)

    def test_buttons_use_css_pressed_state_without_transient_flash(self):
        self.assertNotIn("function flashButton", APP)
        self.assertNotIn("button-flash", CSS)

    def test_projection_controls_live_in_the_map_view_for_every_layout(self):
        view = element_markup(INDEX, 'mapDisplaySurface')
        for element_id in ('projectionControl','mapViewProjectionSlot','mapViewSection'):
            self.assertEqual(view.count(f'id="{element_id}"'), 1)
        for obsolete in ('mapPanelTabs','projectionToolbarSlot','mobileProjectionSlot'):
            self.assertNotIn(f'id="{obsolete}"', INDEX)
        self.assertIn("button.setAttribute('aria-pressed', String(active))", read_module(ROOT, 'app-map-settings.js'))
        self.assertIn('.map-view-projection-slot .projection-control', CSS)


if __name__ == "__main__":
    unittest.main()
