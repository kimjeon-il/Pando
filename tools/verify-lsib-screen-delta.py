"""Independently bound source/display Hausdorff distance on supplemented sections."""
import argparse
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import zipfile
import shapely
from shapely.geometry import LineString, Point
from shapely.ops import substring

SCALE = 2560 * 64 / 360
STEP = .001  # Any position on a segment lies <= STEP/2 from a sampled point.


def native_screen(operation, request):
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    payload = json.dumps(request, allow_nan=False).encode('utf-8')
    result = subprocess.run(['node', str(script), operation], input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('Native LSIB screen operation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    return json.loads(result.stdout)


def sampled_distance(source, target):
    receipt = native_screen('--sampled-stream', dict(source=list(source.coords), target=list(target.coords)))
    if not isinstance(receipt.get('samples'), int) or receipt['samples'] < 2:
        raise ValueError('Invalid native LSIB sample count')
    return float(receipt['sampledMaximumCssPx']), receipt['samples']


def display_section(geometry, anchors, reference):
    try:
        receipt = native_screen('--display-stream', dict(geometry=geometry, anchors=anchors, reference=list(reference.coords)))
    except RuntimeError as error:
        if 'Closed boundary review requires' in str(error) or 'Supplement anchor not found' in str(error):
            raise ValueError(str(error)) from error
        raise
    return LineString(receipt['coordinates'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--pair', help='Restrict a diagnostic run to one CODE/CODE pair')
    args = parser.parse_args()
    if not os.environ.get('PANDO_TERRITORIAL_RECIPE_BINARY'):
        parser.error('PANDO_TERRITORIAL_RECIPE_BINARY must locate the native GEOS engine')
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('lsib_source', root / 'tools/supplement-lsib-boundaries.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    archive_bytes = Path(args.archive).read_bytes()
    provenance = json.loads((root / 'tools/historical-library/sources/lsib-11.4/provenance.json').read_text(encoding='utf-8'))
    if hashlib.sha256(archive_bytes).hexdigest() != provenance['archiveSha256']:
        raise ValueError('LSIB archive does not match the pinned evidence revision')
    outer = zipfile.ZipFile(io.BytesIO(archive_bytes))
    inner = zipfile.ZipFile(io.BytesIO(outer.read(next(n for n in outer.namelist() if n.endswith('.zip')))))
    records = module.read_shapefile(inner.read(next(n for n in inner.namelist() if n.endswith('.dbf'))), inner.read(next(n for n in inner.namelist() if n.endswith('.shp'))))
    by_id = {r['properties']['ID']: r['line'] for r in records}
    candidate = json.loads(Path(args.candidate).read_text(encoding='utf-8'))
    entities = {}
    results = []
    for entry in candidate['boundaries']:
        if args.pair and '/'.join(entry['countries']) != args.pair:
            continue
        if entry['status'] == 'withheld':
            continue
        closed = any(segment.get('closedRing') for segment in entry['segments'])
        code = entry['segments'][0]['enclave'] if closed else entry['countries'][0]
        if code not in entities:
            e = json.loads((root / f'assets/data/territorial-entities/source/countries/state-{code}.json').read_text(encoding='utf-8'))
            entities[code] = next(v['geometry'] for v in e['geometryVersions'] if v['versionId'] == e['metadata']['representativeGeometryVersionId'])
        if entry.get('kind') == 'coastline':
            coasts, metadata = module.reviewed_coast_reference(root, entry['referenceManifest'])
            source = coasts[entry['referenceRole']]
            provenance = {'sourceId': metadata['sourceId'], 'referenceManifest': metadata['referenceManifest']}
        elif 'referenceManifest' in entry:
            source, metadata = module.reviewed_reference(root, entry['referenceManifest'])
            provenance = {'sourceId': metadata['sourceId'], 'referenceManifest': metadata['referenceManifest']}
        else:
            source = shapely.line_merge(shapely.union_all([by_id[v] for v in entry['sourceLineIds']]))
            provenance = {'sourceId': module.SOURCE_ID}
        parts = list(source.geoms) if source.geom_type == 'MultiLineString' else [source]
        for segment in entry['segments']:
            if segment['status'] == 'withheld':
                continue
            anchors = segment.get('anchors', [])
            if segment.get('closedRing'):
                if len(parts) != 1 or not parts[0].is_ring:
                    raise ValueError('Expected one complete closed reference boundary')
                reference = parts[0]
            else:
                reference = min(parts, key=lambda line: sum(line.distance(Point(p)) for p in anchors))
                reference = substring(reference, reference.project(Point(anchors[0])), reference.project(Point(anchors[1])))
            display = display_section(entities[code], anchors, reference)
            forward, n1 = sampled_distance(reference, display)
            reverse, n2 = sampled_distance(display, reference)
            upper = max(forward, reverse) + STEP * SCALE / 2
            if upper > .5:
                diagnostic={'entry':entry,'segment':segment,'reference':list(reference.coords),'display':list(display.coords),
                            'referenceBounds':reference.bounds,'displayBounds':display.bounds,
                            'forward':forward,'reverse':reverse}
                (root/'build-native/lsib-supplement/screen-failure.json').write_text(json.dumps(diagnostic),encoding='utf-8')
                print(json.dumps({k:v for k,v in diagnostic.items() if k not in ('reference','display','entry','segment')}),flush=True)
                raise AssertionError(f'Source/display screen deviation exceeds tolerance: {entry["countries"]}: {upper}')
            results.append({**provenance, 'countries': entry['countries'], 'anchors': anchors, 'samples': n1 + n2,
                            'sampledMaximumCssPx': max(forward, reverse), 'continuousUpperBoundCssPx': upper})
    report = {'widthCssPx': 2560, 'flatZoom': 64, 'scope': 'supplemented intervals only; retained old endings excluded',
              'source': 'Reviewed source vectors identified in each result',
              'sourceIds': sorted({r['sourceId'] for r in results}), 'historicalGroundTruthVerified': False,
              'sections': len(results), 'samples': sum(r['samples'] for r in results),
              'sampledMaximumCssPx': max(r['sampledMaximumCssPx'] for r in results),
              'continuousUpperBoundCssPx': max(r['continuousUpperBoundCssPx'] for r in results), 'results': results}
    target = Path(args.output); target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}))


if __name__ == '__main__':
    main()
