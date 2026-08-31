from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
BOOTSTRAP = (ROOT / "assets" / "js" / "bootstrap.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
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
        self.assertIn('data-app-version="0.30.0"', INDEX)
        self.assertIn("const APP_VERSION = '0.30.0'", APP)
        self.assertIn("const BUILD_ID = '0.30.0'", BOOTSTRAP)
        self.assertIn("const ASSET_REVISION = '0.30.0-r33'", BOOTSTRAP)
        self.assertIn("app.css?v=0.30.0-r33", INDEX)
        self.assertIn("bootstrap.js?v=0.30.0-r33", INDEX)
        self.assertIn("recoverCacheMismatch()", BOOTSTRAP)
        self.assertIn("location.replace(recoveryUrl.href)", BOOTSTRAP)

        revisions = {
            match
            for file_path in REVISION_FILES
            for match in re.findall(r"0\.30\.0-r\d+", file_path.read_text(encoding="utf-8"))
        }
        self.assertEqual(revisions, {"0.30.0-r33"})

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
            "--ui-font-map: 12px",
            "--ui-font-caption: 13px",
            "--ui-font-label: 14px",
            "--ui-font-body: 15px",
            "--ui-font-section: 16px",
            "--ui-font-title: 18px",
            "--ui-font-modal-title: 20px",
            "--ui-weight-regular: 400",
            "--ui-weight-medium: 500",
            "--ui-weight-semibold: 600",
            "--ui-weight-bold: 700",
        ):
            self.assertIn(token, CSS)
        self.assertFalse(re.search(r"font-weight:\s*(?:650|750|760|800)\b", CSS))
        self.assertFalse(re.search(r"font-size:\s*(?:8|9|10|11)px\b", CSS))

    def test_task_dock_and_layer_search_copy(self):
        self.assertIn('id="modeTaskName"', INDEX)
        self.assertIn('id="modeTaskStage"', INDEX)
        self.assertIn('id="modeTaskInstruction"', INDEX)
        self.assertIn('placeholder="레이어 검색"', INDEX)
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
            "피편입국",
            "원본 국가",
            "클릭하세요",
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

    def test_fatal_initialization_and_runtime_errors_are_separate(self):
        self.assertIn("let runtimeReady = false", APP)
        self.assertIn("runtimeReady = true", APP)
        self.assertIn("function handleUnexpectedRuntimeError", APP)
        self.assertIn("if (!runtimeReady)", APP)
        self.assertNotIn("GitHub Pages 또는 로컬 HTTP 서버에서 열었는지 확인", APP)

    def test_bootstrap_loading_copy_and_hierarchy_are_fixed(self):
        text_index = INDEX.index('id="bootstrapLoadingText"')
        probe_index = INDEX.index('id="startupProbe"')
        progress_index = INDEX.index('class="ui-progress bootstrap-progress"')
        self.assertLess(text_index, probe_index)
        self.assertLess(probe_index, progress_index)
        self.assertIn('id="bootstrapLoadingText">지도를 표시하는 중입니다<', INDEX)
        self.assertIn('id="startupProbe" class="startup-probe">잠시만 기다려 주세요<', INDEX)
        self.assertNotIn("JavaScript·Worker 실행을 확인하세요", INDEX)
        self.assertIn('#bootstrapLoadingText { color: var(--text-strong); font-size: var(--ui-font-body); font-weight: var(--ui-weight-semibold);', CSS)
        self.assertIn('.startup-probe { margin-top: var(--ui-space-1-5); color: var(--muted); font-size: var(--ui-font-caption);', CSS)
        self.assertIn('.ui-progress.bootstrap-progress { height: 4px; margin-top: var(--ui-space-4);', CSS)
        self.assertIn("message.textContent = '지도를 불러오지 못했습니다'", BOOTSTRAP)
        self.assertIn("probe.textContent = '페이지를 새로고침해 다시 시도해 주세요'", BOOTSTRAP)


if __name__ == "__main__":
    unittest.main()
