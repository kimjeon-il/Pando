#!/usr/bin/env python3
"""Independently cross-check Pando Hydro Yarra against Victoria's named river vector.

Read-only government API; downloaded coordinates are used ONLY for a spatial
source-identity comparison and NOT incorporated into the production map.
The state source is licensed CC BY 4.0; reference and credit are retained.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

OFFICIAL_LAYER = (
    "https://spatial.planning.vic.gov.au/server/rest/services/"
    "yarra_river_land/MapServer/0"
)
RIVER_ID = "50798885"


def _lines(geometry: dict) -> list:
    kind = geometry.get("type")
    if kind == "LineString":
        return [geometry.get("coordinates", [])]
    if kind == "MultiLineString":
        return geometry.get("coordinates", [])
    raise ValueError(f"Expected a line geometry; found {kind}")


def _sample_lines(lines, count):
    lengths = [line.length for line in lines]
    total = sum(lengths)
    if total <= 0:
        raise ValueError("Invalid total river length")
    samples = []
    for k in range(count):
        distance = total * (k + 0.5) / count
        pos = 0
        for line, length in zip(lines, lengths):
            if distance <= pos + length:
                samples.append(line.interpolate(distance - pos))
                break
            pos += length
        else:
            samples.append(lines[-1].interpolate(lines[-1].length))
    return samples


def compare(decoded: dict, reference: dict, reference_hash: str) -> dict:
    from shapely.geometry import LineString
    from shapely.ops import transform, unary_union
    from pyproj import Transformer

    hydro = [f for f in decoded.get("features", [])
             if str(f["metadata"].get("systemId") or "") == RIVER_ID
             and f["metadata"].get("role") == "mainstem"]
    if not hydro:
        raise ValueError("Current HydroYarra mainstem missing")

    crs = Transformer.from_crs("EPSG:4326", "EPSG:32755", always_xy=True)
    def project_all(rows):
        result = []
        for row in rows:
            for positions in _lines(row):
                if len(positions) < 2:
                    continue
                x = LineString(positions)
                if not x.is_valid or x.is_empty:
                    raise ValueError("Invalid river line")
                result.append(transform(crs.transform, x))
        return result

    hydro_lines = project_all([f["geometry"] for f in hydro])
    refrows = reference.get("features") or []
    if reference.get("type") != "FeatureCollection" or not refrows:
        raise ValueError("Government returned no GeoJSON features")
    named = []
    for f in refrows:
        name = str(f.get("properties", {}).get("NAME") or "")
        if name and "yarra" not in name.lower() and "birrarung" not in name.lower():
            raise ValueError(f"Unexpected government river name: {name}")
        named.append(f["geometry"])
    source_lines = project_all(named)
    if not source_lines:
        raise ValueError("Victoria published an empty Yarra river centerline")

    government_geometries = unary_union(source_lines)
    hydro_geometries = unary_union(hydro_lines)
    sample_count = 161
    hydro_to_gov = [pt.distance(government_geometries) / 1000
                    for pt in _sample_lines(hydro_lines, sample_count)]
    gov_to_hydro = [pt.distance(hydro_geometries) / 1000
                    for pt in _sample_lines(source_lines, sample_count)]
    def summary(d):
        sorted_vals = sorted(d)
        return {
            "samples": len(d),
            "within0_5km": round(sum(v <= 0.5 for v in d)/len(d), 4),
            "within1km": round(sum(v <= 1 for v in d)/len(d), 4),
            "within2km": round(sum(v <= 2 for v in d)/len(d), 4),
            "p90DistanceKm": round(sorted_vals[int(0.9*(len(d)-1))], 3),
            "maxDistanceKm": round(max(d), 3),
        }
    gov_bounds = [round(float(x), 1) for x in government_geometries.bounds]
    if gov_bounds[0] > 16200000 or gov_bounds[2] < 16000000:
        raise ValueError("Government source is not in Australia's UTM zone 55")
    return {
        "schema": "pando-government-vector-hydronym-v1",
        "systemId": RIVER_ID,
        "currentNameKo": hydro[0]["metadata"]["name"],
        "source": {
            "provider": "State Government of Victoria - Department of Transport and Planning",
            "referenceLayer": OFFICIAL_LAYER,
            "sourceGeoJSONSha256": reference_hash,
            "license": "CC BY 4.0",
            "licenseSource": "https://discover.data.vic.gov.au/en_AU/dataset/vicmap-hydro-watercourse-line",
            "independentHydrology": "https://www.melbournewater.com.au/water-and-environment/water-management/rivers-and-creeks/yarra-river",
        },
        "governmentFeatures": len(refrows),
        "governmentSegmentCount": len(source_lines),
        "hydroMainstemFeatures": len(hydro),
        "hydroMainstemSegmentCount": len(hydro_lines),
        "hydroMainstemTotalLengthKm": round(sum(x.length for x in hydro_lines)/1000, 3),
        "governmentRiverTotalLengthKm": round(sum(x.length for x in source_lines)/1000, 3),
        "hydroSamplesToNamedGovernmentRiver": summary(hydro_to_gov),
        "governmentSamplesToHydroMainstem": summary(gov_to_hydro),
        "assessment": "independent-geometry-screen-only",
        "publishedToRuntime": False,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decoded", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": "OBJECTID_1,NAME",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    })
    url = OFFICIAL_LAYER + "/query?" + params
    request = urllib.request.Request(url, headers={
        "User-Agent": "PandoLab-independent-geometry-research/1.0",
        "Accept": "application/geo+json,application/json",
    })
    with urllib.request.urlopen(request, timeout=90) as response:
        raw = response.read(24_000_001)
    if not raw or len(raw) > 24_000_000:
        raise ValueError("Empty or oversized government GeoJSON")
    js = json.loads(raw)
    if "error" in js:
        raise ValueError("Official ArcGIS service error: " + str(js["error"]))
    receipt = compare(json.loads(args.decoded.read_text(encoding="utf-8")),
                      js, hashlib.sha256(raw).hexdigest())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+"\n",
                           encoding="utf-8")
    print("YARRA_GOVERNMENT_VECTOR_PROOF="+json.dumps(receipt, ensure_ascii=False, separators=(",", ":")),flush=True)


if __name__ == "__main__":
    main()
