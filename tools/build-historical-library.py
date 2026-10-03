#!/usr/bin/env python3
"""Build deterministic inline geometry for PandoLab historical library pilots."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import sys
from dataclasses import dataclass
from typing import Any, Iterable

from pyproj import CRS, Geod, Transformer
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, snap, transform, unary_union
from shapely.validation import explain_validity


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_RECIPE = ROOT / "tools" / "historical-library" / "east-germany-1989.recipe.json"
GEOD = Geod(ellps="WGS84")
WGS84 = CRS.from_epsg(4326)
AREA_TRANSFORMER = Transformer.from_crs(WGS84, CRS.from_epsg(3035), always_xy=True)


def load_json(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: pathlib.Path) -> str:
    # Git may materialize tracked JSON with CRLF on Windows. Source identity is
    # defined by the repository's LF-normalized text so recipe checks remain
    # deterministic across checkout platforms.
    payload = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(payload).hexdigest().upper()


def transform_geometry(geometry, source_crs: str, target_crs: CRS = WGS84):
    source = CRS.from_user_input(source_crs)
    if source == target_crs:
        return geometry
    transformer = Transformer.from_crs(source, target_crs, always_xy=True)
    return transform(transformer.transform, geometry)


def iter_polygon_rings(geometry) -> Iterable[list[tuple[float, float]]]:
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    for polygon in polygons:
        yield list(polygon.exterior.coords)
        for interior in polygon.interiors:
            yield list(interior.coords)


def normalize_polygonal(geometry):
    if geometry.is_empty:
        raise RuntimeError("geometry is empty")
    polygons = []
    if isinstance(geometry, Polygon):
        polygons = [geometry]
    elif isinstance(geometry, MultiPolygon):
        polygons = list(geometry.geoms)
    elif hasattr(geometry, "geoms"):
        polygons = [part for part in geometry.geoms if isinstance(part, Polygon) and not part.is_empty]
    if not polygons:
        raise RuntimeError(f"expected Polygon or MultiPolygon, got {geometry.geom_type}")
    normalized = [orient(polygon, sign=1.0) for polygon in polygons if polygon.area > 0]
    normalized.sort(
        key=lambda polygon: (
            -round(polygon.area, 15),
            round(polygon.bounds[0], 12),
            round(polygon.bounds[1], 12),
            round(polygon.bounds[2], 12),
            round(polygon.bounds[3], 12),
        )
    )
    result = MultiPolygon(normalized)
    if not result.is_valid:
        raise RuntimeError(f"invalid polygonal geometry: {explain_validity(result)}")
    return result


def decompose_point_touching_rings(geometry):
    """Split point-touching rings into simple polygon components without area change.

    GEOS accepts some rings that meet themselves at a single node, while the
    PandoLab audit deliberately reports every non-adjacent segment contact. A
    noded boundary polygonization preserves the occupied cells and exact source
    coordinates while expressing those contacts as separate MultiPolygon parts.
    """
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    output = []
    for polygon in polygons:
        cells = polygonize(unary_union(polygon.boundary))
        selected = [cell for cell in cells if cell.area > 0 and polygon.covers(cell.representative_point())]
        output.extend(selected or [polygon])
    return MultiPolygon([orient(polygon, sign=1.0) for polygon in output])


def round_coordinates(value: Any, digits: int = 7) -> Any:
    if isinstance(value, (list, tuple)):
        if value and all(isinstance(item, (int, float)) for item in value):
            return [round(float(item), digits) for item in value]
        return [round_coordinates(item, digits) for item in value]
    return value


def coordinate_count(geometry) -> int:
    return sum(len(ring) for ring in iter_polygon_rings(geometry))


def area_km2(geometry) -> float:
    area, _ = GEOD.geometry_area_perimeter(geometry)
    return abs(area) / 1_000_000


def projected_area_km2(geometry) -> float:
    return abs(transform(AREA_TRANSFORMER.transform, geometry).area) / 1_000_000


def replace_line_endpoints_near_boundary(line, boundary, tolerance: float):
    def replace(coords):
        output = list(coords)
        for index in (0, len(output) - 1):
            endpoint = Point(output[index])
            distance = endpoint.distance(boundary)
            if distance <= tolerance:
                projected = boundary.interpolate(boundary.project(endpoint))
                output[index] = projected.coords[0]
        return LineString(output)

    if isinstance(line, LineString):
        return replace(line.coords)
    if isinstance(line, MultiLineString):
        return MultiLineString([replace(part.coords) for part in line.geoms])
    if hasattr(line, "geoms"):
        return unary_union([replace_line_endpoints_near_boundary(part, boundary, tolerance) for part in line.geoms])
    return line


@dataclass
class Source:
    id: str
    path: pathlib.Path
    crs: str
    payload: dict[str, Any]

    def features(self) -> list[dict[str, Any]]:
        return list(self.payload.get("features") or [])

    def geometry(self, *, target_crs: CRS = WGS84, selector: dict[str, Any] | None = None):
        selected = self.features()
        if selector:
            field = str(selector.get("field", ""))
            values = {str(value) for value in selector.get("values", [])}
            def selected_value(feature: dict[str, Any]) -> str:
                if field == "__feature_id__":
                    return str(feature.get("id", ""))
                return str((feature.get("properties") or {}).get(field, ""))
            selected = [
                feature for feature in selected
                if selected_value(feature) in values
            ]
            if len(selected) != len(values):
                found = sorted(selected_value(feature) for feature in selected)
                raise RuntimeError(f"{self.id} selector mismatch: expected {sorted(values)}, found {found}")
        geometries = [shape(feature["geometry"]) for feature in selected if feature.get("geometry")]
        if not geometries:
            raise RuntimeError(f"source has no selected geometry: {self.id}")
        return transform_geometry(unary_union(geometries), self.crs, target_crs)


class RecipeBuilder:
    def __init__(self, recipe: dict[str, Any]):
        self.recipe = recipe
        self.sources: dict[str, Source] = {}
        self.results: dict[str, Any] = {}
        self.diagnostics: dict[str, Any] = {}
        for source_id, definition in recipe.get("sources", {}).items():
            path = ROOT / definition["path"]
            if not path.is_file():
                raise RuntimeError(f"missing source: {path.relative_to(ROOT)}")
            expected_hash = str(definition.get("sha256", "")).upper()
            actual_hash = sha256(path)
            if expected_hash and actual_hash != expected_hash:
                raise RuntimeError(
                    f"source SHA-256 mismatch for {source_id}: expected {expected_hash}, got {actual_hash}"
                )
            self.sources[source_id] = Source(source_id, path, definition["crs"], load_json(path))

    def resolve(self, reference: str, *, target_crs: CRS = WGS84):
        if reference in self.results:
            result = self.results[reference]
            return result if target_crs == WGS84 else transform_geometry(result, "EPSG:4326", target_crs)
        if reference in self.sources:
            return self.sources[reference].geometry(target_crs=target_crs)
        raise RuntimeError(f"unknown recipe geometry reference: {reference}")

    def polygonize_mask(self, operation: dict[str, Any]):
        metric_crs = CRS.from_epsg(25833)
        boundary = self.sources[operation["boundarySource"]].geometry(target_crs=metric_crs)
        line_source = self.sources[operation["lineSource"]]
        primary_layers = set(operation.get("primaryLayers", []))
        priority_layers = set(operation.get("priorityLayers", []))
        primary = []
        priority = []
        for feature in line_source.features():
            layer = str((feature.get("properties") or {}).get("source_layer", ""))
            geometry = shape(feature["geometry"])
            if layer in primary_layers:
                primary.append(geometry)
            elif layer in priority_layers:
                priority.append(geometry)
        if not primary or not priority:
            raise RuntimeError("Berlin mask requires both primary wall and priority political-boundary linework")
        primary_line = unary_union(primary)
        priority_line = unary_union(priority)
        maximum_tolerance = float(operation.get("maxSnapMeters", 100))
        linework = unary_union([primary_line, priority_line])
        to_metric = Transformer.from_crs(WGS84, metric_crs, always_xy=True)
        reference = Point(*to_metric.transform(*operation["referencePoint"]))
        excluded = Point(*to_metric.transform(*operation["excludePoint"]))
        snap_candidates = [0.01, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100]
        selected = None
        for tolerance in snap_candidates:
            if tolerance > maximum_tolerance:
                continue
            snapped = snap(linework, linework, tolerance)
            noded = unary_union([snapped, boundary.boundary])
            cells = [cell.intersection(boundary) for cell in polygonize(noded)]
            cells = [cell for cell in cells if not cell.is_empty and cell.area > 1]
            reference_cells = [cell for cell in cells if cell.covers(reference)]
            if len(reference_cells) != 1:
                continue
            candidate = reference_cells[0]
            if candidate.covers(excluded) or not 400_000_000 <= candidate.area <= 600_000_000:
                continue
            selected = (tolerance, noded, cells, candidate)
            break
        if selected is None:
            raise RuntimeError(
                f"West Berlin political boundary did not close within the configured {maximum_tolerance:g} m snap limit"
            )
        tolerance, noded, cells, west = selected
        west = normalize_polygonal(west)
        if not west.is_valid:
            raise RuntimeError(f"invalid West Berlin mask: {explain_validity(west)}")
        closure_gap = west.boundary.difference(noded.buffer(0.001)).length
        if closure_gap > 0.01:
            raise RuntimeError(f"West Berlin mask has an unexplained closure gap of {closure_gap:.3f} m")
        self.diagnostics[operation["id"]] = {
            "polygonizedCells": len(cells),
            "areaKm2": round(west.area / 1_000_000, 6),
            "snapMeters": tolerance,
            "outerBoundarySnapMeters": 0,
            "closureGapMeters": round(closure_gap, 6),
        }
        return normalize_polygonal(transform_geometry(west, "EPSG:25833", WGS84))

    def build_geometry(self):
        for operation in self.recipe.get("operations", []):
            operation_id = operation["id"]
            kind = operation["operation"]
            if kind == "union" and operation.get("source"):
                result = self.sources[operation["source"]].geometry(selector=operation.get("selector"))
            elif kind == "union":
                result = unary_union([self.resolve(reference) for reference in operation["inputs"]])
            elif kind == "difference":
                left, right = (self.resolve(reference) for reference in operation["inputs"])
                result = left.difference(right)
            elif kind == "clip":
                left, right = (self.resolve(reference) for reference in operation["inputs"])
                result = left.intersection(right)
            elif kind == "polygonize-mask":
                result = self.polygonize_mask(operation)
            elif kind == "canonical-boundary-reconcile":
                candidate = self.resolve(operation["input"])
                source = self.sources[operation["canonicalSource"]]
                canonical = source.geometry(
                    selector={"field": "__feature_id__", "values": [operation["canonicalId"]]}
                )
                result = decompose_point_touching_rings(candidate.intersection(canonical))
                self.results["canonical-country"] = normalize_polygonal(canonical)
            else:
                raise RuntimeError(f"unsupported recipe operation: {kind}")
            self.results[operation_id] = normalize_polygonal(result)
        return self.results[self.recipe["operations"][-1]["id"]]


def validate_rings(geometry) -> None:
    for ring_index, ring in enumerate(iter_polygon_rings(geometry)):
        if ring[0] != ring[-1]:
            raise RuntimeError(f"ring {ring_index} is open")
        if len(set(ring[:-1])) < 3:
            raise RuntimeError(f"ring {ring_index} has fewer than three distinct vertices")
        for left, right in zip(ring, ring[1:]):
            if left == right:
                raise RuntimeError(f"ring {ring_index} has a consecutive duplicate coordinate: {left}")


def validate_geometry(geometry, canonical, validation: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(geometry, MultiPolygon) or len(geometry.geoms) < 1:
        raise RuntimeError("East Germany output must be one non-empty MultiPolygon geometry")
    if not geometry.is_valid:
        raise RuntimeError(f"invalid East Germany geometry: {explain_validity(geometry)}")
    validate_rings(geometry)

    area = area_km2(geometry)
    area_limits = validation["areaKm2"]
    if not float(area_limits["minimum"]) <= area <= float(area_limits["maximum"]):
        raise RuntimeError(f"East Germany area {area:.3f} km2 is outside the acceptance range")
    for name, coordinates in validation.get("insidePoints", {}).items():
        if not geometry.covers(Point(*coordinates)):
            raise RuntimeError(f"required point is outside East Germany: {name} {coordinates}")
    for name, coordinates in validation.get("outsidePoints", {}).items():
        if geometry.covers(Point(*coordinates)):
            raise RuntimeError(f"excluded point is inside East Germany: {name} {coordinates}")

    outside_area = projected_area_km2(geometry.difference(canonical))
    if outside_area > 1e-6:
        raise RuntimeError(f"East Germany extends {outside_area:.9f} km2 outside canonical DEU")
    remainder = canonical.difference(geometry)
    overlap_area = projected_area_km2(geometry.intersection(remainder))
    puzzle_difference = projected_area_km2(unary_union([geometry, remainder]).symmetric_difference(canonical))
    tolerance = float(validation["maximumPuzzleDifferenceKm2"])
    if overlap_area > tolerance or puzzle_difference > tolerance:
        raise RuntimeError(
            f"puzzle fit failed: overlap={overlap_area:.9f} km2 symmetricDifference={puzzle_difference:.9f} km2"
        )
    count = coordinate_count(geometry)
    if count > int(validation["maximumCoordinates"]):
        raise RuntimeError(f"East Germany uses {count} coordinates, above the configured budget")

    shared_external = geometry.boundary.intersection(canonical.boundary)
    external_gap = shared_external.difference(canonical.boundary).length
    if external_gap > 1e-12:
        raise RuntimeError(f"canonical external boundary mismatch: {external_gap}")
    return {
        "areaKm2": round(area, 6),
        "coordinateCount": count,
        "componentCount": len(geometry.geoms),
        "outsideCanonicalKm2": round(outside_area, 9),
        "puzzleOverlapKm2": round(overlap_area, 9),
        "puzzleSymmetricDifferenceKm2": round(puzzle_difference, 9),
        "sharedCanonicalBoundaryKm": round(GEOD.geometry_length(shared_external) / 1_000, 3),
    }


def east_germany_entity(recipe: dict[str, Any], geometry) -> dict[str, Any]:
    mapped = mapping(geometry)
    # Preserve enough precision for the noded Berlin linework. Seven decimal
    # places can collapse nearby nodes and reintroduce self-intersections.
    mapped["coordinates"] = round_coordinates(mapped["coordinates"], 12)
    return {
        "libraryId": "historical-country:deutsche-demokratische-republik",
        "entityKind": "general",
        "canonicalName": "German Democratic Republic",
        "displayNames": {
            "ko": "독일 민주공화국",
            "en": "German Democratic Republic",
            "de": "Deutsche Demokratische Republik",
        },
        "alternateNames": ["동독", "East Germany", "DDR", "GDR", "Ostdeutschland"],
        "startDate": "1949-10-07",
        "endDate": "1990-10-02",
        "instantiation": {
            "mode": "territory-replacement",
            "countryUpdates": {"DEU": {"name": "독일 연방공화국"}},
        },
        "geometryVersions": [
            {
                "id": recipe["id"],
                "validFrom": recipe["referenceDate"],
                "validTo": recipe["referenceDate"],
                "geometry": mapped,
                "datePrecision": "reference-date",
                "certainty": "medium",
                "sourceId": "natural-earth-admin1-v5.1.1+bkg-vg250+berlin-wall-1989",
                "notes": (
                    "1989-04-25 기준 근사 경계입니다. Berlin 장벽선은 같은 날 항공사진을 1:5,000 지도에 "
                    "수작업 전사한 자료로 지적 경계 정밀도가 아닙니다."
                ),
            }
        ],
        "metadata": {
            "geographicRegion": "Europe",
            "pilot": True,
            "approximateGeometry": True,
            "referenceDate": recipe["referenceDate"],
            "dissolutionDate": "1990-10-03",
        },
        "sourceInfo": {
            "title": "Natural Earth Admin 1 v5.1.1, BKG VG250, Berlin Open Data Wall 1989",
            "license": "Natural Earth public domain; BKG dl-de/by-2-0; Berlin dl-de/zero-2-0",
            "notes": "© BKG 2026 dl-de/by-2-0; Berlin wall linework is not parcel-accurate.",
            "sources": [
                {
                    "title": "Natural Earth Admin 1 - States, Provinces v5.1.1",
                    "url": recipe["sources"]["naturalEarthAdmin1"]["url"],
                    "license": recipe["sources"]["naturalEarthAdmin1"]["license"],
                },
                {
                    "title": "BKG Verwaltungsgebiete 1:250 000 (VG250)",
                    "url": recipe["sources"]["amtNeuhaus"]["url"],
                    "license": recipe["sources"]["amtNeuhaus"]["license"],
                    "attribution": "© BKG 2026 dl-de/by-2-0",
                },
                {
                    "title": "Verlauf der Berliner Mauer, 1989",
                    "url": recipe["sources"]["berlinWall"]["url"],
                    "license": recipe["sources"]["berlinWall"]["license"],
                },
            ],
        },
    }


def build_library(recipe: dict[str, Any], geometry) -> bytes:
    output_path = ROOT / recipe["output"]
    library = load_json(output_path)
    entity = east_germany_entity(recipe, geometry)
    entities = [item for item in library.get("entities", []) if item.get("libraryId") != recipe["entityId"]]
    entities.append(entity)
    library["entities"] = entities
    return (json.dumps(library, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", type=pathlib.Path, default=DEFAULT_RECIPE)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    recipe_path = arguments.recipe if arguments.recipe.is_absolute() else ROOT / arguments.recipe
    recipe = load_json(recipe_path)
    builder = RecipeBuilder(recipe)
    geometry = builder.build_geometry()
    payload = build_library(recipe, geometry)
    stored_library = json.loads(payload.decode("utf-8"))
    stored_entity = next(
        entity for entity in stored_library["entities"] if entity.get("libraryId") == recipe["entityId"]
    )
    stored_geometry = shape(stored_entity["geometryVersions"][0]["geometry"])
    diagnostics = validate_geometry(
        stored_geometry,
        builder.results["canonical-country"],
        recipe["validation"],
    )
    if len(payload) > int(recipe["validation"]["maximumLibraryBytes"]):
        raise RuntimeError(f"historical library is {len(payload)} bytes, above the configured budget")
    output_path = ROOT / recipe["output"]
    if arguments.check:
        current_payload = output_path.read_bytes().replace(b"\r\n", b"\n") if output_path.is_file() else b""
        if current_payload != payload:
            print(f"historical library is stale: {output_path.relative_to(ROOT)}", file=sys.stderr)
            return 1
    else:
        output_path.write_bytes(payload)
    report = {
        "geometryVersion": recipe["id"],
        **diagnostics,
        "libraryBytes": len(payload),
        "sourceDiagnostics": builder.diagnostics,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
