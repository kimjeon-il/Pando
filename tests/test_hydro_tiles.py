from __future__ import annotations

import gzip
import json
import struct
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
DATA = ROOT / "assets" / "data" / "hydro" / "v0.12.1"
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


def intersects(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> bool:
    return not (left[2] < right[0] or left[0] > right[2] or left[3] < right[1] or left[1] > right[3])


def decode_pack(path: Path):
    raw = gzip.decompress(path.read_bytes())
    magic, version, pack_stage, feature_count = struct.unpack_from("<4sHHI", raw, 0)
    if magic != b"AWHF" or version != 1:
        raise AssertionError(f"invalid hydro pack: {path}")
    offset = 12
    for _ in range(feature_count):
        fid, kind, stage, geometry_kind, _reserved, width, *tail = struct.unpack_from("<IBBBBf4i5HI", raw, offset)
        bounds = tuple(value / 1_000_000 for value in tail[:4])
        lengths = tail[4:9]
        payload_length = tail[9]
        offset += 42
        strings = []
        for length in lengths:
            strings.append(raw[offset:offset + length].decode("utf-8"))
            offset += length
        payload = raw[offset:offset + payload_length]
        offset += payload_length
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
            "coordinate_count": geometry_coordinate_count(payload, geometry_kind),
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
        self.assertEqual(self.manifest["version"], "0.12.1")
        self.assertEqual(self.manifest["schema"], "atlaswright-hydro-packs-v1")
        self.assertLess(self.manifest_path.stat().st_size, 100 * 1024)
        self.assertLess(self.manifest["stats"]["compressedBytes"], 180 * 1024 * 1024)
        self.assertLess(self.manifest["dedup"]["riverSampleOverlap"], 0.02)
        self.assertLess(self.manifest["dedup"]["lakeAreaOverlap"], 0.02)

    def test_selection_thresholds_are_the_approved_global_values(self):
        selection = self.manifest["selection"]
        self.assertEqual(selection["riverThresholds"], [14.4744, 12.4307, 11.2137, 10.7957])
        self.assertEqual(selection["lakeAreaThresholdsKm2"], [250.0, 100.0, 50.0, 50.0])
        self.assertEqual(selection["minZoomStages"], [6.0, 6.7, 7.0, 7.5])

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

    def test_korea_density_matches_performance_target(self):
        korea = [feature for feature in self.features if intersects(feature["bounds"], KOREA_BOUNDS)]
        hydro_rivers = [feature for feature in korea if feature["layer_id"] == "rivers_hydro"]
        hydro_lakes = [feature for feature in korea if feature["layer_id"] == "lakes_hydro"]
        self.assertGreaterEqual(len(hydro_rivers), 14)
        self.assertLessEqual(len(hydro_rivers), 20)
        self.assertGreaterEqual(len(hydro_lakes), 4)
        self.assertLessEqual(len(hydro_lakes), 6)

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
