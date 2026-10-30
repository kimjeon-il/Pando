import hashlib
import pathlib
import sys
import unittest
import json
import tempfile
from types import SimpleNamespace
import numpy as np
from PIL import Image
import torch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from model import ReferenceBoundaryModel, boundary_loss
from train import MapTiles, optimizer_update, train


class ModelInterfaceTests(unittest.TestCase):
    def test_macro_guard_cannot_be_bypassed_by_relabelling_a_micro_manifest(self):
        from train import require_macro_scope
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for origin in ['semap-human-mask-export', 'publisher-layer-export']:
                (root/'labels.json').write_text(json.dumps(dict(origin=origin)), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'macro'):
                    require_macro_scope([dict(geographicScope='country', scopeEvidence='whole map',
                                              annotations='labels.json')], root)

    def test_macro_only_training_rejects_micro_and_unverified_source_scope(self):
        from train import require_macro_scope
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            (root/'labels.json').write_text(json.dumps(dict(origin='macro-vector-supervision')), encoding='utf-8')
            require_macro_scope([dict(geographicScope='world', scopeEvidence='whole published world map', annotations='labels.json')], root)
            for row in [dict(geographicScope='city', scopeEvidence='city map'),
                        dict(geographicScope='country'), dict(scopeEvidence='unknown')]:
                with self.assertRaisesRegex(ValueError, 'macro'):
                    require_macro_scope([row], root)

    def test_balanced_training_sees_every_original_without_large_sheets_dominating(self):
        from train import balanced_tile_indices
        first = SimpleNamespace(tiles=[(0, i, 0) for i in range(90)] + [(1, 0, 0)],
                                sheets=[{'duplicateGroup': 'a'}, {'duplicateGroup': 'b'}])
        second = SimpleNamespace(tiles=[(i, 0, 0) for i in range(9)],
                                 sheets=[{'duplicateGroup': str(i)} for i in range(9)])
        indices = balanced_tile_indices([first, second], epoch=0, seed=123)
        self.assertEqual(indices, balanced_tile_indices([first, second], epoch=0, seed=123))
        self.assertNotEqual(indices, balanced_tile_indices([first, second], epoch=1, seed=123))
        self.assertEqual(sum(i < 91 for i in indices), 50)
        self.assertEqual(sum(i >= 91 for i in indices), 50)
        self.assertTrue(set(range(90, 100)).issubset(indices), 'Every original must be visited each epoch')
        self.assertGreater(indices.count(90), 10, 'A one-tile original is not drowned by a 90-tile sheet')
        small = SimpleNamespace(tiles=[(0, 0, 0)], sheets=[{'duplicateGroup': 'one'}])
        diverse = SimpleNamespace(tiles=[(i, 0, 0) for i in range(99)],
                                  sheets=[{'duplicateGroup': str(i)} for i in range(99)])
        extreme = balanced_tile_indices([small, diverse], epoch=0, seed=123)
        self.assertEqual(extreme.count(0), len(extreme) - extreme.count(0),
                         'Coverage of many originals must not silently unbalance corpus contribution')

    def test_training_only_initialization_cannot_be_promoted_into_independent_evaluation(self):
        with self.assertRaisesRegex(ValueError, 'initialization requires training-only'):
            train(SimpleNamespace(training_only=False, initialize_checkpoint='prior.pt'), {'sheets': []}, pathlib.Path('.'))

    def test_finite_loss_with_amp_overflow_is_not_a_successful_optimizer_update(self):
        parameter = torch.nn.Parameter(torch.tensor(1.))
        optimizer = torch.optim.SGD([parameter], lr=.1)
        scaler = torch.amp.GradScaler('cpu')
        loss = parameter * 1e35
        self.assertTrue(torch.isfinite(loss))
        scaler.scale(loss).backward()
        self.assertFalse(optimizer_update(scaler, optimizer))
        self.assertEqual(float(parameter.detach()), 1.)
        optimizer.zero_grad()
        scaler.scale(parameter.square()).backward()
        self.assertTrue(optimizer_update(scaler, optimizer))
        self.assertLess(float(parameter.detach()), 1.)

    def test_publisher_bitfields_keep_overlapping_classes_and_unknown_channel_validity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            Image.new('RGB', (32, 24), 'white').save(root / 'source.png')
            masks = np.zeros((24, 32), dtype=np.uint8)
            masks[8, 10] = 1 | 32
            Image.fromarray(masks).save(root / 'mask.png')
            Image.fromarray(np.full_like(masks, 127 & ~4)).save(root / 'valid.png')
            digest = lambda path: hashlib.sha256((root / path).read_bytes()).hexdigest()
            annotation = dict(schemaVersion=1, width=32, height=24, origin='publisher-layer-export',
                raster={'path': 'mask.png', 'sha256': digest('mask.png')},
                validRaster={'path': 'valid.png', 'sha256': digest('valid.png')})
            (root / 'labels.json').write_text(json.dumps(annotation), encoding='utf-8')
            sheet = dict(image='source.png', sha256=digest('source.png'), annotations='labels.json')
            dataset = MapTiles(root, [sheet])
            tile, overview, position, target, valid, _ = dataset[0]
            self.assertEqual(float(target[0, 8, 10]), 1)
            self.assertEqual(float(target[5, 8, 10]), 1)
            self.assertEqual(list(valid.shape), [7, 512, 512])
            self.assertEqual(float(valid[2].sum()), 0)
            self.assertEqual(float(valid[:, 24:, :].sum()), 0)
            self.assertEqual(list(tile.shape), [3, 512, 512])
            self.assertEqual(list(overview.shape), [3, 256, 256])
            Image.fromarray(np.zeros_like(masks)).save(root / 'valid.png')
            with self.assertRaisesRegex(ValueError, '(?i)hash'):
                MapTiles(root, [sheet])
            annotation['validRaster']['sha256'] = digest('valid.png')
            (root / 'labels.json').write_text(json.dumps(annotation), encoding='utf-8')
            self.assertEqual(len(MapTiles(root, [sheet])), 0,
                             'An unlabelled auxiliary tile must not count as training')

    def test_broadcast_and_explicit_channel_validity_are_the_same_supervision(self):
        logits = torch.zeros(1, 7, 12, 12)
        target = torch.zeros_like(logits)
        target[:, :, 5:7, :] = 1
        valid = torch.ones(1, 1, 12, 12)
        self.assertAlmostEqual(float(boundary_loss(logits, target, valid)),
                               float(boundary_loss(logits, target, valid.expand_as(logits))), places=6)

    def test_unobserved_channel_does_not_update_from_an_unlabelled_coast(self):
        logits = torch.zeros(1, 7, 12, 12, requires_grad=True)
        valid = torch.ones_like(logits)
        valid[:, 2] = 0
        target = torch.zeros_like(logits)
        target[:, 2] = 1
        loss = boundary_loss(logits, target, valid)
        loss.backward()
        self.assertEqual(float(logits.grad[:, 2].abs().sum()), 0)
        self.assertGreater(float(logits.grad[:, 0].abs().sum()), 0)

    def test_separate_semantic_channels_accept_overlapping_text_and_boundary_targets(self):
        torch.set_num_threads(2)
        model = ReferenceBoundaryModel()
        model.eval()
        output = model(torch.zeros(1, 3, 512, 512), torch.zeros(1, 3, 256, 256), torch.tensor([[0., 0., 1., 1.]]))
        self.assertEqual(list(output.shape), [1, 7, 512, 512])
        target = torch.zeros_like(output)
        target[:, [0, 5], 250:254, :] = 1
        loss = boundary_loss(output, target, torch.ones(1, 1, 512, 512))
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertTrue(torch.isfinite(model.head.weight.grad).all())
        ignored = boundary_loss(output.detach(), target, torch.zeros(1, 1, 512, 512))
        self.assertAlmostEqual(float(ignored), 0.)


if __name__ == '__main__':
    unittest.main()
