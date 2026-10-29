import importlib.util
import pathlib
import unittest
import tempfile
import json
import hashlib
import os
import subprocess
from PIL import Image
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("reference_corpus", ROOT / "tools/reference-analysis/corpus.py")
corpus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corpus)


class CorpusTests(unittest.TestCase):
    def sheet(self, key, family, split):
        return dict(id=key, familyId=family, editionId=key, duplicateGroup=key,
                    image="sources/" + key + ".png", sha256="a" * 64, split=split,
                    script="Arabic", language="fas", mapKind="monochrome",
                    source=dict(url="https://example.org/map", license="CC0", surveyed=None, published="1900", revised=None),
                    annotations="labels/" + key + ".json")

    def test_rejects_split_leakage_between_tiles_or_editions_of_same_series(self):
        with self.assertRaisesRegex(ValueError, "familyId.*split"):
            corpus.validate_corpus(dict(schemaVersion=1, sheets=[self.sheet("a", "atlas", "train"), self.sheet("b", "atlas", "test")]))

    def test_unlabelled_maps_cannot_be_used_as_ground_truth(self):
        sheet = self.sheet("a", "atlas", "train")
        sheet["annotations"] = None
        with self.assertRaisesRegex(ValueError, "annotations"):
            corpus.validate_corpus(dict(schemaVersion=1, sheets=[sheet]))

    def test_arabic_persian_and_urdu_remain_distinct_evaluation_groups(self):
        sheets = [self.sheet(str(i), str(i), "test") for i in range(3)]
        for sheet, language in zip(sheets, ["ara", "fas", "urd"]):
            sheet["language"] = language
        result = corpus.evaluation_groups(sheets)
        self.assertEqual(set(result), {"monochrome/Arabic/ara", "monochrome/Arabic/fas", "monochrome/Arabic/urd"})

    def test_source_language_is_not_relabelled_to_an_available_ocr_pack(self):
        for language, script in [('afr','Latin'),('und','Zyyy')]:
            sheet=self.sheet(language,language,'test');sheet.update(language=language,script=script,ocrLanguages=['eng'])
            self.assertEqual(corpus.validate_corpus(dict(schemaVersion=1,sheets=[sheet]))['sheets'][0]['language'],language)
        with self.assertRaisesRegex(ValueError,'OCR'):
            sheet['ocrLanguages']=['not-installed']
            corpus.validate_corpus(dict(schemaVersion=1,sheets=[sheet]))

    def test_training_accepts_every_new_pack_from_the_same_runtime_catalog(self):
        for language in ['lat', 'deu_latf', 'rus', 'ukr', 'heb', 'hye', 'kat', 'hin', 'ben', 'jpn_vert', 'chi_tra_vert']:
            sheet = self.sheet(language, language, 'test')
            sheet['language'] = language
            corpus.validate_corpus(dict(schemaVersion=1, sheets=[sheet]))

    def test_inventory_keeps_report_attachments_without_treating_screenshots_as_original_maps(self):
        with tempfile.TemporaryDirectory() as folder:
            reports = pathlib.Path(folder) / 'reports'
            sources = pathlib.Path(folder) / 'sources'
            (reports / 'case' / 'sources').mkdir(parents=True)
            sources.mkdir()
            (reports / 'case' / 'sources' / 'historic.pdf').write_bytes(b'original')
            (reports / 'case' / 'comparison.png').write_bytes(b'screenshot')
            rows = corpus.inventory(reports, sources)['entries']
            self.assertEqual(len(rows), 2)
            self.assertEqual(next(row for row in rows if row['path'].endswith('.pdf'))['kind'], 'original-candidate')
            self.assertEqual(next(row for row in rows if row['path'].endswith('.png'))['kind'], 'report-evidence-candidate')
            self.assertTrue(all(row['annotationStatus'] == 'unlabelled' for row in rows))

    def test_inventory_distinguishes_official_downsamples_and_app_derivatives_from_masters(self):
        with tempfile.TemporaryDirectory() as folder:
            reports, sources = pathlib.Path(folder) / 'reports', pathlib.Path(folder) / 'sources'
            reports.mkdir(); sources.mkdir()
            (sources / 'preview.jpg').write_bytes(b'preview')
            (sources / 'preview.source.json').write_text(json.dumps({'materialKind': 'official-downsample'}), encoding='utf-8')
            (sources / 'master-analysis.jpg').write_bytes(b'derived')
            (sources / 'master-analysis.json').write_text(json.dumps({'purpose': 'app-runtime-input-only', 'sourceSha256': 'a' * 64}), encoding='utf-8')
            rows = corpus.inventory(reports, sources)['entries']
            self.assertEqual(next(row for row in rows if row['path'].endswith('preview.jpg'))['kind'], 'source-downsample-candidate')
            self.assertEqual(next(row for row in rows if row['path'].endswith('master-analysis.jpg'))['kind'], 'analysis-derivative')

    def acquired_source(self, folder):
        sources = pathlib.Path(folder) / 'sources'
        sources.mkdir()
        image = sources / 'sheet.jpg'
        Image.new('RGB', (48, 32), 'white').save(image)
        metadata = dict(id='sheet', familyId='atlas', language='fas', script='Arabic',
                        published=None, materialKind='depositor-original', rightsReviewed=True,
                        sha256=hashlib.sha256(image.read_bytes()).hexdigest(),
                        metadataUrl='https://example.org/item', url='https://example.org/map.jpg',
                        license='CC0', uncertainty='Publication year is unconfirmed')
        image.with_suffix('.source.json').write_text(json.dumps(metadata), encoding='utf-8')
        return sources, image, metadata

    def test_review_preparation_reuses_original_bytes_and_produces_unadmitted_current_schema(self):
        with tempfile.TemporaryDirectory() as folder:
            sources, image, metadata = self.acquired_source(folder)
            original = image.read_bytes()
            # Header inspection must not decode large originals into memory.
            with patch.object(Image.Image, 'load', side_effect=AssertionError('Unexpected pixel decode')):
                manifest = corpus.prepare_review_corpus(sources)
            value = json.loads(manifest.read_text(encoding='utf-8'))
            sheet = value['sheets'][0]
            self.assertEqual(sheet['image'], 'sources/sheet.jpg')
            self.assertEqual(sheet['sha256'], metadata['sha256'])
            self.assertEqual(sheet['source']['published'], None)
            self.assertEqual(sheet['source']['uncertainty'], metadata['uncertainty'])
            self.assertIsNone(sheet['split'])
            self.assertIsNone(sheet['mapKind'])
            self.assertIsNone(sheet['editionId'])
            labels = json.loads((pathlib.Path(folder) / sheet['annotations']).read_text(encoding='utf-8'))
            self.assertEqual(labels, dict(schemaVersion=1, reviewed=False, width=48, height=32, lines=[], ignore=[]))
            self.assertFalse(value['trainingReady'])
            with self.assertRaisesRegex(ValueError, 'split'):
                corpus.validate_corpus(value, pathlib.Path(folder))
            sheet.update(split='train', mapKind='monochrome', editionId='independently-confirmed')
            with self.assertRaisesRegex(ValueError, 'Source-reviewed'):
                corpus.validate_corpus(value, pathlib.Path(folder))
            self.assertEqual(image.read_bytes(), original)
            self.assertEqual(len(list(pathlib.Path(folder).rglob('*.jpg'))), 1)

    def test_review_preparation_preserves_edited_labels_and_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            sources, image, _ = self.acquired_source(folder)
            manifest = corpus.prepare_review_corpus(sources)
            labels = pathlib.Path(folder) / 'labels/sheet.json'
            label_value = json.loads(labels.read_text(encoding='utf-8'))
            label_value['lines'] = [dict(kind='frame', points=[[1, 1], [20, 1]], width=2)]
            labels.write_text(json.dumps(label_value), encoding='utf-8')
            value = json.loads(manifest.read_text(encoding='utf-8'))
            value['sheets'][0]['split'] = 'test'
            manifest.write_text(json.dumps(value), encoding='utf-8')
            before = {path: path.read_bytes() for path in [image, labels, manifest]}
            self.assertEqual(corpus.prepare_review_corpus(sources), manifest)
            self.assertTrue(all(path.read_bytes() == body for path, body in before.items()))

    def test_review_preparation_accepts_original_png_without_a_jpeg_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            sources=pathlib.Path(folder)/'sources';sources.mkdir()
            image=sources/'sheet.png';Image.new('RGB',(40,24),'white').save(image)
            metadata=dict(id='sheet',familyId='new-family',language='fas',script='Arabic',format='png',
                          url='https://example.org/map.png',license='CC0',rightsReviewed=True,
                          sha256=hashlib.sha256(image.read_bytes()).hexdigest())
            image.with_suffix('.source.json').write_text(json.dumps(metadata),encoding='utf-8')
            manifest=corpus.prepare_review_corpus(sources)
            self.assertEqual(json.loads(manifest.read_text())['sheets'][0]['image'],'sources/sheet.png')
            self.assertFalse(list(pathlib.Path(folder).rglob('*.jpg')))

    def test_review_preparation_checks_all_sources_before_writing_and_rejects_unsafe_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            sources, image, metadata = self.acquired_source(folder)
            sidecar = image.with_suffix('.source.json')
            for changes in [dict(id='../outside'), dict(rightsReviewed=False), dict(sha256='0' * 64)]:
                sidecar.write_text(json.dumps({**metadata, **changes}), encoding='utf-8')
                with self.assertRaises(ValueError):
                    corpus.prepare_review_corpus(sources)
                self.assertFalse((pathlib.Path(folder) / 'labels').exists())
                self.assertFalse((pathlib.Path(folder) / 'corpus.draft.json').exists())

    def test_later_invalid_source_does_not_leave_partially_prepared_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            sources, image, metadata = self.acquired_source(folder)
            second = sources / 'z-sheet.jpg'
            second.write_bytes(image.read_bytes())
            second.with_suffix('.source.json').write_text(json.dumps({**metadata, 'id': 'z-sheet', 'sha256': '0' * 64}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'hash changed'):
                corpus.prepare_review_corpus(sources)
            self.assertFalse((pathlib.Path(folder) / 'labels').exists())
            self.assertFalse((pathlib.Path(folder) / 'corpus.draft.json').exists())

    def test_review_preparation_preserves_mismatching_existing_labels_for_inspection(self):
        with tempfile.TemporaryDirectory() as folder:
            sources, _, _ = self.acquired_source(folder)
            manifest = corpus.prepare_review_corpus(sources)
            labels = pathlib.Path(folder) / 'labels/sheet.json'
            value = json.loads(labels.read_text(encoding='utf-8'))
            value['width'] += 1
            labels.write_text(json.dumps(value), encoding='utf-8')
            before = labels.read_bytes(), manifest.read_bytes()
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                corpus.prepare_review_corpus(sources)
            self.assertEqual((labels.read_bytes(), manifest.read_bytes()), before)

    def test_review_preparation_rejects_a_symlink_outside_the_corpus_root(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as other:
            sources, image, _ = self.acquired_source(folder)
            outside = pathlib.Path(other) / 'labels'
            outside.mkdir()
            link = pathlib.Path(folder) / 'labels'
            if os.name == 'nt':
                subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
                                'New-Item -ItemType Junction -Path $env:PANDO_TEST_LINK -Target $env:PANDO_TEST_TARGET | Out-Null'],
                               env={**os.environ, 'PANDO_TEST_LINK': str(link), 'PANDO_TEST_TARGET': str(outside)}, check=True)
            else:
                link.symlink_to(outside, target_is_directory=True)
            try:
                with self.assertRaisesRegex(ValueError, 'escape'):
                    corpus.prepare_review_corpus(sources)
                self.assertEqual(list(outside.iterdir()), [])
            finally:
                if os.name == 'nt':
                    link.rmdir()
                else:
                    link.unlink()


if __name__ == "__main__":
    unittest.main()
