import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceTimelineRecordAtMonth, truncateTimelineEntityAtMonth } from '../../assets/js/modules/timeline-edit.js';
import { normalizeTimelineRecords } from '../../assets/js/modules/timeline-records.js';

const records = { schemaVersion: 1, lifetimes: [], geometryBindings: [
  { id: 'A:original', entityId: 'A', validFrom: '1914-06-15', validTo: '1915-12', geometryRef: { id: 'shape', version: 1 } },
  { id: 'A:future', entityId: 'A', validFrom: '1916', validTo: null, geometryRef: { id: 'shape', version: 3 } },
], parentRelations: [] };

test('dated geometry replacement retains exact original start and later versions', () => {
  const result = replaceTimelineRecordAtMonth(records, 'geometryBindings', 'A', '1914-07',
    { geometryRef: { id: 'shape', version: 2 } });
  assert.deepEqual(result.geometryBindings, [
    { ...records.geometryBindings[0], validTo: '1914-06' },
    { ...records.geometryBindings[0], id: 'A:original:1914-07', validFrom: '1914-07', geometryRef: { id: 'shape', version: 2 } },
    records.geometryBindings[1],
  ]);
  assert.deepEqual(records.geometryBindings[0].validTo, '1915-12');
});

test('month split preserves a later exact-date endpoint verbatim', () => {
  const source = { ...records, geometryBindings: [
    { ...records.geometryBindings[0], validTo: '1915-12-24' },
    records.geometryBindings[1],
  ] };
  const result = replaceTimelineRecordAtMonth(source, 'geometryBindings', 'A', '1914-07',
    { geometryRef: { id: 'shape', version: 2 } });
  assert.equal(result.geometryBindings[0].validFrom, '1914-06-15');
  assert.equal(result.geometryBindings[0].validTo, '1914-06');
  assert.equal(result.geometryBindings[1].validFrom, '1914-07');
  assert.equal(result.geometryBindings[1].validTo, '1915-12-24');
});

test('same-month replacement keeps its exact day and does not create overlap', () => {
  const result = replaceTimelineRecordAtMonth(records, 'geometryBindings', 'A', '1914-06',
    { geometryRef: { id: 'shape', version: 2 } });
  assert.equal(result.geometryBindings.length, 2);
  assert.equal(result.geometryBindings[0].validFrom, '1914-06-15');
  assert.equal(result.geometryBindings[0].geometryRef.version, 2);
});

test('parent change splits only its own slot and can be validated as one candidate', () => {
  const source = { schemaVersion: 1,
    lifetimes: ['A', 'B', 'C'].map(id => ({ id: `life:${id}`, entityId: id, validFrom: null, validTo: null })),
    geometryBindings: ['A', 'B', 'C'].map(id => ({ id: `shape:${id}`, entityId: id, validFrom: null, validTo: null,
      geometryRef: { id: `shape:${id}`, version: 1 } })),
    parentRelations: ['A', 'C'].map(id => ({ id: `parent:${id}`, entityId: id, validFrom: null, validTo: null,
      parentId: '', coverageMode: 'explicit' })).concat({ id: 'parent:B', entityId: 'B', validFrom: null,
      validTo: null, parentId: 'A', coverageMode: 'partition' }),
  };
  const changed = replaceTimelineRecordAtMonth(source, 'parentRelations', 'B', '1914-07',
    { parentId: 'C', coverageMode: 'explicit' });
  normalizeTimelineRecords(changed, { entities: ['A', 'B', 'C'].map(id => ({ id, entityKind: 'general' })),
    geometryExists: () => true });
  assert.equal(changed.parentRelations.find(row => row.id === 'parent:B').validTo, '1914-06');
  assert.equal(changed.parentRelations.find(row => row.id === 'parent:B:1914-07').parentId, 'C');
  assert.deepEqual(changed.geometryBindings, source.geometryBindings);
});

test('ending an entity removes future records but preserves earlier month coverage', () => {
  const source = { schemaVersion: 1,
    lifetimes: [{ id: 'life:A', entityId: 'A', validFrom: null, validTo: null }],
    geometryBindings: [
      { id: 'shape:A:old', entityId: 'A', validFrom: null, validTo: '1914-06', geometryRef: { id: 'shape', version: 1 } },
      { id: 'shape:A:new', entityId: 'A', validFrom: '1914-07', validTo: null, geometryRef: { id: 'shape', version: 2 } },
    ],
    parentRelations: [{ id: 'parent:A', entityId: 'A', validFrom: null, validTo: null,
      parentId: '', coverageMode: 'explicit' }],
  };
  const ended = truncateTimelineEntityAtMonth(source, 'A', '1914-07');
  assert.equal(ended.lifetimes[0].validTo, '1914-06');
  assert.deepEqual(ended.geometryBindings.map(row => row.id), ['shape:A:old']);
  assert.equal(ended.parentRelations[0].validTo, '1914-06');
  assert.equal(source.lifetimes[0].validTo, null);
});
