#!/usr/bin/env python3
"""Build AtlasWright v0.12.1 performance-first hydrography packs.

The builder keeps Natural Earth base hydrography, replaces the three regional
supplements with one globally filtered HydroRIVERS/HydroLAKES supplement, and
writes feature packs plus small EPSG:4326 spatial-index tiles. Selected source
coordinates are quantized to 1e-6 degree Int32 and delta-varint encoded without
vertex simplification.
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
from shapely.ops import transform, unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree


VERSION = "0.12.1"
MICRO = 1_000_000
RIVER_FLOW_WEIGHT = 4.0
RIVER_AREA_WEIGHT = -0.5
RIVER_THRESHOLDS = (14.4744, 12.4307, 11.2137, 10.7957)
LAKE_THRESHOLDS_KM2 = (250.0, 100.0, 50.0, 50.0)
STAGE_MIN_ZOOM = (6.0, 6.7, 7.0, 7.5)
STAGE_GRIDS = ((8, 4), (16, 8), (32, 16), (64, 32))
PACK_RAW_LIMIT = 6 * 1024 * 1024
MAX_TOTAL_GZIP_MIB = 180.0
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


@dataclass
class RiverReach:
    source_id: int
    next_down: int
    main_river: int
    stage: int
    parts: list[list[tuple[float, float]]]
    duplicate: bool = False
    duplicate_fraction: float = 0.0


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


def river_stage(order: int, flow: float, upstream_area: float) -> int | None:
    score = order + RIVER_FLOW_WEIGHT * math.log10(max(flow, 1e-6)) + RIVER_AREA_WEIGHT * math.log10(max(upstream_area, 1e-6))
    for stage, threshold in enumerate(RIVER_THRESHOLDS):
        if score >= threshold:
            return stage
    return None


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


def mark_river_duplicates(reaches: list[RiverReach], ne_rivers: list[dict[str, Any]], bounds: tuple[float, float, float, float]) -> None:
    region_box = box(*bounds)
    project = projector((bounds[1] + bounds[3]) / 2)
    base_lines: list[LineString] = []
    for feature in ne_rivers:
        geometry = shape(feature.get("geometry"))
        if not geometry.is_empty and geometry.intersects(region_box):
            clipped = geometry.intersection(region_box)
            candidates = [clipped] if isinstance(clipped, LineString) else list(getattr(clipped, "geoms", []))
            base_lines.extend(transform(project, line) for line in candidates if isinstance(line, LineString) and len(line.coords) >= 2)
    if not base_lines:
        return
    tree = STRtree(base_lines)
    corridor = prep(unary_union(base_lines).buffer(4.0, cap_style="flat", join_style="round"))
    for reach in reaches:
        projected = [transform(project, LineString(part)) for part in reach.parts if len(part) >= 2]
        if not projected:
            continue
        hits = total = 0
        for line in projected:
            samples = max(5, min(9, math.ceil(line.length / 25.0) + 2))
            for index in range(samples):
                total += 1
                hits += int(corridor.covers(line.interpolate(index / max(samples - 1, 1), normalized=True)))
        overlap = hits / max(total, 1)
        reach.duplicate_fraction = overlap
        if overlap < 0.18:
            continue
        main = max(projected, key=lambda item: item.length)
        nearest = base_lines[int(tree.nearest(main))]
        ax, ay = line_direction(main)
        bx, by = line_direction(nearest)
        direction = abs(ax * bx + ay * by) if main.distance(nearest) <= 4.0 else 0.0
        reach.duplicate = overlap >= 0.70 or (overlap >= 0.18 and direction >= 0.62)


def read_selected_rivers(path: Path) -> tuple[list[RiverReach], tuple[float, float, float, float]]:
    reaches: list[RiverReach] = []
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    reader = shapefile.Reader(str(path), encoding="latin1")
    for shape_record in reader.iterShapeRecords(fields=["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "ORD_STRA", "DIS_AV_CMS", "UPLAND_SKM"]):
        record = shape_record.record.as_dict()
        stage = river_stage(int(record.get("ORD_STRA") or 0), float(record.get("DIS_AV_CMS") or 0), float(record.get("UPLAND_SKM") or 0))
        if stage is None:
            continue
        geometry = shape_record.shape.__geo_interface__
        parts = line_parts(geometry)
        if not parts:
            continue
        for part in parts:
            for x, y in part:
                min_x, min_y, max_x, max_y = min(min_x, x), min(min_y, y), max(max_x, x), max(max_y, y)
        reaches.append(RiverReach(
            int(record.get("HYRIV_ID") or 0), int(record.get("NEXT_DOWN") or 0), int(record.get("MAIN_RIV") or 0), stage, parts,
        ))
    reader.close()
    return reaches, (min_x, min_y, max_x, max_y)


def chain_reaches(reaches: Iterable[RiverReach]) -> list[list[RiverReach]]:
    selected = {reach.source_id: reach for reach in reaches if not reach.duplicate}
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


def encode_feature(feature: BuiltFeature) -> bytes:
    names = [feature.aw_id, feature.name, feature.source_id, feature.source, feature.layer_id]
    encoded = [value.encode("utf-8") for value in names]
    payload = encode_geometry(feature.geometry)
    kind = 1 if feature.category == "river" else 2
    geometry_kind = {"LineString": 1, "MultiLineString": 2, "Polygon": 3, "MultiPolygon": 4}[feature.geometry["type"]]
    bounds = [round(value * MICRO) for value in feature.bounds]
    header = struct.pack(
        "<IBBBBf4i5HI",
        feature.fid, kind, feature.stage, geometry_kind, 0, feature.width,
        *bounds, *(len(value) for value in encoded), len(payload),
    )
    return header + b"".join(encoded) + payload


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
        raw = bytearray(struct.pack("<4sHHI", b"AWHF", 1, key[0], len(rows)))
        for fid, encoded in rows:
            fid_pack[fid] = pack_id
            raw.extend(encoded)
        target = directory / f"p{pack_id}.bin.gz"
        target.write_bytes(gzip.compress(bytes(raw), compresslevel=9, mtime=0))
        pack_rows.append({"id": pack_id, "stage": key[0], "owner": [key[1], key[2]], "features": len(rows), "bytes": target.stat().st_size})
        return pack_id + 1


def make_ne_feature(raw: dict[str, Any], fid: int, category: str) -> BuiltFeature:
    properties = raw.get("properties") or {}
    geometry = raw.get("geometry")
    aw_id = str(properties.get("aw_id") or raw.get("id") or f"ne-{category}-{fid}")
    return BuiltFeature(
        fid=fid,
        aw_id=aw_id,
        layer_id=f"{category}s_base",
        category=category,
        stage=min_zoom_stage(float(properties.get("min_zoom") or properties.get("scale_rank") or 7.5)),
        name=str(properties.get("name_ko") or properties.get("name_en") or properties.get("name") or ""),
        source_id=str(properties.get("source_id") or raw.get("id") or fid),
        source=str(properties.get("source") or "Natural Earth 5.0.0 1:10m"),
        width=max(0.65, min(3.2, float(properties.get("stroke_width") or 0.8))),
        geometry=geometry,
        bounds=geometry_bounds(geometry),
    )


def lake_duplicate(geometry: Polygon | MultiPolygon, base_tree: STRtree, base_polygons: list[Polygon | MultiPolygon]) -> tuple[bool, float]:
    best = 0.0
    for index in base_tree.query(geometry):
        candidate = base_polygons[int(index)]
        intersection = geometry.intersection(candidate).area
        if intersection <= 0:
            continue
        coverage = intersection / max(geometry.area, 1e-12)
        union = geometry.area + candidate.area - intersection
        iou = intersection / max(union, 1e-12)
        best = max(best, coverage)
        if coverage >= 0.08 or iou >= 0.08 or geometry.centroid.distance(candidate.centroid) <= 0.045:
            return True, best
    return False, best


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
    for raw in rivers_base:
        builder.add(make_ne_feature(raw, fid, "river")); fid += 1
    for raw in lakes_base:
        builder.add(make_ne_feature(raw, fid, "lake")); fid += 1

    source_rows: list[dict[str, Any]] = []
    residual_river_length = duplicate_river_length = 0.0
    for code in RIVER_CODES:
        path = find_unique(roots, f"HydroRIVERS_v10_{code}.shp")
        print(f"[{code}] 성능 기준 강을 읽는 중입니다.", flush=True)
        reaches, bounds = read_selected_rivers(path)
        mark_river_duplicates(reaches, rivers_base, bounds)
        for reach in reaches:
            if reach.duplicate:
                continue
            length = sum(LineString(part).length for part in reach.parts if len(part) >= 2)
            residual_river_length += length * reach.duplicate_fraction
            duplicate_river_length += length
        chains = chain_reaches(reaches)
        print(f"[{code}] {len(reaches):,} reach → {len(chains):,} chain", flush=True)
        for chain in chains:
            geometry = chain_geometry(chain)
            start = chain[0]
            builder.add(BuiltFeature(
                fid=fid,
                aw_id=f"hydro-river:{code}:{start.source_id}",
                layer_id="rivers_hydro",
                category="river",
                stage=start.stage,
                name="",
                source_id=",".join(str(reach.source_id) for reach in chain),
                source="HydroRIVERS 1.0",
                width=max(0.7, 2.1 - start.stage * 0.35),
                geometry=geometry,
                bounds=geometry_bounds(geometry),
            )); fid += 1
        source_rows.append({"datasetCode": code, "files": shapefile_source_files(path), "selectedReachCount": len(reaches), "chainCount": len(chains)})
        del reaches, chains

    base_lake_polygons = [shape(feature["geometry"]) for feature in lakes_base]
    base_lake_tree = STRtree(base_lake_polygons)
    lake_path = find_unique([args.hydrolakes.resolve()], "HydroLAKES_polys_v10.shp")
    reader = shapefile.Reader(str(lake_path), encoding="cp1252")
    selected_lakes = duplicate_lakes = 0
    overlap_area = total_lake_area = 0.0
    print("[lakes] 50㎢ 이상 호수를 읽는 중입니다.", flush=True)
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
        duplicate, overlap = lake_duplicate(geometry_shape, base_lake_tree, base_lake_polygons)
        if duplicate:
            duplicate_lakes += 1
            continue
        total_lake_area += area
        overlap_area += area * overlap
        source_id = str(record.get("Hylak_id") or index)
        builder.add(BuiltFeature(
            fid=fid,
            aw_id=f"hydro-lake:{source_id}",
            layer_id="lakes_hydro",
            category="lake",
            stage=stage,
            name=str(record.get("Lake_name") or "").strip(),
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
    manifest = {
        "version": VERSION,
        "schema": "atlaswright-hydro-packs-v1",
        "dataset": "Natural Earth 5.0.0 base + performance-filtered HydroRIVERS/HydroLAKES 1.0",
        "crs": "EPSG:4326",
        "coordinatePolicy": "selected source vertices retained; 1e-6 degree Int32 delta-varint",
        "selection": {
            "riverFormula": "ORD_STRA + 4*log10(DIS_AV_CMS) - 0.5*log10(UPLAND_SKM)",
            "riverThresholds": list(RIVER_THRESHOLDS),
            "lakeAreaThresholdsKm2": list(LAKE_THRESHOLDS_KM2),
            "minZoomStages": list(STAGE_MIN_ZOOM),
            "baseDedupTarget": 0.02,
        },
        "stages": [
            {"id": index, "minZoom": STAGE_MIN_ZOOM[index], "columns": grid[0], "rows": grid[1], "indexTemplate": f"index/{index}/{{x}}-{{y}}.bin.gz"}
            for index, grid in enumerate(STAGE_GRIDS)
        ],
        "packTemplate": "packs/p{id}.bin.gz",
        "layers": [
            {"id": "rivers_base", "category": "river", "label": "강 · Natural Earth 기본", "locked": True},
            {"id": "rivers_hydro", "category": "river", "label": "강 · Hydro 보충", "locked": True},
            {"id": "lakes_base", "category": "lake", "label": "호수 · Natural Earth 기본", "locked": True},
            {"id": "lakes_hydro", "category": "lake", "label": "호수 · Hydro 보충", "locked": True},
        ],
        "stats": stats,
        "sources": {
            "naturalEarthBase": [
                {"file": "rivers_base.geojson", "sha256": sha256(hydro_root / "rivers_base.geojson")},
                {"file": "lakes_base.geojson", "sha256": sha256(hydro_root / "lakes_base.geojson")},
            ],
            "hydroRivers": source_rows,
            "hydroLakes": {"files": shapefile_source_files(lake_path), "selected": selected_lakes, "duplicates": duplicate_lakes},
        },
        "dedup": {
            "riverSampleOverlap": residual_river_length / max(duplicate_river_length, 1e-12),
            "lakeAreaOverlap": overlap_area / max(total_lake_area, 1e-12),
        },
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if manifest_path.stat().st_size > 100 * 1024:
        raise RuntimeError("초기 수계 manifest가 100KiB를 초과했습니다.")
    print(json.dumps({"manifest": str(manifest_path), "stats": stats, "dedup": manifest["dedup"]}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
