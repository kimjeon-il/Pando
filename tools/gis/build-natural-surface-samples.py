#!/usr/bin/env python3
"""Offline representative natural-surface tiles; never rewrites DEM or operating pins.

The first preview uses the NASA BMNG Base Map only. WorldCover, RGI and polar
ice-mask adoption are separate, explicitly unfinished gates. A July image is
not a permanent-snow classification or a reconstruction of historical land.
"""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
from PIL import Image, features

VERSION = '0.1.0-preview.1'
SOURCE_URL = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x21600x10800.jpg'
SOURCE_PAGE = 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/'
SOURCE_SIZE = (21600, 10800)
REGIONS = (
    ('china-southwest', 106.0, 30.0), ('thailand', 100.0, 16.0),
    ('himalaya', 86.0, 28.0), ('sahara', 15.0, 25.0),
    ('amazon', -62.0, -4.0), ('greenland', -44.0, 76.0),
    ('antarctica', 25.0, -82.0), ('netherlands-coast-review', 5.0, 52.0),
    ('australia-arid', 134.0, -25.0),
)

def sha256(data):
    return hashlib.sha256(data).hexdigest()


def grid():
    return [dict(id=i, width=1350 * 2**i, height=675 * 2**i, tileSize=1024,
                 columns=math.ceil(1350 * 2**i / 1024), rows=math.ceil(675 * 2**i / 1024)) for i in range(6)]


def crop_with_gutter(image, left, top, width, height):
    """Cell-center crop; wrap longitude, clamp latitude, retain one gutter texel."""
    out = Image.new('RGB', (width + 2, height + 2))
    # Longitude can wrap at most once for a representative tile. Work in strips
    # instead of materializing another complete global image.
    start_x, start_y = left - 1, top - 1
    y0, y1 = max(0, start_y), min(image.height, start_y + out.height)
    dx = 0
    while dx < out.width:
        sx = (start_x + dx) % image.width
        span = min(out.width - dx, image.width - sx)
        strip = image.crop((sx, y0, sx + span, y1))
        out.paste(strip, (dx, y0 - start_y))
        if start_y < 0:
            out.paste(image.crop((sx, 0, sx + span, 1)), (dx, 0))
        if start_y + out.height > image.height:
            out.paste(image.crop((sx, image.height - 1, sx + span, image.height)), (dx, out.height - 1))
        dx += span
    return out.convert('RGBA')


def self_test():
    image = Image.new('RGB', (8, 4))
    image.putdata([(x * 23, y * 47, (x+y) * 11) for y in range(4) for x in range(8)])
    left = crop_with_gutter(image, 0, 0, 4, 4)
    right = crop_with_gutter(image, 4, 0, 4, 4)
    assert left.size == (6, 6) and right.size == (6, 6)
    for y in range(6):
        assert left.getpixel((5, y)) == right.getpixel((1, y))
        assert left.getpixel((4, y)) == right.getpixel((0, y))
        assert left.getpixel((0, y)) == right.getpixel((4, y))
        assert right.getpixel((5, y)) == left.getpixel((1, y))
    for x in range(6):
        assert left.getpixel((x, 0)) == left.getpixel((x, 1))
        assert left.getpixel((x, 5)) == left.getpixel((x, 4))
    encoded = io.BytesIO()
    left.save(encoded, format='WEBP', lossless=True, quality=80, method=6, exact=True)
    restored = Image.open(io.BytesIO(encoded.getvalue())).convert('RGBA')
    assert restored.tobytes() == left.tobytes()
    assert restored.getchannel('A').getextrema() == (255, 255)
    return {'gutter': True, 'longitudeWrap': True, 'polarClamp': True, 'webpLosslessRoundTrip': True}


def build(source, expected_sha256, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError('Immutable candidate directory already exists; never overwrite')
    if not source.is_file() or source.stat().st_size > 40 * 1024**2:
        raise ValueError('Expected the bounded NASA 21600x10800 JPEG input')
    encoded_source = source.read_bytes()
    digest = sha256(encoded_source)
    if digest != expected_sha256:
        raise ValueError('Source SHA-256 differs from explicit acquisition pin')
    Image.MAX_IMAGE_PIXELS = 300_000_000
    with Image.open(io.BytesIO(encoded_source)) as loaded:
        if loaded.size != SOURCE_SIZE or loaded.format != 'JPEG':
            raise ValueError('Unexpected NASA Base Map dimensions or format')
        image = loaded.convert('RGB')
    output.mkdir(parents=True)
    levels = grid()
    level = levels[4]
    entries, regions, validation = {}, {}, {}
    for name, longitude, latitude in REGIONS:
        column = min(level['columns'] - 1, int((longitude + 180) / 360 * level['width']) // 1024)
        row = min(level['rows'] - 1, int((90 - latitude) / 180 * level['height']) // 1024)
        left, top = column * 1024, row * 1024
        width, height = min(1024, level['width'] - left), min(1024, level['height'] - top)
        key = f'4/{column}-{row}.webp'
        regions[name] = key
        if key in entries:
            continue
        tile = crop_with_gutter(image, left, top, width, height)
        stream = io.BytesIO()
        tile.save(stream, format='WEBP', lossless=True, quality=80, method=6, exact=True)
        data = stream.getvalue()
        decoded = Image.open(io.BytesIO(data)).convert('RGBA')
        if decoded.size != tile.size or decoded.tobytes() != tile.tobytes():
            raise ValueError('Natural surface WebP is not pixel-exact')
        if decoded.getchannel('A').getextrema() != (255, 255):
            raise ValueError('Natural RGB must not hide classification data in alpha')
        path = output / key
        path.parent.mkdir(exist_ok=True)
        with path.open('xb') as handle:
            handle.write(data)
        entries[key] = {'bytes': len(data), 'sha256': sha256(data),
                        'pixelWidth': tile.width, 'pixelHeight': tile.height}
        validation[key] = {'decodedSha256': sha256(decoded.tobytes()),
                           'sourceCropSha256': sha256(tile.tobytes()), 'alpha255': True}
    source_record = {'id': 'nasa-bmng-base-july-2004', 'url': SOURCE_URL,
                     'descriptionUrl': SOURCE_PAGE, 'sha256': digest, 'bytes': len(encoded_source),
                     'observation': '2004-07', 'resolution': '21600x10800; about 2km at equator',
                     'license': 'NASA imagery usage guidelines; credit NASA Earth Observatory'}
    manifest = {'schema': 'pando-natural-surface-v1', 'version': VERSION,
                'pathPrefix': f'terrain/natural/v{VERSION}', 'crs': 'EPSG:4326',
                'extent': [-180, -90, 180, 90], 'registration': 'cell-center', 'gutter': 1,
                'tileFormat': 'lossless WebP RGBA', 'alpha': 255, 'colorSpace': 'sRGB',
                'shadeIncluded': False, 'referenceDate': '2004-07',
                'historicalReconstruction': False, 'status': 'preview', 'mixWeight': 0.65,
                'levels': levels, 'tiles': entries, 'sources': [source_record], 'regions': regions,
                'activation': 'representative preview only; bind sourceRevision to immutable library commit before loading',
                'limitations': ['NASA-only natural-color input; not a complete natural-relief release',
                    'WorldCover, RGI and independent Greenland/Antarctic ice masks not applied',
                    'July 2004 seasonal snow is not permanent ice or historical snow',
                    'Source-water and historical-coast conflict handling require mask validation before operational activation',
                    'No full-resolution world dataset has been generated; only selected LOD4 tiles']}
    receipt = {'sourceSha256': digest, 'sourceHashPolicy': 'acquisition digest, not an official NASA published checksum',
               'tileCount': len(entries), 'tileBytes': sum(entry['bytes'] for entry in entries.values()),
               'checks': self_test(), 'pixels': validation, 'webpVersion': features.version('webp'),
               'operationalPinChanged': False, 'DEMModified': False}
    for filename, value in [('manifest.json', manifest), ('generation-receipt.json', receipt)]:
        with (output / filename).open('x', encoding='utf8') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source')
    parser.add_argument('--source-sha256')
    parser.add_argument('--output')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test()))
        return
    if not all((args.source, args.source_sha256, args.output)):
        parser.error('--source, --source-sha256 and --output are required')
    print(json.dumps(build(args.source, args.source_sha256, args.output), indent=2))


if __name__ == '__main__':
    main()
