#!/usr/bin/env python3
"""Offline, bounded review validation. Default mode cannot recheck unpublished coordinates or source bodies."""
import argparse
import gzip
import hashlib
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

IDS = ['30624681', '50488324', '40182409']
FIDS = [15165, 15166, 6748, 6749, 6750, 6751, 6752, 3103, 3104]
GEOMETRY_MANIFEST_SHA256 = '63e5995359bc135d3bbb2a6cc315c11cd48fc47646725e6cd7a7a085cc8e4eaf'
COMMIT = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'


def require(condition, label):
    if not condition:
        raise ValueError(label)


def read_json(path):
    return json.loads(path.read_bytes())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canon(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def checked(path, pin):
    data = path.read_bytes()
    require(sha(data) == pin['sha256'], 'SHA-256 mismatch: ' + path.name)
    require('bytes' not in pin or len(data) == pin['bytes'], 'Byte count: ' + path.name)
    return data


def line_parts(g):
    require(g['type'] in ('LineString', 'MultiLineString'), 'Selected geometry must be a line')
    return [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']


def validate_local_features(features, facts, groups):
    require([f['properties']['fid'] for f in features] == FIDS, 'Complete ordered fragment selection')
    results = []
    for f, row in zip(features, facts):
        fid, g, m = row['fid'], f['geometry'], f['properties']
        pp = line_parts(g)
        xy = [point for part in pp for point in part]
        require(pp and all(len(p) >= 2 for p in pp), 'Empty or short line part')
        require(all(len(p) == 2 and all(math.isfinite(v) for v in p) and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in xy), 'Invalid coordinate')
        require(sha(canon(g)) == row['geometry']['canonical_geometry_sha256'], 'Full ordered geometry hash: ' + str(fid))
        require(sha(canon(m)) == row['baseline_metadata_canonical_sha256'], 'Full metadata hash')
        require(sha(canon(f)) == row['baseline_feature_canonical_sha256'], 'Full feature hash')
        require([len(p) for p in pp] == row['geometry']['coordinate_counts_by_part'], 'Part order and size')
        require(len(pp) == row['geometry']['part_count'] and len(xy) == row['geometry']['coordinate_count'], 'Complete coordinate count')
        bounds = [min(p[0] for p in xy), min(p[1] for p in xy), max(p[0] for p in xy), max(p[1] for p in xy)]
        require(bounds == row['geometry']['bounds'], 'Full-coordinate bounds')
        require([pp[0][0], pp[-1][-1]] == row['geometry']['fragment_endpoints'], 'Fragment endpoints')
        discontinuities = sum(a[-1] != b[0] for a, b in zip(pp, pp[1:]))
        require(discontinuities == 0, 'Unexpected internal endpoint discontinuity')
        results.append({'fid': fid, 'part_count': len(pp), 'coordinate_count': len(xy), 'ordered_geometry_hash_matched': True, 'internal_endpoint_discontinuities': discontinuities})
    byfid = {f['properties']['fid']: f for f in features}
    for upstream, downstream in [(15165, 15166), (6748, 6749), (6749, 6750), (6751, 6752), (3103, 3104)]:
        require(line_parts(byfid[upstream]['geometry'])[-1][-1] == line_parts(byfid[downstream]['geometry'])[0][0], 'Known adjacent fragment endpoint join')
    for group in groups:
        selected = [f['geometry'] for f in features if f['properties']['systemId'] == group['system_id']]
        require(sha(canon(selected)) == group['canonical_ordered_group_geometry_sha256'], 'Ordered whole-group geometry hash')
    return results


def decode_index(data):
    require(struct.unpack_from('<IH', data) == (0x34495741, 4), 'Binary index format')
    tile_count, logical_count, pack_count = struct.unpack_from('<III', data, 8)
    p = 20
    for _ in range(tile_count):
        count = struct.unpack_from('<H', data, p + 5)[0]
        p += 7 + count * 4
    logical = {}
    for _ in range(logical_count):
        ident, count = struct.unpack_from('<IH', data, p)
        p += 6
        require(ident not in logical, 'Duplicate logical index ID')
        logical[ident] = list(struct.unpack_from('<' + 'I' * count, data, p))
        p += count * 4
    packs = {}
    for _ in range(pack_count):
        ident, shard, offset, length, stage = struct.unpack_from('<IHIIB', data, p)
        require(ident not in packs, 'Duplicate pack ID')
        packs[ident] = dict(id=ident, shard=shard, offset=offset, length=length, stage=stage)
        p += 15
    require(p == len(data), 'Index byte coverage')
    return logical, packs


class Varints:
    def __init__(self, data):
        self.data, self.p = data, 0

    def unsigned(self):
        value = shift = 0
        while self.p < len(self.data) and shift <= 35:
            b = self.data[self.p]
            self.p += 1
            value |= (b & 127) << shift
            if not b & 128:
                return value
            shift += 7
        raise ValueError('Incomplete or oversized varint')

    def signed(self):
        v = self.unsigned()
        return (v >> 1) ^ -(v & 1)


def decode_line(data, kind):
    require(kind in (1, 2), 'Binary selected non-line geometry')
    v, parts = Varints(data), []
    for _ in range(v.unsigned()):
        count, x, y, points = v.unsigned(), 0, 0, []
        require(count >= 2, 'Short binary line part')
        for _ in range(count):
            x += v.signed()
            y += v.signed()
            points.append([q // 1000000 if q % 1000000 == 0 else q / 1000000 for q in (x, y)])
        parts.append(points)
    require(v.p == len(data), 'Selected geometry trailing bytes')
    require(parts and (kind != 1 or len(parts) == 1), 'Line type/part count')
    return {'type': 'LineString' if kind == 1 else 'MultiLineString', 'coordinates': parts[0] if kind == 1 else parts}


def check_width_profile(data, g):
    if not data:
        return
    v, pp = Varints(data), line_parts(g)
    require(v.unsigned() == len(pp), 'Width profile part count')
    for part in pp:
        count = v.unsigned()
        require(count == len(part), 'Width profile vertex count')
        width = v.unsigned() if count else 0
        for _ in range(1, count):
            width += v.signed()
    require(v.p == len(data), 'Width profile trailing bytes')


def independent_decode(cache, root, ref):
    for name, pin in ref['source_assets'].items():
        require(Path(name).name == name, 'Non-flat cache key')
        checked(cache / name, pin)
    logical, specs = decode_index(gzip.decompress((cache / 'index.bin.gz').read_bytes()))
    core = {r['fid']: r for r in json.loads(gzip.decompress((cache / 'metadata-core.json.gz').read_bytes()))['features']}
    detail = {r['fid']: r for r in json.loads(gzip.decompress((cache / 'metadata-detail.json.gz').read_bytes()))['features']}
    selected_packs = set()
    for group in ref['groups']:
        require(sorted(fid for fid, m in core.items() if m.get('systemId') == group['system_id']) == group['geometry_fids'], 'Complete group FIDs from original metadata')
        selected_packs.update(logical[group['logical_fid']])
    receipts = read_json(root / 'selected-pack-receipts.json')
    require(selected_packs == {r['id'] for r in receipts}, 'Complete selected pack set')
    decoded = {}
    for receipt in receipts:
        spec = specs[receipt['id']]
        require(all(spec[k] == receipt[k] for k in spec), 'Index/pack receipt join')
        shard = (cache / ('shard-s%d.bin' % spec['shard'])).read_bytes()
        packed = shard[spec['offset']:spec['offset'] + spec['length']]
        require(len(packed) == spec['length'] and sha(packed) == receipt['sha256'], 'Selected pack bytes')
        data = gzip.decompress(packed)
        require(struct.unpack_from('<IH', data) == (0x46485741, 4), 'Binary pack format')
        count, p, found = struct.unpack_from('<I', data, 8)[0], 12, []
        for _ in range(count):
            fields = struct.unpack_from('<IIBBBBHHfiiiiII', data, p)
            fid, lid, category, stage, kind, flags, fragment, fragments, width = fields[:9]
            bounds, glen, wlen = list(fields[9:13]), fields[13], fields[14]
            p += 44
            require(p + glen + wlen <= len(data), 'Truncated pack feature')
            if fid in FIDS:
                require(fid not in decoded and category == 1, 'Duplicate or non-river selected FID')
                m = core[fid] | detail[fid]
                require((lid, stage, flags, fragment, fragments, bounds) == (m['logicalFid'], m['stage'], m['flags'], m['fragmentIndex'], m['fragmentCount'], m['bounds']), 'Binary descriptor/metadata join')
                require(width == struct.unpack('<f', struct.pack('<f', m['width']))[0], 'Descriptor width quantization')
                g = decode_line(data[p:p + glen], kind)
                check_width_profile(data[p + glen:p + glen + wlen], g)
                decoded[fid] = {'type': 'Feature', 'id': fid, 'properties': m, 'geometry': g}
                found.append(fid)
            p += glen + wlen
        require(p == len(data), 'Pack byte coverage')
        require(found == receipt['selected_fids'], 'Pack selected FID coverage/order')
    require(set(decoded) == set(FIDS), 'All nine selected fragments decoded')
    return [decoded[fid] for fid in FIDS]


def check_verdict(verdict):
    require(verdict['scope_system_ids'] == IDS, 'Review scope')
    require(verdict['automatic_application'] is False and verdict['scalar_product_name_approvals'] == 0 and verdict['whole_group_scalar_application_approved'] is False, 'Review application gate')
    require(verdict['current_live_deployment_checked'] is False and verdict['original_hydrorivers_coordinate_equality_verified'] is False, 'Unsupported verification claim')
    require([f['system_id'] for f in verdict['findings']] == IDS, 'Review finding scope')
    for finding in verdict['findings']:
        require(finding['name_ko'] is None and finding['whole_reach_name_application_cleared'] is False and finding['whole_group_scalar_application_approved'] is False and finding['formal_registry_verified'] is False, 'Unsupported naming clearance')
    require(verdict['findings'][0]['verdict'] == 'retain_provisional_representative_candidate', 'Nura provisional gate')
    require(verdict['findings'][1]['tributaries_inherit_representative_name'] is False, 'Flinders tributary gate')
    require(verdict['findings'][2]['exact_terminal_lake_membership_verified'] is False, 'Sarysu terminal gate')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--input-cache', type=Path)
    p.add_argument('--historical-input-root', type=Path)
    p.add_argument('--local-geometry', type=Path)
    p.add_argument('--local-source-index', type=Path)
    p.add_argument('--local-source-root', type=Path)
    args = p.parse_args()
    root, review = args.package, args.package / 'review'
    pins = read_json(review / 'frozen-input-pins.json')
    require(pins['scope_system_ids'] == IDS, 'Frozen scope')
    for entry in pins['package_inputs']:
        require(Path(entry['file']).name == entry['file'], 'Non-flat public input filename')
        checked(root / entry['file'], entry)
    manifest = json.loads(checked(root / 'geometry-component-manifest.json', {'sha256': GEOMETRY_MANIFEST_SHA256}))
    for name, digest in manifest['files'].items():
        checked(root / name, {'sha256': digest})
    ref = read_json(root / 'geometry-reference.json')
    require(ref['baseline']['git_commit'] == COMMIT and ref['baseline']['current_live_deployment_checked'] is False, 'Baseline scope')
    facts = read_json(root / 'selected-river-metadata.json')['fragments']
    require([r['fid'] for r in facts] == FIDS, 'Published fragment scope')
    verdict = read_json(review / 'independent-review.json')
    check_verdict(verdict)
    source_checks = 0
    require(bool(args.local_source_index) == bool(args.local_source_root), 'Source index and root must be supplied together')
    if args.local_source_index:
        local = {r['id']: r for r in read_json(args.local_source_index)}
        for entry in pins['local_evidence_assets']:
            path = Path(local[entry['id']]['local_file'])
            checked(path if path.is_absolute() else args.local_source_root / path, entry)
            source_checks += 1
    features = independent_decode(args.input_cache, root, ref) if args.input_cache else None
    independent_results = validate_local_features(features, facts, ref['groups']) if features else []
    if args.local_geometry:
        local_features = json.loads(checked(args.local_geometry, ref['non_distributed_decoded_feature_collection']))['features']
        validate_local_features(local_features, facts, ref['groups'])
        require(features is None or local_features == features, 'Independent binary/retained full geometry equality')
    cmd = [sys.executable, str(root / 'validate-geometry-reference.py'), '--directory', str(root)]
    if args.input_cache:
        cmd += ['--input-cache', str(args.input_cache)]
    if args.historical_input_root:
        cmd += ['--historical-input-root', str(args.historical_input_root)]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    geometry = json.loads(result.stdout)
    require(geometry['complete_coordinates_rechecked'] == bool(args.input_cache), 'Geometry validator mode reporting')
    require(geometry['production_decoder_replayed'] == bool(args.input_cache), 'Production decoder mode reporting')
    for name in ['nura-findings.json', 'flinders-findings.json', 'sarysu-findings.json']:
        require(read_json(root / name)['automatic_application'] is False, 'Source finding application gate')
    n, f, s = [read_json(root / (name + '-findings.json')) for name in ('nura', 'flinders', 'sarysu')]
    require(n['korean_name'] is None and f['verdict']['name_ko'] is None and s['verdict']['name_ko'] is None, 'Source finding Korean gate')
    require(n['scalar_product_name_approved'] is False and f['scalar_product_name_application_approved'] is False and s['clearance']['scalar_product_name_cleared'] is False, 'Source finding scalar gate')
    for path in review.iterdir():
        if path.is_file():
            require(path.suffix in ('.json', '.py', '.md'), 'Unexpected review file type')
    if (review / 'review-manifest.json').exists():
        for entry in read_json(review / 'review-manifest.json')['files']:
            require(Path(entry['file']).name == entry['file'], 'Non-flat review manifest path')
            checked(review / entry['file'], entry)
    full = all([args.input_cache, args.historical_input_root, args.local_geometry, args.local_source_index])
    any_local = any([args.input_cache, args.historical_input_root, args.local_geometry, args.local_source_index])
    print(json.dumps({'status': 'passed', 'mode': 'complete_local_inputs' if full else 'partial_local_inputs' if any_local else 'durable_only', 'scope_system_ids': IDS, 'frozen_package_inputs_checked': len(pins['package_inputs']), 'published_facts_hashes_and_name_gates_checked': True, 'unpublished_complete_coordinates_rechecked': bool(args.input_cache or args.local_geometry), 'independent_binary_decoder_replayed': bool(args.input_cache), 'independent_binary_decode': independent_results, 'production_decoder_replayed': bool(args.input_cache), 'selected_inventory_originals_rechecked': bool(args.historical_input_root), 'local_source_bodies_and_text_captures_rechecked': min(source_checks, 10), 'local_view_assets_rechecked': max(source_checks - 10, 0), 'durable_only_limitation': 'Without optional local inputs, unpublished complete coordinates, source bodies, text captures and map images are not rechecked. Hash metadata alone is not proof of renewed source inspection.', 'original_hydrorivers_coordinate_equality_verified': False, 'current_live_deployment_checked': False, 'network_requests': 0, 'automatic_application': False, 'scalar_product_name_approvals': 0}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
