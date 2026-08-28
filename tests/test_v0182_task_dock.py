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

    def test_task_context_and_commit_actions_use_separate_surfaces(self):
        for element_id in (
            "mapTopContextSlot", "modeEditingContext", "modeEditingHud", "modeActionBar", "modeTaskName",
            "modeTaskStage", "modeTaskInstruction", "modePrimaryBtn",
            "modeCancelBtn",
        ):
            self.assertIn(f'id="{element_id}"', INDEX)
        self.assertEqual(INDEX.count('class="mode-task-context"'), 1)
        context_start = INDEX.index('id="modeEditingContext"')
        context_end = INDEX.index('id="modeDraftActions"')
        action_start = INDEX.index('id="modeActionBar"')
        self.assertLess(context_start, context_end)
        self.assertLess(context_end, action_start)
        self.assertNotIn('id="modePrimaryBtn"', INDEX[context_start:context_end])
        self.assertNotIn('id="modeCancelBtn"', INDEX[context_start:context_end])
        self.assertLess(INDEX.index('id="modeCancelBtn"'), INDEX.index('id="modePrimaryBtn"'))
        self.assertIn("function activeModeTaskDescriptor()", APP)
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
        self.assertIn("로 영토를 이전할 국가를 선택하세요.", APP)
        self.assertIn("에 합병할 국가를 선택하세요.", APP)
        self.assertNotIn("편입할 영토를 가져올 국가", APP)
        self.assertNotIn("국가 합병 대상 선택", APP)

    def test_responsive_task_surfaces_follow_top_and_bottom_contract(self):
        self.assertIn(".map-top-context-slot {", CSS)
        self.assertIn("width: min(100%, 460px);", CSS)
        self.assertIn(".mode-method-switch { width: min(100%, 320px); }", CSS)
        self.assertIn("bottom: calc(var(--ui-map-status-height) + var(--ui-map-edge));", CSS)
        self.assertIn('#app[data-layout="mobile"] .mode-action-buttons > button { flex: 1 1 0; }', CSS)
        self.assertIn("function syncMapHudBounds()", APP)
        self.assertIn("function syncMapContextSurfaces()", APP)
        self.assertNotIn("active guidance and actions share one task dock", CSS)


if __name__ == "__main__":
    unittest.main()
