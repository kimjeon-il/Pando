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

test('place source name history follows the project month without copying or editing the library record',async()=>{
 const record=normalizePlace({source:'synthetic',sourceId:'dated',name:'기준 지명',
  kind:'city',coordinates:[1,2],nameTimeline:[{fromYear:1900,ko:'옛 이름'}]});
 const before=structuredClone(record),admissions=[];
 let month='2026-10';
 const runtime=createPlaceRuntime({
  getPresentation:()=>({month,languages:{ko:true}}),
  admitReferences:async refs=>{const rows=typeof refs==='function'?refs():refs;admissions.push(rows.map(row=>row.id));},
  rpc:{stop(){},request:async()=>({result:{records:[structuredClone(record)],signature:'same-source-bytes'}})}
 });
 try{
  await runtime.prepare({presentation:{month}});
  assert.deepEqual(admissions,[[record.id]]);
  assert.equal(runtime.resolve(record.id)?.id,record.id);
  const original=runtime.snapshot();
  month='-0001-12';
  await runtime.prepare({presentation:{month}});
  assert.deepEqual(admissions.at(-1),[],'unsupported BCE references must not masquerade as current places');
  assert.equal(runtime.resolve(record.id),null);
  assert.deepEqual(runtime.snapshot().records,[],'inactive names must not reach the map snapshot');
  month='1920-01';
  await runtime.prepare({presentation:{month}});
  assert.deepEqual(admissions.at(-1),[record.id]);
  assert.deepEqual(runtime.resolve(record.id),original.records[0],'the original place is restored on the valid date');
  assert.deepEqual(record,before,'source place and its name editions remain immutable');
 }finally{runtime.dispose();}
});

test('externally reviewed urban lifetimes suppress anachronistic labels and preserve reference searches',async()=>{
 const policy={schema:'pando-place-urban-lifetimes-v1',schemaVersion:1,
  sourceReviewRevision:'0123456789abcdef0123456789abcdef01234567',entries:[
   {source:'geonames',sourceId:'3046446',sourceReviewFile:'reports/places/tier1-major-cities-batch07-europe-capitals.json',
    status:'verified',scope:'urban-city-label-not-settlement-existence',intervals:[{untilDateExclusive:'1873-11-17'}]},
   {source:'geonames',sourceId:'3054643',sourceReviewFile:'reports/places/tier1-major-cities-batch07-europe-capitals.json',
    status:'reviewed',scope:'urban-city-label-not-settlement-existence',intervals:[{fromDate:'1873-11-17'}]},
  ]};
 const pest=normalizePlace({source:'geonames',sourceId:'3046446',name:'페슈트',kind:'city',coordinates:[1,2]});
 const budapest=normalizePlace({source:'geonames',sourceId:'3054643',name:'부다페스트',kind:'city',coordinates:[2,3]});
 let month='1873-10',admissions=[];
 const runtime=createPlaceRuntime({urbanLifetimes:policy,getPresentation:()=>({month}),
  admitReferences:async fn=>admissions.push(fn().map(x=>x.id)),
  rpc:{stop(){},request:async()=>({result:{records:[pest,budapest],signature:'unchanged'}})}});
 try{
  await runtime.prepare({presentation:{month}});
  assert.deepEqual(admissions.at(-1),[pest.id]);
  assert.deepEqual(runtime.snapshot().records.map(x=>x.id),[pest.id]);
  assert.equal(runtime.resolve(budapest.id),null);
  month='1873-11';
  await runtime.prepare({presentation:{month}});
  assert.deepEqual(admissions.at(-1),[budapest.id]);
  assert.deepEqual(runtime.snapshot().records.map(x=>x.id),[budapest.id]);
  assert.equal(runtime.resolve(pest.id),null);
  const reference=await runtime.search('Pest',{scope:'reference'});
  assert.ok(reference.records.some(x=>x.id===pest.id),
   'a former city remains researchable without publishing an obsolete label');
 }finally{runtime.dispose();}
});
test('external lifetime loading failure does not admit undated GeoNames references',async()=>{
 const record=normalizePlace({source:'geonames',sourceId:'3054643',name:'부다페스트',kind:'city',coordinates:[1,2]});
 let admissions=0;const errors=[];
 const runtime=createPlaceRuntime({loadUrbanLifetimes:async()=>{throw new Error('Library unavailable')},
  admitReferences:async()=>{admissions++},onError:e=>errors.push(e),
  rpc:{stop(){},request:async()=>({result:{records:[record]}})}});
 try{
  assert.equal(await runtime.prepare({presentation:{month:'1801-01'}}),false);
  assert.equal(admissions,0);
  assert.match(errors[0].message,/Library unavailable/);
 }finally{runtime.dispose();}
});

test('recovered external lifetime catalog can be fetched after an initial failed request',async()=>{
 const record=normalizePlace({source:'geonames',sourceId:'3054643',name:'부다페스트',kind:'city',coordinates:[1,2]});
 const policy={schema:'pando-place-urban-lifetimes-v1',schemaVersion:1,
   sourceReviewRevision:'0123456789abcdef0123456789abcdef01234567',
   entries:[{source:'geonames',sourceId:'3054643',
     sourceReviewFile:'reports/places/tier1-major-cities-batch07-europe-capitals.json',
     status:'reviewed',scope:'urban-city-label-not-settlement-existence',
     intervals:[{fromDate:'1873-11-17'}]}]};
 let attempts=0,admitted=0;
 const runtime=createPlaceRuntime({loadUrbanLifetimes:async()=>{
   if(++attempts===1)throw Error('temporary offline');
   return policy;
 },admitReferences:async()=>{admitted++},
 rpc:{stop(){},request:async()=>({result:{records:[record],signature:'immutable'}})}});
 try{
   assert.equal(await runtime.prepare({presentation:{month:'1873-10'}}),false);
   assert.equal(admitted,0);
   assert.equal(await runtime.prepare({presentation:{month:'1873-10'}}),true);
   assert.equal(admitted,1);
   assert.equal(runtime.snapshot().records.length,0);
   assert.equal(attempts,2,'a recoverable data request must be retried');
 }finally{runtime.dispose();}
});
