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

test('OCR runner accepts an injected detector and canvas provider', async () => {
  const image = { naturalWidth: 1000, naturalHeight: 500 };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
  };
  const result = await detectReferenceImageText(image, {
    maxDimension: 500,
    canvasFactory: (width, height) => {
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    detectorFactory: async languages => ({
      detect: async input => {
        assert.equal(input, canvas);
        assert.ok(languages.includes('en'));
        return [{ rawValue: 'München', boundingBox: { x: 100, y: 80, width: 90, height: 24 } }];
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.width, 500);
  assert.equal(result.height, 250);
  assert.equal(result.detections[0].text, 'München');
});

test('OCR availability reports missing TextDetector without throwing', async () => {
  const result = await referenceImageOcrAvailability({ Detector: undefined });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'text-detector-unavailable');
});
