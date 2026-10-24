"""Focused contract checks for staged, independently sourced Hydro name corrections."""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from gis.hydro_independent_name_policy import load_independent_hydronyms

PATH = ROOT / "tools/gis/hydro-independent-name-replacements.json"


class IndependentHydronymReviewTests(unittest.TestCase):
    def test_replacements_are_exactly_the_five_independently_checked_systems(self):
        rows = load_independent_hydronyms(PATH)
        self.assertEqual(set(rows), {
            "20680587", "40485117", "41279826", "50261309", "70576631"
        })
        self.assertEqual({key: value["nameKo"] for key, value in rows.items()}, {
            "20680587": "과달키비르강",
            "40485117": "도네강",
            "41279826": "살윈강",
            "50261309": "바리토강",
            "70576631": "델라웨어강",
        })
        for item in rows.values():
            self.assertFalse(any("openstreetmap" in src["url"].lower()
                                 for src in item["independentSources"]))
            self.assertNotIn(item["previousNameKo"], item["aliases"])
            self.assertNotIn(item["previousNameKo"], item["tributaryNames"])

    def test_mismatched_source_and_low_sample_coverage_are_rejected(self):
        original = json.loads(PATH.read_text(encoding="utf-8"))
        cases = [
            lambda item: item["independentSources"][0].update(
                url="https://www.openstreetmap.org/relation/1"
            ),
            lambda item: item["naturalEarth"].update(sampleCoverage=0.22),
            lambda item: item.update(nameKo=""),
        ]
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory) / "invalid.json"
            for mutate in cases:
                obj = copy.deepcopy(original)
                mutate(obj["replacements"][0])
                temp.write_text(json.dumps(obj), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_independent_hydronyms(temp)

    def test_old_osm_only_basins_are_not_assigned_names_in_bulk(self):
        rows = load_independent_hydronyms(PATH)
        self.assertNotIn("41023100", rows)  # Indus/Ravi: more source review
        self.assertNotIn("20773860", rows)  # Suez Canal: feature class review
        self.assertNotIn("70816878", rows)  # Brazos: Korean orthography review
        self.assertNotIn("41386179", rows)  # Saigon: unnamed master; no promotion


if __name__ == "__main__":
    unittest.main()
