import assert from 'node:assert/strict';
import test from 'node:test';
import * as catalog from '../../plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs';
const { referenceOcrLanguagesForScript, referenceOcrBlocks, referenceOcrOriginalBox, REFERENCE_OCR_LANGUAGES }=catalog;

test('strong English recognition corrects the observed weak Cyrillic script decision without rewriting OSD evidence',()=>{
  const observed={script:'Cyrillic',scriptConfidence:3.000000476837158,confidence:5.092620849609375,clockwiseDegrees:0};
  const before=structuredClone(observed);
  const plan=catalog.referenceOcrRecognitionPlan(observed,[{language:'eng',angle:0,score:317.97},{language:'rus',angle:0,score:37.17}]);
  assert.deepEqual(plan.languages,['eng']);assert.equal(plan.clockwiseDegrees,0);
  assert.equal(plan.reason,'recognition-probe-overrides-weak-script');assert.deepEqual(observed,before);
});
test('explicit languages and strong non-Latin evidence survive Latin legend text',()=>{
  const observed={script:'Arabic',scriptConfidence:12,clockwiseDegrees:0};
  const probes=[{language:'eng',angle:90,score:100},{language:'ara',angle:0,score:180}];
  assert.deepEqual(catalog.referenceOcrRecognitionPlan(observed,probes).languages,['ara','fas','urd']);
  assert.equal(catalog.referenceOcrRecognitionPlan(observed,probes).clockwiseDegrees,0);
  assert.deepEqual(catalog.referenceOcrRecognitionPlan(observed,probes,['fas','urd']).languages,['fas','urd']);
  assert.throws(()=>catalog.referenceOcrRecognitionPlan(observed,probes,['unavailable']),/language/i);
});
test('unknown scripts and inconclusive probes keep a bounded recognizer and do not execute every pack',()=>{
  assert.deepEqual(referenceOcrLanguagesForScript('Unknown'),['eng']);
  const plan=catalog.referenceOcrRecognitionPlan({script:'Unknown',clockwiseDegrees:270},[{language:'eng',angle:0,score:NaN}]);
  assert.deepEqual(plan.languages,['eng']);assert.equal(plan.clockwiseDegrees,270);
  const weak=catalog.referenceOcrRecognitionPlan({script:'Cyrillic',scriptConfidence:3},[{language:'eng',angle:0,score:19},{language:'rus',angle:0,score:5}]);
  assert.deepEqual(weak.languages,['rus','ukr']);
});

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
