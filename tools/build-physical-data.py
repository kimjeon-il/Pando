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
import struct
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


class NativeTileProcess:
    """Reuse a source-verified native process for all tiles in a level."""
    def __init__(self, script: Path, *arguments: str):
        self.command = ['node', str(script), *arguments]

    def __enter__(self):
        self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        return self

    def __exit__(self, kind, value, traceback):
        try:
            self.process.stdin.close()
        except BrokenPipeError:
            pass
        self.process.stdout.close()
        status = self.process.wait(timeout=180)
        if status and kind is None:
            raise RuntimeError(f'Native physical tile process failed: {status}')


class PhysicalCompositor(NativeTileProcess):
    def __init__(self):
        super().__init__(Path(__file__).resolve().parent / 'gis' / 'terrain-preview-native.mjs', '--physical-composite-stream')

    def combine(self, land: Image.Image, ocean: Image.Image, land_mask: Image.Image, relief: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
        if land.size != ocean.size or land.size != land_mask.size or land.size != relief.size:
            raise ValueError('Physical composite image dimensions differ')
        left, top, right, bottom = box
        if not (0 <= left < right <= land.width and 0 <= top < bottom <= land.height):
            raise ValueError('Invalid physical tile bounds')
        width, height = right - left, bottom - top
        y0, y1 = max(0, top - 1), min(land.height, bottom + 1)
        regions = ((left, y0, right, y1), ((left - 1) % land.width, y0, (left - 1) % land.width + 1, y1),
                   (right % land.width, y0, right % land.width + 1, y1))
        self.process.stdin.write(struct.pack('<8sIIII', b'PDPCMP03', width, height, int(top > 0), int(bottom < land.height)))
        for image, mode in ((land, 'RGB'), (ocean, 'RGB'), (land_mask, 'L'), (relief, 'L')):
            for region in regions:
                with image.crop(region) as cropped, cropped.convert(mode) as converted:
                    self.process.stdin.write(converted.tobytes())
        self.process.stdin.flush()
        output_size = (width + 2) * (height + 2) * 4
        result = self.process.stdout.read(output_size)
        if len(result) != output_size:
            raise RuntimeError('Native physical composite returned incomplete pixels')
        return Image.frombytes('RGBA', (width + 2, height + 2), result)

class PhysicalWebpEncoder(NativeTileProcess):
    def __init__(self):
        super().__init__(Path(__file__).resolve().parent / 'gis' / 'physical-webp-encoder.mjs')

    def save(self, image: Image.Image, path: Path) -> None:
        if path.exists():
            raise FileExistsError(f'Physical WebP output exists: {path}')
        width, height = image.size
        if image.mode != 'RGBA' or not 1 <= width <= 4098 or not 1 <= height <= 4098 or width * height > 16777216:
            raise ValueError('Bounded physical RGBA tile required')
        self.process.stdin.write(struct.pack('<8sII', b'PWEBP001', width, height))
        self.process.stdin.write(image.tobytes())
        self.process.stdin.flush()
        header = self.process.stdout.read(4)
        if len(header) != 4:
            raise RuntimeError('Native physical WebP encoder returned no size')
        length = struct.unpack('<I', header)[0]
        if not 12 <= length <= width * height * 5 + 1048576:
            raise ValueError('Invalid native physical WebP output size')
        encoded = self.process.stdout.read(length)
        if len(encoded) != length or encoded[:4] != b'RIFF' or encoded[8:12] != b'WEBP':
            raise ValueError('Invalid native physical WebP output')
        with path.open('xb') as stream:
            stream.write(encoded)


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
        with PhysicalCompositor() as compositor, PhysicalWebpEncoder() as encoder:
            for row in range(rows):
                for column in range(columns):
                    box = (
                        column * TILE_SIZE,
                        row * TILE_SIZE,
                        min(width, (column + 1) * TILE_SIZE),
                        min(height, (row + 1) * TILE_SIZE),
                    )
                    packed = compositor.combine(land, ocean, land_mask, gray, box)
                    encoder.save(packed, level_dir / f"{column}-{row}.webp")
                    packed.close()
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
