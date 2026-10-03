import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneReferenceImageRecord,
  normalizeReferenceImageMapQuad,
  normalizeReferenceImageRecord,
  REFERENCE_IMAGE_MODEL_VERSION,
  serializeReferenceImageRecord,
} from '../../assets/js/modules/reference-image-model.js';

const quad = [
  [10, 20],
  [20, 20],
  [20, 10],
  [10, 10],
];

test('reference image model normalizes one canonical geographic placement quad', () => {
  assert.equal(REFERENCE_IMAGE_MODEL_VERSION, 2);
  assert.deepEqual(normalizeReferenceImageMapQuad(quad), quad);
  assert.equal(normalizeReferenceImageMapQuad([[0, 0]]), null);
  const record = normalizeReferenceImageRecord({
    id: 'ref-a',
    name: 'map',
    opacity: 2,
    blendMode: 'difference',
    mapQuad: quad,
  });
  assert.equal(record.opacity, 1);
  assert.equal(record.blendMode, 'difference');
  assert.deepEqual(record.mapQuad, quad);
});

test('serialization persists mapQuad and drops retired screen placement fields', () => {
  const record = normalizeReferenceImageRecord({
    id: 'ref-a',
    name: 'map',
    mapQuad: quad,
    screenRect: { x: 1, y: 2, width: 3, height: 4 },
    rotation: 35,
  });
  const value = serializeReferenceImageRecord(record, 3);
  assert.deepEqual(value.mapQuad, quad);
  assert.equal(value.order, 3);
  assert.equal('screenRect' in value, false);
  assert.equal('rotation' in value, false);
});

test('history clones geographic placement and GCP arrays instead of sharing them', () => {
  const record = normalizeReferenceImageRecord({
    id: 'ref-a',
    mapQuad: quad,
    controlPoints: [{ id: 'p', image: [0.2, 0.3], coordinate: [12, 34] }],
  });
  const copy = cloneReferenceImageRecord(record);
  copy.mapQuad[0][0] = 99;
  copy.controlPoints[0].coordinate[0] = 88;
  assert.equal(record.mapQuad[0][0], 10);
  assert.equal(record.controlPoints[0].coordinate[0], 12);
});
