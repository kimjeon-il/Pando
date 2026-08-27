#!/usr/bin/env python3
"""Build PandoLab v0.13.0 connected river systems and Natural Earth lake shards.

HydroRIVERS provides canonical river geometry. Natural Earth provides the
global 1:10m lake geometry and enriches matched river names. Optional OSM
waterway relation metadata enriches Korean names and river-system aliases. Selected source
coordinates are quantized to 1e-6 degree Int32 and delta-varint encoded without
vertex simplification. Display packs contain geometry only; metadata is stored
once in a compressed sidecar.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import heapq
import json
import math
import os
import re
import shutil
import stat
import struct
from collections import defaultdict
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import shapefile
from PIL import Image
from shapely.affinity import translate
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import linemerge, nearest_points, transform, unary_union
from shapely.strtree import STRtree


VERSION = "0.13.0"
PACK_FORMAT_VERSION = 4
MICRO = 1_000_000
RIVER_FLOW_WEIGHT = 4.0
RIVER_AREA_WEIGHT = -0.5
RIVER_THRESHOLDS = (14.4744, 12.4307, 11.2137, 10.55)
LAKE_THRESHOLDS_KM2 = (250.0, 100.0, 40.0, 40.0)
STAGE_MIN_ZOOM = (6.0, 6.7, 7.0, 7.5)
STAGE_GRIDS = ((8, 4), (16, 8), (32, 16), (64, 32))
PACK_RAW_LIMIT = 512 * 1024
SHARD_GZIP_LIMIT = 4 * 1024 * 1024
MAX_TOTAL_GZIP_MIB = 48.0
CONTINUITY_MIN_ORDER = 5
CONTINUITY_MIN_FLOW_CMS = 75.0
CONTINUITY_MIN_SCORE = 10.86
MEDIUM_MAINSTEM_MIN_BASIN_KM2 = 2_500.0
BORDER_FLAG = 1
BORDER_MAX_DISTANCE_KM = 12.0
BORDER_COVERAGE_DISTANCE_KM = 5.0
BORDER_MIN_COVERAGE = 0.70
BORDER_MAX_DIRECTION_DEGREES = 30.0
BORDER_MIN_LENGTH_KM = 10.0
RIVER_CODES = ("af", "ar", "as", "au", "eu", "gr", "na", "sa", "si")
Image.MAX_IMAGE_PIXELS = None


def remove_readonly(function, path: str, _error: object) -> None:
    """Let repeat builds replace OneDrive Files On-Demand directories on Windows."""
    os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    function(path)


@dataclass
class BuiltFeature:
    fid: int
    logical_fid: int
    pandolab_id: str
    layer_id: str
    category: str
    stage: int
    name: str
    source_id: str
    source: str
    width: float
    geometry: dict[str, Any]
    bounds: tuple[float, float, float, float]
    width_profile: list[list[float]] | None = None
    fragment_index: int = 0
    fragment_count: int = 1
    flags: int = 0
    terminal: dict[str, Any] | None = None
    system_id: str = ""
    mainstem_name_ko: str = ""
    role: str = ""
    aliases: list[str] | None = None
    tributary_names: list[str] | None = None
    osm_relation_ids: list[int] | None = None


@dataclass
class RiverReach:
    source_id: int
    next_down: int
    main_river: int
    stage: int
    order: int
    flow: float
    upstream_area: float
    width: float
    end_width: float
    parts: list[list[tuple[float, float]]]
    endorheic: bool = False
    render_snap: tuple[float, float] | None = None
    border_pair: tuple[str, str] | None = None
    terminal_class: str = ""
    original_endpoint: tuple[float, float] | None = None


@dataclass(slots=True)
class RiverMeta:
    source_id: int
    next_down: int
    main_river: int
    order: int
    flow: float
    upstream_area: float
    stage: int | None
    record_index: int
    width: float
    corrected_width: float
    endorheic: bool


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


HYDRONYM_SUFFIX_RE = re.compile(r"\s+(호수|강|천|호)$")
HYDRONYM_DUPLICATE_SUFFIX_RE = re.compile(r"(호수|강|천|호)\1$")
HYDRONYM_ENGLISH_SUFFIX_RE = re.compile(r"\s+(River|Stream|Creek|Lake|Reservoir)$", re.IGNORECASE)


def load_hydronym_overrides(path: Path | None) -> dict[str, str]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(key).strip(): str(value).strip() for key, value in (payload.get("aliases") or {}).items() if str(value).strip()}


def normalize_hydronym(name: str, category: str, overrides: dict[str, str]) -> str:
    """Normalize Korean hydronym spacing without inventing a proper name."""
    value = " ".join(str(name or "").replace("\u00a0", " ").split()).strip()
    if not value:
        return ""
    value = overrides.get(value, value)
    value = HYDRONYM_SUFFIX_RE.sub(r"\1", value)
    value = HYDRONYM_DUPLICATE_SUFFIX_RE.sub(r"\1", value)
    if re.search(r"[A-Za-z]", value):
        value = HYDRONYM_ENGLISH_SUFFIX_RE.sub("", value).strip()
    if value in overrides:
        value = overrides[value]
    if category == "river" and re.search(r"[가-힣]$", value) and not value.endswith(("강", "천", "수계")):
        value += "강"
    if category == "lake" and re.search(r"[가-힣]$", value) and not value.endswith(("호", "호수", "해", "만", "저수지")):
        value += "호"
    return value


class OsmWaterwayIndex:
    """Compact matcher for an Overpass `out tags bb` waterway-relation export."""

    def __init__(self, path: Path | None, overrides: dict[str, str]):
        self.path = path
        self.overrides = overrides
        self.rows: list[dict[str, Any]] = []
        self.boxes: list[Polygon] = []
        self.tree: STRtree | None = None
        if path is None or not path.exists():
            return
        payload = json.loads(path.read_text(encoding="utf-8"))
        for element in payload.get("elements") or []:
            tags = element.get("tags") or {}
            bounds = element.get("bounds") or {}
            if element.get("type") != "relation" or tags.get("type") != "waterway":
                continue
            if not all(key in bounds for key in ("minlon", "minlat", "maxlon", "maxlat")):
                continue
            extent = (
                float(bounds["minlon"]), float(bounds["minlat"]),
                float(bounds["maxlon"]), float(bounds["maxlat"]),
            )
            if extent[2] <= extent[0] or extent[3] <= extent[1]:
                continue
            names = [str(tags.get(key) or "").strip() for key in ("name:ko", "name", "name:en")]
            names = list(dict.fromkeys(name for name in names if name))
            if not names:
                continue
            self.rows.append({
                "id": int(element.get("id") or 0), "bounds": extent,
                "nameKo": normalize_hydronym(str(tags.get("name:ko") or ""), "river", overrides),
                "names": names,
            })
            self.boxes.append(box(*extent))
        if self.boxes:
            self.tree = STRtree(self.boxes)

    def match(self, bounds: tuple[float, float, float, float]) -> dict[str, Any] | None:
        if self.tree is None:
            return None
        target = box(*bounds)
        span_x = max(bounds[2] - bounds[0], 0.05)
        span_y = max(bounds[3] - bounds[1], 0.05)
        target_center = target.centroid
        candidates: list[tuple[float, int]] = []
        for raw_index in self.tree.query(target.buffer(max(span_x, span_y) * 0.08 + 0.05)):
            index = int(raw_index)
            candidate = self.boxes[index]
            intersection = target.intersection(candidate).area
            union = target.union(candidate).area
            overlap = intersection / union if union else 0.0
            candidate_bounds = self.rows[index]["bounds"]
            edge_error = (
                abs(candidate_bounds[0] - bounds[0]) / span_x + abs(candidate_bounds[2] - bounds[2]) / span_x
                + abs(candidate_bounds[1] - bounds[1]) / span_y + abs(candidate_bounds[3] - bounds[3]) / span_y
            )
            center_error = math.hypot(
                (candidate.centroid.x - target_center.x) / span_x,
                (candidate.centroid.y - target_center.y) / span_y,
            )
            score = edge_error + center_error * 0.8 - overlap * 2.0
            if overlap >= 0.12 or (center_error <= 0.35 and edge_error <= 2.5):
                candidates.append((score, index))
        if not candidates:
            return None
        candidates.sort()
        if len(candidates) > 1 and candidates[1][0] <= candidates[0][0] + 0.15:
            return None
        return self.rows[candidates[0][1]]


def shapefile_source_files(path: Path) -> list[dict[str, str]]:
    rows = []
    for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
        component = path.with_suffix(suffix)
        if component.exists():
            rows.append({"file": component.name, "sha256": sha256(component)})
    return rows


def find_unique(roots: Sequence[Path], filename: str) -> Path:
    matches: set[Path] = set()
    for root in roots:
        if root.is_file() and root.name.lower() == filename.lower():
            matches.add(root.resolve())
        elif root.is_dir():
            matches.update(path.resolve() for path in root.rglob(filename))
    if len(matches) != 1:
        raise RuntimeError(f"{filename}: 정확히 한 파일이 필요하지만 {len(matches)}개를 찾았습니다.")
    return next(iter(matches))


def normalize_lon(value: float) -> float:
    value = ((float(value) + 180.0) % 360.0) - 180.0
    return 180.0 if value == -180.0 else value


def quantize(point: Sequence[float]) -> tuple[int, int]:
    return round(normalize_lon(point[0]) * MICRO), round(max(-90.0, min(90.0, float(point[1]))) * MICRO)


def geometry_coord_count(geometry: dict[str, Any]) -> int:
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "LineString":
        return len(coords)
    if kind == "MultiLineString" or kind == "Polygon":
        return sum(len(part) for part in coords)
    if kind == "MultiPolygon":
        return sum(len(ring) for polygon in coords for ring in polygon)
    return 0


def iter_geometry_points(geometry: dict[str, Any]) -> Iterator[Sequence[float]]:
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "LineString":
        yield from coords
    elif kind in ("MultiLineString", "Polygon"):
        for part in coords:
            yield from part
    elif kind == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                yield from ring


def geometry_bounds(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    points = list(iter_geometry_points(geometry))
    if not points:
        return (-180.0, -90.0, 180.0, 90.0)
    xs = [normalize_lon(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def river_importance(order: int, flow: float, upstream_area: float) -> float:
    return order + RIVER_FLOW_WEIGHT * math.log10(max(flow, 1e-6)) + RIVER_AREA_WEIGHT * math.log10(max(upstream_area, 1e-6))


def river_stage(order: int, flow: float, upstream_area: float) -> int | None:
    score = river_importance(order, flow, upstream_area)
    for stage, threshold in enumerate(RIVER_THRESHOLDS):
        if score >= threshold:
            return stage
    return None


def river_width(order: int, flow: float) -> float:
    """Return a restrained symbolic width independent from visibility score."""
    value = 0.5 + 0.19 * math.log2(1.0 + max(float(flow), 0.0)) + 0.06 * max(int(order) - 1, 0)
    return max(0.55, min(2.6, value))


def lake_stage(area_km2: float) -> int | None:
    for stage, threshold in enumerate(LAKE_THRESHOLDS_KM2):
        if area_km2 >= threshold:
            return stage
    return None


def min_zoom_stage(value: float) -> int:
    for stage, threshold in enumerate(STAGE_MIN_ZOOM):
        if value <= threshold + 1e-9:
            return stage
    return len(STAGE_MIN_ZOOM) - 1


def line_parts(geometry: dict[str, Any]) -> list[list[tuple[float, float]]]:
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "LineString":
        return [[(float(x), float(y)) for x, y, *_ in coords]]
    if kind == "MultiLineString":
        return [[(float(x), float(y)) for x, y, *_ in part] for part in coords]
    return []


def merge_ne_river_parts(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reassemble Natural Earth rows sharing one logical river ID."""
    groups: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(features):
        properties = dict(raw.get("properties") or {})
        key = str(properties.get("pandolab_id") or raw.get("id") or f"ne-river-row:{index}")
        if key not in groups:
            groups[key] = {
                "feature": {"type": "Feature", "id": key, "properties": properties, "geometry": None},
                "parts": [],
            }
        group = groups[key]
        group["parts"].extend(line_parts(raw.get("geometry") or {}))
        current = group["feature"]["properties"]
        current_zoom = current.get("min_zoom") if current.get("min_zoom") is not None else 99
        row_zoom = properties.get("min_zoom") if properties.get("min_zoom") is not None else 99
        current["min_zoom"] = min(float(current_zoom), float(row_zoom))
        current["stroke_width"] = max(float(current.get("stroke_width") or 0), float(properties.get("stroke_width") or 0))
        for name_key in ("name_ko", "name_en", "name"):
            if not current.get(name_key) and properties.get(name_key):
                current[name_key] = properties[name_key]
    merged: list[dict[str, Any]] = []
    for group in groups.values():
        parts = group["parts"]
        feature = group["feature"]
        feature["geometry"] = {"type": "LineString", "coordinates": parts[0]} if len(parts) == 1 else {"type": "MultiLineString", "coordinates": parts}
        merged.append(feature)
    return merged


def load_ne_base(hydro_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    river_rows = json.loads((hydro_root / "rivers_base.geojson").read_text(encoding="utf-8"))["features"]
    rivers = merge_ne_river_parts(river_rows)
    lakes = json.loads((hydro_root / "lakes_base.geojson").read_text(encoding="utf-8"))["features"]
    return rivers, lakes


def projector(center_lat: float):
    factor = math.cos(math.radians(center_lat))
    return lambda x, y, z=None: (x * 111.32 * factor, y * 110.57)


def line_direction(line: LineString) -> tuple[float, float]:
    points = list(line.coords)
    if len(points) < 2:
        return 0.0, 0.0
    dx = points[-1][0] - points[0][0]
    dy = points[-1][1] - points[0][1]
    length = math.hypot(dx, dy) or 1.0
    return dx / length, dy / length


class ReferenceGuides:
    """Natural Earth lines used only to select/name the corresponding Hydro spine."""

    def __init__(self, features: Sequence[dict[str, Any]]):
        self.lines: list[LineString] = []
        self.names: list[str] = []
        for feature in features:
            properties = feature.get("properties") or {}
            name = str(properties.get("name_ko") or properties.get("name_en") or properties.get("name") or "").strip()
            geometry = shape(feature.get("geometry"))
            candidates = [geometry] if isinstance(geometry, LineString) else list(getattr(geometry, "geoms", []))
            for line in candidates:
                if isinstance(line, LineString) and len(line.coords) >= 2:
                    self.lines.append(line)
                    self.names.append(name)
        self.tree = STRtree(self.lines)

    def nearest(self, line: LineString, max_distance: float = 0.22) -> tuple[LineString, str] | None:
        if line.is_empty or not self.lines:
            return None
        index = int(self.tree.nearest(line))
        reference = self.lines[index]
        return (reference, self.names[index]) if line.distance(reference) <= max_distance else None


class CoastSnapper:
    """Classify Hydro terminals and safely extend clear coastal outlets."""

    def __init__(
        self, countries_path: Path, lake_features: Sequence[dict[str, Any]], drainage_free_raster: Path,
    ):
        features = json.loads(countries_path.read_text(encoding="utf-8"))["features"]
        self.land = unary_union([shape(feature["geometry"]) for feature in features])
        coastline = self.land.boundary
        base_lines = list(coastline.geoms) if hasattr(coastline, "geoms") else [coastline]
        self.lines = [translate(line, xoff=offset) for offset in (-360.0, 0.0, 360.0) for line in base_lines]
        self.tree = STRtree(self.lines)
        self.land_variants = [translate(self.land, xoff=offset) for offset in (-360.0, 0.0, 360.0)]
        self.land_presence_variants = [geometry.buffer(0.01) for geometry in self.land_variants]
        self.land_connector_variants = [geometry.buffer(0.002) for geometry in self.land_variants]
        lakes = [shape(feature.get("geometry")) for feature in lake_features]
        self.lakes = [translate(lake, xoff=offset) for offset in (-360.0, 0.0, 360.0) for lake in lakes if not lake.is_empty]
        self.lake_tree = STRtree(self.lakes) if self.lakes else None
        self.drainage_free_land = Image.open(drainage_free_raster)

    def is_undisplayed_water(self, point: Point) -> bool:
        x = min(self.drainage_free_land.width - 1, max(0, int((normalize_lon(point.x) + 180) / 360 * self.drainage_free_land.width)))
        y = min(self.drainage_free_land.height - 1, max(0, int((90 - point.y) / 180 * self.drainage_free_land.height)))
        red, green, blue = self.drainage_free_land.getpixel((x, y))
        return max(red, green, blue) - min(red, green, blue) <= 1 and min(red, green, blue) >= 249

    @staticmethod
    def distance_km(source: Point, target: Point) -> float:
        return math.hypot(
            normalize_lon(source.x - target.x) * 111.32 * math.cos(math.radians(source.y)),
            (source.y - target.y) * 110.57,
        )

    def resolve(self, point: tuple[float, float], max_km: float = 25.0) -> dict[str, Any]:
        source = Point(normalize_lon(point[0]), float(point[1]))
        if self.lake_tree is not None:
            lake = self.lakes[int(self.lake_tree.nearest(source))]
            lake_target = nearest_points(source, lake)[1]
            if lake.covers(source) or self.distance_km(source, lake_target) <= 1.0:
                return {"class": "lake", "distanceKm": self.distance_km(source, lake_target), "snap": None}

        coast = self.lines[int(self.tree.nearest(source))]
        target = nearest_points(source, coast)[1]
        distance_km = self.distance_km(source, target)
        land_index = min(range(len(self.land_variants)), key=lambda index: self.land_variants[index].distance(source))
        local_land = self.land_variants[land_index]
        on_rendered_land = self.land_presence_variants[land_index].covers(source)
        if distance_km <= 1e-5:
            return {"class": "sea", "distanceKm": 0.0, "snap": None}
        if distance_km <= 2.0:
            return {
                "class": "sea",
                "distanceKm": distance_km,
                "snap": (normalize_lon(float(target.x)), float(target.y)),
            }
        if distance_km <= max_km and on_rendered_land:
            connector = LineString([source, target])
            outside_length = connector.difference(self.land_connector_variants[land_index]).length
            if outside_length <= 1e-5:
                return {
                    "class": "sea",
                    "distanceKm": distance_km,
                    "snap": (normalize_lon(float(target.x)), float(target.y)),
                }
        if distance_km <= max_km and not on_rendered_land and self.is_undisplayed_water(source):
            # Hydro outlet vertices are sometimes a few kilometres offshore.
            # Retract those water vertices to the canonical coastline; do not
            # mistake them for rivers on tiny land omitted from the base map.
            return {
                "class": "sea",
                "distanceKm": distance_km,
                "snap": (normalize_lon(float(target.x)), float(target.y)),
            }
        if not on_rendered_land:
            return {"class": "excluded-small-land", "distanceKm": distance_km, "snap": None}
        if self.is_undisplayed_water(source):
            return {"class": "excluded-undisplayed-water", "distanceKm": distance_km, "snap": None}
        return {"class": "unresolved-land", "distanceKm": distance_km, "snap": None}


def iter_line_geometries(geometry: Any) -> Iterator[LineString]:
    if isinstance(geometry, LineString):
        if len(geometry.coords) >= 2 and geometry.length > 1e-9:
            yield geometry
        return
    for child in getattr(geometry, "geoms", []):
        yield from iter_line_geometries(child)


def metric_line_substring(
    source: LineString, metric: LineString, start_distance: float, end_distance: float,
) -> list[tuple[float, float]]:
    """Return a shared-border path while retaining every canonical border vertex."""
    source_points = [(float(x), float(y)) for x, y, *_ in source.coords]
    metric_points = [(float(x), float(y)) for x, y, *_ in metric.coords]
    if len(source_points) != len(metric_points) or len(source_points) < 2:
        return []
    reverse = start_distance > end_distance
    lower, upper = sorted((max(0.0, start_distance), min(metric.length, end_distance)))
    if upper - lower <= 1e-6:
        return []
    cumulative = [0.0]
    for left, right in zip(metric_points, metric_points[1:]):
        cumulative.append(cumulative[-1] + math.hypot(right[0] - left[0], right[1] - left[1]))

    def interpolate_at(distance: float) -> tuple[float, float]:
        for index in range(len(cumulative) - 1):
            if distance <= cumulative[index + 1] + 1e-9:
                span = cumulative[index + 1] - cumulative[index]
                ratio = 0.0 if span <= 1e-12 else (distance - cumulative[index]) / span
                left, right = source_points[index], source_points[index + 1]
                return left[0] + (right[0] - left[0]) * ratio, left[1] + (right[1] - left[1]) * ratio
        return source_points[-1]

    points = [interpolate_at(lower)]
    points.extend(source_points[index] for index in range(1, len(source_points) - 1) if lower < cumulative[index] < upper)
    points.append(interpolate_at(upper))
    deduped: list[tuple[float, float]] = []
    for point in points:
        if not deduped or quantize(point) != quantize(deduped[-1]):
            deduped.append(point)
    return list(reversed(deduped)) if reverse else deduped


class BorderAligner:
    """Match long Hydro reaches to exact shared borders of the built-in map."""

    def __init__(self, countries_path: Path):
        collection = json.loads(countries_path.read_text(encoding="utf-8"))
        features = collection.get("features") or []
        countries = [shape(feature["geometry"]) for feature in features]
        country_ids = [
            str((feature.get("properties") or {}).get("editor_id") or (feature.get("properties") or {}).get("iso_a3") or feature.get("id") or index)
            for index, feature in enumerate(features)
        ]
        country_tree = STRtree(countries)
        pair_lines: dict[tuple[str, str], list[LineString]] = defaultdict(list)
        for left_index, left in enumerate(countries):
            for candidate in country_tree.query(left):
                right_index = int(candidate)
                if right_index <= left_index:
                    continue
                shared = left.boundary.intersection(countries[right_index].boundary)
                pair = tuple(sorted((country_ids[left_index], country_ids[right_index])))
                for line in iter_line_geometries(shared):
                    pair_lines[pair].append(line)
        self.lines: list[LineString] = []
        self.pairs: list[tuple[str, str]] = []
        self.pair_geometries: dict[tuple[str, str], Any] = {}
        for pair, lines in sorted(pair_lines.items()):
            unioned = unary_union(lines)
            merged = unioned if isinstance(unioned, LineString) else linemerge(unioned)
            self.pair_geometries[pair] = merged
            for line in iter_line_geometries(merged):
                self.lines.append(line)
                self.pairs.append(pair)
        self.tree = STRtree(self.lines)
        self.grid: dict[tuple[int, int], set[int]] = defaultdict(set)
        for line_index, line in enumerate(self.lines):
            min_x, min_y, max_x, max_y = line.bounds
            for cell_x in range(math.floor((min_x - 1.0) / 2), math.floor((max_x + 1.0) / 2) + 1):
                for cell_y in range(math.floor((min_y - 1.0) / 2), math.floor((max_y + 1.0) / 2) + 1):
                    self.grid[(cell_x, cell_y)].add(line_index)

    def _nearby_line_indexes(
        self, min_x: float, min_y: float, max_x: float, max_y: float,
    ) -> set[int]:
        """Return only shared borders whose envelopes are within 12 km.

        The legacy two-degree grid remains useful for junction lookup, but it
        is far too coarse for the roughly half-million Hydro reaches.  Querying
        the STRtree with a latitude-aware envelope prevents inland reaches in
        the same grid cell from entering the expensive metric alignment test.
        """
        center_lat = max(-89.5, min(89.5, (min_y + max_y) / 2))
        latitude_padding = BORDER_MAX_DISTANCE_KM / 110.57 + 1e-4
        longitude_padding = min(
            4.0,
            BORDER_MAX_DISTANCE_KM / max(4.0, 111.32 * abs(math.cos(math.radians(center_lat)))) + 1e-4,
        )
        query_bounds = box(
            min_x - longitude_padding,
            min_y - latitude_padding,
            max_x + longitude_padding,
            max_y + latitude_padding,
        )
        return {int(index) for index in self.tree.query(query_bounds)}

    def junction_coordinate(
        self, left_pair: tuple[str, str], right_pair: tuple[str, str],
        left_point: Sequence[float], right_point: Sequence[float], maximum_gap_km: float,
    ) -> tuple[float, float] | None:
        """Return the exact shared-country triple point for two border rivers."""
        left_border = self.pair_geometries.get(left_pair)
        right_border = self.pair_geometries.get(right_pair)
        if left_border is None or right_border is None:
            return None
        junctions = left_border.intersection(right_border)
        if junctions.is_empty:
            return None
        right_lon = float(left_point[0]) + normalize_lon(float(right_point[0]) - float(left_point[0]))
        reference = Point(
            (float(left_point[0]) + right_lon) / 2,
            (float(left_point[1]) + float(right_point[1])) / 2,
        )
        candidate = nearest_points(reference, junctions)[1]
        coordinate = (normalize_lon(float(candidate.x)), float(candidate.y))
        if max(
            CoastSnapper.distance_km(Point(*left_point), Point(*coordinate)),
            CoastSnapper.distance_km(Point(*right_point), Point(*coordinate)),
        ) > maximum_gap_km:
            return None
        qx, qy = quantize(coordinate)
        return qx / MICRO, qy / MICRO

    @staticmethod
    def _sample_distances(line: LineString, border: LineString) -> list[float]:
        sample_count = max(1, math.ceil(line.length))
        return [line.interpolate(min(line.length, index)).distance(border) for index in range(sample_count + 1)]

    def _candidate(self, reach: RiverReach) -> dict[str, Any] | None:
        if len(reach.parts) != 1 or len(reach.parts[0]) < 2:
            return None
        source_points = reach.parts[0]
        min_x = min(point[0] for point in source_points)
        max_x = max(point[0] for point in source_points)
        min_y = min(point[1] for point in source_points)
        max_y = max(point[1] for point in source_points)
        nearby = self._nearby_line_indexes(min_x, min_y, max_x, max_y)
        if not nearby:
            return None
        source = LineString(source_points)
        if source.is_empty:
            return None
        center_lat = source.centroid.y
        project = projector(center_lat)
        metric_source = transform(project, source)
        if metric_source.length <= 1e-6:
            return None
        candidates: list[dict[str, Any]] = []
        # The two-degree grid is only a coarse prefilter. All acceptance
        # distances below are measured in kilometres.
        for line_index in nearby:
            border = self.lines[line_index]
            metric_border = transform(project, border)
            if metric_source.distance(metric_border) > BORDER_MAX_DISTANCE_KM:
                continue
            start_position = metric_border.project(Point(metric_source.coords[0]))
            end_position = metric_border.project(Point(metric_source.coords[-1]))
            border_span = abs(end_position - start_position)
            if border_span < metric_source.length * 0.35 or border_span > metric_source.length * 3.0 + 5.0:
                continue
            midpoint = (start_position + end_position) / 2
            tangent_span = min(5.0, max(0.5, border_span / 2))
            before = metric_border.interpolate(max(0.0, midpoint - tangent_span))
            after = metric_border.interpolate(min(metric_border.length, midpoint + tangent_span))
            border_direction = line_direction(LineString([before, after]))
            river_direction = line_direction(metric_source)
            dot = abs(border_direction[0] * river_direction[0] + border_direction[1] * river_direction[1])
            angle = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
            if angle > BORDER_MAX_DIRECTION_DEGREES:
                continue
            distances = self._sample_distances(metric_source, metric_border)
            if not distances or max(distances) > BORDER_MAX_DISTANCE_KM:
                continue
            candidates.append({
                "lineIndex": line_index,
                "pair": self.pairs[line_index],
                "metricBorder": metric_border,
                "start": start_position,
                "end": end_position,
                "length": metric_source.length,
                "distances": distances,
                "score": sum(distances) / len(distances) + angle * 0.08,
            })
        if not candidates:
            return None
        candidates.sort(key=lambda row: (row["score"], row["pair"], row["lineIndex"]))
        if len(candidates) > 1 and candidates[1]["pair"] != candidates[0]["pair"] and candidates[1]["score"] <= candidates[0]["score"] + 0.5:
            return None
        return candidates[0]

    def _partial_align_reach(self, reach: RiverReach) -> tuple[list[RiverReach], dict[str, Any]]:
        """Split a reach at border entry/exit vertices and align qualifying sub-runs."""
        if len(reach.parts) != 1 or len(reach.parts[0]) < 3 or reach.border_pair:
            return [reach], {"reachCount": 0, "lengthKm": 0.0, "coordinates": 0, "pairs": {}}
        points = reach.parts[0]
        min_x = min(point[0] for point in points)
        max_x = max(point[0] for point in points)
        min_y = min(point[1] for point in points)
        max_y = max(point[1] for point in points)
        nearby = self._nearby_line_indexes(min_x, min_y, max_x, max_y)
        if not nearby:
            return [reach], {"reachCount": 0, "lengthKm": 0.0, "coordinates": 0, "pairs": {}}

        source = LineString(points)
        project = projector(source.centroid.y)
        metric_source = transform(project, source)
        if metric_source.length <= 1e-6:
            return [reach], {"reachCount": 0, "lengthKm": 0.0, "coordinates": 0, "pairs": {}}
        candidates: list[dict[str, Any]] = []
        for line_index in nearby:
            border = self.lines[line_index]
            metric_border = transform(project, border)
            if metric_source.distance(metric_border) > BORDER_MAX_DISTANCE_KM:
                continue
            near_geometry = metric_source.intersection(metric_border.buffer(BORDER_MAX_DISTANCE_KM, cap_style=2))
            for near_line in iter_line_geometries(near_geometry):
                if near_line.length < BORDER_MIN_LENGTH_KM:
                    continue
                source_start = metric_source.project(Point(near_line.coords[0]))
                source_end = metric_source.project(Point(near_line.coords[-1]))
                if source_end < source_start:
                    source_start, source_end = source_end, source_start
                if source_end - source_start < BORDER_MIN_LENGTH_KM:
                    continue
                source_part = metric_line_substring(source, metric_source, source_start, source_end)
                if len(source_part) < 2:
                    continue
                metric_part = transform(project, LineString(source_part))
                border_start = metric_border.project(Point(metric_part.coords[0]))
                border_end = metric_border.project(Point(metric_part.coords[-1]))
                border_span = abs(border_end - border_start)
                if border_span < metric_part.length * 0.35 or border_span > metric_part.length * 3.0 + 5.0:
                    continue
                midpoint = (border_start + border_end) / 2
                tangent_span = min(5.0, max(0.5, border_span / 2))
                before = metric_border.interpolate(max(0.0, midpoint - tangent_span))
                after = metric_border.interpolate(min(metric_border.length, midpoint + tangent_span))
                border_direction = line_direction(LineString([before, after]))
                river_direction = line_direction(metric_part)
                dot = abs(border_direction[0] * river_direction[0] + border_direction[1] * river_direction[1])
                angle = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
                if angle > BORDER_MAX_DIRECTION_DEGREES:
                    continue
                distances = self._sample_distances(metric_part, metric_border)
                coverage = sum(distance <= BORDER_COVERAGE_DISTANCE_KM for distance in distances) / max(len(distances), 1)
                if coverage < BORDER_MIN_COVERAGE or not distances or max(distances) > BORDER_MAX_DISTANCE_KM:
                    continue
                candidates.append({
                    "lineIndex": line_index, "pair": self.pairs[line_index],
                    "metricBorder": metric_border, "start": border_start, "end": border_end,
                    "sourceStart": source_start, "sourceEnd": source_end,
                    "length": metric_part.length,
                    "score": sum(distances) / len(distances) + angle * 0.08,
                })
        if not candidates:
            return [reach], {"reachCount": 0, "lengthKm": 0.0, "coordinates": 0, "pairs": {}}
        accepted: list[dict[str, Any]] = []
        for candidate in sorted(candidates, key=lambda row: (row["score"], -row["length"], row["pair"])):
            if any(
                min(candidate["sourceEnd"], row["sourceEnd"]) - max(candidate["sourceStart"], row["sourceStart"]) > 0.5
                for row in accepted
            ):
                continue
            accepted.append(candidate)
        runs = sorted(accepted, key=lambda row: row["sourceStart"])

        pieces: list[RiverReach] = []
        source_cursor = 0.0
        changed_coordinates = 0
        aligned_length = 0.0
        pair_lengths: dict[str, float] = defaultdict(float)
        for candidate in runs:
            source_start = float(candidate["sourceStart"])
            source_end = float(candidate["sourceEnd"])
            if source_start > source_cursor + 1e-6:
                unaligned = metric_line_substring(source, metric_source, source_cursor, source_start)
                pieces.append(replace(
                    reach, parts=[unaligned], border_pair=None,
                    render_snap=None, terminal_class="",
                ))
            border = self.lines[candidate["lineIndex"]]
            aligned = metric_line_substring(
                border, candidate["metricBorder"], candidate["start"], candidate["end"],
            )
            if len(aligned) >= 2:
                source_slice = metric_line_substring(source, metric_source, source_start, source_end)
                changed_coordinates += sum(
                    1 for old, new in zip(source_slice, aligned) if quantize(old) != quantize(new)
                ) + abs(len(source_slice) - len(aligned))
                pieces.append(replace(
                    reach, parts=[aligned], border_pair=candidate["pair"],
                    render_snap=None, terminal_class="",
                ))
                aligned_length += float(candidate["length"])
                pair_lengths["/".join(candidate["pair"])] += float(candidate["length"])
            source_cursor = source_end
        if source_cursor < metric_source.length - 1e-6:
            unaligned = metric_line_substring(source, metric_source, source_cursor, metric_source.length)
            pieces.append(replace(
                reach, parts=[unaligned], border_pair=None,
                render_snap=None, terminal_class="",
            ))
        pieces = [piece for piece in pieces if piece.parts and len(piece.parts[0]) >= 2]
        if not pieces:
            return [reach], {"reachCount": 0, "lengthKm": 0.0, "coordinates": 0, "pairs": {}}
        pieces[-1].render_snap = reach.render_snap
        pieces[-1].terminal_class = reach.terminal_class
        pieces[-1].original_endpoint = reach.original_endpoint
        return pieces, {
            "reachCount": sum(1 for piece in pieces if piece.border_pair),
            "lengthKm": aligned_length,
            "coordinates": changed_coordinates,
            "pairs": dict(pair_lengths),
        }

    def align_chains(self, chains: Sequence[list[RiverReach]]) -> dict[str, Any]:
        aligned_reaches = aligned_chains = changed_coordinates = 0
        aligned_length = 0.0
        pair_lengths: dict[str, float] = defaultdict(float)
        for chain in chains:
            candidates = [self._candidate(reach) for reach in chain]
            chain_aligned = False
            cursor = 0
            while cursor < len(chain):
                candidate = candidates[cursor]
                if candidate is None:
                    cursor += 1
                    continue
                end = cursor + 1
                while end < len(chain) and candidates[end] is not None and candidates[end]["lineIndex"] == candidate["lineIndex"]:
                    end += 1
                group = candidates[cursor:end]
                group_length = sum(row["length"] for row in group if row)
                distances = [distance for row in group if row for distance in row["distances"]]
                coverage = sum(distance <= BORDER_COVERAGE_DISTANCE_KM for distance in distances) / max(len(distances), 1)
                if group_length >= BORDER_MIN_LENGTH_KM and coverage >= BORDER_MIN_COVERAGE and distances and max(distances) <= BORDER_MAX_DISTANCE_KM:
                    for reach, row in zip(chain[cursor:end], group):
                        border = self.lines[row["lineIndex"]]
                        aligned = metric_line_substring(border, row["metricBorder"], row["start"], row["end"])
                        if len(aligned) < 2:
                            continue
                        changed_coordinates += sum(
                            1 for old, new in zip(reach.parts[0], aligned)
                            if quantize(old) != quantize(new)
                        ) + abs(len(reach.parts[0]) - len(aligned))
                        reach.parts = [aligned]
                        reach.border_pair = row["pair"]
                        reach.render_snap = None
                        aligned_reaches += 1
                        aligned_length += row["length"]
                        pair_lengths["/".join(row["pair"])] += row["length"]
                        chain_aligned = True
                cursor = end
            rebuilt: list[RiverReach] = []
            for reach in chain:
                pieces, partial = self._partial_align_reach(reach)
                rebuilt.extend(pieces)
                if partial["reachCount"]:
                    chain_aligned = True
                    aligned_reaches += int(partial["reachCount"])
                    aligned_length += float(partial["lengthKm"])
                    changed_coordinates += int(partial["coordinates"])
                    for pair_key, length in partial["pairs"].items():
                        pair_lengths[pair_key] += float(length)
            if rebuilt:
                chain[:] = rebuilt
            aligned_chains += int(chain_aligned)
        return {
            "borderAlignedReachCount": aligned_reaches,
            "borderAlignedRiverCount": aligned_chains,
            "borderAlignedLengthKm": round(aligned_length, 1),
            "borderChangedCoordinateCount": changed_coordinates,
            "borderPairLengthsKm": {key: round(value, 1) for key, value in sorted(pair_lengths.items())},
        }


def longest_line(shape_interface: dict[str, Any]) -> LineString | None:
    parts = [LineString(part) for part in line_parts(shape_interface) if len(part) >= 2]
    return max(parts, key=lambda line: line.length) if parts else None


def guided_branch_score(current: LineString, candidate: LineString, reference: LineString) -> tuple[float, float]:
    """Score distance plus upstream directional continuity at a confluence."""
    current_ends = [current.coords[0], current.coords[-1]]
    candidate_ends = [candidate.coords[0], candidate.coords[-1]]
    pairs = [
        (math.hypot(left[0] - right[0], left[1] - right[1]), left_index, right_index)
        for left_index, left in enumerate(current_ends)
        for right_index, right in enumerate(candidate_ends)
    ]
    _gap, current_index, candidate_index = min(pairs)
    confluence = current_ends[current_index]
    downstream_end = current_ends[1 - current_index]
    upstream_end = candidate_ends[1 - candidate_index]

    def unit(dx: float, dy: float) -> tuple[float, float]:
        length = math.hypot(dx, dy) or 1.0
        return dx / length, dy / length

    downstream = unit(downstream_end[0] - confluence[0], downstream_end[1] - confluence[1])
    upstream = unit(upstream_end[0] - confluence[0], upstream_end[1] - confluence[1])
    position = reference.project(Point(confluence))
    delta = min(0.025, max(reference.length * 0.08, 1e-5))
    before = reference.interpolate(max(0.0, position - delta))
    after = reference.interpolate(min(reference.length, position + delta))
    tangent = unit(after.x - before.x, after.y - before.y)
    if tangent[0] * downstream[0] + tangent[1] * downstream[1] < 0:
        tangent = (-tangent[0], -tangent[1])
    desired_upstream = (-tangent[0], -tangent[1])
    alignment = upstream[0] * desired_upstream[0] + upstream[1] * desired_upstream[1]
    return candidate.distance(reference) + max(0.0, 1.0 - alignment) * 0.04, alignment


def read_selected_rivers(
    path: Path, guides: ReferenceGuides, coast_snapper: CoastSnapper,
) -> tuple[list[RiverReach], tuple[float, float, float, float], dict[str, int]]:
    """Select score seeds, close them downstream, and extend guided main stems upstream."""
    reader = shapefile.Reader(str(path), encoding="latin1")
    fields = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "ORD_STRA", "DIS_AV_CMS", "UPLAND_SKM", "ENDORHEIC"]
    metadata: dict[int, RiverMeta] = {}
    upstream_candidates: dict[int, list[tuple[float, float, int]]] = defaultdict(list)
    seed_ids: set[int] = set()
    for record_index, record in enumerate(reader.iterRecords(fields=fields)):
        values = record.as_dict()
        source_id = int(values.get("HYRIV_ID") or 0)
        next_down = int(values.get("NEXT_DOWN") or 0)
        order = int(values.get("ORD_STRA") or 0)
        flow = float(values.get("DIS_AV_CMS") or 0)
        upstream_area = float(values.get("UPLAND_SKM") or 0)
        stage = river_stage(order, flow, upstream_area)
        width = river_width(order, flow)
        metadata[source_id] = RiverMeta(
            source_id, next_down, int(values.get("MAIN_RIV") or 0), order, flow,
            upstream_area, stage, record_index, width, width, bool(int(values.get("ENDORHEIC") or 0)),
        )
        if stage is not None:
            seed_ids.add(source_id)
        if next_down:
            candidates = upstream_candidates[next_down]
            candidate = (upstream_area, flow, source_id)
            if len(candidates) < 8:
                heapq.heappush(candidates, candidate)
            elif candidate > candidates[0]:
                heapq.heapreplace(candidates, candidate)

    # Only extend the headward edge of a substantial selected trunk. Extending
    # every selected reach independently pulls in hundreds of thousands of tiny
    # headwater reaches without improving the visible continuity of main rivers.
    seed_upstream_count = {source_id: 0 for source_id in seed_ids}
    for source_id in seed_ids:
        downstream = metadata[source_id].next_down
        if downstream in seed_ids:
            seed_upstream_count[downstream] += 1
    continuity_roots = [
        source_id for source_id, upstream_count in seed_upstream_count.items()
        if upstream_count == 0
        and metadata[source_id].order >= CONTINUITY_MIN_ORDER
        and metadata[source_id].flow >= CONTINUITY_MIN_FLOW_CMS
        and river_importance(
            metadata[source_id].order,
            metadata[source_id].flow,
            metadata[source_id].upstream_area,
        ) >= CONTINUITY_MIN_SCORE
    ]

    selected_ids = set(seed_ids)
    medium_mainstem_roots = [
        source_id for source_id, row in metadata.items()
        if not row.next_down and row.upstream_area >= MEDIUM_MAINSTEM_MIN_BASIN_KM2
    ]
    medium_added_ids: set[int] = set()
    shape_cache: dict[int, LineString | None] = {}

    def source_line(source_id: int) -> LineString | None:
        if source_id not in shape_cache:
            meta = metadata.get(source_id)
            shape_cache[source_id] = longest_line(reader.shape(meta.record_index).__geo_interface__) if meta else None
        return shape_cache[source_id]

    def guided_upstream(source_id: int) -> int:
        current = metadata[source_id]
        candidates = [metadata[row[2]] for row in upstream_candidates.get(source_id, []) if row[2] in metadata]
        if not candidates:
            return 0
        same_basin = [candidate for candidate in candidates if candidate.main_river == current.main_river]
        topology_pool = same_basin or candidates
        largest_area = max(candidate.upstream_area for candidate in topology_pool)
        guide_candidates = [candidate for candidate in topology_pool if candidate.upstream_area >= largest_area * 0.10]
        current_line = source_line(source_id)
        guide = guides.nearest(current_line) if current_line is not None else None
        if guide:
            reference, _name = guide
            scored: list[tuple[float, float, float, int]] = []
            for candidate in guide_candidates:
                line = source_line(candidate.source_id)
                if line is None:
                    continue
                # Prefer the branch that follows the same named reference line.
                distance, alignment = guided_branch_score(current_line, line, reference)
                scored.append((distance, -alignment, -candidate.upstream_area, -candidate.flow, candidate.source_id))
            if scored:
                best = min(scored)
                # A distant reference must not overrule the Hydro topology fallback.
                if best[0] <= 0.16:
                    return best[4]
        return max(
            topology_pool,
            key=lambda row: (row.main_river == current.main_river, row.upstream_area, row.flow, row.source_id),
        ).source_id

    # A named Natural Earth spine is itself sufficient evidence that the
    # selected Hydro root is a visible main stem. This keeps medium rivers such
    # as the Yalu and Tumen continuous without region-specific exceptions.
    named_roots = []
    continuity_root_set = set(continuity_roots)
    for source_id, upstream_count in seed_upstream_count.items():
        if upstream_count or source_id in continuity_root_set:
            continue
        line = source_line(source_id)
        if line is not None and guides.nearest(line, 0.06):
            named_roots.append(source_id)
    continuity_roots.extend(named_roots)

    stack = list(continuity_roots)
    while stack:
        upstream_id = guided_upstream(stack.pop())
        if upstream_id and upstream_id not in selected_ids:
            selected_ids.add(upstream_id)
            stack.append(upstream_id)

    # A final basin area is available even for unnamed medium rivers. Preserve
    # one representative MAIN_RIV spine from every qualifying terminal to its
    # headwater, using the same global branch rule as named rivers.
    for root_id in medium_mainstem_roots:
        current_id = root_id
        visited_medium: set[int] = set()
        while current_id and current_id not in visited_medium:
            visited_medium.add(current_id)
            if current_id not in selected_ids:
                selected_ids.add(current_id)
                medium_added_ids.add(current_id)
            current_id = guided_upstream(current_id)

    # Visibility seeds and continuity additions are never allowed to end in the
    # middle of land: retain every downstream reach until the Hydro terminal.
    downstream_added = 0
    stack = list(selected_ids)
    while stack:
        downstream_id = metadata[stack.pop()].next_down
        if downstream_id and downstream_id in metadata and downstream_id not in selected_ids:
            selected_ids.add(downstream_id)
            downstream_added += 1
            stack.append(downstream_id)

    selected_upstream_count = {source_id: 0 for source_id in selected_ids}
    for source_id in selected_ids:
        downstream = metadata[source_id].next_down
        if downstream in selected_ids:
            selected_upstream_count[downstream] += 1
    queue = [source_id for source_id, count in selected_upstream_count.items() if count == 0]
    processed = 0
    while queue:
        source_id = queue.pop()
        processed += 1
        current = metadata[source_id]
        downstream_id = current.next_down
        if downstream_id not in selected_ids:
            continue
        downstream = metadata[downstream_id]
        downstream.corrected_width = max(downstream.corrected_width, current.corrected_width)
        selected_upstream_count[downstream_id] -= 1
        if selected_upstream_count[downstream_id] == 0:
            queue.append(downstream_id)
    if processed != len(selected_ids):
        reader.close()
        raise RuntimeError(f"{path.name}: HydroRIVERS 연결망에 순환이 있습니다.")

    selected_by_index = {metadata[source_id].record_index: metadata[source_id] for source_id in selected_ids}
    reaches: list[RiverReach] = []
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for record_index, source_shape in enumerate(reader.iterShapes()):
        meta = selected_by_index.get(record_index)
        if not meta:
            continue
        parts = line_parts(source_shape.__geo_interface__)
        if not parts:
            continue
        for part in parts:
            for x, y in part:
                min_x, min_y, max_x, max_y = min(min_x, x), min(min_y, y), max(max_x, x), max(max_y, y)
        downstream = metadata.get(meta.next_down)
        end_width = downstream.corrected_width if downstream and meta.next_down in selected_ids else meta.corrected_width
        reaches.append(RiverReach(
            meta.source_id, meta.next_down, meta.main_river,
            meta.stage if meta.stage is not None else len(STAGE_MIN_ZOOM) - 1,
            meta.order, meta.flow, meta.upstream_area, meta.corrected_width, end_width, parts, meta.endorheic,
            original_endpoint=tuple(parts[-1][-1]),
        ))
    reader.close()
    terminal_counts: dict[str, int] = defaultdict(int)
    excluded_terminal_records: list[dict[str, Any]] = []
    coast_snapped = 0
    excluded_terminal_ids: set[int] = set()
    for reach in reaches:
        if reach.next_down or not reach.parts or not reach.parts[-1]:
            continue
        if reach.endorheic:
            reach.terminal_class = "endorheic"
            terminal_counts[reach.terminal_class] += 1
            continue
        terminal = coast_snapper.resolve(reach.original_endpoint)
        reach.terminal_class = str(terminal["class"])
        terminal_counts[reach.terminal_class] += 1
        reach.render_snap = terminal.get("snap")
        coast_snapped += int(reach.render_snap is not None)
        if reach.terminal_class == "unresolved-land":
            # HydroRIVERS occasionally marks NEXT_DOWN=0 well inside a rendered
            # landmass even though no source reach continues to the coast.  A
            # synthetic connector longer than the audited 25 km limit would be
            # misleading, so omit that whole upstream logical river and record
            # the malformed source terminal instead of shipping a broken line.
            reach.terminal_class = "excluded-unresolved-source-terminal"
            terminal_counts["unresolved-land"] -= 1
            terminal_counts[reach.terminal_class] += 1
        if reach.terminal_class in {
            "excluded-small-land", "excluded-undisplayed-water",
            "excluded-unresolved-source-terminal",
        }:
            excluded_terminal_ids.add(reach.source_id)
            excluded_terminal_records.append({
                "sourceId": reach.source_id,
                "class": reach.terminal_class,
                "distanceKm": round(float(terminal["distanceKm"]), 3),
                "endpoint": list(reach.original_endpoint),
            })

    if excluded_terminal_ids:
        excluded_ids = set(excluded_terminal_ids)
        upstream_by_downstream: dict[int, list[int]] = defaultdict(list)
        for reach in reaches:
            if reach.next_down:
                upstream_by_downstream[reach.next_down].append(reach.source_id)
        stack = list(excluded_terminal_ids)
        while stack:
            downstream_id = stack.pop()
            for upstream_id in upstream_by_downstream.get(downstream_id, []):
                if upstream_id in excluded_ids:
                    continue
                excluded_ids.add(upstream_id)
                stack.append(upstream_id)
        reaches = [reach for reach in reaches if reach.source_id not in excluded_ids]
    return reaches, (min_x, min_y, max_x, max_y), {
        "seedReachCount": len(seed_ids),
        "continuityRootCount": len(continuity_roots),
        "namedContinuityRootCount": len(named_roots),
        "mediumMainstemRootCount": len(medium_mainstem_roots),
        "mediumMainstemReachCount": len(medium_added_ids),
        "selectedReachCount": len(reaches),
        "continuityReachCount": max(0, len(reaches) - len(seed_ids)),
        "downstreamClosureReachCount": downstream_added,
        "coastSnappedTerminalCount": coast_snapped,
        "terminalClassCounts": dict(terminal_counts),
        "excludedTerminalSources": excluded_terminal_records,
        "excludedTerminalReachCount": len(excluded_ids) if excluded_terminal_ids else 0,
    }


def choose_canonical_upstream(
    downstream: RiverReach, candidates: Sequence[RiverReach], guides: ReferenceGuides,
) -> RiverReach:
    """Choose the branch that keeps a named/main Hydro river continuous."""
    current_line = longest_line(chain_geometry([downstream]))
    same_basin = [candidate for candidate in candidates if candidate.main_river == downstream.main_river]
    topology_pool = same_basin or list(candidates)
    largest_area = max(candidate.upstream_area for candidate in topology_pool)
    guide_candidates = [candidate for candidate in topology_pool if candidate.upstream_area >= largest_area * 0.10]
    guide = guides.nearest(current_line) if current_line is not None else None
    if guide:
        reference, _name = guide
        scored = []
        for candidate in guide_candidates:
            line = longest_line(chain_geometry([candidate]))
            if line is not None:
                distance, alignment = guided_branch_score(current_line, line, reference)
                scored.append((distance, -alignment, -candidate.upstream_area, -candidate.flow, candidate.source_id, candidate))
        if scored:
            best = min(scored, key=lambda row: row[:5])
            if best[0] <= 0.16:
                return best[5]
    return max(
        topology_pool,
        key=lambda row: (
            row.main_river == downstream.main_river,
            row.upstream_area,
            row.flow,
            row.order,
            row.source_id,
        ),
    )


def logical_river_objects(reaches: Iterable[RiverReach], guides: ReferenceGuides) -> list[list[RiverReach]]:
    """Build ordered main-stem and tributary chains before basin-level grouping."""
    selected = {reach.source_id: reach for reach in reaches}
    upstreams: dict[int, list[RiverReach]] = defaultdict(list)
    for reach in selected.values():
        if reach.next_down in selected:
            upstreams[reach.next_down].append(reach)
        elif reach.next_down:
            raise RuntimeError(f"{reach.source_id}: 선택한 강의 하류 {reach.next_down}가 누락되었습니다.")
    canonical = {
        downstream_id: choose_canonical_upstream(selected[downstream_id], rows, guides)
        for downstream_id, rows in upstreams.items() if rows
    }
    pending = {source_id: len(upstreams.get(source_id, [])) for source_id in selected}
    queue = [source_id for source_id, count in pending.items() if count == 0]
    object_for: dict[int, int] = {}
    objects: dict[int, list[RiverReach]] = {}
    visited = 0
    while queue:
        source_id = queue.pop()
        reach = selected[source_id]
        if source_id not in object_for:
            object_for[source_id] = source_id
            objects[source_id] = []
        objects[object_for[source_id]].append(reach)
        visited += 1
        downstream_id = reach.next_down
        if downstream_id not in selected:
            continue
        pending[downstream_id] -= 1
        if pending[downstream_id] == 0:
            canonical_reach = canonical[downstream_id]
            object_for[downstream_id] = object_for[canonical_reach.source_id]
            queue.append(downstream_id)
    if visited != len(selected):
        raise RuntimeError("HydroRIVERS 전 세계 연결망에 순환이 있습니다.")
    return list(objects.values())


def river_system_key(chain: Sequence[RiverReach]) -> int:
    keys = [int(reach.main_river) for reach in chain if int(reach.main_river)]
    if keys:
        return max(set(keys), key=lambda key: (keys.count(key), key))
    terminal = chain[-1] if chain else None
    return int(terminal.source_id if terminal else 0)


def river_systems(chains: Sequence[Sequence[RiverReach]]) -> list[dict[str, Any]]:
    """Group every displayed main stem and tributary by Hydro MAIN_RIV."""
    grouped: dict[int, list[int]] = defaultdict(list)
    for index, chain in enumerate(chains):
        grouped[river_system_key(chain)].append(index)
    systems: list[dict[str, Any]] = []
    for system_id, chain_indexes in sorted(grouped.items()):
        mainstem_index = next((
            index for index in chain_indexes
            if any(reach.source_id == system_id for reach in chains[index])
        ), None)
        if mainstem_index is None:
            mainstem_index = max(
                chain_indexes,
                key=lambda index: (
                    chains[index][-1].upstream_area,
                    chains[index][-1].flow,
                    len(chains[index]),
                ),
            )
        points = [point for index in chain_indexes for reach in chains[index] for part in reach.parts for point in part]
        bounds = geometry_bounds({"type": "MultiLineString", "coordinates": [
            part for index in chain_indexes for reach in chains[index] for part in reach.parts if len(part) >= 2
        ]}) if points else (0.0, 0.0, 0.0, 0.0)
        systems.append({
            "systemId": system_id,
            "chainIndexes": sorted(chain_indexes, key=lambda index: (index != mainstem_index, index)),
            "mainstemIndex": mainstem_index,
            "bounds": bounds,
        })
    return systems


def stage_fragments(chain: Sequence[RiverReach]) -> list[list[RiverReach]]:
    fragments: list[list[RiverReach]] = []
    for reach in chain:
        if (
            not fragments
            or fragments[-1][-1].stage != reach.stage
            or fragments[-1][-1].border_pair != reach.border_pair
        ):
            fragments.append([reach])
        else:
            fragments[-1].append(reach)
    return fragments


def chain_geometry(chain: Sequence[RiverReach]) -> dict[str, Any]:
    parts = []
    for reach in chain:
        for part_index, source_part in enumerate(reach.parts):
            if len(source_part) < 2:
                continue
            part = list(source_part)
            if reach.render_snap is not None and part_index == len(reach.parts) - 1:
                part[-1] = reach.render_snap
            parts.append(part)
    return {"type": "LineString", "coordinates": parts[0]} if len(parts) == 1 else {"type": "MultiLineString", "coordinates": parts}


def normalize_chain_connections(
    chain: Sequence[RiverReach], maximum_gap_km: float = 25.0,
    border_aligner: BorderAligner | None = None,
) -> int:
    """Make every reach/part boundary share one exact Int32 coordinate."""
    changed = 0
    ordered_parts: list[tuple[RiverReach, list[tuple[float, float]]]] = [
        (reach, part) for reach in chain for part in reach.parts if len(part) >= 2
    ]
    for (left_reach, left), (right_reach, right) in zip(ordered_parts, ordered_parts[1:]):
        left_point = left[-1]
        right_point = right[0]
        longitude_delta = normalize_lon(right_point[0] - left_point[0])
        gap_km = math.hypot(
            longitude_delta * 111.32 * math.cos(math.radians((left_point[1] + right_point[1]) / 2)),
            (right_point[1] - left_point[1]) * 110.57,
        )
        if gap_km > maximum_gap_km:
            raise RuntimeError(
                f"Hydro 논리 강 {chain[0].source_id}의 fragment 연결이 {gap_km:.2f}km 끊겨 있습니다."
            )
        if quantize(left_point) == quantize(right_point):
            shared = (quantize(right_point)[0] / MICRO, quantize(right_point)[1] / MICRO)
        elif left_reach.border_pair and right_reach.border_pair:
            if left_reach.border_pair == right_reach.border_pair:
                shared = (quantize(left_point)[0] / MICRO, quantize(left_point)[1] / MICRO)
            else:
                shared = border_aligner.junction_coordinate(
                    left_reach.border_pair, right_reach.border_pair,
                    left_point, right_point, maximum_gap_km,
                ) if border_aligner else None
                if shared is None:
                    raise RuntimeError(
                        f"국경하천 {'/'.join(left_reach.border_pair)}와(과) "
                        f"{'/'.join(right_reach.border_pair)}의 공통 접점을 찾을 수 없습니다."
                    )
        elif left_reach.border_pair and not right_reach.border_pair:
            shared = (quantize(left_point)[0] / MICRO, quantize(left_point)[1] / MICRO)
        else:
            shared = (quantize(right_point)[0] / MICRO, quantize(right_point)[1] / MICRO)
        if quantize(left_point) != quantize(shared) or quantize(right_point) != quantize(shared):
            changed += 1
        left[-1] = shared
        right[0] = shared
    return changed


def part_widths(part: Sequence[Sequence[float]], start_width: float, end_width: float) -> list[float]:
    if len(part) <= 1:
        return [start_width] * len(part)
    cumulative = [0.0]
    for left, right in zip(part, part[1:]):
        mean_lat = math.radians((float(left[1]) + float(right[1])) / 2)
        dx = (float(right[0]) - float(left[0])) * math.cos(mean_lat)
        dy = float(right[1]) - float(left[1])
        cumulative.append(cumulative[-1] + math.hypot(dx, dy))
    total = cumulative[-1]
    if total <= 1e-12:
        return [start_width] * len(part)
    return [start_width + (end_width - start_width) * distance / total for distance in cumulative]


def chain_width_profile(chain: Sequence[RiverReach]) -> list[list[float]]:
    return [
        part_widths(part, reach.width, reach.end_width)
        for reach in chain for part in reach.parts if len(part) >= 2
    ]


def match_ne_river_names(
    chains: Sequence[Sequence[RiverReach]], ne_rivers: Sequence[dict[str, Any]], bounds: tuple[float, float, float, float],
) -> dict[int, str]:
    """Transfer Natural Earth names without rendering its geometry."""
    region_box = box(*bounds)
    project = projector((bounds[1] + bounds[3]) / 2)
    base_lines: list[LineString] = []
    base_names: list[str] = []
    for feature in ne_rivers:
        properties = feature.get("properties") or {}
        name = str(properties.get("name_ko") or properties.get("name_en") or properties.get("name") or "").strip()
        if not name:
            continue
        geometry = shape(feature.get("geometry"))
        if geometry.is_empty or not geometry.intersects(region_box):
            continue
        clipped = geometry.intersection(region_box)
        candidates = [clipped] if isinstance(clipped, LineString) else list(getattr(clipped, "geoms", []))
        for line in candidates:
            if isinstance(line, LineString) and len(line.coords) >= 2:
                base_lines.append(transform(project, line))
                base_names.append(name)
    if not base_lines:
        return {}
    tree = STRtree(base_lines)
    candidates_by_name: dict[str, list[tuple[float, float, float, int]]] = defaultdict(list)
    for chain_index, chain in enumerate(chains):
        projected = [transform(project, LineString(part)) for reach in chain for part in reach.parts if len(part) >= 2]
        if not projected:
            continue
        main = max(projected, key=lambda line: line.length)
        nearest_index = int(tree.nearest(main))
        nearest = base_lines[nearest_index]
        ax, ay = line_direction(main)
        bx, by = line_direction(nearest)
        distance = main.distance(nearest)
        alignment = abs(ax * bx + ay * by)
        if distance <= 4.0 and alignment >= 0.55:
            terminal_basin = max((reach.upstream_area for reach in chain), default=0.0)
            candidates_by_name[base_names[nearest_index]].append((-terminal_basin, distance, -alignment, chain_index))
    matches: dict[int, str] = {}
    for name, candidates in candidates_by_name.items():
        _basin, _distance, _alignment, chain_index = min(candidates)
        matches[chain_index] = name
    return matches


def polygon_geometry(shape_interface: dict[str, Any]) -> dict[str, Any] | None:
    kind = shape_interface.get("type")
    if kind not in ("Polygon", "MultiPolygon"):
        return None
    if kind == "Polygon":
        coords = [[[float(point[0]), float(point[1])] for point in ring] for ring in shape_interface.get("coordinates") or []]
    else:
        coords = [[[[float(point[0]), float(point[1])] for point in ring] for ring in polygon] for polygon in shape_interface.get("coordinates") or []]
    return {"type": kind, "coordinates": coords}


def encode_uvarint(value: int) -> bytes:
    value = int(value)
    output = bytearray()
    while value >= 0x80:
        output.append((value & 0x7F) | 0x80)
        value >>= 7
    output.append(value)
    return bytes(output)


def encode_svarint(value: int) -> bytes:
    return encode_uvarint((value << 1) ^ (value >> 31))


def encode_line(points: Sequence[Sequence[float]]) -> bytes:
    output = bytearray(encode_uvarint(len(points)))
    previous_x = previous_y = 0
    for index, point in enumerate(points):
        x, y = quantize(point)
        if index == 0:
            output.extend(encode_svarint(x)); output.extend(encode_svarint(y))
        else:
            output.extend(encode_svarint(x - previous_x)); output.extend(encode_svarint(y - previous_y))
        previous_x, previous_y = x, y
    return bytes(output)


def encode_geometry(geometry: dict[str, Any]) -> bytes:
    kind = geometry["type"]
    coords = geometry["coordinates"]
    output = bytearray()
    if kind == "LineString":
        output.extend(encode_uvarint(1)); output.extend(encode_line(coords))
    elif kind == "MultiLineString":
        output.extend(encode_uvarint(len(coords)))
        for part in coords:
            output.extend(encode_line(part))
    elif kind == "Polygon":
        output.extend(encode_uvarint(1)); output.extend(encode_uvarint(len(coords)))
        for ring in coords:
            output.extend(encode_line(ring))
    elif kind == "MultiPolygon":
        output.extend(encode_uvarint(len(coords)))
        for polygon in coords:
            output.extend(encode_uvarint(len(polygon)))
            for ring in polygon:
                output.extend(encode_line(ring))
    else:
        raise ValueError(f"지원하지 않는 지오메트리: {kind}")
    return bytes(output)


def encode_width_profile(feature: BuiltFeature) -> bytes:
    if feature.category != "river":
        return b""
    parts = feature.width_profile or []
    geometry_parts = line_parts(feature.geometry)
    if len(parts) != len(geometry_parts):
        raise ValueError(f"{feature.pandolab_id}: 강 너비 part 수가 지오메트리와 다릅니다.")
    output = bytearray(encode_uvarint(len(parts)))
    for widths, points in zip(parts, geometry_parts):
        if len(widths) != len(points):
            raise ValueError(f"{feature.pandolab_id}: 강 너비 꼭짓점 수가 지오메트리와 다릅니다.")
        output.extend(encode_uvarint(len(widths)))
        quantized = [round(max(0.0, min(65.535, width)) * 1000) for width in widths]
        if quantized:
            output.extend(encode_uvarint(quantized[0]))
            for previous, current in zip(quantized, quantized[1:]):
                output.extend(encode_svarint(current - previous))
    return bytes(output)


def encode_source_ids(feature: BuiltFeature) -> bytes:
    """Store Hydro reach membership compactly without dropping provenance."""
    if feature.category != "river" or not feature.source_id:
        return b""
    source_ids = [int(value) for value in feature.source_id.split(",") if value]
    output = bytearray(encode_uvarint(len(source_ids)))
    if source_ids:
        output.extend(encode_uvarint(source_ids[0]))
        for previous, current in zip(source_ids, source_ids[1:]):
            output.extend(encode_svarint(current - previous))
    return bytes(output)


def encode_feature(feature: BuiltFeature) -> bytes:
    payload = encode_geometry(feature.geometry)
    width_payload = encode_width_profile(feature)
    kind = 1 if feature.category == "river" else 2
    geometry_kind = {"LineString": 1, "MultiLineString": 2, "Polygon": 3, "MultiPolygon": 4}[feature.geometry["type"]]
    bounds = [round(value * MICRO) for value in feature.bounds]
    header = struct.pack(
        "<IIBBBBHHf4iII",
        feature.fid, feature.logical_fid, kind, feature.stage, geometry_kind, feature.flags,
        feature.fragment_index, feature.fragment_count, feature.width,
        *bounds, len(payload), len(width_payload),
    )
    return header + payload + width_payload


class PackBuilder:
    def __init__(self, output: Path):
        self.output = output
        self.groups: dict[tuple[int, int, int], list[tuple[int, int, bytes]]] = defaultdict(list)
        self.group_sizes: dict[tuple[int, int, int], int] = defaultdict(int)
        self.memberships: dict[tuple[int, int, int], set[int]] = defaultdict(set)
        self.feature_count = 0
        self.coordinate_count = 0
        self.category_counts = defaultdict(int)
        self.layer_counts = defaultdict(int)
        self.stage_counts = defaultdict(int)
        self.metadata: list[dict[str, Any]] = []

    def add(self, feature: BuiltFeature) -> None:
        width, height = STAGE_GRIDS[feature.stage]
        center_x = (feature.bounds[0] + feature.bounds[2]) / 2
        center_y = (feature.bounds[1] + feature.bounds[3]) / 2
        owner_x = min(width - 1, max(0, int((center_x + 180) / 360 * width)))
        owner_y = min(height - 1, max(0, int((90 - center_y) / 180 * height)))
        key = (feature.stage, owner_x, owner_y)
        encoded = encode_feature(feature)
        self.groups[key].append((feature.fid, feature.logical_fid, encoded))
        self.group_sizes[key] += len(encoded)
        min_x = min(width - 1, max(0, int((feature.bounds[0] + 180) / 360 * width)))
        max_x = min(width - 1, max(0, int((feature.bounds[2] + 180 - 1e-9) / 360 * width)))
        min_y = min(height - 1, max(0, int((90 - feature.bounds[3]) / 180 * height)))
        max_y = min(height - 1, max(0, int((90 - feature.bounds[1] - 1e-9) / 180 * height)))
        for tile_y in range(min_y, max_y + 1):
            for tile_x in range(min_x, max_x + 1):
                self.memberships[(feature.stage, tile_x, tile_y)].add(feature.fid)
        self.feature_count += 1
        self.coordinate_count += geometry_coord_count(feature.geometry)
        self.category_counts[feature.category] += 1
        self.layer_counts[feature.layer_id] += 1
        self.stage_counts[(feature.category, feature.stage)] += 1
        self.metadata.append({
            "fid": feature.fid, "logicalFid": feature.logical_fid,
            "awId": feature.pandolab_id, "name": feature.name,
            "sourceId": feature.source_id, "source": feature.source,
            "layerId": feature.layer_id, "category": feature.category,
            "bounds": [round(value * MICRO) for value in feature.bounds],
            "stage": feature.stage, "flags": feature.flags,
            "fragmentIndex": feature.fragment_index,
            "fragmentCount": feature.fragment_count, "width": feature.width,
            **({"systemId": feature.system_id} if feature.system_id else {}),
            **({"mainstemNameKo": feature.mainstem_name_ko} if feature.mainstem_name_ko else {}),
            **({"role": feature.role} if feature.role else {}),
            **({"aliases": feature.aliases} if feature.aliases else {}),
            **({"tributaryNames": feature.tributary_names} if feature.tributary_names else {}),
            **({"osmRelationIds": feature.osm_relation_ids} if feature.osm_relation_ids else {}),
            **({"terminal": feature.terminal} if feature.terminal else {}),
        })

    def write(self) -> dict[str, Any]:
        if self.output.exists():
            shutil.rmtree(self.output, onerror=remove_readonly)
        packs_dir = self.output / ".packs"
        shards_dir = self.output / "shards"
        packs_dir.mkdir(parents=True)
        shards_dir.mkdir(parents=True)
        fid_pack: dict[int, int] = {}
        logical_packs: dict[int, set[int]] = defaultdict(set)
        pack_rows: list[dict[str, Any]] = []
        pack_id = 0
        for key in sorted(self.groups):
            batch: list[tuple[int, int, bytes]] = []
            batch_size = 0
            for row in self.groups[key]:
                if batch and batch_size + len(row[2]) > PACK_RAW_LIMIT:
                    pack_id = self._write_pack(packs_dir, pack_id, key, batch, fid_pack, logical_packs, pack_rows)
                    batch, batch_size = [], 0
                batch.append(row); batch_size += len(row[2])
            if batch:
                pack_id = self._write_pack(packs_dir, pack_id, key, batch, fid_pack, logical_packs, pack_rows)

        shard_rows: list[dict[str, Any]] = []
        shard_id = 0
        shard_payload = bytearray()
        shard_pack_ids: list[int] = []

        def flush_shard() -> None:
            nonlocal shard_id, shard_payload, shard_pack_ids
            if not shard_pack_ids:
                return
            target = shards_dir / f"s{shard_id}.bin"
            target.write_bytes(shard_payload)
            digest = hashlib.sha256(shard_payload).hexdigest()
            shard_rows.append({"id": shard_id, "url": f"shards/s{shard_id}.bin", "bytes": len(shard_payload), "sha256": digest, "packs": len(shard_pack_ids)})
            shard_id += 1
            shard_payload = bytearray()
            shard_pack_ids = []

        for row in pack_rows:
            compressed = (packs_dir / f"p{row['id']}.bin.gz").read_bytes()
            if shard_pack_ids and len(shard_payload) + len(compressed) > SHARD_GZIP_LIMIT:
                flush_shard()
            row["shard"] = shard_id
            row["offset"] = len(shard_payload)
            row["length"] = len(compressed)
            shard_payload.extend(compressed)
            shard_pack_ids.append(row["id"])
        flush_shard()

        index_tiles: list[tuple[int, int, int, list[int]]] = []
        for (stage, tile_x, tile_y), fids in sorted(self.memberships.items()):
            index_tiles.append((stage, tile_x, tile_y, sorted({fid_pack[fid] for fid in fids})))
        raw_index = bytearray(struct.pack("<4sHHIII", b"AWI4", 4, 0, len(index_tiles), len(logical_packs), len(pack_rows)))
        for stage, tile_x, tile_y, pack_ids in index_tiles:
            raw_index.extend(struct.pack("<BHHH", stage, tile_x, tile_y, len(pack_ids)))
            for owner_pack in pack_ids:
                raw_index.extend(struct.pack("<I", owner_pack))
        for logical_fid, owner_packs in sorted(logical_packs.items()):
            pack_ids = sorted(owner_packs)
            raw_index.extend(struct.pack("<IH", logical_fid, len(pack_ids)))
            for owner_pack in pack_ids:
                raw_index.extend(struct.pack("<I", owner_pack))
        for row in sorted(pack_rows, key=lambda item: item["id"]):
            raw_index.extend(struct.pack("<IHII B", row["id"], row["shard"], row["offset"], row["length"], row["stage"]))
        index_target = self.output / "index.bin.gz"
        index_target.write_bytes(gzip.compress(bytes(raw_index), compresslevel=9, mtime=0))
        index_row = {"url": "index.bin.gz", "bytes": index_target.stat().st_size, "sha256": sha256(index_target), "tileCount": len(index_tiles), "logicalFeatureCount": len(logical_packs)}
        ordered_metadata = sorted(self.metadata, key=lambda item: item["fid"])
        detail_keys = ("sourceId", "source", "aliases", "tributaryNames", "osmRelationIds")
        core_metadata = [
            {key: value for key, value in item.items() if key not in set(detail_keys)}
            for item in ordered_metadata
        ]
        detail_metadata = [
            {"fid": item["fid"], **{key: item[key] for key in detail_keys if key in item}}
            for item in ordered_metadata
        ]
        metadata_core_target = self.output / "metadata-core.json.gz"
        metadata_core_target.write_bytes(gzip.compress(json.dumps({
            "version": 5,
            "features": core_metadata,
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), compresslevel=9, mtime=0))
        metadata_detail_target = self.output / "metadata-detail.json.gz"
        metadata_detail_target.write_bytes(gzip.compress(json.dumps({
            "version": 5,
            "features": detail_metadata,
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), compresslevel=9, mtime=0))
        metadata_row = {
            "version": 5,
            "featureCount": len(self.metadata),
            "core": {"url": "metadata-core.json.gz", "bytes": metadata_core_target.stat().st_size, "sha256": sha256(metadata_core_target)},
            "detail": {"url": "metadata-detail.json.gz", "bytes": metadata_detail_target.stat().st_size, "sha256": sha256(metadata_detail_target), "lazy": True},
        }
        shutil.rmtree(packs_dir, onerror=remove_readonly)
        total_bytes = sum(row["bytes"] for row in shard_rows) + index_row["bytes"] + metadata_row["core"]["bytes"] + metadata_row["detail"]["bytes"]
        if total_bytes > MAX_TOTAL_GZIP_MIB * 1024 * 1024:
            raise RuntimeError(f"압축 수계 자산이 {total_bytes / 1024 / 1024:.1f}MiB로 {MAX_TOTAL_GZIP_MIB:.0f}MiB 상한을 초과했습니다.")
        return {
            "featureCount": self.feature_count,
            "coordinateCount": self.coordinate_count,
            "categoryCounts": dict(self.category_counts),
            "layerCounts": dict(self.layer_counts),
            "stageCounts": {f"{kind}:{stage}": count for (kind, stage), count in self.stage_counts.items()},
            "packCount": len(pack_rows),
            "shardCount": len(shard_rows),
            "indexTileCount": len(index_tiles),
            "logicalFeatureCount": len(logical_packs),
            "compressedBytes": total_bytes,
            "largestPackBytes": max((row["bytes"] for row in pack_rows), default=0),
            "_layout": {"index": index_row, "metadata": metadata_row, "packs": pack_rows, "shards": shard_rows},
        }

    @staticmethod
    def _write_pack(
        directory: Path, pack_id: int, key: tuple[int, int, int], rows: list[tuple[int, int, bytes]],
        fid_pack: dict[int, int], logical_packs: dict[int, set[int]], pack_rows: list[dict[str, Any]],
    ) -> int:
        raw = bytearray(struct.pack("<4sHHI", b"AWHF", PACK_FORMAT_VERSION, key[0], len(rows)))
        for fid, logical_fid, encoded in rows:
            fid_pack[fid] = pack_id
            logical_packs[logical_fid].add(pack_id)
            raw.extend(encoded)
        target = directory / f"p{pack_id}.bin.gz"
        target.write_bytes(gzip.compress(bytes(raw), compresslevel=9, mtime=0))
        pack_rows.append({"id": pack_id, "stage": key[0], "owner": [key[1], key[2]], "features": len(rows), "bytes": target.stat().st_size})
        return pack_id + 1


def match_ne_lake_name(
    geometry: Polygon | MultiPolygon,
    base_tree: STRtree,
    base_polygons: Sequence[Polygon | MultiPolygon],
    base_names: Sequence[str],
) -> str:
    best_score = 0.0
    best_name = ""
    for index in base_tree.query(geometry):
        candidate_index = int(index)
        name = base_names[candidate_index]
        if not name:
            continue
        candidate = base_polygons[candidate_index]
        intersection = geometry.intersection(candidate).area
        coverage = intersection / max(min(geometry.area, candidate.area), 1e-12)
        if coverage > best_score:
            best_score = coverage
            best_name = name
    if best_score >= 0.08:
        return best_name
    nearest_index = int(base_tree.nearest(geometry))
    nearest = base_polygons[nearest_index]
    return base_names[nearest_index] if geometry.centroid.distance(nearest.centroid) <= 0.045 else ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hydrorivers-root", type=Path, action="append", required=True)
    parser.add_argument("--natural-earth-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--drainage-free-raster", type=Path, required=True)
    parser.add_argument("--osm-waterways", type=Path, help="Overpass `out tags bb` waterway relation JSON")
    parser.add_argument("--hydronym-overrides", type=Path, help="한국어 수계명 교정 JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    roots = [path.resolve() for path in args.hydrorivers_root]
    hydro_root = args.natural_earth_root.resolve()
    output = args.output.resolve()
    overrides_path = args.hydronym_overrides.resolve() if args.hydronym_overrides else hydro_root / "hydronym-ko-overrides.json"
    hydronym_overrides = load_hydronym_overrides(overrides_path)
    reviewed_hydronyms = set(hydronym_overrides.values())
    osm_path = args.osm_waterways.resolve() if args.osm_waterways else None
    osm_index = OsmWaterwayIndex(osm_path, hydronym_overrides)
    rivers_base, lakes_base = load_ne_base(hydro_root)
    guides = ReferenceGuides(rivers_base)
    countries_path = hydro_root.parent / "countries-ne-5.1.1.geojson"
    coast_snapper = CoastSnapper(countries_path, lakes_base, args.drainage_free_raster.resolve())
    border_aligner = BorderAligner(countries_path)
    builder = PackBuilder(output)
    fid = 0
    logical_fid = 0
    source_rows: list[dict[str, Any]] = []
    river_names_enriched = 0
    osm_name_matches = 0
    unnamed_system_count = 0
    for code in RIVER_CODES:
        path = find_unique(roots, f"HydroRIVERS_v10_{code}.shp")
        print(f"[{code}] 강과 본류 연결망을 읽는 중입니다.", flush=True)
        reaches, bounds, reach_stats = read_selected_rivers(path, guides, coast_snapper)
        chains = logical_river_objects(reaches, guides)
        matched_names = match_ne_river_names(chains, rivers_base, bounds)
        border_stats = border_aligner.align_chains(chains)
        connection_changed_count = sum(
            normalize_chain_connections(chain, border_aligner=border_aligner) for chain in chains
        )
        for chain in chains:
            terminal_reach = chain[-1]
            chain_ids = {reach.source_id for reach in chain}
            if terminal_reach.next_down and terminal_reach.next_down not in chain_ids:
                terminal_reach.terminal_class = "confluence"
        systems = river_systems(chains)
        print(
            f"[{code}] seed {reach_stats['seedReachCount']:,} + 본류 {reach_stats['continuityReachCount']:,} "
            f"→ {len(systems):,}개 수계/{len(chains):,}개 chain · 국경 정렬 {border_stats['borderAlignedLengthKm']:,.1f}km",
            flush=True,
        )
        region_osm_matches = 0
        region_named_systems = 0
        for system in systems:
            system_id = int(system["systemId"])
            mainstem_index = int(system["mainstemIndex"])
            chain_osm_matches = {
                index: osm_index.match(geometry_bounds(chain_geometry(chains[index])))
                for index in system["chainIndexes"]
            }
            osm_match = chain_osm_matches.get(mainstem_index)
            osm_name = str((osm_match or {}).get("nameKo") or "")
            ne_mainstem_name = normalize_hydronym(matched_names.get(mainstem_index, ""), "river", hydronym_overrides)
            ne_other_names = sorted({
                normalize_hydronym(matched_names.get(index, ""), "river", hydronym_overrides)
                for index in system["chainIndexes"] if matched_names.get(index)
            } - {""})
            osm_names = sorted({
                normalize_hydronym(name, "river", hydronym_overrides)
                for match in chain_osm_matches.values() if match
                for name in match.get("names", [])
            } - {""})
            reviewed_name = next((
                name for name in [ne_mainstem_name, *ne_other_names, normalize_hydronym(osm_name, "river", hydronym_overrides), *osm_names]
                if name in reviewed_hydronyms
            ), "")
            display_name = normalize_hydronym(
                reviewed_name or osm_name or ne_mainstem_name or (ne_other_names[0] if ne_other_names else ""),
                "river", hydronym_overrides,
            )
            if display_name:
                region_named_systems += 1
            else:
                display_name = f"미명명 수계 {system_id}"
                unnamed_system_count += 1
            matched_osm_relations = sorted({
                int(match["id"]) for match in chain_osm_matches.values() if match
            })
            if matched_osm_relations:
                region_osm_matches += 1
                osm_name_matches += 1
            aliases = sorted(set(ne_other_names + osm_names) - {"", display_name})
            tributary_names = sorted(({
                normalize_hydronym(matched_names.get(index, ""), "river", hydronym_overrides)
                for index in system["chainIndexes"] if index != mainstem_index and matched_names.get(index)
            } | {
                normalize_hydronym(str((chain_osm_matches.get(index) or {}).get("nameKo") or ""), "river", hydronym_overrides)
                for index in system["chainIndexes"] if index != mainstem_index
            }) - {"", display_name})
            fragment_rows: list[tuple[int, list[RiverReach]]] = []
            for chain_index in system["chainIndexes"]:
                fragment_rows.extend((chain_index, fragment) for fragment in stage_fragments(chains[chain_index]))
            pandolab_id = f"hydro-system:{system_id}"
            fragment_count = len(fragment_rows)
            for fragment_index, (chain_index, fragment) in enumerate(fragment_rows):
                connection_changed_count += normalize_chain_connections(
                    fragment, border_aligner=border_aligner,
                )
                geometry = chain_geometry(fragment)
                width_profile = chain_width_profile(fragment)
                start = fragment[0]
                border_pair = start.border_pair
                terminal_reach = fragment[-1] if fragment[-1].terminal_class else None
                builder.add(BuiltFeature(
                    fid=fid,
                    logical_fid=logical_fid,
                    pandolab_id=pandolab_id,
                    layer_id="rivers_hydro",
                    category="river",
                    stage=start.stage,
                    name=display_name,
                    source_id=",".join(str(reach.source_id) for reach in fragment),
                    source=(
                        f"HydroRIVERS 1.0 · Natural Earth border {'/'.join(border_pair)}"
                        if border_pair else "HydroRIVERS 1.0 · OSM waterway names" if matched_osm_relations else "HydroRIVERS 1.0"
                    ),
                    width=max((max(widths) for widths in width_profile), default=start.width),
                    geometry=geometry,
                    bounds=geometry_bounds(geometry),
                    width_profile=width_profile,
                    fragment_index=fragment_index,
                    fragment_count=fragment_count,
                    flags=BORDER_FLAG if border_pair else 0,
                    system_id=str(system_id),
                    mainstem_name_ko=display_name,
                    role="mainstem" if chain_index == mainstem_index else "tributary",
                    aliases=aliases if fragment_index == 0 else None,
                    tributary_names=tributary_names if fragment_index == 0 else None,
                    osm_relation_ids=matched_osm_relations if matched_osm_relations and fragment_index == 0 else None,
                    terminal=(
                        {
                            "class": terminal_reach.terminal_class,
                            "sourceEndpoint": list(terminal_reach.original_endpoint or fragment[-1].parts[-1][-1]),
                            "renderEndpoint": list(terminal_reach.render_snap or fragment[-1].parts[-1][-1]),
                        }
                        if terminal_reach else None
                    ),
                )); fid += 1
            logical_fid += 1
        river_names_enriched += region_named_systems
        source_rows.append({
            "datasetCode": code,
            "files": shapefile_source_files(path),
            **reach_stats,
            **border_stats,
            "connectionChangedCount": connection_changed_count,
            "chainCount": len(chains),
            "systemCount": len(systems),
            "nameMatches": region_named_systems,
            "osmMatches": region_osm_matches,
        })
        del reaches, chains, systems

    selected_lakes = 0
    print("[lakes] Natural Earth 1:10m 전 세계 기본 호수를 읽는 중입니다.", flush=True)
    for index, raw_feature in enumerate(lakes_base):
        properties = raw_feature.get("properties") or {}
        geometry_dict = polygon_geometry(raw_feature.get("geometry") or {})
        if not geometry_dict:
            continue
        stage = min_zoom_stage(float(properties.get("min_zoom") or 7.5))
        name = normalize_hydronym(
            str(properties.get("name_ko") or properties.get("name_en") or properties.get("name") or ""),
            "lake", hydronym_overrides,
        )
        source_id = str(properties.get("source_id") or raw_feature.get("id") or index)
        pandolab_id = str(properties.get("pandolab_id") or raw_feature.get("id") or f"lakes_base:{source_id}")
        builder.add(BuiltFeature(
            fid=fid,
            logical_fid=logical_fid,
            pandolab_id=pandolab_id,
            layer_id="lakes_natural_earth",
            category="lake",
            stage=stage,
            name=name,
            source_id=source_id,
            source="Natural Earth 5.0.0 1:10m",
            width=1.0,
            geometry=geometry_dict,
            bounds=geometry_bounds(geometry_dict),
        )); fid += 1; logical_fid += 1; selected_lakes += 1
    stats = builder.write()
    layout = stats.pop("_layout")
    stats["seedReachCount"] = sum(row["seedReachCount"] for row in source_rows)
    stats["continuityRootCount"] = sum(row["continuityRootCount"] for row in source_rows)
    stats["namedContinuityRootCount"] = sum(row["namedContinuityRootCount"] for row in source_rows)
    stats["mediumMainstemRootCount"] = sum(row["mediumMainstemRootCount"] for row in source_rows)
    stats["mediumMainstemReachCount"] = sum(row["mediumMainstemReachCount"] for row in source_rows)
    stats["selectedReachCount"] = sum(row["selectedReachCount"] for row in source_rows)
    stats["continuityReachCount"] = sum(row["continuityReachCount"] for row in source_rows)
    stats["downstreamClosureReachCount"] = sum(row["downstreamClosureReachCount"] for row in source_rows)
    stats["coastSnappedTerminalCount"] = sum(row["coastSnappedTerminalCount"] for row in source_rows)
    terminal_class_counts: dict[str, int] = defaultdict(int)
    for row in source_rows:
        for terminal_class, count in row.get("terminalClassCounts", {}).items():
            terminal_class_counts[terminal_class] += int(count)
    stats["terminalClassCounts"] = dict(terminal_class_counts)
    stats["excludedTerminalReachCount"] = sum(row.get("excludedTerminalReachCount", 0) for row in source_rows)
    stats["borderAlignedReachCount"] = sum(row["borderAlignedReachCount"] for row in source_rows)
    stats["borderAlignedRiverCount"] = sum(row["borderAlignedRiverCount"] for row in source_rows)
    stats["borderAlignedLengthKm"] = round(sum(row["borderAlignedLengthKm"] for row in source_rows), 1)
    stats["borderChangedCoordinateCount"] = sum(row["borderChangedCoordinateCount"] for row in source_rows)
    stats["connectionChangedCount"] = sum(row["connectionChangedCount"] for row in source_rows)
    stats["riverSystemCount"] = sum(row.get("systemCount", 0) for row in source_rows)
    stats["namedRiverSystemCount"] = river_names_enriched
    stats["unnamedRiverSystemCount"] = unnamed_system_count
    stats["osmWaterwayMatchCount"] = osm_name_matches
    manifest = {
        "version": VERSION,
        "schema": "pandolab-water-shards-v5",
        "dataset": "HydroRIVERS 1.0 systems · OSM waterway names · Natural Earth 5.0.0 1:10m lakes · Natural Earth 5.1.1 border alignment",
        "crs": "EPSG:4326",
        "coordinatePolicy": (
            "Hydro source vertices retained outside border-aligned display fragments; "
            "aligned fragments use exact Natural Earth shared-border paths; 1e-6 degree Int32 delta-varint"
        ),
        "selection": {
            "riverFormula": "ORD_STRA + 4*log10(DIS_AV_CMS) - 0.5*log10(UPLAND_SKM)",
            "riverThresholds": list(RIVER_THRESHOLDS),
            "riverWidthFormula": "clamp(0.5 + 0.19*log2(1+DIS_AV_CMS) + 0.06*(ORD_STRA-1), 0.55, 2.6)",
            "riverContinuity": (
                "Natural Earth guided Hydro main-stem path to headwater from selected headward roots; "
                f"with ORD_STRA >= {CONTINUITY_MIN_ORDER} and DIS_AV_CMS >= {CONTINUITY_MIN_FLOW_CMS:g}; "
                f"importance >= {CONTINUITY_MIN_SCORE:g}; "
                f"all terminal basins >= {MEDIUM_MAINSTEM_MIN_BASIN_KM2:g} km2 preserve one main stem; "
                "all selected paths closed downstream to Hydro terminal; added reaches at stage 3"
            ),
            "logicalGrouping": "all displayed MAIN_RIV main-stem and tributary chains share one system ID",
            "mediumMainstemMinBasinKm2": MEDIUM_MAINSTEM_MIN_BASIN_KM2,
            "borderAlignment": {
                "revision": 2,
                "maxDistanceKm": BORDER_MAX_DISTANCE_KM,
                "coverageDistanceKm": BORDER_COVERAGE_DISTANCE_KM,
                "minCoverage": BORDER_MIN_COVERAGE,
                "maxDirectionDegrees": BORDER_MAX_DIRECTION_DEGREES,
                "minLengthKm": BORDER_MIN_LENGTH_KM,
                "scope": "built-in Natural Earth shared country borders only",
            },
            "terminalConnectivity": {
                "revision": 2,
                "classes": ["sea", "lake", "confluence", "endorheic"],
                "maximumCoastExtensionKm": 25,
                "requiresLandContainedConnector": True,
                "unresolvedRenderedLandTerminal": "repair source graph or exclude the affected logical river before packing",
                "undisplayedRasterWaterTerminal": "logical river excluded and reported",
            },
            "lakeSelection": "Natural Earth 5.0.0 1:10m global lakes and reservoirs; no regional supplements",
            "minZoomStages": list(STAGE_MIN_ZOOM),
        },
        "stages": [
            {"id": index, "minZoom": STAGE_MIN_ZOOM[index], "columns": grid[0], "rows": grid[1]}
            for index, grid in enumerate(STAGE_GRIDS)
        ],
        "format": {"pack": 4, "index": 4, "metadata": 5, "fragmentLogicalIds": True, "riverSystemIds": True, "featureFlags": {"borderAligned": BORDER_FLAG}},
        "index": layout["index"],
        "metadata": layout["metadata"],
        "shards": layout["shards"],
        "cache": {
            "name": f"pandolab-water-v0.13.0-{layout['index']['sha256'][:12]}",
            "backgroundDownload": True,
            "rangeRequests": True,
        },
        "layers": [
            {"id": "rivers_hydro", "category": "river", "label": "강 · Hydro", "locked": True},
            {"id": "lakes_natural_earth", "category": "lake", "label": "호수 · Natural Earth", "locked": True},
        ],
        "stats": stats,
        "sources": {
            "naturalEarthNameReference": [
                {"file": "rivers_base.geojson", "sha256": sha256(hydro_root / "rivers_base.geojson")},
                {"file": "lakes_base.geojson", "sha256": sha256(hydro_root / "lakes_base.geojson")},
                {"file": "countries-ne-5.1.1.geojson", "sha256": sha256(countries_path)},
            ],
            "drainageFreeWaterMask": {"file": args.drainage_free_raster.name, "sha256": sha256(args.drainage_free_raster)},
            "hydroRivers": source_rows,
            "naturalEarthLakes": {"file": "lakes_base.geojson", "sha256": sha256(hydro_root / "lakes_base.geojson"), "selected": selected_lakes},
            "osmWaterways": (
                {"file": osm_path.name, "sha256": sha256(osm_path), "matchedSystems": osm_name_matches, "license": "ODbL"}
                if osm_path and osm_path.exists() else {"file": None, "matchedSystems": 0, "license": "ODbL"}
            ),
            "hydronymOverrides": {"file": overrides_path.name, "sha256": sha256(overrides_path)},
            "nameEnrichment": {
                "namedRiverSystems": river_names_enriched,
                "unnamedRiverSystems": unnamed_system_count,
                "osmMatches": osm_name_matches,
            },
        },
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if manifest_path.stat().st_size > 100 * 1024:
        raise RuntimeError("초기 수계 manifest가 100KiB를 초과했습니다.")
    print(json.dumps({"manifest": str(manifest_path), "stats": stats}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
