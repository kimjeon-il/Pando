import copy
import importlib.util
import os
import json
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
from hydro_connectivity import audit_parts, repair_connections_native

spec = importlib.util.spec_from_file_location('hydro_test_builder', TOOLS / 'build-hydro-tiles.py')
builder = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = builder
spec.loader.exec_module(builder)


def fixture():
    parts = {
        1: [dict(fid=1, part=0, points=[[0, 0], [1, 0]], aligned=False, system='10')],
        2: [dict(fid=2, part=0, points=[[1.002, 0], [2, 0]], aligned=True, system='10')],
        3: [dict(fid=3, part=0, points=[[0, 1], [1, 0]], aligned=False, system='10')],
    }
    raw = {
        1: dict(region='eu', next=2, start=[0, 0], end=[1, 0]),
        2: dict(region='eu', next=0, start=[1, 0], end=[2, 0]),
        3: dict(region='eu', next=2, start=[0, 1], end=[1, 0]),
    }
    return parts, raw


class HydroConnectivityTests(unittest.TestCase):
    def test_audit_requires_native_engine_and_rejects_invalid_results(self):
        parts, raw = fixture()
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'PANDO_HYDRO_CONNECTIVITY_BINARY'):
                audit_parts(parts, raw)
        with patch('hydro_connectivity.run_native', return_value={'regions': {name: {} for name in ('eu','as','si','af','sa','na','ar','au','gr')},
                                                                  'issues': [{'source': 999}]}):
            with self.assertRaisesRegex(ValueError, 'issue'):
                audit_parts(parts, raw)

    @unittest.skipUnless(os.environ.get('PANDO_HYDRO_CONNECTIVITY_BINARY'), 'C++ native Hydro binary required')
    def test_native_audit_matches_source_oracle(self):
        oracle = json.loads((TOOLS.parent / 'tests/fixtures/hydro-connectivity-audit-oracle.json').read_text(encoding='utf-8'))
        for scenario in ('baseline', 'original-mismatch', 'border-conflict', 'long-gap', 'system-mismatch',
                         'split-reach', 'missing-downstream', 'connected', 'ambiguous'):
            with self.subTest(scenario=scenario):
                parts, raw = fixture()
                if scenario == 'original-mismatch': raw[1]['end'] = [0.9, 0]
                if scenario == 'border-conflict': parts[1][0]['aligned'] = True
                if scenario == 'long-gap': parts[2][0]['points'][0] = [1.5, 0]
                if scenario == 'system-mismatch': parts[3][0]['system'] = 'other'
                if scenario == 'split-reach':
                    parts[2] = [dict(fid=2, part=1, points=[[1.5, 0], [2, 0]], aligned=True, system='10'),
                                dict(fid=2, part=0, points=[[1.002, 0], [1.5, 0]], aligned=True, system='10')]
                if scenario == 'missing-downstream': raw[1]['next'] = 999
                if scenario == 'connected': parts[2][0]['points'][0] = [1, 0]
                if scenario == 'ambiguous':
                    parts[2].append(dict(fid=2, part=1, points=[[3, 0], [4, 0]], aligned=False, system='10'))
                expected = copy.deepcopy(oracle[scenario])
                payload = dict(mode='audit', parts=parts, raw=raw, sourceOrder=list(raw))
                completed = subprocess.run([os.environ['PANDO_HYDRO_CONNECTIVITY_BINARY']], input=json.dumps(payload),
                                           text=True, capture_output=True, check=True, timeout=30)
                actual = json.loads(completed.stdout)
                self.assertEqual(actual['regions'], expected['regions'])
                self.assertEqual(len(actual['issues']), len(expected['issues']))
                for a, e in zip(actual['issues'], expected['issues']):
                    for field in ('gapM', 'originalGapM'):
                        if field in e: self.assertAlmostEqual(a.pop(field), e.pop(field), places=6)
                    self.assertEqual(a, e)

    def test_multiple_tributaries_share_aligned_downstream_port(self):
        parts, raw = fixture()
        original = copy.deepcopy(raw)
        self.assertEqual(len(audit_parts(parts, raw)['issues']), 2)
        self.assertEqual(len(repair_connections_native(parts, raw, 'eu')), 2)
        self.assertEqual(parts[1][0]['points'][-1], parts[2][0]['points'][0])
        self.assertEqual(parts[3][0]['points'][-1], parts[2][0]['points'][0])
        self.assertEqual(audit_parts(parts, raw)['issues'], [])
        self.assertEqual(raw, original)
        self.assertEqual(repair_connections_native(parts, raw, 'eu'), [])

    def test_upstream_border_anchor_moves_all_other_junction_ports(self):
        parts, raw = fixture()
        parts[1][0]['aligned'] = True
        parts[2][0]['aligned'] = False
        repair_connections_native(parts, raw, 'eu')
        self.assertEqual(parts[2][0]['points'][0], [1, 0])
        self.assertEqual(audit_parts(parts, raw)['issues'], [])

    def test_unrelated_nearby_river_and_natural_terminal_are_unchanged(self):
        parts, raw = fixture()
        raw[1]['next'] = 0
        before = copy.deepcopy(parts[1])
        repair_connections_native(parts, raw, 'eu')
        self.assertEqual(parts[1], before)
        self.assertEqual(parts[2][0]['points'][-1], [2, 0])

    def test_conflicting_border_original_mismatch_and_overlong_gap_are_rejected(self):
        for mode in ('borders', 'original', 'distance', 'system'):
            with self.subTest(mode=mode):
                parts, raw = fixture()
                if mode == 'borders':
                    parts[1][0]['aligned'] = True
                elif mode == 'original':
                    raw[1]['end'] = [0.9, 0]
                elif mode == 'distance':
                    parts[2][0]['points'][0] = [1.5, 0]
                else:
                    parts[3][0]['system'] = 'other'
                before = copy.deepcopy(parts)
                self.assertEqual(repair_connections_native(parts, raw, 'eu'), [])
                self.assertEqual(parts, before)

    def test_order_independence_and_region_gate(self):
        parts, raw = fixture()
        reversed_parts = dict(reversed(list(copy.deepcopy(parts).items())))
        self.assertEqual(repair_connections_native(parts, raw, 'as'), [])
        repair_connections_native(parts, raw, 'eu')
        repair_connections_native(reversed_parts, dict(reversed(list(raw.items()))), 'eu')
        self.assertEqual(parts, reversed_parts)

    def test_split_reach_retains_unique_entry_and_exit(self):
        parts, raw = fixture()
        parts[2] = [
            dict(fid=2, part=1, points=[[1.5, 0], [2, 0]], aligned=True, system='10'),
            dict(fid=2, part=0, points=[[1.002, 0], [1.5, 0]], aligned=True, system='10'),
        ]
        repair_connections_native(parts, raw, 'eu')
        self.assertEqual(parts[1][0]['points'][-1], [1.002, 0])
        self.assertEqual(parts[2][0]['points'][0], [1.5, 0])
        self.assertEqual(audit_parts(parts, raw)['issues'], [])

    def test_collapsed_single_reach_has_unambiguous_ports(self):
        parts, raw = fixture()
        parts[2][0]['points'] = [[1, 0], [1, 0]]
        self.assertEqual(audit_parts(parts, raw)['issues'], [])

    def test_sub_meter_border_quantization_uses_one_coordinate(self):
        parts, raw = fixture()
        parts[1][0]['aligned'] = True
        parts[2][0]['points'][0] = [1.000001, 0]
        repair_connections_native(parts, raw, 'eu')
        self.assertEqual(audit_parts(parts, raw)['issues'], [])

    @unittest.skipUnless(os.environ.get('PANDO_HYDRO_CONNECTIVITY_BINARY'), 'C++ native Hydro binary required')
    def test_native_correction_matches_the_existing_python_source_oracle(self):
        oracle = json.loads((TOOLS.parent / 'tests/fixtures/hydro-connectivity-repair-oracle.json').read_text(encoding='utf-8'))
        scenarios = ['baseline', 'original-mismatch', 'border-conflict', 'long-gap',
                     'system-mismatch', 'split-reach', 'region-gate', 'microdegree',
                     'upstream-aligned', 'natural-terminal']
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                parts, raw = fixture()
                region = 'eu'
                if scenario == 'original-mismatch':
                    raw[1]['end'] = [0.9, 0]
                if scenario == 'border-conflict':
                    parts[1][0]['aligned'] = True
                if scenario == 'long-gap':
                    parts[2][0]['points'][0] = [1.5, 0]
                if scenario == 'system-mismatch':
                    parts[3][0]['system'] = 'other'
                if scenario == 'split-reach':
                    parts[2] = [
                        dict(fid=2, part=1, points=[[1.5, 0], [2, 0]], aligned=True, system='10'),
                        dict(fid=2, part=0, points=[[1.002, 0], [1.5, 0]], aligned=True, system='10'),
                    ]
                if scenario == 'region-gate':
                    region = 'as'
                if scenario == 'microdegree':
                    parts[2][0]['points'][0] = [1.000001, 0]
                if scenario == 'upstream-aligned':
                    parts[1][0]['aligned'] = True
                    parts[2][0]['aligned'] = False
                if scenario == 'natural-terminal':
                    raw[1]['next'] = 0
                reference = {int(key): value for key, value in oracle[scenario]['parts'].items()}
                expected_changes, raw_before = oracle[scenario]['changes'], copy.deepcopy(raw)
                actual_changes = repair_connections_native(parts, raw, region)
                self.assertEqual(parts, reference)
                self.assertEqual(actual_changes, expected_changes)
                self.assertEqual(raw, raw_before)
                self.assertEqual(repair_connections_native(parts, raw, region), [])

    @unittest.skipUnless(os.environ.get('PANDO_HYDRO_CONNECTIVITY_BINARY'), 'C++ native Hydro binary required')
    def test_fresh_generator_uses_the_same_connector(self):
        parts, raw = fixture()
        def reach(source):
            return builder.RiverReach(source, raw[source]['next'], 10, 0, 5, 100, 1000, 1, 1,
                                      [copy.deepcopy(parts[source][0]['points'])],
                                      border_pair=('A', 'B') if source == 2 else None)
        chains = [[reach(1)], [reach(2)], [reach(3)]]
        report = builder.normalize_network_connections(chains, raw, 'eu')
        self.assertEqual(report['changedPorts'], 2)
        self.assertEqual(report['remaining'], [])
        self.assertEqual(chains[0][0].parts[0][-1], chains[1][0].parts[0][0])


if __name__ == '__main__':
    unittest.main()
