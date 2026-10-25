import test from 'node:test';import assert from 'node:assert/strict';import {Worker} from 'node:worker_threads';
import {createMapDisplayClient} from "../../shared/frontend/js/modules/map-display-client.js";
import {createWorkerRpcClient} from "../../shared/frontend/js/modules/worker-rpc.js";
import {createTerritorialFeature} from "../../shared/frontend/js/modules/territorial-units.js";
function createWorker(){const worker=new Worker(new URL('../helpers/map-display-worker-thread.mjs',import.meta.url));const adapter={postMessage:value=>worker.postMessage(value),terminate:()=>worker.terminate()};worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;}
const shape=(id,x)=>createTerritorialFeature({id,entityKind:id==='CHILD'?'regional':'general',parentId:'',geometry:{type:'Polygon',coordinates:[[[0,0],[0,10],[x,10],[x,0],[0,0]]]}});
test('the actual common presentation Worker prepares boundaries and accepts current results without document writes',async t=>{
 const entities=[shape('ROOT',10),shape('CHILD',5)],before=structuredClone(entities);
 const client=createMapDisplayClient({createWorker,getEntities:()=>entities,getRevision:()=>1});t.after(client.dispose);
 const result=await client.prepare({kind:'boundaries'});assert.ok(result.result.segments.length);assert.deepEqual(entities,before);
 const highlight=await client.prepare({kind:'highlight',feature:entities[1],occluders:[{feature:entities[0]}]});assert.ok(highlight.result.feature.geometry);assert.deepEqual(entities,before);
});
test('the presentation transport discards results from a replaced document',async t=>{
 let revision=1;const client=createMapDisplayClient({createWorker,getEntities:()=>[shape('ROOT',10),shape('CHILD',5)],getRevision:()=>revision});t.after(client.dispose);
 const pending=client.prepare({kind:'boundaries'});revision++;
 await assert.rejects(pending,error=>error.code==='PL-WORKER-RPC-STALE');
});
test('the actual presentation Worker has no editing request handler',async t=>{
 const rpc=createWorkerRpcClient({createWorker});t.after(()=>rpc.stop());
 await assert.rejects(rpc.request('territorial-edit',{operation:'delete'}),error=>error.code==='PL-WORKER-RPC-UNKNOWN-OPERATION');
});
