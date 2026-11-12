#!/usr/bin/env python3
"""Compare only explicit accepted Viewer framebuffer captures."""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
output = Path(sys.argv[1]).resolve()
paths = [Path(value).resolve(strict=True) for value in sys.argv[2:]]
if len(paths) < 2 or output.exists():
    raise ValueError('Expected a new output and at least two frame captures')
images = []
for path in paths:
    blob = path.read_bytes()
    dataset = gdal.Open(str(path))
    pixels = dataset.ReadAsArray()
    if pixels.ndim != 3 or pixels.shape[0] < 3:
        raise ValueError('Expected RGB framebuffer images')
    images.append({'file': path.name, 'sha256': hashlib.sha256(blob).hexdigest(),
                   'width': dataset.RasterXSize, 'height': dataset.RasterYSize,
                   'pixels': pixels[:3].astype(np.int16)})
    dataset = None
reference = images[0]
comparisons = []
for image in images[1:]:
    if image['pixels'].shape != reference['pixels'].shape:
        raise ValueError('Framebuffer dimensions differ')
    diff = np.abs(reference['pixels']-image['pixels'])
    changed = np.any(diff > 2, axis=0)
    y, x = np.where(changed)
    comparisons.append({'reference': reference['file'], 'candidate': image['file'],
                        'meanChannelDifference': float(diff.mean()), 'p95ChannelDifference': float(np.percentile(diff, 95)),
                        'maxChannelDifference': int(diff.max()), 'pixelsOver2': int(changed.sum()),
                        'fractionPixelsOver2': float(changed.mean()),
                        'changedBounds': [int(x.min()), int(y.min()), int(x.max()), int(y.max())] if x.size else None})
report = {'schema': 'pando-terrain-framebuffer-diff-v1',
          'images': [{key: image[key] for key in ('file', 'sha256', 'width', 'height')} for image in images],
          'comparisons': comparisons,
          'limitations': 'Full-scene single-frame comparison; differing asynchronous layers can contribute. Not a terrain-only or temporal stability proof.'}
with output.open('x', encoding='utf-8') as file:
    json.dump(report, file, indent=2)
    file.write('\n')
print(json.dumps({'comparisons': comparisons}))
