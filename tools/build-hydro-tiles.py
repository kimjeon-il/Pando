#!/usr/bin/env python3
"""Build AtlasWright v0.12.3 connected Hydro hydrography shards.

HydroRIVERS/HydroLAKES provide the canonical geometry. Natural Earth is used
only to enrich matched feature names. Selected source coordinates are quantized
to 1e-6 degree Int32 and delta-varint encoded without vertex simplification.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import heapq
import json
import math
import os
import shutil
import stat
import struct
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

import shapefile
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import nearest_points, transform, unary_union
from shapely.strtree import STRtree


VERSION = "0.12.3"
PACK_FORMAT_VERSION = 3
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
RIVER_CODES = ("af", "ar", "as", "au", "eu", "gr", "na", "sa", "si")


def remove_readonly(function, path: str, _error: object) -> None:
    """Let repeat builds replace OneDrive Files On-Demand directories on Windows."""
    os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    function(path)


@dataclass
class BuiltFeature:
    fid: int
    logical_fid: int
    aw_id: str
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
        key = str(properties.get("aw_id") or raw.get("id") or f"ne-river-row:{index}")
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
    """Snap only sub-2km Hydro outlet offsets to the canonical land coastline."""

    def __init__(self, countries_path: Path):
        features = json.loads(countries_path.read_text(encoding="utf-8"))["features"]
        coastline = unary_union([shape(feature["geometry"]) for feature in features]).boundary
        self.lines = list(coastline.geoms) if hasattr(coastline, "geoms") else [coastline]
        self.tree = STRtree(self.lines)

    def snap(self, point: tuple[float, float], max_km: float = 2.0) -> tuple[float, float] | None:
        source = Point(point)
        target = nearest_points(source, self.lines[int(self.tree.nearest(source))])[1]
        distance_km = math.hypot(
            (source.x - target.x) * 111.32 * math.cos(math.radians(source.y)),
            (source.y - target.y) * 110.57,
        )
        if 1e-5 < distance_km <= max_km:
            return float(target.x), float(target.y)
        return None


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
        current_line = source_line(source_id)
        guide = guides.nearest(current_line) if current_line is not None else None
        if guide:
            reference, _name = guide
            scored: list[tuple[float, float, float, int]] = []
            for candidate in candidates:
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
            candidates,
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
        ))
    reader.close()
    coast_snapped = 0
    for reach in reaches:
        if reach.next_down or reach.endorheic or not reach.parts or not reach.parts[-1]:
            continue
        reach.render_snap = coast_snapper.snap(reach.parts[-1][-1])
        coast_snapped += int(reach.render_snap is not None)
    return reaches, (min_x, min_y, max_x, max_y), {
        "seedReachCount": len(seed_ids),
        "continuityRootCount": len(continuity_roots),
        "namedContinuityRootCount": len(named_roots),
        "selectedReachCount": len(reaches),
        "continuityReachCount": max(0, len(reaches) - len(seed_ids)),
        "downstreamClosureReachCount": downstream_added,
        "coastSnappedTerminalCount": coast_snapped,
    }


def choose_canonical_upstream(
    downstream: RiverReach, candidates: Sequence[RiverReach], guides: ReferenceGuides,
) -> RiverReach:
    """Choose the branch that keeps a named/main Hydro river continuous."""
    current_line = longest_line(chain_geometry([downstream]))
    guide = guides.nearest(current_line) if current_line is not None else None
    if guide:
        reference, _name = guide
        scored = []
        for candidate in candidates:
            line = longest_line(chain_geometry([candidate]))
            if line is not None:
                distance, alignment = guided_branch_score(current_line, line, reference)
                scored.append((distance, -alignment, -candidate.upstream_area, -candidate.flow, candidate.source_id, candidate))
        if scored:
            best = min(scored, key=lambda row: row[:5])
            if best[0] <= 0.16:
                return best[5]
    return max(
        candidates,
        key=lambda row: (
            row.main_river == downstream.main_river,
            row.upstream_area,
            row.flow,
            row.order,
            row.source_id,
        ),
    )


def logical_river_objects(reaches: Iterable[RiverReach], guides: ReferenceGuides) -> list[list[RiverReach]]:
    """Make one logical object for each main stem; tributaries remain separate."""
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


def stage_fragments(chain: Sequence[RiverReach]) -> list[list[RiverReach]]:
    fragments: list[list[RiverReach]] = []
    for reach in chain:
        if not fragments or fragments[-1][-1].stage != reach.stage:
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
    matches: dict[int, str] = {}
    for chain_index, chain in enumerate(chains):
        projected = [transform(project, LineString(part)) for reach in chain for part in reach.parts if len(part) >= 2]
        if not projected:
            continue
        main = max(projected, key=lambda line: line.length)
        nearest_index = int(tree.nearest(main))
        nearest = base_lines[nearest_index]
        ax, ay = line_direction(main)
        bx, by = line_direction(nearest)
        if main.distance(nearest) <= 4.0 and abs(ax * bx + ay * by) >= 0.55:
            matches[chain_index] = base_names[nearest_index]
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
        raise ValueError(f"{feature.aw_id}: 강 너비 part 수가 지오메트리와 다릅니다.")
    output = bytearray(encode_uvarint(len(parts)))
    for widths, points in zip(parts, geometry_parts):
        if len(widths) != len(points):
            raise ValueError(f"{feature.aw_id}: 강 너비 꼭짓점 수가 지오메트리와 다릅니다.")
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
    source_payload = encode_source_ids(feature)
    names = [feature.aw_id, feature.name, "" if source_payload else feature.source_id, feature.source, feature.layer_id]
    encoded = [value.encode("utf-8") for value in names]
    payload = encode_geometry(feature.geometry)
    width_payload = encode_width_profile(feature)
    kind = 1 if feature.category == "river" else 2
    geometry_kind = {"LineString": 1, "MultiLineString": 2, "Polygon": 3, "MultiPolygon": 4}[feature.geometry["type"]]
    bounds = [round(value * MICRO) for value in feature.bounds]
    header = struct.pack(
        "<IIBBBBHHf4i5HIII",
        feature.fid, feature.logical_fid, kind, feature.stage, geometry_kind, 0,
        feature.fragment_index, feature.fragment_count, feature.width,
        *bounds, *(len(value) for value in encoded), len(source_payload), len(payload), len(width_payload),
    )
    return header + b"".join(encoded) + source_payload + payload + width_payload


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
        raw_index = bytearray(struct.pack("<4sHHIII", b"AWI3", 3, 0, len(index_tiles), len(logical_packs), len(pack_rows)))
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
        shutil.rmtree(packs_dir, onerror=remove_readonly)
        total_bytes = sum(row["bytes"] for row in shard_rows) + index_row["bytes"]
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
            "_layout": {"index": index_row, "packs": pack_rows, "shards": shard_rows},
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
    parser.add_argument("--hydrolakes", type=Path, required=True)
    parser.add_argument("--natural-earth-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    roots = [path.resolve() for path in args.hydrorivers_root]
    hydro_root = args.natural_earth_root.resolve()
    output = args.output.resolve()
    rivers_base, lakes_base = load_ne_base(hydro_root)
    guides = ReferenceGuides(rivers_base)
    coast_snapper = CoastSnapper(hydro_root.parent / "countries-ne-5.1.1.geojson")
    builder = PackBuilder(output)
    fid = 0
    logical_fid = 0
    source_rows: list[dict[str, Any]] = []
    river_names_enriched = 0
    for code in RIVER_CODES:
        path = find_unique(roots, f"HydroRIVERS_v10_{code}.shp")
        print(f"[{code}] 강과 본류 연결망을 읽는 중입니다.", flush=True)
        reaches, bounds, reach_stats = read_selected_rivers(path, guides, coast_snapper)
        chains = logical_river_objects(reaches, guides)
        matched_names = match_ne_river_names(chains, rivers_base, bounds)
        river_names_enriched += len(matched_names)
        print(
            f"[{code}] seed {reach_stats['seedReachCount']:,} + 본류 {reach_stats['continuityReachCount']:,} "
            f"→ {len(chains):,} chain",
            flush=True,
        )
        for chain_index, chain in enumerate(chains):
            fragments = stage_fragments(chain)
            aw_id = f"hydro-river:{chain[0].source_id}"
            for fragment_index, fragment in enumerate(fragments):
                geometry = chain_geometry(fragment)
                width_profile = chain_width_profile(fragment)
                start = fragment[0]
                builder.add(BuiltFeature(
                    fid=fid,
                    logical_fid=logical_fid,
                    aw_id=aw_id,
                    layer_id="rivers_hydro",
                    category="river",
                    stage=start.stage,
                    name=matched_names.get(chain_index, ""),
                    source_id=",".join(str(reach.source_id) for reach in fragment),
                    source="HydroRIVERS 1.0",
                    width=max((max(widths) for widths in width_profile), default=start.width),
                    geometry=geometry,
                    bounds=geometry_bounds(geometry),
                    width_profile=width_profile,
                    fragment_index=fragment_index,
                    fragment_count=len(fragments),
                )); fid += 1
            logical_fid += 1
        source_rows.append({
            "datasetCode": code,
            "files": shapefile_source_files(path),
            **reach_stats,
            "chainCount": len(chains),
            "nameMatches": len(matched_names),
        })
        del reaches, chains

    base_lake_polygons = [shape(feature["geometry"]) for feature in lakes_base]
    base_lake_names = [
        str((feature.get("properties") or {}).get("name_ko") or (feature.get("properties") or {}).get("name_en") or (feature.get("properties") or {}).get("name") or "").strip()
        for feature in lakes_base
    ]
    base_lake_tree = STRtree(base_lake_polygons)
    lake_path = find_unique([args.hydrolakes.resolve()], "HydroLAKES_polys_v10.shp")
    reader = shapefile.Reader(str(lake_path), encoding="cp1252")
    selected_lakes = lake_names_enriched = 0
    print("[lakes] 40㎢ 이상 호수를 읽는 중입니다.", flush=True)
    for index, shape_record in enumerate(reader.iterShapeRecords(fields=["Hylak_id", "Lake_name", "Lake_area", "Shore_len"])):
        record = shape_record.record.as_dict()
        area = float(record.get("Lake_area") or 0)
        stage = lake_stage(area)
        if stage is None:
            continue
        geometry_dict = polygon_geometry(shape_record.shape.__geo_interface__)
        if not geometry_dict:
            continue
        geometry_shape = shape(geometry_dict)
        name = str(record.get("Lake_name") or "").strip()
        if not name:
            name = match_ne_lake_name(geometry_shape, base_lake_tree, base_lake_polygons, base_lake_names)
            lake_names_enriched += int(bool(name))
        source_id = str(record.get("Hylak_id") or index)
        builder.add(BuiltFeature(
            fid=fid,
            logical_fid=logical_fid,
            aw_id=f"hydro-lake:{source_id}",
            layer_id="lakes_hydro",
            category="lake",
            stage=stage,
            name=name,
            source_id=source_id,
            source="HydroLAKES 1.0",
            width=1.0,
            geometry=geometry_dict,
            bounds=geometry_bounds(geometry_dict),
        )); fid += 1; logical_fid += 1; selected_lakes += 1
        if selected_lakes and selected_lakes % 1000 == 0:
            print(f"[lakes] {selected_lakes:,}개 선택", flush=True)
    reader.close()
    stats = builder.write()
    layout = stats.pop("_layout")
    stats["seedReachCount"] = sum(row["seedReachCount"] for row in source_rows)
    stats["continuityRootCount"] = sum(row["continuityRootCount"] for row in source_rows)
    stats["namedContinuityRootCount"] = sum(row["namedContinuityRootCount"] for row in source_rows)
    stats["selectedReachCount"] = sum(row["selectedReachCount"] for row in source_rows)
    stats["continuityReachCount"] = sum(row["continuityReachCount"] for row in source_rows)
    stats["downstreamClosureReachCount"] = sum(row["downstreamClosureReachCount"] for row in source_rows)
    stats["coastSnappedTerminalCount"] = sum(row["coastSnappedTerminalCount"] for row in source_rows)
    manifest = {
        "version": VERSION,
        "schema": "atlaswright-hydro-shards-v3",
        "dataset": "HydroRIVERS/HydroLAKES 1.0 · Natural Earth 5.0.0 name enrichment",
        "crs": "EPSG:4326",
        "coordinatePolicy": "selected Hydro source vertices retained; 1e-6 degree Int32 delta-varint",
        "selection": {
            "riverFormula": "ORD_STRA + 4*log10(DIS_AV_CMS) - 0.5*log10(UPLAND_SKM)",
            "riverThresholds": list(RIVER_THRESHOLDS),
            "riverWidthFormula": "clamp(0.5 + 0.19*log2(1+DIS_AV_CMS) + 0.06*(ORD_STRA-1), 0.55, 2.6)",
            "riverContinuity": (
                "Natural Earth guided Hydro main-stem path to headwater from selected headward roots; "
                f"with ORD_STRA >= {CONTINUITY_MIN_ORDER} and DIS_AV_CMS >= {CONTINUITY_MIN_FLOW_CMS:g}; "
                f"importance >= {CONTINUITY_MIN_SCORE:g}; "
                "all selected paths closed downstream to Hydro terminal; added reaches at stage 3"
            ),
            "lakeAreaThresholdsKm2": list(LAKE_THRESHOLDS_KM2),
            "minZoomStages": list(STAGE_MIN_ZOOM),
        },
        "stages": [
            {"id": index, "minZoom": STAGE_MIN_ZOOM[index], "columns": grid[0], "rows": grid[1]}
            for index, grid in enumerate(STAGE_GRIDS)
        ],
        "format": {"pack": 3, "index": 3, "fragmentLogicalIds": True},
        "index": layout["index"],
        "shards": layout["shards"],
        "cache": {
            "name": f"atlaswright-hydro-v0.12.3-{layout['index']['sha256'][:12]}",
            "backgroundDownload": True,
            "rangeRequests": True,
        },
        "layers": [
            {"id": "rivers_hydro", "category": "river", "label": "강 · Hydro", "locked": True},
            {"id": "lakes_hydro", "category": "lake", "label": "호수 · Hydro", "locked": True},
        ],
        "stats": stats,
        "sources": {
            "naturalEarthNameReference": [
                {"file": "rivers_base.geojson", "sha256": sha256(hydro_root / "rivers_base.geojson")},
                {"file": "lakes_base.geojson", "sha256": sha256(hydro_root / "lakes_base.geojson")},
            ],
            "hydroRivers": source_rows,
            "hydroLakes": {"files": shapefile_source_files(lake_path), "selected": selected_lakes},
            "nameEnrichment": {"rivers": river_names_enriched, "lakes": lake_names_enriched},
        },
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if manifest_path.stat().st_size > 100 * 1024:
        raise RuntimeError("초기 수계 manifest가 100KiB를 초과했습니다.")
    print(json.dumps({"manifest": str(manifest_path), "stats": stats}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
