#!/usr/bin/env python3
"""Offline checks for this three-feature evidence package; no network or mutation."""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

IDS = ['1159109497', '1159106899', '1159107065']

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def polygons(geometry):
    assert geometry['type'] in ('Polygon', 'MultiPolygon')
    return [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']

def check_geometry(geometry, record):
    parts = polygons(geometry)
    points = []
    assert len(parts) == record['polygon_part_count']
    assert [len(part) for part in parts] == record['ring_counts_by_part']
    assert [[len(ring) for ring in part] for part in parts] == record['coordinate_counts_by_part_and_ring']
    for part in parts:
        assert part
        for ring in part:
            assert len(ring) >= 4 and ring[0] == ring[-1]
            for point in ring:
                assert len(point) == 2 and all(math.isfinite(v) for v in point)
                assert -180 <= point[0] <= 180 and -90 <= point[1] <= 90
                points.append(point)
    assert len(points) == record['total_coordinates_including_closure']
    assert [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)] == record['bbox']
    assert digest(canonical(geometry)) == record['canonical_geometry_sha256']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--input-cache', type=Path, help='Also compare extracted features to complete hash-verified original inputs.')
    args = parser.parse_args()
    root = args.directory
    reference = json.loads((root / 'geometry-reference.json').read_text())
    assert reference['scope_source_ids'] == IDS
    assert reference['baseline']['git_commit'] == 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
    assert reference['baseline']['current_live_deployment_checked'] is False
    for name, receipt in reference['artifacts'].items():
        data = (root / name).read_bytes()
        assert len(data) == receipt['bytes'] and digest(data) == receipt['sha256'], name
    source = json.loads((root / 'selected-lake-geometries.geojson').read_text())
    rendered = json.loads((root / 'selected-baseline-rendered-geometries.geojson').read_text())
    assert source['type'] == rendered['type'] == 'FeatureCollection'
    assert [str(f['properties']['source_id']) for f in source['features']] == IDS
    assert [f['properties']['sourceId'] for f in rendered['features']] == IDS
    assert len(reference['selected_features']) == 3
    for src, dst, record in zip(source['features'], rendered['features'], reference['selected_features']):
        ident = record['source_id']
        assert str(src['properties']['source_id']) == dst['properties']['sourceId'] == ident
        assert src['id'] == dst['id'] == record['aw_id'] == 'lakes_base:' + ident
        assert dst['properties'] == record['baseline_metadata_exact']
        assert dst['properties']['fid'] == record['baseline_fid']
        assert dst['properties']['logicalFid'] == record['baseline_logical_fid']
        assert dst['properties']['fragmentCount'] == 1
        assert digest(ident.encode()) == record['source_ids_sha256']
        assert digest(canonical(src)) == record['source_feature_canonical_sha256']
        assert digest(canonical(dst)) == record['baseline_feature_canonical_sha256']
        for field in ['name_ko', 'name_en', 'name_original']:
            assert src['properties'][field] == ''
        check_geometry(src['geometry'], record['source_geometry'])
        check_geometry(dst['geometry'], record['baseline_rendered_geometry'])
        left, right = polygons(src['geometry']), polygons(dst['geometry'])
        assert len(left) == len(right)
        for source_part, rendered_part in zip(left, right):
            assert len(source_part) == len(rendered_part)
            for source_ring, rendered_ring in zip(source_part, rendered_part):
                assert len(source_ring) == len(rendered_ring)
                assert [[round(x, 6), round(y, 6)] for x, y in source_ring] == rendered_ring
    checked_original_inputs = False
    if args.input_cache:
        for name, receipt in reference['source_assets'].items():
            data = (args.input_cache / name).read_bytes()
            assert len(data) == receipt['bytes'] and digest(data) == receipt['sha256'], name
        original = json.loads((args.input_cache / 'lakes_base.geojson').read_text())['features']
        core = {r['fid']: r for r in json.loads(gzip.decompress((args.input_cache / 'metadata-core.json.gz').read_bytes()))['features']}
        detail = {r['fid']: r for r in json.loads(gzip.decompress((args.input_cache / 'metadata-detail.json.gz').read_bytes()))['features']}
        for src, dst, record in zip(source['features'], rendered['features'], reference['selected_features']):
            assert src == original[record['source_feature_zero_based_index']]
            fid = record['baseline_fid']
            assert core[fid] | detail[fid] == dst['properties']
        checked_original_inputs = True
    print(json.dumps({'status': 'passed', 'selected_source_ids': IDS, 'source_feature_count': 3, 'baseline_rendered_feature_count': 3, 'all_original_input_hashes_and_exact_feature_joins_checked': checked_original_inputs, 'current_live_deployment_checked': False}))

if __name__ == '__main__':
    main()
