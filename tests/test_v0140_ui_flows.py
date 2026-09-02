from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


def source_section(source: str, start: str, end: str) -> str:
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


class V0140UiFlowTests(unittest.TestCase):
    def test_scroll_containers_reserve_scrollbar_space(self):
        self.assertIn("scrollbar-gutter: stable both-edges;", CSS)
        self.assertNotIn("scrollbar-gutter: stable;", CSS)
        for selector in (".sidebar", ".layer-children", ".top-actions", ".ui-dialog-card"):
            self.assertIn(selector, CSS)

    def test_typography_uses_semantic_scale(self):
        for token in (
            "--ui-font-map: 12px",
            "--ui-font-caption: 13px",
            "--ui-font-label: 14px",
            "--ui-font-body: 15px",
            "--ui-font-section: 16px",
            "--ui-font-title: 18px",
            "--ui-font-modal-title: 20px",
        ):
            self.assertIn(token, CSS)

    def test_territory_method_switch_is_explicit(self):
        for element_id in ("modeMethodSwitch", "modeLineMethodBtn", "modePolygonMethodBtn", "modeComponentsMethodBtn", "modeRiverBoundaryOption", "modeRiverBoundaryInput"):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertNotIn('id="modeRiverMethodBtn"', INDEX)
        self.assertNotIn('id="modeSelectionSummary"', INDEX)
        self.assertNotIn('id="modeSecondaryBtn"', INDEX)
        self.assertIn("switchTerritorySelectionMethod('line')", APP)
        self.assertIn("switchTerritorySelectionMethod('polygon')", APP)
        self.assertIn("switchTerritorySelectionMethod('components')", APP)
        self.assertNotIn("switchTerritorySelectionMethod('river')", APP)
        self.assertIn('aria-label="경계선을 그려 영토 일부 선택"', INDEX)
        self.assertIn('aria-label="기존 영토 조각 선택"', INDEX)
        self.assertIn(">경계선 그리기</button>", INDEX)
        self.assertIn(">영역 지정</button>", INDEX)
        self.assertIn(">영토 조각 선택</button>", INDEX)
        self.assertIn("하천을 경계로 취급", INDEX)
        self.assertIn("annexUseRiverBoundaries: false", APP)
        self.assertIn("toggleAnnexRiverBoundaries", APP)
        self.assertNotIn("'river-partitions'", APP)
        self.assertIn(".mode-method-switch.annex-three-methods", CSS)
        self.assertNotIn("annex-four-methods", CSS)
        self.assertNotIn("개 점 연결", APP)
        self.assertIn(".mode-method-switch {", CSS)
        self.assertIn("width: min(100%, 360px);", CSS)
        self.assertIn('id="modeTaskInstruction"', INDEX)
        self.assertNotIn("mode-command-visible", APP + CSS)

    def test_merge_finishes_without_prompt_or_confirmation(self):
        merge = source_section(APP, "function completeCountryMerge", "function cancelDraft")
        self.assertNotIn("prompt(", merge)
        self.assertNotIn("confirm(", merge)
        self.assertNotIn("합병 후 국명을 입력하세요", APP)
        self.assertIn("state.mergeTargetCountryIds", merge)
        self.assertIn("await transactCountryEdit({", merge)

    def test_annex_and_merge_support_multiple_targets(self):
        self.assertIn("annexDonorCountryIds: []", APP)
        self.assertIn("mergeTargetCountryIds: []", APP)
        self.assertIn("function toggleAnnexDonor", APP)
        self.assertIn("function beginAnnexSelection", APP)
        self.assertIn("function toggleMergeTarget", APP)
        self.assertIn("operation: 'annex'", APP)
        self.assertIn("operation: 'merge'", APP)
        self.assertIn("if (clickedCountry) toggleMergeTarget", APP)
        self.assertIn("if (state.tool === 'merge-country') return completeCountryMerge()", APP)

    def test_buttons_use_css_pressed_state_without_transient_flash(self):
        self.assertNotIn("function flashButton", APP)
        self.assertNotIn("button-flash", CSS)

    def test_projection_controls_live_in_the_map_view_for_every_layout(self):
        self.assertNotIn('class="panel-section compact-view-section"', INDEX)
        for element_id in ("projectionControl", "mapViewProjectionSlot", "mapViewSection", "mapPanelTabs"):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn('id="engineStatus"', INDEX)
        self.assertIn('class="status-item engine-status hidden"', INDEX)
        self.assertNotIn('id="projectionToolbarSlot"', INDEX)
        self.assertNotIn('id="mobileProjectionSlot"', INDEX)
        self.assertNotIn("function placeProjectionControl()", APP)
        self.assertIn("button.setAttribute('aria-pressed', String(active))", APP)
        self.assertIn('.map-view-projection-slot .projection-control', CSS)


if __name__ == "__main__":
    unittest.main()
