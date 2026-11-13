import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuTerrainPreparation} from '../../../src/rendering/gpu-terrain-preparation.js';
import {createGpuNaturalSurfaceCache} from '../../../src/rendering/gpu-natural-surface-cache.js';
import {readFileSync} from 'node:fs';

const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const frame={mode:1,scale:1,dpr:1,viewport:[8,4],viewState:{projection:'flat',projectionCenter:[0,0]}};
const view={visible:true,physicalStyle:'physical',projection:'flat',flatCenter:[0,0],width:8,height:4,devicePixelRatio:1,cacheBudgetBytes:32*1024*1024};
function fixture(t,{naturalFailure=false,bytes=240}={}){
  const events=[],jobs=[],deleted=[],requests=[],natural=[];
  const previous=globalThis.createImageBitmap;
  globalThis.createImageBitmap=async()=>({width:10,height:6,close(){events.push('bitmap-close');}});
  t.after(()=>{if(previous)globalThis.createImageBitmap=previous;else delete globalThis.createImageBitmap;});
  let nextId=0;
  const gl={createTexture:()=>({id:++nextId}),deleteTexture:x=>deleted.push(x),createBuffer:()=>({}),
    getParameter:()=>0,isContextLost:()=>false};
  for(const name of ['bindTexture','pixelStorei','texParameteri','texImage2D','bindBuffer','bufferData','deleteBuffer'])gl[name]=()=>{};
  const owner=createGpuTerrainPreparation({readTile:(spec,signal)=>new Promise((resolve,reject)=>requests.push({spec,signal,resolve,reject})),
    readNaturalTile:(spec,manifest,signal)=>new Promise((resolve,reject)=>{natural.push({spec,manifest,signal,resolve,reject});if(naturalFailure)reject(Error('natural failed'));}),
    isMobile:()=>false,geoDistance:()=>0,invalidate:r=>events.push(r),onUnusable:r=>events.push('unusable:'+r),onTileFailure:r=>events.push('dem-failure:'+r)});
  const scheduler={enqueueUpload:job=>new Promise((resolve,reject)=>jobs.push({...job,
    step:()=>{try{const result=job.step();if(result.done)resolve();return result;}catch(error){reject(error);throw error;}}})),
    cancelKey:()=>{}};
  owner.setContext({gl,ready:true,projectGeneration:1,contextGeneration:1,scheduler});
  const manifest={representation:'dem-relief-v1',gutter:1,levels:[{id:0,width:8,height:4,columns:1,rows:1,tileSize:8}],
    naturalSurface:{sourceRevision:'a'.repeat(40),mixWeight:0.65,tiles:{'0/0-0.webp':{bytes,sha256:'b'.repeat(64),pixelWidth:10,pixelHeight:6}}}};
  owner.setManifest(manifest);t.after(()=>owner.dispose());
  const drain=async()=>{for(let n=0;n<8;n++){await settle();if(!jobs.length)break;for(const job of jobs.splice(0))while(!job.step().done){/* Drain the shared scheduler. */}}};
  const readyDem=async(v=view)=>{owner.prepare(frame,v);await settle();for(const request of requests)request.resolve({});await drain();return owner.prepare(frame,v);};
  return {owner,manifest,events,requests,natural,jobs,deleted,drain,readyDem,gl,scheduler};
}

test('natural GPU work waits for visible DEM and never replaces DEM readiness',async t=>{
  const f=fixture(t);f.owner.prepare(frame,view);await settle();
  assert.equal(f.natural.length,0,'DEM has priority');
  const prepared=await f.readyDem();await settle();
  assert.equal(f.owner.stats().terrainReady,true);
  assert.equal(f.natural.length,1,'visible colored DEM requests natural source');
  assert.equal(prepared[0].naturalTexture,null);
  f.natural[0].resolve({});await f.drain();
  const complete=f.owner.prepare(frame,view);
  assert.ok(complete[0].naturalTexture,'uploaded natural texture reaches drawing records');
  assert.equal(complete[0].naturalMixWeight,0.65);
  assert.equal(f.owner.stats().terrainNaturalSourceRevision,'a'.repeat(40));
  assert.equal(f.owner.stats().terrainMemoryBudgetBytes,32*1024*1024);
  assert.equal(f.owner.stats().terrainNaturalCacheBytes,240);
  assert.equal(f.owner.stats().terrainCacheBytes,480,'DEM and optional texture use one declared budget');
  assert.ok(f.events.includes('terrain-natural-ready'));
});

test('natural texture is reused through light-dark and monochrome roundtrip',async t=>{
  const f=fixture(t);await f.readyDem();await settle();assert.equal(f.natural.length,1);
  f.natural[0].resolve({});await f.drain();
  const first=f.owner.prepare(frame,view)[0].naturalTexture;
  assert.ok(first);
  assert.equal(f.owner.prepare(frame,{...view,theme:'dark'})[0].naturalTexture,first);
  assert.equal(f.owner.prepare(frame,{...view,physicalStyle:'political'})[0].naturalTexture,null);
  assert.equal(f.owner.prepare(frame,view)[0].naturalTexture,first);
  assert.equal(f.natural.length,1);
});

test('monochrome and missing coverage perform no optional network work',async t=>{
  const f=fixture(t);await f.readyDem({...view,physicalStyle:'political'});await settle();
  assert.equal(f.natural.length,0);
  assert.equal(f.owner.stats().terrainNaturalCacheBytes,0);
  assert.equal(f.owner.stats().terrainReady,true);
});

test('failed natural source keeps usable DEM and does not activate Canvas fallback',async t=>{
  const f=fixture(t,{naturalFailure:true});await f.readyDem();await settle();
  assert.equal(f.natural.length,1);
  assert.equal(f.owner.stats().terrainReady,true);
  assert.equal(f.owner.stats().terrainNaturalFailures,1);
  assert.equal(f.owner.prepare(frame,view)[0].naturalTexture,null);
  assert.ok(!f.events.some(x=>x.startsWith('unusable:')||x.startsWith('dem-failure:')));
  await settle();assert.equal(f.natural.length,1,'no per-frame retry storm');
});

test('context/source reset cancels natural decode and rejects late publication',async t=>{
  const f=fixture(t);await f.readyDem();await settle();assert.equal(f.natural.length,1);
  const request=f.natural[0];f.owner.reset();assert.equal(request.signal.aborted,true);
  request.resolve({});await f.drain();
  assert.equal(f.owner.stats().terrainNaturalCacheBytes,0);
  assert.equal(f.owner.stats().terrainNaturalTilesLoaded,0);
  assert.ok(!f.events.includes('terrain-natural-ready'));
});

test('hiding terrain cancels optional fetch without destroying DEM',async t=>{
  const f=fixture(t);await f.readyDem();await settle();assert.equal(f.natural.length,1);
  const request=f.natural[0];f.owner.prepare(frame,{...view,visible:false});
  assert.equal(request.signal.aborted,true);
  request.resolve({});await f.drain();
  assert.equal(f.owner.stats().terrainNaturalCacheBytes,0);
  assert.ok(f.owner.stats().terrainCacheBytes>=240);
});


test('optional catalog admission retains uploaded DEM and invalidates only natural source',async t=>{
  const f=fixture(t);await f.readyDem();await settle();
  const initial=f.owner.stats();
  const originalNatural=f.natural[0];
  const changed={...f.manifest,naturalSurface:{...f.manifest.naturalSurface,
    sourceRevision:'c'.repeat(40)}};
  f.owner.setManifest(changed);
  assert.equal(originalNatural.signal.aborted,true,'old natural request must be cancelled');
  const prepared=f.owner.prepare(frame,view);
  await settle();
  assert.equal(prepared.length,1,'already prepared DEM remains drawable');
  assert.equal(f.owner.stats().terrainUploadCount,initial.terrainUploadCount);
  assert.equal(f.owner.stats().terrainTilesLoaded,initial.terrainTilesLoaded);
  assert.equal(f.requests.length,1,'adding/changing optional natural metadata never re-fetches DEM');
  assert.equal(f.natural.length,2,'new natural identity is requested once');
  originalNatural.resolve({});await f.drain();
  assert.equal(f.owner.stats().terrainNaturalTilesLoaded,0,'late old surface must be ignored');
  f.natural[1].resolve({});await f.drain();
  assert.ok(f.owner.prepare(frame,view)[0].naturalTexture);
});

test('the real terrain draw path uploads sparse natural edge uniforms every draw',()=>{
  const source=readFileSync(new URL('../../../src/rendering/gpu-map-renderer.js',import.meta.url),'utf8');
  assert.match(source,/gl\.uniform4f\(cachedUniformLocation\(program,'uNaturalFadeEdges'\)/);
  assert.match(source,/hasNatural \? naturalFadeEdges\[0\] : 0/);
  assert.match(source,/hasNatural \? naturalFadeEdges\[3\] : 0/);
});

test('32/64/128 MiB device budgets include both DEM and optional natural residency',async t=>{
  for(const mebibytes of [32,64,128]){
    await t.test(mebibytes+' MiB',async t2=>{
      const f=fixture(t2),local={...view,cacheBudgetBytes:mebibytes*1024*1024};
      await f.readyDem(local);
      assert.equal(f.natural.length,1);
      f.natural[0].resolve({});await f.drain();
      f.owner.prepare(frame,local);
      const stats=f.owner.stats();
      assert.equal(stats.terrainReady,true);
      assert.ok(stats.terrainCacheBytes+stats.terrainPendingDecodedBytes+stats.terrainNaturalPendingBytes<=local.cacheBudgetBytes);
      assert.equal(stats.terrainNaturalCacheBytes,240);
      assert.equal(stats.terrainCacheBytes,480);
      assert.equal(stats.terrainDemCacheBytes,240);
      assert.equal(stats.terrainMemoryBudgetBytes,local.cacheBudgetBytes);
    });
  }
});

test('tightening the shared budget evicts optional surface, invalidates it and retains required DEM',async t=>{
  const f=fixture(t);
  await f.readyDem();f.natural[0].resolve({});await f.drain();
  assert.ok(f.owner.prepare(frame,view)[0].naturalTexture);
  const before=f.owner.stats().terrainUploadCount;
  const prepared=f.owner.prepare(frame,{...view,cacheBudgetBytes:240});
  assert.equal(prepared[0].naturalTexture,null);
  const stats=f.owner.stats();
  assert.equal(stats.terrainCacheBytes,240);
  assert.equal(stats.terrainNaturalCacheBytes,0);
  assert.equal(stats.terrainUploadCount,before);
  assert.equal(stats.terrainReady,true);
  assert.ok(f.deleted.length>0);
  assert.ok(f.events.includes('terrain-natural-evicted'));
  f.owner.prepare(frame,{...view,cacheBudgetBytes:240});
  assert.equal(f.natural.length,1,'no repeated natural requests while out of budget');
});

test('WebGL context-loss generation releases optional natural cache without stale uploads',async t=>{
  const f=fixture(t);await f.readyDem();await settle();
  const request=f.natural[0];request.resolve({});await f.drain();
  assert.ok(f.owner.prepare(frame,view)[0].naturalTexture);
  assert.equal(f.owner.stats().terrainNaturalCacheBytes,240);
  f.gl.isContextLost=()=>true;
  f.owner.setContext({gl:f.gl,ready:false,projectGeneration:1,contextGeneration:2,scheduler:f.scheduler});
  const afterLoss=f.owner.stats();
  assert.equal(afterLoss.terrainNaturalCacheBytes,0);
  assert.equal(afterLoss.terrainCacheBytes,0);
  assert.equal(afterLoss.terrainNaturalTilesLoaded,0);
  assert.equal(afterLoss.terrainTilesLoaded,0);
  f.gl.isContextLost=()=>false;
  f.owner.setContext({gl:f.gl,ready:true,projectGeneration:1,contextGeneration:3,scheduler:f.scheduler});
  assert.equal(f.owner.stats().terrainNaturalCacheBytes,0,'no stale texture admitted after restore');
  assert.equal(f.owner.stats().terrainUploadCount,1,'lost generations must not record a replacement upload');
});

test('rapid pan aborts offscreen natural fetch and never uploads its late result',async t=>{
  const old=globalThis.createImageBitmap,read=[],jobs=[],deleted=[],events=[];
  globalThis.createImageBitmap=async()=>({width:10,height:6,close(){}});
  t.after(()=>{if(old)globalThis.createImageBitmap=old;else delete globalThis.createImageBitmap;});
  let next=0;
  const gl={createTexture:()=>({id:++next}),deleteTexture:x=>deleted.push(x),
    getParameter:()=>0,isContextLost:()=>false};
  for(const name of ['bindTexture','pixelStorei','texParameteri','texImage2D'])gl[name]=()=>{};
  const scheduler={enqueueUpload:job=>new Promise(resolve=>jobs.push({job,resolve})),cancelKey:()=>{}};
  const cache=createGpuNaturalSurfaceCache({readTile:(spec,manifest,signal)=>
    new Promise(resolve=>read.push({spec,signal,resolve})),invalidate:reason=>events.push(reason)});
  t.after(()=>cache.reset());
  const spec=column=>({key:'0/'+column+'-0',level:0,column,row:0,pixelWidth:8,pixelHeight:4});
  const a=spec(0),b=spec(1),options={
    gl,scheduler,contextGeneration:1,enabled:true,requiredReady:true,budgetBytes:32*1024*1024,
    manifest:{gutter:1,naturalSurface:{mixWeight:0.65,
      levels:[{id:0,width:16,height:4,tileSize:8,columns:2,rows:1}],
      tiles:{'0/0-0.webp':{},'0/1-0.webp':{}}}},
  };
  cache.prepare([{spec:a}],options);await settle();
  assert.equal(read.length,1);
  cache.prepare([{spec:b}],options);await settle();
  assert.equal(read.length,2);
  assert.equal(read[0].signal.aborted,true);
  read[0].resolve({});await settle();
  assert.equal(jobs.length,0,'a late offscreen decode must not queue a GPU texture');
  read[1].resolve({});await settle();
  for(const {job,resolve} of jobs.splice(0)){assert.equal(job.step().done,true);resolve();}
  await settle();
  const drawn=[{spec:b}];cache.prepare(drawn,options);
  assert.ok(drawn[0].naturalTexture);
  assert.equal(cache.stats().terrainNaturalTilesLoaded,1);
  assert.equal(cache.stats().terrainNaturalUploadCount,1);
  assert.equal(cache.stats().terrainNaturalRequests,2);
  assert.equal(cache.pendingBytes(),0);
  assert.ok(cache.bytes()<=options.budgetBytes);
  assert.deepEqual(events,['terrain-natural-ready']);
  cache.reset();
  assert.equal(cache.bytes(),0);
  assert.equal(deleted.length,1,'only the actually uploaded texture is deleted');
});

test('realistic 1024px natural tile reservation never exceeds 32/64/128 MiB optional budgets',async t=>{
  const previous=globalThis.createImageBitmap;
  globalThis.createImageBitmap=async()=>({width:1026,height:1026,close(){}});
  t.after(()=>{if(previous)globalThis.createImageBitmap=previous;else delete globalThis.createImageBitmap;});
  const bytes=1026*1026*4;
  for(const mib of [32,64,128]){
    await t.test(mib+' MiB',async()=>{
      const deleted=[],jobs=[];let seq=0;
      const gl={createTexture:()=>({id:++seq}),deleteTexture:tex=>deleted.push(tex),getParameter:()=>0,isContextLost:()=>false};
      for(const name of ['bindTexture','pixelStorei','texParameteri','texImage2D'])gl[name]=()=>{};
      const scheduler={enqueueUpload:job=>new Promise((resolve,reject)=>jobs.push({job,resolve,reject})),cancelKey:()=>{}};
      const tiles=Object.fromEntries(Array.from({length:20},(_,column)=>['0/'+column+'-0.webp',{}]));
      const manifest={gutter:1,naturalSurface:{mixWeight:0.65,
        levels:[{id:0,width:20*1024,height:1024,tileSize:1024,columns:20,rows:1}],tiles}};
      const records=Array.from({length:20},(_,column)=>({spec:{
        key:'0/'+column+'-0',level:0,column,row:0,pixelWidth:1024,pixelHeight:1024}}));
      const cache=createGpuNaturalSurfaceCache({readTile:async()=>({}),invalidate:()=>{}});
      const options={gl,scheduler,manifest,contextGeneration:1,enabled:true,requiredReady:true,budgetBytes:mib*1024*1024};
      cache.prepare(records,options);
      for(let step=0;step<80;step++){
        await settle();
        const tasks=jobs.splice(0);
        for(const task of tasks){
          try{assert.equal(task.job.step().done,true);task.resolve();}
          catch(error){task.reject(error);throw error;}
        }
        if(!tasks.length&&cache.pendingBytes()===0)break;
      }
      cache.prepare(records,options);
      const stats=cache.stats(),capacity=Math.floor(options.budgetBytes/bytes);
      assert.equal(stats.terrainNaturalTilesLoaded,Math.min(20,capacity));
      assert.equal(stats.terrainNaturalCacheBytes,stats.terrainNaturalTilesLoaded*bytes);
      assert.equal(stats.terrainNaturalPendingBytes,0);
      assert.ok(cache.bytes()+cache.pendingBytes()<=options.budgetBytes);
      cache.reset();
      assert.equal(cache.bytes(),0);
      assert.equal(deleted.length,stats.terrainNaturalTilesLoaded);
    });
  }
});


test('adjacent uploaded natural tiles have no artificial interior fade, but uncovered boundaries do',async t=>{
  const previous=globalThis.createImageBitmap;
  globalThis.createImageBitmap=async()=>({width:10,height:6,close(){}});
  t.after(()=>{if(previous)globalThis.createImageBitmap=previous;else delete globalThis.createImageBitmap;});
  const jobs=[],deleted=[];let id=0;
  const gl={createTexture:()=>({id:++id}),deleteTexture:tex=>deleted.push(tex),
    getParameter:()=>0,isContextLost:()=>false};
  for(const name of ['bindTexture','pixelStorei','texParameteri','texImage2D'])gl[name]=()=>{};
  const scheduler={enqueueUpload:job=>new Promise((resolve,reject)=>jobs.push({job,resolve,reject})),cancelKey:()=>{}};
  const manifest={gutter:1,naturalSurface:{mixWeight:.65,
    levels:[{id:0,width:24,height:4,tileSize:8,columns:3,rows:1}],
    tiles:{'0/0-0.webp':{},'0/1-0.webp':{}}}};
  const spec=column=>({key:'0/'+column+'-0',level:0,column,row:0,pixelWidth:8,pixelHeight:4});
  const records=[{spec:spec(0)},{spec:spec(1)}];
  const cache=createGpuNaturalSurfaceCache({readTile:async()=>({}),invalidate:()=>{}});
  t.after(()=>cache.reset());
  const options={gl,scheduler,manifest,contextGeneration:1,enabled:true,requiredReady:true,budgetBytes:32*1024*1024};
  cache.prepare(records,options);
  for(let iteration=0;iteration<10;iteration++){
    await settle();
    for(const item of jobs.splice(0)){
      try{item.job.step();item.resolve();}catch(error){item.reject(error);throw error;}
    }
    if(cache.stats().terrainNaturalTilesLoaded===2)break;
  }
  cache.prepare(records,options);
  assert.equal(cache.stats().terrainNaturalTilesLoaded,2);
  assert.deepEqual(records[0].naturalFadeEdges,[1,0,0,0],
    'uploaded east neighbour must remove internal east fade; west remains uncovered');
  assert.deepEqual(records[1].naturalFadeEdges,[0,1,0,0],
    'uploaded west neighbour must remove internal west fade; east remains uncovered');
  assert.equal(cache.stats().terrainNaturalRequests,2);
  cache.reset();
  assert.equal(deleted.length,2);
});
