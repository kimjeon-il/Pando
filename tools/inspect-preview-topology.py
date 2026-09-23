"""Report topology defects so the preview builder can restore source vertices."""

from __future__ import annotations

import json
import re
import sys

from shapely.geometry import shape
from shapely.validation import explain_validity


def issue_point(message: str) -> list[float] | None:
    match = re.search(r"\[([-+0-9.eE]+) ([-+0-9.eE]+)\]", message)
    return [float(match.group(1)), float(match.group(2))] if match else None


def area_components(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [polygon for part in geometry.geoms for polygon in area_components(part)]
    return []


def main() -> None:
    collection = json.load(sys.stdin)
    features = collection["features"]
    entries = [(feature["id"], shape(feature["geometry"])) for feature in features]
    invalid = []
    for country_id, geometry in entries:
        if not geometry.is_valid or geometry.is_empty:
            reason = explain_validity(geometry)
            invalid.append({"ids": [country_id], "point": issue_point(reason), "reason": reason})
    if invalid:
        json.dump(invalid, sys.stdout)
        return

    overlaps = []
    entries.sort(key=lambda entry: entry[1].bounds[0])
    for index, (left_id, left) in enumerate(entries):
        left_bounds = left.bounds
        for right_id, right in entries[index + 1 :]:
            right_bounds = right.bounds
            if right_bounds[0] > left_bounds[2]:
                break
            if right_bounds[1] > left_bounds[3] or right_bounds[3] < left_bounds[1]:
                continue
            intersection = left.intersection(right)
            if intersection.area > 1e-14:
                for polygon in sorted(area_components(intersection), key=lambda part: -part.area)[:20]:
                    if polygon.area <= 1e-14:
                        continue
                    ring = list(polygon.exterior.coords)
                    stride = max(1, len(ring) // 8)
                    points = [list(ring[index]) for index in range(0, len(ring) - 1, stride)][:8]
                    overlaps.append({"ids": [left_id, right_id], "points": points, "reason": "overlap"})
    json.dump(overlaps, sys.stdout)


if __name__ == "__main__":
    main()
