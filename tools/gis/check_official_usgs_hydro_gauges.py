#!/usr/bin/env python3
"""Check the Hydro source geometry against independently surveyed USGS stations.

Research-only spatial concordance. Does not prove legal boundaries, downstream
topology or a Korean exonym. Input stations are government USGS WGS84 values.
"""
import argparse
import json
import math
from pathlib import Path

STATIONS = (
    ("Brazos", "USGS-08116650", -95.58246348462062, 29.349686143162536,
     "https://waterdata.usgs.gov/monitoring-location/USGS-08116650"),
    ("Brazos", "USGS-08114000", -95.7577275325698, 29.5824589022502,
     "https://waterdata.usgs.gov/monitoring-location/USGS-08114000"),
    ("Brazos", "USGS-08117300", -95.3816077936518, 28.8980278072396,
     "https://waterdata.usgs.gov/monitoring-location/USGS-08117300/"),
    ("Colorado-Texas", "USGS-08162500", -96.0124587726231, 28.9741462100881,
     "https://waterdata.usgs.gov/monitoring-location/USGS-08162500/"),
    ("Colorado-Texas", "USGS-08162504", -95.9755182378249, 28.6872113055232,
     "https://waterdata.usgs.gov/monitoring-location/USGS-08162504/"),
    ("Colorado-Texas", "USGS-08162501", -95.9975, 28.7741666666667,
     "https://waterdata.usgs.gov/monitoring-location/USGS-08162501/"),
)
SYSTEMS = {"70816878": "Brazos", "70819626": "Colorado-Texas"}


def parts(geom):
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return geom["coordinates"]
    return []


def line_distance_km(lon, lat, segments):
    """Minimum equirectangular local tangent distance to a polyline (km)."""
    x_scale = 111.195 * math.cos(math.radians(lat))
    y_scale = 111.195
    best = float("inf")
    for segment in segments:
        if not segment:
            continue
        loc = [((float(x) - lon) * x_scale, (float(y) - lat) * y_scale)
               for x, y in segment]
        for (ax, ay), (bx, by) in zip(loc, loc[1:]):
            dx, dy = bx - ax, by - ay
            dist2 = dx * dx + dy * dy
            t = max(0.0, min(1.0, -(ax * dx + ay * dy) / dist2)) if dist2 else 0
            best = min(best, math.hypot(ax + dx * t, ay + dy * t))
        if len(loc) == 1:
            best = min(best, math.hypot(*loc[0]))
    return best


def compare(decoded):
    geometry = {}
    for ident in SYSTEMS:
        rows = [item for item in decoded["features"]
                if str(item["metadata"].get("systemId") or "") == ident
                and item["metadata"].get("role") == "mainstem"]
        if not rows:
            raise ValueError("Published mainstem missing: " + ident)
        geometry[ident] = [part for row in rows for part in parts(row["geometry"])]
    output = []
    for watercourse, code, lon, lat, url in STATIONS:
        distances = {
            ident: round(line_distance_km(lon, lat, geom), 3)
            for ident, geom in geometry.items()
        }
        output.append({
            "station": code, "independentHydrography": watercourse,
            "lon": lon, "lat": lat, "url": url,
            "distancesToHydroMainstemKm": distances,
        })
    results = {}
    for ident, targetName in SYSTEMS.items():
        right = [row["distancesToHydroMainstemKm"][ident]
                 for row in output if row["independentHydrography"] == targetName]
        wrong = [row["distancesToHydroMainstemKm"][ident]
                 for row in output if row["independentHydrography"] != targetName]
        results[ident] = {
            "candidateName": targetName,
            "matchedIndependentStations": sum(x <= 12 for x in right),
            "maxMatchingStationDistanceKm": max(right),
            "nearestDifferentBasinStationKm": min(wrong),
            "criteriaSatisfied": sum(x <= 12 for x in right) >= 2
                and min(wrong) >= 20,
        }
    return {"schema": "pando-hydro-usgs-official-stations-v1",
            "referenceNote": "USGS WGS84 station coordinates independently measured or map-derived; HydroRIVERS display centerline is generalized.",
            "stationRows": output, "candidateSystems": results}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--decoded", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    decoded = json.loads(args.decoded.read_text(encoding="utf-8"))
    result = compare(decoded)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("USGS_HYDRO_PROOF=" + json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
