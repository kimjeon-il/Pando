#!/usr/bin/env python3
"""Build PandoLab v0.12.6 physical-map assets from official Natural Earth files.

The source directory must contain the eight extracted 1:10m hydrography
shapefiles and the GRAY_HR_SR_OB / HYP_HR_SR / HYP_HR_SR_OB_DR
21,600 x 10,800 TIFFs.
Generated GeoJSON keeps every source coordinate. Terrain tiles pack the natural
terrain colour into RGB and the neutral relief/bathymetry luminance into alpha.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import shapefile
from PIL import Image, ImageDraw


Image.MAX_IMAGE_PIXELS = None
VERSION = "0.12.6"
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
        "pandolab_id": f"{layer_id}:{source_id}",
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


def build_outer_land_mask(countries_path: Path, lakes_path: Path, size: tuple[int, int]) -> Image.Image:
    """Rasterize country outer rings while deliberately filling inland-water holes."""
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    countries = json.loads(countries_path.read_text(encoding="utf-8"))
    lakes = json.loads(lakes_path.read_text(encoding="utf-8"))
    for feature in [*countries.get("features", []), *lakes.get("features", [])]:
        geometry = feature.get("geometry") or {}
        polygons = [geometry.get("coordinates") or []] if geometry.get("type") == "Polygon" else geometry.get("coordinates") or []
        for polygon in polygons:
            if not polygon or len(polygon[0]) < 3:
                continue
            unwrapped: list[tuple[float, float]] = []
            for raw_lon, raw_lat, *_ in polygon[0]:
                lon = float(raw_lon)
                if unwrapped:
                    while lon - unwrapped[-1][0] > 180:
                        lon -= 360
                    while lon - unwrapped[-1][0] < -180:
                        lon += 360
                unwrapped.append((lon, float(raw_lat)))
            pixels = [((lon + 180) / 360 * width, (90 - lat) / 180 * height) for lon, lat in unwrapped]
            min_x = min(point[0] for point in pixels)
            max_x = max(point[0] for point in pixels)
            first_shift = math.floor((-max_x) / width)
            last_shift = math.ceil((width - min_x) / width)
            for shift in range(first_shift, last_shift + 1):
                shifted = [(x + shift * width, y) for x, y in pixels]
                if max(x for x, _ in shifted) >= 0 and min(x for x, _ in shifted) <= width:
                    draw.polygon(shifted, fill=255)
    return mask


def combine_land_without_drainages(land: Image.Image, ocean: Image.Image, land_mask: Image.Image) -> Image.Image:
    """Keep no-drainage land colours and restore bathymetry over the white water background."""
    land_rgb = land.convert("RGB")
    combined = Image.composite(land_rgb, ocean.convert("RGB"), land_mask)
    land_rgb.close()
    return combined


def build_terrain(source_root: Path, output_root: Path, countries_path: Path) -> dict[str, Any]:
    gray_path = find_file(source_root, "GRAY_HR_SR_OB.tif")
    land_path = find_file(source_root, "HYP_HR_SR.tif")
    ocean_path = find_file(source_root, "HYP_HR_SR_OB_DR.tif")
    terrain_dir = output_root / "terrain" / f"v{VERSION}"
    terrain_dir.mkdir(parents=True, exist_ok=True)
    source_gray = Image.open(gray_path)
    source_land = Image.open(land_path)
    source_ocean = Image.open(ocean_path)
    if source_gray.size != (21600, 10800) or source_land.size != source_gray.size or source_ocean.size != source_gray.size:
        raise RuntimeError(f"Unexpected raster dimensions: {source_gray.size}, {source_land.size}, {source_ocean.size}")
    lakes_path = countries_path.parent / "hydro" / "lakes_base.geojson"
    source_land_mask = build_outer_land_mask(countries_path, lakes_path, source_gray.size)
    levels = []
    for level_index, width in enumerate(LEVEL_WIDTHS):
        height = width // 2
        if width == source_land.width:
            land = source_land
            ocean = source_ocean
            gray = source_gray
            land_mask = source_land_mask
        else:
            land = source_land.resize((width, height), Image.Resampling.LANCZOS)
            ocean = source_ocean.resize((width, height), Image.Resampling.LANCZOS)
            gray = source_gray.resize((width, height), Image.Resampling.LANCZOS)
            land_mask = source_land_mask.resize((width, height), Image.Resampling.NEAREST)
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
                land_tile = crop_with_gutter(land, box)
                ocean_tile = crop_with_gutter(ocean, box)
                land_mask_tile = crop_with_gutter(land_mask, box)
                rgb = combine_land_without_drainages(land_tile, ocean_tile, land_mask_tile)
                relief = crop_with_gutter(gray, box).convert("L")
                red, green, blue = rgb.split()
                packed = Image.merge("RGBA", (red, green, blue, relief))
                packed.save(level_dir / f"{column}-{row}.webp", "WEBP", lossless=True, method=4, exact=True)
                land_tile.close(); ocean_tile.close(); land_mask_tile.close(); rgb.close(); relief.close(); red.close(); green.close(); blue.close(); packed.close()
        levels.append({
            "id": level_index,
            "width": width,
            "height": height,
            "columns": columns,
            "rows": rows,
            "tileSize": TILE_SIZE,
        })
        print(f"terrain level {level_index}: {width}x{height}, {columns * rows} tiles")
        if land is not source_land:
            land.close()
            ocean.close()
            gray.close()
            land_mask.close()
    source_gray.close()
    source_land.close()
    source_ocean.close()
    source_land_mask.close()
    manifest = {
        "version": VERSION,
        "dataset": "Natural Earth raster 3.2.0 1:10m",
        "crs": "EPSG:4326",
        "extent": [-180, -90, 180, 90],
        "tileFormat": "lossless WebP RGBA",
        "channels": {"rgb": "drainage-free cross-blended land combined with ocean-bottom colour", "alpha": "Gray Earth relief, hypsography and ocean-bottom luminance"},
        "displayColors": {"oceanRepresentative": "#6aa8d2"},
        "gutter": 1,
        "levels": levels,
        "urlTemplate": f"terrain/v{VERSION}/{{level}}/{{column}}-{{row}}.webp",
        "sources": [
            {"file": countries_path.name, "version": "Natural Earth 5.1.1", "sha256": sha256(countries_path)},
            {"file": lakes_path.name, "version": "Natural Earth 5.0.0", "sha256": sha256(lakes_path)},
            {"file": gray_path.name, "version": "3.2.0", "sha256": sha256(gray_path)},
            {"file": land_path.name, "version": "3.2.0", "sha256": sha256(land_path)},
            {"file": ocean_path.name, "version": "3.2.0", "sha256": sha256(ocean_path)},
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
    parser.add_argument("--countries", type=Path)
    args = parser.parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    if not args.terrain_only:
        build_hydro(args.source_root, args.output_root)
    if not args.hydro_only:
        countries_path = (args.countries or (args.output_root / "countries-ne-5.1.1.geojson")).resolve()
        build_terrain(args.source_root, args.output_root, countries_path)


if __name__ == "__main__":
    main()
