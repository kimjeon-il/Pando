"""Focused offline tests for historical place batch queue/finalization."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("place_batch_pipeline", ROOT / "tools" / "place-batch-pipeline.py")
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)


def city(identifier=23):
    return {
        "geonameId": identifier, "names": [
            {"text": "옛도시", "language": "ko", "usage": "historical"},
            {"text": "Oldtown", "language": "en", "usage": "historical"},
            {"text": "古町", "language": "ja", "usage": "historical"},
            {"text": "신도시", "language": "ko", "usage": "standard"},
            {"text": "Newtown", "language": "en", "usage": "standard"},
            {"text": "新町", "language": "ja", "usage": "standard"}],
        "latitude": 35.0, "longitude": 130.0, "featureClass": "P", "featureCode": "PPLC",
        "sourceCountryCode": "JP", "sourceUrl": f"https://www.geonames.org/{identifier}/",
        "defaultDisplayNameKo": "신도시", "defaultDisplayNameEn": "Newtown",
        "defaultDisplayNameNative": "新町", "defaultNativeLanguage": "ja",
        "shortDescriptionKo": "1888년 신도시로 개칭",
        "displayTimeline": [
            {"fromYear": 1801, "nameKo": "옛도시", "nameEn": "Oldtown", "nameNative": "古町",
             "nativeLanguage": "ja", "kind": "historicalLocalName", "sourceUrl": "https://example.com/old"},
            {"fromDate": "1888-07-13", "nameKo": "신도시", "nameEn": "Newtown", "nameNative": "新町",
             "nativeLanguage": "ja", "kind": "officialRenaming", "sourceUrl": "https://example.com/new"}]
    }


def reviewed(*records, batch="16-sample"):
    return {"schema": TOOL.SCHEMA, "batch": batch, "status": TOOL.STAGING_STATUS,
            "source": "GeoNames + authenticated municipal source", "checkedOn": "2026-10-11",
            "records": list(records)}


def candidate(identifier, country="JP", population=1000, code="PPL"):
    return {"geonameId": identifier, "name": f"City{identifier}", "countryCode": country,
            "latitude": 35, "longitude": 131, "featureClass": "P", "featureCode": code,
            "population": population}


class PlaceBatchPipelineTests(unittest.TestCase):
    def test_audit_counts_legacy_records_without_retrospective_schema_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tier1-major-cities-batch15-test.json").write_text(
                json.dumps({"schema": TOOL.SCHEMA, "records": [{"geonameId": 23,
                    "displayTimeline": [{"fromYear": 1801}]}]}), encoding="utf-8")
            self.assertEqual(TOOL.audit(root), {"batchFiles": 1, "cities": 1,
                "nameTimelineEntries": 1, "legacyTimelineEntriesWithoutSourceUrl": 1,
                "scope": "staged historical name data, not runtime or historical city ranking"})
            (root / "tier1-major-cities-batch14-test.json").write_text(
                json.dumps({"schema": TOOL.SCHEMA, "records": [{"geonameId": 23}]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate GeoNames ID"):
                TOOL.registered(root)

    def test_plan_prioritizes_capitals_not_historical_rank_and_excludes_staged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            places = root / "places"; places.mkdir()
            (places / "tier1-major-cities-batch15-test.json").write_text(
                json.dumps({"schema": TOOL.SCHEMA, "records": [{"geonameId": 1}]}), encoding="utf-8")
            source = root / "candidates.ndjson"
            source.write_text("".join(json.dumps(r) + "\n" for r in [candidate(1, population=9999999),
                  candidate(2, population=5000000), candidate(3, population=20, code="PPLC"),
                  candidate(4, country="FR", population=800000), candidate(5, population=100000)]), encoding="utf-8")
            result = TOOL.plan(source, places, batch=16, limit=3, countries=["JP"])
            self.assertEqual([x["geonameId"] for x in result["candidates"]], [3, 2, 5])
            self.assertEqual(result["status"], "unreviewed-candidates-not-city-approval")
            self.assertEqual(result["counts"]["previouslyStaged"], 1)
            self.assertEqual(result["candidates"][0]["difficulty"], "unclassified")
            result = TOOL.plan(source, places, batch=16, min_population=100001)
            self.assertEqual([x["geonameId"] for x in result["candidates"]], [2, 4])
            with self.assertRaisesRegex(ValueError, "already exists"):
                TOOL.plan(source, places, batch=15)

    def test_hash_mismatch_duplicate_candidate_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_file = root / "candidate.ndjson"
            input_file.write_text(json.dumps(candidate(5)) + "\n", encoding="utf-8")
            summary = root / "summary.json"
            summary.write_text(json.dumps({"refinedArtifact": {"sha256": "bad"}}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                TOOL.plan(input_file, root, batch=16, reviewed_summary=summary)
            input_file.write_text((json.dumps(candidate(5)) + "\n") * 2, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate candidate"):
                TOOL.plan(input_file, root, batch=16)
            output = root / "new.json"
            TOOL.write_new_json(output, {"one": 1})
            with self.assertRaisesRegex(ValueError, "overwrite"):
                TOOL.write_new_json(output, {"two": 2})
            self.assertEqual(TOOL.read_json(output), {"one": 1})

    def test_finalize_requires_researched_evidence_and_uses_create_only_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            places = Path(tmp)
            src = places / "reviewed.json"
            dest = places / "tier1-major-cities-batch16-sample.json"
            src.write_text(json.dumps(reviewed(city()), ensure_ascii=False), encoding="utf-8")
            self.assertEqual(TOOL.finalize(src, dest, places, check=True), {"validatedCities": 1, "validatedPeriods": 2})
            self.assertFalse(dest.exists())
            TOOL.finalize(src, dest, places)
            self.assertEqual(TOOL.read_json(dest)["records"][0]["geonameId"], 23)
            with self.assertRaisesRegex(ValueError, "overwrite"):
                TOOL.finalize(src, dest, places)

    def test_rejects_unverified_or_invalid_dates_and_mismatch(self):
        original = reviewed(city())
        bad = copy.deepcopy(original);bad["status"] = "unreviewed" 
        with self.assertRaisesRegex(ValueError, "unreviewed"):
            TOOL.validate_reviewed(bad, {})
        bad = copy.deepcopy(original);bad["records"][0]["displayTimeline"][1]["fromDate"] = "1888-02-30"
        with self.assertRaisesRegex(ValueError, "Gregorian date"):
            TOOL.validate_reviewed(bad, {})
        bad = copy.deepcopy(original);bad["records"][0]["displayTimeline"][1]["fromDate"] = "1888-7-13"
        with self.assertRaisesRegex(ValueError, "Gregorian date"):
            TOOL.validate_reviewed(bad, {})
        bad = copy.deepcopy(original);bad["records"][0]["displayTimeline"][1]["nameKo"] = "가짜"
        with self.assertRaisesRegex(ValueError, "not listed"):
            TOOL.validate_reviewed(bad, {})
        bad = copy.deepcopy(original);bad["records"][0]["displayTimeline"][1].pop("sourceUrl")
        with self.assertRaisesRegex(ValueError, "sourceUrl"):
            TOOL.validate_reviewed(bad, {})
        bad = copy.deepcopy(original);bad["records"][0]["defaultDisplayNameKo"] = "거짓"
        with self.assertRaisesRegex(ValueError, "disagrees"):
            TOOL.validate_reviewed(bad, {})
        bad = copy.deepcopy(original);bad["records"][0]["displayTimeline"][1]["fromYear"] = 1888
        with self.assertRaisesRegex(ValueError, "XOR"):
            TOOL.validate_reviewed(bad, {})
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            TOOL.validate_reviewed(reviewed(city(), city()), {})

    def test_two_exact_changes_in_one_year_allowed_year_only_ambiguity_rejected(self):
        item = city()
        item["names"].append({"text": "중간도시", "language": "ko"})
        item["displayTimeline"].insert(1, {"fromDate": "1888-02-01", "nameKo": "중간도시",
               "kind": "editorial", "sourceUrl": "https://example.com/x"})
        self.assertEqual(TOOL.validate_reviewed(reviewed(item), {})["validatedPeriods"], 3)
        item["displayTimeline"][1] = {"fromYear": 1888, "nameKo": "중간도시",
               "kind": "editorial", "sourceUrl": "https://example.com/x"}
        with self.assertRaisesRegex(ValueError, "uncertain same-year"):
            TOOL.validate_reviewed(reviewed(item), {})


if __name__ == "__main__":
    unittest.main()
