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
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image


Image.MAX_IMAGE_PIXELS = None
VERSION = "0.12.6"
TILE_SIZE = 1024
LEVEL_WIDTHS = (1350, 2700, 5400, 10800, 21600)

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
    countries = json.loads(countries_path.read_text(encoding="utf-8"))
    lakes = json.loads(lakes_path.read_text(encoding="utf-8"))
    request = dict(countries=dict(type='FeatureCollection', features=[*countries.get('features', []), *lakes.get('features', [])]),
                   x=0, y=0, width=width, height=height, levelWidth=width, levelHeight=height, fillHoles=True)
    result = subprocess.run(['node', str(Path(__file__).resolve().parent / 'gis' / 'terrain-preview-native.mjs'), '--physical-mask'],
                            input=json.dumps(request, ensure_ascii=False, separators=(',', ':')).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=240)
    if len(result.stdout) != width * height:
        raise ValueError('Native physical land mask dimensions differ')
    return Image.frombytes('L', size, result.stdout)


def combine_land_without_drainages(land: Image.Image, ocean: Image.Image, land_mask: Image.Image) -> Image.Image:
    """Keep no-drainage land colours and restore bathymetry over the white water background."""
    land_rgb = land.convert("RGB")
    combined = Image.composite(land_rgb, ocean.convert("RGB"), land_mask)
    land_rgb.close()
    return combined


def build_terrain(source_root: Path, output_root: Path, countries_path: Path) -> dict[str, Any]:
    terrain_dir = output_root / "terrain" / f"v{VERSION}"
    if terrain_dir.exists():
        raise FileExistsError(f"Physical terrain output exists; preserve prior evidence: {terrain_dir}")
    gray_path = find_file(source_root, "GRAY_HR_SR_OB.tif")
    land_path = find_file(source_root, "HYP_HR_SR.tif")
    ocean_path = find_file(source_root, "HYP_HR_SR_OB_DR.tif")
    terrain_dir.mkdir(parents=True, exist_ok=False)
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
        subprocess.run(['node', str(Path(__file__).resolve().parent / 'gis' / 'build-physical-hydro.mjs'),
                        '--source', str(args.source_root), '--output', str(args.output_root)], check=True)
    if not args.hydro_only:
        countries_path = (args.countries or (args.output_root / "territorial-entities/generated/current-world.geojson")).resolve()
        build_terrain(args.source_root, args.output_root, countries_path)


if __name__ == "__main__":
    main()
