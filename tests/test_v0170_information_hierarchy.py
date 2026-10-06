from __future__ import annotations
from tests.application_source import element_markup, read_application_sources, read_ui_sources

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)


class InformationHierarchyV0170Tests(unittest.TestCase):
    def test_persistent_metadata_and_layer_counts_are_removed(self):
        self.assertNotIn("Natural Earth 1:10m · 다중 영토 편집", INDEX)
        self.assertNotIn("표시 / 잠금", INDEX)
        for element_id in (
            "countriesLayerCount",
            "genericFeaturesLayerCount",
            "labelsLayerCount",
            "countryLabelsLayerCount",
        ):
            self.assertNotIn(f'id="{element_id}"', INDEX)
            self.assertNotIn(element_id, APP)
        self.assertNotIn("layer-child-count", APP)

    def test_status_bar_keeps_only_save_projection_and_selection_context(self):
        self.assertNotIn('id="zoomStatus"', INDEX + APP)
        self.assertIn('id="mapBottomStatus" class="ui-status map-bottom-status"', INDEX)
        self.assertIn('id="preferencesStatusBarVisibleInput"', INDEX)
        self.assertIn('id="statusSelection" class="status-group status-selection hidden"', INDEX)
        self.assertNotIn('id="coordStatus"', INDEX)
        self.assertNotIn('id="statusPrimary"', INDEX)
        self.assertIn("function syncStatusBar()", APP)
        self.assertIn("(0, dependencies.platform.$)('projectionStatus').textContent = projectionLabel", APP)
        self.assertIn('dataset.statusBarVisible', INDEX + APP)

    def test_editor_uses_minimal_primary_information(self):
        self.assertNotIn('변경사항 자동 저장', INDEX)
        self.assertNotIn('countryActionHint', INDEX + APP)
        self.assertIn('지도에서 객체를 선택하면 여기서 편집할 수 있습니다.', element_markup(INDEX, 'emptyProperties'))
        self.assertIn('id="focusSelectedObjectBtn"', INDEX)
        self.assertIn('id="propertyTypeLabel"', INDEX)
        self.assertNotIn('id="propertyAreaValue"', INDEX)
        self.assertIn('id="entityAreaValue"', INDEX)
        self.assertIn('copyHydroBtn', element_markup(INDEX, 'hydroProperties'))


if __name__ == "__main__":
    unittest.main()
