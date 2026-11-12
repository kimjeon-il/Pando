#!/usr/bin/env python3
"""Pack and verify a bounded Pando 2:1 tile sample using official PMTiles v3."""
import hashlib
import json
import math
import sys
from pathlib import Path

if len(sys.argv) != 4:
    raise SystemExit('Expected official wheel, fixture WebP directory and new output directory')
wheel, source, output = map(Path, sys.argv[1:])
wheel, source, output = wheel.resolve(strict=True), source.resolve(strict=True), output.resolve()
expected_wheel = '718561bb21f8c7dd5464fdcc3b9ad0e7b1c917be60ddfdf9a5ab56b8c67f7bde'
if hashlib.sha256(wheel.read_bytes()).hexdigest() != expected_wheel:
    raise ValueError('Unexpected PMTiles wheel')
sys.path.insert(0, str(wheel))
from pmtiles.reader import Reader, MemorySource
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
if manifest.get('schema') != 'pando-terrain-gutter-webp-v1':
    raise ValueError('Unexpected fixture manifest')
output.mkdir()
results = []
for size in (1024, 512):
    records = [r for r in manifest['records'] if r['region'] == 'southwest-china' and r['tileSize'] == size]
    if len(records) != (4 if size == 1024 else 16):
        raise ValueError('Expected a 2x2 original-block sample')
    columns, rows = math.ceil(43200 / size), math.ceil(21600 / size)
    zoom = math.ceil(math.log2(columns))
    entries = []
    for item in records:
        x = (item['window'][0] + item['offset'][0]) // size
        y = (item['window'][1] + item['offset'][1]) // size
        tile = (source / item['file']).read_bytes()
        if len(tile) != item['webpBytes'] or hashlib.sha256(tile).hexdigest() != item['webpSha256']:
            raise ValueError('Fixture tile identity mismatch')
        entries.append((zxy_to_tileid(zoom, x, y), x, y, tile, item['webpSha256']))
    entries.sort(key=lambda entry: entry[0])
    archive = output / f'china-{size}.pmtiles'
    with archive.open('xb') as file:
        writer = Writer(file)
        for tile_id, _, _, tile, _ in entries:
            writer.write_tile(tile_id, tile)
        writer.finalize({'tile_compression': Compression.NONE, 'tile_type': TileType.WEBP},
                        {'name': 'Pando regional terrain experiment', 'projection': 'EPSG:4326',
                         'addressing': 'Pando equirectangular grid, not standard Web Mercator XYZ',
                         'sourceLevel': 5, 'tileSize': size, 'columns': columns, 'rows': rows})
    data = archive.read_bytes()
    reader = Reader(MemorySource(data))
    for _, x, y, _, expected in entries:
        restored = reader.get(zoom, x, y)
        if restored is None or hashlib.sha256(restored).hexdigest() != expected:
            raise ValueError('PMTiles tile differs from input')
    if reader.get(zoom, 0, 0) is not None:
        raise ValueError('Unexpected tile outside regional sample')
    payload = sum(len(entry[3]) for entry in entries)
    results.append({'tileSize': size, 'sourceLevel': 5, 'archiveZoom': zoom, 'worldColumns': columns,
                    'worldRows': rows, 'squareCapacity': (2 ** zoom) ** 2,
                    'worldGridSlots': columns * rows, 'unusedSquareSlots': (2 ** zoom) ** 2 - columns * rows,
                    'tiles': len(entries), 'payloadBytes': payload, 'archiveBytes': len(data),
                    'overheadBytes': len(data) - payload, 'sha256': hashlib.sha256(data).hexdigest(),
                    'allTileHashesMatch': True})
report = {'schema': 'pando-pmtiles-regional-sample-v1', 'sourceSha256': manifest['sourceSha256'],
          'pmtilesVersion': '3.8.1', 'wheelSha256': expected_wheel, 'results': results,
          'limitations': ['Regional sample at one LOD; not a complete global pyramid.',
                          'Coordinates address a custom EPSG:4326 grid, not standard Web Mercator XYZ.',
                          'Local packaging and roundtrip only, not an HTTP/browser performance test.']}
(output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results))
