import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:assert/strict";
import * as __suiteDependency1 from "node:test";
import * as __suiteDependency2 from "node:fs";
import * as __suiteDependency3 from "../../helpers/web-hydro-create-oracle.mjs";
import * as __suiteDependency4 from "../../helpers/core-project.mjs";
import * as __suiteDependency5 from "node:assert/strict";
import * as __suiteDependency6 from "node:test";
import * as __suiteDependency7 from "node:fs";
import * as __suiteDependency8 from "../../helpers/web-hydro-hidden-oracle.mjs";
import * as __suiteDependency9 from "../../helpers/core-project.mjs";
import * as __suiteDependency10 from "node:test";
import * as __suiteDependency11 from "node:assert/strict";
import * as __suiteDependency12 from "node:fs";
import * as __suiteDependency13 from "../../helpers/core-project.mjs";
import * as __suiteDependency14 from "../../../src/document/project-session.js";
import * as __suiteDependency15 from "../../../src/document/project-resource-overlay.js";

// Original feature contract: core-hydro-create-wasm.test.mjs
featureDescribe("core-hydro-create-wasm", () => {
  const assert = __suiteDependency0.default;
  const test = __suiteDependency1.default;
  const {  readFileSync  } = __suiteDependency2;
  const {  originalNormalizedHydro  } = __suiteDependency3;
  const {  createNodeCoreProject  } = __suiteDependency4;
const seed = JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url), 'utf8'));
const inputs = [
  { type: 'Feature', id: '33000000-0000-4000-8000-000000000031', geometry: { type: 'LineString', coordinates: [[1,2],[3,4]] },
    properties: { category: 'lake', name: '  River\r\n ', notes: '  raw notes  ', visible: false, color: '#ABCDEF', unknown: { nested: [null,0,'kept'] } } },
  { type: 'Feature', id: '33000000-0000-4000-8000-000000000032', geometry: { type: 'Polygon', coordinates: [[[1,2],[3,2],[3,4],[1,2]]] },
    properties: { category: 'river', name: 42, notes: null, visible: true, editorColor: ' #A0B1C2 ', color: 17, unknown: ['array',{ x: true }] } },
];

for (const input of inputs) test(`raw ${input.geometry.type} hydro creation preserves original missing fields, opaque properties and storage`, async t => {
  const expected = originalNormalizedHydro(input);
  assert.equal(Object.hasOwn(expected.properties, 'locked'), false);
  assert.equal(Object.hasOwn(expected.properties, 'source'), false);
  assert.equal(Object.hasOwn(expected.properties, 'visible'), false);
  assert.deepEqual(expected.properties.unknown, input.properties.unknown);
  assert.deepEqual(expected.properties.color, input.properties.color);
  const owner = await createNodeCoreProject(seed); t.after(() => owner.dispose());
  const before = owner.documentModel.snapshot();
  const result = await owner.project.executeCommand({ commandId: 'hydro.edit', targets: [{ domain: 'hydro',id: input.id }],
    payload: { domain: 'hydro', id: input.id, value: input, create: true } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(owner.documentModel.get({ domain: 'hydro',id: input.id }), expected);
  const exported = await owner.client.exportSnapshot({ format: 'pandolab-project-state', version: seed.version, savedAt: seed.savedAt });
  const stored=JSON.parse(exported.storageJson);
  assert.deepEqual(stored.hydroEdits.find(row => row.id === input.id), {...expected,geometry:null});
  const binding=stored.timelineRecords.geometryBindings.find(row=>row.objectRef.domain==='hydro'&&row.objectRef.id===input.id);
  assert.deepEqual(stored.geometries.find(row=>row.id===binding.geometryRef.id&&row.version===binding.geometryRef.version).geojson,expected.geometry);
  assert.equal(await owner.project.undo(), true);
  assert.deepEqual(owner.documentModel.snapshot(), before);
  assert.equal(await owner.project.redo(), true);
  assert.deepEqual(owner.documentModel.get({ domain: 'hydro',id: input.id }), expected);
});
});
// Original feature contract: core-hydro-hidden-source-wasm.test.mjs
featureDescribe("core-hydro-hidden-source-wasm", () => {
  const assert = __suiteDependency5.default;
  const test = __suiteDependency6.default;
  const {  readFileSync  } = __suiteDependency7;
  const {  originalHydroAggregation  } = __suiteDependency8;
  const {  createNodeCoreProject  } = __suiteDependency9;
const logicalId = 'river:aggregate';
const fragment = sourceId => ({ type: 'Feature', id: `${logicalId}:fragment`,
  properties: { pandolab_id: logicalId, category: 'river', layer_id: 'rivers', source_id: sourceId, fragment_index: 0, __fid: 2 },
  geometry: { type: 'LineString', coordinates: [[1.125, 2.25], [3.5, 4.75]] } });
const cases = [
  { name: 'true source suffix', hidden: { 'source:101': true, 'source:102': false, unrelated: true }, expected: { 'source:101': true, 'source:102': false, unrelated: true, [logicalId]: true } },
  { name: 'false or unknown source', hidden: { 'source:101': false, 'source:999': true }, expected: { 'source:101': false, 'source:999': true } },
  { name: 'existing logical hide', hidden: { [logicalId]: true, 'source:102': false }, expected: { [logicalId]: true, 'source:102': false } },
];
test('frozen original hydro aggregation adds only true source hidden aliases without touching project clocks', () => {
  for (const row of cases) {
    const result = originalHydroAggregation(logicalId, [fragment('101,102')], row.hidden);
    assert.deepEqual(result.hiddenHydroIds, row.expected, row.name);
    assert.equal(result.stateRevision, 17); assert.equal(result.dirty, false);
    assert.equal(result.aggregate.id, logicalId);
    assert.equal(result.aggregate.properties.source_id, '101,102');
  }
});
test('builtin catalog admission preserves creation metadata and save/history clocks', async t => {
  for (const row of cases) {
    const seed = JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url), 'utf8'));
    const owner = await createNodeCoreProject(seed); t.after(() => owner.dispose());
    const before = owner.client.state();
    await owner.project.admitSelectionCatalog('hydroBuiltin', [{ domain: 'hydroBuiltin', type: 'river', id: logicalId, logicalId, sourceIds: ['101', '102'] }]);
    assert.deepEqual(owner.documentModel.snapshot().projectSetup,seed.projectSetup);assert.equal(Object.hasOwn(owner.documentModel.snapshot(),'itemVisibility'),false);
    const after = owner.client.state();
    for (const key of ['stateRevision', 'checkpoint', 'documentDirty', 'presentationDirty', 'presentationCheckpoint', 'canUndo', 'canRedo'])
      assert.equal(after[key], before[key], `${row.name}: ${key}`);
    assert.deepEqual(owner.documentModel.snapshot().territorialEntities, seed.territorialEntities);
    assert.deepEqual(owner.documentModel.snapshot().timelineRecords, seed.timelineRecords);
  }
});
});
// Original feature contract: core-hydro-copy-history-wasm.test.mjs
featureDescribe("core-hydro-copy-history-wasm", () => {
  const test = __suiteDependency10.default;
  const assert = __suiteDependency11.default;
  const { readFileSync } = __suiteDependency12;
  const { createNodeCoreProject } = __suiteDependency13;
  const { createProjectSession } = __suiteDependency14;
  const { projectResourceOverlay } = __suiteDependency15;
const id='33000000-0000-4000-8000-000000000037',sourceId='river:original';
test('hydro copy, delete and Undo/Redo derive source suppression without saving temporary background settings',async t=>{
  const seed=JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json",import.meta.url)));
  const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());
  await owner.client.presentationCatalogLoad({hydroLayers:{[sourceId]:'river'},countryLabelIds:[],builtinSubunitSources:{}});
  const session=createProjectSession({productMode:'viewer'});
  session.connect({applicationConstantsA:{DISTRIBUTION_RENDER_MODES:{OVERLAP:'overlap'}},
    uiFactoriesA:{createAtomicMapStateController:()=>({})},modelValidation:{normalizeLayerPresentation:()=>({})},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{}});
  session.initializeMapWorkScheduler();session.installDocumentProjection({documentModel:owner.documentModel,commandOwner:owner.client,entityStore:{snapshot:()=>[]}});
  const state=session.state;
  const defaults=structuredClone(owner.documentModel.snapshot().projectSetup);
  const result=await owner.project.executeCommand({commandId:'hydro.copy',targets:[{domain:'hydro',id}],payload:{feature:{type:'Feature',id,geometry:{type:'LineString',coordinates:[[1,2],[3,4]]},properties:{name:'Copied river',category:'river',editorColor:'#5488aa',sourceFeatureId:sourceId,source:structuredClone(seed.genericFeatures[0].properties.source)}}}});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.equal(state.itemVisibility.hydro[sourceId],false);
  const copied=state.hydroEdits.find(row=>row.id===id);
  assert.deepEqual(copied.geometry,{type:'LineString',coordinates:[[1,2],[3,4]]});
  assert.equal(copied.properties.name,'Copied river');
  assert.equal(copied.properties.sourceFeatureId,sourceId);
  const sourceFeature={id:sourceId,properties:{pandolab_id:sourceId,category:'river'}};
  const effective=projectResourceOverlay('hydro',state.hydroEdits,[sourceFeature]);
  assert.equal(effective.sourceReplacement(sourceId),copied);
  assert.deepEqual(effective.library,[]);
  assert.equal(effective.ownerOf(copied.id),'project');
  assert.deepEqual(owner.documentModel.snapshot().projectSetup,defaults);
  session.applyViewingPresentation({action:'distributionLayerVisibility',id:'another-layer',visible:false});
  assert.equal(session.captureViewingPresentation().itemVisibility.hydro[sourceId],undefined);
  assert.equal(await owner.project.undo(),true);assert.notEqual(state.itemVisibility.hydro[sourceId],false);
  assert.equal(projectResourceOverlay('hydro',state.hydroEdits).isSourceReplaced(sourceId),false);
  assert.equal(await owner.project.redo(),true);assert.equal(state.itemVisibility.hydro[sourceId],false);
  assert.equal(projectResourceOverlay('hydro',state.hydroEdits).isSourceReplaced(sourceId),true);
  const deleted=await owner.project.executeCommand({commandId:'hydro.edit',targets:[{domain:'hydro',id}],payload:{domain:'hydro',id,value:null,create:false}});
  assert.equal(deleted.ok,true,JSON.stringify(deleted.error));assert.notEqual(state.itemVisibility.hydro[sourceId],false);
  assert.equal(await owner.project.undo(),true);assert.equal(state.itemVisibility.hydro[sourceId],false);
  session.setViewingPresentation({itemVisibility:{...session.captureViewingPresentation().itemVisibility,hydro:{[sourceId]:false}}});
  assert.equal((await owner.project.executeCommand({commandId:'hydro.edit',targets:[{domain:'hydro',id}],payload:{domain:'hydro',id,value:null,create:false}})).ok,true);
  assert.equal(Object.hasOwn(owner.documentModel.snapshot(),'itemVisibility'),false);
  await owner.project.undo();
  const saved=JSON.parse(await owner.client.storageSnapshot());assert.equal(Object.hasOwn(saved,'physicalSettings'),false);
  const reopened=await createNodeCoreProject(saved);try{assert.equal(reopened.documentModel.snapshot().hydroEdits.find(row=>row.id===id).properties.sourceFeatureId,sourceId);}finally{reopened.dispose();}
  assert.deepEqual(owner.documentModel.snapshot().genericFeatures,seed.genericFeatures);
  assert.deepEqual(owner.documentModel.snapshot().distributionEntries,seed.distributionEntries);
});
});

// Original feature contract: map-plugin-hydro-history.test.mjs
// Current Core geometry history is shared by built-in and externally opened projects.
featureDescribe("core-hydro-geometry-history", () => {
  const test = __suiteDependency1.default;
  const assert = __suiteDependency0.default;
  const { readFileSync } = __suiteDependency2;
  const { createNodeCoreProject } = __suiteDependency4;
test('hydro geometry undo restores the accepted feature coordinates as well as Core history',async()=>{
  const seed=JSON.parse(readFileSync(new URL('../../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed);
  const id='plugin-history-line',geometry={type:'LineString',coordinates:[[10,40],[11,41]]};
  try {
    const created=await owner.project.executeCommand({commandId:'hydro.edit',targets:[{domain:'hydro',id}],payload:{domain:'hydro',id,create:true,value:{type:'Feature',id,geometry,properties:{category:'river',name:'',notes:''}}}});
    assert.equal(created.ok,true,JSON.stringify(created.error));
    const edited=await owner.project.executeCommand({commandId:'hydro.geometry',targets:[{domain:'hydro',id}],payload:{id,geometry:{type:'LineString',coordinates:[[10.5,40.5],[11,41]]}}});
    assert.equal(edited.ok,true,JSON.stringify(edited.error));
    assert.notDeepEqual(owner.documentModel.get({domain:'hydro',id}).geometry,geometry);
    await owner.project.undo();
    assert.equal(owner.client.state().redoCommandId,'hydro.geometry');
    assert.deepEqual(owner.documentModel.get({domain:'hydro',id}).geometry,geometry);
  } finally {owner.dispose();}
});
});
