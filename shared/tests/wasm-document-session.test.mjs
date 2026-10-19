import assert from 'node:assert/strict';
import process from 'node:process';
import {URL} from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const runtimePath=resolve(process.env.PANDOEDITOR_WASM_MODULE ?? 'build-native/wasm/wasm/pandoeditor-core.js');
const { default:createCore }=await import(pathToFileURL(runtimePath));
const core=await createCore({wasmBinary:await readFile(runtimePath.replace(/\.js$/,'.wasm'))});
const seed=JSON.parse(await readFile(new URL('../../tests/fixtures/portability/web-document-seed.json',import.meta.url)));
const historicalManifest=JSON.parse(await readFile(new URL('../../assets/data/historical-world/generated/v1/manifest.json',import.meta.url)));

test('the complete historical world exports a full autosave after an identity edit', { timeout: 60_000 }, async () => {
  const sourceBytes=new Uint8Array(await readFile(new URL('../../assets/data/historical-world/generated/v1/world-project.json.gz',import.meta.url)));
  const session=new core.DocumentSession({validateFlagDataUrl:()=>{}});
  try {
    session.documentLoad(JSON.stringify(seed),historicalManifest.sourceMonth);
    const admitted=session.storageBaselineLoad({kind:'stored-asset',sourceBytes,encoding:'gzip',
      compressedBytes:sourceBytes.byteLength,decodedBytes:historicalManifest.project.decodedBytes,
      sourceMonth:historicalManifest.sourceMonth,
      baseDataset:'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto',
      fingerprint:historicalManifest.project.sha256},session.projectState().epoch);
    session.documentLoadBaseline(admitted.storageBaselineId,{initialMonth:historicalManifest.sourceMonth,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'});
    const before=session.projectState();
    const edited=session.executeCommand({commandId:'territorial.field',expectedEpoch:before.epoch,
      targets:[{domain:'territorial',id:'IRL'}],payload:{id:'IRL',field:'name',value:'Stored Ireland'}});
    assert.equal(edited.ok,true);
    assert.equal(edited.changed,true);
    const exported=session.exportSnapshot({expectedEpoch:edited.state.epoch,version:'0.99.0',
      savedAt:'2026-10-14T00:00:00.000Z',format:'pandolab-autosave'});
    const project=JSON.parse(exported.storageJson);
    assert.equal(project.format,'pandolab-autosave-full');
    assert.ok(project.timelineRecords.propertyBindings.some(row=>row.entityId==='IRL'&&row.property==='name'&&row.value?.name==='Stored Ireland'));
    session.documentLoad(exported.storageJson,historicalManifest.sourceMonth);
    const reopened=session.resolveWorld(historicalManifest.sourceMonth,session.projectState().epoch);
    assert.equal(reopened.entities.find(row=>row.id==='IRL').properties.name.name,'Stored Ireland');
    assert.equal(project.territorialEntities.length,historicalManifest.sourceIdentities.length);
    assert.ok(project.geometries.length>=274);
  }finally{session.delete();}
});

test('WASM owns the current full document, atomic commands and whole-project history',()=>{
  assert.equal(typeof core.DocumentSession,'function');
  const session=new core.DocumentSession({validateFlagDataUrl:value=>{
    if(typeof value!=='string'||!value.trim())throw Object.assign(new Error('Invalid flag.'),{code:'invalid-flag'});
  }});
  try {
    session.documentLoad(JSON.stringify(seed),'2026-10');
    const original=JSON.parse(session.storageSnapshot());
    assert.deepEqual(original,seed);
    assert.equal(session.projectState().dirty,false);
    const exportState=session.projectState();
    const exported=session.exportSnapshot({expectedEpoch:exportState.epoch,version:'0.99.0',
      savedAt:'2026-10-13T00:00:00.000Z',format:'pandolab-autosave-full'});
    assert.equal(JSON.parse(exported.storageJson).format,'pandolab-autosave-full');
    assert.equal(JSON.parse(exported.storageJson).version,'0.99.0');
    assert.equal(JSON.parse(exported.storageJson).savedAt,'2026-10-13T00:00:00.000Z');
    assert.deepEqual(JSON.parse(session.storageSnapshot()),original);
    assert.deepEqual(session.projectState(),exportState);
    const before=session.projectState();
    const result=session.executeCommand({commandId:'territorial.field',expectedEpoch:before.epoch,
      targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'Beta'}});
    assert.equal(result.ok,true);
    assert.equal(result.changed,true);
    assert.equal(result.state.stateRevision,1);
    assert.equal(result.state.canUndo,true);
    assert.ok(!Object.hasOwn(result,'snapshot'));
    assert.equal(result.delta.objects.length,1);
    assert.deepEqual(result.delta.geometries,[]);
    assert.equal(result.delta.provenance,null);
    assert.equal(result.delta.objects.find(row=>row.ref.id==='A').value.properties.name,'Beta');
    const noop=session.executeCommand({commandId:'territorial.field',expectedEpoch:result.state.epoch,
      targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'Beta'}});
    assert.equal(noop.changed,false);
    assert.equal(noop.state.epoch,result.state.epoch);
    const prepared=session.prepareCommand({commandId:'territorial.field',expectedEpoch:noop.state.epoch,
      targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'notes',value:'cancelled'}});
    assert.ok(prepared.candidateId>0);
    session.cancelCandidate(prepared.candidateId);
    assert.equal(JSON.parse(session.storageSnapshot()).territorialEntities.find(row=>row.id==='A').properties.notes,
      original.territorialEntities.find(row=>row.id==='A').properties.notes);
    const undone=session.undo(noop.state.epoch);
    assert.equal(undone.ok,true);
    assert.equal(undone.state.stateRevision,1);
    assert.equal(undone.state.dirty,false);
    assert.deepEqual(JSON.parse(session.storageSnapshot()),original);
    const redone=session.redo(undone.state.epoch);
    assert.equal(redone.state.stateRevision,1);
    assert.equal(JSON.parse(session.storageSnapshot()).territorialEntities.find(row=>row.id==='A').properties.name,'Beta');
    const rejected=session.executeCommand({commandId:'territorial.field',expectedEpoch:before.epoch,
      targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field:'name',value:'stale'}});
    assert.equal(rejected.ok,false);
    assert.equal(rejected.error.code,'STALE_REVISION');
  }finally{session.delete();}
});

test('same WASM document owns atomic batch, guarded queries and detached draft history',()=>{
  const session=new core.DocumentSession({validateFlagDataUrl(){}});
  try {
    const state=session.documentLoad(JSON.stringify(seed),'2026-10');
    assert.equal(state.timelineCursor,'2026-10');
    assert.equal(session.resolveWorld(state.timelineCursor,state.epoch).sourceEpoch,state.epoch);
    assert.throws(()=>session.resolveWorld(state.timelineCursor,state.epoch-1),error=>error.code==='STALE_REVISION');
    const targets=[{domain:'territorial',id:'A'}];
    const operation=(field,value)=>({commandId:'territorial.field',targets,payload:{id:'A',field,value}});
    const prepared=session.prepareCommand({commandId:'document.batch',expectedEpoch:state.epoch,targets:[],
      payload:{operations:[operation('name','Batch'),operation('notes','combined')]}});
    assert.ok(prepared.candidateId);
    assert.deepEqual(JSON.parse(session.storageSnapshot()),seed);
    const batch=session.confirmCandidate(prepared.candidateId,state.epoch);
    assert.equal(batch.changed,true);assert.equal(batch.state.stateRevision,1);
    assert.equal(session.undo(batch.state.epoch).changed,true);
    assert.deepEqual(JSON.parse(session.storageSnapshot()),seed);
    assert.equal(session.projectState().canUndo,false);
    const epoch=session.projectState().epoch;
    const apply=(action,payload={})=>session.draftApply({action,expectedEpoch:epoch,...payload});
    assert.equal(apply('start',{shape:'polygon',coords:[[0,0],[12,0],[12,8]],inputPhase:'draw'}).result,true);
    assert.equal(apply('beginDrag',{index:2}).result,true);
    apply('queueDrag',{coordinate:[14.125,9.25]});apply('queueDrag',{coordinate:[15.125,10.25]});
    assert.deepEqual(session.draftSnapshot().coords,[[0,0],[12,0],[12,8]]);
    const finished=apply('finishDrag');assert.equal(finished.result,true);
    assert.deepEqual(finished.snapshot.coords,[[0,0],[12,0],[15.125,10.25]]);
    assert.equal(finished.snapshot.historyCount,1);
    const undone=apply('undo');assert.equal(undone.result,true);
    assert.deepEqual(undone.snapshot.coords,[[0,0],[12,0],[12,8]]);
    assert.equal(undone.snapshot.inputPhase,'draw');assert.equal(undone.snapshot.selectedVertexIndex,2);
    assert.equal(session.projectState().epoch,epoch);assert.equal(session.projectState().canUndo,false);
    assert.equal(apply('clear').snapshot.active,true);assert.equal(apply('stop').snapshot.active,false);
    assert.throws(()=>session.draftApply({action:'clear',expectedEpoch:state.epoch}),error=>error.code==='STALE_REVISION');
    assert.throws(()=>session.selectionApply({action:'clear',expectedEpoch:state.epoch}),error=>error.code==='STALE_REVISION');
  }finally{session.delete();}
});
