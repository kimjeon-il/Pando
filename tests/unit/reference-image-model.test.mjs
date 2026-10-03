import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneReferenceImageRecord,
  normalizeReferenceImageAnchor,
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
  assert.equal(REFERENCE_IMAGE_MODEL_VERSION, 5);
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

test('manual anchor is normalized, serialized and can coexist with GCPs', () => {
  const anchor = normalizeReferenceImageAnchor({ image: [0.25, 0.5], coordinate: [15, 18] });
  assert.deepEqual(anchor, { image: [0.25, 0.5], coordinate: [15, 18] });
  assert.equal(normalizeReferenceImageAnchor({ image: [2, 0], coordinate: [15, 18] }), null);

  const withGcp = normalizeReferenceImageRecord({
    id: 'ref-gcp',
    mapQuad: quad,
    anchor,
    controlPoints: [{ id: 'p', image: [0.2, 0.3], coordinate: [12, 34] }],
  });
  assert.deepEqual(withGcp.anchor, anchor);
  assert.equal(withGcp.controlPoints.length, 1);

  const serialized = serializeReferenceImageRecord(withGcp, 0);
  assert.deepEqual(serialized.anchor, anchor);
  assert.equal(serialized.controlPoints.length, 1);
});

test('corner pin mode is normalized and serialized with the reference image', () => {
  const record = normalizeReferenceImageRecord({
    id: 'ref-corner-pin',
    mapQuad: quad,
    cornerPinEnabled: true,
    anchor: { image: [0.5, 0.5], coordinate: [15, 15] },
    controlPoints: [{ id: 'p', image: [0.2, 0.3], coordinate: [12, 14] }],
  });
  assert.equal(record.cornerPinEnabled, true);
  const serialized = serializeReferenceImageRecord(record, 0);
  assert.equal(serialized.cornerPinEnabled, true);
  assert.deepEqual(serialized.anchor, record.anchor);
  assert.equal(serialized.controlPoints.length, 1);
});

test('history clones geographic placement, anchor and GCP arrays instead of sharing them', () => {
  const gcpRecord = normalizeReferenceImageRecord({
    id: 'ref-a',
    mapQuad: quad,
    controlPoints: [{ id: 'p', image: [0.2, 0.3], coordinate: [12, 34] }],
  });
  const gcpCopy = cloneReferenceImageRecord(gcpRecord);
  gcpCopy.mapQuad[0][0] = 99;
  gcpCopy.controlPoints[0].coordinate[0] = 88;
  assert.equal(gcpRecord.mapQuad[0][0], 10);
  assert.equal(gcpRecord.controlPoints[0].coordinate[0], 12);

  const anchored = normalizeReferenceImageRecord({
    id: 'ref-anchor',
    mapQuad: quad,
    anchor: { image: [0.25, 0.5], coordinate: [15, 18] },
  });
  const anchorCopy = cloneReferenceImageRecord(anchored);
  anchorCopy.anchor.coordinate[0] = 77;
  assert.equal(anchored.anchor.coordinate[0], 15);
});
