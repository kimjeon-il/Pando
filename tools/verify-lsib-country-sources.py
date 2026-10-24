"""Read-only source/geometry checks for the country split and LSIB candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from collections import Counter
from shapely.geometry import shape


def geometry_edges(geometries):
    edges = Counter()
    for geometry in geometries:
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for polygon in polygons:
            for ring in polygon:
                for a, b in zip(ring[:-1], ring[1:]):
                    a, b = tuple(a), tuple(b)
                    if a == b:
                        continue
                    a, b = sorted((a, b))
                    edges[hashlib.blake2b(struct.pack('>dddd', *a, *b), digest_size=16).digest()] += 1
    return Counter({edge: count for edge, count in edges.items() if count % 2})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    data = root / 'assets/data/territorial-entities/source'
    display_versions = {row['entityId']: row['geometryVersionId'] for row in json.loads((data / 'views/world.json').read_text(encoding='utf-8'))['selections']}
    lineages = [json.loads(p.read_text(encoding='utf-8')) for p in sorted((data / 'lineages').glob('*.json'))]
    requests = [f'{args.base}:assets/data/territorial-entities/source/countries/{lineage["lineageId"]}.json' for lineage in lineages]
    result = subprocess.run(['git', 'cat-file', '--batch'], cwd=root, input=('\n'.join(requests) + '\n').encode(), capture_output=True, check=True)
    before, offset = {}, 0
    for lineage in lineages:
        end = result.stdout.index(b'\n', offset)
        header = result.stdout[offset:end].split()
        assert header[1] == b'blob', 'Missing original lineage source'
        length = int(header[2]); offset = end + 1
        document = json.loads(result.stdout[offset:offset + length]); offset += length + 1
        for entity in document['entities']:
            before[entity['entityId']] = dict(entity, lineageId=document['lineageId'])
    after = {e['entityId']: e for p in sorted((data / 'countries').glob('*.json'))
             for e in [json.loads(p.read_text(encoding='utf-8'))]}
    candidate = json.loads(Path(args.candidate).read_text(encoding='utf-8'))
    changed = {r['entityId'] for r in candidate['changes']}
    assert before.keys() == after.keys(), 'Country identity set changed'
    unchanged, historical = 0, 0
    for entity_id, current in after.items():
        original = before[entity_id]
        assert current['lifetime'] == original['lifetime'], f'Lifetime changed: {entity_id}'
        assert [v['versionId'] for v in current['geometryVersions']] == [v['versionId'] for v in original['geometryVersions']]
        assert current['names'] == original['names'], f'Names changed: {entity_id}'
        assert current['parentEntityId'] == original['parentEntityId'], f'Parent changed: {entity_id}'
        for previous, version in zip(original['geometryVersions'], current['geometryVersions']):
            assert (version['validFrom'], version['validTo']) == (previous['validFrom'], previous['validTo'])
            if previous.get('validTo') is not None or previous['versionId'] != display_versions.get(entity_id):
                assert version == previous, f'Historical version overwritten: {entity_id}/{version["versionId"]}'
                historical += 1
        if entity_id not in changed:
            check = json.loads(json.dumps(current))
            check['metadata'].pop('representativeGeometryVersionId', None)
            assert check == original, f'Unrelated source changed: {entity_id}'
            unchanged += 1
        else:
            version = next(v for v in current['geometryVersions'] if v['versionId'] == display_versions[entity_id])
            assert shape(version['geometry']).is_valid, f'Invalid final polygon: {entity_id}'
    view = json.loads((data / 'views/world.json').read_text(encoding='utf-8'))
    before_world, after_world = [], []
    for row in view['selections']:
        for collection, target in ((before, before_world), (after, after_world)):
            target.append(next(v['geometry'] for v in collection[row['entityId']]['geometryVersions'] if v['versionId'] == row['geometryVersionId']))
    old_exterior, new_exterior = geometry_edges(before_world), geometry_edges(after_world)
    if old_exterior != new_exterior:
        unexpected = set(new_exterior - old_exterior)
        sample = []
        for selection, geometry in zip(view['selections'], after_world):
            polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
            for polygon in polygons:
                for ring in polygon:
                    for a, b in zip(ring[:-1], ring[1:]):
                        a, b = sorted((tuple(a), tuple(b)))
                        key = hashlib.blake2b(struct.pack('>dddd', *a, *b), digest_size=16).digest()
                        if key in unexpected:
                            sample.append({'entityId': selection['entityId'], 'edge': [a, b]})
        diagnostic = root / 'build-native/lsib-supplement/unpaired-edges.json'
        diagnostic.write_text(json.dumps(sample, indent=2) + '\n', encoding='utf-8')
        print('UNPAIRED_SAMPLE', json.dumps(sample[:8]), flush=True)
    assert old_exterior == new_exterior, f'Unpaired/coastal edges changed: old-only {len(old_exterior-new_exterior)}, new-only {len(new_exterior-old_exterior)}'
    result = {'sourceRevision': args.base, 'countryObjects': len(after), 'lineages': len(lineages),
              'changedModernCountries': len(changed), 'unchangedCountryObjects': unchanged,
              'historicalVersionsUnchanged': historical, 'modernChangedPolygonsValid': True,
              'lifetimesAndVersionIdentitiesUnchanged': True,
              'globalUnpairedEdgesIdentical': True, 'unpairedEdgeCount': len(old_exterior),
              'groundTruthHistoricalAccuracyVerified': False}
    destination = Path(args.output); destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
