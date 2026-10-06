from __future__ import annotations
from tests.application_source import node_json, read_application_sources

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
TEMPORAL = (ROOT / "assets" / "js" / "modules" / "temporal.js").read_text(encoding="utf-8")
TERRITORIAL = (ROOT / "assets" / "js" / "modules" / "territorial-units.js").read_text(encoding="utf-8")
DISTRIBUTION = (ROOT / "assets" / "js" / "modules" / "distribution-model.js").read_text(encoding="utf-8")


class TemporalRemainderPolicyTests(unittest.TestCase):
    def test_models_share_calendar_aware_temporal_parser(self):
        for symbol in ("parseTemporal", "normalizeTemporalInterval", "temporalIntervalsOverlap"):
            self.assertIn(f"function {symbol}", TEMPORAL)
        self.assertIn("daysInMonth", TEMPORAL)
        self.assertIn("year === 0", TEMPORAL)
        self.assertIn("normalizeTemporalInterval", TERRITORIAL)
        self.assertNotIn("localeCompare(text(right.validFrom", TERRITORIAL)

    def test_distribution_values_are_finite_and_preserved_without_percentage_clamping(self):
        actual = node_json(ROOT, """
        import { createDistributionEntry } from './assets/js/modules/distribution-model.js';
        const entry=value=>createDistributionEntry({id:'a',layerId:'L',mode:'territorial',territorialUnitId:'T',value});
        const values=[-1,0,100,250].map(value=>entry(value).value);
        let rejected=0;for(const value of [Infinity,NaN,'',null,true]) {try{entry(value)}catch{rejected++}}
        console.log(JSON.stringify({values,rejected}));
        """)
        self.assertEqual(actual['values'], [-1,0,100,250])
        self.assertEqual(actual['rejected'], 5)
        self.assertNotIn('shareValue', DISTRIBUTION)

    def test_partition_remainder_objects_are_removed(self):
        self.assertNotIn("validatePartitionRemainders", TERRITORIAL)
        self.assertNotIn("reconcilePartitionRemainder", TERRITORIAL)
        self.assertNotIn("isRemainder: true", APP)
        self.assertNotIn("TERRITORIAL_STATUS", TERRITORIAL)
        self.assertNotIn("COUNTRY_REGION_STATUS", APP)


if __name__ == "__main__":
    unittest.main()
