#!/usr/bin/env python3
"""Create COG storage fixtures with independently sourced, quantized LODs."""
import gzip
import hashlib
import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()
roots = [Path(x).resolve(strict=True) for x in sys.argv[1:4]]
out = Path(sys.argv[4]).resolve()
reports = [json.loads((root / 'sample-report.json').read_text(encoding='utf-8')) for root in roots]
if len({r['sourceSha256'] for r in reports}) != 1:
    raise ValueError('Different source identities')
out.mkdir()
rows = []
for region in ('thai-lowland', 'southwest-china', 'netherlands-coast'):
    layers = []
    for root, report, level, size in zip(roots, reports, (5, 4, 3), (1024, 512, 256)):
        rec = next(r for r in report['records'] if r['region']['id'] == region and r['level'] == level and r['policy'] == 'Q1')
        if (rec['width'], rec['height']) != (size, size):
            raise ValueError('Unexpected dimensions')
        raw = gzip.decompress((root / f'{region}-lod{level}-Q1.rgba.gz').read_bytes())
        if hashlib.sha256(raw).hexdigest() != rec['rawSha256']:
            raise ValueError('Input identity mismatch')
        layers.append((rec, np.frombuffer(raw, dtype=np.uint8).reshape(size, size, 4)))
    full_window = layers[0][0]['window']
    for i in (1, 2):
        if any(full_window[j] != layers[i][0]['window'][j]*(2**i) for j in range(4)):
            raise ValueError('Source-derived LOD windows do not cover the same extent')
    mem = gdal.GetDriverByName('MEM').Create('', 1024, 1024, 3, gdal.GDT_Byte)
    x0, y0 = full_window[:2]
    mem.SetGeoTransform((-180 + x0/120, 1/120, 0, 90-y0/120, 0, -1/120))
    spatial = osr.SpatialReference()
    spatial.ImportFromEPSG(4326)
    mem.SetProjection(spatial.ExportToWkt())
    for i, color in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand)):
        band = mem.GetRasterBand(i+1)
        band.SetColorInterpretation(color)
        band.WriteArray(layers[0][1][:, :, i])
    mem.BuildOverviews('NEAREST', [2, 4])
    # Overwrite the allocation-only overviews with separately read and
    # quantized original Float32 LODs; never downsample packed heights.
    for channel in range(3):
        for level in (1, 2):
            mem.GetRasterBand(channel+1).GetOverview(level-1).WriteArray(layers[level][1][:, :, channel])
    for block in (256, 512):
        target = out / f'{region}-block{block}.tif'
        start = perf_counter()
        cog = gdal.GetDriverByName('COG').CreateCopy(str(target), mem, options=[
            f'BLOCKSIZE={block}', 'COMPRESS=DEFLATE', 'PREDICTOR=STANDARD', 'OVERVIEWS=FORCE_USE_EXISTING'])
        if cog is None:
            raise RuntimeError('COG generation failed')
        cog = None
        encode_ms = (perf_counter()-start)*1000
        dataset = gdal.Open(str(target))
        for channel in range(3):
            band = dataset.GetRasterBand(channel+1)
            if band.GetOverviewCount() != 2:
                raise ValueError('Expected two source-derived overviews')
            for level in (0, 1, 2):
                actual = (band if level == 0 else band.GetOverview(level-1)).ReadAsArray()
                if not np.array_equal(actual, layers[level][1][:, :, channel]):
                    raise ValueError('COG changed source-derived pixels')
        dataset = None
        blob = target.read_bytes()
        rows.append({'region': region, 'blockSize': block, 'bytes': len(blob),
                     'sha256': hashlib.sha256(blob).hexdigest(), 'encodeMs': encode_ms,
                     'overviewSourceSha256': [x[0]['rawSha256'] for x in layers]})
(out / 'cog-report.json').write_text(json.dumps({'schema': 'pando-terrain-cog-sample-v1',
    'sourceSha256': reports[0]['sourceSha256'], 'gdalVersion': gdal.VersionInfo('RELEASE_NAME'),
    'records': rows, 'limitations': 'Storage fixture only; no browser decoder, renderer, CORS validation or performance result.'}, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'fixtures': len(rows)}))
