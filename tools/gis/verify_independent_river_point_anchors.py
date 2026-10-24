#!/usr/bin/env python3
"""Read-only spatial crosscheck of independently published river place points.

This is a *screen* for likely OSM bbox-induced name confusion, not river
polyline identity proof. Existing Hydro geometry, names and runtime data
must not be changed from the output of this script.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ANCHORS = {
    "finnish_nls_oulujoki": {
        "name": "Oulujoki", "lon": 25.56374, "lat": 64.99977,
        "kind": "Finland National Land Survey geographical names register",
        "source": "https://finto.fi/yso-paikat/fi/page/p204727",
    },
    "finnish_nls_siikajoki": {
        "name": "Siikajoki", "lon": 24.74333, "lat": 64.83728,
        "kind": "Finland National Land Survey geographical names register",
        "source": "https://finto.fi/yso-paikat/en/page/p139542",
    },
    "kazakh_emba_atlas_location": {
        "name": "Zhem/Emba", "lon": 56 + 23 / 60 + 59 / 3600,
        "lat": 47 + 52 / 60 + 26 / 3600,
        "kind": "Secondary transcription of Kazakhstan encyclopedias (1990/1983); not an official GIS line",
        "source": "https://silkadv.com/ru/node/4653",
    },
    "kazakh_ural_atlas_location": {
        "name": "Zhaiyk/Ural", "lon": 51 + 35 / 60 + 18 / 3600,
        "lat": 49 + 34 / 60 + 38 / 3600,
        "kind": "Secondary transcription of river monograph (1987); not an official GIS line",
        "source": "https://silkadv.com/en/content/ural-river-kazakhstan",
    },
}
CANDIDATE_IDS = {
    "20071308": ["finnish_nls_oulujoki", "finnish_nls_siikajoki"],
    "20075401": ["finnish_nls_oulujoki", "finnish_nls_siikajoki"],
    "20456598": ["kazakh_emba_atlas_location", "kazakh_ural_atlas_location"],
}


def line_parts(geometry):
    if geometry["type"] == "LineString":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiLineString":
        return geometry["coordinates"]
    raise ValueError("Unrecognized line geometry type: " + geometry["type"])


def compare(decoded):
    from pyproj import Transformer
    from shapely.geometry import LineString, Point
    from shapely.ops import transform, unary_union

    manifest = decoded.get("manifest", {})
    if str(manifest.get("version")) != "0.13.2":
        raise ValueError("Expected pinned HydroRIVERS v0.13.2")
    systems = {}
    for fid in decoded["features"]:
        meta = fid["metadata"]
        sid = str(meta.get("systemId") or "")
        if sid not in CANDIDATE_IDS or meta.get("role") != "mainstem":
            continue
        systems.setdefault(sid, []).append(fid["geometry"])
    if set(systems) != set(CANDIDATE_IDS):
        raise ValueError("Missing mainstem system: " + str(set(CANDIDATE_IDS) - set(systems)))

    rows = []
    for sid, features in sorted(systems.items()):
        crs = "EPSG:32635" if sid.startswith("200") else "EPSG:32640"
        # 35N for Finland (E 24-29°), 40N for Emba (E 53-58°).
        project = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
        inverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
        lines = []
        for geom in features:
            for coords in line_parts(geom):
                if len(coords) >= 2:
                    lines.append(transform(project, LineString(coords)))
        if not lines:
            raise ValueError("No mainstem lines for " + sid)
        merged = unary_union(lines)
        points = {}
        for anchor_id in CANDIDATE_IDS[sid]:
            anchor = ANCHORS[anchor_id]
            pt = transform(project, Point(anchor["lon"], anchor["lat"]))
            nearest = merged.interpolate(merged.project(pt)) if merged.geom_type == "LineString" else None
            # For non-joined MultiLines find nearest coordinate on each constituent line.
            if nearest is None:
                nearest = min((line.interpolate(line.project(pt)) for line in lines),
                              key=lambda p: p.distance(pt))
            d = round(float(pt.distance(nearest)) / 1000, 3)
            qlon, qlat = inverse(nearest.x, nearest.y)
            points[anchor_id] = {
                "river": anchor["name"], "publishedPointLonLat": [anchor["lon"], anchor["lat"]],
                "closestHydroMainstemKm": d,
                "nearestHydroLonLat": [round(qlon, 5), round(qlat, 5)],
                "sourceType": anchor["kind"], "source": anchor["source"],
            }
        rows.append({
            "systemId": sid,
            "mainstemFeatureCount": len(features),
            "mainstemSegmentCount": len(lines),
            "mainstemTotalLengthKm": round(sum(line.length for line in lines) / 1000, 3),
            "pointChecks": points,
        })
    return {
        "schema": "pando-independent-hydronym-point-screen-v1",
        "referenceHydroVersion": "v0.13.2",
        "evidenceType": "independent-named-point-vs-published-mainstem-distance",
        "nameIdentityVerified": False,
        "geometryCopiedToRuntime": False,
        "caveat": "A named register point does not represent the entire river; full independent vector alignment and topology are needed before name changes.",
        "items": rows,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--decoded", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare(json.loads(args.decoded.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
