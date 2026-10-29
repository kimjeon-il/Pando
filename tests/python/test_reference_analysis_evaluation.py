import pathlib
import sys
import unittest
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from evaluation import boundary_counts, metrics
import evaluation


class EvaluationTests(unittest.TestCase):
    def known(self, annotation):
        width, height = annotation['width'], annotation['height']
        annotation['known'] = {kind: [[[0, 0], [width-1, 0], [width-1, height-1], [0, height-1]]]
                               for kind in ['international', 'administrative', 'coast']}
        return annotation

    def test_original_pixel_euclidean_tolerance_and_ignored_regions(self):
        annotation = self.known(dict(width=20, height=20, lines=[dict(kind='international', width=1, points=[[3, 5], [16, 5]])], ignore=[]))
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
        annotation = self.known(dict(width=20, height=20, lines=[dict(kind='coast', width=8, points=[[3, 5], [16, 5]])], ignore=[]))
        prediction = np.zeros((3, 20, 20), dtype=bool)
        prediction[2, 9, 3:17] = True
        self.assertEqual(boundary_counts(prediction, annotation)[2].tolist(), [14, 14, 14, 14])

    def test_admission_uses_map_macro_and_per_map_floor_not_pooled_pixels(self):
        strong = metrics(np.array([[99, 100, 90, 100], [0, 0, 0, 0], [0, 0, 0, 0]]))
        weak = metrics(np.array([[80, 100, 90, 100], [0, 0, 0, 0], [0, 0, 0, 0]]))
        admitted = evaluation.boundary_admission({'one': strong, 'two': strong})
        self.assertTrue(admitted['passed'])
        self.assertIsNone(admitted['macro']['coast']['precision'])
        self.assertFalse(evaluation.boundary_admission({'one': strong, 'two': weak})['passed'])
        empty = metrics(np.zeros((3, 4), dtype=np.int64))
        self.assertFalse(evaluation.boundary_admission({'empty': empty})['passed'])

    def test_confounders_exclude_actual_overlapping_boundaries_and_keep_unknown_pixels_out(self):
        annotation=self.known(dict(width=20,height=20,lines=[dict(kind='international',width=1,points=[[3,5],[16,5]])],ignore=[]))
        annotation['known']['text']=[[[0,0],[19,0],[19,19],[0,19]]]
        annotation['regions']=[dict(kind='text',polygon=[[3,3],[16,3],[16,12],[3,12]])]
        prediction=np.zeros((3,20,20),dtype=bool);prediction[0,5,3:17]=True
        good=evaluation.confounder_counts(prediction,annotation)
        self.assertEqual(good['text']['international']['falsePositive'],0)
        prediction[0,11,3:17]=True
        bad=evaluation.confounder_counts(prediction,annotation)
        self.assertEqual(bad['text']['international']['falsePositive'],14)
        self.assertFalse(evaluation.confounder_nonregression({'map':bad},{'map':good})['passed'])
        self.assertTrue(evaluation.confounder_nonregression({'map':good},{'map':bad})['passed'])
        self.assertFalse(evaluation.confounder_nonregression({'map':good},None)['passed'])

    def test_confounder_comparison_rejects_changed_scopes_and_empty_evidence(self):
        value={'text':{'international':dict(falsePositive=0,pixels=0,rate=None)}}
        self.assertFalse(evaluation.confounder_nonregression({'map':value},{'map':value})['passed'])
        candidate={'text':{'international':dict(falsePositive=0,pixels=10,rate=0.)}}
        self.assertFalse(evaluation.confounder_nonregression({'map':candidate},{'map':value})['passed'])


if __name__ == '__main__':
    unittest.main()
