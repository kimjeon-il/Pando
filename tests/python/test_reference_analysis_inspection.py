"""Inspection consumes real dataset masks, including partial review and alpha."""
import hashlib
import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import torch
from PIL import Image

TOOLS = pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'
sys.path.insert(0, str(TOOLS))
from corpus import corpus_fingerprint
spec = importlib.util.spec_from_file_location('reference_inspection', TOOLS / 'inspect-checkpoint.py')
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)


class InspectionTests(unittest.TestCase):
    def fixture(self, root):
        image = root / 'source.png'
        Image.new('RGBA', (1024, 512), (0, 0, 0, 0)).save(image)
        annotation = dict(schemaVersion=1, reviewed=True, width=1024, height=512,
            review=dict(kind='agent', reviewer='fixture', sourceSha256=hashlib.sha256(image.read_bytes()).hexdigest(),
                        predictionBlind=True, coverage='partial', reviewedAt='2026-10-29T00:00:00Z'),
            known={'coast': [[[90, 190], [140, 190], [140, 210], [90, 210]],
                             [[690, 190], [740, 190], [740, 210], [690, 210]]],
                   'text': [[[100, 100], [120, 100], [120, 110], [100, 110]]]},
            lines=[dict(kind='coast', points=[[100, 200], [130, 200]], width=3),
                   dict(kind='coast', points=[[700, 200], [730, 200]], width=3)],
            regions=[dict(kind='text', polygon=[[100, 100], [120, 100], [120, 110], [100, 110]])],
            ignore=[[[89, 189], [141, 189], [141, 211], [89, 211]]])
        (root / 'labels.json').write_text(json.dumps(annotation), encoding='utf-8')
        sheet = dict(id='fixture', familyId='fixture-family', editionId='fixture-edition', duplicateGroup='fixture',
            split='train', image='source.png', sha256=annotation['review']['sourceSha256'], annotations='labels.json',
            language='eng', script='Latin', mapKind='monochrome', source=dict(url='https://example.test/source', license='test fixture only'))
        corpus = root / 'corpus.json'
        corpus.write_text(json.dumps(dict(schemaVersion=1, trainingOnly=True, sheets=[sheet])), encoding='utf-8')
        checkpoint = root / 'checkpoint.pt'
        checkpoint.write_bytes(b'checkpoint-fixture')
        onnx = root / 'model.onnx'
        onnx.write_bytes(b'onnx-interface-fixture')
        args = types.SimpleNamespace(corpus=str(corpus), checkpoint=str(checkpoint), onnx=str(onnx),
            output=str(root / 'diagnostics'), baseline_checkpoint=None, auxiliary_corpus=None, view_corpus='primary', maximum_previews=1)
        metadata = dict(initialization=None, trainingOnly=True, corpusSha256=corpus_fingerprint(corpus), steps=1,
                        optimizerUpdates=1, trainingLoss=.2, validationLoss=.3, unobservedChannels=[])
        return args, metadata

    def test_review_masks_choose_known_positive_tile_and_show_coast_on_white_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            args, checkpoint = self.fixture(root)
            model = lambda tile, overview, position: torch.full((1, 7, 512, 512), -20.)
            with patch.object(inspection, 'load_model', return_value=(model, checkpoint)), \
                 patch.object(inspection.onnx.checker, 'check_model'):
                inspection.inspect(args)
            report = json.loads((root / 'diagnostics/diagnostics.json').read_text())
            self.assertEqual(report['sheets'][0]['pixelOrigin'], [448, 0])
            self.assertEqual(report['sheets'][0]['channels']['coast']['targetPixels'], 93)
            with Image.open(root / 'diagnostics/fixture.jpg') as preview:
                self.assertTrue(all(value > 240 for value in preview.getpixel((262, 228))))
                red, green, blue = preview.getpixel((512 + 262, 228))
                self.assertGreater(green, red + 25)
                self.assertGreater(blue, red + 25)

    def test_fresh_encoder_does_not_masquerade_as_a_baseline_initializer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            args, checkpoint = self.fixture(root)
            baseline = root / 'baseline.pt'
            baseline.write_bytes(b'baseline')
            args.baseline_checkpoint = str(baseline)
            with patch.object(inspection, 'load_model', return_value=(None, checkpoint)):
                with self.assertRaisesRegex(ValueError, 'initializer'):
                    inspection.inspect(args)
            self.assertFalse((root / 'diagnostics').exists())


if __name__ == '__main__':
    unittest.main()
