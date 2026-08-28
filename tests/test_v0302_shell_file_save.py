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
        for label in ("새 프로젝트", "열기", "저장", "가져오기", "내보내기", "단축키"):
            self.assertIn(label, markup)
        for old_label in ("GeoPackage 저장", "GIS 파일 열기", "GeoJSON 가져오기", "GeoJSON 내보내기"):
            self.assertNotIn(old_label, markup)
        self.assertGreaterEqual(markup.count('role="menuitem"'), 8)
        self.assertNotIn('id="keyboardHelpBtn"', re.search(r'<header class="topbar">(.*?)</header>', HTML, re.S).group(1))

    def test_dirty_state_is_separate_from_autosave_and_transient_notifications(self):
        self.assertIn("hasUnsavedChanges: false", SAVE_STATE)
        self.assertIn("cleanContentToken", SAVE_STATE)
        self.assertIn("status.hidden = !snapshot.hasUnsavedChanges", APP)
        self.assertIn("자동저장에 실패했습니다. 파일에 직접 저장하는 것을 권장합니다.", APP)
        self.assertIn("프로젝트를 저장하지 못했습니다. 다시 저장해 주세요.", APP)
        self.assertNotIn("자동저장 용량을 초과했습니다", APP)
        self.assertNotIn("saveStatusNeutralTimer", APP)

    def test_open_and_import_intents_share_the_engine_without_sharing_semantics(self):
        self.assertIn("options.intent === 'open' ? 'open' : 'import'", GIS_IO)
        self.assertIn("openMode: importIntent === 'open' ? 'replace' : 'merge'", GIS_IO)
        self.assertIn("targetSelect.value = 'country'", GIS_IO)
        self.assertIn("dataset.fileIntent = 'open'", APP)
        self.assertIn("dataset.fileIntent = 'import'", APP)


if __name__ == "__main__":
    unittest.main()
