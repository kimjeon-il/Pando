"""Photometric training changes must preserve supervised original geometry."""
import hashlib
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


class ConditionTrainingTests(unittest.TestCase):
    def test_deterministic_scan_conditions_preserve_masks_position_and_sampling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            y, x = np.mgrid[:128, :128]
            image = np.stack([x * 2, y * 2, (x + y) % 256], axis=-1).astype(np.uint8)
            Image.fromarray(image).save(root / 'map.png')
            annotation = dict(width=128, height=128, lines=[dict(kind='international', points=[[10, 20], [90, 110]], width=2)],
                              known={'international': [[[0, 0], [127, 0], [127, 127], [0, 127]]]})
            (root / 'label.json').write_text(json.dumps(annotation))
            sheets = [dict(id='fixture', image='map.png', sha256=hashlib.sha256((root / 'map.png').read_bytes()).hexdigest(), annotations='label.json')]
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
