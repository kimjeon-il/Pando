"""Offline, evidence-gated staging pipeline for historical city-name batches.

This deliberately does not research historical names, assign historical ranks,
change city eligibility, or publish map runtime tiles.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PLACES = ROOT / "reports" / "places"
BATCH_PATTERN = "tier1-major-cities-batch*.json"
SCHEMA = "pando-places-tier1-review-v6"
STAGING_STATUS = "verified-source-staging-not-runtime"
REQUIRED_SLOTS = ("nameKo", "nameEn", "nameNative")
DEFAULT_SLOTS = {"nameKo": "defaultDisplayNameKo", "nameEn": "defaultDisplayNameEn",
                 "nameNative": "defaultDisplayNameNative", "nativeLanguage": "defaultNativeLanguage"}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_new_json(path, value):
    """Atomic create-only output; never replace reviewed source or older batches."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise ValueError(f"Refusing to overwrite existing file: {path}")
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    descriptor, temporary = tempfile.mkstemp(prefix=".place-batch-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        # Use exclusive creation so another process cannot overwrite a file meanwhile.
        os.link(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def registered(places=PLACES):
    """Fail closed on malformed batches or reused IDs, without rewriting legacy data."""
    records, files = {}, []
    for path in sorted(places.glob(BATCH_PATTERN)):
        data = read_json(path)
        if data.get("schema") != SCHEMA or not isinstance(data.get("records"), list):
            raise ValueError(f"{path}: unsupported schema or missing records")
        files.append(path)
        for record in data["records"]:
            identifier = record.get("geonameId") if isinstance(record, dict) else None
            if type(identifier) is not int or identifier <= 0:
                raise ValueError(f"{path}: invalid GeoNames ID {identifier}")
            if identifier in records:
                raise ValueError(f"Duplicate GeoNames ID {identifier}: {records[identifier][0]} and {path}")
            records[identifier] = (path, record)
    return files, records


def audit(places=PLACES):
    files, records = registered(places)
    timeline_count = sum(len(item.get("displayTimeline", [])) for _, item in records.values())
    missing_timeline_sources = sum(
        not period.get("sourceUrl")
        for _, item in records.values() for period in item.get("displayTimeline", []))
    return {"batchFiles": len(files), "cities": len(records), "nameTimelineEntries": timeline_count,
            "legacyTimelineEntriesWithoutSourceUrl": missing_timeline_sources,
            "scope": "staged historical name data, not runtime or historical city ranking"}


def valid_candidate(row, line):
    identifier = row.get("geonameId")
    if type(identifier) is not int or identifier <= 0:
        raise ValueError(f"Candidate line {line}: invalid GeoNames ID")
    if row.get("featureClass") != "P":
        raise ValueError(f"Candidate line {line}: not settlement feature class P")
    for key, lower, upper in (("latitude", -90, 90), ("longitude", -180, 180)):
        value = row.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or not lower <= value <= upper:
            raise ValueError(f"Candidate line {line}: invalid {key}")
    if type(row.get("population")) is not int or row["population"] < 0:
        raise ValueError(f"Candidate line {line}: invalid population")
    if not isinstance(row.get("name"), str) or not row["name"].strip():
        raise ValueError(f"Candidate line {line}: missing source name")
    if not isinstance(row.get("countryCode"), str) or len(row["countryCode"]) != 2:
        raise ValueError(f"Candidate line {line}: invalid source country code")


def plan(candidates, places=PLACES, *, batch, limit=25, countries=None, min_population=0,
         reviewed_summary=None):
    if not 1 <= limit <= 500 or batch < 1 or min_population < 0:
        raise ValueError("Invalid batch, limit or minimum population")
    files, known = registered(places)
    if any(re.search(r"batch0*" + str(batch) + r"(?:-|\.)", p.name) for p in files):
        raise ValueError(f"Batch {batch} already exists")
    if not candidates.is_file():
        raise ValueError(f"Candidate cache not found: {candidates}; run build-place-candidates.py review first")
    digest = hashlib.sha256(candidates.read_bytes()).hexdigest()
    if reviewed_summary is not None:
        expected = read_json(reviewed_summary).get("refinedArtifact", {}).get("sha256")
        if not expected or expected != digest:
            raise ValueError("Candidate cache SHA-256 differs from the reviewed source summary")
    chosen_countries = set(countries or [])
    rows, seen = [], set()
    with candidates.open(encoding="utf-8") as stream:
        for line, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            row = json.loads(raw)
            valid_candidate(row, line)
            identifier = row["geonameId"]
            if identifier in seen:
                raise ValueError(f"Duplicate candidate GeoNames ID {identifier} at line {line}")
            seen.add(identifier)
            if identifier in known or row["population"] < min_population:
                continue
            if chosen_countries and row["countryCode"] not in chosen_countries:
                continue
            rows.append(row)
    # Discovery order only: neither historical tier nor objective municipal population rank.
    rows.sort(key=lambda r: (r["featureCode"] != "PPLC", -r["population"], r["geonameId"]))
    selected = rows[:limit]
    return {
        "schema": "pando-places-research-queue-v1", "batch": batch,
        "status": "unreviewed-candidates-not-city-approval",
        "candidateFileSha256": digest,
        "sources": "GeoNames refined candidate cache; present-day metadata only",
        "filters": {"countries": sorted(chosen_countries), "minimumPopulation": min_population, "limit": limit},
        "counts": {"previouslyStaged": len(known), "eligibleUnstaged": len(rows), "selected": len(selected)},
        "candidates": [{
            "geonameId": row["geonameId"], "sourceName": row["name"],
            "sourceCountryCode": row["countryCode"], "featureCode": row["featureCode"],
            "populationSource": row["population"], "latitude": row["latitude"], "longitude": row["longitude"],
            "difficulty": "unclassified", "researchStatus": "needs-identity-and-historical-name-review",
            "sourceUrl": f"https://www.geonames.org/{row['geonameId']}/",
        } for row in selected],
        "notes": ["No city has been approved; GeoNames population and feature code do not set historical rank.",
                  "Do not infer historical sovereignty, official language, founding date or spelling from modern country code.",
                  "Assign A/B/C difficulty only after source-based historical review."]
    }


def require_text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing {field}")


def validate_reviewed(data, known):
    """Validate a NEW fully researched staging batch, not older heterogeneous snapshots."""
    if data.get("schema") != SCHEMA or data.get("status") != STAGING_STATUS:
        raise ValueError("Expected verified-source staging schema/status; unreviewed queues cannot be finalized")
    records = data.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("No researched city records")
    require_text(data.get("source"), "batch source provenance")
    require_text(data.get("checkedOn"), "checkedOn")
    date.fromisoformat(data["checkedOn"])
    local_ids = set()
    for item in records:
        identifier = item.get("geonameId")
        if type(identifier) is not int or identifier <= 0 or identifier in local_ids or identifier in known:
            raise ValueError(f"Duplicate or invalid GeoNames ID {identifier}")
        local_ids.add(identifier)
        context = f"City {identifier}"
        if item.get("featureClass") != "P":
            raise ValueError(f"{context}: featureClass must be P")
        for key, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
            value = item.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"{context}: invalid {key}")
        if not re.fullmatch(r"[A-Z]{2}", str(item.get("sourceCountryCode", ""))):
            raise ValueError(f"{context}: invalid sourceCountryCode")
        for field in (*DEFAULT_SLOTS.values(), "shortDescriptionKo", "sourceUrl"):
            require_text(item.get(field), f"{context}.{field}")
        if len(item["shortDescriptionKo"]) > 28:
            raise ValueError(f"{context}: shortDescriptionKo exceeds 28 code points")
        if not item["sourceUrl"].startswith("https://"):
            raise ValueError(f"{context}: invalid source URL")
        names = item.get("names")
        if not isinstance(names, list) or not names:
            raise ValueError(f"{context}: empty names[]")
        for name in names:
            require_text(name.get("text"), f"{context} names.text")
            require_text(name.get("language"), f"{context} names.language")
        choices = {(x["language"], x["text"]) for x in names}
        periods = item.get("displayTimeline")
        if not isinstance(periods, list) or not periods:
            raise ValueError(f"{context}: provide at least one sourced period (may be unchanged since 1801)")
        previous_boundary = None
        last = {}
        for index, period in enumerate(periods):
            has_year = "fromYear" in period
            has_date = "fromDate" in period
            if has_year == has_date:
                raise ValueError(f"{context} period {index}: choose fromDate XOR fromYear")
            if has_year:
                year = period["fromYear"]
                if type(year) is not int or not 1 <= year <= 9999:
                    raise ValueError(f"{context} period {index}: invalid fromYear")
            else:
                try:
                    day = date.fromisoformat(period["fromDate"])
                except (TypeError, ValueError) as error:
                    raise ValueError(f"{context} period {index}: invalid Gregorian date") from error
                if day.isoformat() != period["fromDate"]:
                    raise ValueError(f"{context} period {index}: date must be YYYY-MM-DD")
                year = day.year
            boundary = (year, period.get("fromDate"))
            if previous_boundary is not None:
                prev_year, prev_day = previous_boundary
                if year < prev_year or (year == prev_year and (
                    prev_day is None or boundary[1] is None or boundary[1] <= prev_day)):
                    raise ValueError(f"{context} period {index}: out of order or uncertain same-year transitions")
            previous_boundary = boundary
            for field in ("kind", "sourceUrl"):
                require_text(period.get(field), f"{context} period {index}.{field}")
            if not period["sourceUrl"].startswith("https://"):
                raise ValueError(f"{context} period {index}: sourceUrl must use HTTPS")
            changed = [k for k in REQUIRED_SLOTS if k in period]
            if not changed:
                raise ValueError(f"{context} period {index}: no changed name slots")
            for key in changed:
                require_text(period[key], f"{context} period {index}.{key}")
            if "nativeLanguage" in period:
                require_text(period["nativeLanguage"], f"{context} period {index}.nativeLanguage")
                if "nameNative" not in period:
                    raise ValueError(f"{context} period {index}: nativeLanguage without nameNative")
            if "nameNative" in period and "nativeLanguage" not in period and "nativeLanguage" not in last:
                raise ValueError(f"{context} period {index}: native language unresolved")
            if "nativeNames" in period:
                options = period["nativeNames"]
                if not isinstance(options, list) or not 1 <= len(options) <= 3:
                    raise ValueError(f"{context} period {index}: nativeNames must contain 1-3 entries")
                if "nameNative" not in period or options[0].get("text") != period["nameNative"] or options[0].get("language") != (period.get("nativeLanguage") or last.get("nativeLanguage")):
                    raise ValueError(f"{context} period {index}: nativeNames primary mismatch")
                if len({(n.get("language"), n.get("text")) for n in options}) != len(options):
                    raise ValueError(f"{context} period {index}: duplicated nativeNames")
            for key in changed:
                language = "ko" if key == "nameKo" else "en" if key == "nameEn" else period.get("nativeLanguage", last.get("nativeLanguage"))
                if (language, period[key]) not in choices:
                    raise ValueError(f"{context} period {index}: {key} not listed in names[]")
                last[key] = period[key]
            if "nativeLanguage" in period:
                last["nativeLanguage"] = period["nativeLanguage"]
            if index == 0 and any(key not in last for key in (*REQUIRED_SLOTS, "nativeLanguage")):
                raise ValueError(f"{context}: initial period requires ko/en/native and nativeLanguage")
        for slot, default in DEFAULT_SLOTS.items():
            if last.get(slot) != item[default]:
                raise ValueError(f"{context}: current {default} disagrees with last historical period")
    return {"validatedCities": len(local_ids), "validatedPeriods": sum(len(r["displayTimeline"]) for r in records)}


def finalize(source, dest, places=PLACES, *, check=False):
    if dest.exists():
        raise ValueError(f"Refusing to overwrite {dest}")
    if not re.fullmatch(r"tier1-major-cities-batch\d{2}[-a-z0-9]*\.json", dest.name):
        raise ValueError("Output must be a numbered tier1-major-cities-batchNN[-slug].json")
    existing, known = registered(places)
    batch_number = re.search(r"batch(\d{2})", dest.name).group(1)
    if any(re.search(r"batch" + batch_number + r"(?:-|\.)", path.name) for path in existing):
        raise ValueError(f"Batch {batch_number} already exists")
    data = read_json(source)
    if not re.match(r"^0*" + str(int(batch_number)) + r"(?:-|$)", str(data.get("batch", ""))):
        raise ValueError("Reviewed batch label and output batch number differ")
    result = validate_reviewed(data, known)
    if not check:
        write_new_json(dest, data)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--places", type=Path, default=PLACES, help="Directory containing existing batch files")
    actions = parser.add_subparsers(dest="command", required=True)
    actions.add_parser("audit", help="Report existing staged records and ID conflicts")
    queue = actions.add_parser("plan", help="Create unreviewed research queue from refined GeoNames candidates")
    queue.add_argument("--candidates", type=Path, default=PLACES / ".cache" / "refined-candidates.ndjson")
    queue.add_argument("--summary", type=Path, default=PLACES / "candidate-review-summary.json")
    queue.add_argument("--skip-source-hash-check", action="store_true", help="Only for explicit external fixtures")
    queue.add_argument("--batch", type=int, required=True)
    queue.add_argument("--limit", type=int, default=25)
    queue.add_argument("--countries", help="Comma-separated contemporary GeoNames country codes")
    queue.add_argument("--min-population", type=int, default=0)
    queue.add_argument("--output", type=Path, help="Create a new research queue JSON; omit for stdout")
    done = actions.add_parser("finalize", help="Validate fully researched JSON, then create NEW staging batch")
    done.add_argument("--input", type=Path, required=True)
    done.add_argument("--output", type=Path, required=True)
    done.add_argument("--check", action="store_true", help="Validation only, do not create a file")
    args = parser.parse_args(argv)
    try:
        if args.command == "audit":
            result = audit(args.places)
        elif args.command == "plan":
            countries = args.countries.split(",") if args.countries else None
            if countries and any(not re.fullmatch(r"[A-Z]{2}", code) for code in countries):
                raise ValueError("--countries must be comma-separated two-letter uppercase codes")
            summary = None if args.skip_source_hash_check else args.summary
            result = plan(args.candidates, args.places, batch=args.batch, limit=args.limit,
                          countries=countries, min_population=args.min_population,
                          reviewed_summary=summary)
            if args.output:
                write_new_json(args.output, result)
        else:
            result = finalize(args.input, args.output, args.places, check=args.check)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        parser.exit(1, f"place-batch: {error}\n")


if __name__ == "__main__":
    main()
