from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest


TOOLS = Path(__file__).parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
SPEC = importlib.util.spec_from_file_location("build_hydro_spacing_test", TOOLS / "build-hydro-tiles.py")
BUILDER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILDER
SPEC.loader.exec_module(BUILDER)


class HydronymSpacingTests(unittest.TestCase):
    def test_aral_names_use_canonical_korean_sea_names(self):
        aliases=json.loads((TOOLS.parent/'assets/data/hydro/hydronym-ko-overrides.json').read_text(encoding='utf-8'))['aliases']
        for old,expected in [('사우스아랄씨','남아랄해'),('노스아랄씨','북아랄해'),('사우스아랄씨호','남아랄해'),('노스아랄씨호','북아랄해')]:
            self.assertEqual(BUILDER.normalize_hydronym(old,'lake',aliases),expected)

    def test_compound_korean_names_are_compact(self):
        for name, category, expected in [
            ("세인트 폴 강", "river", "세인트폴강"),
            ("레이크 위니페고시스", "lake", "레이크위니페고시스호"),
            ("조지아 만", "lake", "조지아만"),
            ("비스툴라 석호", "lake", "비스툴라석호"),
            ("브라마푸트라강 / 얄룽창포강", "river", "브라마푸트라강/얄룽창포강"),
        ]:
            with self.subTest(name=name):
                self.assertEqual(BUILDER.normalize_hydronym(name, category, {}), expected)

    def test_reviewed_names_are_compact_but_original_english_and_placeholders_are_not(self):
        self.assertEqual(BUILDER.normalize_hydronym("Example River", "river", {}), "Example")
        self.assertEqual(BUILDER.normalize_hydronym("미명명 수계 4", "river", {}), "미명명 수계 4")
        self.assertEqual(BUILDER.normalize_hydronym("Example", "river", {"Example": "산타 마리아강"}), "산타마리아강")


if __name__ == "__main__":
    unittest.main()
