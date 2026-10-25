import {initializeTestTerritorialState,testCoreProject,staticAutosaveProject,executeTerritorialTestCommand} from '../helpers/timeline-project.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEmptyTerritorialState } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";

test('dated store publishes selected month while retaining all historical identities', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:project});
  const store=testCoreProject(state).entityStore;
  assert.equal(state.timelineCursor, '1916-01');
  assert.equal(store.snapshot().find(row => row.id === 'B').properties.parentId, 'C');
  assert.equal(await store.setTimelineCursor('1909-12'), true);
  assert.deepEqual(store.snapshot().map(row => row.id), ['A', 'C', 'R']);
  assert.deepEqual(store.identities().map(row => row.id), ['A', 'B', 'C', 'R']);
});

test('dated store edits split geometry and parent at the selected month without changing other months', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:project});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-07');
  const source = store.snapshot().find(row => row.id === 'B');
  const originalGeometry = source.geometry;
  const nextGeometry = { type: 'Polygon', coordinates: [[[10,10],[11,10],[11,11],[10,11],[10,10]]] };
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...source, geometry: nextGeometry,
    properties: { ...source.properties, parentId: 'C' } }] });
  assert.equal(store.snapshot().find(row => row.id === 'B').properties.parentId, 'C');
  assert.deepEqual(store.snapshot().find(row => row.id === 'B').geometry, nextGeometry);
  const newBinding = state.timelineRecords.geometryBindings.find(row => row.entityId === 'B' && row.validFrom === '1914-07');
  assert.ok(newBinding);
  await store.setTimelineCursor('1914-06');
  assert.equal(store.snapshot().find(row => row.id === 'B').properties.parentId, 'A');
  assert.deepEqual(store.snapshot().find(row => row.id === 'B').geometry, originalGeometry);
  await store.setTimelineCursor('1916-01');
  assert.equal(store.snapshot().find(row => row.id === 'B').properties.parentId, 'C');
  assert.deepEqual(store.identities().map(row => row.id), project.territorialEntities.map(row => row.id));
});

test('explicit month editing versions a static project and rejects invalid parent atomically', async () => {
  const shape = { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] };
  const source = staticAutosaveProject({},[createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A', geometry: shape })]);
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:source});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-07');
  const original = store.snapshot()[0];
  const before = state.timelineRecords;
  await assert.rejects(() => executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...original,
    properties: { ...original.properties, parentId: 'missing' } }] }),error=>error.message==='invalid: Territorial parent is missing.');
  assert.equal(state.timelineRecords, before);
  assert.equal(store.snapshot()[0], original);
  const changed = { type: 'Polygon', coordinates: [[[0,0],[3,0],[3,3],[0,3],[0,0]]] };
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...original, geometry: changed }] });
  await store.setTimelineCursor('1914-06');
  assert.deepEqual(store.snapshot()[0].geometry, shape);
  await store.setTimelineCursor('1914-07');
  assert.deepEqual(store.snapshot()[0].geometry, changed);
});

test('dated creation and deletion change lifetime without erasing earlier geometry', async () => {
  const source = staticAutosaveProject({},[createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A',
    geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] } })]);
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:source});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-07');
  const created = createTerritorialFeature({ id: 'B', entityKind: 'general', name: 'B',
    geometry: { type: 'Polygon', coordinates: [[[3,0],[4,0],[4,1],[3,1],[3,0]]] } });
  await executeTerritorialTestCommand(state,'territorial.create',{feature:created});
  assert.deepEqual(store.snapshot().map(row => row.id), ['A', 'B']);
  assert.equal(state.timelineRecords.lifetimes.find(row => row.entityId === 'B').validFrom, '1914-07');
  await store.setTimelineCursor('1914-06');
  assert.deepEqual(store.snapshot().map(row => row.id), ['A']);
  await store.setTimelineCursor('1915-01');
  await executeTerritorialTestCommand(state,'territorial.remove',{ids:['A']});
  assert.deepEqual(store.snapshot().map(row => row.id), ['B']);
  await store.setTimelineCursor('1914-12');
  assert.deepEqual(store.snapshot().map(row => row.id), ['A', 'B']);
  assert.deepEqual(store.identities().map(row => row.id), ['A', 'B']);
});

test('history-style restoration preserves the session month while regular project load resets it', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:project});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-06');
  await testCoreProject(state).project.admit(project,{preserveCursor:true});
  assert.equal(state.timelineCursor, '1914-06');
  await testCoreProject(state).project.admit(project);
  assert.equal(state.timelineCursor, '1916-01');
});
