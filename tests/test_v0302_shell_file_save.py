from tests.application_source import read_application_sources
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
SAVE_STATE = (ROOT / "assets/js/modules/save-state-controller.js").read_text(encoding="utf-8")
GIS_IO = (ROOT / "assets/js/gis-io.js").read_text(encoding="utf-8")
IMPORT_SERVICE = (ROOT / "assets/js/modules/import-service.js").read_text(encoding="utf-8")


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

    def test_topbar_uses_command_groups_and_status_overlay_owns_save_state(self):
        topbar = re.search(r'<header class="topbar"[^>]*>(.*?)</header>', HTML, re.S)
        self.assertIsNotNone(topbar)
        markup = topbar.group(1)
        self.assertNotIn('class="brand"', markup)
        self.assertLess(markup.index('id="undoBtn"'), markup.index('id="mobileFileBtn"'))
        self.assertLess(markup.index('id="mobileFileBtn"'), markup.index('id="preferencesBtn"'))
        self.assertLess(markup.index('id="preferencesBtn"'), markup.index('id="helpBtn"'))
        file_actions = re.search(r'<div class="topbar-file-actions">(.*?)</nav>\s*</div>', HTML, re.S)
        self.assertIsNotNone(file_actions)
        self.assertNotIn('id="projectSaveStatus"', file_actions.group(1))
        bottom_status_start = HTML.index('id="mapBottomStatus"')
        self.assertIn('id="projectSaveStatus"', HTML[bottom_status_start:HTML.index('</main>', bottom_status_start)])
        self.assertNotIn('id="projectSaveStatus"', re.search(r'<div class="topbar-center"(.*?)</div>\s*</div>', HTML, re.S).group(1))
        self.assertIn('class="topbar-center"', markup)

    def test_file_menu_uses_application_commands_and_accessible_menu_roles(self):
        menu = re.search(r'<nav id="fileMenu"(.*?)</nav>', HTML, re.S)
        self.assertIsNotNone(menu)
        markup = menu.group(1)
        self.assertIn('role="menu"', menu.group(0))
        for label in ("새 프로젝트", "프로젝트 불러오기", "프로젝트 저장", "GIS 가져오기", "GIS 내보내기"):
            self.assertIn(label, markup)
        for old_label in ("GeoPackage 저장", "GIS 파일 열기", "GeoJSON 가져오기", "GeoJSON 내보내기", "벡터 데이터 가져오기"):
            self.assertNotIn(old_label, markup)
        self.assertEqual(markup.count('role="menuitem"'), 5)
        topbar_markup = re.search(r'<header class="topbar"[^>]*>(.*?)</header>', HTML, re.S).group(1)
        self.assertIn('id="preferencesBtn"', topbar_markup)
        self.assertIn('id="helpBtn"', topbar_markup)

    def test_dirty_state_is_separate_from_autosave_and_transient_notifications(self):
        self.assertIn("hasUnsavedChanges: false", SAVE_STATE)
        self.assertIn("cleanContentToken", SAVE_STATE)
        self.assertIn("status.hidden = false", APP)
        self.assertIn("자동저장 실패. 파일로 저장하세요.", APP)
        self.assertIn("프로젝트 저장에 실패했습니다.", APP)
        self.assertNotIn("자동저장 용량을 초과했습니다", APP)
        self.assertNotIn("saveStatusNeutralTimer", APP)

    def test_one_loader_classifies_projects_from_real_project_state_metadata(self):
        self.assertIn("importSourceKind = session.projectMetadata?.projectState ? 'project' : 'vector'", GIS_IO)
        self.assertIn("importStepRoute = importSourceKind === 'project' ? [0, 4] : [0, 1, 2, 3, 4]", GIS_IO)
        self.assertIn("result.sourceKind === 'project'", IMPORT_SERVICE)
        self.assertNotIn("dataset.fileIntent", APP)

    def test_project_save_and_gis_data_export_are_separate_commands(self):
        self.assertIn('id="saveProjectBtn"', HTML)
        self.assertIn('id="dataExportBtn"', HTML)
        self.assertIn("mode: 'gis'", APP)
        self.assertIn("exportGeoJsonBundle", GIS_IO)
        self.assertIn("pandolab_project_settings", GIS_IO + (ROOT / "assets/js/workers/gis-gpkg-worker.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
