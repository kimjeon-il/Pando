from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
TEMPORAL = (ROOT / "assets" / "js" / "modules" / "temporal.js").read_text(encoding="utf-8")
TERRITORIAL = (ROOT / "assets" / "js" / "modules" / "territorial-units.js").read_text(encoding="utf-8")
DISTRIBUTION = (ROOT / "assets" / "js" / "modules" / "distribution-model.js").read_text(encoding="utf-8")


class TemporalRemainderPolicyTests(unittest.TestCase):
    def test_models_share_calendar_aware_temporal_parser(self):
        for symbol in ("parseTemporal", "normalizeTemporalInterval", "temporalIntervalsOverlap"):
            self.assertIn(f"function {symbol}", TEMPORAL)
        self.assertIn("daysInMonth", TEMPORAL)
        self.assertIn("year === 0", TEMPORAL)
        self.assertIn("temporalIntervalsOverlap", TERRITORIAL)
        self.assertNotIn("localeCompare(text(right.validFrom", TERRITORIAL)

    def test_strict_distribution_share_does_not_clamp(self):
        share = DISTRIBUTION[DISTRIBUTION.index("function shareValue"):DISTRIBUTION.index("export function normalizeDistributionLayer")]
        self.assertIn("Number.isFinite", share)
        self.assertIn("share < 0 || share > 100", share)
        self.assertNotIn("Math.max", share)
        self.assertNotIn("Math.min", share)

    def test_partition_remainder_is_not_sovereignty_status(self):
        self.assertIn("validatePartitionRemainders", TERRITORIAL)
        self.assertIn("reconcilePartitionRemainder", TERRITORIAL)
        self.assertIn("isRemainder", APP)
        self.assertNotIn("TERRITORIAL_STATUS", TERRITORIAL)
        self.assertNotIn("COUNTRY_REGION_STATUS", APP)


if __name__ == "__main__":
    unittest.main()
