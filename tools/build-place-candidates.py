"""Offline GeoNames settlement candidates and audits; never imports app runtime code.

fetch: official cities500 first, allCountries as a fallback / coverage audit.
build: reproduce candidates and statistics from hash-verified local ZIP snapshots.
Only the standard library is required. Large sources / candidates stay in .cache.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "reports" / "places" / ".cache"
BASE_URL = "https://download.geonames.org/export/dump/"
LICENSE = "CC BY 4.0"
POLICY = {
    "adminReasons": {"PPLC": "capital", "PPLG": "capital",
                     "PPLA": "admin-seat-1", "PPLA2": "admin-seat-2"},
    "populationMinimum": 50_000, "autoReviewMinimum": 100_000,
    "millionMinimum": 1_000_000,
}
DETAIL_COUNTRIES = ("KR", "JP", "CN", "IN", "US", "BR")
AUDIT_NEAR_METERS = 1000  # Duplicate suspicion only; not regional centrality or deduplication.
AUDIT_SMALL_POPULATION = 1000
NAME_SIGNALS = re.compile(r"\b(neighbou?rhood|borough|suburb|district|ward|arrondissement|"
                          r"quarter|campus|airport|station|hospital|university|industrial zone)\b", re.I)
KR_MICRO_SIGNALS = re.compile(r"(?:[-\s](?:gu|eup|myeon|dong|ri)|[구읍면동리])$", re.I)
GENERATED_START = "<!-- geonames-statistics:start -->"
GENERATED_END = "<!-- geonames-statistics:end -->"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch_source(name, cache):
    """A failed transfer never replaces a previously verified snapshot."""
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{name}.zip"
    metadata_path = cache / f"{name}.source.json"
    if target.exists() and metadata_path.exists():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if file_hash(target) == metadata["sha256"]:
            print(f"{name}: using verified cache {metadata['sha256']}", flush=True)
            return {"source": name, "status": "cached", "failures": []}
        raise ValueError(f"{target}: cached hash mismatch; refusing to reuse it")
    url = BASE_URL + f"{name}.zip"
    failures = []
    partial = cache / f"{name}.zip.part"
    for attempt in range(1, 3):
        try:
            range_download = name == "allCountries" and attempt == 1
            if range_download:
                # Reuse the repository's canonical verified-Range downloader.
                with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
                    expected = int(response.headers["Content-Length"])
                    last_modified = response.headers.get("Last-Modified")
                    etag = response.headers.get("ETag")
                    resolved_url = response.url
                # The downloader preallocates its target. Never resume a failed
                # preallocated file on length alone: use a fresh temporary target.
                with tempfile.NamedTemporaryFile(dir=cache, suffix=".zip.part", delete=False) as fresh:
                    partial = Path(fresh.name)
                subprocess.run([sys.executable, str(ROOT / "tools" / "download-terrain-source.py"),
                                "--url", url, "--output", str(partial), "--workers", "6", "--chunk-mib", "8"],
                               check=True, timeout=900)
                with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as response:
                    if (response.headers.get("ETag"), response.headers.get("Last-Modified")) != (etag, last_modified):
                        raise IOError("source changed during ranged download")
                total = partial.stat().st_size
            else:
                request = urllib.request.Request(url, headers={"User-Agent": "PandoLab-place-data-audit/1"})
                with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
                    total = 0
                    expected = int(response.headers.get("Content-Length", "0"))
                    last_modified = response.headers.get("Last-Modified")
                    while block := response.read(1024 * 1024):
                        output.write(block)
                        total += len(block)
                        if total % (16 * 1024 * 1024) == 0:
                            print(f"{name}: {total:,} / {expected:,} bytes", flush=True)
                    resolved_url = response.url
            if expected and total != expected:
                raise IOError(f"short transfer {total} != {expected}")
            with zipfile.ZipFile(partial) as archive:
                info = archive.getinfo(f"{name}.txt")
                member_snapshot = datetime(*info.date_time).isoformat()
                if archive.testzip() is not None:
                    raise ValueError("ZIP CRC verification failed")
            partial.replace(target)
            metadata = {"url": url, "resolvedUrl": resolved_url,
                        "downloadedAt": datetime.now(timezone.utc).isoformat(),
                        "lastModified": last_modified, "zipMemberTimestamp": member_snapshot,
                        "geonamesDerived": True, "license": LICENSE,
                        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                        "bytes": total, "sha256": file_hash(target), "member": f"{name}.txt",
                        "downloadMethod": "verified-http-ranges" if range_download else "http-stream"}
            write_json(metadata_path, metadata)
            print(f"{name}: completed {total:,} bytes", flush=True)
            return {"source": name, "status": "downloaded", "failures": failures}
        except (OSError, ValueError, zipfile.BadZipFile, KeyError, subprocess.SubprocessError) as error:
            failures.append({"stage": "official-download", "attempt": attempt,
                             "url": url, "error": f"{type(error).__name__}: {error}"})
            print(f"{name}: attempt {attempt} failed: {error}", file=sys.stderr, flush=True)
    return {"source": name, "status": "failed", "failures": failures}


def fetch(cache):
    # Try the preferred primary before starting its fallback / audit supplement.
    primary = fetch_source("cities500", cache)
    write_json(cache / "fetch-attempts.json", [primary])
    supplement = fetch_source("allCountries", cache)
    attempts = [primary, supplement]
    write_json(cache / "fetch-attempts.json", attempts)
    if all(item["status"] == "failed" for item in attempts):
        raise RuntimeError("Both official sources failed; see fetch-attempts.json before selecting a verified mirror")


def parse_row(line, context="row"):
    fields = line.rstrip("\r\n").split("\t")
    if len(fields) != 19:
        raise ValueError(f"{context}: expected 19 columns, got {len(fields)}")
    try:
        record = {
            "geonameId": int(fields[0]), "name": fields[1], "asciiName": fields[2],
            "countryCode": fields[8], "admin1Code": fields[10], "admin2Code": fields[11],
            "latitude": float(fields[4]), "longitude": float(fields[5]),
            "featureClass": fields[6], "featureCode": fields[7],
            "population": int(fields[14]) if fields[14] else 0,
            "timezone": fields[17], "modificationDate": fields[18],
        }
    except ValueError as error:
        raise ValueError(f"{context}: invalid numeric field: {error}") from error
    validate_record(record, context)
    return record, not bool(fields[14])


def validate_record(row, context="row"):
    if row["geonameId"] <= 0 or not row["name"]:
        raise ValueError(f"{context}: invalid ID/name")
    if not math.isfinite(row["latitude"]) or not -90 <= row["latitude"] <= 90:
        raise ValueError(f"{context}: invalid latitude")
    if not math.isfinite(row["longitude"]) or not -180 <= row["longitude"] <= 180:
        raise ValueError(f"{context}: invalid longitude")
    if row["population"] < 0:
        raise ValueError(f"{context}: negative population")


def candidate(row):
    """The ONLY inclusion predicate; audits / counts call this same function."""
    if row["featureClass"] != "P":
        return None
    reason = POLICY["adminReasons"].get(row["featureCode"])
    if reason is None:
        if row["featureCode"] != "PPL" or row["population"] < POLICY["populationMinimum"]:
            return None
        reason = "population-50k"
    population = row["population"]
    bucket = ("1m-plus" if population >= POLICY["millionMinimum"] else
              "100k-999k" if population >= POLICY["autoReviewMinimum"] else
              "50k-99k" if population >= POLICY["populationMinimum"] else "under-50k-admin")
    return {**row, "inclusionReason": reason, "populationBucket": bucket,
            "preliminaryDisplayMode": "auto-review" if population >= POLICY["autoReviewMinimum"] else "search-only"}


def source_rows(name, cache):
    path = cache / f"{name}.zip"
    metadata = json.loads((cache / f"{name}.source.json").read_text(encoding="utf-8"))
    if file_hash(path) != metadata["sha256"]:
        raise ValueError(f"{path}: snapshot checksum mismatch")
    with zipfile.ZipFile(path) as archive, archive.open(metadata["member"]) as binary:
        for number, line in enumerate(io.TextIOWrapper(binary, encoding="utf-8"), 1):
            yield number, line


def summarize(rows):
    codes = Counter(row["featureCode"] for row in rows)
    buckets = Counter(row["populationBucket"] for row in rows)
    return {"totalKept": len(rows),
            "population50kPlus": sum(row["population"] >= POLICY["populationMinimum"] for row in rows),
            "population100kPlus": sum(row["population"] >= POLICY["autoReviewMinimum"] for row in rows),
            "population1mPlus": buckets["1m-plus"], "under50kAdminSeats": buckets["under-50k-admin"],
            "under1000AdminSeats": sum(row["population"] < AUDIT_SMALL_POPULATION and row["inclusionReason"] != "population-50k" for row in rows),
            "featureCodes": dict(sorted(codes.items())), "populationBuckets": dict(sorted(buckets.items())),
            "displayModes": dict(sorted(Counter(row["preliminaryDisplayMode"] for row in rows).items()))}


def largest(rows, count):
    return sorted(rows, key=lambda row: (-row["population"], row["geonameId"]))[:count]


def keep_sample(samples, row, limit=30):
    samples.append(row)
    samples[:] = largest(samples, limit)


def scan_primary(name, cache):
    kept, seen = [], set()
    raw_rows, p_rows, missing_population = 0, 0, 0
    classes, codes, excluded, raw_countries = Counter(), Counter(), Counter(), Counter()
    excluded_samples = defaultdict(list)
    korean_alias_signals = []
    for number, line in source_rows(name, cache):
        raw_rows += 1
        row, missing = parse_row(line, f"{name}:{number}")
        classes[row["featureClass"]] += 1
        raw_countries[row["countryCode"]] += 1
        if row["featureClass"] == "P":
            p_rows += 1
            codes[row["featureCode"]] += 1
            missing_population += missing
        value = candidate(row)
        if value is not None:
            if row["geonameId"] in seen:
                raise ValueError(f"{name}:{number}: duplicate geonameId {row['geonameId']}")
            seen.add(row["geonameId"])
            kept.append(value)
            if row["countryCode"] == "KR":
                aliases = [name for name in line.rstrip("\r\n").split("\t")[3].split(",") if KR_MICRO_SIGNALS.search(name)]
                if aliases:
                    korean_alias_signals.append({"geonameId": row["geonameId"], "name": row["name"],
                                                 "featureCode": row["featureCode"], "population": row["population"],
                                                 "matchedAliases": aliases[:4]})
        elif row["featureClass"] == "P":
            excluded[row["featureCode"]] += 1
            if row["featureCode"] == "PPLA3" and row["population"] >= POLICY["populationMinimum"]:
                keep_sample(excluded_samples[row["countryCode"]], row)
    return kept, {"rawRows": raw_rows, "featureClassPRows": p_rows,
                  "sourceFeatureClasses": dict(sorted(classes.items())), "sourcePCodes": dict(sorted(codes.items())),
                  "excludedPCodes": dict(sorted(excluded.items())), "missingPopulationPRows": missing_population,
                  "sourceCountryRows": dict(sorted(raw_countries.items())),
                  "largeExcludedPPLA3Samples": dict(sorted(excluded_samples.items())),
                  "koreanMicroAliasSignals": korean_alias_signals}


def distance_meters(a, b):
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat = lat2 - lat1
    dlon = math.radians(b["longitude"] - a["longitude"])
    sine = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(min(1, max(0, sine))))


def audit_kept(rows):
    positions, names = defaultdict(list), defaultdict(list)
    signals, korean_micro = [], []
    for row in rows:
        positions[(row["countryCode"], row["latitude"], row["longitude"])].append(row)
        name = unicodedata.normalize("NFKC", row["asciiName"] or row["name"]).casefold().strip()
        names[(row["countryCode"], name)].append(row)
        if NAME_SIGNALS.search(row["name"] + " " + row["asciiName"]):
            signals.append(row)
        if row["countryCode"] == "KR" and KR_MICRO_SIGNALS.search(row["name"]):
            korean_micro.append(row)
    colocated = [largest(group, len(group)) for group in positions.values() if len(group) > 1]
    colocated.sort(key=lambda group: (-len(group), group[0]["geonameId"]))
    near_pairs = []
    for group in names.values():
        for index, a in enumerate(group):
            for b in group[index + 1:]:
                distance = distance_meters(a, b)
                if distance <= AUDIT_NEAR_METERS:
                    near_pairs.append({"ids": sorted([a["geonameId"], b["geonameId"]]),
                                       "name": a["name"], "countryCode": a["countryCode"],
                                       "distanceMeters": round(distance, 2)})
    near_pairs.sort(key=lambda pair: (pair["distanceMeters"], pair["ids"]))
    return {"nameSignalCount": len(signals), "nameSignalSamples": largest(signals, 40),
            "koreanMicroNameCount": len(korean_micro), "koreanMicroNameRows": largest(korean_micro, len(korean_micro)),
            "exactCoordinateClusterCount": len(colocated),
            "exactCoordinateCandidateCount": sum(len(group) for group in colocated),
            "largestExactCoordinateCluster": max((len(group) for group in colocated), default=0),
            "exactCoordinateSamples": colocated[:15], "nearSameNamePairCount": len(near_pairs),
            "nearSameNamePairSamples": near_pairs[:30], "missingCountryCodeCount": sum(not row["countryCode"] for row in rows),
            "missingCountryCodeSamples": [row for row in rows if not row["countryCode"]][:10],
            "zeroPopulationKeptCount": sum(row["population"] == 0 for row in rows)}


def scan_supplement(cache, primary_rows):
    """Stream ALL classes; keep only counters, bounded review samples, and eligible IDs.

    No supplement row changes the primary candidates. Missing eligible IDs are
    reported, not silently installed or merged by name / coordinates.
    """
    primary = {row["geonameId"]: row for row in primary_rows}
    eligible_ids = set()
    counts, excluded, zero_excluded, missing = Counter(), Counter(), Counter(), Counter()
    country_rows, country_excluded = Counter(), defaultdict(Counter)
    large_ppla3, zero_samples = defaultdict(list), defaultdict(list)
    large_ppla3_counts = Counter()
    high_latitude, new_candidates, changed = [], [], []
    raw_rows = p_rows = 0
    for number, line in source_rows("allCountries", cache):
        raw_rows += 1
        if number % 2_000_000 == 0:
            print(f"allCountries: scanned {number:,} rows", flush=True)
        fields = line.rstrip("\r\n").split("\t")
        if len(fields) != 19:
            raise ValueError(f"allCountries:{number}: expected 19 fields")
        country_rows[fields[8]] += 1
        if fields[6] != "P":
            continue
        p_rows += 1
        row, absent_population = parse_row(line, f"allCountries:{number}")
        counts[row["featureCode"]] += 1
        missing[row["featureCode"]] += absent_population
        value = candidate(row)
        if value is not None:
            if row["geonameId"] in eligible_ids:
                raise ValueError(f"allCountries:{number}: duplicate eligible ID {row['geonameId']}")
            eligible_ids.add(row["geonameId"])
            if row["geonameId"] not in primary:
                new_candidates.append(value)
            elif value != primary[row["geonameId"]]:
                changed.append(row["geonameId"])
            continue
        code, country = row["featureCode"], row["countryCode"]
        excluded[code] += 1
        country_excluded[country][code] += 1
        if row["population"] == 0:
            zero_excluded[code] += 1
            if country in DETAIL_COUNTRIES and code in ("PPL", "PPLA3", "PPLA4", "PPLA5"):
                keep_sample(zero_samples[country], row, 12)
        if code == "PPLA3" and row["population"] >= POLICY["populationMinimum"]:
            large_ppla3_counts[country] += 1
            keep_sample(large_ppla3[country], row)
        if code == "PPL" and AUDIT_SMALL_POPULATION <= row["population"] < POLICY["populationMinimum"] and abs(row["latitude"]) >= 60:
            keep_sample(high_latitude, row, 40)
    return {"rawRows": raw_rows, "featureClassPRows": p_rows, "eligibleCount": len(eligible_ids),
            "sourcePCodes": dict(sorted(counts.items())), "excludedPCodes": dict(sorted(excluded.items())),
            "sourceCountryRows": dict(sorted(country_rows.items())),
            "excludedByCountry": {key: dict(sorted(value.items())) for key, value in sorted(country_excluded.items())},
            "populationMissingByCode": dict(sorted((key, value) for key, value in missing.items() if value)),
            "populationZeroExcludedByCode": dict(sorted(zero_excluded.items())),
            "populationZeroSamples": dict(sorted(zero_samples.items())),
            "largeExcludedPPLA3Samples": dict(sorted(large_ppla3.items())),
            "largeExcludedPPLA3Counts": dict(sorted(large_ppla3_counts.items())),
            "highLatitudeBelowThresholdSamples": high_latitude,
            "eligibleMissingFromPrimary": largest(new_candidates, len(new_candidates)),
            "primaryAbsentFromSupplement": sorted(set(primary) - eligible_ids), "changedPrimaryIds": sorted(changed)}


def validate_candidates(rows):
    seen = set()
    for row in rows:
        validate_record(row)
        if candidate(row) != row:
            raise ValueError(f"candidate {row['geonameId']}: violates canonical policy or derived fields")
        if row["geonameId"] in seen:
            raise ValueError(f"duplicate candidate ID {row['geonameId']}")
        seen.add(row["geonameId"])


def table(headers, rows):
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    return "\n".join(["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"] +
                     ["| " + " | ".join(cell(value) for value in row) + " |" for row in rows])


def render_statistics(stats):
    parts = ["## 재생성 가능한 실측 통계", "", "### 원본과 무결성", ""]
    for name, metadata in stats["sources"].items():
        parts += [f"- [{name}]({metadata['url']}): 다운로드 `{metadata['downloadedAt']}`; 서버 수정 `{metadata['lastModified']}`; "
                  f"ZIP 내부 시각 `{metadata['zipMemberTimestamp']}` (시간대 미표기); {metadata['bytes']:,} bytes.",
                  f"  SHA-256 `{metadata['sha256']}`. GeoNames 원본, {metadata['license']}."]
    primary, total = stats["primary"], stats["totals"]
    parts += ["", f"주 원본: `{stats['primarySource']}`. alternateNames는 후보 파일에서 생략했다.", "",
              table(["지표", "건수"], [("원본 전체", primary["rawRows"]), ("featureClass P", primary["featureClassPRows"]),
                                     ("최종 후보", total["totalKept"]), ("인구 ≥1M", total["population1mPlus"]),
                                     ("인구 ≥100k (1M 포함)", total["population100kPlus"]),
                                     ("인구 50k–99,999", total["populationBuckets"].get("50k-99k", 0)),
                                     ("저인구 행정중심", total["under50kAdminSeats"])]),
              "", "### 최종 feature code / 인구 구간 / 모드", "",
              table(["featureCode", "최종 건수"], total["featureCodes"].items()), "",
              table(["populationBucket", "건수"], total["populationBuckets"].items()), "",
              table(["preliminaryDisplayMode", "건수"], total["displayModes"].items()),
              "", "### 제외한 P 코드 (주 원본)", "", table(["code", "건수"], primary["excludedPCodes"].items()),
              "", "### 모든 원본 국가 코드별 후보 수", "",
              "국가 코드와 종속 영토 코드를 그대로 사용한다. 후보가 0인 코드도 대조 원본에 있으면 표시한다.", "",
              table(["countryCode", "최종 후보"], stats["countryCounts"].items()), "",
              "### 6개 국가 상세", "",
              table(["country", "totalKept", "50k+", "100k+", "under50kAdmin", "PPLC", "PPLG", "PPLA", "PPLA2"],
                    [(code, data["totalKept"], data["population50kPlus"], data["population100kPlus"], data["under50kAdminSeats"],
                      *[data["featureCodes"].get(key, 0) for key in POLICY["adminReasons"]]) for code, data in stats["countryDetails"].items()])]
    for code, data in stats["countryDetails"].items():
        parts += ["", f"#### {code}: 인구 상위 30", "",
                  table(["ID", "이름", "코드", "인구", "admin1 / admin2"],
                        [(row["geonameId"], row["name"], row["featureCode"], row["population"],
                          row["admin1Code"] + " / " + row["admin2Code"]) for row in data["top30"]]),
                  "", f"#### {code}: 저인구 행정중심 표본", "",
                  "가장 작은 6개 + 5만에 가장 가까운 6개(중복 ID 제외). 전수 판정이 아닌 검토 표본이다.", "",
                  table(["ID", "이름", "코드", "인구"], [(row["geonameId"], row["name"], row["featureCode"], row["population"])
                                                          for row in data["under50kAdminSamples"]])]
        parts += ["", f"인구 1천 미만 행정중심 {data['under1000AdminSeats']:,}개 (인구 0/미상 포함)."]
        if code == "KR":
            parts += ["", "#### KR: 전체 후보 sanity check", "",
                      table(["ID", "이름", "코드", "인구"], [(row["geonameId"], row["name"], row["featureCode"], row["population"])
                                                             for row in data["allRows"]])]
    audit = stats["audit"]
    parts += ["", "### 자동 과다수록 신호", "",
              table(["신호", "건수"], [("이름에 구역/시설 키워드", audit["nameSignalCount"]),
                                      ("한국 미세 지명 접미사", audit["koreanMicroNameCount"]),
                                      ("정확히 같은 좌표의 복수 후보 그룹", audit["exactCoordinateClusterCount"]),
                                      ("해당 그룹 내 후보", audit["exactCoordinateCandidateCount"]),
                                      ("최대 그룹 크기", audit["largestExactCoordinateCluster"]),
                                      ("같은 국가·정규화 이름, 1km 내 ID 쌍", audit["nearSameNamePairCount"]),
                                      ("countryCode 없음", audit["missingCountryCodeCount"]),
                                      ("유지한 인구 0 후보", audit["zeroPopulationKeptCount"])]),
              "", "이름 신호는 오탐을 포함하며 POI/구역 확정 판정이 아니다. 모든 다른 ID는 그대로 남겼다.", "",
              table(["ID", "국가", "이름", "코드", "인구"], [(row["geonameId"], row["countryCode"], row["name"], row["featureCode"], row["population"])
                                                                   for row in audit["nameSignalSamples"]]),
              "", "#### 한국 미세 지명 이름 신호 전체", "",
              table(["ID", "이름", "코드", "인구"], [(row["geonameId"], row["name"], row["featureCode"], row["population"])
                                                          for row in audit["koreanMicroNameRows"]]),
              "", "#### 한국 alternateNames 미세 지명 접미사 신호", "",
              "원본 별칭만 감사에 사용한다. 후보에는 alternateNames를 복제하지 않으며, 이 신호도 자동 제외에 사용하지 않는다.",
              "대구·영동·구리·안동·하동처럼 정상 도시 이름의 끝 글자나 오래된 별칭도 걸리므로 미세 지명 확정 건수가 아니다.", "",
              table(["ID", "이름", "코드", "인구", "별칭 신호"], [(row["geonameId"], row["name"], row["featureCode"], row["population"], ", ".join(row["matchedAliases"]))
                                                                         for row in primary["koreanMicroAliasSignals"]]),
              "", "#### 근접 동명 ID 쌍 (최대 30)", "",
              table(["국가", "이름", "IDs", "거리 m"], [(row["countryCode"], row["name"], row["ids"], row["distanceMeters"])
                                                               for row in audit["nearSameNamePairSamples"]])]
    supplement = stats.get("supplement")
    if supplement:
        parts += ["", "### allCountries 전체 원본 대조 (필터 변경 없음)", "",
                  f"전체 {supplement['rawRows']:,}행, P {supplement['featureClassPRows']:,}행, 같은 정책의 유효 후보 {supplement['eligibleCount']:,}개.", "",
                  f"cities500에 없는 유효 후보 {len(supplement['eligibleMissingFromPrimary']):,}개; 대조 원본에 없는 주 후보 "
                  f"{len(supplement['primaryAbsentFromSupplement']):,}개; 같은 ID의 내용 차이 {len(supplement['changedPrimaryIds']):,}개.", "",
                  table(["제외 코드", "전체 제외", "그중 인구 0"],
                        [(code, count, supplement["populationZeroExcludedByCode"].get(code, 0)) for code, count in supplement["excludedPCodes"].items()]),
                  "", f"빈 인구 필드(P): {sum(supplement['populationMissingByCode'].values()):,}행. 인구 0 전체와 구분한다.",
                  "", "#### 전 국가별 제외 PPLA3 5만+ 감사 대상 수", "",
                  table(["국가", "건수"], supplement["largeExcludedPPLA3Counts"].items()),
                  "", "#### 제외된 PPLA3 중 5만+ 표본", ""]
        for code in DETAIL_COUNTRIES:
            parts += [f"**{code}**", "", table(["ID", "이름", "인구"],
                      [(row["geonameId"], row["name"], row["population"]) for row in supplement["largeExcludedPPLA3Samples"].get(code, [])]), ""]
        parts += ["#### 인구 0으로 제외된 P 기록 표본 (6개 국가, 원본 ID 순 최대 12)", "",
                  "이 표본은 중요한 도시 확정 목록이 아니다. 특히 마을/리 레코드도 많아 인구 0만으로 전부 복원할 수 없다.", "",
                  table(["국가", "ID", "이름", "코드"], [(code, row["geonameId"], row["name"], row["featureCode"])
                                                       for code in DETAIL_COUNTRIES for row in supplement["populationZeroSamples"].get(code, [])])]
        parts += ["#### 고위도 일반 정착지: 1천 이상·5만 미만 제외 표본", "",
                  "절대 위도 ≥60°라는 검토 신호일 뿐, 유일한 중심지나 원격성의 증명이 아니다. 중심성 계산은 하지 않았다.", "",
                  table(["ID", "국가", "이름", "인구", "위도"], [(row["geonameId"], row["countryCode"], row["name"], row["population"], row["latitude"])
                                                                           for row in supplement["highLatitudeBelowThresholdSamples"]])]
    else:
        parts += ["", "allCountries 대조 미수행: fetch-attempts의 실패 원인을 확인한다."]
    parts += ["", "### 수집 실패 / 경고", "", json.dumps(stats["fetchAttempts"], ensure_ascii=False), ""]
    return "\n".join(parts)


def build(cache, stats_path, report_path):
    primary_name = "cities500" if (cache / "cities500.source.json").exists() else "allCountries"
    rows, primary = scan_primary(primary_name, cache)
    validate_candidates(rows)
    rows.sort(key=lambda row: row["geonameId"])
    sources = {primary_name: json.loads((cache / f"{primary_name}.source.json").read_text(encoding="utf-8"))}
    supplement = None
    if primary_name != "allCountries" and (cache / "allCountries.source.json").exists():
        supplement = scan_supplement(cache, rows)
        sources["allCountries"] = json.loads((cache / "allCountries.source.json").read_text(encoding="utf-8"))
    by_country = defaultdict(list)
    for row in rows:
        by_country[row["countryCode"]].append(row)
    country_counts = {code: len(by_country[code]) for code in sorted(set(primary["sourceCountryRows"]) |
                      (set(supplement["sourceCountryRows"]) if supplement else set()))}
    details = {}
    for code in DETAIL_COUNTRIES:
        country = by_country[code]
        low = sorted([row for row in country if row["population"] < POLICY["populationMinimum"]],
                     key=lambda row: (row["population"], row["geonameId"]))
        samples = {row["geonameId"]: row for row in low[:6] + low[-6:]}
        details[code] = {**summarize(country), "top30": largest(country, 30), "under50kAdminSamples": list(samples.values())}
        if code == "KR":
            details[code]["allRows"] = country
    attempts_path = cache / "fetch-attempts.json"
    stats = {"policy": POLICY, "primarySource": primary_name, "sources": sources, "primary": primary,
             "totals": summarize(rows), "countryCounts": country_counts, "countryDetails": details,
             "audit": audit_kept(rows), "supplement": supplement,
             "fetchAttempts": json.loads(attempts_path.read_text(encoding="utf-8")) if attempts_path.exists() else []}
    candidates_path = cache / "candidates.ndjson"
    with candidates_path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    stats["candidateArtifact"] = {"path": candidates_path.relative_to(cache).as_posix(),
                                  "rows": len(rows), "sha256": file_hash(candidates_path),
                                  "bytes": candidates_path.stat().st_size}
    write_json(stats_path, stats)
    content = report_path.read_text(encoding="utf-8")
    if content.count(GENERATED_START) != 1 or content.count(GENERATED_END) != 1:
        raise ValueError("Report requires exactly one generated statistics marker pair")
    before, rest = content.split(GENERATED_START)
    _, after = rest.split(GENERATED_END)
    report_path.write_text(before + GENERATED_START + "\n\n" + render_statistics(stats) + "\n" + GENERATED_END + after, encoding="utf-8")
    print(f"{primary_name}: {primary['rawRows']:,} -> {len(rows):,} candidates; {candidates_path}", flush=True)
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "build"))
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--stats", type=Path, default=ROOT / "reports" / "places" / "geonames-statistics.json")
    parser.add_argument("--report", type=Path, default=ROOT / "docs" / "place-data-audit.md")
    args = parser.parse_args()
    if args.command == "fetch":
        fetch(args.cache)
    else:
        build(args.cache, args.stats, args.report)


if __name__ == "__main__":
    main()
