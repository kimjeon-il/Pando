import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { snapshotTimelineStorage } from "../../shared/frontend/js/modules/timeline-storage.js";
import {initializeTestTerritorialState,testCoreProject,executeTerritorialTestCommand,staticAutosaveProject} from '../helpers/timeline-project.mjs';

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,2],[2,2],[2,0],[0,0]]] };
const feature = (id, options = {}) => createTerritorialFeature({ id, name: id, entityKind: 'general', geometry, ...options });
const owner = async features => {
  const state={territorialEntities:features};
  await initializeTestTerritorialState(state);
  return {state,store:testCoreProject(state).entityStore,project:testCoreProject(state).project};
};
const saved = ({ state }) => snapshotTimelineStorage(state.timelineRecords, state.geometries,
  state.territorialEntities.map(entity => ({ id: entity.id, entityKind: entity.properties.entityKind })));

test('actual entity owner publishes one canonical record set and derived static shapes', async () => {
  const o=await owner([feature('A'),feature('B',{parentId:'A'})]);
  assert.equal(o.state.timelineRecords.lifetimes.length, 2);
  assert.equal(o.state.timelineRecords.geometryBindings.length, 2);
  assert.equal(o.state.timelineRecords.parentRelations.find(record => record.entityId === 'B').parentId, 'A');
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
