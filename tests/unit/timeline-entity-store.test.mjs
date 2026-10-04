import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createGeometryVersionStore } from '../../assets/js/modules/geometry-version-store.js';
import { snapshotTimelineStorage } from '../../assets/js/modules/timeline-storage.js';

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,2],[2,2],[2,0],[0,0]]] };
const emptyRecords = () => ({ schemaVersion: 1, lifetimes: [], geometryBindings: [], parentRelations: [] });
const feature = (id, options = {}) => createTerritorialFeature({ id, name: id, entityKind: 'general', geometry, ...options });
const owner = () => {
  const state = { territorialEntities: [], timelineRecords: emptyRecords(), geometries: createGeometryVersionStore() };
  return { state, store: createTerritorialEntityStore({ getState: () => state }) };
};
const saved = ({ state }) => snapshotTimelineStorage(state.timelineRecords, state.geometries,
  state.territorialEntities.map(entity => ({ id: entity.id, entityKind: entity.properties.entityKind })));

test('actual entity owner publishes one canonical record set and derived static shapes', () => {
  const o = owner();
  o.store.replaceEntities([feature('A'), feature('B', { parentId: 'A' })]);
  assert.equal(o.state.timelineRecords.lifetimes.length, 2);
  assert.equal(o.state.timelineRecords.geometryBindings.length, 2);
  assert.equal(o.state.timelineRecords.parentRelations.find(record => record.entityId === 'B').parentId, 'A');
  assert.equal(typeof Object.getOwnPropertyDescriptor(o.state.territorialEntities[0], 'geometry').get, 'function');
  assert.equal(typeof Object.getOwnPropertyDescriptor(o.state.territorialEntities[1].properties, 'parentId').get, 'function');
  assert.deepEqual(o.store.snapshot()[0].geometry, geometry);
});

test('failed parent change keeps identities, record values and archive untouched', () => {
  const o = owner(); o.store.replaceEntities([feature('A'), feature('B', { parentId: 'A' })]);
  const before = saved(o), identities = o.state.territorialEntities;
  assert.throws(() => o.store.setField('A', 'parentId', 'B'));
  assert.equal(o.state.territorialEntities, identities);
  assert.deepEqual(saved(o), before);
});

test('static geometry editing preserves old immutable versions and metadata-only edits do not allocate versions', () => {
  const o = owner(); o.store.replaceEntities([feature('A')]);
  const first = saved(o);
  o.store.setField('A', 'notes', 'kept');
  assert.equal(saved(o).geometries.length, 1);
  const changed = structuredClone(geometry); changed.coordinates[0][2] = [1,2];
  o.store.applyChanges({ features: [feature('A', { geometry: changed })] });
  assert.equal(saved(o).geometries.length, 2);
  assert.equal(o.state.timelineRecords.geometryBindings[0].geometryRef.version, 2);
  assert.deepEqual(first.geometries[0].geojson, geometry);
});

test('pre-T4 temporal editing is rejected before canonical publication', () => {
  const o = owner(); o.store.replaceEntities([feature('A')]); const before = saved(o);
  assert.throws(() => o.store.setField('A', 'validFrom', '1914-07'), { code: 'TIMELINE_ACTIVATION' });
  assert.deepEqual(saved(o), before);
});

test('failed multi-entity transaction never appends a version to the current archive', () => {
  const o = owner(); o.store.replaceEntities([feature('A')]); const before = saved(o);
  const changed = structuredClone(geometry); changed.coordinates[0][2] = [1,2];
  assert.throws(() => o.store.transaction(() => {
    o.store.applyChanges({ features: [feature('A', { geometry: changed })] });
    throw new Error('cancel transaction');
  }), /cancel transaction/);
  assert.deepEqual(saved(o), before);
});

test('static insertion retains arbitrary restored IDs and allocates records without global collisions', () => {
  const o = owner(); o.store.replaceEntities([feature('A')]);
  const snapshot = { territorialEntities: o.store.identities(), ...saved(o) };
  snapshot.timelineRecords = structuredClone(snapshot.records); delete snapshot.records;
  snapshot.timelineRecords.lifetimes[0].id = 'lifetime:B';
  snapshot.timelineRecords.geometryBindings[0].id = 'parent:B';
  snapshot.timelineRecords.parentRelations[0].id = 'geometry:B';
  o.store.restoreProject(snapshot);
  o.store.appendEntities([feature('B')]);
  const ids = ['lifetimes','geometryBindings','parentRelations'].flatMap(key => o.state.timelineRecords[key].map(row => row.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(o.state.timelineRecords.lifetimes[0].id, 'lifetime:B');
});
