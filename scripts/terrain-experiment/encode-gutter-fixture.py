#!/usr/bin/env python3
"""Encode and byte-check the same guttered Q1 fixtures as lossless WebP."""
import gzip
import hashlib
import json
import sys
from pathlib import Path
from time import perf_counter
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
root = Path(sys.argv[1]).resolve(strict=True)
manifest = json.loads((root / 'gutter-report.json').read_text(encoding='utf-8'))
out = root / 'webp'
out.mkdir()
rows = []
for record in manifest['records']:
    raw = gzip.decompress((root / record['file']).read_bytes())
    if len(raw) != record['rawBytes'] or hashlib.sha256(raw).hexdigest() != record['rawSha256']:
        raise ValueError('Gutter input identity mismatch')
    w, h = record['width'], record['height']
    rgba = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 4)
    if not np.all(rgba[:, :, 3] == 255):
        raise ValueError('Expected opaque DEM samples')
    memory = gdal.GetDriverByName('MEM').Create('', w, h, 4, gdal.GDT_Byte)
    for index, color in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand,
                                   gdal.GCI_BlueBand, gdal.GCI_AlphaBand)):
        band = memory.GetRasterBand(index + 1)
        band.SetColorInterpretation(color)
        band.WriteArray(rgba[:, :, index])
    name = record['file'].removesuffix('.rgba.gz') + '.webp'
    path = out / name
    start = perf_counter()
    encoded = gdal.GetDriverByName('WEBP').CreateCopy(str(path), memory, options=['LOSSLESS=YES'])
    if encoded is None:
        raise RuntimeError('WebP encoding failed')
    encoded = None
    encode_ms = (perf_counter() - start) * 1000
    decoded = gdal.Open(str(path))
    pixels = np.moveaxis(decoded.ReadAsArray(), 0, -1)
    decoded = None
    if pixels.shape == (h, w, 3):
        pixels = np.concatenate((pixels, np.full((h, w, 1), 255, dtype=np.uint8)), axis=2)
    if not np.array_equal(pixels, rgba):
        raise ValueError('WebP decode changed gutter bytes')
    blob = path.read_bytes()
    rows.append({**record, 'file': name, 'webpBytes': len(blob),
                 'webpSha256': hashlib.sha256(blob).hexdigest(), 'encodeMs': encode_ms})
with (out / 'manifest.json').open('x', encoding='utf-8') as file:
    json.dump({'schema': 'pando-terrain-gutter-webp-v1', 'sourceSha256': manifest['sourceSha256'],
               'gdalVersion': gdal.VersionInfo('RELEASE_NAME'), 'records': rows}, file, indent=2)
    file.write('\n')
print(json.dumps({'verifiedTiles': len(rows)}))
