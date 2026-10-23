import pathlib
import sys
import unittest
import torch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from model import ReferenceBoundaryModel, boundary_loss


class ModelInterfaceTests(unittest.TestCase):
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
