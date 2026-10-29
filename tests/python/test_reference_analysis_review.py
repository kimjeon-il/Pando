"""Source-bound review masks and ancestry admission; no real corpus is loaded."""
import copy
import hashlib
import pathlib
import sys
import tempfile
import json
import unittest
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
import corpus
from evaluation import boundary_counts


class ReviewContractTests(unittest.TestCase):
    def sheet(self, key='one', split='train'):
        return dict(id=key, familyId=key+'-family', editionId=key+'-edition', duplicateGroup=key,
                    sha256='a'*64 if key == 'one' else hashlib.sha256(key.encode()).hexdigest(), split=split)

    def annotation(self):
        return dict(schemaVersion=1, reviewed=True, width=24, height=16,
                    review=dict(kind='agent', reviewer='source-reader', sourceSha256='a'*64,
                                predictionBlind=True, reviewedAt='2026-10-29T00:00:00Z'),
                    known={'international': [[[0, 0], [23, 0], [23, 9], [0, 9]]],
                           'text': [[[0, 0], [23, 0], [23, 9], [0, 9]]]},
                    lines=[dict(kind='international', points=[[3, 5], [20, 5]], width=1)],
                    regions=[dict(kind='text', polygon=[[8, 3], [12, 3], [12, 7], [8, 7]])], ignore=[])

    def test_truthful_agent_review_is_bound_to_exact_source(self):
        label = self.annotation()
        corpus.validate_review_annotation(label, self.sheet())
        self.assertEqual(label['review']['kind'], 'agent')
        with self.assertRaisesRegex(ValueError, 'source'):
            corpus.validate_review_annotation(label, self.sheet('other'))
        label['review']['predictionBlind'] = False
        with self.assertRaisesRegex(ValueError, 'blind'):
            corpus.validate_review_annotation(label, self.sheet())

    def test_mask_keeps_overlap_and_channel_unknowns(self):
        label = self.annotation()
        target, known = corpus.review_masks(label)
        self.assertTrue(target[0, 5, 10] and target[5, 5, 10])
        self.assertFalse(known[1].any())
        self.assertFalse(known[:, 12].any())
        cropped = corpus.review_masks(label, window=(5, 2, 10, 8))
        np.testing.assert_array_equal(cropped[0], target[:, 2:10, 5:15])
        np.testing.assert_array_equal(cropped[1], known[:, 2:10, 5:15])

    def test_positives_outside_known_region_are_rejected(self):
        label = self.annotation()
        label['known']['international'] = []
        with self.assertRaisesRegex(ValueError, 'known'):
            corpus.validate_review_annotation(label, self.sheet())

    def test_evaluation_ignores_unknown_per_channel(self):
        label = self.annotation()
        prediction = np.zeros((3, 16, 24), dtype=bool)
        prediction[0, 5, 3:21] = True
        prediction[0, 12] = True
        prediction[1] = True
        result = boundary_counts(prediction, label)
        self.assertEqual(result[0].tolist(), [18, 18, 18, 18])
        self.assertEqual(result[1].tolist(), [0, 0, 0, 0])

    def test_lineage_preserves_ancestors_and_refuses_hidden_family_reuse(self):
        original = self.sheet()
        parent = corpus.build_training_lineage([original])
        fresh = self.sheet('fresh')
        lineage = corpus.build_training_lineage([fresh], parent=parent, parent_sha256='c'*64)
        self.assertEqual(len(lineage['sheets']), 2)
        corpus.assert_evaluation_independence(lineage, [self.sheet('test', 'test')])
        leaked = self.sheet('different-id', 'test')
        leaked.update(familyId=original['familyId'], sha256='d'*64)
        with self.assertRaisesRegex(ValueError, 'familyId'):
            corpus.assert_evaluation_independence(lineage, [leaked])

    def test_lineage_requires_full_ancestry_and_detects_hash_aliases(self):
        with self.assertRaisesRegex(ValueError, '(?i)complete'):
            corpus.build_training_lineage([], parent={'complete': False}, parent_sha256='c'*64)
        lineage = corpus.build_training_lineage([self.sheet()])
        leaked = self.sheet('new', 'test')
        leaked['sha256'] = 'a'*64
        with self.assertRaisesRegex(ValueError, 'sha256'):
            corpus.assert_evaluation_independence(lineage, [leaked])

    def test_lineage_records_selection_exposure_and_rejects_test_exposure(self):
        validation = self.sheet('validation', 'validation')
        lineage = corpus.build_training_lineage([self.sheet(), validation])
        self.assertEqual(lineage['sheets'][1]['usage'], 'selection')
        test = copy.deepcopy(validation)
        test['split'] = 'test'
        with self.assertRaisesRegex(ValueError, 'independent'):
            corpus.assert_evaluation_independence(lineage, [test])

    def test_training_tiles_and_supervision_share_channel_known_masks(self):
        from PIL import Image
        from train import MapTiles, raster_supervision
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            Image.new('RGB', (24, 16), 'white').save(root/'map.png')
            label = self.annotation()
            (root/'label.json').write_text(json.dumps(label))
            rows = [dict(id='fixture', image='map.png', annotations='label.json')]
            dataset = MapTiles(root, rows)
            target, validity = dataset[0][3:5]
            self.assertFalse(validity[1].any())
            self.assertFalse(validity[:, 12].any())
            self.assertTrue(target[0, 5, 10] and target[5, 5, 10])
            counts = raster_supervision(root, rows)
            self.assertEqual(counts[0].tolist(), [240, 18])
            self.assertEqual(counts[1].tolist(), [0, 0])

    def test_diagnostic_old_model_evaluation_cannot_claim_independence_or_admission(self):
        from PIL import Image
        import argparse
        import torch
        from unittest.mock import patch
        import train
        class Fixed(torch.nn.Module):
            def forward(self, tile, overview, position):
                return torch.full((1,7,512,512),-20.)
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);Image.new('RGB',(24,16),'white').save(root/'map.png')
            label=self.annotation();(root/'label.json').write_text(json.dumps(label))
            row=self.sheet('test','test');row.update(image='map.png',annotations='label.json',mapKind='monochrome',script='Latin',language='eng')
            value=dict(schemaVersion=1,sheets=[row]);(root/'corpus.json').write_text(json.dumps(value));(root/'old.pt').write_bytes(b'old-model')
            args=argparse.Namespace(checkpoint=str(root/'old.pt'),device='cpu',corpus=str(root/'corpus.json'),output=str(root/'report.json'),diagnostic_only=True,baseline_report=None)
            checkpoint=dict(corpusSha256='b'*64,trainingOnly=True,unobservedChannels=[])
            with patch.object(train,'load_model',return_value=(Fixed(),checkpoint)):
                train.evaluate(args,value,root)
            report=json.loads((root/'report.json').read_text())
            self.assertFalse(report['independence']['passed'])
            self.assertFalse(report['admission']['passed'])
            self.assertTrue(report['diagnosticOnly'])
            self.assertIn('confounders',report)
            self.assertFalse(report['reviewCoverage']['complete'])
            self.assertIn('incomplete-source-map-review',[v['reason'] for v in report['admission']['failures']])

    def test_public_encoder_initialization_records_actual_verified_weight_bytes(self):
        from model import verified_pretrained_identity
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'encoder.pth';path.write_bytes(b'fixture weights')
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            url='https://download.pytorch.org/models/encoder-'+digest[:8]+'.pth'
            value=verified_pretrained_identity(path,url)
            self.assertEqual(value['sha256'],digest)
            self.assertEqual(value['bytes'],15)
            path.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'hash'):
                verified_pretrained_identity(path,url)

    def test_transparent_training_source_uses_the_same_white_composite_as_analysis(self):
        from PIL import Image
        from train import MapTiles
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            image=Image.new('RGBA',(24,16),(0,0,0,0));image.putpixel((4,4),(0,0,0,255));image.save(root/'map.png')
            (root/'label.json').write_text(json.dumps(self.annotation()))
            tile=MapTiles(root,[dict(id='transparent',image='map.png',annotations='label.json')])[0][0]
            self.assertGreater(float(tile[0,0,0]),2.)
            self.assertLess(float(tile[0,4,4]),-2.)


if __name__ == '__main__':
    unittest.main()
