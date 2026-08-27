#!/usr/bin/env python3
"""Calibrate HydroRIVERS/HydroLAKES to PandoLab's Natural Earth density.

This is an analysis-only tool. It never writes into ``assets/data``.  The
selected Hydro geometries retain every source vertex; the only object-count
optimization measured here is topology-aware chaining of consecutive river
reaches after selection.

Required packages: pyshp >= 3.0 and shapely >= 2.0.
"""

from __future__ import annotations

import argparse
import bisect
import gzip
import hashlib
import json
import math
import pickle
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import shapefile
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Polygon, box, shape
from shapely.ops import transform, unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree


STAGES = (6.0, 6.7, 7.0, 7.5)
RIVER_WEIGHT_GRID = tuple(
    (flow, area)
    for flow in (1.0, 1.3, 1.7, 2.1, 2.5, 3.0, 3.5, 4.0)
    for area in (-0.5, -0.25, 0.0, 0.25, 0.5, 0.7)
)
LAKE_WEIGHT_GRID = tuple((1.0, shoreline) for shoreline in (-5.0, -4.0, -3.0, -2.5, -2.0, -1.5, -1.0, -0.5, 0.0, 0.5, 1.0))
RIVER_CANDIDATE_FLOOR = 5.0
LAKE_CANDIDATE_AREA_FLOOR = 1.0
CACHE_REVISION = 1
RIVER_DEDUP_REVISION = 4
LAKE_DEDUP_REVISION = 4


@dataclass(frozen=True)
class Region:
    id: str
    label: str
    bbox: tuple[float, float, float, float]
    river_code: str
    river_layer: str
    lake_layer: str
    calibrate: bool = True

    @property
    def center_lat(self) -> float:
        return (self.bbox[1] + self.bbox[3]) / 2


REGIONS = (
    Region("europe", "유럽", (-11.0, 35.0, 31.0, 72.0), "eu", "rivers_europe", "lakes_europe"),
    Region("north-america", "북미", (-130.0, 24.0, -65.0, 55.0), "na", "rivers_north_america", "lakes_north_america"),
    Region("australia", "호주", (112.0, -44.0, 154.0, -10.0), "au", "rivers_australia", "lakes_australia"),
    Region("korea", "한반도", (124.0, 33.0, 132.0, 43.0), "as", "rivers_base", "lakes_base", calibrate=False),
)


@dataclass
class LinearFeature:
    source_id: int | str
    next_down: int
    main_river: int
    order: int
    flow: float
    upstream_area: float
    parts: list[list[tuple[float, float]]]
    source_coordinate_count: int
    length_km: float
    screen_length: float
    duplicate: bool = False
    duplicate_fraction: float = 0.0
    assigned_stage: float | None = None

    def score(self, flow_weight: float, area_weight: float) -> float:
        return (
            self.order
            + flow_weight * math.log10(max(self.flow, 1e-6))
            + area_weight * math.log10(max(self.upstream_area, 1e-6))
        )


@dataclass
class AreaFeature:
    source_id: int | str
    name: str
    area_km2: float
    shoreline_km: float
    geometry: Polygon | MultiPolygon
    source_coordinate_count: int
    screen_area: float
    duplicate: bool = False
    duplicate_fraction: float = 0.0
    assigned_stage: float | None = None

    def score(self, area_weight: float, shoreline_weight: float) -> float:
        return (
            area_weight * math.log10(max(self.area_km2, 1e-6))
            + shoreline_weight * math.log10(max(self.shoreline_km, 1e-6))
        )


@dataclass
class ReferenceStage:
    count: int = 0
    length_km: float = 0.0
    screen_length: float = 0.0
    area_km2: float = 0.0
    screen_area: float = 0.0


@dataclass
class RegionData:
    region: Region
    river_reference_features: list[dict[str, Any]] = field(default_factory=list)
    lake_reference_features: list[dict[str, Any]] = field(default_factory=list)
    base_river_features: list[dict[str, Any]] = field(default_factory=list)
    base_lake_features: list[dict[str, Any]] = field(default_factory=list)
    rivers: list[LinearFeature] = field(default_factory=list)
    lakes: list[AreaFeature] = field(default_factory=list)
    river_targets: dict[float, ReferenceStage] = field(default_factory=dict)
    lake_targets: dict[float, ReferenceStage] = field(default_factory=dict)
    river_baselines: dict[float, ReferenceStage] = field(default_factory=dict)
    lake_baselines: dict[float, ReferenceStage] = field(default_factory=dict)


def cache_key(path: Path, label: str) -> str:
    stat = path.stat()
    raw = f"{CACHE_REVISION}|{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|{label}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def read_cache(path: Path) -> Any | None:
    if not path.exists():
        return None
    with gzip.open(path, "rb") as stream:
        return pickle.load(stream)


def write_cache(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=3) as stream:
        pickle.dump(value, stream, protocol=pickle.HIGHEST_PROTOCOL)


def find_unique(roots: Sequence[Path], filename: str) -> Path:
    matches: list[Path] = []
    for root in roots:
        if root.is_file() and root.name.lower() == filename.lower():
            matches.append(root)
        elif root.is_dir():
            matches.extend(root.rglob(filename))
    unique = sorted({path.resolve() for path in matches})
    if len(unique) != 1:
        raise RuntimeError(f"{filename} 파일이 정확히 하나 필요하지만 {len(unique)}개를 찾았습니다.")
    return unique[0]


def read_geojson(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


def iter_lines(geometry: Any) -> Iterator[LineString]:
    if geometry.is_empty:
        return
    if isinstance(geometry, LineString):
        yield geometry
    elif isinstance(geometry, MultiLineString):
        yield from geometry.geoms
    elif isinstance(geometry, GeometryCollection):
        for child in geometry.geoms:
            yield from iter_lines(child)


def iter_polygons(geometry: Any) -> Iterator[Polygon]:
    if geometry.is_empty:
        return
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, MultiPolygon):
        yield from geometry.geoms
    elif isinstance(geometry, GeometryCollection):
        for child in geometry.geoms:
            yield from iter_polygons(child)


def make_projector(region: Region):
    cos_lat = math.cos(math.radians(region.center_lat))

    def project_xy(x: float, y: float, z: float | None = None) -> tuple[float, float]:
        return x * 111.320 * cos_lat, y * 110.574

    return project_xy


def clipped_geometry(feature: dict[str, Any], bounds: Polygon) -> Any:
    geometry = shape(feature["geometry"])
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    return geometry.intersection(bounds)


def screen_line_length(lines: Iterable[LineString], region: Region, width: int = 1200, height: int = 720) -> float:
    min_x, min_y, max_x, max_y = region.bbox
    sx = width / (max_x - min_x)
    sy = height / (max_y - min_y)
    total = 0.0
    for line in lines:
        coords = list(line.coords)
        for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
            total += math.hypot((x2 - x1) * sx, (y2 - y1) * sy)
    return total


def screen_polygon_area(polygons: Iterable[Polygon], region: Region, width: int = 1200, height: int = 720) -> float:
    min_x, min_y, max_x, max_y = region.bbox
    return sum(polygon.area for polygon in polygons) * width * height / ((max_x - min_x) * (max_y - min_y))


def load_reference(region: Region, hydro_root: Path) -> RegionData:
    bounds = box(*region.bbox)
    projector = make_projector(region)
    river_reference = read_geojson(hydro_root / f"{region.river_layer}.geojson")
    lake_reference = read_geojson(hydro_root / f"{region.lake_layer}.geojson")
    base_rivers = read_geojson(hydro_root / "rivers_base.geojson")
    base_lakes = read_geojson(hydro_root / "lakes_base.geojson")
    data = RegionData(region=region)

    def in_region(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
        selected = []
        for feature in features:
            geometry = shape(feature["geometry"])
            if geometry.bounds[2] >= region.bbox[0] and geometry.bounds[0] <= region.bbox[2] and geometry.bounds[3] >= region.bbox[1] and geometry.bounds[1] <= region.bbox[3]:
                selected.append(feature)
        return selected

    data.river_reference_features = in_region(river_reference)
    data.lake_reference_features = in_region(lake_reference)
    data.base_river_features = in_region(base_rivers)
    data.base_lake_features = in_region(base_lakes)

    def measure_rivers(features: Sequence[dict[str, Any]], stage: float) -> ReferenceStage:
        metric = ReferenceStage()
        for feature in features:
            min_zoom = float(feature.get("properties", {}).get("min_zoom", 99))
            if min_zoom > stage + 1e-9:
                continue
            clipped = clipped_geometry(feature, bounds)
            lines = list(iter_lines(clipped))
            if not lines:
                continue
            metric.count += 1
            metric.length_km += sum(transform(projector, line).length for line in lines)
            metric.screen_length += screen_line_length(lines, region)
        return metric

    def measure_lakes(features: Sequence[dict[str, Any]], stage: float) -> ReferenceStage:
        metric = ReferenceStage()
        for feature in features:
            min_zoom = float(feature.get("properties", {}).get("min_zoom", 99))
            if min_zoom > stage + 1e-9:
                continue
            clipped = clipped_geometry(feature, bounds)
            polygons = list(iter_polygons(clipped))
            if not polygons:
                continue
            metric.count += 1
            metric.area_km2 += sum(transform(projector, polygon).area for polygon in polygons)
            metric.screen_area += screen_polygon_area(polygons, region)
        return metric

    for stage in STAGES:
        river_base = measure_rivers(data.base_river_features, stage)
        lake_base = measure_lakes(data.base_lake_features, stage)
        data.river_baselines[stage] = river_base
        data.lake_baselines[stage] = lake_base
        river_supplement = measure_rivers(data.river_reference_features, stage)
        lake_supplement = measure_lakes(data.lake_reference_features, stage)
        if region.river_layer == "rivers_base":
            data.river_targets[stage] = river_base
        else:
            data.river_targets[stage] = ReferenceStage(
                count=river_base.count + river_supplement.count,
                length_km=river_base.length_km + river_supplement.length_km,
                screen_length=river_base.screen_length + river_supplement.screen_length,
            )
        if region.lake_layer == "lakes_base":
            data.lake_targets[stage] = lake_base
        else:
            data.lake_targets[stage] = ReferenceStage(
                count=lake_base.count + lake_supplement.count,
                area_km2=lake_base.area_km2 + lake_supplement.area_km2,
                screen_area=lake_base.screen_area + lake_supplement.screen_area,
            )
    return data


def shape_parts(shp: shapefile.Shape) -> list[list[tuple[float, float]]]:
    starts = list(shp.parts) + [len(shp.points)]
    return [
        [(float(x), float(y)) for x, y in shp.points[starts[index]:starts[index + 1]]]
        for index in range(len(starts) - 1)
        if starts[index + 1] - starts[index] >= 2
    ]


def clipped_line_parts(parts: list[list[tuple[float, float]]], bounds: Polygon) -> list[list[tuple[float, float]]]:
    result: list[list[tuple[float, float]]] = []
    for points in parts:
        for line in iter_lines(LineString(points).intersection(bounds)):
            coords = [(float(x), float(y)) for x, y in line.coords]
            if len(coords) >= 2:
                result.append(coords)
    return result


def load_hydro_rivers(path: Path, region: Region) -> list[LinearFeature]:
    reader = shapefile.Reader(str(path))
    fields = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "LENGTH_KM", "DIS_AV_CMS", "ORD_STRA", "UPLAND_SKM"]
    bounds = box(*region.bbox)
    projector = make_projector(region)
    result: list[LinearFeature] = []
    scanned = 0
    for shape_record in reader.iterShapeRecords(fields=fields, bbox=region.bbox):
        scanned += 1
        # pyshp returns requested fields in DBF source order, not caller order.
        # Name-based access prevents ORD_STRA/UPLAND_SKM from being swapped.
        values = shape_record.record.as_dict()
        order = int(values.get("ORD_STRA") or 0)
        flow = float(values.get("DIS_AV_CMS") or 0.0)
        upstream = float(values.get("UPLAND_SKM") or 0.0)
        maximum_search_score = max(
            order + flow_weight * math.log10(max(flow, 1e-6)) + area_weight * math.log10(max(upstream, 1e-6))
            for flow_weight, area_weight in RIVER_WEIGHT_GRID
        )
        if maximum_search_score < RIVER_CANDIDATE_FLOOR:
            continue
        source_parts = shape_parts(shape_record.shape)
        parts = clipped_line_parts(source_parts, bounds)
        if not parts:
            continue
        lines = [LineString(points) for points in parts]
        projected = [transform(projector, line) for line in lines]
        result.append(LinearFeature(
            source_id=int(values.get("HYRIV_ID") or 0),
            next_down=int(values.get("NEXT_DOWN") or 0),
            main_river=int(values.get("MAIN_RIV") or 0),
            order=order,
            flow=flow,
            upstream_area=upstream,
            parts=parts,
            source_coordinate_count=sum(len(part) for part in source_parts),
            length_km=sum(line.length for line in projected),
            screen_length=screen_line_length(lines, region),
        ))
    print(f"  HydroRIVERS {region.label}: bbox {scanned:,}개 중 후보 {len(result):,}개")
    return result


def count_polygon_coordinates(geometry: Polygon | MultiPolygon) -> int:
    total = 0
    for polygon in iter_polygons(geometry):
        total += len(polygon.exterior.coords)
        total += sum(len(ring.coords) for ring in polygon.interiors)
    return total


def load_hydro_lakes_multi(path: Path, region_data: Sequence[RegionData]) -> None:
    """Read the 1.4M-feature global lake file once and dispatch by bbox."""
    # HydroLAKES v1.0 contains a few Windows-1252 lake names even though many
    # records are ASCII. Geometry and numeric calibration fields are unaffected.
    reader = shapefile.Reader(str(path), encoding="cp1252", encodingErrors="replace")
    fields = ["Hylak_id", "Lake_name", "Lake_area", "Shore_len"]
    states = [
        (data, box(*data.region.bbox), make_projector(data.region))
        for data in region_data
    ]
    union_bbox = (
        min(data.region.bbox[0] for data in region_data),
        min(data.region.bbox[1] for data in region_data),
        max(data.region.bbox[2] for data in region_data),
        max(data.region.bbox[3] for data in region_data),
    )
    scanned = 0
    accepted = {data.region.id: 0 for data in region_data}
    for shape_record in reader.iterShapeRecords(fields=fields, bbox=union_bbox):
        scanned += 1
        values = shape_record.record.as_dict()
        area = float(values.get("Lake_area") or 0.0)
        if area < LAKE_CANDIDATE_AREA_FLOOR:
            continue
        shape_bbox = shape_record.shape.bbox
        matching = [
            state for state in states
            if shape_bbox[2] >= state[0].region.bbox[0]
            and shape_bbox[0] <= state[0].region.bbox[2]
            and shape_bbox[3] >= state[0].region.bbox[1]
            and shape_bbox[1] <= state[0].region.bbox[3]
        ]
        if not matching:
            continue
        source_geometry = shape(shape_record.shape.__geo_interface__)
        if not source_geometry.is_valid:
            source_geometry = source_geometry.buffer(0)
        source_coordinate_count = count_polygon_coordinates(source_geometry)
        for data, bounds, _projector in matching:
            geometry = source_geometry.intersection(bounds)
            polygons = list(iter_polygons(geometry))
            if not polygons:
                continue
            clipped: Polygon | MultiPolygon = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
            data.lakes.append(AreaFeature(
                source_id=int(values.get("Hylak_id") or 0),
                name=str(values.get("Lake_name") or ""),
                area_km2=area,
                shoreline_km=float(values.get("Shore_len") or 0.0),
                geometry=clipped,
                source_coordinate_count=source_coordinate_count,
                screen_area=screen_polygon_area(polygons, data.region),
            ))
            accepted[data.region.id] += 1
    print(f"  HydroLAKES 전 세계 파일 1회 스캔: bbox 후보 {scanned:,}개")
    for data in region_data:
        print(f"    {data.region.label}: 후보 {accepted[data.region.id]:,}개")


def line_direction(line: LineString) -> tuple[float, float]:
    coords = list(line.coords)
    if len(coords) < 2:
        return (0.0, 0.0)
    best = max(zip(coords, coords[1:]), key=lambda pair: math.dist(pair[0], pair[1]))
    dx = best[1][0] - best[0][0]
    dy = best[1][1] - best[0][1]
    length = math.hypot(dx, dy) or 1.0
    return dx / length, dy / length


def direction_similarity(left: LineString, right: LineString) -> float:
    ax, ay = line_direction(left)
    bx, by = line_direction(right)
    return abs(ax * bx + ay * by)


def reference_lines(features: Sequence[dict[str, Any]], region: Region) -> list[LineString]:
    bounds = box(*region.bbox)
    projector = make_projector(region)
    return [transform(projector, line) for feature in features for line in iter_lines(clipped_geometry(feature, bounds))]


def reference_polygons(features: Sequence[dict[str, Any]], region: Region) -> list[Polygon]:
    bounds = box(*region.bbox)
    projector = make_projector(region)
    return [transform(projector, polygon) for feature in features for polygon in iter_polygons(clipped_geometry(feature, bounds))]


def mark_river_duplicates(data: RegionData, distance_km: float = 4.0) -> None:
    base_lines = reference_lines(data.base_river_features, data.region)
    if not base_lines:
        return
    tree = STRtree(base_lines)
    base_corridor = unary_union(base_lines).buffer(distance_km, cap_style="flat", join_style="round")
    prepared = prep(base_corridor)
    projector = make_projector(data.region)
    for feature in data.rivers:
        projected_parts = [transform(projector, LineString(points)) for points in feature.parts]
        # Exact polygon/line intersections for hundreds of thousands of reaches
        # are needlessly slow. Equidistant samples estimate the same overlap
        # fraction while the STRtree still provides the direction check against
        # actual Natural Earth segments.
        sample_hits = 0
        sample_total = 0
        for line in projected_parts:
            samples = max(5, min(9, math.ceil(line.length / 25.0) + 2))
            for index in range(samples):
                point = line.interpolate(index / max(samples - 1, 1), normalized=True)
                sample_total += 1
                sample_hits += int(prepared.covers(point))
        overlap = sample_hits / max(sample_total, 1)
        feature.duplicate_fraction = overlap
        if overlap < 0.18:
            continue
        main_part = max(projected_parts, key=lambda line: line.length)
        nearest_index = tree.nearest(main_part)
        nearest_line = base_lines[int(nearest_index)]
        best_direction = direction_similarity(main_part, nearest_line) if main_part.distance(nearest_line) <= distance_km else 0.0
        feature.duplicate = overlap >= 0.70 or (overlap >= 0.18 and best_direction >= 0.62)


def mark_lake_duplicates(data: RegionData, distance_km: float = 5.0) -> None:
    base_polygons = reference_polygons(data.base_lake_features, data.region)
    if not base_polygons:
        return
    tree = STRtree(base_polygons)
    projector = make_projector(data.region)
    for feature in data.lakes:
        projected = transform(projector, feature.geometry)
        # Identical lakes must have overlapping surfaces. Querying the polygon
        # envelope avoids constructing tens of thousands of 5 km buffers.
        indices = tree.query(projected)
        best_overlap = 0.0
        duplicate = False
        for index in indices:
            base = base_polygons[int(index)]
            intersection = projected.intersection(base).area
            if intersection <= 0:
                continue
            union_area = projected.area + base.area - intersection
            iou = intersection / union_area if union_area else 0.0
            coverage = intersection / projected.area if projected.area else 0.0
            best_overlap = max(best_overlap, coverage)
            centroid_distance = projected.centroid.distance(base.centroid)
            boundary_distance = projected.boundary.distance(base.boundary)
            if iou >= 0.08 or coverage >= 0.08 or (centroid_distance <= distance_km and boundary_distance <= distance_km * 2):
                duplicate = True
                break
        feature.duplicate_fraction = best_overlap
        feature.duplicate = duplicate


def ratio(value: float, target: float) -> float:
    if target <= 0:
        return 1.0 if value <= 0 else float("inf")
    return value / target


def report_ratio(value: float, target: float) -> float | None:
    return None if target <= 0 else round(value / target, 4)


def log_error(value: float, target: float) -> float:
    return abs(math.log(max(ratio(value, target), 1e-9)))


def candidate_thresholds(scored: dict[str, list[tuple[float, Any]]], points: int = 220) -> list[float]:
    values = sorted(score for rows in scored.values() for score, _ in rows)
    if not values:
        return []
    result = {values[0] - 1e-9, values[-1] + 1e-9}
    for index in range(points + 1):
        result.add(values[min(len(values) - 1, round(index * (len(values) - 1) / points))])
    return sorted(result, reverse=True)


def optimize_thresholds(
    scored: dict[str, list[tuple[float, Any]]],
    targets: dict[str, dict[float, ReferenceStage]],
    baselines: dict[str, dict[float, ReferenceStage]],
    kind: str,
) -> tuple[dict[float, float], float]:
    thresholds = candidate_thresholds(scored)
    if not thresholds:
        return {}, float("inf")
    metric_rows: dict[str, dict[float, tuple[float, float, int]]] = {}
    for region_id, rows in scored.items():
        descending = sorted(rows, key=lambda item: item[0], reverse=True)
        scores = [-score for score, _ in descending]
        first_prefix = [0.0]
        second_prefix = [0.0]
        for _, feature in descending:
            if kind == "river":
                first_prefix.append(first_prefix[-1] + feature.length_km)
                second_prefix.append(second_prefix[-1] + feature.screen_length)
            else:
                first_prefix.append(first_prefix[-1] + feature.screen_area)
                second_prefix.append(second_prefix[-1] + 1.0)
        metric_rows[region_id] = {
            threshold: (
                first_prefix[bisect.bisect_right(scores, -threshold)],
                second_prefix[bisect.bisect_right(scores, -threshold)],
                bisect.bisect_right(scores, -threshold),
            )
            for threshold in thresholds
        }

    selected: dict[float, float] = {}
    total_objective = 0.0
    previous = float("inf")
    for stage in STAGES:
        allowed = [threshold for threshold in thresholds if threshold <= previous + 1e-9]
        best_threshold = allowed[0]
        best_objective = float("inf")
        for threshold in allowed:
            errors = []
            for region_id in scored:
                first, second, _ = metric_rows[region_id][threshold]
                target = targets[region_id][stage]
                baseline = baselines[region_id][stage]
                if kind == "river":
                    first += baseline.length_km
                    second += baseline.screen_length
                    if stage == STAGES[-1]:
                        errors.extend((log_error(first, target.length_km), log_error(second, target.screen_length)))
                    else:
                        errors.append(log_error(second, target.screen_length))
                else:
                    first += baseline.screen_area
                    second += baseline.count
                    if stage == STAGES[-1]:
                        errors.extend((log_error(first, target.screen_area), log_error(second, target.count)))
                    else:
                        errors.append(log_error(first, target.screen_area))
            objective = max(errors, default=0.0) * 0.7 + statistics.fmean(errors or [0.0]) * 0.3
            if objective < best_objective:
                best_objective = objective
                best_threshold = threshold
        selected[stage] = best_threshold
        previous = best_threshold
        total_objective += best_objective
    return selected, total_objective


def optimize_rivers(calibration: Sequence[RegionData]) -> tuple[tuple[float, float], dict[float, float]]:
    best: tuple[float, tuple[float, float], dict[float, float]] | None = None
    targets = {data.region.id: data.river_targets for data in calibration}
    baselines = {data.region.id: data.river_baselines for data in calibration}
    for weights in RIVER_WEIGHT_GRID:
        scored = {
            data.region.id: [(feature.score(*weights), feature) for feature in data.rivers if not feature.duplicate]
            for data in calibration
        }
        thresholds, objective = optimize_thresholds(scored, targets, baselines, "river")
        candidate = (objective, weights, thresholds)
        if best is None or candidate[0] < best[0]:
            best = candidate
    if best is None:
        raise RuntimeError("하천 임계값을 계산할 수 없습니다.")
    return best[1], best[2]


def optimize_lakes(calibration: Sequence[RegionData]) -> tuple[tuple[float, float], dict[float, float]]:
    best: tuple[float, tuple[float, float], dict[float, float]] | None = None
    targets = {data.region.id: data.lake_targets for data in calibration}
    baselines = {data.region.id: data.lake_baselines for data in calibration}
    for weights in LAKE_WEIGHT_GRID:
        scored = {
            data.region.id: [(feature.score(*weights), feature) for feature in data.lakes if not feature.duplicate]
            for data in calibration
        }
        thresholds, objective = optimize_thresholds(scored, targets, baselines, "lake")
        candidate = (objective, weights, thresholds)
        if best is None or candidate[0] < best[0]:
            best = candidate
    if best is None:
        raise RuntimeError("호수 임계값을 계산할 수 없습니다.")
    return best[1], best[2]


def assign_stages(features: Iterable[Any], weights: tuple[float, float], thresholds: dict[float, float]) -> None:
    for feature in features:
        feature.assigned_stage = None
        if feature.duplicate:
            continue
        score = feature.score(*weights)
        for stage in STAGES:
            if score >= thresholds[stage]:
                feature.assigned_stage = stage
                break


def selected_at(features: Iterable[Any], stage: float) -> list[Any]:
    return [feature for feature in features if feature.assigned_stage is not None and feature.assigned_stage <= stage + 1e-9]


def stage_metrics(data: RegionData, kind: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for stage in STAGES:
        target = (data.river_targets if kind == "river" else data.lake_targets)[stage]
        selected = selected_at(data.rivers if kind == "river" else data.lakes, stage)
        if kind == "river":
            baseline = data.river_baselines[stage]
            length = baseline.length_km + sum(feature.length_km for feature in selected)
            pixels = baseline.screen_length + sum(feature.screen_length for feature in selected)
            result[str(stage)] = {
                "targetCount": target.count,
                "selectedCount": baseline.count + len(selected),
                "targetLengthKm": round(target.length_km, 3),
                "selectedLengthKm": round(length, 3),
                "lengthRatio": report_ratio(length, target.length_km),
                "targetPixelLength": round(target.screen_length, 3),
                "selectedPixelLength": round(pixels, 3),
                "pixelRatio": report_ratio(pixels, target.screen_length),
            }
        else:
            baseline = data.lake_baselines[stage]
            screen_area = baseline.screen_area + sum(feature.screen_area for feature in selected)
            result[str(stage)] = {
                "targetCount": target.count,
                "selectedCount": baseline.count + len(selected),
                "countRatio": report_ratio(baseline.count + len(selected), target.count),
                "targetPixelArea": round(target.screen_area, 3),
                "selectedPixelArea": round(screen_area, 3),
                "pixelAreaRatio": report_ratio(screen_area, target.screen_area),
            }
    return result


def residual_overlap(features: Iterable[Any], kind: str) -> float:
    selected = selected_at(features, STAGES[-1])
    if not selected:
        return 0.0
    if kind == "river":
        denominator = sum(feature.length_km for feature in selected)
        numerator = sum(feature.length_km * feature.duplicate_fraction for feature in selected)
    else:
        denominator = sum(feature.screen_area for feature in selected)
        numerator = sum(feature.screen_area * feature.duplicate_fraction for feature in selected)
    return numerator / denominator if denominator else 0.0


def chain_rivers(features: Sequence[LinearFeature]) -> dict[str, int]:
    selected = {int(feature.source_id): feature for feature in features if feature.assigned_stage is not None}
    upstream_count: dict[int, int] = {source_id: 0 for source_id in selected}
    for feature in selected.values():
        if feature.next_down in selected and selected[feature.next_down].assigned_stage == feature.assigned_stage:
            upstream_count[feature.next_down] += 1
    starts = [
        feature for source_id, feature in selected.items()
        if upstream_count[source_id] != 1
        or feature.next_down not in selected
        or selected[feature.next_down].assigned_stage != feature.assigned_stage
    ]
    visited: set[int] = set()
    chains = 0
    for start in starts:
        current = start
        if int(current.source_id) in visited:
            continue
        chains += 1
        while int(current.source_id) not in visited:
            visited.add(int(current.source_id))
            downstream = selected.get(current.next_down)
            if downstream is None or downstream.assigned_stage != current.assigned_stage or upstream_count.get(current.next_down, 0) != 1:
                break
            current = downstream
    chains += len(selected) - len(visited)
    return {
        "selectedReachCount": len(selected),
        "chainCount": chains,
        "sourceCoordinateCount": sum(feature.source_coordinate_count for feature in selected.values()),
        "coordinatesAfterChaining": sum(feature.source_coordinate_count for feature in selected.values()),
    }


def geojson_line_parts(features: Iterable[dict[str, Any]], region: Region) -> list[list[tuple[float, float]]]:
    bounds = box(*region.bbox)
    return [[(float(x), float(y)) for x, y in line.coords] for feature in features for line in iter_lines(clipped_geometry(feature, bounds))]


def geojson_polygons(features: Iterable[dict[str, Any]], region: Region) -> list[Polygon]:
    bounds = box(*region.bbox)
    return [polygon for feature in features for polygon in iter_polygons(clipped_geometry(feature, bounds))]


def write_comparison_png(data: RegionData, output: Path) -> None:
    panel_width = 560
    panel_height = 390
    gap = 16
    top = 48
    total_width = panel_width * 3 + gap * 4
    total_height = panel_height + 120
    canvas = Image.new("RGBA", (total_width, total_height), "#f4f7fb")
    draw = ImageDraw.Draw(canvas)

    def load_font(size: int, bold: bool = False):
        candidates = [
            Path("C:/Windows/Fonts/malgunbd.ttf" if bold else "C:/Windows/Fonts/malgun.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
        for candidate in candidates:
            if candidate.exists():
                return ImageFont.truetype(str(candidate), size)
        return ImageFont.load_default()

    title_font = load_font(18, True)
    label_font = load_font(15, True)
    note_font = load_font(11)
    offsets = [gap, panel_width + gap * 2, panel_width * 2 + gap * 3]
    titles = ["기본 + Natural Earth 보충", "기본 + 필터링 Hydro", "보충 차이 강조"]
    draw.text((gap, 12), f"{data.region.label} · 최종 표시 단계 7.5", fill="#172033", font=title_font)
    for offset, title in zip(offsets, titles):
        draw.rounded_rectangle((offset, top, offset + panel_width, top + panel_height), radius=6, fill="#eaf0f4", outline="#b9c5cf")
        draw.text((offset + 10, 452), title, fill="#253246", font=label_font)

    min_x, min_y, max_x, max_y = data.region.bbox

    def mapped(points: Sequence[tuple[float, float]], offset: int) -> list[tuple[float, float]]:
        return [
            (offset + (x - min_x) / (max_x - min_x) * panel_width, top + (max_y - y) / (max_y - min_y) * panel_height)
            for x, y in points
        ]

    def paint_lines(parts: Iterable[Sequence[tuple[float, float]]], offset: int, color: tuple[int, int, int, int], width: int) -> None:
        overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        layer = ImageDraw.Draw(overlay)
        for points in parts:
            if len(points) >= 2:
                layer.line(mapped(points, offset), fill=color, width=width, joint="curve")
        canvas.alpha_composite(overlay)

    def paint_polygons(polygons: Iterable[Polygon], offset: int, color: tuple[int, int, int, int]) -> None:
        mask = Image.new("L", canvas.size, 0)
        layer = ImageDraw.Draw(mask)
        for polygon in polygons:
            layer.polygon(mapped([(float(x), float(y)) for x, y in polygon.exterior.coords], offset), fill=255)
            for ring in polygon.interiors:
                layer.polygon(mapped([(float(x), float(y)) for x, y in ring.coords], offset), fill=0)
        overlay = Image.new("RGBA", canvas.size, color)
        overlay.putalpha(Image.eval(mask, lambda value: value * color[3] // 255))
        canvas.alpha_composite(overlay)

    base_rivers = geojson_line_parts(data.base_river_features, data.region)
    base_lakes = geojson_polygons(data.base_lake_features, data.region)
    reference_rivers = geojson_line_parts(data.river_reference_features, data.region)
    reference_lakes = geojson_polygons(data.lake_reference_features, data.region)
    hydro_rivers = [part for feature in selected_at(data.rivers, STAGES[-1]) for part in feature.parts]
    hydro_lakes = [polygon for feature in selected_at(data.lakes, STAGES[-1]) for polygon in iter_polygons(feature.geometry)]

    for offset in offsets[:2]:
        paint_polygons(base_lakes, offset, (145, 165, 177, 148))
        paint_lines(base_rivers, offset, (102, 123, 136, 210), 1)
    paint_polygons(reference_lakes, offsets[0], (35, 138, 166, 140))
    paint_lines(reference_rivers, offsets[0], (23, 102, 124, 230), 1)
    paint_polygons(hydro_lakes, offsets[1], (139, 91, 194, 140))
    paint_lines(hydro_rivers, offsets[1], (98, 58, 145, 220), 1)
    paint_polygons(reference_lakes, offsets[2], (22, 166, 182, 122))
    paint_polygons(hydro_lakes, offsets[2], (227, 70, 154, 112))
    paint_lines(reference_rivers, offsets[2], (8, 124, 136, 240), 2)
    paint_lines(hydro_rivers, offsets[2], (224, 41, 132, 225), 1)
    draw = ImageDraw.Draw(canvas)
    draw.text((18, 482), "청록: Natural Earth · 자홍: Hydro · 회색: 양쪽 공통 기본 수계", fill="#59677a", font=note_font)
    canvas.convert("RGB").save(output, "PNG", optimize=True, compress_level=9)


def representative_checks(hydro_root: Path) -> dict[str, Any]:
    """Verify that globally retained Natural Earth base features stay present.

    The named rivers and Great Lakes are already in the base layer, so Hydro
    de-duplication must not add a second copy and must not be credited with
    replacing them. This check deliberately inspects the retained base files.
    """
    rivers = read_geojson(hydro_root / "rivers_base.geojson")
    lakes = read_geojson(hydro_root / "lakes_base.geojson")

    def names(feature: dict[str, Any]) -> str:
        properties = feature.get("properties", {})
        return " ".join(str(properties.get(key, "")) for key in ("name_en", "name_original", "name")).lower()

    checks = {
        "나일강": (rivers, ("nile",), 1),
        "다뉴브강": (rivers, ("danube",), 1),
        "미시시피강": (rivers, ("mississippi",), 1),
        "머리강": (rivers, ("murray",), 1),
        "오대호": (lakes, ("superior", "michigan", "huron", "erie", "ontario"), 5),
    }
    result: dict[str, Any] = {}
    for label, (features, tokens, expected) in checks.items():
        found_tokens = [token for token in tokens if any(token in names(feature) for feature in features)]
        result[label] = {
            "present": len(found_tokens) >= expected,
            "retainedLayer": "Natural Earth base",
            "matchedNames": found_tokens,
            "note": "기본 수계는 유지되고 Hydro의 동일 구간만 제거됩니다.",
        }
    return result


def acceptance(results: dict[str, Any]) -> dict[str, Any]:
    river_final = []
    intermediate_pixels = []
    lake_final = []
    for region_id, metrics in results["regions"].items():
        if region_id == "korea":
            continue
        for stage in STAGES:
            river = metrics["rivers"][str(stage)]
            lake = metrics["lakes"][str(stage)]
            river_error = max(abs(river["lengthRatio"] - 1), abs(river["pixelRatio"] - 1))
            lake_error = max(abs(lake["countRatio"] - 1), abs(lake["pixelAreaRatio"] - 1))
            if stage == STAGES[-1]:
                river_final.append(river_error)
                lake_final.append(lake_error)
            else:
                intermediate_pixels.extend((abs(river["pixelRatio"] - 1), abs(lake["pixelAreaRatio"] - 1)))
    overlap_values = [
        max(metrics["riverBaseOverlapRatio"], metrics["lakeBaseOverlapRatio"])
        for region_id, metrics in results["regions"].items() if region_id != "korea"
    ]
    return {
        "riverFinalWithin15Percent": max(river_final, default=0) <= 0.15,
        "intermediateScreenWithin25Percent": max(intermediate_pixels, default=0) <= 0.25,
        "lakeFinalWithin20Percent": max(lake_final, default=0) <= 0.20,
        "baseOverlapBelow2Percent": max(overlap_values, default=0) < 0.02,
        "representativeFeaturesPresent": all(
            item["present"] is not False for item in results["representativeChecks"].values()
        ),
    }


def format_percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def write_report(results: dict[str, Any], output: Path) -> None:
    passed_all = all(results["acceptance"].values())
    decision = "통과 · 전 세계 교체 후보로 사용할 수 있습니다." if passed_all else "보류 · 현재 제약으로는 전 세계 교체에 사용할 수 없습니다."
    formula_title = "확정된 공통 공식" if passed_all else "최적 탐색값 (합격 기준 미달)"
    acceptance_rows = "\n".join(
        f"- {'통과' if passed else '미통과'}: `{name}`"
        for name, passed in results["acceptance"].items()
    )
    region_sections = []
    def ratio_text(value: float | None) -> str:
        return "—" if value is None else f"{value:.3f}"

    for region_id, metrics in results["regions"].items():
        rows = []
        for stage in STAGES:
            river = metrics["rivers"][str(stage)]
            lake = metrics["lakes"][str(stage)]
            rows.append(
                f"| {stage:.1f} | {river['selectedCount']:,} | {ratio_text(river['lengthRatio'])} | {ratio_text(river['pixelRatio'])} | "
                f"{lake['selectedCount']:,} | {ratio_text(lake['countRatio'])} | {ratio_text(lake['pixelAreaRatio'])} |"
            )
        region_sections.append(
            f"### {metrics['label']}\n\n"
            f"![{metrics['label']} 비교](./{region_id}.png)\n\n"
            "| min_zoom | 표시 강 수 | 강 길이 비 | 강 화면 비 | 표시 호수 수 | 호수 수 비 | 호수 화면 비 |\n"
            "|---:|---:|---:|---:|---:|---:|---:|\n"
            + "\n".join(rows)
            + f"\n\n기본 수계 잔여 중복: 강 {format_percent(metrics['riverBaseOverlapRatio'])}, "
              f"호수 {format_percent(metrics['lakeBaseOverlapRatio'])}.\n"
        )
    river_formula = results["formula"]["rivers"]
    lake_formula = results["formula"]["lakes"]
    chain = results["worldEstimate"]["riverChaining"]
    report = f"""# 판도연구소 수계 자료 캘리브레이션 보고서

이 보고서는 Natural Earth 전 세계 기본 수계를 유지한 상태에서 HydroRIVERS/HydroLAKES 보충 후보를 유럽·북미·호주의 Natural Earth 1:10m 보충 레이어와 같은 화면 밀도로 맞춘 분석 결과입니다. 판도연구소 실행 자산은 교체하지 않았습니다.

## 결론

**{decision}**

{acceptance_rows}

세 기준 지역에 지역별 예외값을 두지 않고 같은 공식과 같은 단계 임계값을 사용했습니다. 비교 비율은 실제 표시 조합인 `(Natural Earth 기본 + Hydro 보충) / (Natural Earth 기본 + Natural Earth 보충)`이며 1.0에 가까울수록 같은 밀도입니다. 미통과 항목이 하나라도 있으면 런타임 자료를 교체하지 않습니다.

## {formula_title}

- 강: `ORD_STRA + {river_formula['flowWeight']:.2f} × log10(DIS_AV_CMS) {river_formula['upstreamAreaWeight']:+.2f} × log10(UPLAND_SKM)`
- 강 임계값: {', '.join(f'{stage:.1f} → {river_formula["thresholds"][str(stage)]:.4f}' for stage in STAGES)}
- 호수: `{lake_formula['areaWeight']:.2f} × log10(Lake_area) + {lake_formula['shorelineWeight']:.2f} × log10(Shore_len)`
- 호수 임계값: {', '.join(f'{stage:.1f} → {lake_formula["thresholds"][str(stage)]:.4f}' for stage in STAGES)}
- 강 중복 판정: 기본 강 4 km 회랑과 중첩 길이, 주방향 유사도를 함께 사용했습니다.
- 호수 중복 판정: 기본 호수와의 IoU, 객체 면적 중첩률, 중심점 및 경계 거리를 함께 사용했습니다.

## 지역별 결과

{''.join(region_sections)}

## 연결 체인과 전 세계 예상치

{'아래 수치는 합격한 공식의 적용 예상치입니다.' if passed_all else '아래 수치는 현재 최적 탐색값을 적용한 참고치이며, 미통과 상태이므로 배포 용량 계획에 사용하면 안 됩니다.'}

- 기준 지역 최종 선택 reach: {chain['selectedReachCount']:,}개
- 연결 후 체인: {chain['chainCount']:,}개 ({chain['objectReductionPercent']:.1f}% 감소)
- 좌표: {chain['sourceCoordinateCount']:,}개 → {chain['coordinatesAfterChaining']:,}개 (삭제·단순화 없음)
- 전 세계 예상 reach: {results['worldEstimate']['riverReachCount']:,}개
- 전 세계 예상 체인: {results['worldEstimate']['riverChainCount']:,}개
- 전 세계 예상 강 좌표: {results['worldEstimate']['riverCoordinateCount']:,}개
- 전 세계 예상 호수 객체: {results['worldEstimate']['lakeFeatureCount']:,}개
- 예상 gzip 압축 용량: 약 {results['worldEstimate']['gzipMiB']:.1f} MiB
- 최종 단계 렌더 부하는 현재 Natural Earth 지역 보충 수계 대비 강 {results['worldEstimate']['riverRenderLoadRatio']:.2f}배, 호수 {results['worldEstimate']['lakeRenderLoadRatio']:.2f}배로 추정합니다.

## 대표 수계 확인

{chr(10).join(f"- {name}: {'확인' if item['present'] else ('후속 전 세계 검증' if item['present'] is None else '누락')}" for name, item in results['representativeChecks'].items())}

## 재현 방법

Python 3.11 이상과 `pyshp>=3.0`, `shapely>=2.0`이 필요합니다. HydroRIVERS 대륙별 Shapefile과 전 세계 HydroLAKES Shapefile을 준비한 뒤 저장소 루트에서 실행합니다.

```powershell
python tools/calibrate-hydro.py `
  --hydrorivers-root <HydroRIVERS-대륙별-파일-폴더> `
  --hydrolakes <HydroLAKES_polys_v10.shp> `
  --natural-earth-root assets/data/hydro `
  --output reports/hydro-calibration
```

`results.json`에는 공식, 단계별 원시 지표, 중복률, 입력 파일 정보가 들어 있습니다. 비교 PNG는 동일 범위·등거리 경위도 화면·동일 선폭으로 생성했습니다. 회색은 양쪽에 공통인 Natural Earth 기본 수계입니다. 한반도는 Natural Earth 지역 보충 자료가 없으므로 현재 전 세계 기본 수계를 왼쪽 기준으로 표시하며 최적화 목적함수에는 넣지 않았습니다.

## 적용 경계

이번 결과는 캘리브레이션 도구와 검증 자료뿐입니다. `assets/data/hydro`, 앱 버전, 내장 수계 잠금·편집용 복사 및 GeoPackage 구조는 변경하지 않았습니다. 실제 교체에 앞서 Natural Earth 지역 보충 자료 자체의 지역별 밀도 차이를 허용할지, 또는 전 세계 공통 절대 밀도 기준을 새로 정할지 결정해야 합니다.
"""
    output.write_text(report, encoding="utf-8")


def estimate_world(data: Sequence[RegionData]) -> dict[str, Any]:
    calibration = [item for item in data if item.region.calibrate]
    river_selected = [feature for item in calibration for feature in selected_at(item.rivers, STAGES[-1])]
    river_candidates = [feature for item in calibration for feature in item.rivers]
    lake_selected = [feature for item in calibration for feature in selected_at(item.lakes, STAGES[-1])]
    lake_candidates = [feature for item in calibration for feature in item.lakes]
    chain = chain_rivers(river_selected)
    chain["objectReductionPercent"] = 100 * (1 - chain["chainCount"] / max(chain["selectedReachCount"], 1))
    river_fraction = len(river_selected) / max(len(river_candidates), 1)
    lake_fraction = len(lake_selected) / max(len(lake_candidates), 1)
    global_river_reaches = round(8_500_000 * river_fraction)
    global_lakes = round(1_427_688 * lake_fraction)
    coords_per_river = sum(feature.source_coordinate_count for feature in river_selected) / max(len(river_selected), 1)
    coords_per_lake = sum(feature.source_coordinate_count for feature in lake_selected) / max(len(lake_selected), 1)
    chain_ratio = chain["chainCount"] / max(chain["selectedReachCount"], 1)
    river_coords = round(global_river_reaches * coords_per_river)
    lake_coords = round(global_lakes * coords_per_lake)
    gzip_bytes = (river_coords + lake_coords) * 8 + (round(global_river_reaches * chain_ratio) + global_lakes) * 64
    current_river_count = 339 + 1325 + 4878
    current_lake_count = 84 + 767 + 1162
    return {
        "riverChaining": chain,
        "riverReachCount": global_river_reaches,
        "riverChainCount": round(global_river_reaches * chain_ratio),
        "riverCoordinateCount": river_coords,
        "lakeFeatureCount": global_lakes,
        "lakeCoordinateCount": lake_coords,
        "gzipMiB": gzip_bytes / 1024 / 1024,
        "riverRenderLoadRatio": chain["chainCount"] / current_river_count,
        "lakeRenderLoadRatio": len(lake_selected) / current_lake_count,
        "method": "Calibration-region selection and chaining ratios extrapolated to published global source counts.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hydrorivers-root", type=Path, action="append", required=True, help="Repeatable root containing continental HydroRIVERS shapefiles")
    parser.add_argument("--hydrolakes", type=Path, required=True, help="HydroLAKES_polys_v10.shp or its parent directory")
    parser.add_argument("--natural-earth-root", type=Path, required=True, help="PandoLab assets/data/hydro directory")
    parser.add_argument("--output", type=Path, required=True, help="Analysis output directory (must not be inside assets/data)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    hydro_root = args.natural_earth_root.resolve()
    output = args.output.resolve()
    assets_data = (hydro_root.parent).resolve()
    if output == assets_data or assets_data in output.parents:
        raise RuntimeError("분석 출력은 assets/data 밖의 디렉터리여야 합니다.")
    output.mkdir(parents=True, exist_ok=True)
    cache_dir = output / ".cache"
    lake_path = find_unique([args.hydrolakes], "HydroLAKES_polys_v10.shp")
    data: list[RegionData] = []
    source_info: dict[str, Any] = {"hydroLakes": {"file": lake_path.name, "size": lake_path.stat().st_size}, "hydroRivers": {}}
    river_paths: dict[str, Path] = {}
    for region in REGIONS:
        print(f"[{region.label}] Natural Earth 기준 자료를 읽는 중입니다.")
        region_data = load_reference(region, hydro_root)
        river_path = find_unique(args.hydrorivers_root, f"HydroRIVERS_v10_{region.river_code}.shp")
        river_paths[region.id] = river_path
        source_info["hydroRivers"][region.river_code] = {"file": river_path.name, "size": river_path.stat().st_size}
        print(f"[{region.label}] Hydro 후보를 읽는 중입니다.")
        river_cache = cache_dir / f"rivers-{region.id}-{cache_key(river_path, 'river-fields-v3-' + region.id)}.pickle.gz"
        cached_rivers = read_cache(river_cache)
        if cached_rivers is None:
            region_data.rivers = load_hydro_rivers(river_path, region)
            write_cache(river_cache, region_data.rivers)
        else:
            region_data.rivers = cached_rivers
            print(f"  HydroRIVERS {region.label}: 분석 캐시 {len(region_data.rivers):,}개")
        data.append(region_data)

    lake_cache = cache_dir / f"lakes-regions-{cache_key(lake_path, 'all-regions')}.pickle.gz"
    cached_lakes = read_cache(lake_cache)
    if cached_lakes is None:
        print("HydroLAKES 전 세계 파일을 한 번 읽어 기준 지역에 배분하는 중입니다.")
        load_hydro_lakes_multi(lake_path, data)
        write_cache(lake_cache, {item.region.id: item.lakes for item in data})
    else:
        for item in data:
            item.lakes = cached_lakes[item.region.id]
            print(f"  HydroLAKES {item.region.label}: 분석 캐시 {len(item.lakes):,}개")
    for region_data in data:
        print(f"[{region_data.region.label}] Natural Earth 기본 수계와 중복을 제거하는 중입니다.")
        base_manifest = hydro_root / "manifest.json"
        river_dedup_label = f"{RIVER_DEDUP_REVISION}-{region_data.region.id}-{base_manifest.stat().st_mtime_ns}"
        lake_dedup_label = f"{LAKE_DEDUP_REVISION}-{region_data.region.id}-{base_manifest.stat().st_mtime_ns}"
        river_dedup_cache = cache_dir / f"dedup-rivers-{river_dedup_label}.pickle.gz"
        lake_dedup_cache = cache_dir / f"dedup-lakes-{lake_dedup_label}.pickle.gz"
        cached_river_dedup = read_cache(river_dedup_cache)
        if cached_river_dedup is None:
            mark_river_duplicates(region_data)
            write_cache(river_dedup_cache, region_data.rivers)
        else:
            region_data.rivers = cached_river_dedup
            print("  강 중복 판정 분석 캐시를 사용했습니다.")
        cached_lake_dedup = read_cache(lake_dedup_cache)
        if cached_lake_dedup is None:
            mark_lake_duplicates(region_data)
            write_cache(lake_dedup_cache, region_data.lakes)
        else:
            region_data.lakes = cached_lake_dedup
            print("  호수 중복 판정 분석 캐시를 사용했습니다.")

    calibration = [item for item in data if item.region.calibrate]
    print("공통 하천 중요도 공식과 단계 임계값을 최적화하는 중입니다.")
    river_weights, river_thresholds = optimize_rivers(calibration)
    print("공통 호수 중요도 공식과 단계 임계값을 최적화하는 중입니다.")
    lake_weights, lake_thresholds = optimize_lakes(calibration)
    for item in data:
        assign_stages(item.rivers, river_weights, river_thresholds)
        assign_stages(item.lakes, lake_weights, lake_thresholds)

    results: dict[str, Any] = {
        "schemaVersion": 1,
        "purpose": "analysis-only; PandoLab runtime hydro assets are not modified",
        "stages": STAGES,
        "formula": {
            "rivers": {
                "flowWeight": river_weights[0],
                "upstreamAreaWeight": river_weights[1],
                "thresholds": {str(stage): river_thresholds[stage] for stage in STAGES},
                "candidateFloor": RIVER_CANDIDATE_FLOOR,
                "candidateFloorBasis": "maximum score across the complete shared weight search grid",
            },
            "lakes": {
                "areaWeight": lake_weights[0],
                "shorelineWeight": lake_weights[1],
                "thresholds": {str(stage): lake_thresholds[stage] for stage in STAGES},
                "candidateAreaFloorKm2": LAKE_CANDIDATE_AREA_FLOOR,
            },
        },
        "searchSpace": {
            "riverWeights": [{"flow": flow, "upstreamArea": area} for flow, area in RIVER_WEIGHT_GRID],
            "lakeWeights": [{"area": area, "shoreline": shoreline} for area, shoreline in LAKE_WEIGHT_GRID],
            "sharedAcrossCalibrationRegions": True,
            "regionalThresholdsAllowed": False,
        },
        "regions": {},
        "sources": source_info,
    }
    for item in data:
        results["regions"][item.region.id] = {
            "label": item.region.label,
            "bbox": item.region.bbox,
            "calibrationRegion": item.region.calibrate,
            "rivers": stage_metrics(item, "river"),
            "lakes": stage_metrics(item, "lake"),
            "riverBaseOverlapRatio": round(residual_overlap(item.rivers, "river"), 6),
            "lakeBaseOverlapRatio": round(residual_overlap(item.lakes, "lake"), 6),
            "riverCandidates": len(item.rivers),
            "lakeCandidates": len(item.lakes),
        }
        print(f"[{item.region.label}] 비교 이미지를 만드는 중입니다.")
        write_comparison_png(item, output / f"{item.region.id}.png")
    results["representativeChecks"] = representative_checks(hydro_root)
    results["worldEstimate"] = estimate_world(data)
    results["acceptance"] = acceptance(results)
    (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    write_report(results, output / "README.md")
    print(json.dumps({"formula": results["formula"], "acceptance": results["acceptance"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"오류: {error}", file=sys.stderr)
        raise
