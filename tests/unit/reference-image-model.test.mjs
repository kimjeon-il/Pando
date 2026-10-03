import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneReferenceImageRecord,
  migrateReferenceImageStoredRecord,
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

test('legacy v1 screen placement migrates to canonical v5 mapQuad without retaining retired fields', () => {
  const migrated = migrateReferenceImageStoredRecord({
    id: 'legacy-v1',
    name: 'legacy',
    screenRect: { x: 10, y: 20, width: 100, height: 80 },
    rotation: 25,
    opacity: 0.7,
  }, { legacyMapQuad: quad });
  assert.equal(migrated.sourceVersion, 1);
  assert.equal(migrated.targetVersion, REFERENCE_IMAGE_MODEL_VERSION);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.needsPlacementMigration, false);
  assert.deepEqual(migrated.record.mapQuad, quad);
  assert.equal(migrated.record.cornerPinEnabled, false);

  const serialized = serializeReferenceImageRecord(migrated.record, 0);
  assert.equal(serialized.modelVersion, REFERENCE_IMAGE_MODEL_VERSION);
  assert.equal('screenRect' in serialized, false);
  assert.equal('rotation' in serialized, false);
});

test('legacy v1 placement that cannot be projected is flagged instead of silently resetting position', () => {
  const migrated = migrateReferenceImageStoredRecord({
    id: 'legacy-unprojectable',
    screenRect: { x: 10, y: 20, width: 100, height: 80 },
    rotation: 0,
  });
  assert.equal(migrated.sourceVersion, 1);
  assert.equal(migrated.needsPlacementMigration, true);
  assert.equal(migrated.record.mapQuad, null);
});

test('intermediate v2-v4 records normalize to v5 while preserving available calibration data', () => {
  const v2 = migrateReferenceImageStoredRecord({
    modelVersion: 2,
    id: 'v2',
    mapQuad: quad,
    controlPoints: [{ id: 'p2', image: [0.2, 0.3], coordinate: [12, 14] }],
  });
  assert.equal(v2.sourceVersion, 2);
  assert.equal(v2.record.cornerPinEnabled, false);
  assert.equal(v2.record.controlPoints.length, 1);

  const v3 = migrateReferenceImageStoredRecord({
    modelVersion: 3,
    id: 'v3',
    mapQuad: quad,
    anchor: { image: [0.5, 0.5], coordinate: [15, 15] },
  });
  assert.equal(v3.sourceVersion, 3);
  assert.deepEqual(v3.record.anchor, { image: [0.5, 0.5], coordinate: [15, 15] });

  const v4 = migrateReferenceImageStoredRecord({
    modelVersion: 4,
    id: 'v4',
    mapQuad: quad,
    anchor: { image: [0.5, 0.5], coordinate: [15, 15] },
    controlPoints: [{ id: 'p4', image: [0.2, 0.3], coordinate: [12, 14] }],
  });
  assert.equal(v4.sourceVersion, 4);
  assert.deepEqual(v4.record.anchor, { image: [0.5, 0.5], coordinate: [15, 15] });
  assert.equal(v4.record.controlPoints.length, 1);
});

test('current v5 stored record is idempotent and does not require migration', () => {
  const current = serializeReferenceImageRecord(normalizeReferenceImageRecord({
    id: 'v5',
    mapQuad: quad,
    cornerPinEnabled: true,
    anchor: { image: [0.5, 0.5], coordinate: [15, 15] },
    controlPoints: [{ id: 'p', image: [0.2, 0.3], coordinate: [12, 14] }],
  }), 0);
  const migrated = migrateReferenceImageStoredRecord(current);
  assert.equal(migrated.sourceVersion, REFERENCE_IMAGE_MODEL_VERSION);
  assert.equal(migrated.migrated, false);
  assert.deepEqual(serializeReferenceImageRecord(migrated.record, 0), current);
});

test('future record versions are preserved for a newer client instead of downgraded', () => {
  const future = migrateReferenceImageStoredRecord({
    modelVersion: REFERENCE_IMAGE_MODEL_VERSION + 1,
    id: 'future',
    mapQuad: quad,
    futureOnlyField: { preserve: true },
  });
  assert.equal(future.sourceVersion, REFERENCE_IMAGE_MODEL_VERSION + 1);
  assert.equal(future.unsupportedFutureVersion, true);
  assert.equal(future.migrated, false);
  assert.equal(future.record, null);
});

test('corner pin flag is disabled when a legacy record lacks a valid mapQuad', () => {
  const migrated = migrateReferenceImageStoredRecord({
    modelVersion: 5,
    id: 'invalid-corner-pin',
    cornerPinEnabled: true,
    mapQuad: null,
  });
  assert.equal(migrated.record.cornerPinEnabled, false);
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
