import hashlib
import importlib.util
import io
import pathlib
import tempfile
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[2] / "tools/reference-analysis/acquire-sources.py"
spec = importlib.util.spec_from_file_location("reference_sources", path)
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)
image_spec = importlib.util.spec_from_file_location("reference_inputs", path.with_name("prepare-analysis-images.py"))
inputs = importlib.util.module_from_spec(image_spec)
image_spec.loader.exec_module(inputs)


class SourceAcquisitionTests(unittest.TestCase):
    def test_publisher_pdf_is_preserved_as_pdf_and_checked_by_its_own_signature(self):
        body = b'%PDF-1.7\nsource publisher content\n%%EOF'
        source = {'id': 'usgs-sheet', 'format': 'pdf', 'rightsReviewed': True, 'license': 'public-domain',
                  'url': 'https://example.test/map.pdf', 'maximumBytes': 100, 'expectedBytes': len(body)}
        with tempfile.TemporaryDirectory() as directory:
            result = sources.acquire(source, directory, lambda *_args, **_kwargs: io.BytesIO(body))
            self.assertEqual(result['status'], 'acquired-unlabelled')
            self.assertEqual(pathlib.Path(directory, 'usgs-sheet.pdf').read_bytes(), body)
            self.assertFalse(pathlib.Path(directory, 'usgs-sheet.jpg').exists())
            self.assertEqual(sources.acquire(source, directory)['status'], 'verified-existing')
            with self.assertRaisesRegex(ValueError, 'PDF'):
                sources.acquire({**source, 'id': 'damaged', 'expectedBytes': 4}, directory,
                                lambda *_args, **_kwargs: io.BytesIO(b'HTML'))
            self.assertFalse(pathlib.Path(directory, 'damaged.pdf').exists())
            self.assertFalse(pathlib.Path(directory, 'damaged.pdf.part').exists())

    def test_verified_inventory_is_idempotent_and_never_claims_labels(self):
        body = b"\xff\xd8example"
        source = {"id": "seed", "rightsReviewed": True, "license": "CC-BY-4.0", "url": "https://example.test/map.jpg", "maximumBytes": 100,
                  "expectedBytes": len(body), "md5": hashlib.md5(body).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            result = sources.acquire(source, directory, lambda *_args, **_kwargs: io.BytesIO(body))
            self.assertEqual(result["status"], "acquired-unlabelled")
            self.assertEqual(sources.acquire(source, directory)["status"], "verified-existing")
            self.assertFalse(list(pathlib.Path(directory).glob("*.part")))
            evidence = pathlib.Path(directory, "seed.source.json").read_text(encoding="utf-8")
            self.assertIn('"trainingReady": false', evidence)

    def test_failure_removes_only_its_own_temporary_download(self):
        source = {"id": "seed", "rightsReviewed": True, "license": "CC0", "url": "https://example.test/map.jpg", "maximumBytes": 3}
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "budget"):
                sources.acquire(source, directory, lambda *_args, **_kwargs: io.BytesIO(b"oversized"))
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [])
            protected = pathlib.Path(directory, "seed.jpg.part")
            protected.write_bytes(b"other process")
            with self.assertRaises(FileExistsError):
                sources.acquire(source, directory)
            self.assertEqual(protected.read_bytes(), b"other process")
            self.assertEqual(sources.acquire({"id": "pending", "rightsReviewed": False}, directory)["status"], "rights-unverified")

    def test_failed_publication_does_not_leave_partial_sidecar_or_download(self):
        source = {"id": "seed", "rightsReviewed": True, "license": "CC0", "url": "https://example.test/map.jpg", "maximumBytes": 100}
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(pathlib.Path, "rename", side_effect=OSError("publication failed")):
                with self.assertRaisesRegex(OSError, "publication failed"):
                    sources.acquire(source, directory, lambda *_args, **_kwargs: io.BytesIO(b"\xff\xd8example"))
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [])

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


if __name__ == "__main__":
    unittest.main()
