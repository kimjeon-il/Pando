import {testCoreProject,snapshotTestTerritorialState,initializeTestTerritorialState,executeTestCommand,executeTerritorialTestCommand,staticAutosaveProject} from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { subunitSelectionPolicy, boundaryTouchesGeometry } from "../../apps/editor/frontend/js/modules/territorial-interaction-policy.js";
import * as interactionPolicy from "../../apps/editor/frontend/js/modules/territorial-interaction-policy.js";
import {readFileSync} from 'node:fs';
import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { BUILTIN_SUBUNITS,territorialSceneDisplayId } from "../../shared/frontend/js/modules/builtin-subunits.js";

const geometry = { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] };
const country = (id, notes = '') => createTerritorialFeature({ id, entityKind: 'general', notes, geometry });
const unit = (id, parentId = 'KR', locked = false) => createTerritorialFeature({ id, entityKind: 'general', parentId, locked, geometry });
const region = id => createTerritorialFeature({ id, entityKind: 'regional', geometry });
const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
const initializeInteractionState=async(state,options)=>{
  await initializeTestTerritorialState(state,null,options);
  const owner=testCoreProject(state),features=owner.entityStore.snapshot(),countryIds=new Set(features.filter(row=>!row.properties.parentId&&row.properties.entityKind==='general').map(row=>row.id));
  await owner.project.admitPresentationCatalog({hydroLayers:{},builtinSubunitSources:Object.fromEntries(BUILTIN_SUBUNITS.map(row=>[row.id,row.sourceCountryId])),
    countryLabelIds:features.map(row=>territorialSceneDisplayId(row,countryIds))});
};
const executeRemoval=async(state,ids)=>{
  const refs=ids.map(id=>({domain:'territorial',id}));
  const result=await executeTestCommand(state,{commandId:'objects.remove',targets:refs,payload:{refs}});
  const owner=testCoreProject(state),features=owner.entityStore.snapshot(),countryIds=new Set(features.filter(row=>!row.properties.parentId&&row.properties.entityKind==='general').map(row=>row.id));
  owner.viewing.session.pruneViewingItems({countryLabelIds:features.map(row=>territorialSceneDisplayId(row,countryIds))});
  return result;
};
const locked=(state,id,value)=>executeTerritorialTestCommand(state,'territorial.lock',{ids:[id],locked:value});

test('territorial deletion requires the canonical store before touching project state', () => {
  const state = { territorialEntities: [] };
  const before = structuredClone(state);
  assert.equal('removeTerritorialEntities' in interactionPolicy,false,'retired JS mutable document helper is removed');
  assert.throws(()=>createTerritorialEntityStore({getState:()=>state}),/C\+\+ territorial projection/);
  assert.deepEqual(state, before);
});

test('multiple subunits require one parent, unlocked objects and a connected selection', () => {
  const units = [unit('a'), unit('b'), unit('c')];
  const adjacent = (a, b) => Math.abs(a.id.charCodeAt(0) - b.id.charCodeAt(0)) === 1;
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, true);
  assert.equal(subunitSelectionPolicy([units[0], units[2]], { adjacent }).valid, false);
  units[1].properties.parentId = 'other';
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, false);
  units[1].properties.parentId = 'KR'; units[1].properties.locked = true;
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, false);
});
test('single and batch deletion never expands into descendants and rechecks changed locks', async () => {
  const a = unit('a'), b = unit('b');
  const state = {territorialEntities:[country('KR'),a,b],distributionLayers:seed.distributionLayers,
    distributionEntries:[{...seed.distributionEntries[0],territorialUnitId:'a'}],itemVisibility:{objects:{a:false}},labelSettings:{'territorial:a':{}}};
  await initializeInteractionState(state);
  await executeTerritorialTestCommand(state,'territorial.create',{feature:unit('child','a')});
  const before = snapshotTestTerritorialState(state);
  await assert.rejects(()=>executeRemoval(state,['a','b']));
  assert.deepEqual(snapshotTestTerritorialState(state), before);
  await executeTerritorialTestCommand(state,'territorial.remove',{ids:['child']});
  await locked(state,'b',true);
  await assert.rejects(()=>executeRemoval(state,['a','b']));
  await locked(state,'b',false);
  await executeRemoval(state,['a']);
  assert.deepEqual(state.territorialEntities.map(entity => entity.id), ['KR', 'b']);
  assert.deepEqual(state.distributionEntries, []);
  assert.deepEqual(state.labelSettings, {});
});
test('country deletion uses the same territorial cleanup surface and removes dangling references', async () => {
  const linkedRegion = region('r');
  const state = {
    territorialEntities: [country('A', 'remove'), country('B', 'keep'), linkedRegion],
    distributionLayers:seed.distributionLayers,
    distributionEntries: [
      {...seed.distributionEntries[0],territorialUnitId:'A'},
      {...seed.distributionEntries[0],id:'22000000-0000-4000-8000-000000000009',territorialUnitId:'r'},
    ],
    labels:[{...seed.labels[0],territorialUnitId:'A'}],
    genericFeatures:[{...seed.genericFeatures[0],properties:{...seed.genericFeatures[0].properties,
      source:{...seed.genericFeatures[0].properties.source,details:{provenance:{ownerId:'A',topologyGroup:'land:A'}}}}}],
    itemVisibility: { objects: { A: false }, objectLabels: { A: false } },
    labelSettings: { 'territorial:A': {} },
  };

  await initializeInteractionState(state);
  await executeRemoval(state,['A']);

  assert.deepEqual(state.territorialEntities.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId).map(feature => feature.id), ['B']);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'B').properties.notes, 'keep');
  assert.equal(state.territorialEntities.find(entity => entity.id === 'r').properties.associatedCountryId, undefined);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'r').properties.parentId, '');
  assert.deepEqual(state.timelineRecords.parentRelations.map(record => record.entityId), ['B', 'r']);
  assert.deepEqual(state.distributionEntries.map(entry=>entry.id),['22000000-0000-4000-8000-000000000009']);
  assert.equal(state.labels[0].territorialUnitId,'A','original current Web stores this non-owning label reference after territory deletion');
  assert.deepEqual(state.genericFeatures[0].properties.source.details.provenance,{ownerId:'A',topologyGroup:'land:A'});
  assert.deepEqual(state.itemVisibility.objects, {});
  assert.deepEqual(state.itemVisibility.objectLabels, {});
  assert.deepEqual(state.labelSettings, {});
});

test('territorial deletion publishes the accepted C++ collection once', async () => {
  const state = {
    territorialEntities: [country('A'), country('B'), region('r', 'A')],
    distributionEntries: [],
    labels: [],
    genericFeatures: [],
    itemVisibility: { objects: {}, objectLabels: {} },
    labelSettings: {},
  };
  let writes = 0;
  await initializeInteractionState(state);
createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client,onEntitiesReplaced() { writes += 1; } });

  await executeRemoval(state,['A']);

  assert.deepEqual(state.territorialEntities.filter(entity => entity.properties.entityKind === 'general' && !entity.properties.parentId).map(feature => feature.id), ['B']);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'r').properties.associatedCountryId, undefined);
  assert.equal(writes, 1);
});

test('deletion clears the actual native and synthetic scene IDs without touching another country label', async () => {
  const native = BUILTIN_SUBUNITS.find(row => row.sourceCountryId === 'ALD');
  for (const sourceCountryPresent of [false, true]) {
    const displayId = sourceCountryPresent ? `territorial:entity:${native.id}` : 'ALD';
    const state = {
      territorialEntities: [country('FIN'), ...(sourceCountryPresent ? [country('ALD')] : []), { ...unit(native.id, 'FIN'), properties: {
        ...unit(native.id, 'FIN').properties,
        metadata: { builtinSubunit: { sourceCountryId: 'ALD' } },
      } }, region('r')],
      labelSettings: { [`territorial:${native.id}`]: {}, 'territorial:r': {}, 'territorial:FIN': { pinned: true } },
      itemVisibility: { objectLabels: { [displayId]: false, 'territorial:entity:r': false, FIN: false } },
      layerPresentation:normalizeLayerPresentation({objectStyles:{[`territorial:entity:${native.id}`]:{},'territorial:entity:r':{},'territorial:entity:FIN':{}}}),
    };
    const input=structuredClone(staticAutosaveProject({labelSettings:state.labelSettings,layerPresentation:state.layerPresentation},state.territorialEntities));
    await initializeInteractionState(state,{project:input});
    const survivorSettings=state.labelSettings['territorial:FIN'];
    await executeRemoval(state,[native.id,'r']);
    assert.deepEqual(state.labelSettings, { 'territorial:FIN': survivorSettings });
    assert.deepEqual(state.itemVisibility.objectLabels, { FIN: false });
    assert.deepEqual(state.layerPresentation.objectStyles, { 'territorial:entity:FIN': {} });
  }
});

test('country deletion rejects current administrative children before changing state', async () => {
  const state = {
    territorialEntities: [country('A'), unit('child', 'A')],
    distributionEntries: [],
    labels: [],
    genericFeatures: [],
    itemVisibility: { objects: {}, objectLabels: {} },
    labelSettings: {},
  };
  await initializeInteractionState(state);
  const before = snapshotTestTerritorialState(state);
  await assert.rejects(()=>executeRemoval(state,['A']));
  assert.deepEqual(snapshotTestTerritorialState(state), before);
});

test('locked boundary checks include interior points of differently segmented edges', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  assert.equal(boundaryTouchesGeometry(geometry, [1, 0]), true);
  assert.equal(boundaryTouchesGeometry(geometry, [3, 0]), false);
});
