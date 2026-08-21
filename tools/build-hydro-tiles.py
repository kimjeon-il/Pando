#!/usr/bin/env python3
"""Build AtlasWright v0.12.2 Hydro-only hydrography packs.

HydroRIVERS/HydroLAKES provide the canonical geometry. Natural Earth is used
only to enrich matched feature names. Selected source coordinates are quantized
to 1e-6 degree Int32 and delta-varint encoded without vertex simplification.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
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
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box, shape
from shapely.ops import transform
from shapely.strtree import STRtree


VERSION = "0.12.2"
PACK_FORMAT_VERSION = 2
MICRO = 1_000_000
RIVER_FLOW_WEIGHT = 4.0
RIVER_AREA_WEIGHT = -0.5
RIVER_THRESHOLDS = (14.4744, 12.4307, 11.2137, 10.65)
LAKE_THRESHOLDS_KM2 = (250.0, 100.0, 40.0, 40.0)
STAGE_MIN_ZOOM = (6.0, 6.7, 7.0, 7.5)
STAGE_GRIDS = ((8, 4), (16, 8), (32, 16), (64, 32))
PACK_RAW_LIMIT = 6 * 1024 * 1024
MAX_TOTAL_GZIP_MIB = 40.0
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


def read_selected_rivers(path: Path) -> tuple[list[RiverReach], tuple[float, float, float, float], dict[str, int]]:
    """Select score seeds, then retain each seed's dominant upstream trunk."""
    reader = shapefile.Reader(str(path), encoding="latin1")
    fields = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "ORD_STRA", "DIS_AV_CMS", "UPLAND_SKM"]
    metadata: dict[int, RiverMeta] = {}
    dominant_upstream: dict[int, tuple[float, float, int]] = {}
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
            upstream_area, stage, record_index, width, width,
        )
        if stage is not None:
            seed_ids.add(source_id)
        if next_down:
            candidate = (upstream_area, flow, source_id)
            if candidate > dominant_upstream.get(next_down, (-1.0, -1.0, -1)):
                dominant_upstream[next_down] = candidate

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
    stack = list(continuity_roots)
    while stack:
        upstream = dominant_upstream.get(stack.pop())
        upstream_id = upstream[2] if upstream else 0
        if upstream_id and upstream_id not in selected_ids:
            selected_ids.add(upstream_id)
            stack.append(upstream_id)

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
            meta.order, meta.flow, meta.upstream_area, meta.corrected_width, end_width, parts,
        ))
    reader.close()
    return reaches, (min_x, min_y, max_x, max_y), {
        "seedReachCount": len(seed_ids),
        "continuityRootCount": len(continuity_roots),
        "selectedReachCount": len(reaches),
        "continuityReachCount": max(0, len(reaches) - len(seed_ids)),
    }


def chain_reaches(reaches: Iterable[RiverReach]) -> list[list[RiverReach]]:
    selected = {reach.source_id: reach for reach in reaches}
    upstream_count = {source_id: 0 for source_id in selected}
    for reach in selected.values():
        downstream = selected.get(reach.next_down)
        if downstream and downstream.stage == reach.stage:
            upstream_count[reach.next_down] += 1
    starts = [
        reach for reach in selected.values()
        if upstream_count[reach.source_id] != 1
        or reach.next_down not in selected
        or selected[reach.next_down].stage != reach.stage
    ]
    visited: set[int] = set()
    chains: list[list[RiverReach]] = []
    for start in starts:
        if start.source_id in visited:
            continue
        chain: list[RiverReach] = []
        current: RiverReach | None = start
        while current and current.source_id not in visited:
            visited.add(current.source_id)
            chain.append(current)
            downstream = selected.get(current.next_down)
            if not downstream or downstream.stage != current.stage or upstream_count.get(current.next_down, 0) != 1:
                break
            current = downstream
        chains.append(chain)
    for reach in selected.values():
        if reach.source_id not in visited:
            chains.append([reach])
    return chains


def chain_geometry(chain: Sequence[RiverReach]) -> dict[str, Any]:
    parts = [part for reach in chain for part in reach.parts if len(part) >= 2]
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
        "<IBBBBf4i5HIII",
        feature.fid, kind, feature.stage, geometry_kind, 0, feature.width,
        *bounds, *(len(value) for value in encoded), len(source_payload), len(payload), len(width_payload),
    )
    return header + b"".join(encoded) + source_payload + payload + width_payload


class PackBuilder:
    def __init__(self, output: Path):
        self.output = output
        self.groups: dict[tuple[int, int, int], list[tuple[int, bytes]]] = defaultdict(list)
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
        self.groups[key].append((feature.fid, encoded))
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
        packs_dir = self.output / "packs"
        index_dir = self.output / "index"
        packs_dir.mkdir(parents=True)
        fid_pack: dict[int, int] = {}
        pack_rows: list[dict[str, Any]] = []
        pack_id = 0
        for key in sorted(self.groups):
            batch: list[tuple[int, bytes]] = []
            batch_size = 0
            for row in self.groups[key]:
                if batch and batch_size + len(row[1]) > PACK_RAW_LIMIT:
                    pack_id = self._write_pack(packs_dir, pack_id, key, batch, fid_pack, pack_rows)
                    batch, batch_size = [], 0
                batch.append(row); batch_size += len(row[1])
            if batch:
                pack_id = self._write_pack(packs_dir, pack_id, key, batch, fid_pack, pack_rows)
        index_rows: list[dict[str, Any]] = []
        for (stage, tile_x, tile_y), fids in sorted(self.memberships.items()):
            target = index_dir / str(stage) / f"{tile_x}-{tile_y}.bin.gz"
            target.parent.mkdir(parents=True, exist_ok=True)
            entries = sorted((fid_pack[fid], fid) for fid in fids)
            raw = bytearray(struct.pack("<4sHHI", b"AWIX", 1, stage, len(entries)))
            for owner_pack, fid in entries:
                raw.extend(struct.pack("<II", owner_pack, fid))
            target.write_bytes(gzip.compress(bytes(raw), compresslevel=9, mtime=0))
            index_rows.append({"stage": stage, "x": tile_x, "y": tile_y, "entries": len(entries), "bytes": target.stat().st_size})
        total_bytes = sum(row["bytes"] for row in pack_rows) + sum(row["bytes"] for row in index_rows)
        if total_bytes > MAX_TOTAL_GZIP_MIB * 1024 * 1024:
            raise RuntimeError(f"압축 수계 자산이 {total_bytes / 1024 / 1024:.1f}MiB로 {MAX_TOTAL_GZIP_MIB:.0f}MiB 상한을 초과했습니다.")
        return {
            "featureCount": self.feature_count,
            "coordinateCount": self.coordinate_count,
            "categoryCounts": dict(self.category_counts),
            "layerCounts": dict(self.layer_counts),
            "stageCounts": {f"{kind}:{stage}": count for (kind, stage), count in self.stage_counts.items()},
            "packCount": len(pack_rows),
            "indexTileCount": len(index_rows),
            "compressedBytes": total_bytes,
            "largestPackBytes": max((row["bytes"] for row in pack_rows), default=0),
        }

    @staticmethod
    def _write_pack(directory: Path, pack_id: int, key: tuple[int, int, int], rows: list[tuple[int, bytes]], fid_pack: dict[int, int], pack_rows: list[dict[str, Any]]) -> int:
        raw = bytearray(struct.pack("<4sHHI", b"AWHF", PACK_FORMAT_VERSION, key[0], len(rows)))
        for fid, encoded in rows:
            fid_pack[fid] = pack_id
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
    builder = PackBuilder(output)
    fid = 0
    source_rows: list[dict[str, Any]] = []
    river_names_enriched = 0
    for code in RIVER_CODES:
        path = find_unique(roots, f"HydroRIVERS_v10_{code}.shp")
        print(f"[{code}] 강과 본류 연결망을 읽는 중입니다.", flush=True)
        reaches, bounds, reach_stats = read_selected_rivers(path)
        chains = chain_reaches(reaches)
        matched_names = match_ne_river_names(chains, rivers_base, bounds)
        river_names_enriched += len(matched_names)
        print(
            f"[{code}] seed {reach_stats['seedReachCount']:,} + 본류 {reach_stats['continuityReachCount']:,} "
            f"→ {len(chains):,} chain",
            flush=True,
        )
        for chain_index, chain in enumerate(chains):
            geometry = chain_geometry(chain)
            width_profile = chain_width_profile(chain)
            start = chain[0]
            builder.add(BuiltFeature(
                fid=fid,
                aw_id=f"hydro-river:{code}:{start.source_id}",
                layer_id="rivers_hydro",
                category="river",
                stage=start.stage,
                name=matched_names.get(chain_index, ""),
                source_id=",".join(str(reach.source_id) for reach in chain),
                source="HydroRIVERS 1.0",
                width=max((max(widths) for widths in width_profile), default=start.width),
                geometry=geometry,
                bounds=geometry_bounds(geometry),
                width_profile=width_profile,
            )); fid += 1
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
        )); fid += 1; selected_lakes += 1
        if selected_lakes and selected_lakes % 1000 == 0:
            print(f"[lakes] {selected_lakes:,}개 선택", flush=True)
    reader.close()
    stats = builder.write()
    stats["seedReachCount"] = sum(row["seedReachCount"] for row in source_rows)
    stats["continuityRootCount"] = sum(row["continuityRootCount"] for row in source_rows)
    stats["selectedReachCount"] = sum(row["selectedReachCount"] for row in source_rows)
    stats["continuityReachCount"] = sum(row["continuityReachCount"] for row in source_rows)
    manifest = {
        "version": VERSION,
        "schema": "atlaswright-hydro-packs-v2",
        "dataset": "HydroRIVERS/HydroLAKES 1.0 · Natural Earth 5.0.0 name enrichment",
        "crs": "EPSG:4326",
        "coordinatePolicy": "selected Hydro source vertices retained; 1e-6 degree Int32 delta-varint",
        "selection": {
            "riverFormula": "ORD_STRA + 4*log10(DIS_AV_CMS) - 0.5*log10(UPLAND_SKM)",
            "riverThresholds": list(RIVER_THRESHOLDS),
            "riverWidthFormula": "clamp(0.5 + 0.19*log2(1+DIS_AV_CMS) + 0.06*(ORD_STRA-1), 0.55, 2.6)",
            "riverContinuity": (
                "dominant upstream UPLAND_SKM path to headwater from selected headward roots "
                f"with ORD_STRA >= {CONTINUITY_MIN_ORDER} and DIS_AV_CMS >= {CONTINUITY_MIN_FLOW_CMS:g}; "
                f"importance >= {CONTINUITY_MIN_SCORE:g}; "
                "added reaches at stage 3"
            ),
            "lakeAreaThresholdsKm2": list(LAKE_THRESHOLDS_KM2),
            "minZoomStages": list(STAGE_MIN_ZOOM),
        },
        "stages": [
            {"id": index, "minZoom": STAGE_MIN_ZOOM[index], "columns": grid[0], "rows": grid[1], "indexTemplate": f"index/{index}/{{x}}-{{y}}.bin.gz"}
            for index, grid in enumerate(STAGE_GRIDS)
        ],
        "packTemplate": "packs/p{id}.bin.gz",
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
