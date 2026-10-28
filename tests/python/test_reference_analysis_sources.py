import hashlib
import importlib.util
import pathlib
import tempfile
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / "tools/reference-analysis/prepare-analysis-images.py"
spec = importlib.util.spec_from_file_location("reference_inputs", path)
inputs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inputs)


class SourceDerivativeTests(unittest.TestCase):
    def test_app_derivative_keeps_master_and_original_pixel_scale(self):
        from PIL import Image
        import json
        with tempfile.TemporaryDirectory() as directory:
            original = pathlib.Path(directory, "map.jpg")
            Image.new("RGB", (100, 80), "white").save(original)
            digest = hashlib.sha256(original.read_bytes()).hexdigest()
            original.with_suffix(".source.json").write_text(json.dumps({"id": "map", "familyId": "family", "rightsReviewed": True, "sha256": digest}), encoding="utf-8")
            result = inputs.prepare(original, maximum_pixels=1000)
            self.assertLessEqual(result["size"][0] * result["size"][1], 1000)
            self.assertEqual(result["originalPixelsPerInputPixel"], [100 / result["size"][0], 80 / result["size"][1]])
            self.assertFalse(result["reviewedLabels"])
            self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), digest)
            self.assertEqual(inputs.prepare(original, maximum_pixels=1000), result)
            self.assertFalse(list(pathlib.Path(directory).glob("*.part")))



if __name__ == '__main__':
    unittest.main()
