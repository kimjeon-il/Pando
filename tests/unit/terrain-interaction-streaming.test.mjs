import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGpuUploadScheduler} from "../../shared/frontend/js/modules/gpu-upload-scheduler.js";
import {createGpuTerrainPreparation} from "../../shared/frontend/js/modules/gpu-terrain-preparation.js";

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

test('visible uploads do not inherit the 500ms quiet delay and yield to pending input',async()=>{
  const c=clock();let calls=0;
  c.scheduler.noteInput(false);c.pending(true);
  const done=c.scheduler.enqueueUpload({key:'visible',allowDuringInteraction:true,step:()=>({done:++calls>0})});
  c.tick();assert.equal(calls,0);c.pending(false);c.tick();assert.equal(calls,1);await done;c.scheduler.dispose();
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

test('high-scale target delays cannot expose a magnified world-base tile',async t=>{
  const f=terrain(t),low={...f.frame,scale:100};f.owner.prepare(low,f.view);
  for(let round=0;round<8;round++){
    const pending=f.requests.splice(0);
    for(const request of pending){if(request.url.includes('/0/'))request.resolve({ok:true,blob:async()=>({})});else f.requests.push(request);}
    await settle();f.c.tick();await settle();f.owner.prepare(low,f.view);
  }
  f.owner.prepare(f.frame,f.view);
  assert.ok(f.owner.stats().terrainTilesLoaded>0);
  assert.equal(f.owner.stats().terrainReady,false);
  assert.deepEqual(f.owner.prepare(f.frame,f.view),[],'sharp target coverage must be complete before either terrain pass appears');
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
