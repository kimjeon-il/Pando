import importlib.util
from pathlib import Path
import unittest
from shapely.geometry import LineString, Point, shape

spec = importlib.util.spec_from_file_location('supplement', Path(__file__).parents[1] / 'tools/supplement-lsib-boundaries.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SupplementTests(unittest.TestCase):
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
