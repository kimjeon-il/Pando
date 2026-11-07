import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "node:timers";
import * as __dep3 from "../../shared/frontend/js/modules/place-runtime.js";
import * as __dep4 from "../../shared/frontend/js/modules/place-contract.js";
import * as __dep5 from "../../shared/frontend/js/modules/rendering-domain.js";
import * as __dep6 from "../../shared/frontend/js/modules/label-layout.js";
import * as __dep7 from "../../shared/frontend/js/modules/map-render-coordinator.js";
import * as __dep8 from "node:fs/promises";
import * as __dep9 from "node:os";
import * as __dep10 from "node:path";
import * as __dep11 from "node:http";
import * as __dep12 from "node:worker_threads";
import * as __dep13 from "node:events";
import * as __dep14 from "../helpers/place-synthetic.mjs";
import * as __dep15 from "../../shared/frontend/js/modules/worker-rpc.js";
import * as __dep16 from "../helpers/place-view.mjs";
import * as __dep17 from "../../shared/frontend/js/modules/map-visual-frame.js";

// Original feature contract: place-runtime.test.mjs
contractSuite("place-runtime", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { setImmediate }=__dep2;
const { createPlaceRuntime }=__dep3;
const { normalizePlace, PLACE_LIMITS }=__dep4;

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
});

// Original feature contract: place-interaction-runtime.test.mjs
contractSuite("place-interaction-runtime", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { createRenderingDomain }=__dep5;

test('render interaction allows view invalidation without preparing builtin places until settle', () => {
  let prepared = 0;
  let began = 0;
  const frames = [];
  const domain = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    labelResources: {
      preparePlaces: () => { prepared += 1; },
      beginPlaceInteraction: () => { began += 1; },
    },
  });

  domain.beginInteraction('hold-zoom');
  assert.equal(began, 1);
  domain.invalidateView('hold-zoom-frame');
  assert.equal(prepared, 0);

  domain.endInteraction('hold-zoom-settle');
  assert.equal(prepared, 1);
});
});

// Original feature contract: place-layout.test.mjs
contractSuite("place-layout", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { layoutLabels }=__dep6;
const { PLACE_LIMITS }=__dep4;
const { createMapRenderCoordinator, MAP_RENDER_DIRTY }=__dep7;
test('High layout has an absolute cap including selected and pinned candidates', () => {
  const records=Array.from({length:10000},(_,i)=>({ key: String(i), point: [i*5,10], width:1,height:1, priority:i, pinned:true, selected:i===9999 }));
  const metrics={}; const placed=layoutLabels(records,{ metrics });
  assert.equal(placed.length,PLACE_LIMITS.layoutCandidates); assert.equal(placed[0].key,'9999'); assert.equal(metrics.hardCulledCount,10000-PLACE_LIMITS.layoutCandidates);
});
test('builtin and user labels collide in the same label policy', () => {
  const records=[{key:'builtin:place:synthetic:1',point:[20,20],width:50,height:20,priority:90,collisionGroup:'place'},{key:'user1',point:[20,20],width:50,height:20,priority:40,collisionGroup:'place'}];
  assert.deepEqual(layoutLabels(records).map(item=>item.key),[records[0].key]);
});
test('quality and project invalidations do not execute label layout during interaction', () => {
  const frames=[], layouts=[];
  const coordinator=createMapRenderCoordinator({ requestFrame: fn=>frames.push(fn), prepareView: ()=>({}), renderers:{labelLayout:()=>layouts.push('layout')} });
  coordinator.beginInteraction(); coordinator.invalidate(MAP_RENDER_DIRTY.LABEL_LAYOUT,'quality'); frames.shift()(); assert.equal(layouts.length,0);
  coordinator.endInteraction(); frames.shift()(); assert.equal(layouts.length,1);
});
});

// Original feature contract: place-million.test.mjs
contractSuite("place-million", () => {
const assert=__dep0.default;
const test=__dep1.default;
const { mkdtemp, readFile, rm }=__dep8;
const { tmpdir }=__dep9;
const { join }=__dep10;
const { createServer }=__dep11;
const { Worker }=__dep12;
const { once }=__dep13;
const { buildSyntheticPlaces }=__dep14;
const { createWorkerRpcClient }=__dep15;
const { PLACE_LIMITS }=__dep4;
const { placeView }=__dep16;
const { createFrameProjectors }=__dep17;
const { placeLabelDimensions, automaticLabelSettings }=__dep6;
const { layoutLabels }=__dep6;

test('one million synthetic places use bounded actual Worker viewport queries and main layout', {timeout:120000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pandolab-place-million-')); const started=performance.now();
  let server,worker,rpc;
  t.after(async()=>{rpc?.stop();if(worker)await worker.terminate();server?.close();server?.closeAllConnections();await rm(directory,{recursive:true,force:true});});
  const manifest=await buildSyntheticPlaces(1_000_000,directory);
  assert.equal(manifest.revision,'synthetic-1000000');
  const buildMs=performance.now()-started;
  server=createServer(async(req,res)=>{
    try { const bytes=await readFile(join(directory,new URL(req.url,'http://localhost').pathname.slice(1)));const range=/bytes=(\d+)-(\d+)/u.exec(req.headers.range||'');
      if(range){const start=Number(range[1]),end=Number(range[2]);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));}
      else{res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);}
    }catch{res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  worker=new Worker(new URL('../helpers/place-worker-thread.mjs',import.meta.url),{type:'module',workerData:{assetRevision:'place-million-fixture'}});await once(worker,'message');
  const adapter={postMessage:message=>worker.postMessage(message),terminate:()=>worker.terminate()};
  worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));
  rpc=createWorkerRpcClient({createWorker:()=>adapter,defaultTimeoutMs:15000});
  const manifestUrl=`http://127.0.0.1:${server.address().port}/manifest.json`,queryTimes=[],layoutTimes=[];
  for(let i=0;i<24;i++){
    const view=placeView({projection:i%3===0?'globe':'flat',threshold:i%6===0?0:12,width:1440,height:900,scale:i%6===0?250:16000,flatCenter:[-170+i*14,35],rotation:[170-i*14,-35,i%4*15]});
    const begin=performance.now();const {result}=await rpc.request('place.viewport',{manifestUrl,view});queryTimes.push(performance.now()-begin);
    assert.ok(result.records.length<=PLACE_LIMITS.candidates);assert.ok(result.tileCount<=PLACE_LIMITS.queryTiles);assert.ok(result.cacheBytes<=PLACE_LIMITS.cacheBytes);assert.ok(result.peakWorkingRecords<=PLACE_LIMITS.candidates+4*PLACE_LIMITS.tileRecords);
    const projector=createFrameProjectors(view.projectionFrame);
    const candidates=result.records.map(record=>({key:record.id,point:projector.projectVisibleCoordinate(record.coordinates),...placeLabelDimensions(record.name),...automaticLabelSettings(record.kind)}));
    const layoutStart=performance.now();const placed=layoutLabels(candidates);layoutTimes.push(performance.now()-layoutStart);assert.ok(placed.length<=PLACE_LIMITS.layoutCandidates);
  }
  const search=await rpc.request('place.search',{manifestUrl,query:'Synthetic 0999999'});assert.equal(search.result.records[0].sourceId,'999999');
  const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
  assert.ok(p95(layoutTimes)<50,`main layout p95 ${p95(layoutTimes)}ms`);assert.ok(p95(queryTimes)<1500,`Worker query p95 ${p95(queryTimes)}ms`);
  t.diagnostic(JSON.stringify({count:1_000_000,buildMs,workerQueryP95Ms:p95(queryTimes),layoutP95Ms:p95(layoutTimes),tileCount:Object.keys(manifest.tiles).length}));
});
});
