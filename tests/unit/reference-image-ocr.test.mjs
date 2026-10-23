import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectReferenceImageText,
  normalizeReferenceImageOcrBlocks,
  referenceImageOcrAvailability,
} from '../../assets/js/modules/reference-image-ocr.js';

test('OCR block normalization turns detector boxes into normalized image points', () => {
  const detections = normalizeReferenceImageOcrBlocks([
    { rawValue: 'Berlin', boundingBox: { x: 100, y: 40, width: 80, height: 20 } },
    { rawValue: 'Prag\nWien', boundingBox: { x: 300, y: 100, width: 120, height: 30 }, confidence: 0.8 },
  ], { width: 500, height: 250 });
  assert.equal(detections.length, 3);
  assert.equal(detections[0].text, 'Berlin');
  assert.deepEqual(detections[0].image, [0.28, 0.2]);
  assert.equal(detections[1].text, 'Prag');
  assert.equal(detections[2].text, 'Wien');
  assert.equal(detections[1].confidence, 0.8);
});

test('OCR preserves original Arabic presentation characters separately from searchable text', () => {
  const original = '\ufefb تهران ۱۲۳';
  const [row] = normalizeReferenceImageOcrBlocks([{ rawValue: original, boundingBox: { x: 1, y: 1, width: 8, height: 4 } }], { width: 10, height: 10 });
  assert.equal(row.originalText, original);
  assert.notEqual(row.text, original);
});

test('OCR deduplicates all language passes before capping, retaining later source tiles', () => {
  const left = Array.from({ length: 30 }, (_, i) => ({ rawValue: 'City ' + i, boundingBox: { x: 20 + i % 5 * 35, y: 20 + Math.floor(i / 5) * 30, width: 30, height: 12 }, confidence: .7 }));
  const right = left.map((row, i) => ({ ...row, rawValue: 'Later ' + i, boundingBox: { ...row.boundingBox, x: row.boundingBox.x + 700 } }));
  const rows = [...Array.from({ length: 9 }, () => left).flat(), ...right];
  const result = normalizeReferenceImageOcrBlocks(rows, { width: 1000, height: 1000, maximumDetections: 256 });
  assert.equal(result.length, 60);
  assert.equal(result.filter(row => row.text.startsWith('Later')).length, 30);
  const limited = normalizeReferenceImageOcrBlocks(rows, { width: 1000, height: 1000, maximumDetections: 12 });
  assert.equal(limited.length, 12);
  assert.ok(limited.filter(row => row.text.startsWith('Later')).length >= 4, 'the cap must retain spatially separated labels');
});

test('overlap deduplication preserves the strongest original text and separate distant names', () => {
  const box = { x: 10, y: 10, width: 30, height: 12 };
  const result = normalizeReferenceImageOcrBlocks([
    { rawValue: 'Athens', confidence: .5, boundingBox: box },
    { rawValue: 'ATHENS', confidence: .9, boundingBox: { ...box, x: 11 } },
    { rawValue: 'Athens', confidence: .8, boundingBox: { ...box, x: 500 } },
  ], { width: 1000, height: 1000 });
  assert.equal(result.length, 2);
  assert.equal(result[0].originalText, 'ATHENS');
  assert.equal(result[0].confidence, .9);
});

test('OCR runner accepts an injected detector and canvas provider', async () => {
  const image = { naturalWidth: 1000, naturalHeight: 500 };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
  };
  const result = await detectReferenceImageText(image, {
    languages: ['eng'],
    maxDimension: 500,
    canvasFactory: (width, height) => {
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    detectorFactory: async languages => ({
      detect: async input => {
        assert.equal(input, canvas);
        assert.ok(languages.includes('eng'));
        return [{ rawValue: 'München', boundingBox: { x: 100, y: 80, width: 90, height: 24 } }];
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.width, 500);
  assert.equal(result.height, 250);
  assert.equal(result.detections[0].text, 'München');
});

test('OCR availability reports a missing offline runtime without throwing', async () => {
  const result = await referenceImageOcrAvailability({ fetchManifest: async () => { throw new Error('missing asset'); } });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'ocr-runtime-unavailable');
});
