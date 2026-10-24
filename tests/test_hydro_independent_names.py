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
        self.assertEqual(len(rows), 40)
        self.assertEqual(set(rows), {
            "20282220", "20323928", "20342955", "20457454",
            "20478829", "20673409", "20680587", "40485117",
            "40505530", "41261061", "41279826", "41339527",
            "41347969", "50261309", "70576631", "70580124",
            "70816878", "70819626",
            "40145639", "40351117", "41392598", "70842751",
            "20336821", "20452421", "20588291", "41225082", "50170097",
            "40190238", "40613666",
            "20081953", "20446779", "20498112", "70617856",
            "10047863", "20244836", "40017702", "70814357", "20265844",
            "20386022", "40279876",
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
            "20265844": "비스와강",
        })
        self.assertEqual(rows["20282220"]["aliases"], ["Elbe", "Labe"])
        self.assertEqual(rows["20282220"]["tributaryNames"], ["블타바강"])
        self.assertEqual(rows["20323928"]["tributaryNames"], ["마인강", "모젤강", "아레강"])
        self.assertEqual(rows["40351117"]["nameKo"], "압록강")
        self.assertEqual(rows["40351117"]["tributaryNames"], ["훈강"])
        self.assertEqual(rows["41392598"]["nameKo"], "메콩강")
        self.assertEqual(rows["70842751"]["nameKo"], "리오그란데강")
        self.assertEqual(rows["41225082"]["nameKo"], "람강")
        self.assertEqual(rows["40613666"]["nameKo"], "장강")
        self.assertNotIn("메콩강", rows["40613666"]["aliases"])
        self.assertNotIn("메콩강", rows["40613666"]["tributaryNames"])
        self.assertEqual(rows["40190238"]["tributaryNames"], ["판지강"])
        self.assertNotIn("Seine", rows["20446779"]["aliases"])
        self.assertNotIn("San Joaquin", rows["70617856"]["aliases"])
        self.assertNotIn("리오그란데강", rows["70814357"]["aliases"])
        self.assertEqual(rows["20265844"]["tributaryNames"], ["부크강", "나레프강"])
        self.assertNotIn("Drwęca", rows["20265844"]["aliases"])
        self.assertIn("independentBasinRename", rows["20265844"])
        for key in ("20386022", "40279876"):
            self.assertEqual(rows[key]["nameKo"], rows[key]["previousNameKo"])
            self.assertEqual(rows[key]["partialExistingNameReview"]["strongestOtherNENameCoverage"], 0)
        self.assertNotIn("리오그란데강", rows["70814357"]["tributaryNames"])
        self.assertEqual(rows["20244836"]["tributaryNames"], ["네리스강"])
        self.assertEqual(rows["40017702"]["tributaryNames"], ["우수리강"])
        self.assertIn("백나일강", rows["10047863"]["tributaryNames"])
        self.assertNotIn("메콩강", rows["20498112"]["tributaryNames"])
        for ident in ("20081953", "20446779", "20498112", "70617856"):
            self.assertEqual(rows[ident]["nameKo"], rows[ident]["previousNameKo"])
            self.assertIn("basinConfluenceReview", rows[ident])
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

    def test_basin_confluence_cannot_be_guessed(self):
        original = json.loads(PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "invalid-basin.json"
            for problem in ("wrong-river", "weak-tributary", "no-official-source", "wrong-basin"):
                candidate = copy.deepcopy(original)
                row = next(item for item in candidate["replacements"] if item["systemId"] == "20498112")
                if problem == "wrong-river":
                    row["basinConfluenceReview"]["namedTributaryNE"] = "Danube"
                elif problem == "weak-tributary":
                    row["basinConfluenceReview"]["tributarySampleCoverage"] = 0.01
                elif problem == "no-official-source":
                    row["independentSources"] = [row["independentSources"][0]]
                else:
                    row["nameKo"] = "오데르강"
                output.write_text(json.dumps(candidate), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_independent_hydronyms(output)

    def test_wrong_basin_rename_does_not_get_approved(self):
        obj = json.loads(PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "bad-renaming.json"
            for failing in ("too-few-samples", "missing-ministry", "wrong-identity-method", "rename-to-same-name"):
                edited = copy.deepcopy(obj)
                entry = next(row for row in edited["replacements"] if row["systemId"] == "20265844")
                if failing == "too-few-samples":
                    entry["independentBasinRename"]["tributarySampleCoverage"] = 0.1
                elif failing == "missing-ministry":
                    entry["independentSources"] = [s for s in entry["independentSources"]
                                                    if s["kind"] != "government-ministry-geography"]
                elif failing == "wrong-identity-method":
                    entry["independentBasinRename"]["method"] = "auto-bbox-rename"
                else:
                    entry["nameKo"] = "드르벵차강"
                target.write_text(json.dumps(edited), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_independent_hydronyms(target)

    def test_partial_name_reviews_require_no_competing_named_rivers(self):
        original = json.loads(PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "invalid-partial.json"
            for failure in ("competing-river", "name-mutation", "missing-government", "too-weak"):
                obj = copy.deepcopy(original)
                row = next(item for item in obj["replacements"] if item["systemId"] == "20386022")
                if failure == "competing-river":
                    row["partialExistingNameReview"]["strongestOtherNENameCoverage"] = 0.4
                elif failure == "name-mutation":
                    row["nameKo"] = "테베레강"
                elif failure == "missing-government":
                    row["independentSources"] = [row["independentSources"][0]]
                else:
                    row["naturalEarth"]["sampleCoverage"] = 0.2
                output.write_text(json.dumps(obj), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_independent_hydronyms(output)

    def test_old_osm_only_basins_are_not_assigned_names_in_bulk(self):
        rows = load_independent_hydronyms(PATH)
        self.assertNotIn("41023100", rows)  # Indus/Ravi: more source review
        self.assertNotIn("20773860", rows)  # Suez Canal: feature class review
        self.assertNotIn("70814357", rows)  # Mississippi tributaries: mixed relation review
        self.assertNotIn("41386179", rows)  # Saigon: unnamed master; no promotion


if __name__ == "__main__":
    unittest.main()
