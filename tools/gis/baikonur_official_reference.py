#!/usr/bin/env python3
"""Build an OSM-free, INCOMPLETE Baikonur lease-boundary research reference.

The two Syr Darya right-bank reaches and the exclusions are intentionally absent.
Never promote this reference as an area polygon or legal boundary. Decimal
coordinates are a transcription of treaty DMS; the source datum is unverified.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

# Lease plot 1: the 31 treaty anchors, appearing in the Kazakhstan 2019
# ratification of the lease amendment (Appendix 2). Latitude precedes longitude.
# https://adilet.zan.kz/rus/docs/Z1900000282
# https://old.adilet.zan.kz/rus/docs/U950002195_
ANCHOR_DMS = (
    ("45 42 10", "63 01 05"),
    ("45 54 40", "63 01 05"),
    ("45 58 15", "62 44 40"),
    ("46 12 45", "62 45 30"),
    ("46 12 45", "63 19 45"),
    ("46 13 45", "63 21 00"),
    ("46 14 40", "63 19 30"),
    ("46 18 10", "63 22 10"),
    ("46 18 10", "63 29 00"),
    ("46 13 30", "63 53 00"),
    ("46 14 45", "63 53 00"),
    ("46 14 45", "63 54 30"),
    ("46 13 10", "63 54 30"),
    ("46 09 00", "64 17 30"),
    ("45 47 15", "64 19 00"),
    ("45 46 10", "63 44 10"),
    ("45 44 05", "63 43 45"),
    ("45 40 00", "63 25 00"),
    ("45 38 30", "63 26 15"),
    ("45 37 20", "63 24 40"),
    ("45 31 00", "63 24 40"),
    ("45 31 00", "63 18 45"),
    ("45 27 45", "63 18 45"),
    ("45 27 45", "63 22 00"),
    ("45 26 35", "63 22 00"),
    ("45 26 35", "63 14 30"),
    ("45 27 45", "63 14 30"),
    ("45 27 45", "63 18 30"),
    ("45 31 00", "63 18 30"),
    ("45 31 00", "63 09 10"),
    ("45 36 00", "63 13 10"),
)
RIGHT_BANK_REACHES = ((17, 18), (31, 1))


def decimal_degrees(dms: str) -> float:
    degree, minute, second = (int(part) for part in dms.split())
    if not 0 <= minute < 60 or not 0 <= second < 60:
        raise ValueError(f"Invalid DMS: {dms!r}")
    return round(degree + minute / 60 + second / 3600, 8)


def reference() -> dict:
    if len(ANCHOR_DMS) != 31:
        raise ValueError("Expected exactly 31 official treaty anchors")
    coordinates = [
        [decimal_degrees(lon), decimal_degrees(lat)]
        for lat, lon in ANCHOR_DMS
    ]
    features = []
    for number, point in enumerate(coordinates, 1):
        features.append({
            "type": "Feature", "id": f"baikonur-anchor-{number:02d}",
            "properties": {
                "kind": "official-anchor", "treatyPoint": number,
                "latDms": ANCHOR_DMS[number - 1][0],
                "lonDms": ANCHOR_DMS[number - 1][1],
            },
            "geometry": {"type": "Point", "coordinates": point},
        })
    straight_segments = 0
    for number in range(1, 32):
        following = number + 1 if number < 31 else 1
        if (number, following) in RIGHT_BANK_REACHES:
            continue  # Never interpolate right-bank reaches using a chord.
        features.append({
            "type": "Feature",
            "id": f"baikonur-straight-{number:02d}-{following:02d}",
            "properties": {
                "kind": "treaty-straight-segment",
                "fromPoint": number, "toPoint": following,
                "source": "Kazakhstan official treaty coordinates",
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [coordinates[number - 1], coordinates[following - 1]],
            },
        })
        straight_segments += 1
    if straight_segments != 29:
        raise AssertionError(f"Unexpected straight segment count: {straight_segments}")
    return {
        "type": "FeatureCollection",
        "name": "Baikonur lease plot 1 — official anchors and straight segments only",
        "properties": {
            "status": "research-only-INCOMPLETE-not-for-runtime-or-border-replacement",
            "originalTreatyDate": "1994-12-10",
            "revisionReview": "2019 Kazakhstan-ratified amendment; exclusions and plot revisions not digitized",
            "sourceUrls": [
                "https://adilet.zan.kz/rus/docs/Z1900000282",
                "https://old.adilet.zan.kz/rus/docs/U950002195_",
            ],
            "originalCoordinateDatum": "not explicitly verified",
            "transformation": "DMS transcription to decimal degrees only; no datum transform",
            "rightBankNotReconstructed": [
                {"fromPoint": start, "toPoint": end, "watercourse": "Syr Darya"}
                for start, end in RIGHT_BANK_REACHES
            ],
            "remaining": [
                "independently derive and validate both Syr Darya right-bank reaches",
                "reconstruct treaty plot exclusions and 2018/2019 revisions",
                "pairwise Kazakhstan-Baikonur topology and historic validity check",
            ],
            "openStreetMapDataUsed": False,
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(reference(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
