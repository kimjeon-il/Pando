#!/usr/bin/env python3
"""Measure lossless codecs on the exact same representative RGBA samples."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
from time import perf_counter

import numpy as np
from osgeo import gdal

gdal.UseExceptions()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('samples', type=Path)
    args = parser.parse_args()
    directory = args.samples.resolve(strict=True)
    report = json.loads((directory / 'sample-report.json').read_text(encoding='utf-8'))
    output = directory / 'codecs'
    output.mkdir()
    rows = []
    for record in report['records']:
        name = f"{record['region']['id']}-lod{record['level']}-{record['policy']}"
        raw = gzip.decompress((directory / (name + '.rgba.gz')).read_bytes())
        if len(raw) != record['rawBytes'] or digest(raw) != record['rawSha256']:
            raise ValueError(f'Input identity mismatch: {name}')
        height, width = record['height'], record['width']
        pixels = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 4)
        memory = gdal.GetDriverByName('MEM').Create('', width, height, 4, gdal.GDT_Byte)
        for index, color in enumerate((gdal.GCI_RedBand, gdal.GCI_GreenBand,
                                       gdal.GCI_BlueBand, gdal.GCI_AlphaBand)):
            band = memory.GetRasterBand(index + 1)
            band.WriteArray(pixels[:, :, index])
            band.SetColorInterpretation(color)
        for driver, extension, options in (('WEBP', 'webp', ['LOSSLESS=YES']),
                                            ('PNG', 'png', ['ZLEVEL=9'])):
            path = output / f'{name}.{extension}'
            if path.exists():
                raise FileExistsError(path)
            start = perf_counter()
            encoded = gdal.GetDriverByName(driver).CreateCopy(str(path), memory, options=options)
            if encoded is None:
                raise RuntimeError(f'{driver} encoding failed: {name}')
            encoded = None
            encode_ms = (perf_counter() - start) * 1000
            start = perf_counter()
            decoded = gdal.Open(str(path), gdal.GA_ReadOnly)
            decoded_pixels = np.moveaxis(decoded.ReadAsArray(), 0, -1)
            # A fully opaque alpha band may be omitted by a lossless encoder.
            # Restore that implicit value before comparing RGBA semantics.
            if decoded_pixels.shape == (height, width, 3) and np.all(pixels[:, :, 3] == 255):
                decoded_pixels = np.concatenate((decoded_pixels,
                    np.full((height, width, 1), 255, dtype=np.uint8)), axis=2)
            actual = decoded_pixels.tobytes()
            decoded = None
            decode_ms = (perf_counter() - start) * 1000
            if actual != raw:
                raise ValueError(f'{driver} did not preserve bytes: {name}')
            stored = path.read_bytes()
            rows.append({'sample': name, 'codec': driver, 'bytes': len(stored),
                         'sha256': digest(stored), 'encodeMs': encode_ms,
                         'decodeMs': decode_ms, 'roundTripSha256': digest(actual)})
    (output / 'codecs-report.json').write_text(json.dumps({
        'schema': 'pando-terrain-sample-codecs-v1',
        'gdalVersion': gdal.VersionInfo('RELEASE_NAME'),
        'sourceSha256': report['sourceSha256'], 'records': rows,
        'timingNote': 'Single local encoder/decoder invocation per sample; not browser performance.'
    }, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'records': len(rows), 'output': str(output)}))


if __name__ == '__main__':
    main()
