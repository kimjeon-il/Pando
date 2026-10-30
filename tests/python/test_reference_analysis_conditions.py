"""Photometric training changes must preserve supervised original geometry."""
import pathlib
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from macro import derive
import pymupdf


class ConditionTrainingTests(unittest.TestCase):
    def test_sparse_printed_strokes_do_not_invent_whole_map_negatives(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'fixture.pdf'
            with pymupdf.open() as document:
                page = document.new_page(width=160, height=100)
                page.draw_line((70, 20), (70, 80), color=(0, 0, 0), width=2)
                document.save(path)
            metadata = dict(geographicScope='country', scopeEvidence='fixture only',
                            materialKind='published-macro-pdf', rightsReviewed=True,
                            license='software fixture only', supervision=dict(strategy='boundary-stroke-signatures',
                                knownBandRadiusPixels=4, channels=dict(international=[dict(color=[0, 0, 0], width=2, dashes=[])])))
            _, target, valid, _ = derive(path, metadata, 160)
            self.assertGreater(np.count_nonzero(target), 50)
            self.assertTrue((valid[target != 0] == 1).all())
            self.assertFalse(valid[:, :60].any())
            self.assertFalse(valid[:, 80:].any())
            self.assertTrue(valid[50, 66])
            metadata['supervision']['knownBandRadiusPixels'] = 99
            with self.assertRaisesRegex(ValueError, 'band'):
                derive(path, metadata, 160)

if __name__ == '__main__':
    unittest.main()
