#!/usr/bin/env python3
"""Create the AtlasWright v0.12.4 Korean main-stem/alignment report."""

from __future__ import annotations

import gzip
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import shape

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from tests.test_hydro_tiles import KOREA_BOUNDS, decode_pack, intersects, read_index


OUTPUT = ROOT / "reports" / "hydro-v0.12.4"
TERMINALS = {
    "Daedong": "40391614",
    "Geum": "40475481",
    "Yeongsan": "40515775",
}
PANEL_WIDTH = 720
PANEL_HEIGHT = 980
MAP_PADDING = 42


def load_features(version: str):
    data = ROOT / "assets" / "data" / "hydro" / version
    manifest = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
    _tiles, _logical, packs = read_index(data / manifest["index"]["url"])
    shards = {row["id"]: (data / row["url"]).read_bytes() for row in manifest["shards"]}
    features = []
    for pack_id, spec in sorted(packs.items()):
        compressed = shards[spec["shard"]][spec["offset"]:spec["offset"] + spec["length"]]
        features.extend(decode_pack(gzip.decompress(compressed), pack_id))
    return manifest, [row for row in features if row["kind"] == 1 and intersects(row["bounds"], KOREA_BOUNDS)]


def line_parts(geometry):
    if not geometry:
        return []
    return [geometry] if geometry and isinstance(geometry[0], tuple) else geometry


def screen_point(point, offset_x=0):
    min_x, min_y, max_x, max_y = KOREA_BOUNDS
    map_width = PANEL_WIDTH - MAP_PADDING * 2
    map_height = PANEL_HEIGHT - 120 - MAP_PADDING
    scale = min(map_width / (max_x - min_x), map_height / (max_y - min_y))
    left = offset_x + (PANEL_WIDTH - (max_x - min_x) * scale) / 2
    top = 80 + (map_height - (max_y - min_y) * scale) / 2
    return left + (point[0] - min_x) * scale, top + (max_y - point[1]) * scale


def draw_base(draw, offset_x):
    countries = json.loads((ROOT / "assets" / "data" / "countries-ne-5.1.1.geojson").read_text(encoding="utf-8"))["features"]
    clip = shape({"type": "Polygon", "coordinates": [[
        [124, 33], [131, 33], [131, 43], [124, 43], [124, 33],
    ]]})
    for feature in countries:
        geometry = shape(feature["geometry"])
        if not geometry.intersects(clip):
            continue
        polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
        for polygon in polygons:
            points = [screen_point(point, offset_x) for point in polygon.exterior.coords]
            draw.polygon(points, fill="#f4f1e8", outline="#747474", width=1)


def draw_rivers(draw, offset_x, features, color="#397fb9", aligned_color=None, linewidth=1):
    for feature in features:
        color_value = aligned_color if aligned_color and feature["flags"] & 1 else color
        width = max(1, round(linewidth * (1.6 if feature["flags"] & 1 else 1.0)))
        for part in line_parts(feature["geometry"]):
            if len(part) < 2:
                continue
            draw.line([screen_point(point, offset_x) for point in part], fill=color_value, width=width, joint="curve")


def paektu_distance(features, labels):
    paektu = (128.095, 42.006)
    distances = []
    for feature in features:
        if not any(label in feature["name"] for label in labels):
            continue
        for part in line_parts(feature["geometry"]):
            for point in part:
                distances.append(math.hypot(
                    (point[0] - paektu[0]) * 111.32 * math.cos(math.radians((point[1] + paektu[1]) / 2)),
                    (point[1] - paektu[1]) * 110.57,
                ))
    return round(min(distances), 2) if distances else None


def main():
    old_manifest, old_features = load_features("v0.12.3")
    manifest, features = load_features("v0.12.4")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    logical_by_source = {}
    for label, source_id in TERMINALS.items():
        matches = {feature["logical_fid"] for feature in features if source_id in feature["source_ids"]}
        logical_by_source[label] = next(iter(matches)) if len(matches) == 1 else None

    image = Image.new("RGB", (PANEL_WIDTH * 3, PANEL_HEIGHT), "#e9f1f4")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=20)
    label_font = ImageFont.load_default(size=15)
    titles = (
        "v0.12.3 Hydro network",
        "v0.12.4 medium main stems + border alignment",
        "Unnamed medium main stems generalized globally",
    )
    for panel, title in enumerate(titles):
        offset_x = panel * PANEL_WIDTH
        draw.rectangle((offset_x, 0, offset_x + PANEL_WIDTH - 1, PANEL_HEIGHT - 1), outline="#b7c3c9", width=1)
        draw.text((offset_x + PANEL_WIDTH / 2, 28), title, fill="#23323b", font=title_font, anchor="ma")
        draw_base(draw, offset_x)
    draw_rivers(draw, 0, old_features, color="#8ba8bc", linewidth=1)
    draw_rivers(draw, PANEL_WIDTH, features, color="#397fb9", aligned_color="#00a6d6", linewidth=1)
    draw_rivers(draw, PANEL_WIDTH * 2, features, color="#c9ced3", linewidth=1)
    colors = {"Daedong": "#8e44ad", "Geum": "#e67e22", "Yeongsan": "#c0392b"}
    groups = defaultdict(list)
    for feature in features:
        groups[feature["logical_fid"]].append(feature)
    for label, logical_fid in logical_by_source.items():
        draw_rivers(draw, PANEL_WIDTH * 2, groups.get(logical_fid, []), color=colors[label], linewidth=3)
    legend_x = PANEL_WIDTH * 2 + 34
    for index, (label, color) in enumerate(colors.items()):
        y = PANEL_HEIGHT - 84 + index * 20
        draw.line((legend_x, y + 7, legend_x + 28, y + 7), fill=color, width=4)
        draw.text((legend_x + 38, y), label, fill="#23323b", font=label_font)
    image.save(OUTPUT / "korea-mainstems-border-alignment.png", optimize=True)

    pair_lengths = defaultdict(float)
    for row in manifest["sources"]["hydroRivers"]:
        for pair, length in row.get("borderPairLengthsKm", {}).items():
            pair_lengths[pair] += float(length)
    validation = {
        "version": manifest["version"],
        "assetBytes": manifest["stats"]["compressedBytes"],
        "shards": manifest["stats"]["shardCount"],
        "mediumMainstemMinBasinKm2": manifest["selection"]["mediumMainstemMinBasinKm2"],
        "mediumMainstemRoots": manifest["stats"]["mediumMainstemRootCount"],
        "mediumMainstemReaches": manifest["stats"]["mediumMainstemReachCount"],
        "borderAlignedRivers": manifest["stats"]["borderAlignedRiverCount"],
        "borderAlignedReaches": manifest["stats"]["borderAlignedReachCount"],
        "borderAlignedLengthKm": manifest["stats"]["borderAlignedLengthKm"],
        "borderChangedCoordinates": manifest["stats"]["borderChangedCoordinateCount"],
        "koreaLogicalMainstems": logical_by_source,
        "yaluPaektuKm": paektu_distance(features, ("압록", "Yalu")),
        "tumenPaektuKm": paektu_distance(features, ("두만", "Tumen")),
        "koreaBorderPairsKm": {
            key: round(pair_lengths.get(key, 0.0), 1)
            for key in ("CHN/PRK", "PRK/RUS")
        },
        "previousAssetBytes": old_manifest["stats"]["compressedBytes"],
    }
    (OUTPUT / "validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
