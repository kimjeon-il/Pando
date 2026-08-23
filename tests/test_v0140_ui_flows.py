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
            "--ui-font-xs: 12px",
            "--ui-font-sm: 13px",
            "--ui-font-md: 15px",
            "--ui-font-lg: 16px",
            "--ui-font-xl: 18px",
        ):
            self.assertIn(token, CSS)

    def test_territory_method_switch_is_explicit(self):
        for element_id in ("modeMethodSwitch", "modeLineMethodBtn", "modeComponentsMethodBtn", "modeSelectionSummary"):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertNotIn('id="modeSecondaryBtn"', INDEX)
        self.assertIn("switchTerritorySelectionMethod('line')", APP)
        self.assertIn("switchTerritorySelectionMethod('components')", APP)
        self.assertIn("국경선으로 나누기", INDEX)
        self.assertIn("영토 조각 선택", INDEX)

    def test_merge_finishes_without_prompt_or_confirmation(self):
        merge = source_section(APP, "function completeCountryMerge", "function cancelDraft")
        self.assertNotIn("prompt(", merge)
        self.assertNotIn("confirm(", merge)
        self.assertNotIn("합병 후 국명을 입력하세요", APP)
        self.assertIn("const mergedName = sourceName", merge)


if __name__ == "__main__":
    unittest.main()
