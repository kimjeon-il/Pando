import { describe as contractSuite } from 'node:test';
import * as __terrain_dep0 from "node:test";
import * as __terrain_dep1 from "node:assert/strict";
import * as __terrain_dep2 from "node:fs";
import * as __terrain_dep3 from "../../shared/frontend/js/modules/gpu-upload-scheduler.js";
import * as __terrain_dep4 from "../../shared/frontend/js/modules/gpu-terrain-preparation.js";
import * as __terrain_dep5 from "../../shared/frontend/js/modules/map-visual-frame.js";
import * as __terrain_dep6 from "../../shared/frontend/js/modules/scene-color-cache.js";

// Original feature contract: terrain-interaction-streaming.test.mjs
contractSuite("terrain-interaction-streaming", () => {
const test = __terrain_dep0.default;
const assert = __terrain_dep1.default;
const { readFileSync } = __terrain_dep2;
const { createGpuUploadScheduler } = __terrain_dep3;
const { createGpuTerrainPreparation } = __terrain_dep4;

test('a reusable scene image cannot bypass the canonical current-view terrain preparation',()=>{
  const source=readFileSync(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js",import.meta.url),'utf8');
  const render=source.slice(source.indexOf('function renderWebGl('),source.indexOf('function renderCanvasHydro('));
  const prepare=render.indexOf('prepareTerrain('),cache=render.indexOf('const exactSceneCacheHit');
  assert.ok(prepare>=0&&prepare<cache,'terrain scheduling must run before both exact and reprojected scene-cache shortcuts');
});

function clock() {
  const frames=[];let time=0,pending=false,hidden=false;
  const scheduler=createGpuUploadScheduler({requestFrame:cb=>(frames.push(cb),frames.length),cancelFrame(){},now:()=>time,
    isHidden:()=>hidden,isInputPending:()=>pending});
  return {scheduler,tick(ms=16){time+=ms;frames.shift()?.();},pending(value){pending=value;},hidden(value){hidden=value;}};
}

test('visible uploads make bounded progress during a held gesture without releasing deferred jobs',async()=>{
  const c=clock();let detail=0,background=0;
  c.scheduler.noteInput(true);
  const done=c.scheduler.enqueueUpload({key:'visible',allowDuringInteraction:true,step:()=>({bytes:4*1024*1024,done:++detail===2})});
  const later=c.scheduler.enqueueUpload({key:'background',step:()=>({done:++background>0})});
  c.tick();assert.equal(detail,1,'a decoded visible tile must reach the GPU while the pointer remains down');
  assert.equal(background,0);c.tick();await done;assert.equal(detail,2);assert.equal(background,0);
  c.scheduler.noteInput(false);c.tick(499);assert.equal(background,0);c.tick(1);await later;c.scheduler.dispose();
});

test('visible uploads progress during pending input; optional uploads retain the quiet-period gate',async()=>{
  const c=clock();let calls=0,background=0;
  c.scheduler.noteInput(false);c.pending(true);
  const done=c.scheduler.enqueueUpload({key:'visible',allowDuringInteraction:true,step:()=>({done:++calls>0})});
  const deferred=c.scheduler.enqueueUpload({key:'optional',step:()=>({done:++background>0})});
  c.tick();assert.equal(calls,1,'current-view tile uploads cannot starve during pending input');
  assert.equal(background,0,'unrelated uploads still wait for an idle interval');
  c.pending(false);c.tick(499);assert.equal(background,0);
  c.tick(1);await Promise.all([done,deferred]);
  assert.equal(background,1);c.scheduler.dispose();
});

test('hidden contexts and generation cancellation still prevent visible uploads',async()=>{
  const c=clock();let disposed=false;
  c.hidden(true);
  const done=c.scheduler.enqueueUpload({key:'visible',projectGeneration:7,allowDuringInteraction:true,
    step:()=>assert.fail('hidden/stale tile must not upload'),dispose:()=>{disposed=true;}});
  c.tick();c.scheduler.cancelGeneration(7);await assert.rejects(done,{name:'AbortError'});assert.ok(disposed);c.scheduler.dispose();
});

const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function terrain(t){
  const c=clock(),requests=[],uploads=[];
  const gl={createTexture:()=>({}),createBuffer:()=>({})};
  for(const name of ['deleteTexture','deleteBuffer','bindTexture','pixelStorei','texParameteri','texImage2D','bindBuffer','bufferData'])gl[name]=()=>{};
  t.mock.method(globalThis,'fetch',(url,{signal})=>new Promise((resolve,reject)=>{
    requests.push({url,resolve,signal});signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});
  }));
  globalThis.createImageBitmap=async()=>({width:1024,height:1024,close(){}});
  t.after(()=>{delete globalThis.createImageBitmap;});
  const owner=createGpuTerrainPreparation({tileUrl:spec=>`https://test/${spec.key}`,isMobile:()=>true,
    invalidate:reason=>uploads.push(reason),geoDistance:()=>0});
  owner.setContext({gl,ready:true,scheduler:c.scheduler,projectGeneration:1,contextGeneration:1});
  owner.setManifest({representation:'raster-rgba-v1',gutter:0,levels:[
    {id:0,width:2048,height:1024,columns:2,rows:1,tileSize:1024},
    {id:1,width:8192,height:4096,columns:8,rows:4,tileSize:1024},
  ]});
  const frame={mode:1,scale:1000,dpr:1,viewport:[200,200],viewState:{projection:'flat',projectionCenter:[0,0]}};
  const view={visible:true,physicalStyle:'political',projection:'flat',flatCenter:[0,0],width:200,height:200,devicePixelRatio:1,cacheBudgetBytes:32*1024*1024};
  t.after(()=>{owner.dispose();c.scheduler.dispose();});
  return {c,owner,requests,uploads,frame,view,gl};
}

test('same terrain and graphics context survive project replacement without reloading or uploading',async t=>{
  const f=terrain(t);f.owner.prepare(f.frame,f.view);
  for(let round=0;round<16&&!f.owner.stats().terrainReady;round++){
    for(const request of f.requests.splice(0))request.resolve({ok:true,blob:async()=>({})});
    await settle();f.c.tick();await settle();f.owner.prepare(f.frame,f.view);
  }
  const before=f.owner.stats();assert.equal(before.terrainReady,true);
  f.owner.setContext({gl:f.gl,ready:true,scheduler:f.c.scheduler,projectGeneration:2,contextGeneration:1});
  const drawn=f.owner.prepare(f.frame,f.view),after=f.owner.stats();
  assert.equal(after.terrainReady,true);
  assert.equal(after.terrainUploadCount,before.terrainUploadCount);
  assert.equal(after.terrainTilesLoaded,before.terrainTilesLoaded);
  assert.notEqual(after.terrainTargetKey,before.terrainTargetKey,'presentation completion still belongs to the new project');
  assert.ok(drawn.every(tile=>tile.spec.level===after.terrainLevel));
});

test('high-scale target delays preserve uploaded coverage without claiming detail readiness',async t=>{
  const f=terrain(t),low={...f.frame,scale:100};f.owner.prepare(low,f.view);
  for(let round=0;round<8;round++){
    const pending=f.requests.splice(0);
    for(const request of pending){if(request.url.includes('/0/'))request.resolve({ok:true,blob:async()=>({})});else f.requests.push(request);}
    await settle();f.c.tick();await settle();f.owner.prepare(low,f.view);
  }
  const coarse=f.owner.prepare(low,f.view);
  assert.deepEqual(coarse.map(tile=>tile.spec.key),['0/0-0','0/1-0']);
  const uploads=f.owner.stats().terrainUploadCount;
  const waiting=f.owner.prepare(f.frame,f.view);
  assert.ok(f.owner.stats().terrainTilesLoaded>0);
  assert.equal(f.owner.stats().terrainReady,false);
  assert.equal(f.owner.stats().terrainTargetTilesLoaded,0);
  assert.deepEqual(waiting.map(tile=>tile.texture),coarse.map(tile=>tile.texture),'already uploaded coverage remains visible while detail is pending');
  assert.equal(f.owner.stats().terrainUploadCount,uploads,'reusing coverage must not upload it again');
  for(let round=0;round<16&&!f.owner.stats().terrainReady;round++){
    for(const request of f.requests.splice(0))request.resolve({ok:true,blob:async()=>({})});
    await settle();f.c.tick();await settle();f.owner.prepare(f.frame,f.view);
  }
  assert.equal(f.owner.stats().terrainReady,true);
  const detailed=f.owner.prepare(f.frame,f.view);
  assert.equal(detailed.length,f.owner.stats().terrainTargetTileCount);
  assert.ok(detailed.every(tile=>tile.spec.level===1),'complete uploaded detail replaces coarse coverage');
});

test('document cancellation cannot discard already decoded terrain uploads',async t=>{
  const f=terrain(t);f.owner.prepare(f.frame,f.view);
  for(const request of f.requests.splice(0))request.resolve({ok:true,blob:async()=>({})});
  await settle();
  assert.ok(f.owner.stats().terrainPendingDecodedBytes>0);
  f.c.scheduler.cancelGeneration(1);
  f.owner.setContext({gl:f.gl,ready:true,scheduler:f.c.scheduler,projectGeneration:2,contextGeneration:1});
  for(let n=0;n<8;n++){f.c.tick();await settle();}
  assert.ok(f.owner.stats().terrainTilesLoaded>0);
});

test('real terrain owner presents downloaded detail before a continuous gesture ends',async t=>{
  const f=terrain(t);f.c.scheduler.noteInput(true);f.owner.prepare(f.frame,f.view);
  for(let round=0;round<16&&!f.owner.stats().terrainReady;round++){
    for(const request of f.requests.splice(0))request.resolve({ok:true,blob:async()=>({})});
    await settle();f.c.tick();await settle();f.owner.prepare(f.frame,f.view);
  }
  assert.equal(f.owner.stats().terrainReady,true,'visible download/decode/upload must not stall behind held input');
  const drawn=f.owner.prepare(f.frame,f.view);assert.ok(drawn.some(tile=>tile.spec.level===1));
});

test('neighbour prefetch cannot start before visible tiles are GPU-ready',async t=>{
  const f=terrain(t);f.owner.prepare(f.frame,f.view);
  const visibleCount=f.owner.stats().terrainTargetTileCount;
  for(let round=0;round<12;round++){
    for(const request of f.requests.splice(0))request.resolve({ok:true,blob:async()=>({})});
    await settle();
    // Downloads finish, but deliberately hold GPU submission.
  }
  assert.equal(f.owner.stats().terrainTargetTilesLoaded,0);
  assert.equal(f.owner.stats().terrainTilesLoading,0,'only base and current tiles may download ahead of visible upload');
  assert.ok(f.owner.stats().terrainPendingDecodedBytes<=(visibleCount+2)*1024*1024*4);
});

test('prefetch uses spare capacity and releases both fetch slots when the current viewport changes',async t=>{
  const f=terrain(t);f.owner.prepare(f.frame,f.view);
  for(let round=0;round<16&&(!f.owner.stats().terrainReady||f.owner.stats().terrainTilesLoaded<f.owner.stats().terrainTargetTileCount+2);round++){
    for(const request of f.requests.splice(0))request.resolve({ok:true,blob:async()=>({})});
    await settle();f.c.tick();await settle();f.owner.prepare(f.frame,f.view);
  }
  assert.equal(f.owner.stats().terrainReady,true);
  const prefetch=f.requests.splice(0);assert.equal(prefetch.length,2,'24MiB current coverage leaves room for two 4MiB neighbours');
  f.owner.prepare({...f.frame,viewState:{...f.frame.viewState,projectionCenter:[140,0]}},{...f.view,flatCenter:[140,0]});
  await settle();assert.ok(prefetch.every(request=>request.signal.aborted));assert.equal(f.requests.length,2);
  assert.equal(f.owner.stats().terrainFailureCount,0);
});
});

// Original feature contract: renderer-responsiveness-source.test.mjs
contractSuite("renderer-responsiveness-source", () => {
const test = __terrain_dep0.default;
const assert = __terrain_dep1.default;
const { createMapVisualFrame, isMapVisualFrame } = __terrain_dep5;
const { createSceneColorCache } = __terrain_dep6;
const { createGpuUploadScheduler } = __terrain_dep3;

test('changing the camera changes the immutable Viewer frame, not the caller-owned view input', () => {
  const viewState = {projection: 'flat', size: {width: 640, height: 480}, dpr: 2,
    translate: [320, 240], scale: 150, projectionCenter: [0, 0]};
  const original = structuredClone(viewState);
  const frame = createMapVisualFrame({frameId: 1, viewRevision: 1, projectGeneration: 1, viewState});
  assert.ok(isMapVisualFrame(frame));
  assert.ok(Object.isFrozen(frame) && Object.isFrozen(frame.cssViewport));
  assert.deepEqual(frame.cssViewport, [viewState.size.width, viewState.size.height]);
  assert.deepEqual(frame.gpuViewport, frame.cssViewport.map(value => value * viewState.dpr));
  assert.deepEqual(frame.projectVisibleCoordinate([0, 0]), viewState.translate);
  const previousSignature = frame.signature;
  viewState.projectionCenter = [20, 0];
  const moved = createMapVisualFrame({frameId: 2, viewRevision: 2, projectGeneration: 1, viewState});
  assert.notEqual(moved.signature, previousSignature);
  assert.deepEqual(frame.projectVisibleCoordinate([0, 0]), original.translate,
    'a previous frame must retain its original camera');
  assert.notDeepEqual(moved.projectCoordinate([0, 0]), frame.projectCoordinate([0, 0]));
});

test('invalidated scene-cache state cannot be mistaken for an accepted visual frame', () => {
  const cache = createSceneColorCache();
  assert.equal(cache.isValid(), false);
  assert.equal(cache.canComposite('current-view', 1), false);
  cache.invalidate('territorial-input-updated');
  assert.equal(cache.stats().lastInvalidationReason, 'territorial-input-updated');
  assert.equal(cache.canComposite('current-view', 1), false);
  cache.reset({dropActive: true});
  assert.equal(cache.isValid(), false);
  cache.dispose();
  assert.equal(cache.isAvailable(), false);
});

test('a failed GPU upload releases its resource and lets the next current-frame upload proceed', async () => {
  const frames = [], disposed = [];
  const scheduler = createGpuUploadScheduler({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    cancelFrame() {}, now: () => 0, isHidden: () => false, isInputPending: () => false,
  });
  const old = scheduler.enqueueUpload({key: 'current-background', priority: 10,
    step: () => { throw new Error('current upload failed'); },
    dispose: () => disposed.push('failed')});
  frames.shift()();
  await assert.rejects(old, /current upload failed/);
  assert.deepEqual(disposed, ['failed']);
  assert.equal(scheduler.getStats().pending, 0);
  const accepted = scheduler.enqueueUpload({key: 'current-background',
    step: ({byteBudget}) => ({done: true, bytes: Math.min(byteBudget, 1024), value: 'presentable'})});
  frames.shift()();
  assert.equal(await accepted, 'presentable');
  assert.equal(scheduler.getStats().completed, 1);
  scheduler.dispose();
});
});
