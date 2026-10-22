"""Curated offline boundary reconstruction; production normalization remains C++ owned.

Ordinary replacements use old/new intersections. Explicitly reviewed tripoint
targets move all three countries together. The unchanged outer land mask,
island components and special/disputed boundaries remain authoritative exclusions.
Raw LSIB evidence is retained separately from the <=0.5px presentation derivative.
"""
import argparse
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct
import zipfile
from collections import defaultdict

import numpy as np
from shapely.geometry import LineString, MultiLineString, Point, shape, mapping
from shapely.ops import substring
import shapely

SCALE = 2560 * 64 / 360
SIMPLIFY_DEGREES = 0.0004  # <= 0.182045 CSS px symmetric displacement.
SOURCE_ID = 'dos-lsib-11.4'


def json_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


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


def intersection_anchors(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Point':
        return [geometry]
    if geometry.geom_type == 'LineString':
        return [Point(geometry.coords[0]), Point(geometry.coords[-1])]
    return [point for part in geometry.geoms for point in intersection_anchors(part)]


def coordinates(geometry):
    if geometry.geom_type == 'Point':
        return [tuple(geometry.coords[0])]
    return [tuple(p) for p in geometry.coords]


def deduplicate(points):
    result = []
    for point in points:
        point = tuple(point)
        if not result or point != result[-1]:
            result.append(point)
    return result


def replacement_chain(old, reference):
    anchors = intersection_anchors(old.intersection(reference))
    if len(anchors) < 2:
        raise ValueError('No independent intersection anchors; old endpoint arcs retained')
    anchors.sort(key=old.project)
    start, end = anchors[0], anchors[-1]
    a, b = old.project(start), old.project(end)
    if b - a < 0.002:
        raise ValueError('Intersection anchor coverage too short')
    first, last = reference.project(start), reference.project(end)
    if abs(first - last) < 0.002:
        raise ValueError('Ambiguous intersection anchor correspondence')
    master = substring(reference, first, last)
    derivative = master.simplify(SIMPLIFY_DEGREES, preserve_topology=False)
    if not derivative.is_simple:
        raise ValueError('Reference section self-intersects')
    middle = coordinates(derivative)
    middle[0], middle[-1] = (start.x, start.y), (end.x, end.y)
    prefix, suffix = coordinates(substring(old, 0, a)), coordinates(substring(old, b, old.length))
    # substring interpolation differs by a few ULPs from the intersection point.
    # Use the shared anchor exactly, otherwise opposite ring traversal can make
    # the C++ duplicate remover retain different sides of that microscopic edge.
    prefix[-1], suffix[0] = middle[0], middle[-1]
    points = deduplicate(prefix + middle + suffix)
    if not LineString(points).is_simple:
        raise ValueError('Combined boundary crosses its retained old ending')
    return {'coordinates': points, 'retained_length_degrees': a + old.length - b,
            'source_length_degrees': master.length, 'replaced_length_degrees': b - a,
            'master_vertices': len(master.coords), 'derived_vertices': len(middle),
            'simplification_bound_px': SIMPLIFY_DEGREES * SCALE,
            'anchors': [(start.x, start.y), (end.x, end.y)]}


def replace_chain(geometry, old, replacement):
    result = copy.deepcopy(geometry)
    polygons = [result['coordinates']] if result['type'] == 'Polygon' else result['coordinates']
    start, end = tuple(old[0]), tuple(old[-1])
    if start == end:
        raise ValueError('Closed enclave chain requires separate ownership review')
    witness = tuple(old[len(old) // 2])
    matches = []
    for polygon in polygons:
        for ring in polygon:
            points = [tuple(p) for p in ring]
            border = LineString(points)
            if all(border.distance(Point(p)) < 1e-11 for p in (start, end)):
                matches.append(ring)
    if len(matches) != 1:
        raise ValueError('Shared endpoints do not identify exactly one owning ring')
    ring = matches[0]
    # Reviewed outer anchors can fall inside a retained edge. Insert the exact
    # common coordinate before selecting the owning arc in either ring direction.
    points = [tuple(point) for point in ring[:-1]]
    for endpoint in (start, end):
        nearest = min(range(len(points)), key=lambda i: Point(points[i]).distance(Point(endpoint)))
        if Point(points[nearest]).distance(Point(endpoint)) < 1e-11:
            points[nearest] = endpoint
    ring[:] = points + points[:1]
    vertices = set(points)
    inserted = []
    for a, b in zip(ring[:-1], ring[1:]):
        a, b = tuple(a), tuple(b)
        inserted.append(a)
        edge = LineString([a, b])
        interior = [p for p in (start, end) if p not in vertices
                    and edge.distance(Point(p)) < 1e-11]
        inserted.extend(sorted(interior, key=lambda p: edge.project(Point(p))))
    ring[:] = deduplicate(inserted + inserted[:1])
    points = [tuple(p) for p in ring[:-1]]
    at = points.index(start)
    rotated = points[at:] + points[:at]
    last = rotated.index(end)
    direct = rotated[:last + 1]
    if witness in direct:
        new = list(replacement) + rotated[last + 1:]
    else:
        new = direct[:-1] + list(reversed(replacement))
    new = deduplicate(new)
    if new[0] != new[-1]:
        new.append(new[0])
    ring[:] = [list(p) for p in new]
    return result


def exclusion_reason(properties, disputed):
    if properties.get('RANK') != '1' or properties.get('STATUS') != 'International Boundary':
        return 'special-or-separation-line'
    if disputed:
        return 'existing-disputed-territory-or-protected-country-pair'
    note = properties.get('NOTES', '').lower()
    if any(word in note for word in ('uncertain', 'condominium', 'neutral zone', 'invernada')):
        return 'uncertain-or-joint-sovereignty'
    if 'island sovereignty' in note:
        return 'river-island-sovereignty-needs-independent-review'
    return None


def component_points(geometry):
    parts = list(geometry.geoms) if geometry.geom_type == 'MultiPolygon' else [geometry]
    return [part.representative_point() for part in parts]


def apply_country_patches(geometries, patches):
    result = copy.deepcopy(geometries)
    for code, entries in patches.items():
        for entry in entries:
            result[code] = replace_chain(result[code], entry['old'], entry['replacement'])
    before = {code: shape(geometry) for code, geometry in geometries.items()}
    after = {code: shape(geometry) for code, geometry in result.items()}
    invalid = {code: shapely.is_valid_reason(geometry) for code, geometry in after.items() if not geometry.is_valid}
    if invalid:
        raise ValueError(f'Candidate country polygon invalid: {invalid}')
    codes = sorted(after)
    if any(after[a].intersection(after[b]).area > 1e-10
           for i, a in enumerate(codes) for b in codes[i + 1:]):
        raise ValueError('Candidate counterpart ownership overlaps')
    before_union, after_union = shapely.union_all(list(before.values())), shapely.union_all(list(after.values()))
    if before_union.symmetric_difference(after_union).area > 1e-9:
        raise ValueError('Land/coastline union changed')
    for code, previous in before.items():
        current = after[code]
        if len(component_points(previous)) != len(component_points(current)):
            raise ValueError('Island/enclave component count changed')
        parts = lambda g: list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
        if sum(len(p.interiors) for p in parts(previous)) != sum(len(p.interiors) for p in parts(current)):
            raise ValueError('Enclave hole count changed')
        if any(not current.covers(point) for point in component_points(previous)):
            raise ValueError('Existing component attribution changed')
    return result


def extract_shared_chains(geometries):
    owners = defaultdict(set)
    for code, geometry in geometries.items():
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for polygon in polygons:
            for ring in polygon:
                for a, b in zip(ring[:-1], ring[1:]):
                    a, b = tuple(a), tuple(b)
                    if a != b:
                        owners[tuple(sorted((a, b)))].add(code)
    pairs = defaultdict(list)
    for edge, codes in owners.items():
        if len(codes) == 2:
            pairs[tuple(sorted(codes))].append(edge)
    return {pair: shapely.line_merge(MultiLineString(edges)) for pair, edges in pairs.items()}


def line_parts(line):
    return list(line.geoms) if line.geom_type == 'MultiLineString' else [line]


def line_from_junction(line, junction):
    matches = []
    for part in line_parts(line):
        points = coordinates(part)
        if Point(points[0]).distance(Point(junction)) < 1e-11:
            matches.append(LineString(points))
        elif Point(points[-1]).distance(Point(junction)) < 1e-11:
            matches.append(LineString(list(reversed(points))))
    if len(matches) != 1:
        raise ValueError('Expected one boundary branch at the reviewed junction')
    return matches[0]


def join_paths(*paths):
    result = list(paths[0])
    for points in paths[1:]:
        if tuple(result[-1]) != tuple(points[0]):
            raise ValueError('Boundary paths do not share the same junction coordinate')
        result.extend(points[1:])
    return deduplicate(result)


def repair_tripoint_boundary(geometries, references, pair, third):
    pair = tuple(sorted(pair))
    if set(geometries) != {*pair, third}:
        raise ValueError('A reviewed tripoint repair requires exactly three countries')
    shared = extract_shared_chains(geometries)
    old = shared[pair]
    reference = references[pair]
    if old.geom_type != 'LineString' or reference.geom_type != 'LineString' or old.is_ring:
        raise ValueError('Reviewed target must be one open boundary chain')
    if not reference.is_simple:
        raise ValueError('Reference section self-intersects')
    old_points, master = coordinates(old), coordinates(reference)
    direct = sum(Point(old_points[i]).distance(Point(master[i])) for i in (0, -1))
    reverse = sum(Point(old_points[i]).distance(Point(master[-1-i])) for i in (0, -1))
    if direct == reverse:
        raise ValueError('Ambiguous reviewed junction correspondence')
    if reverse < direct:
        master.reverse()
    derivative = coordinates(LineString(master).simplify(SIMPLIFY_DEGREES))
    old_junctions, junctions = [old_points[0], old_points[-1]], [master[0], master[-1]]
    adjacent, sections = {}, [{'countries': pair, 'old_length_degrees': old.length,
        'source_length_degrees': reference.length, 'master_vertices': len(master),
        'derived_vertices': len(derivative), 'anchors': junctions,
        'simplification_bound_px': SIMPLIFY_DEGREES * SCALE}]
    for index, (old_junction, junction) in enumerate(zip(old_junctions, junctions)):
        for code in pair:
            other_pair = tuple(sorted((code, third)))
            old_branch = line_from_junction(shared[other_pair], old_junction)
            source_branch = line_from_junction(references[other_pair], junction)
            anchors = [point for point in intersection_anchors(old_branch.intersection(source_branch))
                       if old_branch.project(point) > 1e-11 and source_branch.project(point) > 1e-11]
            if not anchors:
                raise ValueError(f'No safe outer anchor for {other_pair} junction {index}')
            anchor = min(anchors, key=old_branch.project)
            endpoint = (anchor.x, anchor.y)
            retained = coordinates(substring(old_branch, 0, old_branch.project(anchor)))
            detailed = substring(source_branch, 0, source_branch.project(anchor))
            replacement = coordinates(detailed.simplify(SIMPLIFY_DEGREES))
            retained[0], retained[-1] = old_junction, endpoint
            replacement[0], replacement[-1] = junction, endpoint
            if not LineString(replacement).is_simple:
                raise ValueError('Reference junction branch self-intersects')
            adjacent[index, code] = (retained, replacement)
            sections.append({'countries': other_pair, 'junction': index,
                'old_length_degrees': old_branch.project(anchor), 'source_length_degrees': detailed.length,
                'master_vertices': len(detailed.coords), 'derived_vertices': len(replacement),
                'anchors': [junction, endpoint], 'simplification_bound_px': SIMPLIFY_DEGREES * SCALE})
    patches = {code: [] for code in geometries}
    for code in pair:
        first_old, first_new = adjacent[0, code]
        last_old, last_new = adjacent[1, code]
        patches[code].append({'old': join_paths(list(reversed(first_old)), old_points, last_old),
            'replacement': join_paths(list(reversed(first_new)), derivative, last_new)})
    for index in (0, 1):
        a_old, a_new = adjacent[index, pair[0]]
        b_old, b_new = adjacent[index, pair[1]]
        patches[third].append({'old': join_paths(list(reversed(a_old)), b_old),
            'replacement': join_paths(list(reversed(a_new)), b_new)})
    result = apply_country_patches(geometries, patches)
    a, b = (shape(result[code]) for code in pair)
    if not a.boundary.intersection(b.boundary).equals(LineString(derivative)):
        raise ValueError('Repaired countries do not share exactly the reviewed target boundary')
    for junction in junctions:
        if any(not shape(geometry).boundary.covers(Point(junction)) for geometry in result.values()):
            raise ValueError('Repaired countries disagree on the tripoint junction')
    return result, sections


def targeted_candidates(root, output):
    """Only the approved AUT/LIE target and its CHE junction branches are eligible."""
    source = root / 'assets/data/territorial-entities/source'
    evidence = root / 'tools/historical-library/sources/lsib-11.4'
    provenance = json.loads((evidence / 'provenance.json').read_text(encoding='utf-8'))
    raw = (evidence / 'boundaries.geojson.gz').read_bytes()
    if hashlib.sha256(raw).hexdigest() != provenance['masterSha256']:
        raise ValueError('LSIB master differs from pinned evidence')
    records = json.loads(gzip.decompress(raw))['features']
    view = json.loads((source / 'views/world.json').read_text(encoding='utf-8'))
    selections = {row['entityId']: row['geometryVersionId'] for row in view['selections']}
    entities, versions, geometries, hashes = {}, {}, {}, {}
    for code in ('AUT', 'LIE', 'CHE'):
        raw_entity = (source / 'countries' / f'state-{code}.json').read_bytes()
        entity = json.loads(raw_entity)
        version = next(v for v in entity['geometryVersions'] if v['versionId'] == selections[entity['entityId']])
        if entity['sourceInfo']['featureId'] != code or version.get('datePrecision') != 'current':
            raise ValueError(f'Historical or mismatched source must not be overwritten: {code}')
        entities[code], versions[code], geometries[code] = entity, version, version['geometry']
        hashes[code] = hashlib.sha256(raw_entity).hexdigest()
    references, ids = {}, {}
    for pair in (('AUT', 'LIE'), ('AUT', 'CHE'), ('CHE', 'LIE')):
        selected = [record for record in records if tuple(sorted((record['properties']['CC1_GENC3'], record['properties']['CC2_GENC3']))) == pair]
        if not selected or any(exclusion_reason(record['properties'], False) for record in selected):
            raise ValueError(f'Missing or protected reference: {pair}')
        references[pair] = shapely.line_merge(shapely.union_all([shape(record['geometry']) for record in selected]))
        ids[pair] = [record['properties']['ID'] for record in selected]
    updated, sections = repair_tripoint_boundary(geometries, references, ('AUT', 'LIE'), 'CHE')
    boundaries = [{'countries': list(section['countries']), 'sourceLineIds': ids[section['countries']],
        'status': 'supplemented-with-reviewed-tripoints', 'segments': [{**{k: v for k, v in section.items() if k != 'countries'},
        'status': 'supplemented-with-reviewed-tripoints'}]} for section in sections]
    changes = []
    for code in sorted(updated):
        supplement = copy.deepcopy(versions[code].get('modernBoundarySupplement', {}))
        supplement['boundaries'] = supplement.get('boundaries', []) + [entry for entry in boundaries if code in entry['countries']]
        supplement['reviewedTripointRepair'] = {'target': ['AUT', 'LIE'], 'junctionCountry': 'CHE',
            'historicalAccuracyVerified': False, 'effectiveDateEstablished': False}
        changes.append({'entityId': entities[code]['entityId'], 'geometryVersionId': versions[code]['versionId'],
            'inputFileSha256': hashes[code], 'geometry': updated[code], 'supplement': supplement})
    result = {'schemaVersion': 1, 'sourceId': SOURCE_ID, 'sourcePublished': provenance['published'],
        'sourceRevision': json.loads((root / 'config/library-data.json').read_text(encoding='utf-8'))['revision'],
        'changes': changes, 'boundaries': boundaries}
    json_write(output, result)
    print(json.dumps({'target': 'AUT/LIE', 'changedCountries': len(changes), 'sections': len(sections), 'output': str(output)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive')
    parser.add_argument('--disputed-directory')
    parser.add_argument('--target', choices=['AUT/LIE'], help='Approved three-country tripoint repair only')
    parser.add_argument('--output', default='build-native/lsib-supplement/candidates.json')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.target:
        targeted_candidates(root, Path(args.output))
        return
    if not args.archive or not args.disputed_directory:
        parser.error('--archive and --disputed-directory are required for an untargeted supplement')
    source_root = root / 'assets/data/territorial-entities/source'
    evidence = root / 'tools/historical-library/sources/lsib-11.4'
    evidence.mkdir(parents=True, exist_ok=True)
    archive = Path(args.archive)
    outer = zipfile.ZipFile(archive)
    checksum = next(n for n in outer.namelist() if n.endswith('.txt'))
    (evidence / 'upstream-checksums.txt').write_bytes(outer.read(checksum))
    inner_bytes = outer.read(next(n for n in outer.namelist() if n.endswith('.zip')))
    inner = zipfile.ZipFile(io.BytesIO(inner_bytes))
    shp = inner.read(next(n for n in inner.namelist() if n.endswith('.shp')))
    dbf = inner.read(next(n for n in inner.namelist() if n.endswith('.dbf')))
    records = read_shapefile(dbf, shp)
    json_write(evidence / 'line-index.json', [{'properties':r['properties'],'bbox':r['line'].bounds} for r in records])
    readme = next(n for n in inner.namelist() if 'ReadMe' in n)
    (evidence / 'upstream-readme.txt').write_bytes(inner.read(readme))
    # Exact raw vectors are preserved independently of product simplification.
    master_path = evidence / 'boundaries.geojson.gz'
    if not master_path.exists():
        with master_path.open('wb') as target:
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
        if any(versions[code].get('datePrecision') != 'current' for code in pair):
            entry['reason'] = 'existing-dated-historical-geometry-protected'; report.append(entry); continue
        disputed = pair in protected_pairs or any(r['line'].intersects(disputed_geometry) for r in matches)
        reasons = [exclusion_reason(r['properties'], disputed) for r in matches]
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
                candidates = []
                for line in candidate_refs:
                    try:
                        candidates.append(replacement_chain(chain, line))
                    except ValueError:
                        continue
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
                           'reason': exclusion_reason(props, False) or 'no-existing-shared-country-chain',
                           'label': props['LABEL'], 'notes': props['NOTES'], 'sourceLineIds': [props['ID']]})
    changes = []
    for code in sorted(changed):
        changes.append({'entityId': entities[code]['entityId'], 'geometryVersionId': versions[code]['versionId'], 'inputFileSha256': input_hashes[code],
                        'geometry': geometries[code], 'supplement': {'sourceId': SOURCE_ID, 'published': '2025-02-24',
                        'effectiveDateEstablished': False, 'status': 'provisional-modern-source-supplement',
                        'coastline': 'unchanged', 'sourceFile': 'tools/historical-library/sources/lsib-11.4/boundaries.geojson.gz',
                        'simplificationToleranceDegrees': SIMPLIFY_DEGREES, 'simplificationMaximumPx': SIMPLIFY_DEGREES * SCALE,
                        'screenBaseline': {'widthCssPx': 2560, 'flatZoom': 64},
                        'historicalAccuracyVerified': False, 'boundaries': applied[code]}})
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
