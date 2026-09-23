"""Build the optional ETOPO 2022 Ice Surface terrain tiles outside the repository.

Example (rasterio, numpy and Pillow required):
  python tools/build-terrain-dem.py --etopo ETOPO_2022_v1_30s_N90W180_surface.tif \
      --tint-zip HYP_HR.zip --output F:/map-editor-dem-0.13.0/output

The source is read in windows. No full-resolution elevation array is kept in RAM.
The manifest is published only after every tile has been encoded and verified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import time
import zipfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window


VERSION = "0.13.0"
FORMAT = "dem-relief-v1"
TILE_SIZE = 1024
BIAS = 12000
SOURCE_WIDTH = 43200
SOURCE_HEIGHT = 21600
RADIUS_METERS = 6371008.8
LIGHT_AZIMUTH = 315.0
LIGHT_ALTITUDE = 45.0
AMBIENT = 0.42
DIFFUSE = 0.58
ETOPO_SHA256 = '8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2'
TINT_SHA256 = '29ba984a14d96c3d745065b096eccf0a21207718d8549341c955c64b150e3e09'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def levels():
    return [
        {"id": index, "width": 1350 * (2 ** index), "height": 675 * (2 ** index),
         "columns": math.ceil(1350 * (2 ** index) / TILE_SIZE),
         "rows": math.ceil(675 * (2 ** index) / TILE_SIZE), "tileSize": TILE_SIZE}
        for index in range(6)
    ]


def validate_source(source):
    transform = source.transform
    expected = rasterio.transform.from_bounds(-180, -90, 180, 90, SOURCE_WIDTH, SOURCE_HEIGHT)
    if source.width != SOURCE_WIDTH or source.height != SOURCE_HEIGHT:
        raise ValueError(f"ETOPO 30s cell grid expected {SOURCE_WIDTH}x{SOURCE_HEIGHT}, got {source.width}x{source.height}")
    # NOAA encodes geographic WGS84 plus EGM2008 height as compound EPSG:9518.
    if source.crs is None or source.crs.to_epsg() != 9518:
        raise ValueError(f"Expected WGS84 + EGM2008 height (EPSG:9518), got {source.crs}")
    if any(abs(a-b) > 1e-8 for a, b in zip(tuple(transform)[:6], tuple(expected)[:6])):
        raise ValueError(f"Grid origin/resolution mismatch: {transform} != {expected}")
    if source.nodata is None or not math.isfinite(source.nodata):
        raise ValueError(f"Source NoData marker missing: {source.nodata}")
    if source.count != 1:
        raise ValueError(f"Expected one elevation band, got {source.count}")
    if source.tags().get('AREA_OR_POINT') != 'Area':
        raise ValueError('Expected cell-registered ETOPO GeoTIFF')


def read_vrt_pixels(vrt, width, height, x0, y0, x1, y1):
    """Read target LOD pixels, wrapping longitude and clamping pole rows.

    A rasterio VRT performs area averaging in source elevation units before
    the integer packing step. At the source LOD this is a direct pixel read.
    """
    target_width, target_height = x1 - x0, y1 - y0
    output = np.empty((target_height, target_width), dtype=np.float32)
    start_y, end_y = max(0, y0), min(height, y1)
    start_x = 0
    while start_x < target_width:
        source_x = (x0 + start_x) % width
        count = min(target_width - start_x, width - source_x)
        part = vrt.read(1, window=Window(source_x, start_y, count, end_y-start_y), masked=True)
        if np.any(np.ma.getmaskarray(part)):
            raise ValueError(f"ETOPO NoData at level pixel {source_x},{start_y}")
        output[start_y-y0:end_y-y0, start_x:start_x+count] = np.asarray(part, dtype=np.float32)
        start_x += count
    if y0 < 0:
        output[:start_y-y0, :] = output[start_y-y0, :]
    if y1 > height:
        output[end_y-y0:, :] = output[end_y-y0-1, :]
    if not np.isfinite(output).all():
        raise ValueError(f"Non-finite elevation at {x0},{y0}")
    if output.min() < -BIAS or output.max() > 65535-BIAS:
        raise ValueError(f"Elevation outside 16-bit encoding range at {x0},{y0}: {output.min()}..{output.max()}")
    return output


def shade(elevation, level_width, level_height, north_pixel_row):
    # Elevation includes a one-cell gutter; shade the entire encoded tile.
    h_west = np.concatenate((elevation[:, :1], elevation[:, :-1]), axis=1)
    h_east = np.concatenate((elevation[:, 1:], elevation[:, -1:]), axis=1)
    h_north = np.concatenate((elevation[:1, :], elevation[:-1, :]), axis=0)
    h_south = np.concatenate((elevation[1:, :], elevation[-1:, :]), axis=0)
    row = np.arange(elevation.shape[0], dtype=np.float64) + north_pixel_row
    latitude = 90.0 - (row + 0.5) * 180.0 / level_height
    latitude = np.clip(latitude, -89.95, 89.95)
    meters_east = 2 * math.pi * RADIUS_METERS * np.cos(np.deg2rad(latitude)) / level_width
    meters_north = math.pi * RADIUS_METERS / level_height
    dz_east = (h_east-h_west) / (2 * meters_east[:, None])
    dz_north = (h_north-h_south) / (2 * meters_north)
    norm = np.sqrt(dz_east**2 + dz_north**2 + 1)
    azimuth = math.radians(LIGHT_AZIMUTH)
    altitude = math.radians(LIGHT_ALTITUDE)
    lx = math.sin(azimuth) * math.cos(altitude)
    ly = math.cos(azimuth) * math.cos(altitude)
    lz = math.sin(altitude)
    diffuse = np.maximum(0, (-dz_east*lx-dz_north*ly+lz) / norm)
    return np.rint(np.clip(AMBIENT + DIFFUSE * diffuse, 0, 1) * 255).astype(np.uint8)


def encode(elevation, level_width, level_height, north_pixel_row):
    if not np.isfinite(elevation).all() or elevation.min() < -BIAS or elevation.max() > 65535-BIAS:
        raise ValueError('Elevation outside valid encoding range')
    packed = np.rint(elevation).astype(np.int32) + BIAS
    rgba = np.empty((*packed.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = (packed >> 8).astype(np.uint8)
    rgba[:, :, 1] = (packed & 255).astype(np.uint8)
    rgba[:, :, 2] = shade(elevation, level_width, level_height, north_pixel_row)
    rgba[:, :, 3] = 255
    return rgba


def save_and_verify_webp(rgba, path):
    image = Image.fromarray(rgba, "RGBA")
    image.save(path, "WEBP", lossless=True, exact=True, method=4)
    with Image.open(path) as decoded:
        if not np.array_equal(np.asarray(decoded.convert("RGBA")), rgba):
            path.unlink(missing_ok=True)
            raise ValueError(f"WebP channel round-trip changed bytes: {path}")


def reconcile_gutters(output: Path, level):
    """Use the *published* neighboring interior texel for every gutter.

    GDAL may round the same averaged output pixel differently when it is read
    through two overlapping source windows. This pass makes the encoded gutter
    bit-identical to its owner tile, including the dateline and corners.
    """
    columns, rows = level['columns'], level['rows']
    edges = {}
    for row in range(rows):
        for column in range(columns):
            path = output/str(level['id'])/f'{column}-{row}.webp'
            with Image.open(path) as image:
                pixels = np.asarray(image.convert('RGBA'))
            edges[column, row] = {
                'left': pixels[:, 1, :].copy(), 'right': pixels[:, -2, :].copy(),
                'top': pixels[1, :, :].copy(), 'bottom': pixels[-2, :, :].copy(),
                'topGutter': pixels[0, 1:-1, :].copy(),
                'bottomGutter': pixels[-1, 1:-1, :].copy(),
            }
    modified = 0
    for row in range(rows):
        north, south = max(0, row-1), min(rows-1, row+1)
        for column in range(columns):
            west, east = (column-1) % columns, (column+1) % columns
            path = output/str(level['id'])/f'{column}-{row}.webp'
            with Image.open(path) as image:
                pixels = np.array(image.convert('RGBA'))
            prior = pixels.copy()
            pixels[1:-1, 0] = edges[west, row]['right'][1:-1]
            pixels[1:-1, -1] = edges[east, row]['left'][1:-1]
            if row:
                pixels[0, 1:-1] = edges[column, north]['bottom'][1:-1]
            if row < rows-1:
                pixels[-1, 1:-1] = edges[column, south]['top'][1:-1]
            pixels[0, 0] = edges[west, north]['bottom'][-2] if row else edges[west, row]['topGutter'][-1]
            pixels[0, -1] = edges[east, north]['bottom'][1] if row else edges[east, row]['topGutter'][0]
            pixels[-1, 0] = edges[west, south]['top'][-2] if row < rows-1 else edges[west, row]['bottomGutter'][-1]
            pixels[-1, -1] = edges[east, south]['top'][1] if row < rows-1 else edges[east, row]['bottomGutter'][0]
            if not np.array_equal(prior, pixels):
                save_and_verify_webp(pixels, path)
                modified += 1
    return modified


def asset_summary(output: Path, level_definitions):
    asset_digest = hashlib.sha256()
    reports = []
    for level in level_definitions:
        sizes = []
        for row in range(level['rows']):
            for column in range(level['columns']):
                path = output/str(level['id'])/f'{column}-{row}.webp'
                sizes.append(path.stat().st_size)
                asset_digest.update(path.relative_to(output).as_posix().encode())
                asset_digest.update(bytes.fromhex(sha256(path)))
        reports.append({'level': level['id'], 'tileCount': len(sizes),
                        'bytes': sum(sizes), 'maxTileBytes': max(sizes)})
    tint_path = output/'tint.webp'
    asset_digest.update(bytes.fromhex(sha256(tint_path)))
    return asset_digest.hexdigest(), reports


def build_tint(tint_zip: Path, output: Path):
    # HYP_HR is the Natural Earth tint without pre-rendered relief shading.
    with zipfile.ZipFile(tint_zip) as archive:
        tiffs = [name for name in archive.namelist() if name.lower().endswith((".tif", ".tiff"))]
        if len(tiffs) != 1:
            raise ValueError(f"Expected one HYP_HR TIFF in ZIP, got {tiffs}")
        # Extraction is disk-backed; do not hold the 700 MB source TIFF in RAM.
        tiff_path = Path(archive.extract(tiffs[0], tint_zip.parent))
    with rasterio.open(tiff_path) as source:
        if source.width < 2048 or source.height < 1024 or source.count < 3:
            raise ValueError("Natural Earth tint is smaller than 2048x1024 RGB")
        rgb = source.read([1, 2, 3], out_shape=(3, 1024, 2048), resampling=Resampling.average)
        tint = Image.fromarray(np.transpose(rgb, (1, 2, 0)).astype(np.uint8), "RGB")
        tint.save(output, "WEBP", lossless=True, method=4)
    return tiffs[0]


def build(etopo_path: Path, tint_zip: Path, output: Path):
    started = time.monotonic()
    if not etopo_path.is_file() or not tint_zip.is_file():
        raise FileNotFoundError("ETOPO GeoTIFF and Natural Earth HYP_HR.zip are required")
    output.mkdir(parents=True, exist_ok=True)
    source_sha = sha256(etopo_path)
    tint_sha = sha256(tint_zip)
    if source_sha != ETOPO_SHA256 or tint_sha != TINT_SHA256:
        raise ValueError(f'Source checksum mismatch: ETOPO={source_sha}, tint={tint_sha}')
    level_reports = []
    peak_working_set = 0
    with rasterio.open(etopo_path) as source:
        validate_source(source)
        source_nodata, source_dtype = source.nodata, source.dtypes[0]
        for level in levels():
            level_start = time.monotonic()
            width, height = level["width"], level["height"]
            level_dir = output / str(level["id"])
            level_dir.mkdir(exist_ok=True)
            # VRT maps to the same global bounds. Its average resampling uses
            # source elevations; no packed RG image is ever resized.
            with WarpedVRT(source, crs=source.crs,
                           transform=rasterio.transform.from_bounds(-180, -90, 180, 90, width, height),
                           width=width, height=height,
                           resampling=Resampling.average) as vrt:
                sizes = []
                for row in range(level["rows"]):
                    for column in range(level["columns"]):
                        x0, y0 = column*TILE_SIZE, row*TILE_SIZE
                        x1, y1 = min(width, x0+TILE_SIZE), min(height, y0+TILE_SIZE)
                        # The second temporary neighbor lets the encoded B
                        # value of the delivered 1px gutter equal the actual
                        # neighboring tile's own hillshade, not an edge copy.
                        elevation = read_vrt_pixels(vrt, width, height, x0-2, y0-2, x1+2, y1+2)
                        rgba = encode(elevation, width, height, y0-2)[1:-1, 1:-1]
                        path = level_dir / f"{column}-{row}.webp"
                        save_and_verify_webp(rgba, path)
                        peak_working_set = max(peak_working_set, current_working_set())
                        sizes.append(path.stat().st_size)
            report = {"level": level["id"], "tileCount": len(sizes), "bytes": sum(sizes),
                      "maxTileBytes": max(sizes), "seconds": round(time.monotonic()-level_start, 3)}
            level_reports.append(report)
            print(json.dumps(report), flush=True)
    tint_path = output / "tint.webp"
    tint_entry = build_tint(tint_zip, tint_path)
    for level in levels():
        changed = reconcile_gutters(output, level)
        level_reports[level['id']]['reconciledTiles'] = changed
    assets_sha, final_reports = asset_summary(output, levels())
    for report, final in zip(level_reports, final_reports):
        report['bytes'] = final['bytes']
        report['maxTileBytes'] = final['maxTileBytes']
    manifest = {
        "version": VERSION, "representation": FORMAT,
        "dataset": "ETOPO 2022 30 arc-second Ice Surface",
        "crs": "EPSG:4326", "heightDatum": "EGM2008 (EPSG:3855)",
        "sourceCrs": "EPSG:9518", "extent": [-180, -90, 180, 90],
        "registration": "cell-center", "sourceGridOrigin": [-180, 90],
        "sourceResolutionDegrees": [1/120, 1/120],
        "tileFormat": "lossless WebP RGBA", "channels": {"r": "encoded elevation high byte",
            "g": "encoded elevation low byte", "b": "precomputed hillshade", "a": "255"},
        "elevation": {"encode": "round(meters)+12000", "decode": "R*256+G-12000",
                      "biasMeters": BIAS, "spacingMeters": 1, "validEncodedRange": [0, 65535]},
        "shade": {"azimuthDegrees": LIGHT_AZIMUTH, "altitudeDegrees": LIGHT_ALTITUDE,
                  "ambient": AMBIENT, "diffuse": DIFFUSE, "polarFallbackDegrees": 89.5},
        "gutter": 1, "tileSize": TILE_SIZE, "levels": levels(),
        "urlTemplate": f"terrain/v{VERSION}/{{level}}/{{column}}-{{row}}.webp",
        "tint": {"url": f"terrain/v{VERSION}/tint.webp", "width": 2048, "height": 1024,
                 "sha256": sha256(tint_path), "sourceEntry": tint_entry},
        "sources": [
            {"url": "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/30s/30s_surface_elev_gtif/ETOPO_2022_v1_30s_N90W180_surface.tif",
             "sha256": source_sha, "bytes": etopo_path.stat().st_size, "nodata": source_nodata,
             "dtype": source_dtype, "width": SOURCE_WIDTH, "height": SOURCE_HEIGHT},
            {"url": "https://naturalearth.s3.amazonaws.com/10m_raster/HYP_HR.zip",
             "sha256": tint_sha, "bytes": tint_zip.stat().st_size},
        ],
        "assetsSha256": assets_sha,
    }
    temporary = output / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    temporary.replace(output / "manifest.json")
    report = {"completed": True, "totalBytes": sum(item["bytes"] for item in level_reports)
              + tint_path.stat().st_size, "seconds": round(time.monotonic()-started, 3),
              "peakWorkingSetBytes": peak_working_set, "levelReports": level_reports,
              "manifestSha256": sha256(output / "manifest.json")}
    (output / "build-report.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report), flush=True)


def current_working_set():
    if os.name != "nt":
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t)]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    ctypes.windll.psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    process = ctypes.windll.kernel32.GetCurrentProcess()
    if not ctypes.windll.psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb):
        return 0
    return counters.PeakWorkingSetSize


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--etopo", type=Path)
    parser.add_argument("--tint-zip", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repair-output", action="store_true")
    args = parser.parse_args()
    if args.repair_output:
        manifest_path = args.output/'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        for level in manifest['levels']:
            print(json.dumps({'level': level['id'], 'reconciledTiles': reconcile_gutters(args.output, level)}), flush=True)
        assets_sha, reports = asset_summary(args.output, manifest['levels'])
        old_generation = manifest.pop('generation', {})
        manifest['assetsSha256'] = assets_sha
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        report = {'completed': True, 'totalBytes': sum(item['bytes'] for item in reports)
                  +(args.output/'tint.webp').stat().st_size,
                  'seconds': old_generation.get('seconds'),
                  'peakWorkingSetBytes': old_generation.get('peakWorkingSetBytes') or None,
                  'levelReports': [dict(report, seconds=old_generation.get('levelReports', [{}]*len(reports))[index].get('seconds'))
                                   for index, report in enumerate(reports)],
                  'manifestSha256': sha256(manifest_path)}
        (args.output/'build-report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
        print(json.dumps(report), flush=True)
    else:
        if not args.etopo or not args.tint_zip:
            parser.error('--etopo and --tint-zip are required for generation')
        build(args.etopo, args.tint_zip, args.output)


if __name__ == "__main__":
    main()
