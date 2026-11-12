#!/usr/bin/env python3
"""Rasterize only the experiment region from the pinned physical-land geometry."""
import gzip
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
compressed = sys.stdin.buffer.read()
expected = sys.argv[1]
x0, y0 = int(sys.argv[2]), int(sys.argv[3])
output = Path(sys.argv[4]).resolve()
if hashlib.sha256(compressed).hexdigest() != expected:
    raise ValueError('Physical-land asset hash mismatch')
geometry = gzip.decompress(compressed)
feature = b'{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":' + geometry + b'}]}'
gdal.FileFromMemBuffer('/vsimem/pando-experiment-land.json', feature)
source = ogr.Open('/vsimem/pando-experiment-land.json')
if source is None:
    raise RuntimeError('Cannot read pinned physical-land geometry')
size = 2050
mask = gdal.GetDriverByName('MEM').Create('', size, size, 1, gdal.GDT_Byte)
mask.SetGeoTransform((-180+(x0-1)/120, 1/120, 0, 90-(y0-1)/120, 0, -1/120))
spatial = osr.SpatialReference()
spatial.ImportFromEPSG(4326)
mask.SetProjection(spatial.ExportToWkt())
mask.GetRasterBand(1).Fill(0)
if gdal.RasterizeLayer(mask, [1], source.GetLayer(0), burn_values=[255], options=['ALL_TOUCHED=FALSE']) != 0:
    raise RuntimeError('Physical-land mask rasterization failed')
pixels = mask.ReadAsArray()
unique = np.unique(pixels)
if not set(unique.tolist()).issubset({0, 255}) or len(unique) != 2:
    raise ValueError('Expected both land and ocean in this region')
output.mkdir()
path = output / 'physical-land-mask.png'
png = gdal.GetDriverByName('PNG').CreateCopy(str(path), mask, options=['ZLEVEL=9'])
if png is None:
    raise RuntimeError('Mask PNG creation failed')
png = None
decoded = gdal.Open(str(path)).ReadAsArray()
if not np.array_equal(decoded, pixels):
    raise ValueError('Mask PNG changed coverage')
blob = path.read_bytes()
report = {'schema': 'pando-regional-physical-land-mask-v1', 'sourceSha256': expected,
          'sourceDecodedSha256': hashlib.sha256(geometry).hexdigest(), 'origin': [x0-1, y0-1],
          'size': [size, size], 'file': path.name, 'bytes': len(blob),
          'sha256': hashlib.sha256(blob).hexdigest(), 'landPixels': int(np.count_nonzero(pixels)),
          'oceanPixels': int(pixels.size-np.count_nonzero(pixels)),
          'method': 'GDAL polygon center rasterization at the regional 30-arc-second pixel grid; no antialiasing'}
(output / 'manifest.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
source = None
gdal.Unlink('/vsimem/pando-experiment-land.json')
print(json.dumps(report))
