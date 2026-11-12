import test from 'node:test';
import assert from 'node:assert/strict';
import {createGpuTerrainPreparation} from '../../../src/rendering/gpu-terrain-preparation.js';

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
  owner.setContext({gl,ready:true,projectGeneration:1,contextGeneration:1,scheduler:{
    enqueueUpload:job=>new Promise((resolve,reject)=>jobs.push({...job,step:()=>{try{const r=job.step();if(r.done)resolve();return r;}catch(e){reject(e);throw e;}}})),cancelKey:()=>{}}});
  const manifest={representation:'dem-relief-v1',gutter:1,levels:[{id:0,width:8,height:4,columns:1,rows:1,tileSize:8}],
    naturalSurface:{sourceRevision:'a'.repeat(40),mixWeight:0.65,tiles:{'0/0-0.webp':{bytes,sha256:'b'.repeat(64),pixelWidth:10,pixelHeight:6}}}};
  owner.setManifest(manifest);t.after(()=>owner.dispose());
  const drain=async()=>{for(let n=0;n<8;n++){await settle();if(!jobs.length)break;for(const job of jobs.splice(0))while(!job.step().done){}}};
  const readyDem=async(v=view)=>{owner.prepare(frame,v);await settle();for(const request of requests)request.resolve({});await drain();return owner.prepare(frame,v);};
  return {owner,manifest,events,requests,natural,jobs,deleted,drain,readyDem};
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
