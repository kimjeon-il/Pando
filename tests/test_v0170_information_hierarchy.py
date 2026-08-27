from __future__ import annotations

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class InformationHierarchyV0170Tests(unittest.TestCase):
    def test_persistent_metadata_and_layer_counts_are_removed(self):
        self.assertNotIn("Natural Earth 1:10m · 다중 영토 편집", INDEX)
        self.assertNotIn("표시 / 잠금", INDEX)
        for element_id in (
            "countriesLayerCount",
            "drawingsLayerCount",
            "labelsLayerCount",
            "countryLabelsLayerCount",
        ):
            self.assertNotIn(f'id="{element_id}"', INDEX)
            self.assertNotIn(element_id, APP)
        self.assertNotIn("layer-child-count", APP)

    def test_status_bar_defaults_to_zoom_and_reveals_context_conditionally(self):
        self.assertIn('<span id="zoomStatus" class="status-item">×1.0</span>', INDEX)
        self.assertIn('id="coordStatus" class="status-item hidden"', INDEX)
        self.assertIn('id="statusPrimary" class="status-group status-primary hidden"', INDEX)
        self.assertIn('id="statusSelection" class="status-group status-selection hidden"', INDEX)
        self.assertIn("function shouldShowCoordinates()", APP)
        self.assertIn("function syncStatusBar()", APP)
        self.assertIn("$('zoomStatus').textContent = `×${zoom.toFixed(1)}`", APP)
        self.assertNotIn("#app[data-layout=\"mobile\"] #coordStatus { display: none !important; }", CSS)

    def test_editor_uses_minimal_primary_information(self):
        self.assertNotIn("변경사항 자동 저장", INDEX)
        self.assertNotIn("countryActionHint", INDEX + APP)
        self.assertIn("지도나 레이어 목록에서 편집할 대상을 선택하세요.", INDEX)
        self.assertIn('id="focusSelectedObjectBtn"', INDEX)
        copy_index = INDEX.index('id="copyHydroBtn"')
        self.assertGreater(INDEX.index('class="ui-disclosure editor-disclosure"', copy_index), copy_index)
        self.assertNotIn('propertyType', INDEX + APP)


if __name__ == "__main__":
    unittest.main()
