from __future__ import annotations

import gzip
import hashlib
import json
import math
import struct
import unittest
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, MultiLineString, shape


ROOT = Path(__file__).parents[1]
DATA = ROOT / "assets" / "data" / "hydro" / "v0.12.6"
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
    if (magic, version) != (b"AWI4", 4):
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


def decode_pack(raw: bytes, pack_id: int, metadata: dict[int, dict]):
    magic, version, pack_stage, feature_count = struct.unpack_from("<4sHHI", raw, 0)
    if (magic, version) != (b"AWHF", 4):
        raise AssertionError(f"invalid hydro pack {pack_id}")
    offset = 12
    for _ in range(feature_count):
        header = struct.unpack_from("<IIBBBBHHf4iII", raw, offset)
        fid, logical_fid, kind, stage, geometry_kind, flags, fragment_index, fragment_count, width = header[:9]
        bounds = tuple(value / 1_000_000 for value in header[9:13])
        geometry_length, width_length = header[13:15]
        offset += 44
        geometry_payload = raw[offset:offset + geometry_length]
        offset += geometry_length
        width_payload = raw[offset:offset + width_length]
        offset += width_length
        geometry = decode_geometry(geometry_payload, geometry_kind)
        meta = metadata[fid]
        line_parts = []
        if geometry_kind == 1:
            line_parts = [geometry]
        elif geometry_kind == 2:
            line_parts = geometry
        yield {
            "fid": fid,
            "logical_fid": logical_fid,
            "kind": kind,
            "stage": stage,
            "pack_stage": pack_stage,
            "fragment_index": fragment_index,
            "fragment_count": fragment_count,
            "width": width,
            "flags": flags,
            "bounds": bounds,
            "aw_id": meta["awId"],
            "name": meta["name"],
            "source": meta["source"],
            "layer_id": meta["layerId"],
            "source_ids": [value for value in str(meta.get("sourceId") or "").split(",") if value],
            "terminal": meta.get("terminal"),
            "start": line_parts[0][0] if line_parts else None,
            "end": line_parts[-1][-1] if line_parts else None,
            "part_connections_exact": all(left[-1] == right[0] for left, right in zip(line_parts, line_parts[1:])),
            "part_connection_mismatches": [
                (left[-1], right[0]) for left, right in zip(line_parts, line_parts[1:]) if left[-1] != right[0]
            ],
            "coordinate_count": coordinate_count(geometry, geometry_kind),
            "geometry": geometry if flags & 1 or intersects(bounds, KOREA_BOUNDS) else None,
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
        core_payload = json.loads(gzip.decompress((DATA / cls.manifest["metadata"]["core"]["url"]).read_bytes()).decode("utf-8"))
        detail_payload = json.loads(gzip.decompress((DATA / cls.manifest["metadata"]["detail"]["url"]).read_bytes()).decode("utf-8"))
        cls.metadata = {int(row["fid"]): row for row in core_payload["features"]}
        for detail in detail_payload["features"]:
            cls.metadata[int(detail["fid"])].update(detail)
        cls.tiles, cls.logical_index, cls.packs = read_index(DATA / cls.manifest["index"]["url"])
        shards = {row["id"]: (DATA / row["url"]).read_bytes() for row in cls.manifest["shards"]}
        cls.features = []
        for pack_id, spec in sorted(cls.packs.items()):
            compressed = shards[spec["shard"]][spec["offset"]:spec["offset"] + spec["length"]]
            cls.features.extend(decode_pack(gzip.decompress(compressed), pack_id, cls.metadata))

    def test_manifest_index_and_shards_stay_within_limits(self):
        self.assertEqual(self.manifest["version"], "0.12.6")
        self.assertEqual(self.manifest["schema"], "atlaswright-water-shards-v4")
        self.assertLess(self.manifest_path.stat().st_size, 100 * 1024)
        self.assertLess((DATA / self.manifest["index"]["url"]).stat().st_size, 100 * 1024)
        self.assertEqual(self.manifest["metadata"]["featureCount"], self.manifest["stats"]["featureCount"])
        self.assertLess(self.manifest["metadata"]["core"]["bytes"], 700 * 1024)
        self.assertTrue(self.manifest["metadata"]["detail"]["lazy"])
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
        self.assertEqual(selection["mediumMainstemMinBasinKm2"], 2500.0)
        self.assertGreater(self.manifest["stats"]["mediumMainstemReachCount"], 0)
        self.assertGreater(self.manifest["stats"]["borderAlignedLengthKm"], 0)
        connectivity = selection["terminalConnectivity"]
        self.assertEqual(connectivity["maximumCoastExtensionKm"], 25)
        self.assertIn("exclude", connectivity["unresolvedRenderedLandTerminal"])
        terminal_counts = self.manifest["stats"]["terminalClassCounts"]
        self.assertEqual(terminal_counts.get("unresolved-land", 0), 0)

    def test_natural_earth_global_lakes_replace_hydrolakes(self):
        lakes = [feature for feature in self.features if feature["kind"] == 2]
        self.assertEqual(len(lakes), 1355)
        self.assertEqual(sum(feature["coordinate_count"] for feature in lakes), 162852)
        self.assertEqual({feature["layer_id"] for feature in lakes}, {"lakes_natural_earth"})
        self.assertTrue(all(feature["source"] == "Natural Earth 5.0.0 1:10m" for feature in lakes))
        self.assertTrue(all(not feature["aw_id"].startswith("hydro-lake:") for feature in lakes))
        source = ROOT / "assets" / "data" / "hydro" / "lakes_base.geojson"
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), self.manifest["sources"]["naturalEarthLakes"]["sha256"])

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

    def test_every_displayed_logical_river_has_a_classified_terminal(self):
        groups = defaultdict(list)
        for feature in self.features:
            if feature["kind"] == 1:
                groups[feature["logical_fid"]].append(feature)
        allowed = {"sea", "lake", "confluence", "endorheic"}
        for logical_fid, fragments in groups.items():
            terminal_rows = [row for row in fragments if row.get("terminal")]
            self.assertEqual(len(terminal_rows), 1, f"logical river {logical_fid}")
            self.assertIn(terminal_rows[0]["terminal"]["class"], allowed)

    def test_every_river_part_and_fragment_uses_an_exact_shared_endpoint(self):
        groups = defaultdict(list)
        for feature in self.features:
            if feature["kind"] != 1:
                continue
            self.assertTrue(feature["part_connections_exact"], feature["fid"])
            groups[feature["logical_fid"]].append(feature)
        for logical_fid, fragments in groups.items():
            fragments.sort(key=lambda row: row["fragment_index"])
            for left, right in zip(fragments, fragments[1:]):
                self.assertEqual(left["end"], right["start"], f"logical river {logical_fid}")

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
        self.assertGreaterEqual(len(lakes), 1)
        source_ids = {source_id for feature in korea for source_id in feature["source_ids"]}
        self.assertTrue({"40425195", "40425194", "40391748"}.issubset(source_ids))
        # Daedong, Geum, and Yeongsan terminal reaches must all be present even
        # when they have no Natural Earth naming guide.
        self.assertTrue({"40391614", "40475481", "40515775"}.issubset(source_ids))
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

    def test_border_fragments_use_reserved_flag_and_exact_source_pair(self):
        aligned = [feature for feature in self.features if feature["kind"] == 1 and feature["flags"] & 1]
        self.assertGreaterEqual(self.manifest["stats"]["borderAlignedReachCount"], len(aligned))
        self.assertGreater(len(aligned), 0)
        self.assertTrue(all("Natural Earth border " in feature["source"] for feature in aligned))
        self.assertTrue(all(not (feature["flags"] & ~1) for feature in aligned))
        korea_aligned = [feature for feature in aligned if intersects(feature["bounds"], KOREA_BOUNDS)]
        self.assertTrue(any("CHN/PRK" in feature["source"] for feature in korea_aligned))
        self.assertTrue(any("PRK/RUS" in feature["source"] for feature in korea_aligned))

        countries = json.loads((ROOT / "assets" / "data" / "countries-ne-5.1.1.geojson").read_text(encoding="utf-8"))["features"]
        by_id = {feature["properties"]["editor_id"]: shape(feature["geometry"]) for feature in countries}
        shared = {}
        for feature in aligned:
            pair = tuple(feature["source"].rsplit(" ", 1)[-1].split("/"))
            if pair not in shared:
                self.assertTrue(all(country_id in by_id for country_id in pair))
                shared[pair] = by_id[pair[0]].boundary.intersection(by_id[pair[1]].boundary)
            geometry = LineString(feature["geometry"]) if feature["geometry"] and isinstance(feature["geometry"][0], tuple) else MultiLineString(feature["geometry"])
            for part in ([geometry] if isinstance(geometry, LineString) else geometry.geoms):
                self.assertTrue(all(shared[pair].distance(shape({"type": "Point", "coordinates": point})) <= 2e-6 for point in part.coords))


if __name__ == "__main__":
    unittest.main()
