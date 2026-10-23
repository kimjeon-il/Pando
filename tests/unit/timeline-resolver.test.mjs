import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { restoreTimelineStorage } from '../../assets/js/modules/timeline-storage.js';
import { initialTimelineMonth, resolveWorld, resolvedTimelineViews } from '../../assets/js/modules/timeline-resolver.js';
import { sphericalCore } from '../helpers/spherical-core.mjs';

const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
const catalog = project.territorialEntities.map(feature => ({ id: feature.id, entityKind: feature.properties.entityKind }));
const storage = restoreTimelineStorage({ schemaVersion: 1, records: project.timelineRecords,
  geometries: project.geometries }, catalog);
const resolve = month => resolveWorld(project.territorialEntities, storage.records, storage.geometries, month);

test('month-end resolution selects exact geometry versions and parent graph', () => {
  const june = resolve('1914-06');
  const july = resolve('1914-07');
  const later = resolve('1916-01');
  assert.equal(july.month, '1914-07');
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

test('month-end resolution includes exact starts and excludes exact mid-month ends', () => {
  assert.ok(resolve('1910-01').byId.get('B'));

  const ended = structuredClone(project.timelineRecords);
  ended.lifetimes.find(row => row.id === 'B:modern').validTo = '1910-01-15';
  ended.geometryBindings.find(row => row.id === 'B:modern-shape').validTo = '1910-01-15';
  ended.parentRelations.find(row => row.id === 'B:old-parent').validTo = '1910-01-15';
  // A shortened lifetime cannot retain a later parent record outside that lifetime.
  ended.parentRelations = ended.parentRelations.filter(row => row.id !== 'B:new-parent');
  const endedStorage = restoreTimelineStorage({ schemaVersion: 1, records: ended,
    geometries: project.geometries }, catalog);
  const january = resolveWorld(project.territorialEntities, endedStorage.records, endedStorage.geometries, '1910-01');
  assert.equal(january.byId.get('B'), undefined);
});

test('initial month uses the latest explicit record start and static fallback', () => {
  assert.equal(initialTimelineMonth(storage.records, '2026-10'), '1916-01');
  assert.equal(initialTimelineMonth({ schemaVersion: 2, propertyBindings: [], lifetimes: [{ id: 'life:A', entityId: 'A', validFrom: null, validTo: null }], geometryBindings: [], parentRelations: [] }, '2026-10'), '2026-10');
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

test('scattered timeline rows retain catalog order, exact values, ancestry and validation failures', () => {
  const ids = ['__proto__', 'constructor', '국가:😀', ...Array.from({ length: 37 }, (_, index) => `entity:${index}`)];
  const entities = ids.map(id => ({ id, entityKind: 'general' })).reverse();
  const records = { schemaVersion: 2, lifetimes: [], geometryBindings: [], parentRelations: [], propertyBindings: [] };
  for (const [index, entityId] of ids.entries()) {
    records.lifetimes.push({ id: `life:${index}`, entityId, validFrom: '1910', validTo: '1915' });
    for (let year = 1910; year <= 1915; year++) {
      const common = { entityId, validFrom: String(year), validTo: String(year) };
      records.geometryBindings.push({ ...common, id: `geometry:${index}:${year}`, geometryRef: { id: 'shape', version: year - 1909 } });
      records.parentRelations.push({ ...common, id: `parent:${index}:${year}`, parentId: index ? ids[Math.floor((index - 1) / 3)] : '', coverageMode: 'explicit' });
      records.propertyBindings.push({ ...common, id: `name:${index}:${year}`, property: 'name', value: { name: `${entityId}:${year}`, nameExplicit: year % 2 === 0 } });
    }
  }
  // Row tables have different orders and do not match catalog order.
  records.geometryBindings.reverse();
  records.propertyBindings.reverse();
  const before = JSON.stringify(records), visits = [];
  const context = { entities, geometryExists: ref => { visits.push(ref.version); return true; } };
  for (const month of ['1909-12', '1910-01', '1912-07', '1915-12', '1916-01']) {
    visits.length = 0;
    const world = sphericalCore.timelineResolveWorld(records, context, month);
    assert.equal(world.month, month);
    assert.deepEqual(visits, records.geometryBindings.map(row => row.geometryRef.version), 'all geometry validation retains row order');
    const year = Number(month.slice(0, 4));
    assert.deepEqual(world.entities.map(row => row.id), year < 1910 || year > 1915 ? [] : entities.map(row => row.id));
    for (const row of world.entities) {
      const ancestors = [];
      let index = ids.indexOf(row.id);
      while (index) { index = Math.floor((index - 1) / 3); ancestors.push(ids[index]); }
      assert.deepEqual(row.ancestors, ancestors);
      assert.equal(row.rootId, ids[0]);
      assert.deepEqual(row.geometryRef, { id: 'shape', version: year - 1909 });
      assert.deepEqual(row.properties, { name: { name: `${row.id}:${year}`, nameExplicit: year % 2 === 0 } });
    }
    assert.equal(JSON.stringify(records), before);
  }
  const failure = new Error('repository sentinel');
  assert.throws(() => sphericalCore.timelineResolveWorld(records, { entities, geometryExists() { throw failure; } }, '1912-01'), error => error === failure);
  const duplicate = structuredClone(records);
  duplicate.lifetimes.push({ ...duplicate.lifetimes[0], id: 'overlap' });
  assert.throws(() => sphericalCore.timelineResolveWorld(duplicate, context, '1912-01'), { code: 'TIMELINE_OVERLAP' });
  assert.equal(JSON.stringify(records), before);
});
