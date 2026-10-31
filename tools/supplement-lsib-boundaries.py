"""Curated offline boundary reconstruction; production normalization remains C++ owned.

Ordinary replacements use old/new intersections. The unchanged outer land mask,
island components and special/disputed boundaries remain authoritative exclusions.
Raw LSIB evidence is retained separately from the <=0.5px presentation derivative.
"""
from library_data import library_output
import argparse
import copy
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import zipfile

from shapely.geometry import shape, mapping

SOURCE_ID = 'dos-lsib-11.4'


def write_new_bytes(path, value):
    with library_output([path]):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as target:
            target.write(value)


def json_write(path, value):
    write_new_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def require_new_outputs(paths):
    resolved = [path.resolve() for path in paths]
    if len(set(resolved)) != len(resolved):
        raise ValueError('LSIB output paths overlap')
    for path in paths:
        if os.path.lexists(path):
            raise FileExistsError(f'LSIB output already exists: {path}')


def read_disputed_shapes(directory):
    script = Path(__file__).with_name('gis') / 'lsib-source-native.mjs'
    request = {'dbfPath': str(directory / 'ne-disputed.dbf'), 'shpPath': str(directory / 'ne-disputed.shp')}
    result = subprocess.run(['node', str(script), '--disputed-stream'], input=json.dumps(request).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('Disputed source read failed: ' + result.stderr.decode('utf-8', errors='replace'))
    features = json.loads(result.stdout).get('features')
    if not isinstance(features, list):
        raise RuntimeError('Invalid disputed source receipt')
    return [{'properties': feature['properties'], 'line': shape(feature['geometry'])} for feature in features]


def load_lsib_archive(archive, ids=None):
    """Read the pinned LSIB source via GDAL and the shared native line merger."""
    script = Path(__file__).with_name('gis') / 'lsib-source-native.mjs'
    request = {'archive': str(archive), **({'all': True} if ids is None else {'ids': ids})}
    result = subprocess.run(['node', str(script), '--stream'], input=json.dumps(request).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('LSIB source read failed: ' + result.stderr.decode('utf-8', errors='replace'))
    features = json.loads(result.stdout).get('features')
    if not isinstance(features, list) or (ids is not None and len(features) != len(ids)):
        raise ValueError('Invalid LSIB source receipt')
    return [{'properties': feature['properties'], 'line': shape(feature['geometry'])} for feature in features]


def build_untargeted_candidate(records, disputes, entities, versions, geometries, input_hashes, revision):
    request = {'records': [{'properties': record['properties'], 'geometry': mapping(record['line'])} for record in records],
               'disputes': [mapping(record['line']) for record in disputes],
               'entities': {code: {'entityId': entity['entityId']} for code, entity in entities.items()},
               'versions': {code: {'versionId': version['versionId'], 'sourceId': version['sourceId']}
                            for code, version in versions.items()},
               'geometries': geometries, 'inputHashes': input_hashes, 'sourceRevision': revision}
    script = Path(__file__).with_name('gis') / 'lsib-untargeted.mjs'
    response = subprocess.run(['node', str(script), '--stream'],
                              input=json.dumps(request, allow_nan=False, separators=(',', ':')).encode('utf-8'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800,
                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if response.returncode:
        raise RuntimeError('LSIB untargeted candidate failed: ' + response.stderr.decode('utf-8', errors='replace'))
    result = json.loads(response.stdout)
    if not isinstance(result, dict) or result.get('sourceRevision') != revision or not isinstance(result.get('changes'), list) or not isinstance(result.get('boundaries'), list):
        raise RuntimeError('Invalid LSIB untargeted candidate receipt')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive')
    parser.add_argument('--disputed-directory')
    parser.add_argument('--evidence-directory', help='New empty directory for generated LSIB evidence')
    parser.add_argument('--output', default='build-native/lsib-supplement/candidates.json')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if not args.archive or not args.disputed_directory:
        parser.error('--archive and --disputed-directory are required for an untargeted supplement')
    source_root = root / 'assets/data/territorial-entities/source'
    evidence = Path(args.evidence_directory) if args.evidence_directory else root / 'tools/historical-library/sources/lsib-11.4'
    require_new_outputs([Path(args.output), *(evidence / name for name in (
        'upstream-checksums.txt', 'line-index.json', 'upstream-readme.txt', 'boundaries.geojson.gz',
        'ne-disputed-v5.1.1.geojson', 'provenance.json'))])
    evidence.mkdir(parents=True, exist_ok=True)
    archive = Path(args.archive)
    outer = zipfile.ZipFile(archive)
    checksum = next(n for n in outer.namelist() if n.endswith('.txt'))
    write_new_bytes(evidence / 'upstream-checksums.txt', outer.read(checksum))
    inner_bytes = outer.read(next(n for n in outer.namelist() if n.endswith('.zip')))
    inner = zipfile.ZipFile(io.BytesIO(inner_bytes))
    shp = inner.read(next(n for n in inner.namelist() if n.endswith('.shp')))
    dbf = inner.read(next(n for n in inner.namelist() if n.endswith('.dbf')))
    records = load_lsib_archive(archive)
    json_write(evidence / 'line-index.json', [{'properties':r['properties'],'bbox':r['line'].bounds} for r in records])
    readme = next(n for n in inner.namelist() if 'ReadMe' in n)
    write_new_bytes(evidence / 'upstream-readme.txt', inner.read(readme))
    # Exact raw vectors are preserved independently of product simplification.
    master_path = evidence / 'boundaries.geojson.gz'
    with library_output([master_path]), master_path.open('xb') as target:
        with gzip.GzipFile(fileobj=target, mode='wb', mtime=0, compresslevel=6) as stream:
            stream.write(b'{"type":"FeatureCollection","features":[')
            for index, record in enumerate(records):
                if index:
                    stream.write(b',')
                feature = {'type': 'Feature', 'properties': record['properties'], 'geometry': mapping(record['line'])}
                stream.write(json.dumps(feature, separators=(',', ':')).encode())
            stream.write(b']}\n')
    dispute_root = Path(args.disputed_directory)
    disputes = read_disputed_shapes(dispute_root)
    json_write(evidence / 'ne-disputed-v5.1.1.geojson', {'type':'FeatureCollection','features':[
        {'type':'Feature','properties':r['properties'],'geometry':mapping(r['line'])} for r in disputes]})
    view = json.loads((source_root / 'views/world.json').read_text(encoding='utf-8'))
    entities, versions, geometries, input_hashes = {}, {}, {}, {}
    for selection in view['selections']:
        entity_id = selection['entityId']
        source_bytes = (source_root / 'countries' / (entity_id.replace(':', '-') + '.json')).read_bytes()
        entity = json.loads(source_bytes)
        version = next(v for v in entity['geometryVersions'] if v['versionId'] == selection['geometryVersionId'])
        if version.get('validTo') is not None:
            raise ValueError(f'Historical display geometry is protected: {entity_id}')
        code = entity['sourceInfo']['featureId']
        entities[code], versions[code], geometries[code] = entity, version, copy.deepcopy(version['geometry'])
        input_hashes[code] = hashlib.sha256(source_bytes).hexdigest()
    revision = json.loads((root / 'config/library-data.json').read_text(encoding='utf-8'))['revision']
    result = build_untargeted_candidate(records, disputes, entities, versions, geometries, input_hashes, revision)
    changes, report = result['changes'], result['boundaries']
    json_write(Path(args.output), result)
    json_write(evidence / 'provenance.json', {'sourceId': SOURCE_ID, 'published': '2025-02-24',
        'url': 'https://data.geodata.state.gov/LSIB.zip', 'license': 'US Government public release; see upstream metadata',
        'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'innerArchiveSha256': hashlib.sha256(inner_bytes).hexdigest(),
        'shpSha256': hashlib.sha256(shp).hexdigest(), 'dbfSha256': hashlib.sha256(dbf).hexdigest(),
        'masterSha256': hashlib.sha256(master_path.read_bytes()).hexdigest(),
        'naturalEarthDisputes': {'release': 'v5.1.1', 'url': 'https://github.com/nvkelso/natural-earth-vector/tree/v5.1.1/10m_cultural',
            'shpSha256': hashlib.sha256((dispute_root / 'ne-disputed.shp').read_bytes()).hexdigest(),
            'dbfSha256': hashlib.sha256((dispute_root / 'ne-disputed.dbf').read_bytes()).hexdigest()},
        'policy': 'Existing attribution retained; special/disputed/joint/historical lines withheld; no guessed connectors.'})
    print(json.dumps({'changedCountries': len(changes), 'supplementedPairs': sum(r['status'] != 'withheld' for r in report),
                      'withheldEntries': sum(r['status'] == 'withheld' for r in report), 'output': args.output}), flush=True)


if __name__ == '__main__':
    main()
