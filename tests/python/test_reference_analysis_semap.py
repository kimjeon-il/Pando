import importlib.util
import io
import pathlib
import sys
import unittest
import zipfile
import hashlib
import json
import tempfile
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/reference-analysis'))
from semap import RangeArchive, select_real_training_members, convert_labels
import semap
from corpus import validate_corpus
import numpy as np
from PIL import Image


class SemapImportTests(unittest.TestCase):
    def test_import_preserves_real_member_identity_but_never_creates_evaluation_truth(self):
        image_buffer, labels_buffer, partitions_buffer = io.BytesIO(), io.BytesIO(), io.BytesIO()
        key = 'loc_000001-0_0_0'
        Image.new('RGB', (32, 24), 'white').save(image_buffer, format='JPEG')
        Image.fromarray(np.full((24, 32), 4, dtype=np.uint8)).save(labels_buffer, format='PNG')
        with zipfile.ZipFile(partitions_buffer, 'w') as output:
            output.writestr('partitions/train.txt', key)
        payloads = {'partitions.zip': partitions_buffer.getvalue(), 'license_images.md': b'test rights', 'README.md': b'test documentation'}
        archives = {}
        for name, member, body in [('images.zip', 'images/real/' + key + '.jpg', image_buffer.getvalue()),
                                   ('labels.zip', 'labels/real/' + key + '.png', labels_buffer.getvalue())]:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as output:
                output.writestr(member, body)
            archives[name] = buffer.getvalue()
        with tempfile.TemporaryDirectory() as folder, \
                patch.dict(semap.FILES, {name: (len(body), hashlib.md5(body).hexdigest()) for name, body in payloads.items()}), \
                patch.object(semap.urllib.request, 'urlopen', side_effect=lambda url, **_: io.BytesIO(payloads[url.split('/')[-2]])), \
                patch.object(semap, 'remote_archive', side_effect=lambda name: zipfile.ZipFile(io.BytesIO(archives[name]))):
            manifest = semap.prepare(folder)
            corpus = json.loads(manifest.read_text(encoding='utf-8'))
            validate_corpus(corpus, folder, training_only=True)
            with self.assertRaisesRegex(ValueError, 'Human-reviewed'):
                validate_corpus(corpus, folder)
            sheet = corpus['sheets'][0]
            self.assertEqual((pathlib.Path(folder) / sheet['image']).read_bytes(), image_buffer.getvalue())
            annotation = json.loads((pathlib.Path(folder) / sheet['annotations']).read_text(encoding='utf-8'))
            self.assertEqual(annotation['observedChannels'], ['hydro', 'transport'])
            (pathlib.Path(folder) / annotation['sourceFiles'][1]['path']).write_bytes(b'changed label')
            with self.assertRaisesRegex(ValueError, 'hash'):
                validate_corpus(corpus, folder, training_only=True)

    def test_selects_only_author_training_real_samples_and_separate_originals(self):
        names = ['images/real/loc_000001-0_0_0.jpg', 'images/real/loc_000001-1_0_0.jpg',
                 'images/real/loc_000002-0_0_0.jpg', 'images/real/loc_000003-0_0_0.jpg',
                 'images/real/bnf_000004-0_0_0.jpg', 'images/synthetic/4_output_1.jpg']
        selected = select_real_training_members(names, {'loc_000001-0_0_0', 'loc_000001-1_0_0',
            'loc_000002-0_0_0', 'bnf_000004-0_0_0', '4_output_1'}, per_institution=4)
        self.assertEqual(selected, [names[0], names[2]])

    def test_only_water_and_roads_are_supervised_not_borders_or_unlabelled_background(self):
        masks, valid = convert_labels(np.array([[0, 1, 2, 3, 4, 5]], dtype=np.uint8))
        self.assertEqual(masks.tolist(), [[0, 0, 0, 0, 8, 16]])
        self.assertEqual(valid.tolist(), [[0, 0, 24, 24, 24, 24]])
        with self.assertRaisesRegex(ValueError, 'class'):
            convert_labels(np.array([[7]], dtype=np.uint8))

    def test_zip_range_reader_verifies_range_and_avoids_full_archive_download(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr('real/source.jpg', b'original member')
        body = archive.getvalue()
        requests = []
        def fetch(start, end):
            requests.append((start, end))
            return body[start:end + 1]
        with zipfile.ZipFile(RangeArchive(len(body), fetch)) as source:
            self.assertEqual(source.read('real/source.jpg'), b'original member')
        self.assertTrue(requests)
        with self.assertRaisesRegex(ValueError, 'length'):
            RangeArchive(100, lambda *_: b'x').read(10)


if __name__ == '__main__':
    unittest.main()
