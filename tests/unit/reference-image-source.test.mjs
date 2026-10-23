import assert from 'node:assert/strict';
import test from 'node:test';
import { Blob } from 'node:buffer';
import { normalizeReferenceImageRecord, referenceImageMappingSignature, serializeReferenceImageRecord } from '../../assets/js/modules/reference-image-model.js';
import * as source from '../../assets/js/modules/reference-image-source.js';

test('source rectangles survive current serialization and invalidate mapping identity', () => {
  const blob = new Blob(['one original']);
  const rect = { x: 100, y: 50, width: 200, height: 150 };
  const record = normalizeReferenceImageRecord({ id: 'inset', blob, sourceRect: rect });
  assert.deepEqual(record.sourceRect, rect);assert.equal(record.blob, blob);
  assert.deepEqual(serializeReferenceImageRecord(record, 0).sourceRect, rect);
  assert.notEqual(referenceImageMappingSignature(record), referenceImageMappingSignature({ ...record, sourceRect: null }));
  assert.throws(() => normalizeReferenceImageRecord({ sourceRect: { ...rect, x: -1 } }), /source|rect/i);
});

test('crop pixel coordinates map reversibly to the shared original and reject out of bounds', () => {
  assert.equal(typeof source.referenceImageSourceRect, 'function');
  const rect = source.referenceImageSourceRect({ x: 100, y: 50, width: 200, height: 150 }, 800, 600);
  assert.deepEqual(source.referenceImageOriginalPixel([0.5, 0.2], rect), [200, 80]);
  assert.deepEqual(source.referenceImageSourceUv([200, 80], rect), [0.5, 0.2]);
  assert.throws(() => source.referenceImageSourceRect({ ...rect, width: 800 }, 800, 600), /source|rect/i);
});

test('worker bitmap cropping closes its full-source decode and uses original pixel bounds', async t => {
  const calls = [], full = { width: 800, height: 600, close() { calls.push('closed'); } }, crop = { width: 200, height: 150, close() {} };
  const createBitmap = async (...args) => { calls.push(args);return args.length === 1 ? full : crop; };
  const blob = new Blob(['image']);
  assert.equal(await source.createReferenceImageBitmap(blob, { x: 100, y: 50, width: 200, height: 150 }, { createBitmap }), crop);
  assert.deepEqual(calls[1], [full, 100, 50, 200, 150]);assert.equal(calls[2], 'closed');
});
