#!/usr/bin/env python3
"""Independent Natural Earth name/path candidates for 73 published HydroRIVERS systems.

Read only. The result is *not* an automatic name promotion. A source name can
describe a tributary even when it intersects the compiled logical basin.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path


def ne_name(row: dict) -> tuple[str, str]:
    p = row.get("properties") or {}
    korean = str(p.get("name_ko") or p.get("NAME_KO") or "").strip()
    original = str(p.get("name_en") or p.get("name") or p.get("NAME") or "").strip()
    if not original:
        original = str(p.get("name_local") or p.get("name_alt") or "").strip()
    return korean, original


def pieces(geo: dict):
    if geo.get("type") == "LineString":
        return [geo.get("coordinates", [])]
    if geo.get("type") == "MultiLineString":
        return geo.get("coordinates", [])
    return []


def union_bbox(rows):
    if not rows:
        return []
    return [round(min(item["bounds"][0] for item in rows) / 1e6, 4),
            round(min(item["bounds"][1] for item in rows) / 1e6, 4),
            round(max(item["bounds"][2] for item in rows) / 1e6, 4),
            round(max(item["bounds"][3] for item in rows) / 1e6, 4)]


def candidates(decoded: dict, natural_earth: dict, inventory: dict) -> dict:
    # Run Shapely only in this optional offline validation job.
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree

    matched = {x["systemId"]: x for x in inventory["items"]}
    hydro = defaultdict(list)
    for f in decoded["features"]:
        row = f["metadata"]
        if str(row.get("systemId") or "") not in matched:
            continue
        if row.get("role") == "mainstem":
            hydro[str(row["systemId"])].append(f)

    ne_paths, ne_names = [], []
    for row in natural_earth.get("features", []):
        ko, original = ne_name(row)
        if not original and not ko:
            continue
        for chain in pieces(row.get("geometry") or {}):
            if len(chain) < 2:
                continue
            try:
                line = LineString(chain)
                if line.length <= 0:
                    continue
            except Exception:
                continue
            ne_paths.append(line)
            ne_names.append({"nameKo": ko, "name": original})
    if len(ne_paths) < 100:
        raise ValueError(f"Independent NE river dataset appears incomplete: {len(ne_paths)} named lines")
    tree = STRtree(ne_paths)

    output = []
    for system in inventory["items"]:
        ident = system["systemId"]
        rows = hydro.get(ident, [])
        if not rows:
            raise ValueError("Hydro metadata lacks mainstem geometry: " + ident)
        lines = []
        for feature in rows:
            for chain in pieces(feature["geometry"]):
                if len(chain) >= 2:
                    line = LineString(chain)
                    if line.length > 0:
                        lines.append(line)
        if not lines:
            raise ValueError("Hydro logical mainstem is empty: " + ident)
        lengths = [line.length for line in lines]
        total = sum(lengths)
        sample_count = 81
        visits = Counter()
        distances = defaultdict(list)
        for position in range(sample_count):
            target = total * (position + 0.5) / sample_count
            traversed = 0.0
            point = None
            for line, span in zip(lines, lengths):
                if target <= traversed + span:
                    point = line.interpolate(target - traversed)
                    break
                traversed += span
            if point is None:
                point = lines[-1].interpolate(lines[-1].length)
            options = tree.query(point.buffer(0.14))
            nearest_per_name = {}
            for ix in options:
                ix = int(ix)
                dist = point.distance(ne_paths[ix])
                if dist > 0.14:
                    continue
                name = ne_names[ix]["name"] or ne_names[ix]["nameKo"]
                key = name.casefold()
                if key not in nearest_per_name or dist < nearest_per_name[key][0]:
                    nearest_per_name[key] = (dist, ne_names[ix])
            # A point may align with the same named river in several adjacent
            # NE segments. Count each name at most once per sampled location.
            for key, (distance, _) in nearest_per_name.items():
                visits[key] += 1
                distances[key].append(distance)
        label = {}
        for i, meta in enumerate(ne_names):
            key = (meta["name"] or meta["nameKo"]).casefold()
            if key in visits and key not in label:
                label[key] = meta
        top = sorted(visits.items(), key=lambda p: (-p[1], sum(distances[p[0]]) / max(len(distances[p[0]]), 1), p[0]))[:10]
        output.append({
            "systemId": ident, "currentNameKo": system["nameKo"],
            "mainstemBounds": union_bbox([f["metadata"] for f in rows]),
            "mainstemFragments": len(rows), "mainstemSampleCount": sample_count,
            "naturalEarthCandidates": [
                {"name": label[k]["name"], "nameKo": label[k]["nameKo"],
                 "supportingSamples": hits,
                 "sampleCoverage": round(hits / sample_count, 3),
                 "meanDistanceDegrees": round(sum(distances[k]) / len(distances[k]), 5)}
                for k, hits in top
            ],
        })
    return {"schema": "pando-osm-ne-crosscheck-v1",
            "status": "automated-candidates-not-independent-name-validation",
            "naturalEarthNamedParts": len(ne_paths),
            "items": output}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--decoded", type=Path, required=True)
    ap.add_argument("--natural-earth", type=Path, required=True)
    ap.add_argument("--expected-sha256", required=True)
    ap.add_argument("--inventory", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    original = args.natural_earth.read_bytes()
    actual = hashlib.sha256(original).hexdigest()
    if actual != args.expected_sha256:
        raise ValueError(f"Independent Natural Earth source hash mismatch: {actual}")
    result = candidates(
        json.loads(args.decoded.read_text(encoding="utf-8")),
        json.loads(original.decode("utf-8")),
        json.loads(args.inventory.read_text(encoding="utf-8")),
    )
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("OSM_NE_TOTAL=" + str(len(result["items"])), flush=True)
    print("OSM_NE_NAMED_PARTS=" + str(result["naturalEarthNamedParts"]), flush=True)
    for row in result["items"]:
        print("OSM_NE_ROW=" + json.dumps(row, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
