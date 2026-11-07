import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "../../shared/frontend/js/modules/temporal.js";
import * as __contract_dep3 from "../../shared/frontend/js/modules/timeline-records.js";
import * as __contract_dep4 from "../fixtures/timeline-records-cases.mjs";
import * as __contract_dep5 from "../../shared/frontend/js/modules/territorial-units.js";
import * as __contract_dep6 from "../../shared/frontend/js/modules/timeline-storage.js";
import * as __contract_dep7 from "../helpers/timeline-project.mjs";

// Original feature contract: timeline-records.test.mjs
contractSuite("timeline-records", () => {
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { normalizeTemporal } = __contract_dep2;
const { normalizeTimelineRecords } = __contract_dep3;
const { timelineCases, timelineContext } = __contract_dep4;

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

// Original feature contract: timeline-entity-store.test.mjs
contractSuite("timeline-entity-store", () => {
const test = __contract_dep1.default;
const assert = __contract_dep0.default;
const { createTerritorialFeature } = __contract_dep5;
const { snapshotTimelineStorage } = __contract_dep6;
const { initializeTestTerritorialState, testCoreProject, executeTerritorialTestCommand, staticAutosaveProject } = __contract_dep7;

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
