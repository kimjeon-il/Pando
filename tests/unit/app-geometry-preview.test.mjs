import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGeometryPreview} from "../../apps/editor/frontend/js/modules/app-geometry-preview.js";
import {createEditPreviewController} from "../../apps/editor/frontend/js/modules/edit-preview-controller.js";
import {beginGeometryPreview,clearGeometryPreview,previewIsCurrent} from "../../apps/editor/frontend/js/modules/geometry-preview.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';

async function fixture(t,{execute}={}) {
  const calls=[],seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());
  const state={geometryPreview:{revision:0,session:null},get stateRevision(){return owner.client.state().stateRevision;}};
  const mapEditClient={async execute(operation,payload){calls.push(['execute',operation,payload]);if(execute)return execute(operation,payload);throw new Error('unexpected geometry worker call');},
    commit:(id,revision)=>calls.push(['commit',id,revision]),discard:id=>calls.push(['discard',id]),stop:()=>calls.push(['stop']),rebase:()=>calls.push(['rebase']),sourcesCurrent:()=>true};
  const preview=createGeometryPreview();preview.connect({domains:{projectDomain:owner.project,
    renderingDomain:{invalidateGpuInteraction:reason=>calls.push(['gpu',reason])},editingDomain:{refreshEditingPresentation:reason=>calls.push(['draft',reason])}},
    feedback:{setActionStatus:(...args)=>calls.push(['status',...args]),reportOperationError:(...args)=>calls.push(['error',...args])},
    geometryEditingCore:{beginGeometryPreview,clearGeometryPreview,previewIsCurrent},platform:{$:()=>null},projectState:{state},
    spatialFactories:{createEditPreviewController},spatialQuery:{mapEditClient},taskUi:{setModeBanner:(...args)=>calls.push(['banner',...args]),updateModeButtons:()=>calls.push(['buttons'])}});
  preview.initializeEditPreviewController();return {...owner,preview,state,calls};
}
const validPreview={validation:{issues:[]},delta:null,metrics:null};
function geometryCommand(owner,geometry){return {commandId:'territorial.geometry',targets:[{domain:'territorial',id:'A'}],expectedEpoch:owner.client.state().epoch,payload:{id:'A',geometry}};}

test('cancelled previews retain their technical error in diagnostics', async t => {
  const error = Object.assign(new Error('Superseded geometry request'), { cancelled: true, code: 'PL-WORKER-RPC-CANCELLED' });
  const log = t.mock.method(console, 'info', () => {});
  const owner = await fixture(t, { execute: async () => { throw error; } });
  assert.equal(await owner.preview.beginWorkerGeometryPreview({ operation: 'merge', payload: {}, prepareResult() { assert.fail('cancelled result cannot prepare a command'); } }), false);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(log.mock.calls[0].arguments[0], '[PL-PREVIEW-CANCELLED]');
  assert.equal(log.mock.calls[0].arguments[1], error);
});

test('worker revision failures reach the operation error boundary without a cancellation notice', async t => {
  const error = Object.assign(new Error('Map-edit data revision mismatch: requested 4, worker 3.'), { code: 'PL-MAP-EDIT-REVISION' });
  const owner = await fixture(t, { execute: async () => { throw error; } });
  assert.equal(await owner.preview.beginWorkerGeometryPreview({ operation: 'merge', payload: {}, prepareResult() { assert.fail('failed result cannot prepare a command'); } }), false);
  assert.equal(owner.calls.find(row => row[0] === 'error')[1], error);
  assert.equal(owner.calls.some(row => row[0] === 'status' && row[1] === '지도 작업을 취소했습니다.'), false);
});

test('accepted worker previews commit their original geometry revision after publishing the Core projection', async t => {
  let proposal;
  const owner = await fixture(t, { execute: async () => ({ requestId: 17, geometryRevision: 9, result: proposal }) });
  const before = owner.documentModel.territorialViews()[0], geometry = structuredClone(before.geometry);
  (geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : geometry.coordinates[0])[1][0] += 0.125;
  proposal = { features: [{ ...before, geometry }], removedIds: [], affectedIds: ['A'], preview: validPreview };
  assert.equal(await owner.preview.beginWorkerGeometryPreview({ operation: 'merge', payload: {},
    prepareResult: (result, { expectedEpoch }) => owner.project.prepareCommand({ ...geometryCommand(owner, result.features[0].geometry), expectedEpoch }) }), true);
  assert.equal(await owner.preview.applyActiveGeometryPreview(), true);
  assert.deepEqual(owner.calls.find(row => row[0] === 'commit'), ['commit', 17, 9]);
  assert.deepEqual(owner.documentModel.territorialViews()[0].geometry, geometry);
  assert.equal(await owner.project.undo(), true);
  assert.deepEqual(owner.documentModel.territorialViews()[0].geometry, before.geometry);
});

test('discard clears only the direct preview awaiting that geometry session, preserving a newer drag',async t=>{
  const {preview,state}=await fixture(t),controller=preview.editPreviewController;
  const begin=()=>controller.begin({projectGeneration:1,tool:'territorial-border',targetRefs:[]});
  const id=begin();controller.update([[[0,0],[1,1]]]);controller.waitForResult(id);
  state.geometryPreview.session={sessionId:'discarded',revision:1};controller.handoff(id,{kind:'geometry-preview',sessionId:'discarded',revision:1});
  assert.ok(controller.packet());assert.equal(await preview.discardActiveGeometryPreview({announce:false}),true);
  assert.equal(controller.snapshot().status,'idle');assert.equal(controller.packet(),null);
  const newer=begin();controller.update([[[0,0],[2,2]]]);state.geometryPreview.session={sessionId:'old',revision:1};
  await preview.discardActiveGeometryPreview({announce:false});assert.equal(controller.snapshot().id,newer);assert.equal(controller.snapshot().status,'dragging');assert.ok(controller.packet());
});

test('worker proposal displays the retained Core candidate and cancellation leaves live geometry/history untouched',async t=>{
  let proposal;
  const owner=await fixture(t,{execute:async operation=>{assert.equal(operation,'territorial-worker-test');return {requestId:17,result:proposal};}});
  const before=owner.documentModel.territorialViews()[0],geometry=structuredClone(before.geometry);(geometry.type==='MultiPolygon'?geometry.coordinates[0][0]:geometry.coordinates[0])[1][0]+=0.125;
  proposal={features:[{...before,geometry}],removedIds:[],affectedIds:['A'],preview:validPreview};
  const body=owner.documentModel.snapshot(),state=owner.client.state();
  assert.equal(await owner.preview.beginWorkerGeometryPreview({operation:'territorial-worker-test',payload:{},
    prepareResult:(result,{expectedEpoch})=>owner.project.prepareCommand({...geometryCommand(owner,result.features[0].geometry),expectedEpoch})}),true);
  assert.deepEqual(owner.state.geometryPreview.session.beforeFeatures[0].geometry,before.geometry);
  assert.deepEqual(owner.state.geometryPreview.session.afterFeatures[0].geometry,geometry);
  assert.equal(owner.documentModel.snapshot(),body);assert.deepEqual(owner.client.state(),state);
  assert.equal(await owner.preview.discardActiveGeometryPreview({announce:false}),true);
  assert.equal(owner.documentModel.snapshot(),body);assert.deepEqual(owner.client.state(),state);assert.ok(owner.calls.some(row=>row[0]==='discard'&&row[1]===17));
});

test('local preview confirms one Core history entry then applies the supplied platform effect without writing Web revision',async t=>{
  const owner=await fixture(t),before=owner.documentModel.territorialViews()[0].geometry;
  const geometry=structuredClone(before);(geometry.type==='MultiPolygon'?geometry.coordinates[0][0]:geometry.coordinates[0])[1][0]+=0.125;
  const state=owner.client.state(),prepared=await owner.project.prepareCommand(geometryCommand(owner,geometry));
  let applied=0,invalidations=0;
  assert.equal(await owner.preview.beginLocalGeometryPreview({operation:'territorial-test',preparedCommand:prepared,preparedPreview:validPreview,
    applyAccepted:()=>{++applied;assert.deepEqual(owner.documentModel.territorialViews()[0].geometry,geometry);},invalidateAfterApply:()=>++invalidations}),true);
  assert.equal(await owner.preview.applyActiveGeometryPreview(),true);assert.equal(applied,1);assert.equal(invalidations,1);
  assert.equal(owner.state.stateRevision,state.stateRevision,'Only the canonical raw command clock is published.');
  assert.equal(await owner.project.undo(),true);assert.equal(owner.project.canUndo(),false);assert.deepEqual(owner.documentModel.territorialViews()[0].geometry,before);
});

test('failed preview platform adoption restores the Core candidate and suppresses save/history',async t=>{
  const owner=await fixture(t),before=owner.documentModel.snapshot(),state=owner.client.state();
  const prepared=await owner.project.prepareCommand({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'Unpublished failure'}});
  const error=new Error('injected renderer failure');
  await owner.preview.beginLocalGeometryPreview({operation:'territorial-test',preparedCommand:prepared,preparedPreview:validPreview,applyAccepted:()=>{throw error;}});
  assert.equal(await owner.preview.applyActiveGeometryPreview(),false);assert.deepEqual(owner.documentModel.snapshot(),before);
  assert.equal(owner.client.state().checkpoint,state.checkpoint);assert.equal(owner.project.canUndo(),false);
  assert.equal(owner.calls.find(row=>row[0]==='error')[1],error);
});

test('held geometry candidate survives independent view and catalog acknowledgements and Undo retains those view controls',async t=>{
  const owner=await fixture(t),before=owner.documentModel.territorialViews()[0].geometry;
  const geometry=structuredClone(before);(geometry.type==='MultiPolygon'?geometry.coordinates[0][0]:geometry.coordinates[0])[1][0]+=0.125;
  const prepared=await owner.project.prepareCommand(geometryCommand(owner,geometry));
  assert.equal(await owner.preview.beginLocalGeometryPreview({operation:'territorial-test',preparedCommand:prepared,preparedPreview:validPreview}),true);
  const changed=await owner.project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'visibility',key:'countryFlags',visible:false}});
  assert.equal(changed.ok,true,changed.error?.message);
  await owner.project.admitSelectionCatalog('placeBuiltin',[{domain:'placeBuiltin',type:'city',id:'builtin:place:view-candidate'}]);
  const view=owner.documentModel.snapshot().layerVisibility;
  assert.equal(view.countryFlags,false);assert.equal(owner.project.canUndo(),false);
  assert.equal(await owner.preview.applyActiveGeometryPreview(),true);
  assert.deepEqual(owner.documentModel.territorialViews()[0].geometry,geometry);
  assert.deepEqual(owner.documentModel.snapshot().layerVisibility,view);
  assert.equal(await owner.project.undo(),true);assert.equal(owner.project.canUndo(),false);
  assert.deepEqual(owner.documentModel.territorialViews()[0].geometry,before);
  assert.deepEqual(owner.documentModel.snapshot().layerVisibility,view);
  assert.equal(owner.client.state().presentationDirty,true);
});

test('candidate exposes canonical affected periods and history command identity',async t=>{
 const owner=await fixture(t);const geometry=structuredClone(owner.documentModel.territorialViews()[0].geometry);
 (geometry.type==='MultiPolygon'?geometry.coordinates[0][0]:geometry.coordinates[0])[1][0]+=0.125;
 const prepared=await owner.project.prepareCommand(geometryCommand(owner,geometry));
 assert.deepEqual(prepared.preview.temporalImpact,[{entityId:'A',from:null,until:null}]);
 await owner.project.confirmCandidate(prepared.candidateId,prepared.state.epoch);
 assert.equal(owner.client.state().undoCommandId,'territorial.geometry');
 await owner.project.undo();assert.equal(owner.client.state().redoCommandId,'territorial.geometry');
});


test('double apply and completion UI failure cannot duplicate a committed command',async t=>{
 const owner=await fixture(t);const prepared=await owner.project.prepareCommand({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'Applied once'}});
 let release;const gate=new Promise(resolve=>{release=resolve;});let entered=0;
 await owner.preview.beginLocalGeometryPreview({operation:'test',preparedCommand:prepared,preparedPreview:validPreview,beforeApply:async()=>{entered++;await gate;return true;},onSuccess:()=>{throw new Error('notification failure');}});
 const pending=owner.preview.applyActiveGeometryPreview();await Promise.resolve();
 assert.equal(await owner.preview.applyActiveGeometryPreview(),false);
 assert.equal(await owner.preview.discardActiveGeometryPreview(),false);
 release();assert.equal(await pending,true);assert.equal(entered,1);
 assert.equal(owner.documentModel.territorialViews()[0].properties.name,'Applied once');
 assert.equal(owner.calls.find(row=>row[0]==='error')[3],'PL-PREVIEW-NOTIFY');
 assert.equal(await owner.project.undo(),true);assert.equal(owner.project.canUndo(),false);
});

test('invalidated preview releases its candidate without undoing intervening content',async t=>{
 const owner=await fixture(t);const prepared=await owner.project.prepareCommand({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'Stale'}});
 await owner.preview.beginLocalGeometryPreview({operation:'test',preparedCommand:prepared,preparedPreview:validPreview});
 await owner.project.executeCommand({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'Current'}});
 assert.equal(await owner.preview.applyActiveGeometryPreview(),false);
 assert.equal(owner.state.geometryPreview.session,null);
 assert.equal(owner.documentModel.territorialViews()[0].properties.name,'Current');
 assert.equal(await owner.project.undo(),true);assert.equal(owner.project.canUndo(),false);
});


test('dated candidate reports only its real interval and Undo/Redo restore the complete timeline',async t=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url),'utf8'));
 const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());
 await owner.client.setTimelineCursor('1916-01');
 const command=value=>({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value}});
 await owner.project.executeCommand(command('Later name'));
 await owner.client.setTimelineCursor('1914-07');
 const before=owner.documentModel.snapshot();
 const prepared=await owner.project.prepareCommand(command('Period name'));
 assert.equal(prepared.ok,true,prepared.error?.message);
 assert.deepEqual(prepared.preview.temporalImpact,[{entityId:'A',from:'1914-07-01',until:'1916-01-01'}]);
 await owner.project.confirmCandidate(prepared.candidateId,prepared.state.epoch);const after=owner.documentModel.snapshot();
 await owner.project.undo();assert.deepEqual(owner.documentModel.snapshot().timelineRecords,before.timelineRecords);
 await owner.project.redo();assert.deepEqual(owner.documentModel.snapshot().timelineRecords,after.timelineRecords);
});
