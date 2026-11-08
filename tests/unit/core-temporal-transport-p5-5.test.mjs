import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoreDocumentClient} from "../../src/document/core-document-client.js";
import {createCoreWorkerRuntime} from "../../src/runtime/core-worker-runtime.js";

const state=epoch=>({epoch,stateRevision:0,revision:0,checkpoint:0,canUndo:false,canRedo:false,
  dirty:false,timelineCursor:'2026-10',storageBaselineId:0});
const sourceFacts={kind:'stored-asset',sourceBytes:new Uint8Array([1,2,3]),encoding:'identity',
  compressedBytes:3,decodedBytes:3,baseDataset:'fixture',sourceMonth:'2026-10',fingerprint:'a'.repeat(64)};
const setup={initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
const receipt={candidateId:7,sourceId:5,targetMonth:'2026-10',expectedEpoch:1,
  sourceFingerprint:'a'.repeat(64),worldSha256:'b'.repeat(64),resolvedEntityCount:1,reused:false};
const dispatchContext={throwIfCancelled() {}};
const tick=()=>new Promise(resolve=>globalThis.setImmediate(resolve));
async function waitUntil(predicate){
  for(let i=0;i<50;i++){if(predicate())return;await tick();}
  throw Error('Expected a pending Worker RPC request');
}
function transport(){
  const sent=[],held=[],publications=[];
  let currentEpoch=1;
  const worker={
    onmessage:null,
    terminate(){},
    postMessage(message){
      sent.push(message);
      if(message.type!=='request')return;
      if(message.operation==='core.document-temporal-source-prepare'
        ||message.operation==='core.document-temporal-candidate-prepare'
        ||message.operation==='core.document-temporal-candidate-adopt'){
        held.push(message);return;
      }
      const result=message.operation==='core.document-load'
        ? {state:state(currentEpoch),project:{ready:true},selection:{items:[],primary:null,hover:null},draft:{active:false}}
        : message.operation==='core.document-temporal-source-release'
          ||message.operation==='core.document-temporal-candidate-discard'?true
        : message.operation==='core.document-temporal-source-stats'
          ? {entries:1,declaredDecodedBytes:3,hits:0,evictions:0}
        : message.operation==='core.document-replacement-capture'?9
        : message.operation==='core.document-replacement-release'?true
        : message.operation==='core.document-replacement-rollback'
          ? {state:state(++currentEpoch),project:{ready:true},selection:{items:[],primary:null,hover:null},draft:{active:false}}
        : null;
      globalThis.queueMicrotask(()=>worker.onmessage?.({data:{...message,type:'result',ok:true,result}}));
    },
  };
  const client=createCoreDocumentClient({createWorker:()=>worker,productMode:'viewer',
    onTransition:(result,operation)=>publications.push(operation)});
  function acknowledge(operation,result){
    const index=held.findIndex(row=>row.operation===operation);
    assert.ok(index>=0,'missing held '+operation);
    const message=held.splice(index,1)[0];
    if(operation==='core.document-temporal-candidate-adopt')currentEpoch=result.state.epoch;
    globalThis.queueMicrotask(()=>worker.onmessage?.({data:{...message,type:'result',ok:true,result}}));
  }
  return {client,worker,sent,held,publications,acknowledge};
}

test('P5-5 client recovers a cancelled source-preparation acknowledgement and frees its handle',async()=>{
  const t=transport();await t.client.load('{}');
  const before=t.client.state(),controller=new globalThis.AbortController();
  const task=t.client.temporalSourcePrepare(sourceFacts,
    {dataRevision:'fixture',manifestSha256:'c'.repeat(64),signal:controller.signal});
  await waitUntil(()=>t.held.length===1);
  controller.abort();
  t.acknowledge('core.document-temporal-source-prepare',
    {sourceId:5,sourceMonth:'2026-10',fingerprint:sourceFacts.fingerprint,reused:false});
  await assert.rejects(task,error=>error?.name==='AbortError'&&error?.cancelled===true);
  assert.deepEqual(t.sent.filter(row=>row.type==='request').map(row=>row.operation),
    ['core.document-load','core.document-temporal-source-prepare','core.document-temporal-source-release']);
  assert.equal(t.sent.at(-1).payload.sourceId,5);
  assert.equal(t.sent.at(-1).payload.expectedEpoch,1);
  assert.equal(t.client.state(),before);
  assert.deepEqual(t.publications,['core.document-load']);
  assert.equal(sourceFacts.sourceBytes.byteLength,3,'no transfer/detachment of cache-owned input');
  t.client.dispose();
});
test('P5-5 superseded candidate is discarded even if C++ finished before caller cancellation',async()=>{
  const t=transport();await t.client.load('{}');
  const before=t.client.state();
  let eligible=true;
  const task=t.client.temporalCandidatePrepare({...receipt,setup,documentId:'fixture'},
    {isCurrent:()=>eligible});
  await waitUntil(()=>t.held.some(row=>row.operation==='core.document-temporal-candidate-prepare'));
  eligible=false;
  t.acknowledge('core.document-temporal-candidate-prepare',receipt);
  await assert.rejects(task,error=>error.code==='PL-CORE-STALE'&&error.cancelled);
  assert.deepEqual(t.sent.filter(row=>row.type==='request').map(row=>row.operation).slice(-2),
    ['core.document-temporal-candidate-prepare','core.document-temporal-candidate-discard']);
  assert.equal(t.sent.at(-1).payload.candidateId,7);
  assert.equal(t.client.state(),before);
  assert.deepEqual(t.publications,['core.document-load']);
  t.client.dispose();
});
test('P5-5 commit acknowledgement is published despite an abort after non-interruptible Core dispatch',async()=>{
  const t=transport();await t.client.load('{}');
  const controller=new globalThis.AbortController();
  const task=t.client.temporalCandidateAdopt({...receipt,replacementId:9},{signal:controller.signal});
  await waitUntil(()=>t.held.some(row=>row.operation==='core.document-temporal-candidate-adopt'));
  controller.abort(); // Cannot cancel an already-dispatched synchronous C++ commit.
  t.acknowledge('core.document-temporal-candidate-adopt',{
    state:state(2),project:{adopted:'2026-10'},world:{month:'2026-10',sourceEpoch:2,entities:[]},
    selection:{items:[],primary:null,hover:null},draft:{active:false}});
  const result=await task;
  assert.equal(result.state.epoch,2);assert.equal(t.client.state().epoch,2);
  assert.deepEqual(t.publications,['core.document-load','core.document-temporal-candidate-adopt']);
  assert.equal(t.sent.some(row=>row.type==='cancel'),false);
  t.client.dispose();
});
test('P5-5 pre-dispatch abort rejects without allocating native source or candidate',async()=>{
  const t=transport();await t.client.load('{}');
  const controller=new globalThis.AbortController();controller.abort();
  await assert.rejects(t.client.temporalSourcePrepare(sourceFacts,
    {dataRevision:'fixture',manifestSha256:'c'.repeat(64),signal:controller.signal}),
    {code:'PL-CORE-CANCELLED'});
  assert.equal(t.sent.filter(row=>row.operation==='core.document-temporal-source-prepare').length,0);
  t.client.dispose();
});
test('P5-5 optional diagnostics/handle release cannot publish a document transition',async()=>{
  const t=transport();await t.client.load('{}');
  assert.equal((await t.client.temporalSourceStats()).entries,1);
  assert.equal(await t.client.temporalSourceRelease(5),true);
  assert.equal(await t.client.temporalCandidateDiscard(7),true);
  assert.deepEqual(t.publications,['core.document-load']);
  assert.equal(t.client.state().epoch,1);
  t.client.dispose();
});
test('P5-5 Worker dispatch only exposes reviewed viewer operations in one Core owner',async()=>{
  const calls=[];
  class CoreSession {
    documentLoad(){calls.push('load');return state(1);}
    documentSnapshot(){return {active:true};}
    selectionSnapshot(){return {items:[],primary:null,hover:null};}
    draftSnapshot(){return {active:false};}
    resolveWorld(month,epoch){return {month,sourceEpoch:epoch,entities:[]};}
    temporalSourcePrepare(source){calls.push('source');assert.ok(source.source.sourceBytes instanceof Uint8Array);
      return {sourceId:5,fingerprint:source.source.fingerprint,sourceMonth:source.source.sourceMonth,reused:false};}
    temporalSourceStats(){return {entries:1,declaredDecodedBytes:3,hits:0,evictions:0};}
    temporalSourceRelease(x){calls.push('source-release');return x.sourceId===5;}
    temporalCandidatePrepare(){calls.push('candidate');return receipt;}
    temporalCandidateInspect(){return null;}
    temporalCandidateDiscard(){calls.push('discard');return true;}
    temporalCandidateAdopt(){calls.push('adopt');return {state:state(2),delta:null};}
    delete(){calls.push('delete');}
  }
  const runtime=createCoreWorkerRuntime({
    productMode:'viewer',loadModule:async()=>({DocumentSession:CoreSession}),
    validateFlagDataUrl(){},
  });
  assert.ok(runtime.operations.includes('core.document-temporal-candidate-adopt'));
  await assert.rejects(runtime.dispatch('core.document-temporal-source-prepare',{},dispatchContext),
    {code:'PL-CORE-NOT-LOADED'});
  await runtime.dispatch('core.document-load',{storageJson:'{}'},dispatchContext);
  const result=await runtime.dispatch('core.document-temporal-source-prepare',
    {source:sourceFacts,dataRevision:'fixture',manifestSha256:'c'.repeat(64),expectedEpoch:1},dispatchContext);
  assert.equal(result.sourceId,5);
  assert.equal((await runtime.dispatch('core.document-temporal-source-stats',{},dispatchContext)).entries,1);
  await runtime.dispatch('core.document-temporal-candidate-prepare',{...receipt,setup,documentId:'fixture'},dispatchContext);
  await runtime.dispatch('core.document-temporal-candidate-discard',{candidateId:7,expectedEpoch:1},dispatchContext);
  await runtime.dispatch('core.document-temporal-source-release',{sourceId:5,expectedEpoch:1},dispatchContext);
  assert.equal((await runtime.dispatch('core.document-temporal-candidate-adopt',{},dispatchContext)).state.epoch,2);
  await assert.rejects(runtime.dispatch('core.document-execute',{},dispatchContext),{code:'PL-PRODUCT-READONLY'});
  await runtime.dispose();
  assert.deepEqual(calls,['load','source','candidate','discard','source-release','adopt','delete']);
});
