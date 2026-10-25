import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSerializer} from "../../apps/editor/frontend/js/modules/project-serializer.js";
import {createSaveStateController} from "../../apps/editor/frontend/js/modules/save-state-controller.js";
import {projectForStorage,staticAutosaveProject} from '../helpers/timeline-project.mjs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {loadWebOracle} from '../helpers/web-oracle.mjs';
const {fingerprintProjectBaseline}=await loadWebOracle('assets/js/modules/project-serializer.js');

function project(staticOnly=false) {
  const source=projectForStorage();
  if(staticOnly)source.projectFields.timelineRecords.geometryBindings=[{id:'shape-static',entityId:'A',validFrom:null,validTo:null,geometryRef:{id:'shape',version:2}}];
  return structuredClone(createProjectSerializer({appVersion:'0.34.0',baseDataset:'base',distributionModes:['territorial','geometry'],
    terrainDataset:'terrain',hydroDataset:'hydro',readSnapshot:()=>source}).buildProject());
}
async function session(t,input=staticAutosaveProject()) {
  const effects=[],presentation={render:'current-render',session:'current-session',target:'original.pando'};let owner;
  const saveState=createSaveStateController({getDocumentState:()=>owner ? owner.client.state():null,onChange:()=>effects.push('save-publication')});
  owner=await createNodeCoreProject(input,{saveState,
    replaceSnapshot:source=>{effects.push('replace');assert.equal(source,owner.documentModel.snapshot());return true;},
    onReplacementState:()=>{effects.push('ui');presentation.render='replaced';},
    onProjectReset:()=>{effects.push('reset');presentation.session='replaced';},
    persistence:{cancelPending:()=>effects.push('cancel'),queueProject:()=>effects.push('autosave')},
  });t.after(()=>owner.dispose());saveState.markOpenedFile();effects.length=0;
  return {...owner,domain:owner.project,effects,presentation,saveState,current:owner.project.snapshot};
}

test('valid dated project activates through the actual Core with its full records intact',async t=>{
  const s=await session(t),source=project();await s.domain.load(source);
  assert.deepEqual(s.current().timelineRecords,source.timelineRecords);assert.deepEqual(s.current().geometries,source.geometries);
  assert.ok(s.effects.includes('replace'));assert.equal(s.client.state().canUndo,false);
});
test('a bad geometry archive fails before any document, device or presentation publication',async t=>{
  const s=await session(t),broken=project(true),before=s.current(),clock=s.client.state(),io=s.saveState.checkpoint();broken.geometries=[];
  await assert.rejects(()=>s.domain.load(broken),{code:'TIMELINE_GEOMETRY'});
  assert.equal(s.current(),before);assert.deepEqual(s.client.state(),clock);assert.deepEqual(s.effects,[]);assert.deepEqual(s.saveState.checkpoint(),io);
});
test('static activation retains every unbound historical geometry version',async t=>{
  const s=await session(t),source=project(true);await s.domain.load(source);
  assert.deepEqual(s.current().timelineRecords,source.timelineRecords);assert.deepEqual(s.current().geometries,source.geometries);
  assert.equal(s.current().territorialEntities[0].geometry,null);
});
test('delta recovery requires the matching immutable baseline and retains complete records and archive',async t=>{
  const source=project(true);source.baseDataset='base';
  const baseOwner=await createNodeCoreProject(source);let features;
  try{features=structuredClone(baseOwner.documentModel.territorialViews());}finally{baseOwner.dispose();}
  const fingerprint=await fingerprintProjectBaseline(features),delta={...source,format:'pandolab-autosave-delta',baseDatasetFingerprint:fingerprint,
    entityDelta:{changed:[],removedIds:[]}};delete delta.territorialEntities;
  const mismatch=await session(t);await mismatch.client.storageBaselineLoad({kind:'static-features',baseDataset:'different-base',fingerprint,features});
  const before=mismatch.current();await assert.rejects(()=>mismatch.domain.load(delta),{code:'PL-SCHEMA-BASE'});
  assert.equal(mismatch.current(),before);assert.deepEqual(mismatch.effects,[]);
  const good=await session(t);await good.client.storageBaselineLoad({kind:'static-features',baseDataset:'base',fingerprint,features});
  await good.domain.load(delta);assert.deepEqual(good.current().territorialEntities,source.territorialEntities);
  assert.deepEqual(good.current().timelineRecords,source.timelineRecords);assert.deepEqual(good.current().geometries,source.geometries);
});
test('malformed candidates preserve the real Core content, selection, history, dirty checkpoints and device target',async t=>{
  const original=project(true),s=await session(t,original);
  await s.domain.executeCommand({commandId:'territorial.metadata',targets:[{domain:'territorial',id:'A'}],
    payload:{id:'A',field:'name',valuePresent:true,value:'edited'}});
  await s.client.selectionApply({action:'replace',ref:{domain:'territorial',type:'entity',id:'A'}});
  const before=s.current(),clock=s.client.state(),selection=await s.client.selectionSnapshot(),io=s.saveState.checkpoint(),display=structuredClone(s.presentation);
  s.effects.length=0;
  const mutations=[row=>row.geometries.push(structuredClone(row.geometries[0])),
    row=>{row.timelineRecords.geometryBindings[0].geometryRef.version=99;},
    row=>row.timelineRecords.lifetimes.push(structuredClone(row.timelineRecords.lifetimes[0])),
    row=>{row.timelineRecords.parentRelations[0].parentId='missing';},row=>{row.territorialEntities[0].properties.sovereignty='A';},
    row=>{row.genericFeatures=[{type:'Feature',id:'00000000-0000-4000-8000-000000000001',geometry:null,properties:{schemaVersion:2}}];},
    row=>{row.timelineRecords.lifetimes[0].validFrom='0000';},row=>{row.timelineRecords.lifetimes[0].validTo='1900-02-29';}];
  for(const mutate of mutations) {
    const bad=structuredClone(original);mutate(bad);await assert.rejects(()=>s.domain.load(bad));
    assert.equal(s.current(),before);assert.deepEqual(s.client.state(),clock);assert.deepEqual(await s.client.selectionSnapshot(),selection);
    assert.deepEqual(s.effects,[]);assert.deepEqual(s.saveState.checkpoint(),io);assert.deepEqual(s.presentation,display);
    assert.equal(s.domain.getGeneration(),0);assert.equal(s.domain.isReplacing(),false);
  }
  assert.equal(await s.domain.undo(),true);assert.deepEqual(s.current(),original);
});
