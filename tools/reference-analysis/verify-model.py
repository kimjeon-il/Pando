"""Build a deterministic, untrained interface diagnostic in the fixed build cache.

This file is never a release model, and has no approved boundary.manifest.json.
"""
import pathlib
import torch
import onnx
from model import ReferenceBoundaryModel

root = pathlib.Path(__file__).resolve().parents[2]
path = root / 'build-native/reference-analysis/interface-smoke.onnx'
path.parent.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(2)
torch.manual_seed(20261022)
model = ReferenceBoundaryModel().eval()
with torch.no_grad():
    torch.onnx.export(model, (torch.zeros(1, 3, 512, 512), torch.zeros(1, 3, 256, 256), torch.zeros(1, 4)), str(path),
                      input_names=['tile', 'overview', 'position'], output_names=['logits'], opset_version=17, dynamo=False)
onnx.checker.check_model(str(path))
print('Untrained interface diagnostic only; not approved or packaged:', path)
