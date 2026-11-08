import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {createGeometryVersionStore,geometryReferenceFor} from "../../../src/geometry/geometry-version-store.js";
import {createBoundaryDeltaSender} from "../../../tools/w2-p6-3-boundary-delta-sender.mjs";
import {injectBoundaryDeltaWorker} from "../../../tools/w2-p6-3-worker-bridge.mjs";

const originalUrl=new URL("../../../src/rendering/workers/country-shared-boundary-worker.js",import.meta.url);
const moduleRoot=new URL("../../../src/runtime/",import.meta.url).href;
const nodeCoreUrl=new URL("../../../tools/build/load-spherical-core.mjs",import.meta.url).href;
const original=readFileSync(originalUrl,'utf8');
const workerCode=injectBoundaryDeltaWorker(original.replaceAll('../modules/',moduleRoot));
const rect=(left,right)=>({type:'Polygon',coordinates:[
  [[left,0],[right,0],[right,1],[left,1],[left,0]],
]});
function geometries(){
  const store=createGeometryVersionStore([
    {id:'g-a',version:1,geojson:rect(0,1)},
    {id:'g-b',version:1,geojson:rect(1,2)},
    {id:'g-b-new',version:2,geojson:rect(4,5)},
    {id:'g-child',version:1,geojson:rect(0,0.5)},
  ]);
  return name=>store.get({id:name,version:name==='g-b-new'?2:1});
}
const get=geometries();
const feat=(id,geometry,{parentId='',rootId,entityKind='general',name=id}={})=>({
  type:'Feature',id,geometry,properties:{entityKind,parentId,name,metadata:{large:'not needed by boundary'}},
  ...(rootId?{boundaryRootId:rootId}:{}),
});
const basic=()=>[feat('A',get('g-a')),feat('B',get('g-b'))];
const msg=(requestId,features,{generation=requestId,quality='canonical',outline=true}={})=>({
  type:'replace',requestId,projectGeneration:generation,geometryRevision:requestId,
  quality,includeOutlines:outline,cacheUrl:null,skipCacheReconcile:false,features,
  removedIds:[],
});

function createWorker(t,delta=true){
  const code=delta?workerCode:original.replaceAll('../modules/',moduleRoot);
  const dataUrl='data:text/javascript,'+encodeURIComponent(code);
  const boot=[
    "import {parentPort} from 'node:worker_threads';",
    'globalThis.self={location:{href:'+JSON.stringify(originalUrl.href)+
      '},postMessage:(data,transfers)=>parentPort.postMessage(data,transfers)};',
    'await import('+JSON.stringify(nodeCoreUrl)+');',
    'await import('+JSON.stringify(dataUrl)+');',
    "parentPort.on('message',data=>self.onmessage({data}));",
  ].join('\n');
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(boot)));
  t.after(()=>worker.terminate());
  const history=[],waiters=[];
  worker.on('message',message=>{
    history.push(message);
    for(const waiter of [...waiters]){
      if(waiter.predicate(message)){
        clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);
        waiter.resolve(message);
      }
    }
  });
  const pending=predicate=>{
    const old=history.find(predicate);
    if(old)return Promise.resolve(old);
    return new Promise((resolve,reject)=>{
      const waiter={predicate,resolve,reject};
      waiter.timer=setTimeout(()=>{
        const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);
        reject(Error('P6-3 Worker output timed out'));
      },20000);
      waiters.push(waiter);
    });
  };
  worker.on('error',error=>{for(const waiter of waiters)waiter.reject(error);});
  return{worker,pending,send:data=>worker.postMessage(data),history};
}
const next=(host,id)=>host.pending(row=>row.type==='prepared'&&row.requestId===id);

test('P6-3 sender references only the same immutable branded geometry allocation',()=>{
  const rows=basic(),messages=[],events=[];
  const sender=createBoundaryDeltaSender({sendNative:v=>messages.push(v),
    geometryReferenceFor,onSample:e=>events.push(e)});
  sender.send(msg(1,rows));
  assert.equal(messages[0].type,'replace');
  assert.equal(sender.status().pending,true);
  sender.receive({type:'prepared',requestId:1,projectGeneration:1,
    geometryRevision:1,quality:'canonical',p6BaseToken:'verified-token'});
  assert.equal(sender.status().baseline,true);
  sender.send(msg(2,rows.map(row=>({...row,properties:{...row.properties,name:'updated'}}))));
  assert.equal(messages[1].type,'p6-delta-v1');
  assert.equal(messages[1].features.filter(row=>row.mode==='reuse').length,2);
  assert.ok(!('geometry' in messages[1].features[0]));
  assert.equal(messages[1].features[0].properties.entityKind,'general');
  assert.equal(messages[1].features[0].properties.parentId,'');
  sender.receive({type:'prepared',requestId:2,projectGeneration:2,
    geometryRevision:2,quality:'canonical',p6BaseToken:'verified-token-2'});
  const changed=basic();changed[1].geometry=get('g-b-new');
  sender.send(msg(3,changed));
  assert.equal(messages[2].type,'p6-delta-v1');
  assert.deepEqual(messages[2].features.map(x=>x.mode),['reuse','full']);
  sender.receive({type:'prepared',requestId:2,projectGeneration:2,
    geometryRevision:2,quality:'canonical',p6BaseToken:'old'});
  assert.equal(sender.status().pending,true);
  sender.invalidate('worker restarted');
  sender.send(msg(4,basic()));
  assert.equal(messages[3].type,'replace');
  assert.ok(events.some(e=>e.event==='ignored-stale-ack'));
  assert.ok(events.some(e=>e.event==='invalidate'));
});

test('P6-3 real C++ Worker full→delta→changed geometry and hierarchy matches fresh full packets',async t=>{
  const worker=createWorker(t,true),raw=createWorker(t,false);
  const sent=[],events=[];
  const sender=createBoundaryDeltaSender({
    sendNative:data=>{sent.push(data);worker.send(data);},
    geometryReferenceFor,onSample:value=>events.push(value),
  });
  const run=async input=>{
    const promise=next(worker,input.requestId);
    sender.send(input);
    const received=await promise;
    sender.receive(received);
    assert.equal(received.requestId,input.requestId);
    assert.equal(received.projectGeneration,input.projectGeneration);
    assert.equal(received.geometryRevision,input.geometryRevision);
    assert.equal(received.quality,input.quality);
    assert.ok(received.p6BaseToken);
    const fresh=next(raw,input.requestId);
    raw.send(input);
    const reference=await fresh;
    assert.deepEqual(received.packet,reference.packet,
      'reused and changed geometry must reproduce all C++ segments, owners and transferred TypedArrays');
    return received;
  };
  const first=await run(msg(1,basic()));
  assert.equal(first.packetCacheHit,false);
  const same=await run(msg(2,basic().map(feature=>({...feature,
    properties:{...feature.properties,name:'renamed',metadata:{news:1}}}))));
  assert.equal(sent[1].type,'p6-delta-v1');
  assert.deepEqual(sent[1].features.map(x=>x.mode),['reuse','reuse']);
  assert.equal(same.packetCacheHit,true);
  const moved=basic();moved[1].geometry=get('g-b-new');
  const third=await run(msg(3,moved));
  assert.deepEqual(sent[2].features.map(x=>x.mode),['reuse','full']);
  assert.equal(third.packetCacheHit,false);
  const root=basic();root.push(feat('CHILD',get('g-child'),{parentId:'A',rootId:'A'}));
  await run(msg(4,root));
  assert.equal(sent[3].type,'p6-delta-v1');
  assert.deepEqual(sent[3].features.map(x=>x.mode),['reuse','full','full']);
  const childUpdated=root.map(f=>f.id==='CHILD'?{...f,boundaryRootId:'CHILD'}:f);
  await run(msg(5,childUpdated));
  assert.equal(sent[4].features.filter(x=>x.mode==='reuse').length,3);
  const deleted=basic();
  await run(msg(6,deleted,{quality:'preview',outline:false}));
  assert.equal(sent[5].type,'p6-delta-v1');
  assert.equal(sent[5].features.length,2);
  assert.equal(worker.history.filter(x=>x.type==='error').length,0);
  assert.equal(events.filter(x=>x.event==='ack').length,6);
});

test('P6-3 bad Worker token requests full resend; stale resync cannot resurrect obsolete work',async t=>{
  const worker=createWorker(t,true),rows=basic();
  worker.send(msg(1,rows));
  const initial=await next(worker,1);
  assert.ok(initial.p6BaseToken);
  const bad={...msg(2,rows),type:'p6-delta-v1',baseToken:'bad-token',
    features:rows.map(row=>({mode:'reuse',id:row.id,properties:{
      entityKind:row.properties.entityKind,parentId:row.properties.parentId}}))};
  worker.send(bad);
  const rejected=await worker.pending(x=>x.type==='p6-resync-required'&&x.requestId===2);
  assert.equal(rejected.reason,'unknown-or-old-base-token');
  assert.equal(worker.history.filter(x=>x.type==='prepared'&&x.requestId===2).length,0);
  const outgoing=[],bridge=createBoundaryDeltaSender({
    geometryReferenceFor,sendNative:x=>{outgoing.push(x);worker.send(x);}});
  bridge.send(msg(3,rows));
  const updated=await next(worker,3);bridge.receive(updated);
  bridge.send(msg(4,rows));
  assert.equal(outgoing[1].type,'p6-delta-v1');
  assert.equal(bridge.receive({type:'p6-resync-required',requestId:4,
    projectGeneration:4,geometryRevision:4,quality:'canonical',
    reason:'unknown-or-old-base-token'}),true);
  assert.equal(outgoing[2].type,'replace');
  const accepted=await next(worker,4);
  bridge.receive(accepted);
  assert.equal(bridge.status().baseline,true);
  assert.equal(bridge.receive({type:'p6-resync-required',requestId:2,
    projectGeneration:2,geometryRevision:2}),true);
  assert.equal(outgoing.length,3);
});
