import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "../../tools/gis/timeline-edit.js";
import * as __contract_dep3 from "../../shared/frontend/js/modules/timeline-records.js";
import * as __contract_dep4 from "../helpers/timeline-project.mjs";
import * as __contract_dep5 from "node:fs";
import * as __contract_dep6 from "../../shared/frontend/js/modules/territorial-entity-store.js";
import * as __contract_dep7 from "../../shared/frontend/js/modules/territorial-units.js";

// Original feature contract: timeline-edit.test.mjs
contractSuite("timeline-edit", () => {
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { replaceTimelineRecordAtMonth, truncateTimelineEntityAtMonth } = __contract_dep2;
const { normalizeTimelineRecords } = __contract_dep3;

const records = { schemaVersion: 3, lifetimes: [], geometryBindings: [
  { id: 'A:original', objectRef:{domain:"territorial",id:'A'}, validFrom: '1914-06-15', validTo: '1915-12', geometryRef: { id: 'shape', version: 1 } },
  { id: 'A:future', objectRef:{domain:"territorial",id:'A'}, validFrom: '1916', validTo: null, geometryRef: { id: 'shape', version: 3 } },
], parentRelations: [], propertyBindings: [] };

test('dated geometry replacement retains exact original start and later versions', () => {
  const result = replaceTimelineRecordAtMonth(records, 'geometryBindings', {domain:"territorial",id:'A'}, '1914-07',
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
  const result = replaceTimelineRecordAtMonth(source, 'geometryBindings', {domain:"territorial",id:'A'}, '1914-07',
    { geometryRef: { id: 'shape', version: 2 } });
  assert.equal(result.geometryBindings[0].validFrom, '1914-06-15');
  assert.equal(result.geometryBindings[0].validTo, '1914-06');
  assert.equal(result.geometryBindings[1].validFrom, '1914-07');
  assert.equal(result.geometryBindings[1].validTo, '1915-12-24');
});

test('same-month replacement keeps its exact day and does not create overlap', () => {
  const result = replaceTimelineRecordAtMonth(records, 'geometryBindings', {domain:"territorial",id:'A'}, '1914-06',
    { geometryRef: { id: 'shape', version: 2 } });
  assert.equal(result.geometryBindings.length, 2);
  assert.equal(result.geometryBindings[0].validFrom, '1914-06-15');
  assert.equal(result.geometryBindings[0].geometryRef.version, 2);
});

test('parent change splits only its own slot and can be validated as one candidate', () => {
  const source = { schemaVersion: 3, propertyBindings: [],
    lifetimes: ['A', 'B', 'C'].map(id => ({ id: `life:${id}`, objectRef:{domain:"territorial",id:id}, validFrom: null, validTo: null })),
    geometryBindings: ['A', 'B', 'C'].map(id => ({ id: `shape:${id}`, objectRef:{domain:"territorial",id:id}, validFrom: null, validTo: null,
      geometryRef: { id: `shape:${id}`, version: 1 } })),
    parentRelations: ['A', 'C'].map(id => ({ id: `parent:${id}`, objectRef:{domain:"territorial",id:id}, validFrom: null, validTo: null,
      parentId: '', coverageMode: 'explicit' })).concat({ id: 'parent:B', objectRef:{domain:"territorial",id:'B'}, validFrom: null,
      validTo: null, parentId: 'A', coverageMode: 'partition' }),
  };
  const changed = replaceTimelineRecordAtMonth(source, 'parentRelations', {domain:"territorial",id:'B'}, '1914-07',
    { parentId: 'C', coverageMode: 'explicit' });
  normalizeTimelineRecords(changed, { entities: ['A', 'B', 'C'].map(id => ({ objectRef:{domain:'territorial',id}, entityKind: 'general' })),
    geometryExists: () => true });
  assert.equal(changed.parentRelations.find(row => row.id === 'parent:B').validTo, '1914-06');
  assert.equal(changed.parentRelations.find(row => row.id === 'parent:B:1914-07').parentId, 'C');
  assert.deepEqual(changed.geometryBindings, source.geometryBindings);
});

test('ending an entity removes future records but preserves earlier month coverage', () => {
  const source = { schemaVersion: 3, propertyBindings: [],
    lifetimes: [{ id: 'life:A', objectRef:{domain:"territorial",id:'A'}, validFrom: null, validTo: null }],
    geometryBindings: [
      { id: 'shape:A:old', objectRef:{domain:"territorial",id:'A'}, validFrom: null, validTo: '1914-06', geometryRef: { id: 'shape', version: 1 } },
      { id: 'shape:A:new', objectRef:{domain:"territorial",id:'A'}, validFrom: '1914-07', validTo: null, geometryRef: { id: 'shape', version: 2 } },
    ],
    parentRelations: [{ id: 'parent:A', objectRef:{domain:"territorial",id:'A'}, validFrom: null, validTo: null,
      parentId: '', coverageMode: 'explicit' }],
  };
  const ended = truncateTimelineEntityAtMonth(source, {domain:"territorial",id:'A'}, '1914-07');
  assert.equal(ended.lifetimes[0].validTo, '1914-06');
  assert.deepEqual(ended.geometryBindings.map(row => row.id), ['shape:A:old']);
  assert.equal(ended.parentRelations[0].validTo, '1914-06');
  assert.equal(source.lifetimes[0].validTo, null);
});
});

// Original feature contract: timeline-live-view.test.mjs
contractSuite("timeline-live-view", () => {
const { initializeTestTerritorialState, testCoreProject, staticAutosaveProject, executeTerritorialTestCommand } = __contract_dep4;
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { readFileSync } = __contract_dep5;
const { createEmptyTerritorialState } = __contract_dep6;
const { createTerritorialFeature } = __contract_dep7;

test('dated store publishes selected month while retaining all historical identities', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  project.projectSetup.initialMonth='1916-01';
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:project});
  const store=testCoreProject(state).entityStore;
  assert.equal(state.timelineCursor, project.projectSetup.initialMonth);
  assert.equal(store.snapshot().find(row => row.id === 'B').properties.parentId, 'C');
  assert.equal(await store.setTimelineCursor('1909-12'), true);
  assert.deepEqual(store.snapshot().map(row => row.id), ['A', 'C', 'R']);
  assert.deepEqual(store.identities().map(row => row.id), ['A', 'B', 'C', 'R']);
});

test('dated store edits split geometry and parent at the selected month without changing other months', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  project.projectSetup.initialMonth='1916-01';
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:project});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-07');
  const source = store.snapshot().find(row => row.id === 'B');
  const originalGeometry = source.geometry;
  const nextGeometry = { type: 'Polygon', coordinates: [[[0.1,0.1],[0.3,0.1],[0.3,0.3],[0.1,0.3],[0.1,0.1]]] };
  await executeTerritorialTestCommand(state,'territorial.patch',{ features: [{ ...source, geometry: nextGeometry,
    properties: { ...source.properties, parentId: 'C' } }] });
  assert.equal(store.snapshot().find(row => row.id === 'B').properties.parentId, 'C');
  assert.deepEqual(store.snapshot().find(row => row.id === 'B').geometry, nextGeometry);
  const newBinding = state.timelineRecords.geometryBindings.find(row => row.objectRef.id === 'B' && row.validFrom === '1914-07');
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
  const source = staticAutosaveProject({},[createTerritorialFeature({ id:'A', entityKind: 'general', name: 'A', geometry: shape })]);
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
  const source = staticAutosaveProject({},[createTerritorialFeature({ id:'A', entityKind: 'general', name: 'A',
    geometry: { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] } })]);
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:source});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-07');
  const created = createTerritorialFeature({ id:'B', entityKind: 'general', name: 'B',
    geometry: { type: 'Polygon', coordinates: [[[3,0],[4,0],[4,1],[3,1],[3,0]]] } });
  await executeTerritorialTestCommand(state,'territorial.create',{feature:created});
  assert.deepEqual(store.snapshot().map(row => row.id), ['A', 'B']);
  assert.equal(state.timelineRecords.lifetimes.find(row => row.objectRef.id === 'B').validFrom, '1914-07');
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
  project.projectSetup.initialMonth='1916-01';
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:project});
  const store=testCoreProject(state).entityStore;
  await store.setTimelineCursor('1914-06');
  await testCoreProject(state).project.admit(project,{preserveCursor:true});
  assert.equal(state.timelineCursor, '1914-06');
  await testCoreProject(state).project.admit(project);
  assert.equal(state.timelineCursor, project.projectSetup.initialMonth);
});
});
