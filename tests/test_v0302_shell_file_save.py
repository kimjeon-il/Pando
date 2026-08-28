import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
SAVE_STATE = (ROOT / "assets/js/modules/save-state-controller.js").read_text(encoding="utf-8")
GIS_IO = (ROOT / "assets/js/gis-io.js").read_text(encoding="utf-8")


class ShellFileSaveContractTests(unittest.TestCase):
    def test_removed_save_popover_has_no_dom_code_or_style_references(self):
        combined = "\n".join((HTML, APP, CSS))
        for identifier in (
            "projectSaveStatusPopover",
            "projectFileSaveDetail",
            "projectAutosaveDetail",
            "projectSaveNowBtn",
        ):
            self.assertNotIn(identifier, combined)

    def test_topbar_uses_three_zones_and_keeps_dirty_state_by_file_button(self):
        topbar = re.search(r'<header class="topbar">(.*?)</header>', HTML, re.S)
        self.assertIsNotNone(topbar)
        markup = topbar.group(1)
        self.assertLess(markup.index('class="brand"'), markup.index('class="topbar-center"'))
        self.assertLess(markup.index('class="topbar-center"'), markup.index('class="topbar-file-actions"'))
        file_actions = re.search(r'<div class="topbar-file-actions">(.*?)</div>\s*</header>', HTML, re.S)
        self.assertIsNotNone(file_actions)
        self.assertLess(file_actions.group(1).index('id="projectSaveStatus"'), file_actions.group(1).index('id="mobileFileBtn"'))
        self.assertIn('data-tooltip="저장되지 않은 변경 사항이 있습니다."', file_actions.group(1))
        self.assertNotIn('id="projectSaveStatus"', re.search(r'<div class="topbar-center"(.*?)</div>\s*</div>', HTML, re.S).group(1))
        self.assertIn("grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr)", CSS)

    def test_file_menu_uses_application_commands_and_accessible_menu_roles(self):
        menu = re.search(r'<nav id="fileMenu"(.*?)</nav>', HTML, re.S)
        self.assertIsNotNone(menu)
        markup = menu.group(1)
        self.assertIn('role="menu"', menu.group(0))
        for label in ("새 프로젝트", "불러오기…", "프로젝트 저장", "데이터 내보내기…", "키보드 도움말"):
            self.assertIn(label, markup)
        for old_label in ("GeoPackage 저장", "GIS 파일 열기", "GeoJSON 가져오기", "GeoJSON 내보내기", "벡터 데이터 가져오기"):
            self.assertNotIn(old_label, markup)
        self.assertEqual(markup.count('role="menuitem"'), 5)
        self.assertNotIn('id="keyboardHelpBtn"', re.search(r'<header class="topbar">(.*?)</header>', HTML, re.S).group(1))

    def test_dirty_state_is_separate_from_autosave_and_transient_notifications(self):
        self.assertIn("hasUnsavedChanges: false", SAVE_STATE)
        self.assertIn("cleanContentToken", SAVE_STATE)
        self.assertIn("status.hidden = !snapshot.hasUnsavedChanges", APP)
        self.assertIn("자동저장 실패. 파일로 저장하세요.", APP)
        self.assertIn("프로젝트 저장에 실패했습니다.", APP)
        self.assertNotIn("자동저장 용량을 초과했습니다", APP)
        self.assertNotIn("saveStatusNeutralTimer", APP)

    def test_one_loader_classifies_projects_from_real_project_state_metadata(self):
        self.assertIn("importSourceKind = session.projectMetadata?.projectState ? 'project' : 'vector'", GIS_IO)
        self.assertIn("importStepRoute = importSourceKind === 'project' ? [0, 4] : [0, 1, 2, 3, 4]", GIS_IO)
        self.assertIn("result.sourceKind === 'project'", APP)
        self.assertNotIn("dataset.fileIntent", APP)

    def test_project_save_and_gis_data_export_are_separate_commands(self):
        self.assertIn('id="saveProjectBtn"', HTML)
        self.assertIn('id="dataExportBtn"', HTML)
        self.assertIn("mode: 'gis'", APP)
        self.assertIn("exportGeoJsonBundle", GIS_IO)
        self.assertIn("pandolab_project_settings", GIS_IO + (ROOT / "assets/js/workers/gis-gpkg-worker.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
