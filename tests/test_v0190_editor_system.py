from tests.application_source import element_markup, function_source, read_application_sources, read_ui_sources
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
OBJECT_PROPERTIES = (ROOT / "assets/js/modules/object-property-controller.js").read_text(encoding="utf-8")
CSS = read_ui_sources(ROOT)


class EditorSystemV0190Tests(unittest.TestCase):
    def test_all_editor_views_share_one_shell_and_component_vocabulary(self):
        self.assertIn('class="sidebar editor-drawer editor-panel workspace-surface surface-editor ui-sheet"', INDEX)
        self.assertIn('id="editorScrollBody" class="surface-body editor-scroll-body ui-scroll-surface"', INDEX)
        self.assertIn('id="editorObjectHeader" class="editor-object-header hidden"', INDEX)
        for view_id in (
            "entityProperties",
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
            "property-header", "property-form", "editor-form", "editor-card", "editor-details",
            "meta-card", "country-action-btn", "country-actions-card", "simple-flag-editor",
            "advanced-boundary-box", "compact-color",
        ):
            self.assertNotIn(legacy, combined)
        self.assertNotIn("#hydroProperties .", CSS)

    def test_information_hierarchy_and_copy_are_normalized(self):
        for obsolete in ('데이터 유형','지도색','편집용 복사 만들기','내장 수계 정보','이 국가 삭제','상세 정보'):
            self.assertNotIn(obsolete, INDEX)
        for expected in ('영역 편입','객체 합병','경계 조정','해안선 조정','복사하여 편집'):
            self.assertIn(expected, INDEX)
        for element_id in ('entityNameInput','entityPeriodInput','entityNotesInput','genericFeatureIdInput','hydroIdValue'):
            self.assertEqual(INDEX.count(f'id="{element_id}"'), 1)

    def test_empty_and_active_states_are_managed_by_one_function(self):
        function = re.search(r"function show\([\s\S]+?\n  }", OBJECT_PROPERTIES)
        self.assertIsNotNone(function)
        source = function.group(0)
        for element_id in (
            "emptyProperties", "editorObjectHeader", "entityProperties", "genericFeatureProperties",
            "labelProperties", "hydroProperties", "propertyTitle", "editorScrollBody",
        ):
            self.assertIn(element_id, source)

    def test_object_actions_use_context_and_common_action_sections(self):
        header = element_markup(INDEX,'editorObjectHeader')
        self.assertIn('focusSelectedObjectBtn', header)
        self.assertIn('flagMenuBtn', header)
        body = element_markup(INDEX,'editorScrollBody')
        self.assertNotIn('focusSelectedObjectBtn', body)
        self.assertNotIn('flagMenuBtn', body)
        self.assertEqual(INDEX.count('id="objectLockBtn"'), 1)
        self.assertEqual(INDEX.count('id="objectDeleteBtn"'), 1)
        self.assertIn('editorDeleteSection', body)
        for removed in ('deleteDistributionBtn','deleteGenericFeatureInlineBtn','deleteLabelBtn','deleteHydroEditBtn'):
            self.assertNotIn(removed, INDEX + APP)

    def test_hydro_header_hides_numeric_id_and_redundant_mainstem(self):
        self.assertIn('function hydroEditorName', APP)
        self.assertIn('/^미명명 수계(?:\\s+\\d+)?$/', APP)
        source = function_source(OBJECT_PROPERTIES,'presentHydro')
        self.assertIn('hydroSystemRow', source)
        self.assertIn('systemName === displayName', source)
        self.assertIn("'본류·표시 지류'", source)
        self.assertNotIn('hydroPropertiesTitle', INDEX + APP)


if __name__ == "__main__":
    unittest.main()
