from __future__ import annotations

import gzip
import json
import math
import struct
import unittest
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).parents[1]
DATA = ROOT / "assets" / "data" / "hydro" / "v0.12.3"
KOREA_BOUNDS = (124.0, 33.0, 131.0, 43.0)


def read_uvarint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise AssertionError("truncated hydro varint")


def read_svarint(data: bytes, offset: int) -> tuple[int, int]:
    value, offset = read_uvarint(data, offset)
    return (value >> 1) ^ -(value & 1), offset


def decode_line(data: bytes, offset: int) -> tuple[list[tuple[float, float]], int]:
    count, offset = read_uvarint(data, offset)
    points = []
    x = y = 0
    for index in range(count):
        dx, offset = read_svarint(data, offset)
        dy, offset = read_svarint(data, offset)
        if index:
            x += dx
            y += dy
        else:
            x, y = dx, dy
        points.append((x / 1_000_000, y / 1_000_000))
    return points, offset


def decode_geometry(data: bytes, geometry_kind: int):
    offset = 0
    if geometry_kind in (1, 2):
        part_count, offset = read_uvarint(data, offset)
        parts = []
        for _ in range(part_count):
            part, offset = decode_line(data, offset)
            parts.append(part)
        geometry = parts[0] if geometry_kind == 1 else parts
    else:
        polygon_count, offset = read_uvarint(data, offset)
        polygons = []
        for _ in range(polygon_count):
            ring_count, offset = read_uvarint(data, offset)
            rings = []
            for _ in range(ring_count):
                ring, offset = decode_line(data, offset)
                rings.append(ring)
            polygons.append(rings)
        geometry = polygons[0] if geometry_kind == 3 else polygons
    if offset != len(data):
        raise AssertionError("hydro geometry has trailing bytes")
    return geometry


def coordinate_count(geometry, geometry_kind: int) -> int:
    if geometry_kind == 1:
        return len(geometry)
    if geometry_kind in (2, 3):
        return sum(len(part) for part in geometry)
    return sum(len(ring) for polygon in geometry for ring in polygon)


def decode_width_profile(data: bytes) -> list[list[float]]:
    if not data:
        return []
    part_count, offset = read_uvarint(data, 0)
    profiles = []
    for _ in range(part_count):
        count, offset = read_uvarint(data, offset)
        width = 0
        if count:
            width, offset = read_uvarint(data, offset)
        widths = []
        for index in range(count):
            if index:
                delta, offset = read_svarint(data, offset)
                width += delta
            widths.append(width / 1000)
        profiles.append(widths)
    if offset != len(data):
        raise AssertionError("river width profile has trailing bytes")
    return profiles


def decode_source_ids(data: bytes) -> list[str]:
    if not data:
        return []
    count, offset = read_uvarint(data, 0)
    source_id = 0
    if count:
        source_id, offset = read_uvarint(data, offset)
    result = []
    for index in range(count):
        if index:
            delta, offset = read_svarint(data, offset)
            source_id += delta
        result.append(str(source_id))
    return result


def read_index(path: Path):
    raw = gzip.decompress(path.read_bytes())
    magic, version, _reserved, tile_count, logical_count, pack_count = struct.unpack_from("<4sHHIII", raw, 0)
    if (magic, version) != (b"AWI3", 3):
        raise AssertionError("invalid global hydro index")
    offset = 20
    tiles = {}
    for _ in range(tile_count):
        stage, x, y, count = struct.unpack_from("<BHHH", raw, offset)
        offset += 7
        tiles[(stage, x, y)] = list(struct.unpack_from(f"<{count}I", raw, offset)) if count else []
        offset += count * 4
    logical = {}
    for _ in range(logical_count):
        logical_fid, count = struct.unpack_from("<IH", raw, offset)
        offset += 6
        logical[logical_fid] = list(struct.unpack_from(f"<{count}I", raw, offset)) if count else []
        offset += count * 4
    packs = {}
    for _ in range(pack_count):
        pack_id, shard, pack_offset, length, stage = struct.unpack_from("<IHII B", raw, offset)
        offset += 15
        packs[pack_id] = {"shard": shard, "offset": pack_offset, "length": length, "stage": stage}
    if offset != len(raw):
        raise AssertionError("global hydro index has trailing bytes")
    return tiles, logical, packs


def decode_pack(raw: bytes, pack_id: int):
    magic, version, pack_stage, feature_count = struct.unpack_from("<4sHHI", raw, 0)
    if (magic, version) != (b"AWHF", 3):
        raise AssertionError(f"invalid hydro pack {pack_id}")
    offset = 12
    for _ in range(feature_count):
        header = struct.unpack_from("<IIBBBBHHf4i5HIII", raw, offset)
        fid, logical_fid, kind, stage, geometry_kind, _flags, fragment_index, fragment_count, width = header[:9]
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
        yield {
            "fid": fid,
            "logical_fid": logical_fid,
            "kind": kind,
            "stage": stage,
            "pack_stage": pack_stage,
            "fragment_index": fragment_index,
            "fragment_count": fragment_count,
            "width": width,
            "bounds": bounds,
            "aw_id": strings[0],
            "name": strings[1],
            "layer_id": strings[4],
            "source_ids": decode_source_ids(source_payload),
            "coordinate_count": coordinate_count(geometry, geometry_kind),
            "geometry": geometry if intersects(bounds, KOREA_BOUNDS) else None,
            "width_profiles": decode_width_profile(width_payload),
        }
    if offset != len(raw):
        raise AssertionError(f"pack {pack_id} has trailing bytes")


def intersects(left, right) -> bool:
    return not (left[2] < right[0] or left[0] > right[2] or left[3] < right[1] or left[1] > right[3])


class HydroTileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest_path = DATA / "manifest.json"
        cls.manifest = json.loads(cls.manifest_path.read_text(encoding="utf-8"))
        cls.tiles, cls.logical_index, cls.packs = read_index(DATA / cls.manifest["index"]["url"])
        shards = {row["id"]: (DATA / row["url"]).read_bytes() for row in cls.manifest["shards"]}
        cls.features = []
        for pack_id, spec in sorted(cls.packs.items()):
            compressed = shards[spec["shard"]][spec["offset"]:spec["offset"] + spec["length"]]
            cls.features.extend(decode_pack(gzip.decompress(compressed), pack_id))

    def test_manifest_index_and_shards_stay_within_limits(self):
        self.assertEqual(self.manifest["version"], "0.12.3")
        self.assertEqual(self.manifest["schema"], "atlaswright-hydro-shards-v3")
        self.assertLess(self.manifest_path.stat().st_size, 100 * 1024)
        self.assertLess((DATA / self.manifest["index"]["url"]).stat().st_size, 100 * 1024)
        self.assertLess(self.manifest["stats"]["compressedBytes"], 48 * 1024 * 1024)
        self.assertTrue(all(row["bytes"] <= 4 * 1024 * 1024 for row in self.manifest["shards"]))
        self.assertEqual(len(self.packs), self.manifest["stats"]["packCount"])
        self.assertEqual(len(self.logical_index), self.manifest["stats"]["logicalFeatureCount"])
        self.assertTrue(self.manifest["cache"]["name"].endswith(self.manifest["index"]["sha256"][:12]))

    def test_selection_uses_new_detail_and_downstream_closure(self):
        selection = self.manifest["selection"]
        self.assertEqual(selection["riverThresholds"], [14.4744, 12.4307, 11.2137, 10.55])
        self.assertIn("closed downstream", selection["riverContinuity"])
        self.assertGreater(self.manifest["stats"]["downstreamClosureReachCount"], 0)
        self.assertGreater(self.manifest["stats"]["coastSnappedTerminalCount"], 0)

    def test_fragments_share_one_logical_river_identity(self):
        self.assertEqual(len(self.features), self.manifest["stats"]["featureCount"])
        self.assertEqual(len({row["fid"] for row in self.features}), len(self.features))
        self.assertEqual(sum(row["coordinate_count"] for row in self.features), self.manifest["stats"]["coordinateCount"])
        groups = defaultdict(list)
        for feature in self.features:
            groups[feature["logical_fid"]].append(feature)
            self.assertEqual(feature["stage"], feature["pack_stage"])
        for logical_fid, fragments in groups.items():
            self.assertEqual({row["aw_id"] for row in fragments}, {fragments[0]["aw_id"]})
            self.assertEqual(sorted(row["fragment_index"] for row in fragments), list(range(fragments[0]["fragment_count"])))
            self.assertIn(logical_fid, self.logical_index)

    def test_river_width_never_narrows_inside_a_fragment(self):
        for feature in (row for row in self.features if row["kind"] == 1):
            self.assertTrue(feature["width_profiles"])
            for widths in feature["width_profiles"]:
                self.assertGreaterEqual(min(widths), 0.55)
                self.assertLessEqual(max(widths), 2.6)
                self.assertTrue(all(right + 1e-6 >= left for left, right in zip(widths, widths[1:])))

    def test_korea_density_and_named_main_stems(self):
        korea = [feature for feature in self.features if intersects(feature["bounds"], KOREA_BOUNDS)]
        river_groups = {feature["logical_fid"] for feature in korea if feature["kind"] == 1}
        lakes = [feature for feature in korea if feature["kind"] == 2]
        self.assertGreaterEqual(len(river_groups), 18)
        self.assertGreaterEqual(len(lakes), 5)
        source_ids = {source_id for feature in korea for source_id in feature["source_ids"]}
        self.assertTrue({"40425195", "40425194", "40391748"}.issubset(source_ids))
        names = {feature["name"] for feature in korea if feature["kind"] == 1}
        self.assertTrue(any("압록" in name or "Yalu" in name for name in names))
        self.assertTrue(any("두만" in name or "Tumen" in name for name in names))
        paektu = (128.095, 42.006)

        def points(value):
            if isinstance(value, tuple) and len(value) == 2:
                return [value]
            return [point for item in value for point in points(item)] if isinstance(value, list) else []

        for labels in (("압록", "Yalu"), ("두만", "Tumen")):
            main_stem = [feature for feature in korea if feature["kind"] == 1 and any(label in feature["name"] for label in labels)]
            self.assertEqual(len({feature["logical_fid"] for feature in main_stem}), 1)
            distance = min(
                math.hypot(
                    (point[0] - paektu[0]) * 111.32 * math.cos(math.radians((point[1] + paektu[1]) / 2)),
                    (point[1] - paektu[1]) * 110.57,
                )
                for feature in main_stem for point in points(feature["geometry"])
            )
            self.assertLessEqual(distance, 35.0)


if __name__ == "__main__":
    unittest.main()
