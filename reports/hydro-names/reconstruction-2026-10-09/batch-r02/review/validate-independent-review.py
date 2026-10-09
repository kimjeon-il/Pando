#!/usr/bin/env python3
"""Offline validation. Compact package checks work alone; optional local originals enable full replay.

Inputs are the public package, the immutable geometry input cache, the recovered
historical-input root, and an optional private original-source index. The latter
maps public original_id values to local_path values and is never published.
"""
import argparse
import gzip
import hashlib
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

IDS = ['1159115267', '1159123531', '1159107099']
JOINS = [(15789, 4414, 95), (16267, 4892, 184), (15239, 3864, 88)]
GEOMETRY_MANIFEST_SHA256 = 'cc2a43c37e543b780e8d326a7ce4fc8d7aa439eb47c9beb6afc4ebe00f6c73bd'


def require(condition, label):
    if not condition:
        raise ValueError(label)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_bytes())


def checked(path, pin):
    data = path.read_bytes()
    require(sha(data) == pin['sha256'], 'SHA-256 mismatch: ' + path.name)
    if 'bytes' in pin:
        require(len(data) == pin['bytes'], 'Byte-count mismatch: ' + path.name)
    return data


def feature_tokens(text):
    p = text.index('[', text.index('"features"')) + 1
    decoder = json.JSONDecoder()
    result = []
    while True:
        while text[p].isspace() or text[p] == ',':
            p += 1
        if text[p] == ']':
            return result
        value, end = decoder.raw_decode(text, p)
        result.append((value, text[p:end]))
        p = end


def decode_index(data):
    require(struct.unpack_from('<IH', data) == (0x34495741, 4), 'Index format')
    tiles, logicals, packs = struct.unpack_from('<III', data, 8)
    p = 20
    for _ in range(tiles):
        n = struct.unpack_from('<H', data, p + 5)[0]
        p += 7 + 4 * n
    logical = {}
    for _ in range(logicals):
        ident, n = struct.unpack_from('<IH', data, p)
        p += 6
        require(ident not in logical, 'Duplicate logical index ID')
        logical[ident] = list(struct.unpack_from('<' + 'I' * n, data, p))
        p += 4 * n
    specs = {}
    for _ in range(packs):
        ident, shard, start, length, stage = struct.unpack_from('<IHIIB', data, p)
        require(ident not in specs, 'Duplicate pack ID')
        specs[ident] = dict(id=ident, shard=shard, offset=start, length=length, stage=stage)
        p += 15
    require(p == len(data), 'Index trailing or missing bytes')
    return logical, specs


def decode_polygon(data, kind):
    require(kind in (3, 4), 'Selected feature is not a polygon')
    p = 0
    def uvar():
        nonlocal p
        value, shift = 0, 0
        while p < len(data) and shift <= 35:
            b = data[p]
            p += 1
            value |= (b & 127) << shift
            if not b & 128:
                return value
            shift += 7
        raise ValueError('Invalid geometry varint')
    def svar():
        v = uvar()
        return (v >> 1) ^ -(v & 1)
    parts = []
    for _ in range(uvar()):
        rings = []
        for _ in range(uvar()):
            ring, x, y = [], 0, 0
            for _ in range(uvar()):
                x += svar()
                y += svar()
                ring.append([x / 1000000, y / 1000000])
            rings.append(ring)
        parts.append(rings)
    require(p == len(data), 'Unconsumed selected geometry bytes')
    require(kind != 3 or len(parts) == 1, 'Invalid Polygon part count')
    return {'type': 'Polygon' if kind == 3 else 'MultiPolygon', 'coordinates': parts[0] if kind == 3 else parts}


def independently_decode(cache, root, reference):
    for name, pin in reference['source_assets'].items():
        checked(cache / name, pin)
    logical, specs = decode_index(gzip.decompress((cache / 'index.bin.gz').read_bytes()))
    core = {r['fid']: r for r in json.loads(gzip.decompress((cache / 'metadata-core.json.gz').read_bytes()))['features']}
    detail = {r['fid']: r for r in json.loads(gzip.decompress((cache / 'metadata-detail.json.gz').read_bytes()))['features']}
    source_tokens = feature_tokens((cache / 'lakes_base.geojson').read_text())
    selected_tokens = feature_tokens((root / 'selected-lake-geometries.geojson').read_text())
    baseline = read_json(root / 'selected-baseline-rendered-geometries.geojson')['features']
    require(len(selected_tokens) == len(baseline) == 3, 'Selected feature count')
    target_fids = {fid for fid, _, _ in JOINS}
    selected_packs = set()
    for _, logical_id, _ in JOINS:
        selected_packs.update(logical[logical_id])
    require(selected_packs == {1, 15, 148}, 'Unexpected selected packs')
    shard = (cache / 'shard-s0.bin').read_bytes()
    decoded = {}
    for pack_id in sorted(selected_packs):
        spec = specs[pack_id]
        require(spec['shard'] == 0, 'Unexpected shard')
        compressed = shard[spec['offset']:spec['offset'] + spec['length']]
        expected = next(r for r in reference['selected_baseline_packs'] if r['id'] == pack_id)
        require(spec | {'sha256': sha(compressed)} == expected, 'Pack-index/receipt mismatch')
        data = gzip.decompress(compressed)
        require(struct.unpack_from('<IH', data) == (0x46485741, 4), 'Pack format')
        count = struct.unpack_from('<I', data, 8)[0]
        p = 12
        for _ in range(count):
            fields = struct.unpack_from('<IIBBBBHHfiiiiII', data, p)
            fid, logical_id, category, stage, kind, flags, fragment, fragments, width = fields[:9]
            bounds, glen, wlen = list(fields[9:13]), fields[13], fields[14]
            p += 44
            require(p + glen + wlen <= len(data), 'Truncated feature')
            if fid in target_fids:
                require(fid not in decoded, 'Duplicate selected feature')
                meta = core[fid] | detail[fid]
                require((logical_id, stage, flags, fragment, fragments, width, bounds) == (meta['logicalFid'], meta['stage'], meta['flags'], meta['fragmentIndex'], meta['fragmentCount'], meta['width'], meta['bounds']), 'Pack descriptor/metadata mismatch')
                require(category == 2 and wlen == 0, 'Unexpected selected feature category/width profile')
                decoded[fid] = decode_polygon(data[p:p + glen], kind)
            p += glen + wlen
        require(p == len(data), 'Pack trailing bytes')
    results = []
    for i, (ident, (fid, logical_id, count)) in enumerate(zip(IDS, JOINS)):
        rec = reference['selected_features'][i]
        src, token = selected_tokens[i]
        original = source_tokens[rec['source_feature_zero_based_index']]
        require((src, token) == original, 'Original complete feature token mismatch')
        require(sha(token.encode()) == rec['source_feature_original_json_sha256'], 'Original feature token hash')
        meta = core[fid] | detail[fid]
        require(meta == baseline[i]['properties'] == rec['baseline_metadata_exact'], 'Metadata mismatch')
        require(str(src['properties']['source_id']) == meta['sourceId'] == rec['source_id'] == ident, 'Source-ID join')
        require(meta['logicalFid'] == logical_id, 'Logical-FID join')
        require(src['id'] == meta['awId'] == 'lakes_base:' + ident, 'AW-ID join')
        require(decoded[fid] == baseline[i]['geometry'], 'Independent binary decode mismatch')
        require(src['geometry']['type'] == decoded[fid]['type'] == 'Polygon', 'Geometry type')
        sr, dr = src['geometry']['coordinates'], decoded[fid]['coordinates']
        require(len(sr) == len(dr) == 1 and len(sr[0]) == len(dr[0]) == count, 'Part/ring/coordinate count')
        require(sr[0][0] == sr[0][-1] and dr[0][0] == dr[0][-1], 'Open ring')
        require(all(len(p) == 2 and all(math.isfinite(v) for v in p) for p in sr[0]), 'Nonfinite coordinate')
        require([[round(x, 6), round(y, 6)] for x, y in sr[0]] == dr[0], 'Ordered six-decimal coordinate comparison')
        results.append({'source_id': ident, 'fid': fid, 'logical_fid': logical_id, 'coordinate_count_including_closure': count, 'original_feature_bytes_preserved': True, 'independent_binary_geometry_matches': True, 'ordered_coordinate_comparison': 'passed'})
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--input-cache', type=Path)
    p.add_argument('--historical-input-root', type=Path)
    p.add_argument('--local-source-index', type=Path)
    args = p.parse_args()
    root = args.package
    review = root / 'review'
    pins = read_json(review / 'frozen-input-pins.json')
    require(pins['source_ids'] == IDS, 'Frozen scope')
    for entry in pins['package_inputs']:
        require(Path(entry['file']).name == entry['file'], 'Non-flat public input filename')
        checked(root / entry['file'], entry)
    manifest = checked(root / 'geometry-component-manifest.json', {'sha256': GEOMETRY_MANIFEST_SHA256})
    for name, expected in json.loads(manifest)['files'].items():
        checked(root / name, {'sha256': expected})
    ref = read_json(root / 'geometry-reference.json')
    require(ref['baseline']['current_live_deployment_checked'] is False, 'Unsupported deployment claim')
    results = independently_decode(args.input_cache, root, ref) if args.input_cache else []
    geometry_command = [sys.executable, str(root / 'validate-geometry-reference.py'), '--directory', str(root)]
    if args.input_cache:
        geometry_command += ['--input-cache', str(args.input_cache)]
    if args.historical_input_root:
        geometry_command += ['--historical-input-root', str(args.historical_input_root)]
    geometry = subprocess.run(geometry_command, check=True, capture_output=True, text=True)
    geometry_result = json.loads(geometry.stdout)
    require(geometry_result['baseline_production_decoder_replayed'] is bool(args.input_cache), 'Decoder replay status mismatch')
    source_checks = 0
    if args.local_source_index:
        local = read_json(args.local_source_index)
        for entry in pins['original_sources']:
            checked(Path(local[entry['original_id']]['local_path']), entry)
            source_checks += 1
    verdict = read_json(review / 'independent-review.json')
    require(verdict['automatic_application'] is False and verdict['scalar_product_name_approvals'] == 0, 'Application gate')
    require([r['source_id'] for r in verdict['findings']] == IDS, 'Verdict scope')
    require(all(r['name_ko'] is None and r['formal_registry_verified'] is False and r['surveyed_shoreline_approved'] is False for r in verdict['findings']), 'Unsupported language/registry/shoreline claim')
    require(verdict['findings'][1]['precise_water_mask_verdict'] == 'hold_visible_geometry_mismatch', 'Reservoir hold lost')
    require(verdict['findings'][2]['identity'] == 'Buffalo Lake', 'Northern-lake identity')
    z = read_json(root / 'zhari-findings.json')
    t = read_json(root / 'tres-irmaos-findings.json')
    n = read_json(root / 'northern-lake-findings.json')
    require(z['verdict']['name_ko'] is None and t['verdict']['name_ko'] is None and n['verdict']['name_korean'] is None, 'Source-submission Korean gate')
    require(z['review_gate']['automatic_application'] is False and t['review_gate']['automatic_application'] is False and n['application']['automatic_application'] is False, 'Source-submission application gate')
    require(t['prominent_geometry_warning']['accurate_water_mask'] is False, 'Source-submission geometry warning')
    def collect_hashes(value):
        if isinstance(value, dict):
            found = {value['sha256']} if 'sha256' in value else set()
            return found.union(*(collect_hashes(v) for v in value.values()))
        if isinstance(value, list):
            return set().union(*(collect_hashes(v) for v in value))
        return set()
    evidence_hashes = set().union(*(collect_hashes(read_json(root / name)) for name in ['zhari-source-evidence.json', 'tres-irmaos-source-evidence.json', 'northern-lake-source-evidence.json']))
    require(len(pins['original_sources']) == 13, 'Original-source pin count')
    require(all(e['sha256'] in evidence_hashes and e['status'] == 200 and e['published_raw'] is False for e in pins['original_sources']), 'Source-receipt pin or publication flags')
    # Review artifacts remain own factual text/code. No raw map or original HTML/PDF.
    allowed_suffixes = {'.json', '.py', '.md'}
    require(all(f.suffix in allowed_suffixes for f in review.iterdir() if f.is_file()), 'Unexpected review artifact type')
    manifest_path = review / 'review-manifest.json'
    if manifest_path.exists():
        review_manifest = read_json(manifest_path)
        for entry in review_manifest['files']:
            require(Path(entry['file']).name == entry['file'], 'Non-flat review filename')
            checked(review / entry['file'], entry)
    print(json.dumps({'status': 'passed', 'validation_mode': 'complete_local_inputs' if args.input_cache and args.historical_input_root and args.local_source_index else 'package_only' if not any([args.input_cache, args.historical_input_root, args.local_source_index]) else 'partial_local_inputs', 'package_input_count': len(pins['package_inputs']), 'public_shapes_order_and_hashes_checked': True, 'public_findings_and_source_flags_checked': True, 'local_original_sources_hash_checked': source_checks, 'independent_binary_decode_performed': bool(args.input_cache), 'independent_binary_decode': results, 'production_decoder_replayed': bool(args.input_cache), 'historical_selected_inventory_joins_rechecked': bool(args.historical_input_root), 'network_requests': 0, 'current_live_deployment_checked': False, 'automatic_application': False, 'scalar_product_name_approvals': 0}, ensure_ascii=False, indent=2))



if __name__ == '__main__':
    main()
