from tests.application_source import element_markup, read_application_sources, read_ui_sources
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
TOOLS = (ROOT / "assets" / "js" / "modules" / "tool-controller.js").read_text(encoding="utf-8")
CSS = read_ui_sources(ROOT)


class TaskDockV0182Tests(unittest.TestCase):
    def test_independent_current_work_card_is_removed(self):
        combined = INDEX + APP + CSS
        self.assertNotIn('id="currentTool"', INDEX)
        self.assertNotIn('id="modeBanner"', INDEX)
        self.assertNotIn('>현재 작업<', INDEX)
        self.assertNotIn('map-context-panel', combined)

    def test_task_context_and_commit_actions_share_one_minimizable_window(self):
        task = element_markup(INDEX,'modeEditingHud')
        for element_id in ('modeTaskName','modeTaskStage','modeTaskInstruction','modeTaskMinimizeBtn','modeTaskWindowContent','modePrimaryBtn','modeCancelBtn'):
            self.assertEqual(task.count(f'id="{element_id}"'), 1)
        self.assertLess(task.index('id="modeDraftActions"'), task.index('id="modeActionBar"'))
        self.assertLess(task.index('id="modeCancelBtn"'), task.index('id="modePrimaryBtn"'))
        self.assertIn('function activeModeTaskDescriptor()', APP)
        self.assertIn('function toggleMapTaskWindow()', APP)
        self.assertIn('state.modeTaskMinimized', APP)
        self.assertIn("'annex-territory'", TOOLS)
        self.assertIn("'merge-country'", TOOLS)

    def test_selection_counts_live_in_primary_action_labels(self):
        self.assertIn("`국경 편집 (${state.boundaryEditEntityIds.length})`", APP)
        self.assertIn("`합병 (${state.mergeTargetCountryIds.length})`", APP)
        self.assertIn("finalLabel: count => `편입 (${count})`", APP)
        self.assertNotIn("annexDonorCountryIds", APP)
        self.assertNotIn("annexSelectedComponentKeys", APP)
        self.assertNotIn("현재 ${state.mergeTargetCountryIds.length}개국", APP)

    def test_target_selection_copy_is_short_and_unambiguous(self):
        self.assertIn("'가져올 영토 조각'", APP)
        self.assertIn("'하천으로 나뉜 영토 조각'", APP)
        self.assertIn("components: '가져올 영토 조각을 선택하세요.'", APP)
        self.assertIn("합병할 국가를 선택하세요.", APP)
        self.assertNotIn("편입할 영토를 가져올 국가", APP)
        self.assertNotIn("국가 합병 대상 선택", APP)

    def test_responsive_task_window_stays_non_modal_and_compact(self):
        task = element_markup(INDEX,'modeEditingHud')
        self.assertIn('role="region"', task)
        self.assertNotIn('aria-modal="true"', task)
        self.assertIn('modeTaskMinimizeBtn', task)
        self.assertIn('modeTaskWindowContent', task)
        self.assertIn('modePrimaryBtn', task)
        self.assertRegex(CSS,r'\.mode-task-window\s*\{[^}]*width: 100%[^}]*overflow: hidden')
        self.assertIn('.mode-task-window-content[hidden]', CSS)
        self.assertIn('function syncMapHudBounds()', APP)
        self.assertIn('function syncMapContextSurfaces()', APP)


if __name__ == "__main__":
    unittest.main()
