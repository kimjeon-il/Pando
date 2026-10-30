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

if __name__ == "__main__":
    unittest.main()
