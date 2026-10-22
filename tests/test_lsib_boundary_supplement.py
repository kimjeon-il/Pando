import importlib.util
import copy
from pathlib import Path
import unittest
from shapely.geometry import LineString, Point, shape
import shapely

spec = importlib.util.spec_from_file_location('supplement', Path(__file__).parents[1] / 'tools/supplement-lsib-boundaries.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SupplementTests(unittest.TestCase):
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
