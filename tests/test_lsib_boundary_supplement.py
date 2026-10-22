import importlib.util
import copy
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from shapely.geometry import LineString, Point, shape, mapping
import shapely

spec = importlib.util.spec_from_file_location('supplement', Path(__file__).parents[1] / 'tools/supplement-lsib-boundaries.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
screen_spec = importlib.util.spec_from_file_location('screen', Path(__file__).parents[1] / 'tools/verify-lsib-screen-delta.py')
screen = importlib.util.module_from_spec(screen_spec)
screen_spec.loader.exec_module(screen)


class SupplementTests(unittest.TestCase):
    def test_closed_screen_section_uses_complete_enclave_ring(self):
        geometry = {'type': 'Polygon', 'coordinates': [[(1, 1), (2, 1), (2, 2), (1, 2), (1, 1)]]}
        reference = LineString([(2, 2), (2, 1), (1, 1), (1, 2), (2, 2)])
        display = screen.display_section(geometry, [], reference)
        self.assertTrue(display.equals(reference))
        self.assertTrue(display.is_ring)
        with self.assertRaisesRegex(ValueError, 'enclave exterior'):
            screen.display_section(self.enclave_fixture()['ITA'], [], reference)

    def enclave_fixture(self):
        first = [(1, 1), (2, 1), (2, 2), (1, 2), (1, 1)]
        second = [(4, 4), (5, 4), (5, 5), (4, 5), (4, 4)]
        host = {'type': 'Polygon', 'coordinates': [
            [(0, 0), (8, 0), (8, 8), (0, 8), (0, 0)],
            list(reversed(first)), list(reversed(second)),
        ]}
        return {'ITA': host, 'SMR': {'type': 'Polygon', 'coordinates': [first]},
                'VAT': {'type': 'Polygon', 'coordinates': [second]}}

    def test_closed_ring_matches_cyclic_start_and_opposite_winding(self):
        geometries = self.enclave_fixture()
        old = [(2, 2), (2, 1), (1, 1), (1, 2), (2, 2)]
        new = [(1, 1), (2.2, 1), (2.2, 2), (1, 2), (1, 1)]
        for code in ('ITA', 'SMR'):
            before = geometries[code]
            after = module.replace_chain(before, old, new)
            self.assertTrue(shape(after).is_valid)
            self.assertEqual(len(after['coordinates']), len(before['coordinates']))
            self.assertEqual(before, geometries[code])
            self.assertTrue(any(LineString(ring).equals(LineString(new)) for ring in after['coordinates']))

    def test_two_enclaves_accumulate_in_one_host_without_losing_other_holes(self):
        geometries = self.enclave_fixture()
        original = copy.deepcopy(geometries)
        reference = LineString([(1, 1), (2.2, 1), (2.2, 2), (1, 2), (1, 1)])
        first, _ = module.repair_enclave_boundary(
            {code: geometries[code] for code in ('ITA', 'SMR')}, reference, ('ITA', 'SMR'), 'SMR')
        precise = LineString([(4, 4), (5, 4), (5.0001, 4.0001), (5.1, 5), (4, 5), (4, 4)])
        second, sections = module.repair_enclave_boundary(
            {'ITA': first['ITA'], 'VAT': geometries['VAT']}, precise, ('ITA', 'VAT'), 'VAT', simplify=False)
        final = {**first, **second}
        self.assertEqual(geometries, original)
        self.assertTrue(shapely.union_all([shape(g) for g in original.values()]).equals(
            shapely.union_all([shape(g) for g in final.values()])))
        self.assertEqual(len(shape(final['ITA']).interiors), 2)
        for code, line in [('SMR', reference), ('VAT', precise)]:
            self.assertEqual(shape(final['ITA']).intersection(shape(final[code])).area, 0)
            self.assertTrue(shape(final['ITA']).boundary.intersection(shape(final[code]).boundary).equals(line))
        self.assertEqual(len(shape(final['VAT']).exterior.coords), len(precise.coords))
        self.assertTrue(sections[0]['closedRing'])
        self.assertEqual(sections[0]['simplification_bound_px'], 0)

    def test_enclave_rejects_missing_host_hole_and_open_reference(self):
        geometries = self.enclave_fixture()
        pair = {code: geometries[code] for code in ('ITA', 'SMR')}
        reference = LineString([(1, 1), (2.2, 1), (2.2, 2), (1, 2), (1, 1)])
        with self.assertRaisesRegex(ValueError, 'closed ring'):
            module.repair_enclave_boundary(pair, LineString([(1, 1), (2, 1)]), ('ITA', 'SMR'), 'SMR')
        pair['ITA']['coordinates'].pop(1)
        before = copy.deepcopy(pair)
        with self.assertRaisesRegex(ValueError, 'complete shared exterior|host hole'):
            module.repair_enclave_boundary(pair, reference, ('ITA', 'SMR'), 'SMR')
        self.assertEqual(pair, before)

    def test_batch_candidate_emits_one_host_and_preserves_source_metadata_and_dates(self):
        geometries = self.enclave_fixture()
        tripoint, tripoint_refs = self.tripoint_fixture()
        rename = {'AUT': 'FRA', 'LIE': 'AND', 'CHE': 'ESP'}
        geometries.update({rename[code]: geometry for code, geometry in tripoint.items()})
        geometries.update({'LSO': geometries['SMR'], 'ZAF': geometries['ITA']})
        references = {tuple(sorted(rename[code] for code in pair)): line for pair, line in tripoint_refs.items()}
        references.update({
            ('ITA', 'SMR'): LineString([(1, 1), (2.2, 1), (2.2, 2), (1, 2), (1, 1)]),
            ('ITA', 'VAT'): LineString([(4, 4), (5.1, 4), (5.1, 5), (4, 5), (4, 4)]),
            ('LSO', 'ZAF'): LineString([(1, 1), (2.1, 1), (2.1, 2), (1, 2), (1, 1)]),
        })
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'assets/data/territorial-entities/source'
            evidence = root / 'tools/historical-library/sources/lsib-11.4'
            evidence.mkdir(parents=True)
            selections, originals = [], {}
            for code, geometry in geometries.items():
                version_id = f'state:{code}:current'
                entity = {'entityId': f'state:{code}', 'sourceInfo': {'featureId': code},
                    'lifetime': {'validFrom': '1900-01-01', 'validTo': None}, 'parentEntityId': None,
                    'geometryVersions': [{'versionId': version_id, 'datePrecision': 'current',
                        'validFrom': None, 'validTo': None, 'geometry': geometry, 'sourceId': 'natural-earth-5.1.1'},
                        {'versionId': f'state:{code}:past', 'datePrecision': 'day',
                         'validFrom': '1900-01-01', 'validTo': '1910-01-01', 'geometry': geometry}]}
                path = source / 'countries' / f'state-{code}.json'
                module.json_write(path, entity)
                originals[code] = path.read_bytes()
                selections.append({'entityId': entity['entityId'], 'geometryVersionId': version_id})
            module.json_write(source / 'views/world.json', {'selections': selections})
            records = [{'type': 'Feature', 'properties': {'CC1_GENC3': pair[0], 'CC2_GENC3': pair[1],
                'RANK': '1', 'STATUS': 'International Boundary', 'NOTES': '', 'ID': '/'.join(pair)},
                'geometry': mapping(line)} for pair, line in references.items()]
            raw = gzip.compress(json.dumps({'features': records}).encode())
            (evidence / 'boundaries.geojson.gz').write_bytes(raw)
            module.json_write(evidence / 'provenance.json', {'masterSha256': hashlib.sha256(raw).hexdigest(), 'published': '2025-02-24'})
            module.json_write(root / 'config/library-data.json', {'revision': 'fixture-revision'})
            output = root / 'candidate.json'
            module.targeted_candidates(root, output, ['AND/FRA', 'ITA/SMR', 'ITA/VAT', 'LSO/ZAF'])
            candidate = json.loads(output.read_text())
            changes = {change['entityId']: change for change in candidate['changes']}
            self.assertEqual(len(changes), 8)
            self.assertEqual(len(candidate['changes']), 8)
            self.assertEqual(candidate['sourceRevision'], 'fixture-revision')
            self.assertEqual(len(changes['state:ITA']['supplement']['reviewedBoundaryRepairs']), 2)
            self.assertEqual(changes['state:VAT']['supplement']['simplificationToleranceDegrees'], 0)
            self.assertEqual(changes['state:LSO']['supplement']['sourceId'], 'dos-lsib-11.4')
            self.assertFalse(changes['state:VAT']['supplement']['historicalAccuracyVerified'])
            for code, original in originals.items():
                self.assertEqual((source / 'countries' / f'state-{code}.json').read_bytes(), original)
                change = changes[f'state:{code}']
                self.assertEqual(change['inputFileSha256'], hashlib.sha256(original).hexdigest())
                self.assertEqual(change['geometryVersionId'], f'state:{code}:current')
                self.assertEqual(change['sourceId'], 'natural-earth-5.1.1+dos-lsib-11.4')
            official_file = Path('tools/historical-library/sources/igm-fixture.geojson')
            official_raw = json.dumps({'features': [{'properties': {'globalid': 'fixture-smr', 'comune_ist': 'san_mar_com'},
                'geometry': {'type': 'Polygon', 'coordinates': [[(1, 1), (2.3, 1), (2.3, 2), (1, 2), (1, 1)]]}}]}).encode()
            (root / official_file).write_bytes(official_raw)
            manifest_file = Path('tools/historical-library/sources/igm-fixture.json')
            manifest = {'schemaVersion': 1, 'countries': ['ITA', 'SMR'], 'sourceId': 'igm-dbsn-2025-06-27',
                'sourceCrs': 'EPSG:4258', 'sourceFile': official_file.as_posix(),
                'sourceFileSha256': hashlib.sha256(official_raw).hexdigest(), 'featureGlobalId': 'fixture-smr',
                'title': 'IGM DBSN fixture', 'published': '2025-06-27', 'url': 'https://example.invalid/igm',
                'license': 'ODbL-1.0', 'licenseUrl': 'https://opendatacommons.org/licenses/odbl/1-0/', 'attribution': 'IGM'}
            module.json_write(root / manifest_file, manifest)
            module.targeted_candidates(root, output, ['ITA/SMR'], manifest_file)
            official_candidate = json.loads(output.read_text())
            self.assertEqual(len(official_candidate['changes']), 2)
            official_change = next(c for c in official_candidate['changes'] if c['entityId'] == 'state:SMR')
            self.assertEqual(official_change['sourceId'], 'natural-earth-5.1.1+igm-dbsn-2025-06-27')
            self.assertEqual(official_change['sourceAttributions'][0]['license'], 'ODbL-1.0')
            self.assertEqual(official_change['supplement']['simplificationToleranceDegrees'], 0)
            self.assertTrue(shape(official_change['geometry']).equals(shape(json.loads(official_raw)['features'][0]['geometry'])))
            with self.assertRaisesRegex(ValueError, 'not explicitly selected'):
                module.targeted_candidates(root, output, ['AND/FRA'], manifest_file)
            (root / official_file).write_bytes(official_raw + b'changed')
            with self.assertRaisesRegex(ValueError, 'pinned evidence'):
                module.targeted_candidates(root, output, ['ITA/SMR'], manifest_file)
            versions = json.loads(originals['AND'])['geometryVersions']
            versions[0]['datePrecision'] = 'day'
            entity = json.loads(originals['AND'])
            entity['geometryVersions'] = versions
            module.json_write(source / 'countries/state-AND.json', entity)
            with self.assertRaisesRegex(ValueError, 'Historical'):
                module.targeted_candidates(root, output, ['AND/FRA'])
            (source / 'countries/state-AND.json').write_bytes(originals['AND'])
            (evidence / 'boundaries.geojson.gz').write_bytes(raw + b'changed')
            with self.assertRaisesRegex(ValueError, 'master differs'):
                module.targeted_candidates(root, output, ['AND/FRA'])

    def tripoint_fixture(self):
        def polygon(points):
            return {'type': 'Polygon', 'coordinates': [points]}
        geometries = {
            'AUT': polygon([(3, 0), (6, 0), (6, 6), (3, 6), (3, 4), (3, 2), (3, 0)]),
            'LIE': polygon([(2, 2), (3, 2), (3, 4), (2, 4), (2, 2)]),
            'CHE': polygon([(0, 0), (3, 0), (3, 2), (2, 2), (2, 4), (3, 4), (3, 6), (0, 6), (0, 0)]),
        }
        references = {
            ('AUT', 'LIE'): LineString([(3.2, 1.8), (3.3, 3), (3.2, 4.2)]),
            ('AUT', 'CHE'): shapely.MultiLineString([
                [(3, 0), (3, 1), (3.2, 1.8)], [(3.2, 4.2), (3, 5), (3, 6)],
            ]),
            ('CHE', 'LIE'): LineString([(3.2, 4.2), (2, 4), (2, 2), (3.2, 1.8)]),
        }
        return geometries, references

    def test_tripoint_replacement_moves_both_junctions_and_preserves_three_country_union(self):
        geometries, references = self.tripoint_fixture()
        original = copy.deepcopy(geometries)
        updated, sections = module.repair_tripoint_boundary(geometries, references, ('AUT', 'LIE'), 'CHE')
        self.assertEqual(geometries, original)
        self.assertEqual(set(updated), {'AUT', 'LIE', 'CHE'})
        before = shapely.union_all([shape(g) for g in geometries.values()])
        after = shapely.union_all([shape(g) for g in updated.values()])
        self.assertTrue(before.equals(after))
        for code, geometry in updated.items():
            self.assertTrue(shape(geometry).is_valid, code)
        for a, b in [('AUT', 'LIE'), ('AUT', 'CHE'), ('CHE', 'LIE')]:
            self.assertEqual(shape(updated[a]).intersection(shape(updated[b])).area, 0)
        shared = shape(updated['AUT']).boundary.intersection(shape(updated['LIE']).boundary)
        self.assertTrue(shared.equals(references[('AUT', 'LIE')]))
        for junction in [(3.2, 1.8), (3.2, 4.2)]:
            self.assertTrue(all(shape(g).boundary.covers(Point(junction)) for g in updated.values()))
        self.assertEqual(len(sections), 5)

    def test_tripoint_replacement_rejects_missing_outer_anchor_without_mutating_inputs(self):
        geometries, references = self.tripoint_fixture()
        original = copy.deepcopy(geometries)
        references[('AUT', 'CHE')] = shapely.MultiLineString([
            [(3.2, 0), (3.2, 1.8)], [(3.2, 4.2), (3.2, 6)],
        ])
        with self.assertRaisesRegex(ValueError, 'anchor'):
            module.repair_tripoint_boundary(geometries, references, ('AUT', 'LIE'), 'CHE')
        self.assertEqual(geometries, original)

    def test_tripoint_replacement_rejects_disconnected_reference_junction(self):
        geometries, references = self.tripoint_fixture()
        references[('CHE', 'LIE')] = LineString([(3.1, 4.2), (2, 4), (2, 2), (3.2, 1.8)])
        with self.assertRaisesRegex(ValueError, 'junction'):
            module.repair_tripoint_boundary(geometries, references, ('AUT', 'LIE'), 'CHE')

    def test_intersection_within_roundoff_of_vertex_does_not_insert_a_tiny_backtrack(self):
        polygon = {'type': 'Polygon', 'coordinates': [[
            (0, 0), (3, 0), (3, 1), (3, 2), (3, 4), (3, 5), (3, 6), (0, 6), (0, 0),
        ]]}
        anchor = (3., 5. + 5e-14)
        result = module.replace_chain(polygon, [anchor, (3, 4), (3, 2), (3, 1)],
                                      [anchor, (3.2, 4.2), (3.3, 3), (3.2, 1.8), (3, 1)])
        self.assertTrue(shape(result).is_valid)
        nearby = [tuple(p) for p in result['coordinates'][0][:-1] if Point(p).distance(Point(anchor)) < 1e-11]
        self.assertEqual(nearby, [anchor])

    def test_intersection_anchors_retain_old_endings_and_follow_detailed_middle(self):
        old = LineString([(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)])
        reference = LineString([(0, .2), (1, 0), (2, .2), (3, 0), (4, .2)])
        result = module.replacement_chain(old, reference)
        self.assertEqual(result['coordinates'][0], (0., 0.))
        self.assertEqual(result['coordinates'][-1], (4., 0.))
        self.assertIn((2., .2), result['coordinates'])
        self.assertAlmostEqual(result['retained_length_degrees'], 2.)

    def test_no_intersections_are_withheld_instead_of_inventing_connector(self):
        with self.assertRaisesRegex(ValueError, 'anchor'):
            module.replacement_chain(LineString([(0, 0), (2, 0)]), LineString([(0, .1), (2, .1)]))

    def test_interpolated_anchor_has_one_exact_coordinate_in_both_ring_directions(self):
        old = LineString([(.1, .2), (1.7, .8), (3.5, 1.4), (4.9, 2.3)])
        reference = LineString([(0, 1), (2, 0), (4, 3), (6, 0)])
        result = module.replacement_chain(old, reference)
        for anchor in result['anchors']:
            nearby = [p for p in result['coordinates'] if Point(p).distance(Point(anchor)) < 1e-12]
            self.assertEqual(nearby, [anchor])

    def test_paired_ring_replacement_preserves_union_and_shared_edge(self):
        a = {'type': 'Polygon', 'coordinates': [[(0, 0), (2, 0), (2, 1), (2, 2), (0, 2), (0, 0)]]}
        b = {'type': 'Polygon', 'coordinates': [[(2, 0), (4, 0), (4, 2), (2, 2), (2, 1), (2, 0)]]}
        old = [(2, 0), (2, 1), (2, 2)]
        new = [(2, 0), (2.1, 1), (2, 2)]
        aa = module.replace_chain(a, old, new)
        bb = module.replace_chain(b, old, new)
        self.assertTrue(shape(aa).is_valid and shape(bb).is_valid)
        self.assertTrue(shape(aa).union(shape(bb)).equals(shape(a).union(shape(b))))
        self.assertEqual(shape(aa).intersection(shape(bb)).area, 0)
        self.assertTrue(shape(aa).boundary.intersection(shape(bb).boundary).equals(LineString(new)))

    def test_special_lines_and_territorial_disagreement_are_never_eligible(self):
        ordinary = {'RANK': '1', 'STATUS': 'International Boundary', 'NOTES': ''}
        self.assertIsNone(module.exclusion_reason(ordinary, False))
        self.assertIsNotNone(module.exclusion_reason({**ordinary, 'RANK': '2'}, False))
        self.assertIsNotNone(module.exclusion_reason(ordinary, True))
        self.assertIsNotNone(module.exclusion_reason({**ordinary, 'NOTES': 'Uncertain alignment'}, False))


if __name__ == '__main__':
    unittest.main()
