from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")


class TaskDockV0182Tests(unittest.TestCase):
    def test_independent_current_work_card_is_removed(self):
        combined = INDEX + APP + CSS
        self.assertNotIn('id="currentTool"', INDEX)
        self.assertNotIn('id="modeBanner"', INDEX)
        self.assertNotIn('>현재 작업<', INDEX)
        self.assertNotIn('map-context-panel', combined)

    def test_task_name_stage_instruction_and_actions_share_one_dock(self):
        for element_id in (
            "modeActionBar", "modeTaskContext", "modeTaskName",
            "modeTaskStage", "modeTaskInstruction", "modePrimaryBtn",
            "modeCancelBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertIn("function activeModeTaskDescriptor()", APP)
        self.assertIn("{ name: '영토 편입', stage }", APP)
        self.assertIn("{ name: '국가 합병', stage: '대상 국가 선택' }", APP)

    def test_selection_counts_live_in_primary_action_labels(self):
        self.assertIn("`선택 완료 (${state.annexDonorCountryIds.length})`", APP)
        self.assertIn("`합병 (${state.mergeTargetCountryIds.length})`", APP)
        self.assertIn("`편입 (${state.annexSelectedComponentKeys.length})`", APP)
        self.assertNotIn("현재 ${state.annexDonorCountryIds.length}개국", APP)
        self.assertNotIn("현재 ${state.mergeTargetCountryIds.length}개국", APP)

    def test_target_selection_copy_is_short_and_unambiguous(self):
        self.assertIn("로 영토를 이전할 국가를 선택하세요.", APP)
        self.assertIn("에 합병할 국가를 선택하세요.", APP)
        self.assertNotIn("편입할 영토를 가져올 국가", APP)
        self.assertNotIn("국가 합병 대상 선택", APP)

    def test_responsive_task_dock_has_wide_and_stacked_layouts(self):
        self.assertIn("grid-template-columns: minmax(180px, 1fr) auto auto;", CSS)
        self.assertIn('#app[data-layout="compact"] .mode-action-bar.has-method-switch .mode-task-context', CSS)
        self.assertIn('#app[data-layout="mobile"] .mode-action-bar.has-method-switch .mode-task-context', CSS)
        self.assertIn("grid-column: 1 / -1;", CSS)


if __name__ == "__main__":
    unittest.main()
