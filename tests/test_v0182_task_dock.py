from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
TOOLS = (ROOT / "assets" / "js" / "modules" / "tool-controller.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")


class TaskDockV0182Tests(unittest.TestCase):
    def test_independent_current_work_card_is_removed(self):
        combined = INDEX + APP + CSS
        self.assertNotIn('id="currentTool"', INDEX)
        self.assertNotIn('id="modeBanner"', INDEX)
        self.assertNotIn('>현재 작업<', INDEX)
        self.assertNotIn('map-context-panel', combined)

    def test_task_context_and_commit_actions_share_one_minimizable_window(self):
        for element_id in (
            "mapTopContextSlot", "modeEditingContext", "modeEditingHud", "modeActionBar", "modeTaskName",
            "modeTaskStage", "modeTaskInstruction", "modeTaskMinimizeBtn", "modeTaskCloseBtn", "modeTaskWindowContent", "modePrimaryBtn",
            "modeCancelBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
            self.assertEqual(INDEX.count(f'id="{element_id}"'), 1)
        self.assertEqual(INDEX.count('class="mode-task-context"'), 1)
        context_start = INDEX.index('id="modeEditingContext"')
        context_end = INDEX.index('</section>', context_start)
        action_start = INDEX.index('id="modeActionBar"')
        draft_start = INDEX.index('id="modeDraftActions"')
        buttons_start = INDEX.index('class="mode-action-buttons"')
        self.assertLess(context_start, draft_start)
        self.assertLess(draft_start, action_start)
        self.assertLess(action_start, buttons_start)
        self.assertLess(action_start, context_end)
        self.assertLess(INDEX.index('id="modeCancelBtn"'), INDEX.index('id="modePrimaryBtn"'))
        self.assertIn("function activeModeTaskDescriptor()", APP)
        self.assertIn("function toggleMapTaskWindow()", APP)
        self.assertIn("state.modeTaskMinimized", APP)
        self.assertIn("'annex-territory': Object.freeze({ label: '영토 편입'", TOOLS)
        self.assertIn("'merge-country': Object.freeze({ label: '국가 합병'", TOOLS)
        self.assertIn("stage: '대상 국가 선택'", TOOLS)

    def test_selection_counts_live_in_primary_action_labels(self):
        self.assertIn("`선택 완료 (${state.annexDonorCountryIds.length})`", APP)
        self.assertIn("`합병 (${state.mergeTargetCountryIds.length})`", APP)
        self.assertIn("`편입 (${state.annexSelectedComponentKeys.length})`", APP)
        self.assertNotIn("현재 ${state.annexDonorCountryIds.length}개국", APP)
        self.assertNotIn("현재 ${state.mergeTargetCountryIds.length}개국", APP)

    def test_target_selection_copy_is_short_and_unambiguous(self):
        self.assertIn("편입할 영토 조각을 클릭해 선택하세요.", APP)
        self.assertIn("합병할 국가를 선택하세요.", APP)
        self.assertNotIn("편입할 영토를 가져올 국가", APP)
        self.assertNotIn("국가 합병 대상 선택", APP)

    def test_responsive_task_window_stays_non_modal_and_compact(self):
        self.assertIn(".map-top-context-slot {", CSS)
        self.assertIn(".mode-task-window { width: 100%; overflow: hidden; }", CSS)
        self.assertIn(".mode-task-window-content[hidden] { display: none; }", CSS)
        self.assertIn("#app[data-layout=\"mobile\"] .mode-task-window-body", CSS)
        self.assertIn('#app[data-layout="mobile"] .mode-action-buttons > button { flex: 1 1 0; }', CSS)
        self.assertIn("function syncMapHudBounds()", APP)
        self.assertIn("function syncMapContextSurfaces()", APP)
        self.assertNotIn("active guidance and actions share one task dock", CSS)


if __name__ == "__main__":
    unittest.main()
