"""Curated offline boundary reconstruction; production normalization remains C++ owned.

Ordinary replacements use old/new intersections. Explicitly reviewed tripoint
targets move all three countries together. The unchanged outer land mask,
island components and special/disputed boundaries remain authoritative exclusions.
Raw LSIB evidence is retained separately from the <=0.5px presentation derivative.
"""
from library_data import library_output, write_library_bytes, write_library_text
import argparse
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import zipfile
from collections import defaultdict

import numpy as np
from shapely.geometry import LineString, MultiLineString, shape, mapping
import shapely

SCALE = 2560 * 64 / 360
SIMPLIFY_DEGREES = 0.0004  # <= 0.182045 CSS px symmetric displacement.
SOURCE_ID = 'dos-lsib-11.4'
REVIEWED_TARGETS = {
    'AUT/LIE': {'pair': ('AUT', 'LIE'), 'junctionCountry': 'CHE'},
    'AND/FRA': {'pair': ('AND', 'FRA'), 'junctionCountry': 'ESP'},
    'ITA/SMR': {'pair': ('ITA', 'SMR'), 'enclave': 'SMR'},
    'ITA/VAT': {'pair': ('ITA', 'VAT'), 'enclave': 'VAT', 'simplify': False},
    'LSO/ZAF': {'pair': ('LSO', 'ZAF'), 'enclave': 'LSO'},
    'FRA/MCO': {'pair': ('FRA', 'MCO'), 'coastal': 'MCO', 'simplify': False},
}


def source_supplement(published='2025-02-24', tolerance=SIMPLIFY_DEGREES):
    return {'sourceId': SOURCE_ID, 'published': published, 'effectiveDateEstablished': False,
        'status': 'provisional-modern-source-supplement', 'coastline': 'unchanged',
        'sourceFile': 'tools/historical-library/sources/lsib-11.4/boundaries.geojson.gz',
        'simplificationToleranceDegrees': tolerance, 'simplificationMaximumPx': tolerance * SCALE,
        'screenBaseline': {'widthCssPx': 2560, 'flatZoom': 64}, 'historicalAccuracyVerified': False}


def load_reviewed_reference(root, manifest_path):
    script = Path(__file__).with_name('gis') / 'lsib-reviewed-source.mjs'
    request = {'root': str(root), 'manifestPath': str(manifest_path)}
    result = subprocess.run(['node', str(script), '--stream'], input=json.dumps(request).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Reviewed source validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    metadata = json.loads(result.stdout)
    lines = metadata.pop('lines', None)
    if not isinstance(lines, dict):
        raise ValueError('Invalid reviewed source validation receipt')
    return lines, metadata


def reviewed_reference(root, manifest_path):
    """Load the explicitly reviewed IGM San Marino exception, with pinned bytes."""
    lines, metadata = load_reviewed_reference(root, manifest_path)
    if metadata.get('sourceId') != 'igm-dbsn-2025-06-27' or set(lines) != {'igm'} or not isinstance(metadata.get('transformation'), dict):
        raise ValueError('Invalid reviewed IGM validation receipt')
    return LineString(lines['igm']), metadata


def json_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    write_library_text(path,json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def reviewed_coast_reference(root, manifest_path):
    """The approved Monaco high-water coastline, never a general source override."""
    lines, metadata = load_reviewed_reference(root, manifest_path)
    if metadata.get('sourceId') != 'ign-bdtopo-v3-monaco-coast' or not isinstance(lines, dict) or set(lines) != {'monaco', 'west', 'east'}:
        raise ValueError('Invalid reviewed coast validation receipt')
    return {role: LineString(coordinates) for role, coordinates in lines.items()}, metadata


def read_shapefile(dbf, shp):
    count = struct.unpack_from('<I', dbf, 4)[0]
    header, width = struct.unpack_from('<HH', dbf, 8)
    fields, at = [], 32
    while dbf[at] != 13:
        fields.append((dbf[at:at + 11].split(b'\0')[0].decode(), dbf[at + 16]))
        at += 32
    records, offset = [], 100
    for row in range(count):
        at = header + row * width + 1
        props = {}
        for name, length in fields:
            props[name] = dbf[at:at + length].decode('utf-8', errors='strict').strip()
            at += length
        _, words = struct.unpack_from('>II', shp, offset)
        offset += 8
        data = memoryview(shp)[offset:offset + words * 2]
        offset += words * 2
        kind = struct.unpack_from('<I', data, 0)[0]
        if kind == 0:
            continue
        if kind not in (3, 13, 23):
            raise ValueError(f'Expected polyline SHP record, got {kind}')
        parts, points = struct.unpack_from('<II', data, 36)
        starts = list(struct.unpack_from('<' + 'I' * parts, data, 44)) + [points]
        xy = np.frombuffer(data, dtype='<f8', count=points * 2, offset=44 + 4 * parts).reshape(-1, 2)
        line = shapely.line_merge(MultiLineString([xy[a:b] for a, b in zip(starts[:-1], starts[1:])]))
        records.append({'properties': props, 'line': line})
    return records


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


def coordinates(geometry):
    if geometry.geom_type == 'Point':
        return [tuple(geometry.coords[0])]
    return [tuple(p) for p in geometry.coords]


def replacement_chains(old, references):
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'old': coordinates(old), 'references': [coordinates(line) for line in references]}
    result = subprocess.run(['node', str(script), '--replacement-stream'], input=json.dumps(request, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('LSIB replacement failed: ' + result.stderr.decode('utf-8', errors='replace'))
    rows = json.loads(result.stdout).get('results')
    if not isinstance(rows, list) or len(rows) != len(references):
        raise RuntimeError('Invalid LSIB replacement receipt')
    return [row['value'] for row in rows if 'value' in row]


def replace_chains(geometries, patches, *, validate=False):
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'geometries': geometries, 'patches': patches}
    operation = '--patches-stream' if validate else '--rings-stream'
    result = subprocess.run(['node', str(script), operation], input=json.dumps(request, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('LSIB ring replacement failed: ' + result.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(result.stdout)
    if isinstance(receipt.get('error'), str):
        raise ValueError(receipt['error'])
    output = receipt.get('geometries')
    if not isinstance(output, dict) or set(output) != set(geometries):
        raise RuntimeError('Invalid LSIB ring replacement receipt')
    return output


def replace_chain(geometry, old, replacement):
    return replace_chains({'owner': geometry}, {'owner': [{'old': old, 'replacement': replacement}]})['owner']


def exclusion_reasons(records):
    """Classify the selected source set once; geometry and records remain unchanged."""
    script = Path(__file__).with_name('gis') / 'lsib-exclusion.mjs'
    request = json.dumps([record['properties'] for record in records], allow_nan=False).encode('utf-8')
    result = subprocess.run(['node', str(script), '--stream'], input=request, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('LSIB exclusion classification failed: ' + result.stderr.decode('utf-8', errors='replace'))
    rows = json.loads(result.stdout)
    allowed = {None, 'special-or-separation-line', 'existing-disputed-territory-or-protected-country-pair',
               'uncertain-or-joint-sovereignty', 'river-island-sovereignty-needs-independent-review'}
    if not isinstance(rows, list) or len(rows) != len(records) or any(
            not isinstance(row, list) or len(row) != 2 or any(value not in allowed for value in row) for row in rows):
        raise ValueError('Invalid LSIB exclusion classification receipt')
    return {id(record): reasons for record, reasons in zip(records, rows)}


def apply_country_patches(geometries, patches):
    return replace_chains(geometries, patches, validate=True)


def validate_country_repair(geometries, result, expected_union=None, corrected_country=None):
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'before': geometries, 'after': result,
               'expectedUnion': None if expected_union is None else mapping(expected_union), 'correctedCountry': corrected_country}
    checked = subprocess.run(['node', str(script), '--repair-stream'], input=json.dumps(request, allow_nan=False).encode('utf-8'),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if checked.returncode:
        raise RuntimeError('LSIB country validation failed: ' + checked.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(checked.stdout)
    if isinstance(receipt.get('error'), str):
        raise ValueError(receipt['error'])
    if receipt != {'valid': True}:
        raise RuntimeError('Invalid LSIB country validation receipt')


def validate_coastal_repair(geometries, result, review):
    if set(geometries) != {'FRA', 'MCO'}:
        raise ValueError('Coast correction is restricted to FRA/MCO')
    before_union = shapely.union_all([shape(g) for g in geometries.values()])
    expected = shape(replace_chain(mapping(before_union), review['oldChain'], review['replacementChain']))
    if not expected.is_valid:
        raise ValueError('Reviewed coast does not form a valid land mask')
    validate_country_repair(geometries, result, expected, corrected_country='MCO')


def repair_coastal_boundary(geometries, reference, coasts):
    if set(geometries) != {'FRA', 'MCO'} or set(coasts) != {'monaco', 'west', 'east'}:
        raise ValueError('Coast correction is restricted to FRA/MCO and three reviewed coasts')
    if reference.geom_type != 'LineString':
        raise ValueError('Coastal land reference must be one simple open line')
    if any(line.geom_type != 'LineString' for line in coasts.values()):
        raise ValueError('Reviewed coasts must be simple open lines')
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'geometries': geometries, 'reference': coordinates(reference),
               'coasts': {role: coordinates(line) for role, line in coasts.items()}}
    response = subprocess.run(['node', str(script), '--coast-stream'],
                              input=json.dumps(request, allow_nan=False).encode('utf-8'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if response.returncode:
        raise RuntimeError('LSIB coastal repair failed: ' + response.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(response.stdout)
    if isinstance(receipt.get('error'), str):
        raise ValueError(receipt['error'])
    result, sections, review = receipt.get('geometries'), receipt.get('sections'), receipt.get('review')
    if not isinstance(result, dict) or set(result) != set(geometries) or not isinstance(sections, list) or len(sections) != 4 or not isinstance(review, dict):
        raise RuntimeError('Invalid LSIB coastal repair receipt')
    for section in sections:
        section['countries'] = tuple(section['countries'])
        section['anchors'] = [tuple(point) for point in section['anchors']]
    for key in ['oldChain', 'replacementChain', 'outerAnchors']:
        review[key] = [tuple(point) for point in review[key]]
    return {'MCO': result['MCO'], 'FRA': result['FRA']}, sections, review


def extract_shared_chains(geometries):
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'geometries': geometries}
    result = subprocess.run(['node', str(script), '--shared-stream'], input=json.dumps(request, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('LSIB shared-chain extraction failed: ' + result.stderr.decode('utf-8', errors='replace'))
    rows = json.loads(result.stdout).get('chains')
    if not isinstance(rows, list):
        raise RuntimeError('Invalid LSIB shared-chain receipt')
    return {tuple(row['countries']): shape(row['geometry']) for row in rows}


def repair_tripoint_boundary(geometries, references, pair, third):
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'geometries': geometries, 'references': [
        {'countries': codes, 'geometry': mapping(line)} for codes, line in references.items()],
        'pair': pair, 'third': third}
    result = subprocess.run(['node', str(script), '--tripoint-stream'],
                            input=json.dumps(request, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('LSIB tripoint repair failed: ' + result.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(result.stdout)
    if isinstance(receipt.get('error'), str):
        raise ValueError(receipt['error'])
    result, sections = receipt.get('geometries'), receipt.get('sections')
    if not isinstance(result, dict) or set(result) != set(geometries) or not isinstance(sections, list) or len(sections) != 5:
        raise RuntimeError('Invalid LSIB tripoint repair receipt')
    for section in sections:
        section['countries'] = tuple(section['countries'])
    return result, sections


def repair_enclave_boundary(geometries, reference, pair, enclave, simplify=True):
    if reference.geom_type != 'LineString' or len(reference.coords) < 2:
        raise ValueError('Enclave reference must be one simple closed ring')
    script = Path(__file__).with_name('gis') / 'lsib-screen-native.mjs'
    request = {'geometries': geometries, 'reference': coordinates(reference), 'pair': pair,
               'enclave': enclave, 'simplify': simplify}
    result = subprocess.run(['node', str(script), '--enclave-stream'], input=json.dumps(request, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('LSIB enclave repair failed: ' + result.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(result.stdout)
    if isinstance(receipt.get('error'), str):
        raise ValueError(receipt['error'])
    result, sections = receipt.get('geometries'), receipt.get('sections')
    if not isinstance(result, dict) or set(result) != set(geometries) or not isinstance(sections, list) or len(sections) != 1:
        raise RuntimeError('Invalid LSIB enclave repair receipt')
    for section in sections:
        section['countries'] = tuple(section['countries'])
    return result, sections


def targeted_candidates(root, output, targets, reference_manifest=None, coast_manifest=None):
    script = Path(__file__).with_name('gis') / 'lsib-targeted.mjs'
    request = {'root': str(root), 'targets': list(targets),
               'referenceManifest': str(reference_manifest) if reference_manifest is not None else None,
               'coastManifest': str(coast_manifest) if coast_manifest is not None else None}
    response = subprocess.run(['node', str(script), '--stream'], input=json.dumps(request, allow_nan=False).encode('utf-8'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600,
                              creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if response.returncode:
        message = response.stderr.decode('utf-8', errors='replace')
        if 'Native LSIB screen operation failed' in message or 'PANDO_TERRITORIAL_RECIPE_BINARY must locate' in message:
            raise RuntimeError('LSIB targeted candidate failed: ' + message)
        raise ValueError('LSIB targeted candidate failed: ' + message)
    result = json.loads(response.stdout)
    if not isinstance(result, dict) or not isinstance(result.get('changes'), list) or not isinstance(result.get('boundaries'), list):
        raise RuntimeError('Invalid LSIB targeted candidate receipt')
    json_write(output, result)
    print(json.dumps({'targets': list(dict.fromkeys(targets)), 'changedCountries': len(result['changes']),
                      'sections': len(result['boundaries']), 'output': str(output)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive')
    parser.add_argument('--disputed-directory')
    parser.add_argument('--target', action='append', choices=REVIEWED_TARGETS,
                        help='Explicitly reviewed target; repeat to accumulate countries in one candidate')
    parser.add_argument('--reviewed-reference', help='Pinned manifest for the reviewed IGM San Marino exception')
    parser.add_argument('--reviewed-coast', help='Pinned high-water coast manifest; requires --target FRA/MCO')
    parser.add_argument('--output', default='build-native/lsib-supplement/candidates.json')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.target:
        targeted_candidates(root, Path(args.output), args.target, args.reviewed_reference, args.reviewed_coast)
        return
    if args.reviewed_reference or args.reviewed_coast:
        parser.error('Reviewed source manifests require an explicitly selected --target')
    if not args.archive or not args.disputed_directory:
        parser.error('--archive and --disputed-directory are required for an untargeted supplement')
    source_root = root / 'assets/data/territorial-entities/source'
    evidence = root / 'tools/historical-library/sources/lsib-11.4'
    evidence.mkdir(parents=True, exist_ok=True)
    archive = Path(args.archive)
    outer = zipfile.ZipFile(archive)
    checksum = next(n for n in outer.namelist() if n.endswith('.txt'))
    write_library_bytes(evidence / 'upstream-checksums.txt',outer.read(checksum))
    inner_bytes = outer.read(next(n for n in outer.namelist() if n.endswith('.zip')))
    inner = zipfile.ZipFile(io.BytesIO(inner_bytes))
    shp = inner.read(next(n for n in inner.namelist() if n.endswith('.shp')))
    dbf = inner.read(next(n for n in inner.namelist() if n.endswith('.dbf')))
    records = load_lsib_archive(archive)
    exclusions = exclusion_reasons(records)
    json_write(evidence / 'line-index.json', [{'properties':r['properties'],'bbox':r['line'].bounds} for r in records])
    readme = next(n for n in inner.namelist() if 'ReadMe' in n)
    write_library_bytes(evidence / 'upstream-readme.txt',inner.read(readme))
    # Exact raw vectors are preserved independently of product simplification.
    master_path = evidence / 'boundaries.geojson.gz'
    if not master_path.exists():
        with library_output([master_path]), master_path.open('wb') as target:
            with gzip.GzipFile(fileobj=target, mode='wb', mtime=0, compresslevel=6) as stream:
                stream.write(b'{"type":"FeatureCollection","features":[')
                for index, record in enumerate(records):
                    if index:
                        stream.write(b',')
                    feature = {'type': 'Feature', 'properties': record['properties'], 'geometry': mapping(record['line'])}
                    stream.write(json.dumps(feature, separators=(',', ':')).encode())
                stream.write(b']}\n')
    dispute_root = Path(args.disputed_directory)
    disputes = read_shapefile((dispute_root / 'ne-disputed.dbf').read_bytes(), (dispute_root / 'ne-disputed.shp').read_bytes())
    json_write(evidence / 'ne-disputed-v5.1.1.geojson', {'type':'FeatureCollection','features':[
        {'type':'Feature','properties':r['properties'],'geometry':mapping(r['line'])} for r in disputes]})
    disputed_geometry = shapely.union_all([record['line'] for record in disputes]).buffer(.15)
    protected_pairs = {tuple(sorted(pair)) for pair in [
        ('RUS', 'UKR'), ('CHN', 'IND'), ('CHN', 'BTN'), ('IND', 'PAK'), ('CHN', 'PAK'),
        ('ARM', 'AZE'), ('ISR', 'SYR'), ('ISR', 'LBN'), ('ISR', 'PSE'), ('ISR', 'PSX'),
        ('MAR', 'SAH'), ('SDN', 'SSD'), ('SDN', 'SDS'), ('DEU', 'LUX'), ('SRB', 'XKX'),
        ('CHN', 'HKG'), ('CHN', 'MAC'), ('PRK', 'KOR'),
    ]}
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
    shared = extract_shared_chains(geometries)
    lines_by_pair = defaultdict(list)
    for record in records:
        props = record['properties']
        pair = tuple(sorted((props['CC1_GENC3'], props['CC2_GENC3'])))
        lines_by_pair[pair].append(record)
    report, applied, changed, reviewed = [], defaultdict(list), set(), set()
    for pair, border in sorted(shared.items()):
        entry = {'countries': pair, 'bbox':border.bounds, 'status': 'withheld', 'segments': []}
        matches = lines_by_pair.get(pair, [])
        entry['sourceLineIds'] = [r['properties']['ID'] for r in matches]
        if not matches:
            entry['reason'] = 'no-matching-LSIB-country-pair'; report.append(entry); continue
        reviewed.update(r['properties']['ID'] for r in matches)
        disputed = pair in protected_pairs or any(r['line'].intersects(disputed_geometry) for r in matches)
        reasons = [exclusions[id(r)][int(disputed)] for r in matches]
        if any(reasons):
            entry['reason'] = next(r for r in reasons if r); report.append(entry); continue
        reference = shapely.line_merge(shapely.union_all([r['line'] for r in matches]))
        reference_parts = list(reference.geoms) if reference.geom_type == 'MultiLineString' else [reference]
        chains = list(border.geoms) if border.geom_type == 'MultiLineString' else [border]
        candidate_a, candidate_b = geometries[pair[0]], geometries[pair[1]]
        for chain in chains:
            segment = {'old_length_degrees': chain.length}
            try:
                if chain.is_ring:
                    raise ValueError('Closed enclave chain requires separate ownership review')
                candidate_refs = [line for line in reference_parts if line.distance(chain) < .25]
                if not candidate_refs:
                    raise ValueError('No spatially corresponding source section')
                candidates = replacement_chains(chain, candidate_refs)
                if not candidates:
                    raise ValueError('No safe intersection anchors; old chain retained')
                proposal = max(candidates, key=lambda v: v['replaced_length_degrees'])
                if proposal['source_length_degrees'] > max(.02, proposal['replaced_length_degrees'] * 5):
                    raise ValueError('Reference detour correspondence requires review')
                updated = apply_country_patches(dict(zip(pair, (candidate_a, candidate_b))),
                    {code: [{'old': coordinates(chain), 'replacement': proposal['coordinates']}] for code in pair})
                candidate_a, candidate_b = (updated[code] for code in pair)
                segment.update({k: v for k, v in proposal.items() if k != 'coordinates'})
                segment['status'] = 'supplemented-between-intersections'
            except (ValueError, shapely.errors.GEOSException) as error:
                segment.update(status='withheld', reason=str(error))
            entry['segments'].append(segment)
        successful = [s for s in entry['segments'] if s['status'] != 'withheld']
        if successful:
            geometries[pair[0]], geometries[pair[1]] = candidate_a, candidate_b
            changed.update(pair)
            entry['status'] = 'partially-supplemented'
            entry['sourceLineIds'] = [r['properties']['ID'] for r in matches]
            for code in pair:
                applied[code].append({'countries': pair, 'sourceLineIds': entry['sourceLineIds'], 'segments': successful})
        else:
            entry['reason'] = 'all-segments-withheld'
        report.append(entry)
        print('PAIR', '/'.join(pair), entry['status'], len(successful), '/', len(chains), flush=True)
    for record in records:
        props = record['properties']
        if props['ID'] not in reviewed:
            report.append({'countries': sorted((props['CC1_GENC3'], props['CC2_GENC3'])), 'status': 'withheld',
                           'reason': exclusions[id(record)][0] or 'no-existing-shared-country-chain',
                           'label': props['LABEL'], 'notes': props['NOTES'], 'sourceLineIds': [props['ID']]})
    changes = []
    for code in sorted(changed):
        changes.append({'entityId': entities[code]['entityId'], 'geometryVersionId': versions[code]['versionId'], 'inputFileSha256': input_hashes[code],
                        'sourceId': '+'.join(dict.fromkeys([*versions[code]['sourceId'].split('+'), SOURCE_ID])),
                        'sourceAttributions': [],
                        'geometry': geometries[code],
                        'supplement': {**source_supplement(), 'boundaries': applied[code]}})
    result = {'schemaVersion': 1, 'sourceId': SOURCE_ID, 'sourcePublished': '2025-02-24',
              'sourceRevision': '4c7f30453fc5de61efd1ab0fb03d7fdaa92fe3a7',
              'changes': changes, 'boundaries': report}
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
