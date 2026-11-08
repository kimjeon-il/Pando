import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "node:test";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "../../src/document/temporal.js";
import * as __merge_dep3 from "../../src/document/timeline-records.js";
import * as __merge_dep4 from "../fixtures/timeline-records-cases.mjs";
import * as __merge_dep5 from "../../src/document/territorial-units.js";
import * as __merge_dep6 from "../../src/document/timeline-storage.js";
import * as __merge_dep7 from "../helpers/timeline-project.mjs";
import * as __merge_dep8 from "../../tools/gis/timeline-edit.js";
import * as __merge_dep9 from "node:fs";
import * as __merge_dep10 from "../../src/document/territorial-entity-store.js";
contractSuite("timeline-records", () => {
const assert = __merge_dep1.default;
const test = __merge_dep0.default;
const { normalizeTemporal } = __merge_dep2;
const { normalizeTimelineRecords } = __merge_dep3;
const { timelineCases, timelineContext } = __merge_dep4;

for (const row of timelineCases()) {
  test(row.name, () => {
    const before = structuredClone(row.input);
    const contextBefore = structuredClone(row.context);
    if (row.expected === 'OK') {
      const result = normalizeTimelineRecords(row.input, timelineContext(row.context));
      assert.equal(result.schemaVersion, 3);
      const expected = structuredClone(before);
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) {
        for (const record of expected[name]) {
          record.validFrom = normalizeTemporal(record.validFrom);
          record.validTo = normalizeTemporal(record.validTo);
        }
      }
      assert.deepEqual(result, expected, 'only endpoint normalization may change record content');
      assert.deepEqual(normalizeTimelineRecords(JSON.parse(JSON.stringify(result)), timelineContext(row.context)), result);
      assert.notEqual(result, row.input);
      assert.ok(Object.isFrozen(result));
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) {
        assert.ok(Object.isFrozen(result[name]));
        assert.ok(result[name].every(Object.isFrozen));
      }
      if (row.name === 'normalized endpoints retain precision') {
        assert.equal(result.lifetimes[1].validFrom, '1914-07');
        assert.equal(result.lifetimes[1].validTo, '1915-02-03');
      }
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) row.input[name].reverse();
      assert.doesNotThrow(() => normalizeTimelineRecords(row.input, timelineContext(row.context)));
      for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) row.input[name].reverse();
    } else {
      assert.throws(() => normalizeTimelineRecords(row.input, timelineContext(row.context)), { code: row.expected });
    }
    assert.deepEqual(row.input, before, 'validation must not mutate input');
    assert.deepEqual(row.context, contextBefore, 'validation must not mutate catalog');
  });
}

test('required geometry dependency cannot be silently omitted', () => {
  const { input, context } = timelineCases()[0];
  assert.throws(() => normalizeTimelineRecords(input, { entities: context.entities }), { code: 'TIMELINE_CONTEXT' });
});
test('unexpected geometry repository failure propagates unchanged', () => {
  const { input, context } = timelineCases()[0];
  const failure = new Error('repository unavailable');
  assert.throws(() => normalizeTimelineRecords(input, { entities: context.entities, geometryExists() { throw failure; } }), error => error === failure);
});
test('returned references do not alias input and cannot be edited', () => {
  const { input, context } = timelineCases()[0];
  const result = normalizeTimelineRecords(input, timelineContext(context));
  const ref = result.geometryBindings[0].geometryRef;
  input.geometryBindings[0].geometryRef.id = 'changed-after-validation';
  assert.equal(ref.id, 'shape-a');
  assert.throws(() => { ref.version = 99; }, TypeError);
});

test('paired geometry and parent gaps preserve the independent lifetime', () => {
  const { input, context } = timelineCases()[0];
  for (const rows of [input.geometryBindings, input.parentRelations]) {
    const row = rows.find(row => row.objectRef.id === 'B');
    row.validFrom = '2026-10-01';
    row.validTo = '2026-10-31';
  }
  const result = normalizeTimelineRecords(input, timelineContext(context));
  assert.deepEqual(result.lifetimes, input.lifetimes);
  const missingGeometry = structuredClone(input);
  missingGeometry.geometryBindings.find(row => row.objectRef.id === 'B').validFrom = '2026-10-02';
  assert.throws(() => normalizeTimelineRecords(missingGeometry, timelineContext(context)), { code: 'TIMELINE_GAP' });
});
});
contractSuite("timeline-entity-store", () => {
const test = __merge_dep0.default;
const assert = __merge_dep1.default;
const { createTerritorialFeature } = __merge_dep5;
const { snapshotTimelineStorage } = __merge_dep6;
const { initializeTestTerritorialState, testCoreProject, executeTerritorialTestCommand, staticAutosaveProject } = __merge_dep7;

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,2],[2,2],[2,0],[0,0]]] };
const feature = (id, options = {}) => createTerritorialFeature({ id, name: id, entityKind: 'general', geometry, ...options });
const owner = async features => {
  const state={territorialEntities:features};
  await initializeTestTerritorialState(state);
  return {state,store:testCoreProject(state).entityStore,project:testCoreProject(state).project};
};
const saved = ({ state }) => snapshotTimelineStorage(state.timelineRecords, state.geometries,
  state.territorialEntities.map(entity => ({ objectRef:{domain:"territorial",id:entity.id}, entityKind: entity.properties.entityKind })));

test('actual entity owner publishes one canonical record set and derived static shapes', async () => {
  const o=await owner([feature('A'),feature('B',{parentId:'A'})]);
  assert.equal(o.state.timelineRecords.lifetimes.length, 2);
  assert.equal(o.state.timelineRecords.geometryBindings.length, 2);
  assert.equal(o.state.timelineRecords.parentRelations.find(record => record.objectRef.id === 'B').parentId, 'A');
  assert.ok(Object.isFrozen(o.state.territorialEntities[0]));
  assert.ok(Object.isFrozen(o.state.territorialEntities[1].properties));
  assert.equal(o.store.snapshot(),testCoreProject(o.state).documentModel.territorialViews());
  assert.deepEqual(o.store.snapshot()[0].geometry, geometry);
});

test('failed parent change keeps identities, record values and archive untouched', async () => {
  const o=await owner([feature('A'),feature('B',{parentId:'A'})]);
  const before = saved(o), identities = o.state.territorialEntities;
  await assert.rejects(()=>executeTerritorialTestCommand(o.state,'territorial.parent',{id:'A',parentId:'B'}));
  assert.equal(o.state.territorialEntities, identities);
  assert.deepEqual(saved(o), before);
});

test('static geometry editing preserves old immutable versions and metadata-only edits do not allocate versions', async () => {
  const o=await owner([feature('A')]);
  const first = saved(o);
  await executeTerritorialTestCommand(o.state,'territorial.metadata',{id:'A',field:'notes',valuePresent:true,value:'kept'});
  assert.equal(saved(o).geometries.length, 1);
  const changed = structuredClone(geometry); changed.coordinates[0][2] = [1,2];
  await executeTerritorialTestCommand(o.state,'territorial.patch',{ features: [feature('A', { geometry: changed })] });
  assert.equal(saved(o).geometries.length, 2);
  assert.equal(o.state.timelineRecords.geometryBindings[0].geometryRef.version, 2);
  assert.deepEqual(first.geometries[0].geojson, geometry);
});

test('inactive temporal editing is rejected before canonical publication', async () => {
  const o=await owner([feature('A')]);const before=saved(o);
  await assert.rejects(()=>executeTerritorialTestCommand(o.state,'territorial.metadata',{id:'A',field:'validFrom',valuePresent:true,value:'1914-07'}),{code:'TIMELINE_ACTIVATION'});
  assert.deepEqual(saved(o), before);
});

test('cancelled prepared geometry never appends a version to the current archive', async () => {
  const o=await owner([feature('A')]);const before=saved(o);
  const changed = structuredClone(geometry); changed.coordinates[0][2] = [1,2];
  const prepared=await o.project.prepareCommand({commandId:'territorial.geometry',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',geometry:changed}});
  assert.equal(prepared.ok,true);assert.equal(prepared.changed,true);
  assert.deepEqual(saved(o),before,'preview does not publish document or geometry versions');
  await o.project.cancelCandidate(prepared.candidateId);
  assert.deepEqual(saved(o), before);
});

test('static insertion retains arbitrary restored IDs and allocates records without global collisions', async () => {
  const o=await owner([feature('A')]);
  const snapshot=structuredClone(staticAutosaveProject({},[feature('A')]));
  snapshot.timelineRecords.lifetimes[0].id = 'lifetime:B';
  snapshot.timelineRecords.geometryBindings[0].id = 'parent:B';
  snapshot.timelineRecords.parentRelations[0].id = 'geometry:B';
  await o.project.admit(snapshot);
  await executeTerritorialTestCommand(o.state,'territorial.create',{feature:feature('B')});
  const ids = ['lifetimes','geometryBindings','parentRelations'].flatMap(key => o.state.timelineRecords[key].map(row => row.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(o.state.timelineRecords.lifetimes[0].id, 'lifetime:B');
});
});
contractSuite("timeline-edit", () => {
// The edit and live-view cases share only the already imported fixtures.
const assert = __merge_dep1.default;
const test = __merge_dep0.default;
const { replaceTimelineRecordAtMonth, truncateTimelineEntityAtMonth } = __merge_dep8;
const { normalizeTimelineRecords } = __merge_dep3;

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
contractSuite("timeline-live-view", () => {
const { initializeTestTerritorialState, testCoreProject, staticAutosaveProject, executeTerritorialTestCommand } = __merge_dep7;
const assert = __merge_dep1.default;
const test = __merge_dep0.default;
const { readFileSync } = __merge_dep9;
const { createEmptyTerritorialState } = __merge_dep10;
const { createTerritorialFeature } = __merge_dep5;

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
