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
    def test_replacements_include_gauge_verified_brazos_and_texas_colorado(self):
        rows = load_independent_hydronyms(PATH)
        self.assertEqual(len(rows), 18)
        self.assertEqual(set(rows), {
            "20282220", "20323928", "20342955", "20457454",
            "20478829", "20673409", "20680587", "40485117",
            "40505530", "41261061", "41279826", "41339527",
            "41347969", "50261309", "70576631", "70580124",
            "70816878", "70819626",
        })
        renamed = {key: value["nameKo"] for key, value in rows.items()
                   if value["previousNameKo"] != value["nameKo"]}
        self.assertEqual(renamed, {
            "20680587": "과달키비르강",
            "40485117": "도네강",
            "41279826": "살윈강",
            "50261309": "바리토강",
            "70576631": "델라웨어강",
            "70816878": "브래저스강",
            "70819626": "콜로라도강",
        })
        self.assertEqual(rows["20282220"]["aliases"], ["Elbe", "Labe"])
        self.assertEqual(rows["20282220"]["tributaryNames"], ["블타바강"])
        self.assertEqual(rows["20323928"]["tributaryNames"], ["마인강", "모젤강", "아레강"])
        for ident in ("70816878", "70819626"):
            self.assertEqual(rows[ident]["officialStationEvidence"]["agency"], "USGS")
            self.assertEqual(len(rows[ident]["officialStationEvidence"]["stationIds"]), 3)
            self.assertLess(rows[ident]["officialStationEvidence"]["maximumMatchingStationDistanceKm"], 1)

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
