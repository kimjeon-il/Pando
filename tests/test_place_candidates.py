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


if __name__ == "__main__":
    unittest.main()
