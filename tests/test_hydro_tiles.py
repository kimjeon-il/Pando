from __future__ import annotations

import gzip
import json
import struct
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
DATA = ROOT / "assets" / "data" / "hydro" / "v0.12.2"
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
        if shift > 35:
            raise AssertionError("invalid hydro varint")
    raise AssertionError("truncated hydro varint")


def read_svarint(data: bytes, offset: int) -> tuple[int, int]:
    value, offset = read_uvarint(data, offset)
    return (value >> 1) ^ -(value & 1), offset


def skip_line(data: bytes, offset: int) -> tuple[int, int]:
    count, offset = read_uvarint(data, offset)
    for _ in range(count * 2):
        _, offset = read_uvarint(data, offset)
    return count, offset


def geometry_coordinate_count(data: bytes, geometry_kind: int) -> int:
    offset = 0
    total = 0
    if geometry_kind in (1, 2):
        part_count, offset = read_uvarint(data, offset)
        for _ in range(part_count):
            count, offset = skip_line(data, offset)
            total += count
    else:
        polygon_count, offset = read_uvarint(data, offset)
        for _ in range(polygon_count):
            ring_count, offset = read_uvarint(data, offset)
            for _ in range(ring_count):
                count, offset = skip_line(data, offset)
                total += count
    if offset != len(data):
        raise AssertionError(f"hydro geometry has {len(data) - offset} trailing bytes")
    return total


def decode_width_profile(data: bytes) -> list[list[float]]:
    if not data:
        return []
    part_count, offset = read_uvarint(data, 0)
    profiles = []
    for _ in range(part_count):
        count, offset = read_uvarint(data, offset)
        widths = []
        width = 0
        if count:
            width, offset = read_uvarint(data, offset)
        for index in range(count):
            if index:
                delta, offset = read_svarint(data, offset)
                width += delta
            widths.append(width / 1000)
        profiles.append(widths)
    if offset != len(data):
        raise AssertionError(f"river width profile has {len(data) - offset} trailing bytes")
    return profiles


def decode_source_ids(data: bytes) -> list[str]:
    if not data:
        return []
    count, offset = read_uvarint(data, 0)
    source_ids = []
    source_id = 0
    if count:
        source_id, offset = read_uvarint(data, offset)
    for index in range(count):
        if index:
            delta, offset = read_svarint(data, offset)
            source_id += delta
        source_ids.append(str(source_id))
    if offset != len(data):
        raise AssertionError(f"river source IDs have {len(data) - offset} trailing bytes")
    return source_ids


def intersects(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> bool:
    return not (left[2] < right[0] or left[0] > right[2] or left[3] < right[1] or left[1] > right[3])


def decode_pack(path: Path):
    raw = gzip.decompress(path.read_bytes())
    magic, version, pack_stage, feature_count = struct.unpack_from("<4sHHI", raw, 0)
    if magic != b"AWHF" or version != 2:
        raise AssertionError(f"invalid hydro pack: {path}")
    offset = 12
    for _ in range(feature_count):
        fid, kind, stage, geometry_kind, _reserved, width, *tail = struct.unpack_from("<IBBBBf4i5HIII", raw, offset)
        bounds = tuple(value / 1_000_000 for value in tail[:4])
        lengths = tail[4:9]
        source_payload_length = tail[9]
        payload_length = tail[10]
        width_payload_length = tail[11]
        offset += 50
        strings = []
        for length in lengths:
            strings.append(raw[offset:offset + length].decode("utf-8"))
            offset += length
        source_payload = raw[offset:offset + source_payload_length]
        offset += source_payload_length
        payload = raw[offset:offset + payload_length]
        offset += payload_length
        width_payload = raw[offset:offset + width_payload_length]
        offset += width_payload_length
        width_profiles = decode_width_profile(width_payload)
        yield {
            "fid": fid,
            "kind": kind,
            "stage": stage,
            "pack_stage": pack_stage,
            "geometry_kind": geometry_kind,
            "width": width,
            "bounds": bounds,
            "aw_id": strings[0],
            "layer_id": strings[4],
            "source_ids": decode_source_ids(source_payload) if source_payload else (strings[2].split(",") if strings[2] else []),
            "coordinate_count": geometry_coordinate_count(payload, geometry_kind),
            "width_profiles": width_profiles,
        }
    if offset != len(raw):
        raise AssertionError(f"pack has {len(raw) - offset} trailing bytes: {path}")


class HydroTileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest_path = DATA / "manifest.json"
        cls.manifest = json.loads(cls.manifest_path.read_text(encoding="utf-8"))
        cls.features = [feature for path in sorted((DATA / "packs").glob("p*.bin.gz")) for feature in decode_pack(path)]

    def test_manifest_and_assets_stay_within_limits(self):
        self.assertEqual(self.manifest["version"], "0.12.2")
        self.assertEqual(self.manifest["schema"], "atlaswright-hydro-packs-v2")
        self.assertLess(self.manifest_path.stat().st_size, 100 * 1024)
        self.assertLess(self.manifest["stats"]["compressedBytes"], 40 * 1024 * 1024)
        self.assertEqual({layer["id"] for layer in self.manifest["layers"]}, {"rivers_hydro", "lakes_hydro"})

    def test_selection_thresholds_are_the_approved_global_values(self):
        selection = self.manifest["selection"]
        self.assertEqual(selection["riverThresholds"], [14.4744, 12.4307, 11.2137, 10.65])
        self.assertEqual(selection["lakeAreaThresholdsKm2"], [250.0, 100.0, 40.0, 40.0])
        self.assertEqual(selection["minZoomStages"], [6.0, 6.7, 7.0, 7.5])
        self.assertIn("dominant upstream", selection["riverContinuity"])

    def test_every_feature_and_source_coordinate_round_trips(self):
        stats = self.manifest["stats"]
        self.assertEqual(len(self.features), stats["featureCount"])
        self.assertEqual(sum(feature["coordinate_count"] for feature in self.features), stats["coordinateCount"])
        self.assertEqual(len({feature["fid"] for feature in self.features}), len(self.features))
        self.assertEqual(len({feature["aw_id"] for feature in self.features}), len(self.features))
        self.assertTrue(all(feature["stage"] == feature["pack_stage"] for feature in self.features))
        decoded_layers = {}
        for feature in self.features:
            decoded_layers[feature["layer_id"]] = decoded_layers.get(feature["layer_id"], 0) + 1
        self.assertEqual(decoded_layers, stats["layerCounts"])

    def test_river_widths_are_tapered_and_never_narrow_downstream(self):
        rivers = [feature for feature in self.features if feature["kind"] == 1]
        self.assertTrue(rivers)
        for feature in rivers:
            self.assertTrue(feature["width_profiles"])
            previous_end = 0.0
            for widths in feature["width_profiles"]:
                self.assertGreaterEqual(min(widths), 0.55)
                self.assertLessEqual(max(widths), 2.6)
                self.assertTrue(all(right + 1e-6 >= left for left, right in zip(widths, widths[1:])))
                self.assertGreaterEqual(widths[0] + 1e-6, previous_end)
                previous_end = widths[-1]

    def test_korea_density_matches_performance_target(self):
        korea = [feature for feature in self.features if intersects(feature["bounds"], KOREA_BOUNDS)]
        hydro_rivers = [feature for feature in korea if feature["layer_id"] == "rivers_hydro"]
        hydro_lakes = [feature for feature in korea if feature["layer_id"] == "lakes_hydro"]
        self.assertGreaterEqual(len(hydro_rivers), 20)
        self.assertGreaterEqual(len(hydro_lakes), 5)
        source_ids = {source_id for feature in hydro_rivers for source_id in feature["source_ids"]}
        self.assertTrue({"40425195", "40434490", "40425194", "40391748"}.issubset(source_ids))

    def test_spatial_index_headers_and_pack_references_are_valid(self):
        pack_count = self.manifest["stats"]["packCount"]
        indexed_tiles = 0
        for path in (DATA / "index").glob("*/*.bin.gz"):
            raw = gzip.decompress(path.read_bytes())
            magic, version, stage, count = struct.unpack_from("<4sHHI", raw, 0)
            self.assertEqual((magic, version), (b"AWIX", 1))
            self.assertEqual(len(raw), 12 + count * 8)
            for offset in range(12, len(raw), 8):
                pack_id, _fid = struct.unpack_from("<II", raw, offset)
                self.assertLess(pack_id, pack_count)
            self.assertIn(stage, range(4))
            indexed_tiles += 1
        self.assertEqual(indexed_tiles, self.manifest["stats"]["indexTileCount"])


if __name__ == "__main__":
    unittest.main()
