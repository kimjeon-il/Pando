"""Build the optional ETOPO 2022 Ice Surface terrain tiles outside the repository.

Example (rasterio, numpy and Pillow required):
  python tools/build-terrain-dem.py --etopo ETOPO_2022_v1_30s_N90W180_surface.tif \
      --tint-zip HYP_HR.zip --glaciated-areas ne_10m_glaciated_areas.geojson \
      --countries assets/data/countries-ne-5.1.1.geojson \
      --output F:/map-editor-dem-0.13.0/terrain/v0.13.2

The source is read in windows. No full-resolution elevation array is kept in RAM.
The manifest is published only after every tile has been encoded and verified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
from pathlib import Path
import tempfile
import time
import zipfile

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.features import bounds, geometry_mask
from rasterio.fill import fillnodata
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window


VERSION = "0.13.2"
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
SHADE_QUANTIZATION_STEP = 4
ETOPO_SHA256 = '8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2'
TINT_SHA256 = '29ba984a14d96c3d745065b096eccf0a21207718d8549341c955c64b150e3e09'
ICE_SHA256 = '04fd2303d5f0ece2cf482af19d06731d745db9690501d7b0a2a4b7fe23a7726f'
TINT_ALGORITHM = 'canonical-land-average-nearest-fill-v2'
ICE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/693f11422f4e08d2da4566b854dda53eb7c39fb3/geojson/ne_10m_glaciated_areas.geojson'


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


def quantize_shade(values):
    # Preserve the full elevation channels; only the motion-phase shade may
    # differ by at most two of 255 display steps.
    rounded = ((values.astype(np.uint16) + SHADE_QUANTIZATION_STEP // 2)
               // SHADE_QUANTIZATION_STEP) * SHADE_QUANTIZATION_STEP
    return np.minimum(rounded, 255).astype(np.uint8)


def encode(elevation, level_width, level_height, north_pixel_row):
    if not np.isfinite(elevation).all() or elevation.min() < -BIAS or elevation.max() > 65535-BIAS:
        raise ValueError('Elevation outside valid encoding range')
    packed = np.rint(elevation).astype(np.int32) + BIAS
    rgba = np.empty((*packed.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = (packed >> 8).astype(np.uint8)
    rgba[:, :, 1] = (packed & 255).astype(np.uint8)
    original_shade = shade(elevation, level_width, level_height, north_pixel_row)
    compact_shade = quantize_shade(original_shade)
    # Polar gutters lie outside the world grid. Coarse LODs clamp to the
    # adjacent real row; at finer LODs retain the computed polar shade.
    world_rows = north_pixel_row + np.arange(original_shade.shape[0])
    north_gutters = world_rows < 0
    south_gutters = world_rows >= level_height
    if level_height <= 1350:
        if np.any(north_gutters):
            compact_shade[north_gutters] = compact_shade[np.flatnonzero(world_rows == 0)[0]]
        if np.any(south_gutters):
            compact_shade[south_gutters] = compact_shade[np.flatnonzero(world_rows == level_height-1)[0]]
    else:
        polar_gutters = north_gutters | south_gutters
        compact_shade[polar_gutters] = original_shade[polar_gutters]
    rgba[:, :, 2] = compact_shade
    rgba[:, :, 3] = 255
    return rgba


def save_and_verify_webp(rgba, path):
    image = Image.fromarray(rgba, "RGBA")
    image.save(path, "WEBP", lossless=True, exact=True, method=6)
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


def restore_polar_gutter_shade(output: Path, etopo_path: Path, min_level=0, max_level=5):
    """Refresh only out-of-grid polar shade after a generator upgrade."""
    modified = 0
    with rasterio.open(etopo_path) as source:
        validate_source(source)
        for level in levels():
            if level['id'] < min_level or level['id'] > max_level:
                continue
            width, height = level['width'], level['height']
            if height <= 1350:
                for row in sorted({0, level['rows']-1}):
                    for column in range(level['columns']):
                        path = output/str(level['id'])/f'{column}-{row}.webp'
                        with Image.open(path) as image:
                            pixels = np.array(image.convert('RGBA'))
                        prior = pixels[:, :, 2].copy()
                        if row == 0:
                            pixels[0, :, 2] = pixels[1, :, 2]
                        if row == level['rows']-1:
                            pixels[-1, :, 2] = pixels[-2, :, 2]
                        if not np.array_equal(prior, pixels[:, :, 2]):
                            save_and_verify_webp(pixels, path)
                            modified += 1
                print(json.dumps({'level': level['id'], 'polarShadeRestoredTiles': modified}), flush=True)
                continue
            with WarpedVRT(source, crs=source.crs,
                           transform=rasterio.transform.from_bounds(-180, -90, 180, 90, width, height),
                           width=width, height=height, resampling=Resampling.average) as vrt:
                for row in sorted({0, level['rows']-1}):
                    for column in range(level['columns']):
                        x0, y0 = column*TILE_SIZE, row*TILE_SIZE
                        x1, y1 = min(width, x0+TILE_SIZE), min(height, y0+TILE_SIZE)
                        elevation = read_vrt_pixels(vrt, width, height, x0-2, y0-2, x1+2, y1+2)
                        original_shade = shade(elevation, width, height, y0-2)[1:-1, 1:-1]
                        path = output/str(level['id'])/f'{column}-{row}.webp'
                        with Image.open(path) as image:
                            pixels = np.array(image.convert('RGBA'))
                        prior = pixels[:, :, 2].copy()
                        if row == 0:
                            pixels[0, :, 2] = original_shade[0]
                        if row == level['rows']-1:
                            pixels[-1, :, 2] = original_shade[-1]
                        if not np.array_equal(prior, pixels[:, :, 2]):
                            save_and_verify_webp(pixels, path)
                            modified += 1
                        del elevation, original_shade, pixels, prior
            print(json.dumps({'level': level['id'], 'polarShadeRestoredTiles': modified}), flush=True)
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


def tint_validity(rgb, protected_ice, land, land_interior):
    """HYP_HR white water background is not an elevation NoData value.

    Colours outside canonical land cannot be land-colour donors, even when
    coastal resampling made the water background slightly less than white.
    Keep white ice, and nearly white snow inside canonical land.
    """
    # Near-white edge samples can still be water blended into a sub-pixel
    # island. Keep bright interior snow; independent ice protection wins.
    near_white = np.min(rgb, axis=0) >= 230
    reliable_colour = np.any(rgb != 255, axis=0) & (~near_white | land_interior)
    return (land & reliable_colour) | protected_ice


def fill_tint_background(rgb, valid):
    """Derive missing colours from surrounding valid tint, never from DEM.

    Ocean tint is display-only padding: the renderer's country mask decides
    where it is used. Wrap longitude so islands near 180 degrees use neighbours
    across the seam. Existing valid colours (including white ice) are untouched.
    """
    if not valid.any():
        raise ValueError('Tint has no valid land colours')
    if tuple(map(int, rasterio.__gdal_version__.split('.')[:2])) < (3, 9):
        raise RuntimeError('Nearest tint fill requires GDAL 3.9 or later')
    width = valid.shape[1]
    wrapped_valid = np.tile(valid, (1, 3)).astype(np.uint8)
    result = rgb.astype(np.float32, copy=True)
    for channel in range(3):
        values = np.where(valid, rgb[channel], np.nan).astype(np.float32)
        filled = fillnodata(np.tile(values, (1, 3)), mask=wrapped_valid,
                            max_search_distance=width, smoothing_iterations=0,
                            interpolation='nearest')
        result[channel] = filled[:, width:2*width]
    if not np.isfinite(result).all():
        raise ValueError('Tint regional fill left unresolved cells')
    return np.clip(np.rint(result), 0, 255).astype(np.uint8)


def resample_tint(source, ice_geometries, land_geometries, output, width=2048, height=1024):
    # A temporary masked raster keeps full-resolution arrays off the heap.
    # The source mask makes GDAL average only valid colours, so small islands
    # are not diluted by the white water background.
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        masked_path = Path(temporary)/'masked-tint.tif'
        with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True, GDAL_CACHEMAX=64*1024*1024):
            with rasterio.open(masked_path, 'w', driver='GTiff', count=3,
                               width=source.width, height=source.height, dtype='uint8',
                               crs=source.crs, transform=source.transform,
                               compress='deflate', tiled=True) as masked:
                for y in range(0, source.height, 128):
                    window = Window(0, y, source.width, min(128, source.height-y))
                    rgb = source.read([1, 2, 3], window=window)
                    north = source.xy(y, 0, offset='ul')[1]
                    south = source.xy(y+window.height, 0, offset='ul')[1]
                    relevant = [geometry for geometry, bounds in ice_geometries
                                if bounds[1] <= north and bounds[3] >= south]
                    ice = geometry_mask(relevant, rgb.shape[1:], source.window_transform(window),
                                        invert=True, all_touched=True) if relevant else np.zeros(rgb.shape[1:], dtype=bool)
                    start = max(0, y-1)
                    end = min(source.height, y+int(window.height)+1)
                    mask_window = Window(0, start, source.width, end-start)
                    mask_north = source.xy(start, 0, offset='ul')[1]
                    mask_south = source.xy(end, 0, offset='ul')[1]
                    relevant_land = [geometry for geometry, extent in land_geometries
                                     if extent[1] <= mask_north and extent[3] >= mask_south]
                    # Pixel centres must be on land. all_touched would admit
                    # the mostly-water fringe we are specifically excluding.
                    land = geometry_mask(relevant_land, (end-start, source.width), source.window_transform(mask_window),
                                         invert=True) if relevant_land else np.zeros((end-start, source.width), dtype=bool)
                    interior = land.copy()
                    for dx in (-1, 0, 1):
                        neighbor = np.pad(np.roll(land, dx, axis=1), ((1, 1), (0, 0)), mode='edge')
                        for dy in (-1, 0, 1):
                            interior &= neighbor[1+dy:1+dy+len(land)]
                    offset = y-start
                    land = land[offset:offset+int(window.height)]
                    interior = interior[offset:offset+int(window.height)]
                    valid = tint_validity(rgb, ice, land, interior)
                    masked.write(rgb, window=window)
                    masked.write_mask(valid.astype(np.uint8)*255, window=window)
            with rasterio.open(masked_path) as masked:
                averaged = masked.read(out_shape=(3, height, width), masked=True,
                                       resampling=Resampling.average)
                valid = ~np.ma.getmaskarray(averaged).any(axis=0)
                repaired = fill_tint_background(averaged.astype(np.float32).filled(np.nan), valid)
    image = Image.fromarray(np.transpose(repaired, (1, 2, 0)), 'RGB')
    image.save(output, 'WEBP', lossless=True, method=4)
    with Image.open(output) as decoded:
        if not np.array_equal(np.asarray(decoded.convert('RGB')), np.transpose(repaired, (1, 2, 0))):
            raise ValueError('Tint WebP round-trip mismatch')
    return {'algorithm': TINT_ALGORITHM, 'validCells': int(valid.sum()),
            'regionalFillCells': int((~valid).sum())}


def build_tint(tint_zip: Path, output: Path, ice_path: Path, countries_path: Path):
    # HYP_HR is the Natural Earth tint without pre-rendered relief shading.
    with zipfile.ZipFile(tint_zip) as archive:
        tiffs = [name for name in archive.namelist() if name.lower().endswith((".tif", ".tiff"))]
        if len(tiffs) != 1:
            raise ValueError(f"Expected one HYP_HR TIFF in ZIP, got {tiffs}")
        # Extraction is disk-backed; do not hold the 700 MB source TIFF in RAM.
        tiff_path = Path(archive.extract(tiffs[0], tint_zip.parent))
    ice_source = json.loads(ice_path.read_text(encoding='utf-8'))
    ice_geometries = [(feature['geometry'], bounds(feature['geometry']))
                      for feature in ice_source['features']]
    if not ice_geometries:
        raise ValueError('Glaciated-area protection mask is empty')
    countries = json.loads(countries_path.read_text(encoding='utf-8'))
    if countries.get('type') != 'FeatureCollection' or not countries.get('features'):
        raise ValueError('Canonical country land mask is empty or invalid')
    ids = [feature['id'] for feature in countries['features']]
    if len(set(ids)) != len(ids):
        raise ValueError('Canonical country land mask has duplicate IDs')
    land_geometries = []
    for feature in countries['features']:
        geometry = feature['geometry']
        if geometry['type'] not in ('Polygon', 'MultiPolygon'):
            raise ValueError('Canonical country land mask requires polygon geometry')
        polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
        for coordinates in polygons:
            polygon = {'type': 'Polygon', 'coordinates': coordinates}
            land_geometries.append((polygon, bounds(polygon)))
    with rasterio.open(tiff_path) as source:
        if source.width < 2048 or source.height < 1024 or source.count < 3:
            raise ValueError("Natural Earth tint is smaller than 2048x1024 RGB")
        if source.crs is None or source.crs.to_epsg() != 4326 or any(
                abs(a-b) > 1e-7 for a, b in zip(source.bounds, [-180, -90, 180, 90])):
            raise ValueError('Tint source grid is not global EPSG:4326')
        report = resample_tint(source, ice_geometries, land_geometries, output)
    return dict(report, sourceEntry=tiffs[0], iceSourceSha256=sha256(ice_path),
                landMaskSourceSha256=sha256(countries_path))


def rebuild_tint_release(source_output: Path, tint_zip: Path, ice_path: Path, countries_path: Path, output: Path):
    """Publish a new immutable dataset locally, copying every DEM tile unchanged."""
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite dataset: {output}')
    if sha256(tint_zip) != TINT_SHA256 or sha256(ice_path) != ICE_SHA256:
        raise ValueError('Tint or glaciated-area source checksum mismatch')
    manifest = json.loads((source_output/'manifest.json').read_text(encoding='utf-8'))
    if manifest['representation'] != FORMAT or manifest['version'] == VERSION:
        raise ValueError('Expected an earlier DEM dataset to copy')
    output.mkdir(parents=True)
    started = time.monotonic()
    tint = build_tint(tint_zip, output/'tint.webp', ice_path, countries_path)
    # Checksum the source dataset before copying; no decoded tile is modified.
    source_assets, _ = asset_summary(source_output, manifest['levels'])
    if source_assets != manifest['assetsSha256']:
        raise ValueError('Source DEM dataset checksum mismatch')
    for level in manifest['levels']:
        shutil.copytree(source_output/str(level['id']), output/str(level['id']))
    manifest['version'] = VERSION
    manifest['urlTemplate'] = f'terrain/v{VERSION}/{{level}}/{{column}}-{{row}}.webp'
    manifest['tint'] = dict(tint, url=f'terrain/v{VERSION}/tint.webp', width=2048,
                            height=1024, sha256=sha256(output/'tint.webp'))
    # Reusing an earlier tint release must not accumulate source records.
    manifest['sources'] = [source for source in manifest['sources']
                           if source.get('url') != ICE_URL and source.get('role') != 'canonical-country-land-mask']
    manifest['sources'].extend([
        {'url': ICE_URL, 'sha256': sha256(ice_path), 'bytes': ice_path.stat().st_size},
        {'role': 'canonical-country-land-mask', 'path': countries_path.name,
         'sha256': sha256(countries_path), 'bytes': countries_path.stat().st_size},
    ])
    manifest['assetsSha256'], reports = asset_summary(output, manifest['levels'])
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    report = {'completed': True, 'copiedFromVersion': json.loads((source_output/'manifest.json').read_text(encoding='utf-8'))['version'],
              'demTilesUnchanged': True, 'tint': tint, 'levelReports': reports,
              'totalBytes': sum(item['bytes'] for item in reports) + (output/'tint.webp').stat().st_size,
              'manifestSha256': sha256(output/'manifest.json'),
              'seconds': round(time.monotonic()-started, 3), 'peakWorkingSetBytes': current_working_set()}
    (output/'build-report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report), flush=True)


def build(etopo_path: Path, tint_zip: Path, output: Path, ice_path: Path, countries_path: Path):
    started = time.monotonic()
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite dataset: {output}')
    if not etopo_path.is_file() or not tint_zip.is_file():
        raise FileNotFoundError("ETOPO GeoTIFF and Natural Earth HYP_HR.zip are required")
    output.mkdir(parents=True, exist_ok=True)
    source_sha = sha256(etopo_path)
    tint_sha = sha256(tint_zip)
    if source_sha != ETOPO_SHA256 or tint_sha != TINT_SHA256 or sha256(ice_path) != ICE_SHA256:
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
    tint_report = build_tint(tint_zip, tint_path, ice_path, countries_path)
    peak_working_set = max(peak_working_set, current_working_set())
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
                  "ambient": AMBIENT, "diffuse": DIFFUSE, "polarFallbackDegrees": 89.5,
                  "quantizationStep": SHADE_QUANTIZATION_STEP},
        "gutter": 1, "tileSize": TILE_SIZE, "levels": levels(),
        "urlTemplate": f"terrain/v{VERSION}/{{level}}/{{column}}-{{row}}.webp",
        "tint": {"url": f"terrain/v{VERSION}/tint.webp", "width": 2048, "height": 1024,
                 "sha256": sha256(tint_path), **tint_report},
        "sources": [
            {"url": "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/30s/30s_surface_elev_gtif/ETOPO_2022_v1_30s_N90W180_surface.tif",
             "sha256": source_sha, "bytes": etopo_path.stat().st_size, "nodata": source_nodata,
             "dtype": source_dtype, "width": SOURCE_WIDTH, "height": SOURCE_HEIGHT},
            {"url": "https://naturalearth.s3.amazonaws.com/10m_raster/HYP_HR.zip",
             "sha256": tint_sha, "bytes": tint_zip.stat().st_size},
            {"url": ICE_URL,
             "sha256": sha256(ice_path), "bytes": ice_path.stat().st_size},
            {"role": "canonical-country-land-mask", "path": countries_path.name,
             "sha256": sha256(countries_path), "bytes": countries_path.stat().st_size},
        ],
        "assetsSha256": assets_sha,
    }
    temporary = output / "manifest.json.tmp"
    temporary.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2)+"\n").encode("utf-8"))
    temporary.replace(output / "manifest.json")
    report = {"completed": True, "totalBytes": sum(item["bytes"] for item in level_reports)
              + tint_path.stat().st_size, "seconds": round(time.monotonic()-started, 3),
              "peakWorkingSetBytes": peak_working_set, "levelReports": level_reports,
              "manifestSha256": sha256(output / "manifest.json")}
    (output / "build-report.json").write_bytes((json.dumps(report, indent=2)+"\n").encode("utf-8"))
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
    parser.add_argument("--glaciated-areas", type=Path)
    parser.add_argument("--countries", type=Path)
    parser.add_argument("--reuse-dem", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repair-output", action="store_true")
    parser.add_argument("--repair-polar-min-level", type=int, default=0)
    parser.add_argument("--repair-polar-max-level", type=int, default=5)
    args = parser.parse_args()
    if args.reuse_dem:
        if not args.tint_zip or not args.glaciated_areas or not args.countries:
            parser.error('--reuse-dem requires --tint-zip, --glaciated-areas and --countries')
        rebuild_tint_release(args.reuse_dem, args.tint_zip, args.glaciated_areas, args.countries, args.output)
    elif args.repair_output:
        manifest_path = args.output/'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        previous_report_path = args.output/'build-report.json'
        previous_report = json.loads(previous_report_path.read_text(encoding='utf-8')) if previous_report_path.exists() else {}
        if args.etopo:
            restore_polar_gutter_shade(args.output, args.etopo, args.repair_polar_min_level, args.repair_polar_max_level)
        for level in manifest['levels']:
            print(json.dumps({'level': level['id'], 'reconciledTiles': reconcile_gutters(args.output, level)}), flush=True)
        assets_sha, reports = asset_summary(args.output, manifest['levels'])
        old_generation = manifest.pop('generation', {})
        manifest['assetsSha256'] = assets_sha
        manifest_path.write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
        report = {'completed': True, 'totalBytes': sum(item['bytes'] for item in reports)
                  +(args.output/'tint.webp').stat().st_size,
                  'seconds': previous_report.get('seconds', old_generation.get('seconds')),
                  'peakWorkingSetBytes': previous_report.get('peakWorkingSetBytes', old_generation.get('peakWorkingSetBytes')),
                  'levelReports': [dict(report, seconds=previous_report.get('levelReports', old_generation.get('levelReports', [{}]*len(reports)))[index].get('seconds'))
                                   for index, report in enumerate(reports)],
                  'manifestSha256': sha256(manifest_path)}
        (args.output/'build-report.json').write_bytes((json.dumps(report, indent=2)+'\n').encode('utf-8'))
        print(json.dumps(report), flush=True)
    else:
        if not args.etopo or not args.tint_zip or not args.glaciated_areas or not args.countries:
            parser.error('--etopo, --tint-zip, --glaciated-areas and --countries are required for generation')
        build(args.etopo, args.tint_zip, args.output, args.glaciated_areas, args.countries)


if __name__ == "__main__":
    main()
