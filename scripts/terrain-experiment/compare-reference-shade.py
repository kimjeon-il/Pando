#!/usr/bin/env python3
"""Compare one original-based shade sample against the fixed v0.14 tiles."""
import gzip
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from osgeo import gdal

gdal.UseExceptions()
root = Path(sys.argv[1]).resolve(strict=True)
data_repository = Path(sys.argv[2]).resolve(strict=True)
revision = '0866eb0aebb35d1355892b808de331b30c5fe52b'
report = json.loads((root / 'sample-report.json').read_text(encoding='utf-8'))
record = next(r for r in report['records'] if r['region']['id'] == 'southwest-china'
              and r['level'] == 5 and r['policy'] == 'Q1')
raw = gzip.decompress((root / 'southwest-china-lod5-Q1.rgba.gz').read_bytes())
if hashlib.sha256(raw).hexdigest() != record['rawSha256']:
    raise ValueError('Sample hash mismatch')
source = np.frombuffer(raw, dtype=np.uint8).reshape(record['height'], record['width'], 4)
x0, y0, x1, y1 = record['window']
differences, identities = [], []
for row in range(y0 // 1024, (y1 - 1) // 1024 + 1):
    for col in range(x0 // 1024, (x1 - 1) // 1024 + 1):
        path = f'terrain/v0.14.0/5/{col}-{row}.webp'
        expected = subprocess.check_output(['git', '-C', str(data_repository), 'rev-parse',
                                            revision + ':' + path], text=True).strip()
        with urlopen(f'https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/{revision}/{path}', timeout=60) as response:
            blob = response.read()
        actual = hashlib.sha1(f'blob {len(blob)}\0'.encode() + blob).hexdigest()
        if actual != expected:
            raise ValueError(f'Committed reference blob mismatch: {path}')
        virtual = f'/vsimem/terrain-reference-{col}-{row}.webp'
        gdal.FileFromMemBuffer(virtual, blob)
        ds = gdal.Open(virtual)
        pixels = np.moveaxis(ds.ReadAsArray(), 0, -1)
        ds = None
        gdal.Unlink(virtual)
        left, right = max(x0, col*1024), min(x1, (col+1)*1024)
        top, bottom = max(y0, row*1024), min(y1, (row+1)*1024)
        local = source[top-y0:bottom-y0, left-x0:right-x0, 2].astype(np.int16)
        # Production tiles contain a one-pixel gutter around the interior.
        ref = pixels[top-row*1024+1:bottom-row*1024+1, left-col*1024+1:right-col*1024+1, 2].astype(np.int16)
        compact = np.minimum(255, ((local + 2) // 4) * 4)
        differences.append((compact - ref).ravel())
        identities.append({'path': path, 'gitBlobSha1': actual, 'bytes': len(blob),
                           'sha256': hashlib.sha256(blob).hexdigest()})
delta = np.concatenate(differences)
result = {'schema': 'pando-terrain-shade-reference-v1', 'revision': revision,
          'sample': 'southwest-china-lod5-Q1', 'reference': identities,
          'sampleCount': int(delta.size), 'mismatchCount': int(np.count_nonzero(delta)),
          'maxAbsoluteByteDifference': int(np.max(np.abs(delta))),
          'meanAbsoluteByteDifference': float(np.mean(np.abs(delta))),
          'comparison': 'Q1 unquantized-original shade compacted to v0.14 4-unit encoding'}
target = root / 'shade-reference-comparison.json'
with target.open('x', encoding='utf-8') as file:
    json.dump(result, file, indent=2)
    file.write('\n')
print(json.dumps(result))
