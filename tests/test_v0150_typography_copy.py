from __future__ import annotations
from tests.application_source import assert_shell_versions, element_markup, function_source, read_application_sources, read_module, read_ui_sources

import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
BOOTSTRAP = (ROOT / "assets" / "js" / "bootstrap.js").read_text(encoding="utf-8")
CSS = read_ui_sources(ROOT)
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
FONT = ROOT / "assets" / "fonts" / "pretendard-v1.3.9" / "PretendardVariable.woff2"
LICENSE = ROOT / "assets" / "fonts" / "pretendard-v1.3.9" / "LICENSE.txt"
REVISION_FILES = [
    ROOT / "index.html",
    ROOT / "assets" / "js" / "app.js",
    ROOT / "assets" / "js" / "bootstrap.js",
    ROOT / "assets" / "js" / "gis-io.js",
    ROOT / "assets" / "js" / "workers" / "data-loader-worker.js",
    ROOT / "assets" / "js" / "workers" / "gis-gpkg-worker.js",
    ROOT / "assets" / "js" / "workers" / "gpu-mesh-worker.js",
]


class V0150TypographyCopyTests(unittest.TestCase):
    def test_versioned_shell_and_cache_keys_match(self):
        assert_shell_versions(self, ROOT, INDEX)

    def test_official_pretendard_is_bundled_and_preloaded(self):
        self.assertTrue(FONT.is_file())
        self.assertTrue(LICENSE.is_file())
        digest = hashlib.sha256(FONT.read_bytes()).hexdigest().upper()
        self.assertEqual(digest, "9599F12FD42FC0BCE1CD50B47A0C022E108D7AA64DD0D1BB0ED44F3282D900B4")
        self.assertIn("SIL OPEN FONT LICENSE", LICENSE.read_text(encoding="utf-8").upper())
        self.assertIn('href="assets/fonts/pretendard-v1.3.9/PretendardVariable.woff2"', INDEX)
        self.assertIn('rel="preload"', INDEX)
        self.assertIn('font-family: "Pretendard Variable"', CSS)
        self.assertNotIn("font-family: Inter", CSS)
        self.assertIn("Pretendard v1.3.9", README)

    def test_semantic_type_scale_and_weights(self):
        for token in (
            "--ui-font-map: var(--map-font-body)",
            "--ui-font-caption: var(--design-font-sm)",
            "--ui-font-label: var(--design-font-md)",
            "--ui-font-body: var(--design-font-md)",
            "--ui-font-section: var(--design-font-lg)",
            "--ui-font-title: var(--design-font-xl)",
            "--ui-font-modal-title: var(--design-font-xl)",
            "--ui-weight-regular: var(--design-weight-regular)",
            "--ui-weight-medium: var(--design-weight-medium)",
            "--ui-weight-semibold: var(--design-weight-semibold)",
            "--ui-weight-bold: var(--design-weight-bold)",
        ):
            self.assertIn(token, CSS)
        self.assertFalse(re.search(r"font-weight:\s*(?:650|750|760|800)\b", CSS))
        self.assertFalse(re.search(r"font-size:\s*(?:8|9|10|11)px\b", CSS))

    def test_task_dock_and_layer_search_copy(self):
        self.assertIn('id="modeTaskName"', INDEX)
        self.assertIn('id="modeTaskStage"', INDEX)
        self.assertIn('id="modeTaskInstruction"', INDEX)
        self.assertIn('placeholder="지도에서 찾기"', INDEX)
        self.assertNotIn('>현재 작업<', INDEX)
        self.assertNotIn("현재 도구", INDEX)
        self.assertNotIn("레이어 항목 검색", INDEX)
        self.assertIn("height: var(--ui-control-height)", CSS)
        self.assertIn(".mode-task-heading strong {", CSS)

    def test_user_copy_avoids_mixed_terms_and_request_tone(self):
        visible_sources = "\n".join((INDEX, APP, BOOTSTRAP)).replace(
            "프로젝트를 저장하지 못했습니다. 다시 저장해 주세요.",
            "",
        ).replace(
            "페이지를 새로고침해 다시 시도해 주세요",
            "",
        )
        for forbidden in (
            "수령국",
            "원본 국가",
            "누르세요",
            "해 주세요",
            "해주세요",
            "확인해 주세요",
        ):
            self.assertNotIn(forbidden, visible_sources)
        self.assertIn("편입받을 국가", APP)
        self.assertIn("영토를 가져올 국가", APP)
        self.assertIn("기준 국가", APP)
        self.assertIn("합병할 국가", APP)
        self.assertIn("가져올 국가를 선택하세요.", APP)
        self.assertIn("국가 영토 안쪽을 선택하세요.", APP)

    def test_fatal_initialization_and_runtime_errors_are_separate(self):
        environment = read_module(ROOT, "app-environment.js")
        notifications = read_module(ROOT, "app-readiness-notifications.js")
        ports = read_module(ROOT, "app-capability-ports-lifecycle-ui.js")
        self.assertIn("runtimeReady = false", environment)
        self.assertIn("providers.environment.runtimeReady = true", ports)
        handler = function_source(notifications, "handleUnexpectedRuntimeError")
        self.assertIn("if (!dependencies.readiness.runtimeReady)", handler)
        self.assertIn("showFatalError", handler)
        self.assertIn("PL-RUNTIME-001", handler)
        self.assertIn("console.error", handler)

    def test_bootstrap_loading_copy_and_hierarchy_are_fixed(self):
        text_index = INDEX.index('id="bootstrapLoadingText"')
        probe_index = INDEX.index('id="startupProbe"')
        progress_index = INDEX.index('class="ui-progress bootstrap-progress"')
        self.assertLess(text_index, probe_index)
        self.assertLess(probe_index, progress_index)
        self.assertIn('지도를 표시하는 중입니다', element_markup(INDEX, 'bootstrapLoadingText'))
        self.assertIn('잠시만 기다려 주세요', element_markup(INDEX, 'startupProbe'))
        feedback = (ROOT / 'assets/css/components/feedback.css').read_text(encoding='utf-8')
        self.assertRegex(feedback, r'\.bootstrap-loading-text\s*\{[^}]*font-size: var\(--ui-font-body\)')
        self.assertRegex(feedback, r'\.startup-probe\s*\{[^}]*font-size: var\(--ui-font-caption\)')
        self.assertIn("message.textContent = '지도를 불러오지 못했습니다'", BOOTSTRAP)
        self.assertIn("probe.textContent = '페이지를 새로고침해 다시 시도해 주세요'", BOOTSTRAP)


if __name__ == "__main__":
    unittest.main()
