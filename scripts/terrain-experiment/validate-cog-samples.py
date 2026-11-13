#!/usr/bin/env python3
"""Run GDAL's bundled COG structure validator on exactly the sample files."""
import json
import sys
from pathlib import Path
from osgeo import gdal
from osgeo_utils.samples.validate_cloud_optimized_geotiff import validate

gdal.UseExceptions()
root = Path(sys.argv[1]).resolve(strict=True)
manifest = json.loads((root / 'cog-report.json').read_text(encoding='utf-8'))
results = []
for record in manifest['records']:
    name = f"{record['region']}-block{record['blockSize']}.tif"
    dataset = gdal.Open(str(root / name))
    warnings, errors, details = validate(dataset, full_check=True)
    dataset = None
    results.append({'file': name, 'warnings': warnings, 'errors': errors, 'details': details})
with (root / 'cog-validation.json').open('x', encoding='utf-8') as file:
    json.dump({'gdalVersion': gdal.VersionInfo('RELEASE_NAME'), 'results': results}, file, indent=2)
    file.write('\n')
print(json.dumps({'files': len(results), 'errors': sum(len(x['errors']) for x in results),
                  'warnings': sum(len(x['warnings']) for x in results)}))
if any(result['errors'] for result in results):
    raise SystemExit(1)
