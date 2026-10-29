"""Photometric training changes must preserve supervised original geometry."""
import json
import pathlib
import sys
import tempfile
import unittest

import numpy as np
import torch
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from train import MapTiles
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

    def test_deterministic_scan_conditions_preserve_masks_position_and_sampling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            y, x = np.mgrid[:128, :128]
            image = np.stack([x * 2, y * 2, (x + y) % 256], axis=-1).astype(np.uint8)
            Image.fromarray(image).save(root / 'map.png')
            annotation = dict(width=128, height=128, lines=[dict(kind='international', points=[[10, 20], [90, 110]], width=2)],
                              known={'international': [[[0, 0], [127, 0], [127, 127], [0, 127]]]})
            (root / 'label.json').write_text(json.dumps(annotation))
            sheets = [dict(id='fixture', image='map.png', annotations='label.json')]
            plain = MapTiles(root, sheets)
            varied = MapTiles(root, sheets, augment_conditions=True)
            original, first = plain[0], varied[0]
            repeated = varied[0]
            self.assertEqual(plain.tiles, varied.tiles)
            self.assertTrue(torch.equal(first[0], repeated[0]))
            self.assertTrue(torch.equal(first[1], repeated[1]))
            self.assertFalse(torch.equal(original[0], first[0]))
            for index in [2, 3, 4]:
                self.assertTrue(torch.equal(original[index], first[index]))
            varied.epoch = 1
            self.assertFalse(torch.equal(first[0], varied[0][0]))
            for index in [0, 1]:
                self.assertTrue(torch.isfinite(varied[0][index]).all())


if __name__ == '__main__':
    unittest.main()
