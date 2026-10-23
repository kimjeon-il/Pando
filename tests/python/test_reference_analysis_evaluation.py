import pathlib
import sys
import unittest
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from evaluation import boundary_counts


class EvaluationTests(unittest.TestCase):
    def test_original_pixel_euclidean_tolerance_and_ignored_regions(self):
        annotation = dict(width=20, height=20, lines=[dict(kind='international', width=1, points=[[3, 5], [16, 5]])], ignore=[])
        prediction = np.zeros((3, 20, 20), dtype=bool)
        prediction[0, 7, 3:17] = True
        counts = boundary_counts(prediction, annotation)
        self.assertEqual(counts[0].tolist(), [14, 14, 14, 14])
        prediction[:] = False
        prediction[0, 8, 3:17] = True
        self.assertEqual(boundary_counts(prediction, annotation)[0].tolist(), [0, 14, 0, 14])
        annotation['ignore'] = [[[0, 7], [19, 7], [19, 19], [0, 19]]]
        self.assertEqual(boundary_counts(prediction, annotation)[0].tolist(), [0, 0, 0, 14])

    def test_tolerance_uses_half_original_stroke_width_when_larger_than_two(self):
        annotation = dict(width=20, height=20, lines=[dict(kind='coast', width=8, points=[[3, 5], [16, 5]])], ignore=[])
        prediction = np.zeros((3, 20, 20), dtype=bool)
        prediction[2, 9, 3:17] = True
        self.assertEqual(boundary_counts(prediction, annotation)[2].tolist(), [14, 14, 14, 14])


if __name__ == '__main__':
    unittest.main()
