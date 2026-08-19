#!/usr/bin/env python3
"""Build AtlasWright v0.12.0 physical-map assets from official Natural Earth files.

The source directory must contain the eight extracted 1:10m hydrography
shapefiles and the GRAY_HR_SR_OB / HYP_HR_SR_OB_DR 21,600 x 10,800 TIFFs.
Generated GeoJSON keeps every source coordinate. Terrain tiles pack the natural
terrain colour into RGB and the neutral relief/bathymetry luminance into alpha.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any

import shapefile
from PIL import Image


Image.MAX_IMAGE_PIXELS = None
VERSION = "0.12.0"
TILE_SIZE = 1024
LEVEL_WIDTHS = (1350, 2700, 5400, 10800, 21600)

HYDRO_SOURCES = (
    ("rivers_base", "river", "ne_10m_rivers_lake_centerlines_scale_rank"),
    ("rivers_australia", "river", "ne_10m_rivers_australia"),
    ("rivers_europe", "river", "ne_10m_rivers_europe"),
    ("rivers_north_america", "river", "ne_10m_rivers_north_america"),
    ("lakes_base", "lake", "ne_10m_lakes"),
    ("lakes_australia", "lake", "ne_10m_lakes_australia"),
    ("lakes_europe", "lake", "ne_10m_lakes_europe"),
    ("lakes_north_america", "lake", "ne_10m_lakes_north_america"),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_file(root: Path, filename: str) -> Path:
    matches = list(root.rglob(filename))
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one {filename}, found {len(matches)}")
    return matches[0]


def scalar(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def hydro_properties(record: dict[str, Any], layer_id: str, category: str, index: int) -> dict[str, Any]:
    source_id = record.get("ne_id") or record.get("id") or record.get("objectid") or index
    name_ko = record.get("name_ko") or ""
    name_en = record.get("name_en") or record.get("name") or ""
    display_name = name_ko or name_en or record.get("name") or f"{category}-{index + 1}"
    scale_rank = record.get("scalerank")
    try:
        scale_rank = int(scale_rank)
    except (TypeError, ValueError):
        scale_rank = 10
    min_zoom = record.get("min_zoom")
    try:
        min_zoom = float(min_zoom)
    except (TypeError, ValueError):
        min_zoom = max(0.0, min(12.0, float(scale_rank)))
    stroke_width = record.get("strokeweig")
    try:
        stroke_width = float(stroke_width)
    except (TypeError, ValueError):
        stroke_width = max(0.35, 2.7 - scale_rank * 0.18)
    return {
        "aw_id": f"{layer_id}:{source_id}",
        "layer_id": layer_id,
        "category": category,
        "name": display_name,
        "name_ko": name_ko,
        "name_en": name_en,
        "name_original": record.get("name") or "",
        "feature_class": record.get("featurecla") or "",
        "scale_rank": scale_rank,
        "min_zoom": min_zoom,
        "stroke_width": stroke_width,
        "source_id": scalar(source_id),
        "wikidata_id": record.get("wikidataid") or "",
        "note": record.get("note") or "",
        "source": "Natural Earth 5.0.0 1:10m",
    }


def build_hydro(source_root: Path, output_root: Path) -> dict[str, Any]:
    hydro_dir = output_root / "hydro"
    hydro_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "version": VERSION,
        "dataset": "Natural Earth 5.0.0 1:10m physical vectors",
        "crs": "EPSG:4326",
        "coordinatePolicy": "source coordinates retained without simplification",
        "layers": [],
    }
    for layer_id, category, stem in HYDRO_SOURCES:
        shp_path = find_file(source_root, f"{stem}.shp")
        reader = shapefile.Reader(str(shp_path), encoding="utf-8")
        fields = [field[0] for field in reader.fields[1:]]
        features = []
        coordinate_count = 0
        skipped_null_shapes = 0
        for index, shape_record in enumerate(reader.iterShapeRecords()):
            record = {name: value for name, value in zip(fields, shape_record.record)}
            if shape_record.shape.shapeType == shapefile.NULL:
                skipped_null_shapes += 1
                continue
            geometry = dict(shape_record.shape.__geo_interface__)
            coordinate_count += len(shape_record.shape.points)
            features.append({
                "type": "Feature",
                "id": f"{layer_id}:{record.get('ne_id') or record.get('id') or record.get('objectid') or index}",
                "properties": hydro_properties(record, layer_id, category, index),
                "geometry": geometry,
            })
        output_path = hydro_dir / f"{layer_id}.geojson"
        output_path.write_text(
            json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        entry = {
            "id": layer_id,
            "category": category,
            "url": f"hydro/{layer_id}.geojson",
            "featureCount": len(features),
            "coordinateCount": coordinate_count,
            "skippedNullShapes": skipped_null_shapes,
            "sourceFile": shp_path.name,
            "sourceSha256": sha256(shp_path),
            "outputSha256": sha256(output_path),
        }
        manifest["layers"].append(entry)
        print(f"hydro {layer_id}: {len(features):,} features, {coordinate_count:,} coordinates")
    manifest_path = hydro_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def crop_with_gutter(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    tile = Image.new(image.mode, (width + 2, height + 2))
    tile.paste(image.crop((left, top, right, bottom)), (1, 1))
    tile.paste(image.crop(((left - 1) % image.width, top, (left - 1) % image.width + 1, bottom)), (0, 1))
    tile.paste(image.crop((right % image.width, top, right % image.width + 1, bottom)), (width + 1, 1))
    top_source = max(0, top - 1)
    bottom_source = min(image.height - 1, bottom)
    tile.paste(image.crop((left, top_source, right, top_source + 1)), (1, 0))
    tile.paste(image.crop((left, bottom_source, right, bottom_source + 1)), (1, height + 1))
    tile.putpixel((0, 0), tile.getpixel((1, 0)))
    tile.putpixel((width + 1, 0), tile.getpixel((width, 0)))
    tile.putpixel((0, height + 1), tile.getpixel((1, height + 1)))
    tile.putpixel((width + 1, height + 1), tile.getpixel((width, height + 1)))
    return tile


def build_terrain(source_root: Path, output_root: Path) -> dict[str, Any]:
    gray_path = find_file(source_root, "GRAY_HR_SR_OB.tif")
    natural_path = find_file(source_root, "HYP_HR_SR_OB_DR.tif")
    terrain_dir = output_root / "terrain" / f"v{VERSION}"
    terrain_dir.mkdir(parents=True, exist_ok=True)
    source_gray = Image.open(gray_path)
    source_natural = Image.open(natural_path)
    if source_gray.size != (21600, 10800) or source_natural.size != source_gray.size:
        raise RuntimeError(f"Unexpected raster dimensions: {source_gray.size}, {source_natural.size}")
    levels = []
    for level_index, width in enumerate(LEVEL_WIDTHS):
        height = width // 2
        if width == source_natural.width:
            natural = source_natural
            gray = source_gray
        else:
            natural = source_natural.resize((width, height), Image.Resampling.LANCZOS)
            gray = source_gray.resize((width, height), Image.Resampling.LANCZOS)
        level_dir = terrain_dir / str(level_index)
        level_dir.mkdir(exist_ok=True)
        columns = math.ceil(width / TILE_SIZE)
        rows = math.ceil(height / TILE_SIZE)
        for row in range(rows):
            for column in range(columns):
                box = (
                    column * TILE_SIZE,
                    row * TILE_SIZE,
                    min(width, (column + 1) * TILE_SIZE),
                    min(height, (row + 1) * TILE_SIZE),
                )
                rgb = crop_with_gutter(natural, box).convert("RGB")
                relief = crop_with_gutter(gray, box).convert("L")
                red, green, blue = rgb.split()
                packed = Image.merge("RGBA", (red, green, blue, relief))
                packed.save(level_dir / f"{column}-{row}.webp", "WEBP", lossless=True, method=4, exact=True)
        levels.append({
            "id": level_index,
            "width": width,
            "height": height,
            "columns": columns,
            "rows": rows,
            "tileSize": TILE_SIZE,
        })
        print(f"terrain level {level_index}: {width}x{height}, {columns * rows} tiles")
        if natural is not source_natural:
            natural.close()
            gray.close()
    source_gray.close()
    source_natural.close()
    manifest = {
        "version": VERSION,
        "dataset": "Natural Earth raster 3.2.0 1:10m",
        "crs": "EPSG:4326",
        "extent": [-180, -90, 180, 90],
        "tileFormat": "lossless WebP RGBA",
        "channels": {"rgb": "cross-blended hypsometric colour, shaded relief, water, drainages and ocean bottom", "alpha": "Gray Earth relief, hypsography and ocean-bottom luminance"},
        "gutter": 1,
        "levels": levels,
        "urlTemplate": f"terrain/v{VERSION}/{{level}}/{{column}}-{{row}}.webp",
        "sources": [
            {"file": gray_path.name, "version": "3.2.0", "sha256": sha256(gray_path)},
            {"file": natural_path.name, "version": "3.2.0", "sha256": sha256(natural_path)},
        ],
    }
    manifest_path = terrain_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--hydro-only", action="store_true")
    parser.add_argument("--terrain-only", action="store_true")
    args = parser.parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    if not args.terrain_only:
        build_hydro(args.source_root, args.output_root)
    if not args.hydro_only:
        build_terrain(args.source_root, args.output_root)


if __name__ == "__main__":
    main()
