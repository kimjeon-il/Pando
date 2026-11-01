"""Build the optional ETOPO 2022 Ice Surface terrain tiles outside the repository.

Example (Node and the source-bound native DEM tools required):
  node scripts/gis/run-source.mjs --task terrain-dem --execute -- --etopo ETOPO_2022_v1_30s_N90W180_surface.tif \
      --tint-zip HYP_HR.zip --glaciated-areas ne_10m_glaciated_areas.geojson \
      --countries assets/data/countries-ne-5.1.1.geojson \
      --output F:/map-editor-dem-0.13.0/terrain/v0.13.3

The source is read in windows. No full-resolution elevation array is kept in RAM.
The manifest is published only after every tile has been encoded and verified.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
from pathlib import Path
import time



VERSION = "0.13.3"
TINT_WIDTH = 4096
TINT_HEIGHT = 2048
FORMAT = "dem-relief-v1"
TILE_SIZE = 1024
BIAS = 12000
SOURCE_WIDTH = 43200
SOURCE_HEIGHT = 21600
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
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-assets.mjs'
    result = subprocess.run(['node', str(script), '--file', str(path)], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('DEM file hashing failed: ' + result.stderr.decode('utf-8', errors='replace'))
    return json.loads(result.stdout)['sha256']


def levels():
    return [
        {"id": index, "width": 1350 * (2 ** index), "height": 675 * (2 ** index),
         "columns": math.ceil(1350 * (2 ** index) / TILE_SIZE),
         "rows": math.ceil(675 * (2 ** index) / TILE_SIZE), "tileSize": TILE_SIZE}
        for index in range(6)
    ]


def inspect_source(path: Path):
    """Validate ETOPO metadata using the source-bound native GDAL reader."""
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-raster.mjs'
    result = subprocess.run(['node', str(script), '--inspect', str(path)], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=60,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Native ETOPO inspection failed: ' + result.stderr.decode('utf-8', errors='replace'))
    metadata = json.loads(result.stdout)
    if (set(metadata) != {'width', 'height', 'nodata', 'dtype'} or metadata['width'] != SOURCE_WIDTH or
            metadata['height'] != SOURCE_HEIGHT or not isinstance(metadata['nodata'], (int, float)) or
            not math.isfinite(metadata['nodata']) or not isinstance(metadata['dtype'], str)):
        raise ValueError('Invalid native ETOPO inspection receipt')
    return metadata


def reconcile_gutters(output: Path, level):
    """Use the published neighboring interior texels for every gutter."""
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-gutters.mjs'
    result = subprocess.run(['node', str(script), str(output), json.dumps(level)], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=7200,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('DEM gutter reconciliation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(result.stdout)
    if set(receipt) != {'modified'} or not isinstance(receipt['modified'], int) or receipt['modified'] < 0:
        raise ValueError('Invalid DEM gutter reconciliation receipt')
    return receipt['modified']


def restore_polar_gutter_shade(output: Path, etopo_path: Path, min_level=0, max_level=5):
    """Refresh polar shade through the source-bound native gutter owner."""
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-gutters.mjs'
    request = dict(output=str(output), source=str(etopo_path), levels=levels(),
                   minLevel=min_level, maxLevel=max_level)
    result = subprocess.run(['node', str(script), '--polar'], input=json.dumps(request).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('DEM polar shade repair failed: ' + result.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(result.stdout)
    if set(receipt) != {'modified'} or not isinstance(receipt['modified'], int) or receipt['modified'] < 0:
        raise ValueError('Invalid DEM polar shade repair receipt')
    return receipt['modified']


def asset_summary(output: Path, level_definitions):
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-assets.mjs'
    result = subprocess.run(['node', str(script), '--output', str(output), '--levels', json.dumps(level_definitions)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('DEM asset summary failed: ' + result.stderr.decode('utf-8', errors='replace'))
    summary = json.loads(result.stdout)
    return summary['assetsSha256'], summary['reports']


def build_tint(tint_zip: Path, output: Path, ice_path: Path, countries_path: Path):
    """Prepare Natural Earth tint through the Node and native GDAL owner."""
    if output.exists() or output.is_symlink():
        raise FileExistsError(f'Refusing to overwrite tint output: {output}')
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-tint.mjs'
    request = dict(archive=str(tint_zip.resolve()), ice=str(ice_path.resolve()), land=str(countries_path.resolve()),
                   temporaryRoot=str(output.parent.resolve()), width=TINT_WIDTH, height=TINT_HEIGHT)
    result = subprocess.run(['node', str(script), '--zip-stream'], input=json.dumps(request).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2100,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('Native tint sampling failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if len(result.stdout) < 24 or result.stdout[:8] != b'PDTZIP01':
        raise ValueError('Invalid native tint receipt')
    size = struct.unpack_from('<I', result.stdout, 8)[0]
    if size > 65536 or 12 + size + 12 > len(result.stdout):
        raise ValueError('Invalid native tint receipt length')
    metadata = json.loads(result.stdout[12:12+size])
    encoded = result.stdout[12+size:]
    if encoded[:4] != b'RIFF' or encoded[8:12] != b'WEBP':
        raise ValueError('Invalid native tint WebP')
    if (set(metadata) != {'validCells', 'regionalFillCells', 'sourceEntry', 'iceSourceSha256', 'landMaskSourceSha256'} or
            not isinstance(metadata['validCells'], int) or not isinstance(metadata['regionalFillCells'], int) or
            metadata['validCells'] < 0 or metadata['regionalFillCells'] < 0 or
            not isinstance(metadata['sourceEntry'], str) or not metadata['sourceEntry'] or
            any(not isinstance(metadata[name], str) or len(metadata[name]) != 64 or
                any(char not in '0123456789abcdef' for char in metadata[name])
                for name in ('iceSourceSha256', 'landMaskSourceSha256')) or
            metadata['validCells'] + metadata['regionalFillCells'] != TINT_WIDTH*TINT_HEIGHT):
        raise ValueError('Invalid native tint cell counts')
    created = False
    try:
        with output.open('xb') as stream:
            created = True
            stream.write(encoded)
    except BaseException:
        if created:
            output.unlink(missing_ok=True)
        raise
    return {'algorithm': TINT_ALGORITHM, **metadata}


def generate_level(etopo_path: Path, output: Path, level):
    """Generate one level using the Node manager and source-bound native tools."""
    script = Path(__file__).resolve().parent / 'gis/terrain-dem-build.mjs'
    result = subprocess.run(['node', str(script), '--level', str(etopo_path), str(output), json.dumps(level)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('DEM level generation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    report = json.loads(result.stdout)
    if (set(report) != {'level', 'tileCount', 'bytes', 'maxTileBytes', 'seconds'} or
            report['level'] != level['id'] or report['tileCount'] != level['rows']*level['columns'] or
            any(not isinstance(report[key], int) or report[key] < 1 for key in ('bytes', 'maxTileBytes')) or
            not isinstance(report['seconds'], (int, float)) or not math.isfinite(report['seconds']) or report['seconds'] < 0):
        raise ValueError('Invalid DEM level generation receipt')
    return report


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
    manifest['tint'] = dict(tint, url=f'terrain/v{VERSION}/tint.webp', width=TINT_WIDTH,
                            height=TINT_HEIGHT, sha256=sha256(output/'tint.webp'))
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
    source_metadata = inspect_source(etopo_path)
    source_nodata, source_dtype = source_metadata['nodata'], source_metadata['dtype']
    for level in levels():
        report = generate_level(etopo_path, output, level)
        peak_working_set = max(peak_working_set, current_working_set())
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
        "tint": {"url": f"terrain/v{VERSION}/tint.webp", "width": TINT_WIDTH, "height": TINT_HEIGHT,
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
    from library_data import library_output
    with library_output([args.output]):
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
