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
        self.assertIn("scrollbar-gutter: stable", CSS)
        for selector in (".sidebar", ".layer-children", ".top-actions", ".gis-modal-card"):
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
        for element_id in ("modeMethodSwitch", "modeLineMethodBtn", "modeComponentsMethodBtn"):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertNotIn('id="modeSelectionSummary"', INDEX)
        self.assertNotIn('id="modeSecondaryBtn"', INDEX)
        self.assertIn("switchTerritorySelectionMethod('line')", APP)
        self.assertIn("switchTerritorySelectionMethod('components')", APP)
        self.assertIn('aria-label="경계를 그려 영토 일부 선택"', INDEX)
        self.assertIn('aria-label="기존 영토 조각 선택"', INDEX)
        self.assertIn(">경계 그리기</button>", INDEX)
        self.assertIn(">영토 선택</button>", INDEX)
        self.assertNotIn("개 점 연결", APP)
        self.assertIn("width: 248px", CSS)
        self.assertIn("top: 84px", CSS)
        self.assertIn("mode-command-visible", APP)

    def test_merge_finishes_without_prompt_or_confirmation(self):
        merge = source_section(APP, "function completeCountryMerge", "function cancelDraft")
        self.assertNotIn("prompt(", merge)
        self.assertNotIn("confirm(", merge)
        self.assertNotIn("합병 후 국명을 입력하세요", APP)
        self.assertIn("state.mergeTargetCountryIds", merge)
        self.assertIn("commitHistorySnapshot(snapshot)", merge)

    def test_annex_and_merge_support_multiple_targets(self):
        self.assertIn("annexDonorCountryIds: []", APP)
        self.assertIn("mergeTargetCountryIds: []", APP)
        self.assertIn("function toggleAnnexDonor", APP)
        self.assertIn("function beginAnnexSelection", APP)
        self.assertIn("function toggleMergeTarget", APP)
        self.assertIn("buildAnnexationPlan(targetId, donorIds", APP)
        self.assertIn("clipper.union(...donors.map", APP)
        self.assertIn("if (clickedCountry) toggleMergeTarget", APP)
        self.assertIn("else if (state.tool === 'merge-country') completeCountryMerge()", APP)

    def test_layer_row_buttons_skip_transient_flash(self):
        flash = source_section(APP, "function flashButton", "function showFatalError")
        for selector in (".layer-folder-toggle", ".layer-folder-name", ".layer-child-name"):
            self.assertIn(selector, flash)

    def test_projection_controls_move_between_toolbar_and_mobile_sheet(self):
        self.assertNotIn('class="panel-section compact-view-section"', INDEX)
        for element_id in ("projectionControl", "projectionToolbarSlot", "mobileProjectionSlot"):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn('id="engineStatus" class="engine-status"', INDEX)
        self.assertIn("function placeProjectionControl()", APP)
        self.assertIn("host.appendChild(control)", APP)
        self.assertIn("button.setAttribute('aria-pressed', String(active))", APP)
        self.assertIn('#app[data-layout="mobile"] .mobile-projection-slot:not(:empty)', CSS)


if __name__ == "__main__":
    unittest.main()
