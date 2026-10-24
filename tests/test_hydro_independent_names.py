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
        self.assertEqual(len(rows), 27)
        self.assertEqual(set(rows), {
            "20282220", "20323928", "20342955", "20457454",
            "20478829", "20673409", "20680587", "40485117",
            "40505530", "41261061", "41279826", "41339527",
            "41347969", "50261309", "70576631", "70580124",
            "70816878", "70819626",
            "40145639", "40351117", "41392598", "70842751",
            "20336821", "20452421", "20588291", "41225082", "50170097",
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
        self.assertEqual(rows["40351117"]["nameKo"], "압록강")
        self.assertEqual(rows["40351117"]["tributaryNames"], ["훈강"])
        self.assertEqual(rows["41392598"]["nameKo"], "메콩강")
        self.assertEqual(rows["70842751"]["nameKo"], "리오그란데강")
        self.assertEqual(rows["41225082"]["nameKo"], "람강")
        for ident in ("20336821","20452421","20588291","50170097"):
            self.assertEqual(rows[ident]["previousNameKo"], rows[ident]["nameKo"])
            self.assertIn("conservativeMainstemReview", rows[ident])

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

    def test_station_based_qualification_rejects_spurious_gauges(self):
        original = json.loads(PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "broken.json"
            for mutation in ("far-from-mainstem", "not-separated", "missing-gauge-source"):
                candidate = copy.deepcopy(original)
                entry = next(row for row in candidate["replacements"] if row["systemId"] == "70819626")
                if mutation == "far-from-mainstem":
                    entry["officialStationEvidence"]["maximumMatchingStationDistanceKm"] = 15.0
                elif mutation == "not-separated":
                    entry["officialStationEvidence"]["nearestDifferentBasinStationKm"] = 0.2
                else:
                    entry["independentSources"] = entry["independentSources"][:1]
                output.write_text(json.dumps(candidate), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_independent_hydronyms(output)

    def test_conservative_name_review_must_have_non_conflicting_independent_evidence(self):
        original = json.loads(PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "weak.json"
            for wrong in ("identity-changed", "competitor-name", "unsupported-low-coverage", "no-government-source"):
                candidate = copy.deepcopy(original)
                entry = next(row for row in candidate["replacements"] if row["systemId"] == "20336821")
                if wrong == "identity-changed":
                    entry["nameKo"] = "오데르강"
                elif wrong == "competitor-name":
                    entry["conservativeMainstemReview"]["otherNamedNECoverage"] = 0.40
                elif wrong == "unsupported-low-coverage":
                    entry["naturalEarth"]["sampleCoverage"] = 0.21
                else:
                    entry["independentSources"] = [entry["independentSources"][0]]
                target.write_text(json.dumps(candidate), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_independent_hydronyms(target)

    def test_old_osm_only_basins_are_not_assigned_names_in_bulk(self):
        rows = load_independent_hydronyms(PATH)
        self.assertNotIn("41023100", rows)  # Indus/Ravi: more source review
        self.assertNotIn("20773860", rows)  # Suez Canal: feature class review
        self.assertNotIn("70814357", rows)  # Mississippi tributaries: mixed relation review
        self.assertNotIn("41386179", rows)  # Saigon: unnamed master; no promotion


if __name__ == "__main__":
    unittest.main()
