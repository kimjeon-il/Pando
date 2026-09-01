from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")


class EditorSystemV0190Tests(unittest.TestCase):
    def test_all_editor_views_share_one_shell_and_component_vocabulary(self):
        self.assertIn('class="sidebar right-panel editor-panel workspace-surface surface-editor ui-sheet"', INDEX)
        self.assertIn('id="editorScrollBody" class="surface-body editor-scroll-body ui-scroll-surface"', INDEX)
        self.assertIn('id="editorObjectHeader" class="editor-object-header hidden"', INDEX)
        for view_id in (
            "countryProperties", "territoryProperties", "administrativeProperties", "regionProperties",
            "distributionProperties", "genericFeatureProperties", "labelProperties", "hydroProperties",
        ):
            self.assertRegex(INDEX, rf'id="{view_id}" class="editor-view editor-object-form hidden"')
        for component in (
            "editor-section", "editor-section-title", "editor-field", "editor-action-list",
            "editor-info-list", "editor-property-list", "editor-meta-list", "editor-disclosure",
        ):
            self.assertIn(component, INDEX)

    def test_legacy_editor_layouts_and_object_specific_css_are_removed(self):
        combined = INDEX + APP + CSS
        for legacy in (
            "property-header", "property-form", "editor-header", "editor-form", "editor-card", "editor-details",
            "meta-card", "country-action-btn", "country-actions-card", "simple-flag-editor",
            "advanced-boundary-box", "compact-color",
        ):
            self.assertNotIn(legacy, combined)
        self.assertNotIn("#hydroProperties .", CSS)

    def test_information_hierarchy_and_copy_are_normalized(self):
        for obsolete in ("데이터 유형", "지도색", "편집용 복사 만들기", "내장 수계 정보", "이 국가 삭제", "상세 정보"):
            self.assertNotIn(obsolete, INDEX)
        for expected in (
            "영토 편입", "국가 합병", "국경 조정", "해안선 조정", "식별 정보",
            "복사하여 편집", "국가에 관한 메모를 입력하세요.",
        ):
            self.assertIn(expected, INDEX)
        self.assertNotIn("추가 정보", INDEX)
        self.assertNotIn("위험 작업", INDEX)
        self.assertIn('id="countryCodeInput"', INDEX)
        self.assertIn('id="genericFeatureIdInput"', INDEX)
        self.assertIn('id="hydroIdValue"', INDEX)

    def test_empty_and_active_states_are_managed_by_one_function(self):
        function = re.search(r"function showPropertyForm\([\s\S]+?\n  }", APP)
        self.assertIsNotNone(function)
        source = function.group(0)
        for element_id in (
            "emptyProperties", "editorObjectHeader", "countryProperties", "territoryProperties", "administrativeProperties", "genericFeatureProperties",
            "labelProperties", "hydroProperties", "propertyTitle", "editorScrollBody",
        ):
            self.assertIn(element_id, source)

    def test_hydro_header_hides_numeric_id_and_redundant_mainstem(self):
        self.assertIn("function hydroEditorName", APP)
        self.assertIn("/^미명명 수계(?:\\s+\\d+)?$/", APP)
        self.assertIn("$('hydroSystemRow').classList.toggle('hidden', !systemName || systemName === displayName)", APP)
        self.assertIn("'본류·표시 지류'", APP)
        self.assertNotIn("hydroPropertiesTitle", INDEX + APP)


if __name__ == "__main__":
    unittest.main()
