"""Focused, offline GeoNames candidate policy / ingestion / audit tests."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("place_candidates", ROOT / "tools" / "build-place-candidates.py")
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)


def source_line(identifier=1, code="PPL", population="50000", country="KR", latitude="37", longitude="127", name="Example", aliases=""):
    return "\t".join([str(identifier), name, name, aliases, latitude, longitude, "P", code, country,
                     "", "01", "001", "", "", population, "", "0", "Asia/Seoul", "2026-10-01"]) + "\n"


def record(**values):
    return TOOL.parse_row(source_line(**values))[0]


def snapshot(cache, name, lines):
    path = cache / f"{name}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        info = zipfile.ZipInfo(f"{name}.txt", date_time=(2026, 10, 1, 0, 0, 0))
        archive.writestr(info, "".join(lines))
    metadata = {"url": TOOL.BASE_URL + name + ".zip", "downloadedAt": "2026-10-02T00:00:00+00:00",
                "lastModified": "2026-10-01", "zipMemberTimestamp": "2026-10-01T00:00:00",
                "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "geonamesDerived": True, "license": TOOL.LICENSE, "member": f"{name}.txt"}
    TOOL.write_json(cache / f"{name}.source.json", metadata)


class CandidatePolicyTests(unittest.TestCase):
    def test_admin_codes_survive_zero_population(self):
        for code, reason in TOOL.POLICY["adminReasons"].items():
            with self.subTest(code=code):
                value = TOOL.candidate(record(code=code, population="0"))
                self.assertEqual(value["inclusionReason"], reason)
                self.assertEqual(value["populationBucket"], "under-50k-admin")
                self.assertEqual(value["preliminaryDisplayMode"], "search-only")

    def test_population_boundaries_and_modes(self):
        self.assertIsNone(TOOL.candidate(record(population=str(TOOL.POLICY["populationMinimum"] - 1))))
        for threshold, bucket, mode in [("populationMinimum", "50k-99k", "search-only"),
                                        ("autoReviewMinimum", "100k-999k", "auto-review"),
                                        ("millionMinimum", "1m-plus", "auto-review")]:
            value = TOOL.candidate(record(population=str(TOOL.POLICY[threshold])))
            self.assertEqual((value["populationBucket"], value["preliminaryDisplayMode"]), (bucket, mode))

    def test_unadopted_codes_never_enter_even_with_large_population(self):
        for code in ["PPLA3", "PPLA4", "PPLA5", "PPLX", "PPLL", "PPLS", "PPLF", "PPLH", "PPLCH", "PPLQ", "PPLW", "PPLR", "STLMT"]:
            self.assertIsNone(TOOL.candidate(record(code=code, population="2000000")), code)
        row = record(code="PPLC")
        row["featureClass"] = "H"
        self.assertIsNone(TOOL.candidate(row))

    def test_country_and_name_do_not_change_inclusion(self):
        for country in ["KR", "JP", "CN", "IN", "US", "BR", "", "GL"]:
            self.assertIsNotNone(TOOL.candidate(record(country=country, code="PPLA2", population="0", name="Airport District-dong")))

    def test_parse_unicode_and_missing_population_without_silent_loss(self):
        value, missing = TOOL.parse_row(source_line(name="서울", code="PPLC", population=""))
        self.assertTrue(missing)
        self.assertEqual(value["population"], 0)
        self.assertEqual(value["name"], "서울")
        self.assertIsNotNone(TOOL.candidate(value))

    def test_invalid_numeric_and_shape_fields_fail(self):
        for values in [{"latitude": "91"}, {"latitude": "nan"}, {"longitude": "-181"},
                       {"population": "-1"}, {"population": "oops"}, {"identifier": 0}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                TOOL.parse_row(source_line(**values))
        with self.assertRaises(ValueError):
            TOOL.parse_row("1\tbroken\n")

    def test_candidate_invariants_and_duplicate_ids_fail(self):
        value = TOOL.candidate(record())
        TOOL.validate_candidates([value])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            TOOL.validate_candidates([value, value.copy()])
        broken = {**value, "population": 1}
        with self.assertRaisesRegex(ValueError, "violates canonical policy"):
            TOOL.validate_candidates([broken])

    def test_audits_preserve_near_duplicate_and_name_signal_rows(self):
        rows = [TOOL.candidate(record(identifier=1, name="Airport District-dong")),
                TOOL.candidate(record(identifier=2, name="Airport District-dong", longitude="127.001")),
                TOOL.candidate(record(identifier=3, name="Other", country=""))]
        before = copy.deepcopy(rows)
        result = TOOL.audit_kept(rows)
        self.assertEqual(result["nearSameNamePairCount"], 1)
        self.assertEqual(result["nameSignalCount"], 2)
        self.assertEqual(result["koreanMicroNameCount"], 2)
        self.assertEqual(result["missingCountryCodeCount"], 1)
        self.assertEqual(rows, before)
        TOOL.validate_candidates(rows)

    def test_cumulative_counts_do_not_confuse_exclusive_buckets(self):
        rows = [TOOL.candidate(record(identifier=index + 1, code="PPLA", population=str(value)))
                for index, value in enumerate([0, TOOL.POLICY["populationMinimum"], TOOL.POLICY["autoReviewMinimum"], TOOL.POLICY["millionMinimum"]])]
        stats = TOOL.summarize(rows)
        self.assertEqual(stats["population100kPlus"], 2)
        self.assertEqual(stats["population50kPlus"], 3)
        self.assertEqual(stats["population1mPlus"], 1)
        self.assertEqual(stats["under50kAdminSeats"], 1)

    def test_hash_verified_offline_pipeline_is_deterministic_and_no_audit_promotion(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            lines = [source_line(identifier=1, code="PPLC", population="0"),
                     source_line(identifier=2), source_line(identifier=3, code="PPLA3", population="200000"),
                     source_line(identifier=4, code="PPLX", population="200000")]
            snapshot(cache, "cities500", lines)
            snapshot(cache, "allCountries", lines + [source_line(identifier=5, code="PPLG", population="0")])
            report = cache / "report.md"
            report.write_text("Manual analysis\n" + TOOL.GENERATED_START + "\n" + TOOL.GENERATED_END + "\nPreserve me\n", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                stats = TOOL.build(cache, cache / "stats.json", report)
            self.assertEqual(stats["totals"]["totalKept"], 2)
            self.assertEqual(stats["primary"]["rawRows"], 4)
            self.assertEqual(stats["supplement"]["eligibleMissingFromPrimary"][0]["geonameId"], 5)
            self.assertEqual(stats["primary"]["excludedPCodes"], {"PPLA3": 1, "PPLX": 1})
            first = {path.name: path.read_bytes() for path in [cache / "stats.json", cache / "candidates.ndjson", report]}
            with contextlib.redirect_stdout(io.StringIO()):
                TOOL.build(cache, cache / "stats.json", report)
            self.assertEqual(first, {path.name: path.read_bytes() for path in [cache / "stats.json", cache / "candidates.ndjson", report]})
            self.assertIn("Preserve me", report.read_text(encoding="utf-8"))
            metadata = json.loads((cache / "cities500.source.json").read_text(encoding="utf-8"))
            metadata["sha256"] = "wrong"
            TOOL.write_json(cache / "cities500.source.json", metadata)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                TOOL.build(cache, cache / "stats.json", report)

    def test_duplicate_source_id_fails_before_candidate_write(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            snapshot(cache, "cities500", [source_line(), source_line()])
            with self.assertRaisesRegex(ValueError, "duplicate geonameId"):
                TOOL.scan_primary("cities500", cache)

    def test_alias_audit_cannot_change_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            snapshot(cache, "cities500", [source_line(aliases="Town,Example-eup,예시읍", name="Example")])
            rows, stats = TOOL.scan_primary("cities500", cache)
            self.assertEqual(len(rows), 1)
            self.assertEqual(stats["koreanMicroAliasSignals"][0]["matchedAliases"], ["Example-eup", "예시읍"])
            self.assertNotIn("alternateNames", rows[0])

    def test_official_fallback_runs_after_preferred_source_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            results = [{"source": "cities500", "status": "failed", "failures": [{"stage": "official-download", "error": "HTTP 503"}]},
                       {"source": "allCountries", "status": "downloaded", "failures": []}]
            with mock.patch.object(TOOL, "fetch_source", side_effect=results) as fetcher:
                TOOL.fetch(Path(directory))
            self.assertEqual([call.args[0] for call in fetcher.call_args_list], ["cities500", "allCountries"])
            attempts = json.loads((Path(directory) / "fetch-attempts.json").read_text(encoding="utf-8"))
            self.assertEqual(attempts, results)

    def test_fallback_snapshot_builds_without_preferred_source(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            snapshot(cache, "allCountries", [source_line(code="PPLC", population="0")])
            report = cache / "report.md"
            report.write_text(TOOL.GENERATED_START + "\n" + TOOL.GENERATED_END, encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                stats = TOOL.build(cache, cache / "stats.json", report)
            self.assertEqual(stats["primarySource"], "allCountries")
            self.assertEqual(stats["totals"]["totalKept"], 1)
            self.assertIsNone(stats["supplement"])


def review_ledger(raw_rows, actions):
    return {"version": 1,
            "evidenceSources": {"official": {"url": "https://example.gov/places", "publisher": "Official municipality",
                                             "checkedAt": "2026-10-03", "finding": "Fixture administrative status", "access": "official-page"}},
            "decisions": [{"geonameId": row["geonameId"],
                           "expected": {key: row[key] for key in ("name", "countryCode", "featureCode", "latitude", "longitude")},
                           "action": action, "evidence": ["official"], "reason": "Fixture reason"}
                          for row, action in zip(raw_rows, actions)]}


class CandidateReviewTests(unittest.TestCase):
    def test_review_overrides_replace_action_and_append_reason_without_mutating_base(self):
        row = record()
        ledger = review_ledger([row], ["hold"])
        before = copy.deepcopy(ledger)
        overrides = {
            "version": 1,
            "sourceSha256": "fixture-source",
            "overrides": [{
                "geonameId": 1,
                "action": "retain",
                "reasonAppend": "Coordinate identity review accepted.",
                "coordinateCorrectionRef": "reports/places/coordinate-corrections.json#1",
            }],
        }
        ledger["source"] = {"name": "cities500", "sha256": "fixture-source"}
        before = copy.deepcopy(ledger)

        merged = TOOL.apply_review_overrides(ledger, overrides)

        self.assertEqual(ledger, before)
        self.assertEqual(merged["decisions"][0]["action"], "retain")
        self.assertIn("Coordinate identity review accepted.", merged["decisions"][0]["reason"])
        self.assertEqual(
            merged["decisions"][0]["coordinateCorrectionRef"],
            "reports/places/coordinate-corrections.json#1",
        )

    def test_review_overrides_reject_unknown_and_duplicate_ids(self):
        row = record()
        ledger = review_ledger([row], ["hold"])
        ledger["source"] = {"name": "cities500", "sha256": "fixture-source"}
        unknown = {
            "version": 1,
            "sourceSha256": "fixture-source",
            "overrides": [{"geonameId": 2, "action": "retain"}],
        }
        with self.assertRaisesRegex(ValueError, "unknown review ID 2"):
            TOOL.apply_review_overrides(ledger, unknown)

        duplicate = {
            "version": 1,
            "sourceSha256": "fixture-source",
            "overrides": [
                {"geonameId": 1, "action": "retain"},
                {"geonameId": 1, "action": "retain"},
            ],
        }
        with self.assertRaisesRegex(ValueError, "duplicate override ID 1"):
            TOOL.apply_review_overrides(ledger, duplicate)

    def test_refinement_excludes_holds_without_promoting_or_changing_source(self):
        raw = [record(identifier=index + 1, code=code, name="Same name")
               for index, code in enumerate(["PPL", "PPLA2", "PPL", "PPLA3"])]
        baseline = [value for row in raw if (value := TOOL.candidate(row)) is not None]
        sources = {row["geonameId"]: row for row in raw}
        ledger = review_ledger(raw, ["retain", "exclude", "hold", "inclusion-review"])
        before = copy.deepcopy((baseline, sources, ledger))
        refined, reviewed = TOOL.refine_candidates(baseline, sources, ledger)
        self.assertEqual([row["geonameId"] for row in refined], [1])
        self.assertEqual([item["inBaseline"] for item in reviewed], [True, True, True, False])
        self.assertEqual((baseline, sources, ledger), before)
        TOOL.validate_candidates(refined)

    def test_different_ids_and_unreviewed_keyword_rows_are_not_merged_or_removed(self):
        raw = [record(identifier=index + 1, name="College Station District", longitude=longitude)
               for index, longitude in enumerate(["127", "127", "127.001"])]
        baseline = [TOOL.candidate(row) for row in raw]
        ledger = review_ledger(raw[:1], ["retain"])
        refined, _ = TOOL.refine_candidates(baseline, {row["geonameId"]: row for row in raw}, ledger)
        self.assertEqual(refined, baseline)

    def test_same_name_other_location_or_type_requires_re_review(self):
        row = record(name="Ōta", country="JP", code="PPLA2")
        for key, value in [("countryCode", "KR"), ("featureCode", "PPL"), ("latitude", 35.56126),
                           ("longitude", 139.71605), ("name", "Ota")]:
            ledger = review_ledger([row], ["exclude"])
            ledger["decisions"][0]["expected"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "identity changed"):
                TOOL.refine_candidates([TOOL.candidate(row)], {1: row}, ledger)

    def test_unsupported_promotions_and_actions_are_rejected(self):
        row = record(code="PPLA3")
        ledger = review_ledger([row], ["retain"])
        with self.assertRaisesRegex(ValueError, "cannot promote"):
            TOOL.refine_candidates([], {1: row}, ledger)
        row = record()
        ledger = review_ledger([row], ["inclusion-review"])
        with self.assertRaisesRegex(ValueError, "requires an excluded"):
            TOOL.refine_candidates([TOOL.candidate(row)], {1: row}, ledger)
        ledger["decisions"][0]["action"] = "rename"
        with self.assertRaisesRegex(ValueError, "unknown action"):
            TOOL.refine_candidates([TOOL.candidate(row)], {1: row}, ledger)

    def test_duplicate_missing_and_unsourced_reviews_fail(self):
        row = record()
        baseline, sources = [TOOL.candidate(row)], {1: row}
        ledger = review_ledger([row, row], ["retain", "retain"])
        with self.assertRaisesRegex(ValueError, "duplicate review ID"):
            TOOL.refine_candidates(baseline, sources, ledger)
        ledger = review_ledger([row], ["retain"])
        with self.assertRaisesRegex(ValueError, "missing source record"):
            TOOL.refine_candidates(baseline, {}, ledger)
        ledger["decisions"][0]["evidence"] = ["not-reviewed"]
        with self.assertRaisesRegex(ValueError, "unknown evidence"):
            TOOL.refine_candidates(baseline, sources, ledger)
        ledger["decisions"][0]["evidence"] = ["official"]
        del ledger["evidenceSources"]["official"]["finding"]
        with self.assertRaisesRegex(ValueError, "missing source provenance"):
            TOOL.refine_candidates(baseline, sources, ledger)

    def test_excluded_hold_never_enters_pool_and_baseline_drift_fails(self):
        row = record(code="PPLA3")
        ledger = review_ledger([row], ["hold"])
        refined, reviewed = TOOL.refine_candidates([], {1: row}, ledger)
        self.assertEqual(refined, [])
        self.assertFalse(reviewed[0]["inBaseline"])
        row = record()
        ledger = review_ledger([row], ["hold"])
        with self.assertRaisesRegex(ValueError, "baseline/source mismatch"):
            TOOL.refine_candidates([], {1: row}, ledger)

    def test_offline_review_is_deterministic_preserves_baseline_and_checks_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            lines = [source_line(identifier=1, name="City"), source_line(identifier=2, name="Ward", code="PPLA2"),
                     source_line(identifier=3, name="Missing city", code="PPLA3")]
            snapshot(cache, "cities500", lines)
            raw = [TOOL.parse_row(line)[0] for line in lines]
            ledger = review_ledger(raw, ["retain", "exclude", "inclusion-review"])
            metadata = json.loads((cache / "cities500.source.json").read_text(encoding="utf-8"))
            ledger["source"] = {"name": "cities500", "sha256": metadata["sha256"]}
            TOOL.write_json(cache / "reviews.json", ledger)
            report = cache / "review.md"
            report.write_text("Manual notes\n" + TOOL.GENERATED_START + "\n" + TOOL.GENERATED_END, encoding="utf-8")
            # A review re-reads the source and never rewrites the original candidate artifact.
            original = cache / "candidates.ndjson"
            original.write_text("Preserve original candidates\n", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                stats = TOOL.review(cache, cache / "reviews.json", cache / "review-summary.json", report)
            self.assertEqual((stats["baselineCount"], stats["refinedCount"], stats["baselineExcludes"]), (2, 1, 1))
            self.assertEqual(stats["unreviewedCount"], 0)
            self.assertEqual(original.read_text(encoding="utf-8"), "Preserve original candidates\n")
            outputs = [cache / "refined-candidates.ndjson", cache / "review-summary.json", report]
            first = [path.read_bytes() for path in outputs]
            with mock.patch.object(TOOL.urllib.request, "urlopen", side_effect=AssertionError("Network forbidden")):
                with contextlib.redirect_stdout(io.StringIO()):
                    TOOL.review(cache, cache / "reviews.json", cache / "review-summary.json", report)
            self.assertEqual(first, [path.read_bytes() for path in outputs])
            self.assertIn("Manual notes", report.read_text(encoding="utf-8"))
            ledger["source"]["sha256"] = "new-snapshot"
            TOOL.write_json(cache / "reviews.json", ledger)
            with self.assertRaisesRegex(ValueError, "snapshot changed"):
                TOOL.review(cache, cache / "reviews.json", cache / "review-summary.json", report)
            self.assertEqual(first, [path.read_bytes() for path in outputs])


if __name__ == "__main__":
    unittest.main()
