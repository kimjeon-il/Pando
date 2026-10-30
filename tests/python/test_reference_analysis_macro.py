"""Macro source mechanics use fixtures only; fixtures are never training data."""
import pathlib
import sys
import unittest
import tempfile
import json
import hashlib
import numpy as np
import pymupdf
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools/reference-analysis'))
from macro import fill_adjacency_supervision, stroke_matches, prepare, prepare_corpus, derive
from corpus import validate_corpus


class MacroSupervisionTests(unittest.TestCase):
    def test_rotated_pdf_aligns_visible_strokes_and_text_without_changing_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            metadata = dict(geographicScope='country', scopeEvidence='fixture only',
                            materialKind='published-macro-pdf', rightsReviewed=True,
                            license='fixture only; never training data', supervision=dict(
                                strategy='boundary-stroke-signatures', channels=dict(administrative=[
                                    dict(color=[0., 0., 0.], width=2., dashes=[])])))
            with pymupdf.open() as doc:
                page = doc.new_page(width=160, height=100)
                page.draw_line((40, 12), (40, 88), color=(0, 0, 0), width=2)
                page.insert_text((25, 51), 'Town', fontsize=13)
                base = root / 'base.pdf'
                doc.save(base)
            image, target, valid, _ = derive(base, metadata, 160)
            self.assertTrue((target & 2).any())
            self.assertFalse(valid[42:50, 38:42].all(), 'Glyphs must exclude supervision')
            for rotation in (90, 180, 270):
                with self.subTest(rotation=rotation):
                    path = root / f'rotation-{rotation}.pdf'
                    with pymupdf.open(base) as doc:
                        doc[0].set_rotation(rotation)
                        doc.save(path)
                    original = path.read_bytes()
                    actual = derive(path, metadata, 160)
                    for expected, received in zip((image, target, valid), actual[:3]):
                        np.testing.assert_array_equal(received, np.rot90(expected, -rotation // 90))
                    excluded = derive(path, {**metadata, 'excludedRegionsNormalized': [[0, 0, 1, .125]]}, 160)
                    edge = int(np.ceil(excluded[1].shape[0] / 8))
                    self.assertFalse(excluded[1][:edge].any())
                    self.assertFalse(excluded[2][:edge].any())
                    np.testing.assert_array_equal(excluded[1][edge:], actual[1][edge:])
                    np.testing.assert_array_equal(excluded[2][edge:], actual[2][edge:])
                    self.assertEqual(path.read_bytes(), original)

    def test_alternate_metadata_reuses_source_image_and_keeps_original_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            sources = root / 'sources'
            sources.mkdir()
            source = self.fixture(sources)
            original = prepare_corpus(sources, 160)
            before = {path.relative_to(root): path.read_bytes() for path in root.rglob('*') if path.is_file()}
            recipes = root / 'recipes/seams'
            recipes.mkdir(parents=True)
            metadata = json.loads(source.with_suffix('.source.json').read_text())
            metadata['id'] += '-seams'
            metadata['supervision']['radiusPixels'] = 4
            recipe = recipes / source.with_suffix('.source.json').name
            recipe.write_text(json.dumps(metadata), encoding='utf-8')
            expanded = prepare_corpus(sources, 160, 'corpus.seams.training.json', metadata_directory=recipes)
            old_sheet = json.loads(original.read_text())['sheets'][0]
            sheet = json.loads(expanded.read_text())['sheets'][0]
            self.assertEqual(sheet['image'], old_sheet['image'])
            self.assertNotEqual(sheet['annotations'], old_sheet['annotations'])
            self.assertEqual(sheet['duplicateGroup'], old_sheet['duplicateGroup'])
            annotation = json.loads((root / sheet['annotations']).read_text())
            self.assertEqual(annotation['sourcePdf'], source.relative_to(root).as_posix())
            self.assertEqual(annotation['sourceMetadata'], recipe.relative_to(root).as_posix())
            validate_corpus(json.loads(expanded.read_text()), root, training_only=True)
            self.assertEqual(prepare_corpus(sources, 160, expanded.name, metadata_directory=recipes), expanded)
            for path, contents in before.items():
                self.assertEqual((root / path).read_bytes(), contents, str(path))
            self.assertEqual(len(list((root / 'derived').glob('*.jpg'))), 1)
            metadata['duplicateGroup'] = 'invented-new-original'
            recipe.write_text(json.dumps(metadata), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'original identity'):
                prepare_corpus(sources, 160, 'corpus.bad.training.json', metadata_directory=recipes)
            recipe.write_text(json.dumps({**metadata, 'duplicateGroup': old_sheet['duplicateGroup']}), encoding='utf-8')
            (recipes / 'unknown.source.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Unmatched'):
                prepare_corpus(sources, 160, 'corpus.bad.training.json', metadata_directory=recipes)
            with self.assertRaisesRegex(ValueError, 'Contained metadata directory'):
                prepare_corpus(sources, 160, 'corpus.bad.training.json', metadata_directory=root.parent)

    def test_revised_exclusions_have_distinct_labels_and_preserve_consumed_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            sources = root / 'sources'
            sources.mkdir()
            source = self.fixture(sources)
            original = prepare_corpus(sources, 160)
            before = {path.relative_to(root): path.read_bytes() for path in root.rglob('*') if path.is_file()}
            recipes = root / 'recipes/exclusions-r2'
            recipes.mkdir(parents=True)
            metadata = json.loads(source.with_suffix('.source.json').read_text())
            metadata['id'] += '-exclusions-r2'
            metadata['excludedRegionsNormalized'].append([.4, .3, .6, .7])
            recipe = recipes / source.with_suffix('.source.json').name
            recipe.write_text(json.dumps(metadata), encoding='utf-8')
            revised = prepare_corpus(sources, 160, 'corpus.exclusions-r2.json', metadata_directory=recipes)
            sheet = json.loads(revised.read_text())['sheets'][0]
            annotation = json.loads((root / sheet['annotations']).read_text())
            for field in ['raster', 'validRaster']:
                pixels = np.asarray(Image.open(root / annotation[field]['path']))
                self.assertFalse(pixels[36:84, 64:96].any(), field)
            self.assertEqual(sheet['image'], json.loads(original.read_text())['sheets'][0]['image'])
            for path, contents in before.items():
                self.assertEqual((root / path).read_bytes(), contents, str(path))
            validate_corpus(json.loads(revised.read_text()), root, training_only=True)

    def test_expanded_manifest_preserves_original_and_rejects_output_escape(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            sources = root / 'sources'
            sources.mkdir()
            source = self.fixture(sources)
            first = prepare_corpus(sources, 160)
            original = first.read_bytes()
            second = sources / 'second.pdf'
            second.write_bytes(source.read_bytes())
            metadata = json.loads(source.with_suffix('.source.json').read_text())
            metadata['id'] = 'macro-fixture-second'
            second.with_suffix('.source.json').write_text(json.dumps(metadata), encoding='utf-8')
            expanded = prepare_corpus(sources, 160, 'corpus.conditions.training.json')
            self.assertEqual(len(json.loads(expanded.read_text())['sheets']), 2)
            self.assertEqual(first.read_bytes(), original)
            self.assertEqual(prepare_corpus(sources, 160, expanded.name).read_bytes(), expanded.read_bytes())
            recorded = json.loads(expanded.read_text())
            recorded['sheets'].reverse()
            expanded.write_bytes(json.dumps(recorded, separators=(',', ':')).encode())
            recorded_bytes = expanded.read_bytes()
            self.assertEqual(prepare_corpus(sources, 160, expanded.name).read_bytes(), recorded_bytes,
                             'Repreparation must preserve recorded training order and fingerprint bytes')
            with self.assertRaisesRegex(ValueError, 'Existing macro corpus differs'):
                prepare_corpus(sources, 160)
            for name in ['../escape.json', 'nested/corpus.json', 'bad..json', 'corpus.txt']:
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'manifest filename'):
                    prepare_corpus(sources, 160, name)
            self.assertFalse((root.parent / 'escape.json').exists())

    def test_reprepare_preserves_generator_provenance_but_not_changed_supervision(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = self.fixture(root)
            sheet = prepare(source, root, 160)
            path = root / sheet['annotations']
            annotation = json.loads(path.read_text())
            annotation['producer']['sha256'] = 'a' * 64
            path.write_bytes((json.dumps(annotation, indent=2) + '\n').encode())
            original = path.read_bytes()
            self.assertEqual(prepare(source, root, 160), sheet)
            self.assertEqual(path.read_bytes(), original)
            validate_corpus(dict(schemaVersion=1, trainingOnly=True, sheets=[sheet]), root, training_only=True)
            annotation['width'] += 1
            path.write_bytes((json.dumps(annotation, indent=2) + '\n').encode())
            changed = path.read_bytes()
            with self.assertRaisesRegex(ValueError, 'Existing macro evidence differs'):
                prepare(source, root, 160)
            self.assertEqual(path.read_bytes(), changed)

    def fixture(self, root):
        source = root / 'fixture.pdf'
        with pymupdf.open() as doc:
            page = doc.new_page(width=160, height=120)
            page.draw_rect((10, 10, 78, 110), color=None, fill=(.7, .5, .3))
            page.draw_rect((82, 10, 150, 110), color=None, fill=(.3, .5, .7))
            page.insert_text((70, 60), 'Town', fontsize=12)
            doc.save(source)
        metadata = dict(id='macro-fixture', format='pdf', familyId='fixture-family', editionId='fixture-edition', duplicateGroup='fixture',
                        geographicScope='world', scopeEvidence='fixture only', language='eng', script='Latin', mapKind='color',
                        materialKind='published-macro-pdf', rightsReviewed=True, license='fixture only; never training data',
                        url='https://example.test/map.pdf', sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                        supervision=dict(strategy='country-fill-adjacency', radiusPixels=3, countryFillColors=[[.7,.5,.3],[.3,.5,.7]]))
        metadata['excludedRegionsNormalized'] = [[.45, .75, .55, .95]]
        source.with_suffix('.source.json').write_text(json.dumps(metadata), encoding='utf-8')
        return source

    def test_macro_rasters_remain_training_only_and_forged_masks_fail_source_recomputation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            source = self.fixture(root)
            original = source.read_bytes()
            sheet = prepare(source, root, 160)
            corpus = dict(schemaVersion=1, trainingOnly=True, sheets=[sheet])
            validate_corpus(corpus, root, training_only=True)
            with self.assertRaisesRegex(ValueError, 'Source-reviewed independent corpus required; supplied corpus is training-only'):
                validate_corpus(corpus, root)
            annotation_path = root / sheet['annotations']
            annotation = json.loads(annotation_path.read_text())
            valid = np.asarray(Image.open(root / annotation['validRaster']['path']))
            self.assertFalse(valid[55:61, 78:82].any(), 'Publisher glyphs obscure border truth')
            self.assertFalse(valid[95:110, 78:82].any(), 'Explicit legend exclusions are not boundary truth')
            target = root / annotation['raster']['path']
            Image.fromarray(np.zeros((120,160),dtype=np.uint8)).save(target)
            annotation['raster']['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
            annotation_path.write_text(json.dumps(annotation), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'source supervision'):
                validate_corpus(corpus, root, training_only=True)
            self.assertEqual(source.read_bytes(), original)

    def test_colour_seams_are_positive_but_sea_and_obscured_gaps_are_unknown(self):
        labels = np.zeros((30, 50), dtype=np.uint8)
        labels[5:25, 5:24] = 1
        labels[5:25, 26:45] = 2
        target, valid = fill_adjacency_supervision(labels, radius=2)
        self.assertTrue(target[15, 25] & 1)
        self.assertTrue(valid[15, 25] & 1)
        self.assertFalse(valid[15, 4], 'Sea/land edge is not a negative border label')
        self.assertTrue(valid[15, 12] & 1, 'Clear country interior supplies negatives')
        self.assertFalse(target[15, 12])
        labels[5:25, 26:45] = 1
        target, valid = fill_adjacency_supervision(labels, radius=2)
        self.assertFalse(target.any(), 'Same-colour seam cannot establish a border')
        self.assertFalse(valid[15, 25], 'Unresolved white seam stays unknown')

    def test_source_stroke_signature_includes_dashes_width_and_colour(self):
        signature = dict(color=[.4, .5, .6], width=1., dashes=[5., 3.])
        drawing = dict(type='s', color=(.40001, .50001, .6), width=1., dashes='[ 5 3 ] 0')
        self.assertTrue(stroke_matches(drawing, signature))
        for key, value in [('dashes', '[] 0'), ('width', .5), ('color', (.1, .2, .3)), ('type', 'f')]:
            self.assertFalse(stroke_matches({**drawing, key: value}, signature))


if __name__ == '__main__':
    unittest.main()
