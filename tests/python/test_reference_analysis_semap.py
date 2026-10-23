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
    def test_short_http_range_is_retried_without_accepting_truncated_content(self):
        from semap import fetch_range
        calls = []
        def opener(request, **_):
            calls.append(request.get_header('Range'))
            response = io.BytesIO(b'abc' if len(calls) == 1 else b'abcdef')
            response.status = 206
            response.headers = {'Content-Range': 'bytes 10-15/100', 'Content-Length': '6'}
            return response
        self.assertEqual(fetch_range('test.zip', 100, 10, 15, opener), b'abcdef')
        self.assertEqual(calls, ['bytes=10-15', 'bytes=10-15'])
        class Chunked(io.BytesIO):
            def read(self, count=-1):
                return super().read(min(count, 3))
        def partial_reads(*_, **__):
            response = Chunked(b'abcdef')
            response.status, response.headers = 206, {'Content-Range': 'bytes 10-15/100'}
            return response
        self.assertEqual(fetch_range('test.zip', 100, 10, 15, partial_reads), b'abcdef')
        def incorrect_range(*_, **__):
            response = io.BytesIO(b'abcdef')
            response.status, response.headers = 206, {'Content-Range': 'bytes 0-5/100'}
            return response
        with self.assertRaisesRegex(ValueError, 'exact pinned'):
            fetch_range('test.zip', 100, 10, 15, incorrect_range)

    def test_reused_original_is_checked_against_remote_member_crc(self):
        from semap import read_member
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as output:
            output.writestr('source.png', b'original bytes')
        with tempfile.TemporaryDirectory() as folder, zipfile.ZipFile(buffer) as archive:
            cached = pathlib.Path(folder) / 'source.png'
            self.assertEqual(read_member(archive, 'source.png', cached), b'original bytes')
            cached.write_bytes(b'original bytes')
            self.assertEqual(read_member(archive, 'source.png', cached), b'original bytes')
            cached.write_bytes(b'changed source')
            with self.assertRaisesRegex(ValueError, 'CRC'):
                read_member(archive, 'source.png', cached)

    def test_compound_institution_ids_are_recognized_without_accepting_restricted_sources(self):
        names = ['images/real/wwu_munster_109980-1_1697_6386.jpg',
                 'images/real/bordeaux_montaigne_024681-0_920_4808.jpg',
                 'images/real/davidrumsey_001234-0_0_0.jpg']
        training = {pathlib.PurePosixPath(name).stem for name in names}
        self.assertEqual(set(select_real_training_members(names, training)), set(names[:2]))

    def test_uninformative_margins_are_rejected_but_real_supervised_map_is_accepted(self):
        from semap import informative_labels
        labels = np.zeros((100, 100), dtype=np.uint8)
        self.assertFalse(informative_labels(labels))
        labels[:] = 3
        self.assertFalse(informative_labels(labels), 'Unbroken land-only margins do not add feature diversity')
        labels[:, 45:55] = 4
        self.assertTrue(informative_labels(labels))

    def test_import_preserves_real_member_identity_but_never_creates_evaluation_truth(self):
        image_buffer, labels_buffer, partitions_buffer = io.BytesIO(), io.BytesIO(), io.BytesIO()
        key, blank_key = 'loc_000001-1_0_0', 'loc_000001-0_0_0'
        Image.new('RGB', (32, 24), 'white').save(image_buffer, format='JPEG')
        Image.fromarray(np.full((24, 32), 4, dtype=np.uint8)).save(labels_buffer, format='PNG')
        with zipfile.ZipFile(partitions_buffer, 'w') as output:
            output.writestr('partitions/train.txt', key + '\n' + blank_key)
        payloads = {'partitions.zip': partitions_buffer.getvalue(), 'license_images.md': b'test rights', 'README.md': b'test documentation'}
        archives = {}
        for name, member, body in [('images.zip', 'images/real/' + key + '.jpg', image_buffer.getvalue()),
                                   ('labels.zip', 'labels/real/' + key + '.png', labels_buffer.getvalue())]:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as output:
                output.writestr(member, body)
                if name == 'images.zip':
                    output.writestr('images/real/' + blank_key + '.jpg', body)
                else:
                    blank = io.BytesIO()
                    Image.fromarray(np.zeros((24, 32), dtype=np.uint8)).save(blank, format='PNG')
                    output.writestr('labels/real/' + blank_key + '.png', blank.getvalue())
            archives[name] = buffer.getvalue()
        with tempfile.TemporaryDirectory() as folder, \
                patch.dict(semap.FILES, {name: (len(body), hashlib.md5(body).hexdigest()) for name, body in payloads.items()}), \
                patch.object(semap.urllib.request, 'urlopen', side_effect=lambda url, **_: io.BytesIO(payloads[url.split('/')[-2]])), \
                patch.object(semap, 'remote_archive', side_effect=lambda name: zipfile.ZipFile(io.BytesIO(archives[name]))):
            manifest = semap.prepare(folder)
            corpus = json.loads(manifest.read_text(encoding='utf-8'))
            self.assertEqual(len(corpus['sheets']), 1)
            self.assertEqual(corpus['sheets'][0]['id'], 'semap-' + key)
            validate_corpus(corpus, folder, training_only=True)
            with self.assertRaisesRegex(ValueError, 'Human-reviewed'):
                validate_corpus(corpus, folder)
            sheet = corpus['sheets'][0]
            self.assertEqual((pathlib.Path(folder) / sheet['image']).read_bytes(), image_buffer.getvalue())
            annotation = json.loads((pathlib.Path(folder) / sheet['annotations']).read_text(encoding='utf-8'))
            self.assertEqual(annotation['observedChannels'], ['hydro', 'transport'])
            annotation['producer']['sha256'] = 'a' * 64
            annotation_path = pathlib.Path(folder) / sheet['annotations']
            annotation_path.write_text(json.dumps(annotation), encoding='utf-8')
            validate_corpus(corpus, folder, training_only=True)
            mask_path = pathlib.Path(folder) / annotation['raster']['path']
            Image.fromarray(np.full((24, 32), 16, dtype=np.uint8)).save(mask_path)
            annotation['raster']['sha256'] = hashlib.sha256(mask_path.read_bytes()).hexdigest()
            annotation_path.write_text(json.dumps(annotation), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'conversion'):
                validate_corpus(corpus, folder, training_only=True)
            (pathlib.Path(folder) / annotation['sourceFiles'][1]['path']).write_bytes(b'changed label')
            with self.assertRaisesRegex(ValueError, 'hash'):
                validate_corpus(corpus, folder, training_only=True)

    def test_preserves_alternate_author_training_tiles_until_content_can_be_inspected(self):
        names = ['images/real/loc_000001-0_0_0.jpg', 'images/real/loc_000001-1_0_0.jpg',
                 'images/real/loc_000002-0_0_0.jpg', 'images/real/loc_000003-0_0_0.jpg',
                 'images/real/bnf_000004-0_0_0.jpg', 'images/synthetic/4_output_1.jpg']
        selected = select_real_training_members(names, {'loc_000001-0_0_0', 'loc_000001-1_0_0',
            'loc_000002-0_0_0', 'bnf_000004-0_0_0', '4_output_1'})
        self.assertEqual(selected, names[:3], 'A blank first tile must not discard a useful alternate from the same original')

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
