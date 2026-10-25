import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceOcrLanguagesForScript, referenceOcrBlocks, referenceOcrOriginalBox, REFERENCE_OCR_LANGUAGES } from '../../plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs';

test('Greek script includes separate modern and ancient Greek recognition models', () => {
  assert.deepEqual(referenceOcrLanguagesForScript('Greek'), ['ell', 'grc']);
});

test('recommended historical and regional packs are routed by script instead of loading every script', () => {
  for (const code of ['lat', 'deu_latf', 'rus', 'ukr', 'jpn_vert', 'chi_tra_vert', 'heb', 'hye', 'kat', 'hin', 'ben']) assert.ok(REFERENCE_OCR_LANGUAGES.includes(code), code);
  assert.deepEqual(referenceOcrLanguagesForScript('Cyrillic'), ['rus', 'ukr']);
  assert.deepEqual(referenceOcrLanguagesForScript('Hebrew'), ['heb']);
  assert.deepEqual(referenceOcrLanguagesForScript('Armenian'), ['hye']);
  assert.deepEqual(referenceOcrLanguagesForScript('Georgian'), ['kat']);
  assert.deepEqual(referenceOcrLanguagesForScript('Devanagari'), ['hin']);
  assert.deepEqual(referenceOcrLanguagesForScript('Bengali'), ['ben']);
});

test('Tesseract line normalization keeps empty or malformed boxes out of GCP proposals', () => {
  assert.deepEqual(referenceOcrBlocks({ blocks: [{ paragraphs: [{ lines: [{ text: '  ', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }, { text: 'Ribe', bbox: { x0: 5, y0: 3, x1: 4, y1: 9 } }] }] }] }), []);
});

test('Arabic script retains separate Arabic Persian and Urdu recognition packs',()=>{assert.deepEqual(referenceOcrLanguagesForScript('Arabic'),['ara','fas','urd']);});

test('clockwise OCR boxes are restored to original pixel axes',()=>{const box={x:2,y:3,width:5,height:7};assert.deepEqual(referenceOcrOriginalBox(box,20,30,90),{x:3,y:23,width:7,height:5});assert.deepEqual(referenceOcrOriginalBox(box,20,30,180),{x:13,y:20,width:5,height:7});assert.deepEqual(referenceOcrOriginalBox(box,20,30,270),{x:10,y:2,width:7,height:5});});
