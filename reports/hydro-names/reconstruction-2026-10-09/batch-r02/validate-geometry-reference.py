#!/usr/bin/env python3
"""Offline compact-package checks; optional verified-input replay uses Node.js."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import subprocess
import tempfile
from pathlib import Path

IDS = ['1159115267', '1159123531', '1159107099']
JOINS = [(15789, 4414), (16267, 4892), (15239, 3864)]
COMMIT = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verified(path, receipt):
    data = path.read_bytes()
    assert len(data) == receipt['bytes'] and digest(data) == receipt['sha256'], path.name
    if 'git_blob_sha' in receipt:
        assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == receipt['git_blob_sha'], path.name
    return data


def feature_texts(text):
    """Return complete original JSON objects, without rewriting numeric tokens."""
    cursor = text.index('[', text.index('"features"')) + 1
    decoder = json.JSONDecoder()
    rows = []
    while True:
        while text[cursor].isspace() or text[cursor] == ',':
            cursor += 1
        if text[cursor] == ']':
            return rows
        feature, end = decoder.raw_decode(text, cursor)
        rows.append((feature, text[cursor:end]))
        cursor = end


def polygons(geometry):
    assert geometry['type'] in ('Polygon', 'MultiPolygon')
    return [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']


def check_geometry(geometry, record):
    parts = polygons(geometry)
    assert geometry['type'] == record['type']
    assert len(parts) == record['polygon_part_count']
    assert [len(part) for part in parts] == record['ring_counts_by_part']
    assert [[len(ring) for ring in part] for part in parts] == record['coordinate_counts_by_part_and_ring']
    points = []
    for part in parts:
        assert part
        for ring in part:
            assert len(ring) >= 4 and ring[0] == ring[-1]
            for point in ring:
                assert len(point) == 2 and all(math.isfinite(v) for v in point)
                assert -180 <= point[0] <= 180 and -90 <= point[1] <= 90
                points.append(point)
    assert record['all_rings_closed'] is True
    assert len(points) == record['total_coordinates_including_closure']
    assert [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)] == record['bbox']
    assert digest(canonical(geometry)) == record['canonical_geometry_sha256']


def main():
    if not __debug__:
        raise RuntimeError('Validation requires Python assertions; do not use -O.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--input-cache', type=Path, help='Recheck complete inputs and replay actual baseline decoding.')
    parser.add_argument('--historical-input-root', type=Path, help='Recheck recovered repository files and selected priority/CSV joins.')
    args = parser.parse_args()
    root = args.directory
    ref = json.loads((root / 'geometry-reference.json').read_text())
    assert ref['schema'] == 'hydro-reconstruction-geometry-reference-v2'
    assert ref['scope_source_ids'] == IDS and ref['batch'] == 'r02'
    assert ref['baseline']['git_commit'] == COMMIT and ref['baseline']['hydro_version'] == '0.13.1'
    assert ref['baseline']['current_live_deployment_checked'] is False
    assert ref['baseline']['current_live_deployment_equality_claimed'] is False
    assert ref['baseline']['baseline_assets_retrieved_this_batch'] is False
    assert ref['baseline']['baseline_cached_assets_hash_checked_this_batch'] is True
    for name, receipt in ref['artifacts'].items():
        assert Path(name).name == name
        verified(root / name, receipt)
    source_text = (root / 'selected-lake-geometries.geojson').read_text()
    source = json.loads(source_text)
    rendered = json.loads((root / 'selected-baseline-rendered-geometries.geojson').read_text())
    assert source['type'] == rendered['type'] == 'FeatureCollection'
    assert [str(f['properties']['source_id']) for f in source['features']] == IDS
    assert [f['properties']['sourceId'] for f in rendered['features']] == IDS
    assert [r['source_id'] for r in ref['selected_features']] == IDS
    texts = feature_texts(source_text)
    assert len(texts) == 3
    for i, (src, dst, record) in enumerate(zip(source['features'], rendered['features'], ref['selected_features'])):
        ident = IDS[i]
        assert str(src['properties']['source_id']) == dst['properties']['sourceId'] == record['source_id'] == ident
        assert src['id'] == dst['id'] == src['properties']['pandolab_id'] == dst['properties']['awId'] == record['aw_id'] == 'lakes_base:' + ident
        assert dst['properties'] == record['baseline_metadata_exact']
        assert (dst['properties']['fid'], dst['properties']['logicalFid']) == (record['baseline_fid'], record['baseline_logical_fid']) == JOINS[i]
        assert dst['properties']['fragmentCount'] == 1 and dst['properties']['fragmentIndex'] == 0
        assert digest(ident.encode()) == record['source_ids_sha256']
        assert digest(canonical(src)) == record['source_feature_canonical_sha256']
        assert digest(canonical(dst)) == record['baseline_feature_canonical_sha256']
        assert texts[i][0] == src
        assert len(texts[i][1].encode()) == record['source_feature_original_json_bytes']
        assert digest(texts[i][1].encode()) == record['source_feature_original_json_sha256']
        for field in ['name_ko', 'name_en', 'name_original']:
            assert src['properties'][field] == ''
        assert src['properties']['name'] == dst['properties']['name']
        check_geometry(src['geometry'], record['source_geometry'])
        check_geometry(dst['geometry'], record['baseline_rendered_geometry'])
        assert [v / 1e6 for v in dst['properties']['bounds']] == record['baseline_rendered_geometry']['bbox']
        left, right = polygons(src['geometry']), polygons(dst['geometry'])
        assert len(left) == len(right)
        deltas = []
        for source_part, rendered_part in zip(left, right):
            assert len(source_part) == len(rendered_part)
            for source_ring, rendered_ring in zip(source_part, rendered_part):
                assert len(source_ring) == len(rendered_ring)
                assert [[round(x, 6), round(y, 6)] for x, y in source_ring] == rendered_ring
                deltas.extend(abs(x-y) for p,q in zip(source_ring,rendered_ring) for x,y in zip(p,q))
        comparison = record['source_to_baseline_comparison']
        assert comparison == {'same_geometry_type': src['geometry']['type'] == dst['geometry']['type'], 'same_part_ring_and_vertex_order': True, 'every_coordinate_matches_source_rounded_to_6_decimals': True, 'maximum_absolute_coordinate_difference_degrees': max(deltas)}
    packs = json.loads((root / 'selected-pack-receipts.json').read_text())
    assert packs == ref['selected_baseline_packs']
    assert [(p['id'],p['shard'],p['offset'],p['length'],p['stage']) for p in packs] == [(1,0,26736,174465,0),(15,0,1320273,107649,0),(148,0,3611460,24223,2)]
    rights = json.loads((root / 'geometry-publication-rights.json').read_text())
    assert rights == ref['rights'] and rights['retrieved_this_batch'] is False
    receipts = json.loads((root / 'geometry-request-receipts.json').read_text())
    assert receipts['new_external_request_count'] == 0 and len(receipts['receipts']) == 10
    for entry in receipts['receipts']:
        assert entry['new_external_request_in_r02'] is False
        assert entry['original_completed_at_utc'] < entry['reuse_hash_checked_at_utc']
        asset = ref['source_assets'].get(entry['asset_name'])
        if asset:
            assert entry['sha256'] == asset['sha256'] and entry['bytes'] == asset['bytes']
            assert entry['original_completed_at_utc'] == asset['original_retrieved_at_utc']
    if args.input_cache:
        for name, receipt in ref['source_assets'].items():
            verified(args.input_cache / name, receipt)
        verified(args.input_cache / 'naturalearth-terms.html', {'bytes':rights['original_html_bytes'],'sha256':rights['original_html_sha256']})
        original = feature_texts((args.input_cache / 'lakes_base.geojson').read_text())
        core = {r['fid']:r for r in json.loads(gzip.decompress((args.input_cache / 'metadata-core.json.gz').read_bytes()))['features']}
        detail = {r['fid']:r for r in json.loads(gzip.decompress((args.input_cache / 'metadata-detail.json.gz').read_bytes()))['features']}
        for i,record in enumerate(ref['selected_features']):
            assert texts[i] == original[record['source_feature_zero_based_index']]
            fid = record['baseline_fid']
            assert core[fid] | detail[fid] == record['baseline_metadata_exact']
        shard = (args.input_cache / 'shard-s0.bin').read_bytes()
        for pack in packs:
            assert digest(shard[pack['offset']:pack['offset']+pack['length']]) == pack['sha256']
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'selected-baseline-rendered-geometries.geojson'
            subprocess.run(['node',str(root / 'extract-baseline-geometries.mjs'),str(args.input_cache),str(output)],check=True,capture_output=True,text=True)
            assert output.read_bytes() == (root / output.name).read_bytes()
            assert (output.parent / 'selected-pack-receipts.json').read_bytes() == (root / 'selected-pack-receipts.json').read_bytes()
    if args.historical_input_root:
        for receipt in ref['historical_inputs']:
            verified(args.historical_input_root / receipt['repository_path'], receipt)
        historical = args.historical_input_root / 'reports/hydro-names/current-web-2026-10-08'
        priority = {r['source_id']:r for r in json.loads((historical / 'priority-candidates.json').read_text())['lake']}
        inventory = {r['source_id']:r for r in csv.DictReader(io.StringIO(gzip.decompress((historical / 'inventory.csv.gz').read_bytes()).decode())) if r['source_id'] in IDS}
        summary = json.loads((historical / 'summary.json').read_text())
        assert summary['baseline_sha'] == COMMIT and summary['manifest_sha256'] == ref['baseline']['manifest_sha256']
        for name in ['lakes_base.geojson','metadata-core.json.gz','metadata-detail.json.gz']:
            assert summary['input_receipts'][name] == {k:ref['source_assets'][name][k] for k in ('bytes','sha256')}
        for record in ref['selected_features']:
            ident=record['source_id']; p=priority[ident]; c=inventory[ident]; m=record['baseline_metadata_exact']
            assert p['geometry_fids'] == [record['baseline_fid']]
            assert p['logical_fid'] == int(c['logical_fid']) == record['baseline_logical_fid']
            assert p['aw_id'] == c['aw_id'] == record['aw_id']
            assert p['source_ids_sha256'] == c['source_ids_sha256'] == record['source_ids_sha256']
            assert p['bbox'] == json.loads(c['bbox']) == record['baseline_rendered_geometry']['bbox']
            assert p['minimum_stage'] == int(c['minimum_stage']) == m['stage']
            assert p['rendered_area_km2'] == float(c['rendered_area_km2']) == record['historical_rendered_area_km2']
            assert p['geometry_count'] == int(c['geometry_count']) == m['fragmentCount'] == 1
            assert p['canonical_name_fields']['name'] == m['name']
    print(json.dumps({'status':'passed','selected_source_ids':IDS,'source_feature_count':3,'baseline_rendered_feature_count':3,'source_coordinate_counts_including_closure':[95,184,88],'source_feature_json_tokens_preserved':True,'all_original_input_hashes_and_exact_feature_joins_checked':bool(args.input_cache),'baseline_production_decoder_replayed':bool(args.input_cache),'historical_inputs_and_selected_inventory_joins_checked':bool(args.historical_input_root),'current_live_deployment_checked':False}))

if __name__ == '__main__':
    main()
