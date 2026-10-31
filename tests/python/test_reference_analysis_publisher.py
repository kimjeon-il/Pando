"""Publisher-layer mechanics use tiny fixtures, never as model training data."""
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest

import numpy as np
import pymupdf
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from corpus import validate_corpus
import corpus
from publisher import prepare_sheet


class PublisherLabelsTests(unittest.TestCase):
    def source(self, root, international=True):
        root = pathlib.Path(root)
        (root / 'sources').mkdir()
        path = root / 'sources/fixture.pdf'
        with pymupdf.open() as doc:
            page = doc.new_page(width=160, height=120)
            ocgs = {name: doc.add_ocg(name) for name in ['Map Frame', 'State or Territory', 'Hydrography', 'Road Features', 'Geographic Names', 'Projection and Grids']}
            if international:
                ocgs['International'] = doc.add_ocg('International')
                page.draw_line((15, 40), (145, 40), width=2, color=(0, 0, 0), oc=ocgs['International'])
                page.insert_text((45, 41), 'Border', fontsize=9, oc=ocgs['International'])
            page.draw_rect((2, 2, 158, 118), width=2, color=(0, 0, 0), oc=ocgs['Map Frame'])
            page.draw_line((15, 65), (145, 65), width=2, color=(0, 0, 0), oc=ocgs['State or Territory'])
            page.draw_line((15, 85), (145, 85), width=2, color=(0, 0, 1), oc=ocgs['Hydrography'])
            page.draw_line((15, 100), (145, 100), width=2, color=(1, 0, 0), oc=ocgs['Road Features'])
            page.insert_text((45, 25), 'Town', fontsize=9, oc=ocgs['Geographic Names'])
            # One PDF text span can contain separate grid digits far apart.
            page.insert_text((10, 15), '1', fontsize=9, oc=ocgs['Projection and Grids'])
            stream = page.get_contents()[-1]
            body = doc.xref_stream(stream)
            self.assertEqual(body.count(b'[<31>]TJ'), 1)
            doc.update_stream(stream, body.replace(b'[<31>]TJ', b'(1) Tj 120 -80 Td (2) Tj'))
            doc.save(path)
        metadata = dict(id='fixture', format='pdf', familyId='publisher-series', editionId='edition-one',
                        language='eng', script='Latin', published='2014', materialKind='publisher-layered-pdf',
                        rightsReviewed=True, license='fixture only, not training materials', url='https://example.test/source.pdf',
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        path.with_suffix('.source.json').write_text(json.dumps(metadata), encoding='utf-8')
        return path

    def test_masks_follow_real_source_layers_and_ignore_unlabelled_or_text_obscured_pixels(self):
        with tempfile.TemporaryDirectory() as folder:
            source = self.source(folder)
            original = source.read_bytes()
            sheet = prepare_sheet(source, folder, maximum_dimension=160)
            annotation = json.loads((pathlib.Path(folder) / sheet['annotations']).read_text(encoding='utf-8'))
            masks = np.array(Image.open(pathlib.Path(folder) / annotation['raster']['path']))
            valid = np.array(Image.open(pathlib.Path(folder) / annotation['validRaster']['path']))
            self.assertTrue(masks[40, 25] & 1)
            self.assertTrue(masks[65, 25] & 2)
            self.assertTrue(masks[85, 25] & 8)
            self.assertTrue(masks[100, 25] & 16)
            self.assertTrue(masks[2, 25] & 64)
            self.assertTrue((masks[15:27, 40:80] & 32).any())
            self.assertFalse((valid & 4).any(), 'Unlabelled coast is never background truth')
            self.assertFalse(valid[39, 50] & 1, 'Text-obscured line pixels remain unknown')
            self.assertFalse(masks[55, 100] & 32, 'Whitespace between distant glyphs is not text')
            self.assertTrue(valid[55, 100] & 1, 'A distant-digit span must not hide the map interior')
            self.assertIs(annotation['reviewed'], False)
            self.assertEqual(annotation['origin'], 'publisher-layer-export')
            self.assertEqual(annotation['width'], 160)
            self.assertEqual(source.read_bytes(), original)

    def test_source_derived_labels_are_explicitly_training_only_and_hash_verified(self):
        with tempfile.TemporaryDirectory() as folder:
            sheet = prepare_sheet(self.source(folder), folder, maximum_dimension=160)
            value = dict(schemaVersion=1, trainingOnly=True, sheets=[sheet])
            with self.assertRaisesRegex(ValueError, 'Source-reviewed independent corpus required; supplied corpus is training-only'):
                validate_corpus(value, folder)
            validate_corpus(value, folder, training_only=True)
            value['sheets'][0]['split'] = 'test'
            with self.assertRaisesRegex(ValueError, 'training-only'):
                validate_corpus(value, folder, training_only=True)
            value['sheets'][0]['split'] = 'train'
            annotation = json.loads((pathlib.Path(folder) / sheet['annotations']).read_text(encoding='utf-8'))
            (pathlib.Path(folder) / annotation['raster']['path']).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'hash'):
                validate_corpus(value, folder, training_only=True)

    def test_repeated_preparation_preserves_existing_outputs_and_rejects_changed_render_size(self):
        with tempfile.TemporaryDirectory() as folder:
            source = self.source(folder)
            first = prepare_sheet(source, folder, maximum_dimension=160)
            before = {p: p.read_bytes() for p in pathlib.Path(folder).rglob('*') if p.is_file()}
            self.assertEqual(prepare_sheet(source, folder, maximum_dimension=160), first)
            with self.assertRaisesRegex(ValueError, 'render|existing'):
                prepare_sheet(source, folder, maximum_dimension=320)
            self.assertTrue(all(p.read_bytes() == body for p, body in before.items()))

    def test_publisher_provenance_rejects_forged_generator_and_unreviewed_rights(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            sheet = prepare_sheet(self.source(root), root, maximum_dimension=160)
            annotation = json.loads((root / sheet['annotations']).read_text(encoding='utf-8'))
            corpus.validate_publisher_annotation(annotation, sheet, root)
            forged = json.loads(json.dumps(annotation))
            forged['producer']['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'identity'):
                corpus.validate_publisher_annotation(forged, sheet, root)
            metadata_path = root / annotation['sourceMetadata']
            metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
            metadata['rightsReviewed'] = False
            metadata_path.write_text(json.dumps(metadata), encoding='utf-8')
            forged = json.loads(json.dumps(annotation))
            forged['sourceMetadataSha256'] = hashlib.sha256(metadata_path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, 'provenance'):
                corpus.validate_publisher_annotation(forged, sheet, root)

    def test_missing_international_layer_fails_before_creating_false_empty_border_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            source = self.source(folder, international=False)
            with self.assertRaisesRegex(ValueError, 'International'):
                prepare_sheet(source, folder, maximum_dimension=160)
            self.assertFalse((pathlib.Path(folder) / 'derived').exists())

    def test_dataset_identity_changes_when_labels_change_without_a_manifest_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            sheet = prepare_sheet(self.source(folder), root, maximum_dimension=160)
            manifest = root / 'corpus.training.json'
            manifest.write_text(json.dumps(dict(schemaVersion=1, trainingOnly=True, sheets=[sheet])), encoding='utf-8')
            before = corpus.corpus_fingerprint(manifest)
            labels = root / sheet['annotations']
            labels.write_text(labels.read_text(encoding='utf-8') + '\n', encoding='utf-8')
            self.assertNotEqual(corpus.corpus_fingerprint(manifest), before)


if __name__ == '__main__':
    unittest.main()
