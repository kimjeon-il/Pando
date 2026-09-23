"""Verify the complete Git-external dem-relief-v1 tile set once after building."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import Window


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4*1024*1024), b''):
            digest.update(chunk)
    return digest.digest()


def rgba(path):
    with Image.open(path) as image:
        return np.asarray(image.convert('RGBA'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--etopo', required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.output/'manifest.json').read_text(encoding='utf-8'))
    if manifest['representation'] != 'dem-relief-v1' or manifest['version'] != '0.13.0':
        raise ValueError('Unexpected DEM version or format')
    if digest_file(args.etopo).hex() != manifest['sources'][0]['sha256']:
        raise ValueError('Source checksum mismatch')
    asset_digest = hashlib.sha256()
    reports = []
    with rasterio.open(args.etopo) as source:
        for level in manifest['levels']:
            level_id, width, height, tile_size = (level[key] for key in ('id', 'width', 'height', 'tileSize'))
            total_bytes = 0
            maximum = 0
            count = 0
            previous_row = {}
            for row in range(level['rows']):
                previous_right = None
                next_row = {}
                for column in range(level['columns']):
                    path = args.output/str(level_id)/f'{column}-{row}.webp'
                    pixels = rgba(path)
                    interior_width = min(tile_size, width-column*tile_size)
                    interior_height = min(tile_size, height-row*tile_size)
                    if pixels.shape != (interior_height+2, interior_width+2, 4):
                        raise ValueError(f'Wrong tile size: {path}: {pixels.shape}')
                    if np.any(pixels[:, :, 3] != 255):
                        raise ValueError(f'Non-opaque DEM alpha: {path}')
                    if previous_right is not None and not np.array_equal(previous_right, pixels[:, 1]):
                        raise ValueError(f'Horizontal gutter mismatch before {path}')
                    if column in previous_row and not np.array_equal(previous_row[column], pixels[1, :]):
                        raise ValueError(f'Vertical gutter mismatch before {path}')
                    previous_right = pixels[:, -1].copy()
                    next_row[column] = pixels[-1, :].copy()
                    if column == 0:
                        west_interior = pixels[:, 1].copy()
                    if column == level['columns']-1 and not np.array_equal(previous_right, west_interior):
                        raise ValueError(f'Dateline gutter mismatch at LOD {level_id} row {row}')
                    if level_id == 5 and (column, row) in {(0, 0), (21, 5), (42, 10), (3, 17)}:
                        x, y = column*tile_size, row*tile_size
                        actual = float(source.read(1, window=Window(x, y, 1, 1))[0, 0])
                        decoded = int(pixels[1, 1, 0])*256+int(pixels[1, 1, 1])-12000
                        if decoded != round(actual):
                            raise ValueError(f'ETOPO elevation mismatch {path}: {decoded} != {actual}')
                    asset_digest.update(path.relative_to(args.output).as_posix().encode())
                    asset_digest.update(digest_file(path))
                    total_bytes += path.stat().st_size
                    maximum = max(maximum, path.stat().st_size)
                    count += 1
                previous_row = next_row
            reports.append({'level': level_id, 'tiles': count, 'bytes': total_bytes, 'maxTileBytes': maximum})
    tint_path = args.output/'tint.webp'
    with Image.open(tint_path) as tint:
        if tint.size != (2048, 1024):
            raise ValueError('Wrong tint size')
    if digest_file(tint_path).hex() != manifest['tint']['sha256']:
        raise ValueError('Tint checksum mismatch')
    asset_digest.update(digest_file(tint_path))
    if asset_digest.hexdigest() != manifest['assetsSha256']:
        raise ValueError('DEM asset checksum mismatch')
    print(json.dumps({'verified': True, 'levels': reports, 'totalBytes':
        sum(item['bytes'] for item in reports)+tint_path.stat().st_size}, indent=2))


if __name__ == '__main__':
    main()
