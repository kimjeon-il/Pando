import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { createPlaceRuntime } from "../../shared/frontend/js/modules/place-runtime.js";
import { normalizePlace } from "../../shared/frontend/js/modules/place-contract.js";
import { createPhysicalResources } from "../../shared/frontend/js/modules/physical-resources.js";

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const place=id=>normalizePlace({source:'synthetic',sourceId:id,name:id,kind:'city',coordinates:[0,0]});
const evaluate=refs=>typeof refs==='function' ? refs():refs;

test('a builtin place snapshot publishes after identity admission and cancels a held obsolete publication',async t=>{
  const jobs=[],admissions=[],published=[];
  const runtime=createPlaceRuntime({rpc:{request(){const job=deferred();jobs.push(job);return job.promise;},stop(){}},
    admitReferences:refs=>{const ack=deferred();admissions.push({refs:evaluate(refs),...ack});return ack.promise;},
    onSnapshot:value=>published.push(value)});
  t.after(()=>runtime.dispose());
  const first=runtime.prepare({threshold:1});await tick();
  jobs[0].resolve({result:{records:[place('old')],signature:'old'}});await tick();
  assert.equal(runtime.snapshot().signature,'empty');assert.equal(published.length,0);
  runtime.beginInteraction();const next=runtime.settle({threshold:2});await tick();
  jobs[1].resolve({result:{records:[place('current')],signature:'current'}});await tick();
  admissions[0].resolve();await tick();
  assert.deepEqual(admissions[1].refs,[],'cancelled candidate is removed before another publication');
  admissions[1].resolve();await tick();
  assert.equal(await first,false);assert.equal(published.length,0);
  assert.equal(admissions[2].refs[0].id,place('current').id);
  admissions[2].resolve();assert.equal(await next,true);
  assert.deepEqual(published.map(row=>row.signature),['current']);
  assert.deepEqual(runtime.selectionReferences(),admissions[2].refs);
});

test('search completions retain both accepted results when the first core admission is held',async t=>{
  const jobs=[],admissions=[];
  const runtime=createPlaceRuntime({rpc:{request(){const job=deferred();jobs.push(job);return job.promise;},stop(){}},
    admitReferences:refs=>{const ack=deferred();admissions.push({refs:evaluate(refs),...ack});return ack.promise;}});
  t.after(()=>runtime.dispose());
  const first=runtime.search('A');await tick();jobs[0].resolve({result:{records:[place('A')]}});await tick();
  const second=runtime.search('B');await tick();jobs[1].resolve({result:{records:[place('B')]}});await tick();
  assert.equal(admissions.length,1);assert.equal(runtime.resolve(place('A').id),null);
  admissions[0].resolve();await first;await tick();
  assert.deepEqual(admissions[1].refs.map(row=>row.id),[place('A').id,place('B').id]);
  assert.equal(runtime.resolve(place('A').id).name,'A');assert.equal(runtime.resolve(place('B').id),null);
  admissions[1].resolve();await second;
  assert.equal(runtime.resolve(place('B').id).name,'B');
  assert.deepEqual(runtime.selectionReferences(),admissions[1].refs);
});

test('project replacement rejects a place publication without an asset failure and permits retry',async t=>{
  let rejectAdmission=true;const errors=[];
  const runtime=createPlaceRuntime({rpc:{request:async()=>({result:{records:[place('A')],signature:'A'}}),stop(){}},
    admitReferences:async()=>{if(rejectAdmission)throw Object.assign(new Error('replaced'),{code:'PL-CORE-STALE'});},
    onError:error=>errors.push(error)});
  t.after(()=>runtime.dispose());
  assert.equal(await runtime.prepare({threshold:1}),false);assert.equal(runtime.snapshot().signature,'empty');
  assert.deepEqual(errors,[]);rejectAdmission=false;
  assert.equal(await runtime.prepare({threshold:1}),true);assert.equal(runtime.snapshot().signature,'A');
});

test('full hydro hydration preserves the renderer descriptor identity and awaits logical identity admission',async()=>{
  const descriptor={id:'fragment:7',__fid:7,properties:{pandolab_id:'river:logical',layer_id:'rivers'},geometry:null};
  const cache=new Map([['river:logical',descriptor]]),ack=deferred();let refs;
  const physical=createPhysicalResources();physical.connect({projectState:{state:{hydroFeatureCache:cache}},
    hydroPresentation:{allBuiltInHydroFeatures:()=>[...cache.values()],HYDRO_LAYER_META:{rivers:{category:'river'}},
      hydroCategoryKey:category=>category},
    domains:{projectDomain:{admitSelectionCatalog(domain,producer){assert.equal(domain,'hydroBuiltin');refs=evaluate(producer);return ack.promise;}}}});
  const full={id:'feature:logical',properties:{pandolab_id:'river:logical',layer_id:'rivers',source_id:'7,8'},
    geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}};
  let accepted=false;const pending=physical.admitHydroFeatures([full]).then(()=>{accepted=true;});await tick();
  assert.equal(accepted,false);assert.equal(cache.get('river:logical'),descriptor);assert.equal(descriptor.__fid,7);
  assert.equal(descriptor.geometry,full.geometry);
  assert.deepEqual(refs,[{domain:'hydroBuiltin',type:'river',id:'river:logical',logicalId:'river:logical',sourceIds:['7','8']}]);
  ack.resolve();await pending;assert.equal(accepted,true);
});
