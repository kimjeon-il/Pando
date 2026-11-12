#!/usr/bin/env python3
"""Produce a regional COG with source-derived Q1 pyramid, not packed overviews."""
import gzip
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from osgeo import gdal, osr
from osgeo_utils.samples.validate_cloud_optimized_geotiff import validate

gdal.UseExceptions()
source = Path(sys.argv[1]).resolve(strict=True)
output = Path(sys.argv[2]).resolve()
meta = json.loads((source / 'pyramid-input.json').read_text(encoding='utf-8'))
if meta['schema'] != 'pando-terrain-cog-pyramid-input-v1' or [r['level'] for r in meta['records']] != [5, 4, 3]:
    raise ValueError('Unexpected source pyramid')
layers = []
for rec in meta['records']:
    raw = gzip.decompress((source / rec['file']).read_bytes())
    if len(raw) != rec['rawBytes'] or hashlib.sha256(raw).hexdigest() != rec['rawSha256']:
        raise ValueError('Pyramid input identity mismatch')
    layers.append(np.frombuffer(raw, dtype=np.uint8).reshape(rec['height'], rec['width'], 4))
output.mkdir()
width, height = meta['records'][0]['width'], meta['records'][0]['height']
memory = gdal.GetDriverByName('MEM').Create('', width, height, 3, gdal.GDT_Byte)
x, y = meta['baseOrigin']
memory.SetGeoTransform((-180+x/120, 1/120, 0, 90-y/120, 0, -1/120))
spatial = osr.SpatialReference()
spatial.ImportFromEPSG(4326)
memory.SetProjection(spatial.ExportToWkt())
for channel, color in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand, gdal.GCI_BlueBand)):
    band = memory.GetRasterBand(channel+1)
    band.SetColorInterpretation(color)
    band.WriteArray(layers[0][:, :, channel])
memory.BuildOverviews('NEAREST', [2, 4])
for channel in range(3):
    for level in (1, 2):
        memory.GetRasterBand(channel+1).GetOverview(level-1).WriteArray(layers[level][:, :, channel])
path = output / 'regional-q1.tif'
dataset = gdal.GetDriverByName('COG').CreateCopy(str(path), memory, options=[
    'BLOCKSIZE=512', 'COMPRESS=DEFLATE', 'PREDICTOR=STANDARD', 'OVERVIEWS=FORCE_USE_EXISTING'])
if dataset is None:
    raise RuntimeError('COG generation failed')
dataset = None
dataset = gdal.Open(str(path))
for channel in range(3):
    band = dataset.GetRasterBand(channel+1)
    if band.GetOverviewCount() != 2:
        raise ValueError('Expected two source-derived overviews')
    for level in (0, 1, 2):
        actual = (band if level == 0 else band.GetOverview(level-1)).ReadAsArray()
        if not np.array_equal(actual, layers[level][:, :, channel]):
            raise ValueError('COG changed source-derived pixels')
warnings, errors, details = validate(dataset, full_check=True)
dataset = None
if errors:
    raise ValueError(f'COG structure errors: {errors}')
blob = path.read_bytes()
chunk_size = 65536
report = {'schema': 'pando-terrain-cog-viewer-fixture-v1', 'sourceSha256': meta['sourceSha256'], 'region': meta.get('region', 'southwest-china'),
          'baseOrigin': meta['baseOrigin'], 'filename': path.name, 'bytes': len(blob),
          'sha256': hashlib.sha256(blob).hexdigest(), 'chunkBytes': chunk_size,
          'chunks': [hashlib.sha256(blob[i:i+chunk_size]).hexdigest() for i in range(0, len(blob), chunk_size)],
          'pyramidInputSha256': [r['rawSha256'] for r in meta['records']],
          'gdalVersion': gdal.VersionInfo('RELEASE_NAME'), 'validation': {'warnings': warnings, 'errors': errors, 'details': details}}
(output / 'manifest.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'bytes': len(blob), 'sha256': report['sha256'], 'chunks': len(report['chunks']), 'warnings': warnings}))
