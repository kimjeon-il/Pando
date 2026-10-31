import importlib.util
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from shapely.geometry import LineString, Point, shape, mapping
import shapely

spec = importlib.util.spec_from_file_location('supplement', Path(__file__).parents[1] / 'tools/supplement-lsib-boundaries.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SupplementTests(unittest.TestCase):
    def coastal_fixture(self):
        monaco = shapely.Polygon([(4, 0), (6, 0), (6, 4), (4, 4), (4, 0)])
        land = shapely.Polygon([(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)])
        island = shapely.box(20, 20, 21, 21)
        geometries = {'FRA': mapping(land.difference(monaco).difference(shapely.box(8, 8, 9, 9)).union(island)),
                      'MCO': mapping(monaco)}
        border = LineString([(4, -.0001), (4, 1), (5, 1.2), (6, 1), (6, -.0001)])
        coasts = {
            'monaco': LineString([(6, -.0001), (5, -.1), (4, -.0001)]),
            'west': LineString([(4, -.0001), (3, -.0001), (2, 0), (1, -.0001)]),
            'east': LineString([(6, -.0001), (7, -.0001), (8, 0), (9, -.0001)]),
        }
        return geometries, border, coasts

    def test_coastal_repair_uses_shared_border_and_only_reviewed_outer_arc(self):
        geometries, border, coasts = self.coastal_fixture()
        original = copy.deepcopy(geometries)
        updated, sections, review = module.repair_coastal_boundary(geometries, border, coasts)
        monaco, france = shape(updated['MCO']), shape(updated['FRA'])
        self.assertEqual(geometries, original)
        self.assertTrue(monaco.is_valid and france.is_valid)
        self.assertTrue(monaco.boundary.intersection(france.boundary).equals(border))
        self.assertEqual(monaco.intersection(france).area, 0)
        self.assertFalse(monaco.covers(shape(original['MCO']).representative_point()))
        self.assertTrue(monaco.boundary.covers(coasts['monaco']))
        self.assertEqual(review['outerAnchors'], [(2., 0.), (8., 0.)])
        self.assertEqual(len(sections), 4)
        self.assertTrue(france.intersection(shapely.box(19, 19, 22, 22)).equals(shapely.box(20, 20, 21, 21)))
        self.assertTrue(france.boundary.intersection(shapely.box(7.5, 7.5, 9.5, 9.5)).equals(shapely.box(8, 8, 9, 9).boundary))
        module.validate_coastal_repair(geometries, updated, review)
        bad = copy.deepcopy(updated)
        bad['FRA'] = mapping(france.union(shapely.box(30, 30, 31, 31)))
        with self.assertRaisesRegex(ValueError, 'reviewed coast|component'):
            module.validate_coastal_repair(geometries, bad, review)
        with self.assertRaisesRegex(ValueError, 'Land/coastline union changed'):
            module.apply_country_patches(geometries, {
                'MCO': [{'old': list(shape(geometries['MCO']).exterior.coords),
                         'replacement': list(monaco.exterior.coords)}]})

    def test_coastal_repair_rejects_missing_anchor_and_large_endpoint_move(self):
        geometries, border, coasts = self.coastal_fixture()
        original = copy.deepcopy(geometries)
        coasts['west'] = LineString([(4, -.0001), (3, -.0001), (1, -.0001)])
        with self.assertRaisesRegex(ValueError, 'anchor'):
            module.repair_coastal_boundary(geometries, border, coasts)
        self.assertEqual(geometries, original)
        geometries, border, coasts = self.coastal_fixture()
        border = LineString([(4, -.01), *list(border.coords)[1:]])
        with self.assertRaisesRegex(ValueError, 'endpoint'):
            module.repair_coastal_boundary(geometries, border, coasts)

    def test_coast_endpoint_snap_cannot_invent_an_outer_intersection(self):
        geometries, border, coasts = self.coastal_fixture()
        coasts['monaco'] = LineString([(6, -.0001), (5, -.1), (4, .0001)])
        coasts['west'] = LineString([(4, -.0001), (3, -.0001), (1, -.0001)])
        self.assertTrue(coasts['west'].intersection(shapely.union_all([shape(g) for g in geometries.values()]).boundary).is_empty)
        with self.assertRaisesRegex(ValueError, 'No safe outer coast anchor'):
            module.repair_coastal_boundary(geometries, border, coasts)

    def test_reviewed_coast_manifest_pins_features_level_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'tools/historical-library/sources/fixture'
            folder.mkdir(parents=True)
            source = folder / 'coast.json'
            _, _, coasts = self.coastal_fixture()
            features = [{'type': 'Feature', 'properties': {'cleabs': role, 'niveau': 'Plus hautes eaux'},
                         'geometry': mapping(line)} for role, line in coasts.items()]
            source.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}), encoding='utf-8')
            manifest = {'schemaVersion': 1, 'countries': ['FRA', 'MCO'],
                        'sourceId': 'ign-bdtopo-v3-monaco-coast', 'sourceCrs': 'EPSG:4326',
                        'sourceFile': source.relative_to(root).as_posix(), 'sourceFileSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'features': {role: role for role in coasts}}
            file = folder / 'manifest.json'
            file.write_text(json.dumps(manifest), encoding='utf-8')
            loaded, _ = module.reviewed_coast_reference(root, file)
            self.assertTrue(loaded['monaco'].equals(coasts['monaco']))
            features[0]['properties']['niveau'] = 'Plus basses eaux'
            source.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'pinned'):
                module.reviewed_coast_reference(root, file)
            manifest['sourceFileSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
            file.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'high-water'):
                module.reviewed_coast_reference(root, file)

    def test_coastal_candidate_preserves_current_identity_past_and_source_attribution(self):
        geometries, border, coasts = self.coastal_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'assets/data/territorial-entities/source'
            evidence = root / 'tools/historical-library/sources/lsib-11.4'
            for folder in (source / 'countries', source / 'views', evidence, root / 'config'):
                folder.mkdir(parents=True)
            originals, selections = {}, []
            for code, geometry in geometries.items():
                entity = {'entityId': f'state:{code}', 'sourceInfo': {'featureId': code},
                          'lifetime': {'validFrom': '1900-01-01', 'validTo': None}, 'parentEntityId': '', 'metadata': {'representativeGeometryVersionId': code},
                          'geometryVersions': [
                              {'versionId': code, 'validFrom': None, 'validTo': None, 'sourceId': 'natural-earth-5.1.1', 'geometry': geometry},
                              {'versionId': code + ':past', 'validFrom': '1900', 'validTo': '1910', 'geometry': geometry}]}
                if code == 'FRA':
                    entity['geometryVersions'][0]['modernBoundarySupplement'] = {
                        'boundaries': [{'countries': ['AND', 'FRA'], 'sourceId': module.SOURCE_ID}]}
                file = source / 'countries' / f'state-{code}.json'
                file.write_text(json.dumps(entity), encoding='utf-8')
                originals[code] = file.read_bytes()
                selections.append({'entityId': entity['entityId'], 'geometryVersionId': code})
            (source / 'views/world.json').write_text(json.dumps({'selections': selections}), encoding='utf-8')
            raw = gzip.compress(json.dumps({'features': [{'properties': {
                'CC1_GENC3': 'FRA', 'CC2_GENC3': 'MCO', 'RANK': '1', 'STATUS': 'International Boundary', 'ID': 'land'},
                'geometry': mapping(border)}]}).encode())
            (evidence / 'boundaries.geojson.gz').write_bytes(raw)
            (evidence / 'provenance.json').write_text(json.dumps({'published': '2025-02-24',
                'masterSha256': hashlib.sha256(raw).hexdigest()}), encoding='utf-8')
            (root / 'config/library-data.json').write_text(json.dumps({'revision': 'test-data-revision'}), encoding='utf-8')
            raw_coast = json.dumps({'features': [{'properties': {'cleabs': role, 'niveau': 'Plus hautes eaux'},
                'geometry': mapping(line)} for role, line in coasts.items()]}).encode()
            coast_path = evidence / 'coast.json'
            coast_path.write_bytes(raw_coast)
            manifest = {'schemaVersion': 1, 'countries': ['FRA', 'MCO'], 'sourceId': 'ign-bdtopo-v3-monaco-coast',
                'sourceCrs': 'EPSG:4326', 'sourceFile': coast_path.relative_to(root).as_posix(), 'sourceFileSha256': hashlib.sha256(raw_coast).hexdigest(),
                'features': {role: role for role in coasts}, 'title': 'Reviewed coast', 'published': None,
                'url': 'https://example.invalid/coast', 'license': 'Open Licence 2.0', 'licenseUrl': 'https://example.invalid/license',
                'attribution': 'IGN', 'retrieved': '2026-10-22', 'lastModified': '2024-09-23', 'confirmed': '2021-11-01'}
            file = evidence / 'coast-manifest.json'
            file.write_text(json.dumps(manifest), encoding='utf-8')
            output = root / 'candidate.json'
            with self.assertRaisesRegex(ValueError, 'pinned reviewed coast'):
                module.targeted_candidates(root, output, ['FRA/MCO'])
            module.targeted_candidates(root, output, ['FRA/MCO'], coast_manifest=file)
            candidate = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(len(candidate['changes']), 2)
            self.assertEqual(len(candidate['boundaries']), 4)
            for change in candidate['changes']:
                code = change['entityId'].split(':')[1]
                self.assertEqual(change['geometryVersionId'], code)
                self.assertIn('dos-lsib-11.4+ign-bdtopo-v3-monaco-coast', change['sourceId'])
                self.assertIsNone(change['sourceAttributions'][0]['published'])
                self.assertEqual(change['supplement']['coastline'], 'reviewed-ign-replacement')
                self.assertEqual((source / 'countries' / f'state-{code}.json').read_bytes(), originals[code])
                self.assertEqual(change['inputFileSha256'], hashlib.sha256(originals[code]).hexdigest())
            france = next(c for c in candidate['changes'] if c['entityId'] == 'state:FRA')
            self.assertEqual(france['supplement']['boundaries'][0]['countries'], ['AND', 'FRA'])
            entity = json.loads(originals['MCO'])
            entity['geometryVersions'][0]['validTo'] = '1910-01-01'
            (source / 'countries/state-MCO.json').write_text(json.dumps(entity), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Historical'):
                module.targeted_candidates(root, output, ['FRA/MCO'], coast_manifest=file)

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
                    'lifetime': {'validFrom': '1900-01-01', 'validTo': None}, 'parentEntityId': None, 'metadata': {'representativeGeometryVersionId': version_id},
                    'geometryVersions': [{'versionId': version_id, 'validFrom': None, 'validTo': None, 'geometry': geometry, 'sourceId': 'natural-earth-5.1.1'},
                        {'versionId': f'state:{code}:past', 'validFrom': '1900-01-01', 'validTo': '1910-01-01', 'geometry': geometry}]}
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
            entity = json.loads(originals['AND'])
            entity['geometryVersions'][0]['validTo'] = '1910-01-01'
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

    def test_replacement_batch_connects_native_results_and_withholds_missing_anchors(self):
        old = LineString([(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)])
        reference = LineString([(0, .2), (1, 0), (2, .2), (3, 0), (4, .2)])
        rows = module.replacement_chains(old, [reference, LineString([(0, .1), (4, .1)])])
        self.assertEqual(len(rows), 1)
        result = rows[0]
        self.assertEqual(result['coordinates'][0], [0., 0.])
        self.assertEqual(result['coordinates'][-1], [4., 0.])
        self.assertIn([2., .2], result['coordinates'])
        self.assertAlmostEqual(result['retained_length_degrees'], 2.)
        for anchor in result['anchors']:
            nearby = [p for p in result['coordinates'] if Point(p).distance(Point(anchor)) < 1e-12]
            self.assertEqual(nearby, [anchor])
        with patch.dict(os.environ, {'PANDO_TERRITORIAL_RECIPE_BINARY': str(Path('missing-lsib-native').resolve())}):
            with self.assertRaisesRegex(RuntimeError, 'replacement failed'):
                module.replacement_chains(old, [reference])

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
        with self.assertRaisesRegex(ValueError, 'owning ring|endpoints'):
            module.replace_chain(a, [(9, 9), (10, 10)], [(9, 9), (10, 11)])
        with patch.dict(os.environ, {'PANDO_TERRITORIAL_RECIPE_BINARY': str(Path('missing-lsib-native').resolve())}):
            with self.assertRaisesRegex(RuntimeError, 'ring replacement failed'):
                module.replace_chain(a, old, new)
            with self.assertRaisesRegex(RuntimeError, 'country validation failed'):
                module.validate_country_repair({'A': a, 'B': b}, {'A': aa, 'B': bb})
            with self.assertRaisesRegex(RuntimeError, 'shared-chain extraction failed'):
                module.extract_shared_chains({'A': a, 'B': b})


if __name__ == '__main__':
    unittest.main()
