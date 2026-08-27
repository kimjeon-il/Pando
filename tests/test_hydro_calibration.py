from __future__ import annotations

import importlib.util
import math
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "tools" / "calibrate-hydro.py"
SPEC = importlib.util.spec_from_file_location("pandolab_hydro_calibration", SCRIPT)
assert SPEC and SPEC.loader
calibration = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = calibration
SPEC.loader.exec_module(calibration)


def river(source_id: int, next_down: int, stage: float | None = 6.0):
    return calibration.LinearFeature(
        source_id=source_id,
        next_down=next_down,
        main_river=1,
        order=5,
        flow=100.0,
        upstream_area=1000.0,
        parts=[[(0.0, 0.0), (1.0, 0.0)]],
        source_coordinate_count=2,
        length_km=100.0,
        screen_length=10.0,
        assigned_stage=stage,
    )


class HydroCalibrationTests(unittest.TestCase):
    def test_river_score_uses_named_hydro_fields(self):
        feature = river(1, 0)
        expected = 5 + 1.3 * math.log10(100) + 0.7 * math.log10(1000)
        self.assertAlmostEqual(feature.score(1.3, 0.7), expected)

    def test_chaining_preserves_every_coordinate(self):
        result = calibration.chain_rivers([river(1, 2), river(2, 0)])
        self.assertEqual(result["selectedReachCount"], 2)
        self.assertEqual(result["chainCount"], 1)
        self.assertEqual(result["sourceCoordinateCount"], 4)
        self.assertEqual(result["coordinatesAfterChaining"], 4)

    def test_chaining_does_not_join_different_display_stages(self):
        result = calibration.chain_rivers([river(1, 2, 6.0), river(2, 0, 6.7)])
        self.assertEqual(result["chainCount"], 2)

    def test_candidate_floor_covers_reported_threshold(self):
        results_path = SCRIPT.parents[1] / "reports" / "hydro-calibration" / "results.json"
        if not results_path.exists():
            self.skipTest("calibration report has not been generated")
        import json

        results = json.loads(results_path.read_text(encoding="utf-8"))
        river_formula = results["formula"]["rivers"]
        self.assertGreaterEqual(min(river_formula["thresholds"].values()), river_formula["candidateFloor"])


if __name__ == "__main__":
    unittest.main()
