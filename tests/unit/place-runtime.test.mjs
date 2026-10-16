import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { createPlaceRuntime } from '../../assets/js/modules/place-runtime.js';
import { normalizePlace, PLACE_LIMITS } from '../../assets/js/modules/place-contract.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('disposal retires a pending identity admission failure without reporting a place load error',async()=>{
  const admission=deferred(),started=deferred(),errors=[],published=[];
  const runtime=createPlaceRuntime({rpc:{request:async()=>({result:{records:[],signature:'retired'}}),stop(){}},
    admitReferences:()=>{started.resolve();return admission.promise;},onError:error=>errors.push(error),onSnapshot:value=>published.push(value)});
  const pending=runtime.prepare({threshold:1});await started.promise;runtime.dispose();
  admission.reject(Object.assign(new Error('The complete C++ document has not been loaded.'),{code:'PL-CORE-NOT-LOADED'}));
  assert.equal(await pending,false);assert.deepEqual(errors,[]);assert.deepEqual(published,[]);assert.equal(runtime.snapshot().signature,'empty');
});
test('manifest URL crosses the Worker boundary as a string', () => {
  assert.throws(() => createPlaceRuntime({ admitReferences:async ()=>{}, manifestUrl: new URL('http://localhost/manifest.json'), rpc: { stop() {} } }), /string/u);
});
test('interaction cancels viewport work and latest settled snapshot publishes atomically', async () => {
  const jobs = [], published = [];
  const rpc = { request(operation, payload) { const job=deferred(); jobs.push({ ...job, operation, payload }); return job.promise; }, cancelAll() {}, stop() {} };
  const runtime = createPlaceRuntime({ admitReferences:async ()=>{}, rpc, onSnapshot: value => published.push(value) });
  const first = runtime.prepare({ threshold: 1 }); await tick();
  runtime.beginInteraction(); jobs[0].resolve({ result: { records: [], signature: 'old' } }); await first; await tick();
  assert.equal(published.length, 0);
  await runtime.prepare({ threshold: 2 }); assert.equal(jobs.length, 1);
  await assert.rejects(runtime.search('Search'),error=>error.cancelled === true);
  assert.equal(jobs.length,1);
  const newest = runtime.settle({ threshold: 3 }); await tick();
  jobs[1].resolve({ result: { records: [], signature: 'new' } }); await newest;
  assert.equal(runtime.snapshot().signature, 'new'); assert.equal(published.length, 1); assert.ok(Object.isFrozen(runtime.snapshot()));
  runtime.dispose();
});
test('canonical selection remains resolvable after bounded search retention eviction', async () => {
  const selected=normalizePlace({ source:'synthetic', sourceId:'selected', name:'Selected', kind:'city', coordinates:[0,0] });
  let sequence=0;
  const runtime=createPlaceRuntime({ admitReferences:async ()=>{}, getProtectedIds:()=>[selected.id], rpc:{
    request:async()=>({result:{records:Array.from({length:50},()=>normalizePlace({source:'synthetic',sourceId:String(sequence++),name:'Search',kind:'city',coordinates:[0,0]}))}}), stop(){} } });
  runtime.retain(selected);
  for(let i=0;i<8;i++) await runtime.search('Search');
  assert.equal(runtime.resolve(selected.id),selected);
  assert.ok(runtime.stats().retainedRecords <= PLACE_LIMITS.retainedRecords);
  runtime.dispose();
});
test('out of order viewport completion and async failure cannot replace current snapshot', async () => {
  const jobs = [], errors=[];
  const runtime = createPlaceRuntime({ admitReferences:async ()=>{}, rpc: { request() { const job=deferred(); jobs.push(job); return job.promise; }, cancelAll() {}, stop() {} }, onError: error => errors.push(error) });
  const first=runtime.prepare({ threshold: 1 }); await tick(); const second=runtime.prepare({ threshold: 2 });
  jobs[0].resolve({ result: { records: [], signature: 'stale' } }); await first; await tick();
  assert.equal(runtime.snapshot().signature, 'empty');
  jobs[1].reject(new Error('offline')); await second; assert.equal(errors.length, 1); assert.equal(runtime.snapshot().signature, 'empty');
  runtime.dispose();
});
