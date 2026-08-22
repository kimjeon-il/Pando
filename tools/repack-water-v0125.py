"""Repack v0.12.4 Hydro rivers with Natural Earth global lakes as v0.12.5.

This release helper preserves every encoded v0.12.4 river coordinate, width,
logical ID, and border-alignment flag. It is used when the original continental
HydroRIVERS source bundle is not present in the checkout.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).parents[1]


def load_builder_module():
    path = ROOT / "tools" / "build-hydro-tiles.py"
    spec = importlib.util.spec_from_file_location("atlaswright_build_water", path)
    if not spec or not spec.loader:
        raise RuntimeError("수계 빌더를 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_uvarint(data: bytes, cursor: list[int]) -> int:
    value = shift = 0
    while cursor[0] < len(data):
        byte = data[cursor[0]]
        cursor[0] += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value
        shift += 7
    raise RuntimeError("손상된 수계 varint입니다.")


def read_svarint(data: bytes, cursor: list[int]) -> int:
    value = read_uvarint(data, cursor)
    return (value >> 1) ^ -(value & 1)


def decode_line(data: bytes, cursor: list[int]) -> list[list[float]]:
    count = read_uvarint(data, cursor)
    result: list[list[float]] = []
    x = y = 0
    for index in range(count):
        dx = read_svarint(data, cursor)
        dy = read_svarint(data, cursor)
        if index:
            x += dx
            y += dy
        else:
            x, y = dx, dy
        result.append([x / 1_000_000, y / 1_000_000])
    return result


def decode_geometry(data: bytes, kind: int) -> dict[str, Any]:
    cursor = [0]
    if kind in (1, 2):
        parts = [decode_line(data, cursor) for _ in range(read_uvarint(data, cursor))]
        geometry = {"type": "LineString", "coordinates": parts[0] if parts else []} if kind == 1 else {"type": "MultiLineString", "coordinates": parts}
    else:
        polygons = []
        for _ in range(read_uvarint(data, cursor)):
            polygons.append([decode_line(data, cursor) for _ in range(read_uvarint(data, cursor))])
        geometry = {"type": "Polygon", "coordinates": polygons[0] if polygons else []} if kind == 3 else {"type": "MultiPolygon", "coordinates": polygons}
    if cursor[0] != len(data):
        raise RuntimeError("수계 geometry 뒤에 불필요한 데이터가 있습니다.")
    return geometry


def decode_widths(data: bytes, geometry: dict[str, Any]) -> list[list[float]]:
    if not data:
        return []
    cursor = [0]
    parts = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
    if read_uvarint(data, cursor) != len(parts):
        raise RuntimeError("강 너비 part 수가 다릅니다.")
    result = []
    for part in parts:
        count = read_uvarint(data, cursor)
        if count != len(part):
            raise RuntimeError("강 너비 꼭짓점 수가 다릅니다.")
        width = read_uvarint(data, cursor) if count else 0
        values = []
        for index in range(count):
            if index:
                width += read_svarint(data, cursor)
            values.append(width / 1000)
        result.append(values)
    if cursor[0] != len(data):
        raise RuntimeError("강 너비 뒤에 불필요한 데이터가 있습니다.")
    return result


def decode_source_ids(data: bytes) -> str:
    if not data:
        return ""
    cursor = [0]
    count = read_uvarint(data, cursor)
    current = read_uvarint(data, cursor) if count else 0
    values = []
    for index in range(count):
        if index:
            current += read_svarint(data, cursor)
        values.append(str(current))
    return ",".join(values)


def read_index(path: Path) -> dict[int, dict[str, int]]:
    raw = gzip.decompress(path.read_bytes())
    magic, version, _reserved, tile_count, logical_count, pack_count = struct.unpack_from("<4sHHIII", raw, 0)
    if (magic, version) != (b"AWI3", 3):
        raise RuntimeError("v0.12.4 수계 인덱스가 아닙니다.")
    offset = 20
    for _ in range(tile_count):
        count = struct.unpack_from("<H", raw, offset + 5)[0]
        offset += 7 + count * 4
    for _ in range(logical_count):
        count = struct.unpack_from("<H", raw, offset + 4)[0]
        offset += 6 + count * 4
    packs = {}
    for _ in range(pack_count):
        pack_id, shard, pack_offset, length, stage = struct.unpack_from("<IHII B", raw, offset)
        packs[pack_id] = {"shard": shard, "offset": pack_offset, "length": length, "stage": stage}
        offset += 15
    if offset != len(raw):
        raise RuntimeError("v0.12.4 인덱스 뒤에 불필요한 데이터가 있습니다.")
    return packs


def decode_v3_pack(raw: bytes, builder_module):
    magic, version, pack_stage, feature_count = struct.unpack_from("<4sHHI", raw, 0)
    if (magic, version) != (b"AWHF", 3):
        raise RuntimeError("v0.12.4 feature pack이 아닙니다.")
    offset = 12
    for _ in range(feature_count):
        header = struct.unpack_from("<IIBBBBHHf4i5HIII", raw, offset)
        fid, logical_fid, kind, stage, geometry_kind, flags, fragment_index, fragment_count, width = header[:9]
        bounds = tuple(value / 1_000_000 for value in header[9:13])
        lengths = header[13:18]
        source_length, geometry_length, width_length = header[18:21]
        offset += 58
        strings = []
        for length in lengths:
            strings.append(raw[offset:offset + length].decode("utf-8"))
            offset += length
        source_payload = raw[offset:offset + source_length]
        offset += source_length
        geometry_payload = raw[offset:offset + geometry_length]
        offset += geometry_length
        width_payload = raw[offset:offset + width_length]
        offset += width_length
        geometry = decode_geometry(geometry_payload, geometry_kind)
        source_id = decode_source_ids(source_payload) or strings[2]
        if kind == 1:
            yield builder_module.BuiltFeature(
                fid=fid, logical_fid=logical_fid, aw_id=strings[0], layer_id="rivers_hydro",
                category="river", stage=stage, name=strings[1], source_id=source_id,
                source=strings[3], width=width, geometry=geometry, bounds=bounds,
                width_profile=decode_widths(width_payload, geometry), fragment_index=fragment_index,
                fragment_count=fragment_count, flags=flags,
            )
    if offset != len(raw):
        raise RuntimeError("v0.12.4 pack 뒤에 불필요한 데이터가 있습니다.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "assets" / "data" / "hydro" / "v0.12.4")
    parser.add_argument("--natural-earth-root", type=Path, default=ROOT / "assets" / "data" / "hydro")
    parser.add_argument("--output", type=Path, default=ROOT / "assets" / "data" / "hydro" / "v0.12.5")
    args = parser.parse_args()
    module = load_builder_module()
    source = args.source.resolve()
    hydro_root = args.natural_earth_root.resolve()
    output = args.output.resolve()
    old_manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    packs = read_index(source / old_manifest["index"]["url"])
    shards = {row["id"]: (source / row["url"]).read_bytes() for row in old_manifest["shards"]}
    builder = module.PackBuilder(output)
    max_fid = max_logical = -1
    for pack_id, pack in sorted(packs.items()):
        compressed = shards[pack["shard"]][pack["offset"]:pack["offset"] + pack["length"]]
        for feature in decode_v3_pack(gzip.decompress(compressed), module):
            builder.add(feature)
            max_fid = max(max_fid, feature.fid)
            max_logical = max(max_logical, feature.logical_fid)

    lakes_path = hydro_root / "lakes_base.geojson"
    lakes = json.loads(lakes_path.read_text(encoding="utf-8"))["features"]
    for index, raw in enumerate(lakes):
        properties = raw.get("properties") or {}
        geometry = module.polygon_geometry(raw.get("geometry") or {})
        if not geometry:
            continue
        fid = max_fid + 1 + index
        logical_fid = max_logical + 1 + index
        source_id = str(properties.get("source_id") or raw.get("id") or index)
        aw_id = str(properties.get("aw_id") or raw.get("id") or f"lakes_base:{source_id}")
        builder.add(module.BuiltFeature(
            fid=fid, logical_fid=logical_fid, aw_id=aw_id,
            layer_id="lakes_natural_earth", category="lake",
            stage=module.min_zoom_stage(float(properties.get("min_zoom") or 7.5)),
            name=str(properties.get("name_ko") or properties.get("name_en") or properties.get("name") or "").strip(),
            source_id=source_id, source="Natural Earth 5.0.0 1:10m", width=1.0,
            geometry=geometry, bounds=module.geometry_bounds(geometry),
        ))

    stats = builder.write()
    layout = stats.pop("_layout")
    structural = {"featureCount", "coordinateCount", "categoryCounts", "layerCounts", "stageCounts", "packCount", "shardCount", "indexTileCount", "logicalFeatureCount", "compressedBytes", "largestPackBytes"}
    for key, value in old_manifest.get("stats", {}).items():
        if key not in structural and "lake" not in key.lower():
            stats[key] = value
    selection = dict(old_manifest.get("selection") or {})
    selection.pop("lakeAreaThresholdsKm2", None)
    selection["lakeSelection"] = "Natural Earth 5.0.0 1:10m global lakes and reservoirs; no regional supplements"
    manifest = {
        "version": "0.12.5",
        "schema": "atlaswright-water-shards-v4",
        "dataset": "HydroRIVERS 1.0 · Natural Earth 5.0.0 1:10m lakes · Natural Earth 5.1.1 border alignment",
        "crs": "EPSG:4326",
        "coordinatePolicy": old_manifest.get("coordinatePolicy"),
        "selection": selection,
        "stages": old_manifest["stages"],
        "format": {"pack": 4, "index": 4, "metadata": 4, "fragmentLogicalIds": True, "featureFlags": {"borderAligned": 1}},
        "index": layout["index"], "metadata": layout["metadata"], "shards": layout["shards"],
        "cache": {"name": f"atlaswright-water-v0.12.5-{layout['index']['sha256'][:12]}", "backgroundDownload": True, "rangeRequests": True},
        "layers": [
            {"id": "rivers_hydro", "category": "river", "label": "강 · Hydro", "locked": True},
            {"id": "lakes_natural_earth", "category": "lake", "label": "호수 · Natural Earth", "locked": True},
        ],
        "stats": stats,
        "sources": {
            "riverAssetSource": {"version": "0.12.4", "manifestSha256": sha256(source / "manifest.json")},
            "hydroRivers": old_manifest.get("sources", {}).get("hydroRivers", []),
            "naturalEarthLakes": {"file": "lakes_base.geojson", "sha256": sha256(lakes_path), "selected": len(lakes)},
            "naturalEarthNameReference": old_manifest.get("sources", {}).get("naturalEarthNameReference", []),
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if (output / "manifest.json").stat().st_size > 100 * 1024:
        raise RuntimeError("초기 수계 manifest가 100KiB를 초과했습니다.")
    print(json.dumps({"output": str(output), "stats": stats, "lakeCount": len(lakes)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
