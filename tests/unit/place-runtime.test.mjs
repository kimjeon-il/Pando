import assert from 'node:assert/strict';
import test from 'node:test';

test('date reevaluation with equal place records retains the admitted snapshot and its allocations', async () => {
  let admissions=0, publications=0;
  const record=normalizePlace({source:'synthetic',sourceId:'same',name:'Same',kind:'city',coordinates:[1,2]});
  const runtime=createPlaceRuntime({admitReferences:async()=>{admissions++;},onSnapshot:()=>{publications++;},
    rpc:{stop(){},request:async()=>({result:{records:[structuredClone(record)],signature:'same-visible-tiles'}})}});
  await runtime.prepare({presentation:{month:'1900-01'}});
  const before=runtime.snapshot();
  await runtime.prepare({presentation:{month:'1900-02'}});
  assert.equal(admissions,1);
  assert.equal(publications,1);
  assert.strictEqual(runtime.snapshot(),before);
  runtime.dispose();
});

test('reference search ignores interaction and presentation without publishing project identities', async () => {
  const calls = []; let admissions = 0;
  const place = normalizePlace({ source: 'synthetic', sourceId: 'old', name: 'Old name', kind: 'city', coordinates: [1, 2] });
  const runtime = createPlaceRuntime({ getPresentation: () => ({ month: '2026-10', languages: { ko: true } }),
    admitReferences: async () => { admissions++; }, rpc: { stop() {}, request: async (operation, payload) => {
      calls.push({ operation, payload }); return { result: { records: [place] } };
    } } });
  runtime.beginInteraction();
  const result = await runtime.search('Old', { scope: 'reference', mapDate: '1800' });
  assert.equal(result.records[0].id, place.id);
  assert.equal(calls[0].payload.scope, 'reference');
  assert.equal(calls[0].payload.mapDate, '1800');
  assert.equal(calls[0].payload.presentation, null);
  assert.equal(admissions, 0); assert.equal(runtime.stats().retainedRecords, 0);
  runtime.dispose();
});

test('reference search uses the scheduler abort signal and rejects after disposal', async () => {
  let workerSignal;
  const runtime = createPlaceRuntime({ admitReferences: async () => {}, rpc: { stop() {}, request: (_op, _payload, options) => {
    workerSignal = options.signal; return new Promise(() => {});
  } } });
  const abort = new globalThis.AbortController();
  const result = runtime.search('Old', { scope: 'reference', signal: abort.signal });
  await tick(); abort.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
  assert.equal(workerSignal.aborted, true);runtime.dispose();
  await assert.rejects(runtime.search('Old', { scope: 'reference' }), error => error.name === 'AbortError');
});
import { setImmediate } from 'node:timers';
import { createPlaceRuntime } from "../../shared/frontend/js/modules/place-runtime.js";
import { normalizePlace, PLACE_LIMITS } from "../../shared/frontend/js/modules/place-contract.js";
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
