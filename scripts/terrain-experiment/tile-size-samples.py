#!/usr/bin/env python3
"""Encode identical Q1 sample pixels as 512 and 1024 lossless WebP tiles."""
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
source = json.loads((root / 'sample-report.json').read_text(encoding='utf-8'))
out = root / 'tiles'
out.mkdir()
rows = []
for record in source['records']:
    if record['width'] != 1024 or record['height'] != 1024 or record['policy'] != 'Q1':
        raise ValueError('Expected 1024 x 1024 Q1 samples')
    name = f"{record['region']['id']}-lod{record['level']}-Q1"
    raw = gzip.decompress((root / (name + '.rgba.gz')).read_bytes())
    if hashlib.sha256(raw).hexdigest() != record['rawSha256']:
        raise ValueError('Input SHA-256 mismatch')
    original = np.frombuffer(raw, dtype=np.uint8).reshape(1024, 1024, 4)
    for size in (512, 1024):
        for y in range(0, 1024, size):
            for x in range(0, 1024, size):
                tile = original[y:y+size, x:x+size]
                memory = gdal.GetDriverByName('MEM').Create('', size, size, 4, gdal.GDT_Byte)
                for i, interpretation in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand,
                                                      gdal.GCI_BlueBand, gdal.GCI_AlphaBand)):
                    band = memory.GetRasterBand(i+1)
                    band.SetColorInterpretation(interpretation)
                    band.WriteArray(tile[:, :, i])
                path = out / f'{name}-{size}-{x}-{y}.webp'
                start = perf_counter()
                encoded = gdal.GetDriverByName('WEBP').CreateCopy(str(path), memory, options=['LOSSLESS=YES'])
                if encoded is None:
                    raise RuntimeError('WebP encode failed')
                encoded = None
                encode_ms = (perf_counter()-start)*1000
                start = perf_counter()
                decoded = gdal.Open(str(path)).ReadAsArray()
                pixels = np.moveaxis(decoded, 0, -1)
                if pixels.shape[2] == 3:
                    pixels = np.concatenate((pixels, np.full((size, size, 1), 255, dtype=np.uint8)), axis=2)
                decode_ms = (perf_counter()-start)*1000
                if not np.array_equal(pixels, tile):
                    raise ValueError('WebP round trip mismatch')
                blob = path.read_bytes()
                rows.append({'region': record['region']['id'], 'size': size, 'x': x, 'y': y,
                             'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(),
                             'encodeMs': encode_ms, 'decodeMs': decode_ms})
(out / 'tiles-report.json').write_text(json.dumps({'schema': 'pando-terrain-tiles-size-sample-v1',
    'sourceSha256': source['sourceSha256'], 'records': rows,
    'limitations': 'Storage-only samples, no halo or real browser/network timing.'}, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'tiles': len(rows)}))
