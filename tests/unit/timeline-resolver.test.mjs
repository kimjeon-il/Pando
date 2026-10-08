import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { restoreTimelineStorage } from '../../assets/js/modules/timeline-storage.js';
import { initialTimelineMonth, resolveWorld, resolvedTimelineViews } from '../../assets/js/modules/timeline-resolver.js';

const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
const catalog = project.territorialEntities.map(feature => ({ id: feature.id, entityKind: feature.properties.entityKind }));
const storage = restoreTimelineStorage({ schemaVersion: 1, records: project.timelineRecords,
  geometries: project.geometries }, catalog);
const resolve = month => resolveWorld(project.territorialEntities, storage.records, storage.geometries, month);

test('month-end resolution selects exact geometry versions and parent graph', () => {
  const june = resolve('1914-06');
  const july = resolve('1914-07');
  const later = resolve('1916-01');
  assert.deepEqual(june.entities.map(row => row.id), ['A', 'B', 'C', 'R']);
  assert.deepEqual(june.byId.get('A').geometryRef, { id: 'shape', version: 1 });
  assert.deepEqual(july.byId.get('A').geometryRef, { id: 'shape', version: 2 });
  assert.equal(july.byId.get('B').parentId, 'A');
  assert.equal(later.byId.get('B').parentId, 'C');
  assert.equal(later.byId.get('B').rootId, 'C');
  assert.deepEqual(later.byId.get('B').ancestors, ['C']);
  assert.equal(later.byId.set, undefined);
  assert.ok(Object.isFrozen(later.byId.get('B')));
  assert.throws(() => { later.byId.get('B').identity.properties.name = 'changed'; }, TypeError);
});

test('month-end resolution respects disjoint lifetimes and exact days', () => {
  assert.deepEqual(resolve('1909-12').entities.map(row => row.id), ['A', 'C', 'R']);
  assert.deepEqual(resolve('1910-01').entities.map(row => row.id), ['A', 'B', 'C', 'R']);
  assert.deepEqual(resolve('1920-04').entities.map(row => row.id), ['A', 'C', 'R']);
  assert.throws(() => resolve('1914-07-31'), /month/i);
});

test('initial month uses the latest explicit record start and static fallback', () => {
  assert.equal(initialTimelineMonth(storage.records, '2026-10'), '1916-01');
  assert.equal(initialTimelineMonth({ lifetimes: [{ validFrom: null }], geometryBindings: [], parentRelations: [] }, '2026-10'), '2026-10');
});

test('independent timeline golden months match effective identity, version and ancestry', () => {
  const golden = JSON.parse(readFileSync(new URL('../fixtures/portability/timeline-resolution.json', import.meta.url), 'utf8'));
  for (const row of golden.cases) {
    assert.deepEqual(resolve(row.month).entities.map(entity => [entity.id, entity.geometryRef.id,
      entity.geometryRef.version, entity.parentId, entity.rootId, entity.ancestors]), row.expected, row.month);
  }
});

test('materialized editor views contain only living features at the selected month', () => {
  const before = resolvedTimelineViews(project.territorialEntities, storage.records, storage.geometries, '1909-12');
  const after = resolvedTimelineViews(project.territorialEntities, storage.records, storage.geometries, '1916-01');
  assert.deepEqual(before.map(feature => feature.id), ['A', 'C', 'R']);
  assert.equal(after.find(feature => feature.id === 'B').properties.parentId, 'C');
  assert.deepEqual(after.find(feature => feature.id === 'A').geometry, storage.geometries.get({ id: 'shape', version: 2 }));
});
