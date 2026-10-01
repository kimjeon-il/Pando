#!/usr/bin/env python3
"""Build a corrected July 1914 German Empire working-base geometry.

This is deliberately a local working-data build. The HGIS source and the
generated derivative are gitignored because the HGIS distribution metadata
limits use to non-commercial academic research unless separately licensed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
from typing import Any, Iterable

from pyproj import Geod
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.validation import explain_validity


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_RECIPE = ROOT / "tools" / "historical-library" / "german-empire-1914-base.recipe.json"
GEOD = Geod(ellps="WGS84")


def load_json(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalized_sha256(path: pathlib.Path) -> str:
    payload = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(payload).hexdigest().upper()


def polygon_parts(geometry) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        return [part for part in geometry.geoms if isinstance(part, Polygon) and not part.is_empty]
    return []


def normalize_polygonal(geometry) -> MultiPolygon:
    if geometry.is_empty:
        raise RuntimeError("geometry is empty")
    polygons = [orient(part, sign=1.0) for part in polygon_parts(geometry) if part.area > 0]
    if not polygons:
        raise RuntimeError(f"expected polygonal geometry, got {geometry.geom_type}")
    polygons.sort(
        key=lambda part: (
            -round(part.area, 15),
            round(part.bounds[0], 12),
            round(part.bounds[1], 12),
            round(part.bounds[2], 12),
            round(part.bounds[3], 12),
        )
    )
    result = MultiPolygon(polygons)
    if not result.is_valid:
        raise RuntimeError(f"invalid polygonal geometry: {explain_validity(result)}")
    return result


def corrected_xy(lon: float, lat: float, correction: dict[str, Any]) -> tuple[float, float]:
    """Apply the OSHistory axis-wise linear correction.

    The upstream repository ships separate west-east and south-north
    coefficients. Its transform-coords.py accidentally passes longitude
    coefficients to both axes; this port intentionally applies each coefficient
    set to the corresponding axis.
    """

    longitude = correction["longitude"]
    latitude = correction["latitude"]
    corrected_lon = lon + float(longitude["intercept"]) + lon * float(longitude["slope"])
    corrected_lat = lat + float(latitude["intercept"]) + lat * float(latitude["slope"])
    return corrected_lon, corrected_lat


def transform_coordinate_tree(value: Any, correction: dict[str, Any]) -> Any:
    if (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        lon, lat = corrected_xy(float(value[0]), float(value[1]), correction)
        return [lon, lat, *list(value[2:])]
    if isinstance(value, (list, tuple)):
        return [transform_coordinate_tree(item, correction) for item in value]
    return value


def corrected_feature_geometry(feature: dict[str, Any], correction: dict[str, Any]):
    geometry = feature.get("geometry")
    if not geometry:
        raise RuntimeError("HGIS feature has no geometry")
    if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise RuntimeError(f"HGIS state geometry must be polygonal, got {geometry.get('type')}")
    corrected = {
        "type": geometry["type"],
        "coordinates": transform_coordinate_tree(geometry["coordinates"], correction),
    }
    return shape(corrected)


def geometry_bounds(geometries: Iterable) -> tuple[float, float, float, float]:
    items = list(geometries)
    if not items:
        raise RuntimeError("no geometries available for bounds")
    merged = unary_union(items)
    return tuple(float(value) for value in merged.bounds)


def assert_bounds_close(
    actual: tuple[float, float, float, float],
    expected: list[float],
    tolerance: float,
) -> None:
    labels = ("west", "south", "east", "north")
    problems = []
    for label, observed, target in zip(labels, actual, expected):
        if abs(observed - float(target)) > tolerance:
            problems.append(f"{label}: observed={observed:.6f}, expected={float(target):.6f}")
    if problems:
        raise RuntimeError(
            "HGIS source bounds do not match the pinned 1914 catalog envelope "
            f"within {tolerance:g} degrees: " + "; ".join(problems)
        )


def load_hgis_states(recipe: dict[str, Any]):
    source = recipe["sources"]["hgisStates"]
    path = ROOT / source["path"]
    if not path.is_file():
        raise RuntimeError(
            f"missing local HGIS 1914 source: {path.relative_to(ROOT)}\n"
            "Run: python tools/fetch_german_empire_1914_source.py\n"
            "or place an EPSG:4326 copy there manually."
        )
    payload = load_json(path)
    if payload.get("type") != "FeatureCollection":
        raise RuntimeError("HGIS source is not a FeatureCollection")
    features = payload.get("features") or []
    expected_count = int(source["expectedFeatureCount"])
    if len(features) != expected_count:
        raise RuntimeError(f"HGIS source must contain {expected_count} state features, got {len(features)}")
    raw_geometries = []
    names = []
    for feature in features:
        geometry = feature.get("geometry")
        if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise RuntimeError("HGIS source contains a non-polygon state feature")
        raw_geometries.append(shape(geometry))
        state_name = str((feature.get("properties") or {}).get("STAAT_NAME", "")).strip()
        if state_name:
            names.append(state_name)
    if names and len(set(names)) != expected_count:
        raise RuntimeError(
            "HGIS STAAT_NAME values are missing or duplicated: "
            f"{len(set(names))} unique for {expected_count} states"
        )
    actual_bounds = geometry_bounds(raw_geometries)
    assert_bounds_close(
        actual_bounds,
        source["expectedBounds"],
        float(source.get("boundsToleranceDegrees", 0.35)),
    )
    return path, features, actual_bounds


def country_id(feature: dict[str, Any]) -> str:
    properties = feature.get("properties") or {}
    for value in (
        feature.get("id"),
        properties.get("editor_id"),
        properties.get("iso_a3"),
        properties.get("ADM0_A3"),
    ):
        if value:
            return str(value)
    return ""


def load_canonical_deu(recipe: dict[str, Any]):
    source = recipe["sources"]["canonicalCountries"]
    path = ROOT / source["path"]
    if not path.is_file():
        raise RuntimeError(f"missing canonical country source: {path.relative_to(ROOT)}")
    expected_sha = str(source.get("sha256") or "").upper()
    if expected_sha:
        actual_sha = normalized_sha256(path)
        if actual_sha != expected_sha:
            raise RuntimeError(
                "canonical country source SHA-256 mismatch: "
                f"expected {expected_sha}, got {actual_sha}"
            )
    payload = load_json(path)
    matches = [feature for feature in payload.get("features", []) if country_id(feature) == "DEU"]
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one canonical DEU feature, got {len(matches)}")
    result = shape(matches[0]["geometry"])
    if not result.is_valid:
        raise RuntimeError(f"canonical DEU geometry is invalid: {explain_validity(result)}")
    return result


def extract_heligoland(canonical_deu, patch: dict[str, Any]) -> MultiPolygon:
    selection = box(*map(float, patch["selectionBbox"]))
    selected = [
        part
        for part in polygon_parts(canonical_deu)
        if part.intersects(selection) and part.intersection(selection).area > 0
    ]
    expected = int(patch["expectedComponents"])
    if len(selected) != expected:
        bounds = [tuple(round(value, 7) for value in part.bounds) for part in selected]
        raise RuntimeError(
            f"Heligoland selection expected {expected} polygon components, got {len(selected)}: {bounds}"
        )
    result = normalize_polygonal(MultiPolygon(selected))
    for name, coordinates in (patch.get("insidePoints") or {}).items():
        if not result.covers(Point(*coordinates)):
            raise RuntimeError(f"Heligoland patch does not cover required point {name}: {coordinates}")
    return result


def round_coordinates(value: Any, digits: int) -> Any:
    if isinstance(value, (list, tuple)):
        if value and all(isinstance(item, (int, float)) for item in value):
            return [round(float(item), digits) for item in value]
        return [round_coordinates(item, digits) for item in value]
    return value


def area_km2(geometry) -> float:
    area, _ = GEOD.geometry_area_perimeter(geometry)
    return abs(area) / 1_000_000


def coordinate_count(geometry) -> int:
    total = 0
    for part in polygon_parts(geometry):
        total += len(part.exterior.coords)
        total += sum(len(ring.coords) for ring in part.interiors)
    return total


def validate_result(
    geometry: MultiPolygon,
    heligoland: MultiPolygon,
    recipe: dict[str, Any],
) -> dict[str, Any]:
    if not geometry.is_valid:
        raise RuntimeError(f"final German Empire geometry is invalid: {explain_validity(geometry)}")
    validation = recipe["validation"]
    area = area_km2(geometry)
    limits = validation["areaKm2"]
    if not float(limits["minimum"]) <= area <= float(limits["maximum"]):
        raise RuntimeError(
            f"German Empire base area {area:.3f} km2 is outside "
            f"{limits['minimum']}..{limits['maximum']} km2"
        )
    for name, coordinates in (validation.get("insidePoints") or {}).items():
        if not geometry.covers(Point(*coordinates)):
            raise RuntimeError(f"required 1914 point is outside base geometry: {name} {coordinates}")
    for name, coordinates in (validation.get("outsidePoints") or {}).items():
        if geometry.covers(Point(*coordinates)):
            raise RuntimeError(f"excluded 1914 point is inside base geometry: {name} {coordinates}")

    patch = recipe["heligolandPatch"]
    cleanup = box(*map(float, patch["cleanupBbox"]))
    final_patch = normalize_polygonal(geometry.intersection(cleanup))
    patch_difference = area_km2(final_patch.symmetric_difference(heligoland))
    max_difference = float(validation["maximumHeligolandPatchDifferenceKm2"])
    if patch_difference > max_difference:
        raise RuntimeError(
            "Heligoland cleanup/patch is not isolated: "
            f"symmetric difference {patch_difference:.9f} km2 > {max_difference:g} km2"
        )

    return {
        "areaKm2": round(area, 6),
        "bounds": [round(float(value), 7) for value in geometry.bounds],
        "componentCount": len(geometry.geoms),
        "coordinateCount": coordinate_count(geometry),
        "heligolandPatchDifferenceKm2": round(patch_difference, 9),
    }


def build(recipe: dict[str, Any]):
    hgis_path, features, raw_bounds = load_hgis_states(recipe)
    correction = recipe["linearCorrection"]
    corrected_states = [corrected_feature_geometry(feature, correction) for feature in features]
    corrected_union = normalize_polygonal(unary_union(corrected_states))

    canonical_deu = load_canonical_deu(recipe)
    heligoland = extract_heligoland(canonical_deu, recipe["heligolandPatch"])
    cleanup = box(*map(float, recipe["heligolandPatch"]["cleanupBbox"]))

    without_heligoland_window = corrected_union.difference(cleanup)
    combined = normalize_polygonal(unary_union([without_heligoland_window, heligoland]))
    validation = validate_result(combined, heligoland, recipe)

    diagnostics = {
        "recipeId": recipe["id"],
        "referenceDate": recipe["referenceDate"],
        "source": {
            "path": str(hgis_path.relative_to(ROOT)).replace("\\", "/"),
            "sha256": normalized_sha256(hgis_path),
            "featureCount": len(features),
            "rawBounds": [round(value, 7) for value in raw_bounds],
        },
        "linearCorrection": {
            "source": correction["source"],
            "upstreamCommit": correction["upstreamCommit"],
            "longitude": correction["longitude"],
            "latitude": correction["latitude"],
            "implementation": "axis-correct port: WE->longitude, SN->latitude",
            "correctedBoundsBeforePatch": [
                round(float(value), 7) for value in corrected_union.bounds
            ],
        },
        "heligolandPatch": {
            "componentCount": len(heligoland.geoms),
            "bounds": [round(float(value), 7) for value in heligoland.bounds],
            "areaKm2": round(area_km2(heligoland), 6),
        },
        "output": validation,
    }
    return combined, diagnostics


def output_collection(geometry: MultiPolygon, recipe: dict[str, Any]) -> dict[str, Any]:
    mapped = mapping(geometry)
    mapped["coordinates"] = round_coordinates(mapped["coordinates"], int(recipe.get("roundingDigits", 7)))
    return {
        "type": "FeatureCollection",
        "name": "pandolab-german-empire-1914-working-base",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": [
            {
                "type": "Feature",
                "id": "historical-country:deutsches-reich:1914-base",
                "properties": {
                    "name": "Deutsches Reich",
                    "referenceDate": recipe["referenceDate"],
                    "status": "working-base-not-final",
                    "source": "HGIS Germany 1914, OSHistory linear correction, Natural Earth v5.1.1 Heligoland patch",
                },
                "geometry": mapped,
            }
        ],
    }


def serialized_json(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_or_check(path: pathlib.Path, payload: bytes, check: bool) -> None:
    if check:
        if not path.is_file():
            raise RuntimeError(f"missing generated file: {path.relative_to(ROOT)}")
        existing = path.read_bytes().replace(b"\r\n", b"\n")
        if existing != payload.replace(b"\r\n", b"\n"):
            raise RuntimeError(f"generated file is stale: {path.relative_to(ROOT)}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", type=pathlib.Path, default=DEFAULT_RECIPE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    recipe_path = args.recipe if args.recipe.is_absolute() else ROOT / args.recipe
    recipe = load_json(recipe_path)
    geometry, diagnostics = build(recipe)

    output_path = ROOT / recipe["output"]
    diagnostics_path = ROOT / recipe["diagnosticsOutput"]
    output_bytes = serialized_json(output_collection(geometry, recipe))
    diagnostics["output"]["bytes"] = len(output_bytes)
    diagnostics_bytes = serialized_json(diagnostics)

    write_or_check(output_path, output_bytes, args.check)
    write_or_check(diagnostics_path, diagnostics_bytes, args.check)

    print(
        json.dumps(
            {
                "mode": "check" if args.check else "build",
                "output": str(output_path.relative_to(ROOT)),
                **diagnostics["output"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
