#!/usr/bin/env python3
"""Bounded corrupt fixtures for this three-system review; no network or product writes."""
import argparse
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--local-geometry', type=Path)
    args = p.parse_args()
    root = args.package
    spec = importlib.util.spec_from_file_location('independent_review', root / 'review/validate-independent-review.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    verdict = m.read_json(root / 'review/independent-review.json')
    m.check_verdict(verdict)
    result = subprocess.run([sys.executable, str(root / 'review/validate-independent-review.py'), '--package', str(root)], check=True, capture_output=True, text=True)
    baseline = json.loads(result.stdout)
    m.require(baseline['mode'] == 'durable_only' and baseline['unpublished_complete_coordinates_rechecked'] is False and baseline['local_source_bodies_and_text_captures_rechecked'] == 0 and baseline['production_decoder_replayed'] is False, 'Durable-only truthful reporting')
    passed = []
    def reject(label, action):
        try:
            action()
        except (ValueError, IndexError, KeyError):
            passed.append(label)
        else:
            raise AssertionError('Corruption was accepted: ' + label)
    for label, mutate in [
        ('scalar_application_enabled', lambda x: x.update(automatic_application=True)),
        ('unsupported_korean_name', lambda x: x['findings'][0].update(name_ko='unsupported')),
        ('whole_reach_clearance', lambda x: x['findings'][1].update(whole_reach_name_application_cleared=True)),
        ('whole_group_scalar_clearance', lambda x: x['findings'][2].update(whole_group_scalar_application_approved=True)),
    ]:
        corrupt = copy.deepcopy(verdict)
        mutate(corrupt)
        reject(label, lambda c=corrupt: m.check_verdict(c))
    with tempfile.TemporaryDirectory() as d:
        original = root / 'nura-source-evidence.json'
        corrupt = Path(d) / original.name
        corrupt.write_bytes(original.read_bytes() + b' ')
        pin = next(r for r in m.read_json(root / 'review/frozen-input-pins.json')['package_inputs'] if r['file'] == original.name)
        reject('frozen_source_metadata_byte_change', lambda: m.checked(corrupt, pin))
    if args.local_geometry:
        features = m.read_json(args.local_geometry)['features']
        facts = m.read_json(root / 'selected-river-metadata.json')['fragments']
        groups = m.read_json(root / 'geometry-reference.json')['groups']
        m.validate_local_features(features, facts, groups)
        mutations = [
            ('missing_last_fragment', lambda f: f.pop()),
            ('dropped_line_part', lambda f: f[0]['geometry']['coordinates'].pop()),
            ('reversed_part_order', lambda f: f[0]['geometry']['coordinates'].reverse()),
            ('interior_coordinate_change', lambda f: f[0]['geometry']['coordinates'][0][2].__setitem__(0, f[0]['geometry']['coordinates'][0][2][0] + 0.000001)),
            ('source_id_order_change', lambda f: f[0]['properties'].update(sourceId=','.join(reversed(f[0]['properties']['sourceId'].split(','))))),
        ]
        for label, mutate in mutations:
            corrupt = copy.deepcopy(features)
            mutate(corrupt)
            reject(label, lambda c=corrupt: m.validate_local_features(c, facts, groups))
    print(json.dumps({'status': 'passed', 'scope_system_ids': m.IDS, 'durable_only_truthful_flags_passed': True, 'corrupt_fixtures_rejected': len(passed), 'fixtures': passed, 'local_geometry_fixtures_run': bool(args.local_geometry), 'network_requests': 0, 'original_inputs_modified': False}, indent=2))


if __name__ == '__main__':
    main()
