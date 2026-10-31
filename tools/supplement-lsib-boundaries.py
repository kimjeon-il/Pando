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
from shapely.geometry import LineString, MultiLineString, Point, Polygon, shape, mapping
from shapely.ops import substring
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


def replace_chain(geometry, old, replacement):
    result = json.loads(json.dumps(geometry))
    polygons = [result['coordinates']] if result['type'] == 'Polygon' else result['coordinates']
    start, end = tuple(old[0]), tuple(old[-1])
    if start == end:
        old_line, new_line = LineString(old), LineString(replacement)
        if not old_line.is_ring or not new_line.is_ring or not Polygon(new_line).is_valid:
            raise ValueError('Reviewed enclave boundary must be a simple closed ring')
        matches = [ring for polygon in polygons for ring in polygon
                   if LineString(ring).equals(old_line)]
        if len(matches) != 1:
            raise ValueError('Closed boundary does not identify exactly one owning ring')
        # Each owner retains its ring role and winding; cyclic starts and opposite
        # traversal must not prevent matching the same complete shared boundary.
        points = coordinates(new_line)
        if shapely.is_ccw(LineString(matches[0])) != shapely.is_ccw(new_line):
            points.reverse()
        matches[0][:] = [list(point) for point in points]
        return result
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
    other = list(reversed(rotated[last:] + rotated[:1]))
    old_line = LineString(old)
    matches = [abs(LineString(arc).length - old_line.length) < 1e-10
               and LineString(arc).hausdorff_distance(old_line) < 1e-10 for arc in (direct, other)]
    if sum(matches) != 1:
        raise ValueError('Old chain does not identify exactly one owning arc')
    if matches[0]:
        new = list(replacement) + rotated[last + 1:]
    else:
        new = direct[:-1] + list(reversed(replacement))
    new = deduplicate(new)
    if new[0] != new[-1]:
        new.append(new[0])
    ring[:] = [list(p) for p in new]
    return result


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


def component_points(geometry):
    parts = list(geometry.geoms) if geometry.geom_type == 'MultiPolygon' else [geometry]
    return [part.representative_point() for part in parts]


def apply_country_patches(geometries, patches):
    result = copy.deepcopy(geometries)
    for code, entries in patches.items():
        for entry in entries:
            result[code] = replace_chain(result[code], entry['old'], entry['replacement'])
    validate_country_repair(geometries, result)
    return result


def validate_country_repair(geometries, result, expected_union=None, corrected_country=None):
    if set(geometries) != set(result):
        raise ValueError('Candidate country set changed')
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
    if expected_union is None:
        expected_union = before_union
    if expected_union.symmetric_difference(after_union).area > 1e-9:
        raise ValueError('Land/coastline union changed outside reviewed coast')
    for code, previous in before.items():
        current = after[code]
        if len(component_points(previous)) != len(component_points(current)):
            raise ValueError('Island/enclave component count changed')
        parts = lambda g: list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
        if sum(len(p.interiors) for p in parts(previous)) != sum(len(p.interiors) for p in parts(current)):
            raise ValueError('Enclave hole count changed')
        if code != corrected_country and any(not current.covers(point) for point in component_points(previous)):
            raise ValueError('Existing component attribution changed')


def validate_coastal_repair(geometries, result, review):
    if set(geometries) != {'FRA', 'MCO'}:
        raise ValueError('Coast correction is restricted to FRA/MCO')
    before_union = shapely.union_all([shape(g) for g in geometries.values()])
    expected = shape(replace_chain(mapping(before_union), review['oldChain'], review['replacementChain']))
    if not expected.is_valid:
        raise ValueError('Reviewed coast does not form a valid land mask')
    validate_country_repair(geometries, result, expected, corrected_country='MCO')


def repair_coastal_boundary(geometries, reference, coasts):
    """Replace only the approved FRA/MCO shore arc, then assign its two owners."""
    if set(geometries) != {'FRA', 'MCO'} or set(coasts) != {'monaco', 'west', 'east'}:
        raise ValueError('Coast correction is restricted to FRA/MCO and three reviewed coasts')
    if reference.geom_type != 'LineString' or reference.is_ring or not reference.is_simple:
        raise ValueError('Coastal land reference must be one simple open line')
    if any(line.geom_type != 'LineString' or line.is_ring or not line.is_simple for line in coasts.values()):
        raise ValueError('Reviewed coasts must be simple open lines')
    border = coordinates(reference)
    if border[0][0] > border[-1][0]:
        border.reverse()
    coast = coordinates(coasts['monaco'])
    if Point(coast[0]).distance(Point(border[-1])) > Point(coast[-1]).distance(Point(border[-1])):
        coast.reverse()
    junctions = [coast[-1], coast[0]]
    endpoint_offsets = [Point(a).distance(Point(b)) * SCALE for a, b in zip((border[0], border[-1]), junctions)]
    if max(endpoint_offsets) > .5:
        raise ValueError('Coastal land endpoint move exceeds 0.5px')
    border[0], border[-1] = junctions
    before_union = shapely.union_all([shape(g) for g in geometries.values()])
    branches, anchors = {}, []
    for role, junction in zip(('west', 'east'), junctions):
        points = coordinates(coasts[role])
        if Point(points[0]).distance(Point(junction)) > Point(points[-1]).distance(Point(junction)):
            points.reverse()
        if Point(points[0]).distance(Point(junction)) * SCALE > .5:
            raise ValueError('Reviewed coast endpoint does not meet the national boundary')
        branch = LineString(points)
        candidates = [p for p in intersection_anchors(branch.intersection(before_union.boundary))
                      if branch.project(p) > 1e-11]
        if not candidates:
            raise ValueError(f'No safe outer coast anchor for {role}')
        anchor = min(candidates, key=branch.project)
        detail = coordinates(substring(branch, 0, branch.project(anchor)))
        detail[0], detail[-1] = junction, tuple(anchor.coords[0])
        branches[role] = detail
        anchors.append(tuple(anchor.coords[0]))
    polygons = list(before_union.geoms) if before_union.geom_type == 'MultiPolygon' else [before_union]
    rings = [LineString(p.exterior.coords) for p in polygons
             if all(p.exterior.distance(Point(a)) < 1e-11 for a in anchors)]
    if len(rings) != 1:
        raise ValueError('Outer coast anchors do not identify one land component')
    ring = rings[0]
    a, b = [ring.project(Point(p)) for p in anchors]
    lo, hi = sorted((a, b))
    direct = coordinates(substring(ring, lo, hi))
    other = join_paths(coordinates(substring(ring, hi, ring.length)), coordinates(substring(ring, 0, lo)))
    old = min((direct, other), key=lambda points: LineString(points).length)
    if Point(old[0]).distance(Point(anchors[0])) > Point(old[-1]).distance(Point(anchors[0])):
        old.reverse()
    old[0], old[-1] = anchors
    replacement = join_paths(list(reversed(branches['west'])), list(reversed(coast)), branches['east'])
    review = {'oldChain': old, 'replacementChain': replacement, 'outerAnchors': anchors,
              'endpointOffsetsCssPx': endpoint_offsets}
    expected = shape(replace_chain(mapping(before_union), old, replacement))
    monaco = Polygon(join_paths(border, coast))
    if (not expected.is_valid or not monaco.is_valid or monaco.interiors
            or monaco.difference(expected).area > 1e-10):
        raise ValueError('Reviewed coastline and border do not bound one Monaco polygon')
    result = {'MCO': mapping(monaco), 'FRA': mapping(expected.difference(monaco))}
    validate_coastal_repair(geometries, result, review)
    if not shape(result['FRA']).boundary.intersection(monaco.boundary).equals(LineString(border)):
        raise ValueError('Coastal counterparts do not share exactly the national boundary')
    sections = [{'countries': ('FRA', 'MCO'), 'anchors': junctions,
                 'master_vertices': len(reference.coords), 'derived_vertices': len(border),
                 'simplification_bound_px': 0}]
    for role, points, code in [('monaco', coast, 'MCO'), ('west', branches['west'], 'FRA'), ('east', branches['east'], 'FRA')]:
        sections.append({'countries': (code,), 'kind': 'coastline', 'referenceRole': role,
                         'anchors': [points[0], points[-1]], 'master_vertices': len(coasts[role].coords),
                         'derived_vertices': len(points), 'simplification_bound_px': 0})
    return result, sections, review


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


def repair_enclave_boundary(geometries, reference, pair, enclave, simplify=True):
    pair = tuple(sorted(pair))
    if set(geometries) != set(pair) or enclave not in pair:
        raise ValueError('Reviewed enclave requires exactly its two owning countries')
    host = next(code for code in pair if code != enclave)
    inner, outer = shape(geometries[enclave]), shape(geometries[host])
    old = extract_shared_chains(geometries).get(pair)
    if (inner.geom_type != 'Polygon' or len(inner.interiors) or old is None
            or not old.is_ring or not old.equals(LineString(inner.exterior.coords))):
        raise ValueError('Enclave must own exactly one complete shared exterior ring')
    host_parts = list(outer.geoms) if outer.geom_type == 'MultiPolygon' else [outer]
    holes = [ring for part in host_parts for ring in part.interiors
             if LineString(ring.coords).equals(old)]
    if len(holes) != 1:
        raise ValueError('Enclave boundary must match exactly one host hole')
    if reference.geom_type != 'LineString' or not reference.is_ring or not Polygon(reference).is_valid:
        raise ValueError('Enclave reference must be one simple closed ring')
    derivative = reference.simplify(SIMPLIFY_DEGREES) if simplify else reference
    if not derivative.is_ring or not Polygon(derivative).is_valid:
        raise ValueError('Derived enclave boundary is not a valid closed ring')
    patches = {code: [{'old': coordinates(old), 'replacement': coordinates(derivative)}] for code in pair}
    result = apply_country_patches(geometries, patches)
    shared = shape(result[host]).boundary.intersection(shape(result[enclave]).boundary)
    if not shared.equals(derivative):
        raise ValueError('Enclave and host do not share the complete replacement ring')
    return result, [{'countries': pair, 'closedRing': True, 'enclave': enclave,
        'old_length_degrees': old.length, 'source_length_degrees': reference.length,
        'master_vertices': len(reference.coords), 'derived_vertices': len(derivative.coords),
        'simplification_bound_px': SIMPLIFY_DEGREES * SCALE if simplify else 0}]


def targeted_candidates(root, output, targets, reference_manifest=None, coast_manifest=None):
    """Accumulate explicitly reviewed targets; emit each country only once."""
    targets = list(dict.fromkeys(targets))
    if not targets or any(target not in REVIEWED_TARGETS for target in targets):
        raise ValueError('An explicitly reviewed boundary target is required')
    plans = [REVIEWED_TARGETS[target] for target in targets]
    codes = set()
    required_pairs = set()
    for plan in plans:
        pair = plan['pair']
        codes.update(pair)
        required_pairs.add(pair)
        if 'junctionCountry' in plan:
            third = plan['junctionCountry']
            codes.add(third)
            required_pairs.update(tuple(sorted((code, third))) for code in pair)
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
    for code in sorted(codes):
        raw_entity = (source / 'countries' / f'state-{code}.json').read_bytes()
        entity = json.loads(raw_entity)
        version = next(v for v in entity['geometryVersions'] if v['versionId'] == selections[entity['entityId']])
        if entity['sourceInfo']['featureId'] != code or version.get('validTo') is not None:
            raise ValueError(f'Historical or mismatched source must not be overwritten: {code}')
        entities[code], versions[code], geometries[code] = entity, version, version['geometry']
        hashes[code] = hashlib.sha256(raw_entity).hexdigest()
    references, ids = {}, {}
    selected_by_pair = {pair: [record for record in records if tuple(sorted((record['properties']['CC1_GENC3'],
                         record['properties']['CC2_GENC3']))) == pair] for pair in sorted(required_pairs)}
    exclusions = exclusion_reasons([record for selected in selected_by_pair.values() for record in selected])
    for pair, selected in selected_by_pair.items():
        if not selected or any(exclusions[id(record)][0] for record in selected):
            raise ValueError(f'Missing or protected reference: {pair}')
        references[pair] = shapely.line_merge(shapely.union_all([shape(record['geometry']) for record in selected]))
        ids[pair] = [record['properties']['ID'] for record in selected]
    overrides = {}
    if reference_manifest is not None:
        reference, metadata = reviewed_reference(root, reference_manifest)
        pair = tuple(metadata['countries'])
        if '/'.join(pair) not in targets:
            raise ValueError('Reviewed reference target was not explicitly selected')
        references[pair], ids[pair], overrides[pair] = reference, [metadata['featureGlobalId']], metadata
    coasts, coast_metadata = None, None
    if coast_manifest is not None:
        if 'FRA/MCO' not in targets:
            raise ValueError('Reviewed coast target was not explicitly selected')
        coasts, coast_metadata = reviewed_coast_reference(root, coast_manifest)
    elif any('coastal' in plan for plan in plans):
        raise ValueError('FRA/MCO requires a pinned reviewed coast manifest')
    updated, sections, coast_reviews = copy.deepcopy(geometries), [], {}
    for target, plan in zip(targets, plans):
        pair = plan['pair']
        if 'coastal' in plan:
            changed, current_sections, review = repair_coastal_boundary(
                {code: updated[code] for code in pair}, references[pair], coasts)
            coast_reviews[target] = review
            status = 'supplemented-with-reviewed-coast'
        elif 'junctionCountry' in plan:
            third = plan['junctionCountry']
            changed, current_sections = repair_tripoint_boundary(
                {code: updated[code] for code in (*pair, third)}, references, pair, third)
            status = 'supplemented-with-reviewed-tripoints'
        else:
            changed, current_sections = repair_enclave_boundary(
                {code: updated[code] for code in pair}, references[pair], pair,
                plan['enclave'], False if pair in overrides else plan.get('simplify', True))
            status = 'supplemented-with-reviewed-enclave'
        updated.update(changed)
        sections.extend({**section, 'target': target, 'status': status} for section in current_sections)
    boundaries = [{'countries': list(section['countries']),
        'sourceLineIds': [coast_metadata['features'][section['referenceRole']]]
            if section.get('kind') == 'coastline' else ids[section['countries']],
        'status': section['status'], 'segments': [{k: v for k, v in section.items() if k != 'countries'}]}
        for section in sections]
    for entry in boundaries:
        if entry['segments'][0].get('kind') == 'coastline':
            entry.update({'kind': 'coastline', 'referenceRole': entry['segments'][0]['referenceRole'],
                          'sourceId': coast_metadata['sourceId'],
                          'referenceManifest': coast_metadata['referenceManifest']})
            continue
        pair = tuple(entry['countries'])
        metadata = overrides.get(pair)
        entry['sourceId'] = metadata['sourceId'] if metadata else SOURCE_ID
        if metadata:
            entry['referenceManifest'] = metadata['referenceManifest']
    changes = []
    for code in sorted(updated):
        relevant_plans = [(target, plan) for target, plan in zip(targets, plans)
                          if code in (*plan['pair'], plan.get('junctionCountry'))]
        tolerance = SIMPLIFY_DEGREES if any(plan.get('simplify', True) and plan['pair'] not in overrides
                                           for _, plan in relevant_plans) else 0
        supplement = {**source_supplement(provenance['published'], tolerance),
                      **copy.deepcopy(versions[code].get('modernBoundarySupplement', {}))}
        full_pairs = {plan['pair'] for _, plan in relevant_plans}
        supplement['boundaries'] = [entry for entry in supplement.get('boundaries', [])
                                    if tuple(entry['countries']) not in full_pairs]
        supplement['boundaries'].extend(entry for entry in boundaries if code in entry['countries'])
        for target, plan in relevant_plans:
            if 'junctionCountry' in plan:
                supplement['reviewedTripointRepair'] = {'target': list(plan['pair']),
                    'junctionCountry': plan['junctionCountry'], 'historicalAccuracyVerified': False,
                    'effectiveDateEstablished': False}
        supplement['reviewedBoundaryRepairs'] = supplement.get('reviewedBoundaryRepairs', []) + [
            {'target': target, 'historicalAccuracyVerified': False, 'effectiveDateEstablished': False}
            for target, _ in relevant_plans]
        source_ids = dict.fromkeys(versions[code]['sourceId'].split('+'))
        for entry in boundaries:
            if code in entry['countries']:
                source_ids[entry['sourceId']] = None
        attributions = []
        for pair, metadata in overrides.items():
            if code in pair:
                attributions.append({key: metadata[key] for key in
                    ('sourceId', 'title', 'published', 'url', 'license', 'licenseUrl', 'attribution', 'sourceFile')})
        if attributions:
            supplement['sourceId'] = '+'.join(key for key in source_ids if key != 'natural-earth-5.1.1')
            supplement['published'] = max([supplement['published'], *(a['published'] for a in attributions)])
            supplement['additionalSources'] = supplement.get('additionalSources', []) + attributions
            if not versions[code].get('modernBoundarySupplement'):
                supplement['sourceFile'] = attributions[0]['sourceFile']
        if coast_metadata and code in ('FRA', 'MCO'):
            attribution = {key: coast_metadata[key] for key in
                ('sourceId', 'title', 'published', 'url', 'license', 'licenseUrl', 'attribution', 'sourceFile',
                 'retrieved', 'lastModified', 'confirmed')}
            attributions.append(attribution)
            supplement.update({'coastline': 'reviewed-ign-replacement',
                               'coastlineReview': {'referenceManifest': coast_metadata['referenceManifest'],
                                   'sourceId': coast_metadata['sourceId'], 'effectiveDateEstablished': False,
                                   'historicalAccuracyVerified': False},
                               'sourceId': '+'.join(key for key in source_ids if key != 'natural-earth-5.1.1')})
            supplement['additionalSources'] = supplement.get('additionalSources', []) + [attribution]
        changes.append({'entityId': entities[code]['entityId'], 'geometryVersionId': versions[code]['versionId'],
            'inputFileSha256': hashes[code], 'sourceId': '+'.join(source_ids), 'sourceAttributions': attributions,
            'geometry': updated[code], 'supplement': supplement})
    result = {'schemaVersion': 1, 'sourceId': SOURCE_ID, 'sourcePublished': provenance['published'],
        'sourceRevision': json.loads((root / 'config/library-data.json').read_text(encoding='utf-8'))['revision'],
        'changes': changes, 'boundaries': boundaries}
    if coast_reviews:
        result['coastReviews'] = coast_reviews
    json_write(output, result)
    print(json.dumps({'targets': targets, 'changedCountries': len(changes), 'sections': len(sections), 'output': str(output)}))


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
