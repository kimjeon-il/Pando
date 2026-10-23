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
from macro import fill_adjacency_supervision, stroke_matches, prepare
from corpus import validate_corpus


class MacroSupervisionTests(unittest.TestCase):
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
            with self.assertRaisesRegex(ValueError, 'Human-reviewed'):
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
