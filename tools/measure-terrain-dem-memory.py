"""Measure working-set peak of the full-size tile calculation for every LOD."""

import argparse
import importlib.util
import json
from pathlib import Path

import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT


module = importlib.util.spec_from_file_location('dem_builder', Path(__file__).with_name('build-terrain-dem.py'))
dem = importlib.util.module_from_spec(module)
module.loader.exec_module(dem)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--etopo', required=True, type=Path)
    args = parser.parse_args()
    reports = []
    with rasterio.open(args.etopo) as source:
        dem.validate_source(source)
        for level in dem.levels():
            width, height = level['width'], level['height']
            x1, y1 = min(width, 1024), min(height, 1024)
            with WarpedVRT(source, crs=source.crs,
                           transform=rasterio.transform.from_bounds(-180, -90, 180, 90, width, height),
                           width=width, height=height, resampling=Resampling.average) as vrt:
                values = dem.read_vrt_pixels(vrt, width, height, -2, -2, x1+2, y1+2)
                pixels = dem.encode(values, width, height, -2)[1:-1, 1:-1]
                reports.append({'level': level['id'], 'tileDimensions': list(pixels.shape),
                                'peakWorkingSetBytes': dem.current_working_set()})
                print(json.dumps(reports[-1]), flush=True)
    print(json.dumps({'maximumObservedWorkingSetBytes': max(item['peakWorkingSetBytes'] for item in reports),
                      'scope': 'one representative full-size tile per LOD'}), flush=True)


if __name__ == '__main__':
    main()
