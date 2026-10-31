import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
test.use({viewport:{width:1280,height:900},launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test.setTimeout(180000);
test('viewer actual WebGL2 recovery must present the restored map',async({page})=>{
 const trail=[],errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e.stack||e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}));
 await page.addInitScript(()=>{globalThis.__gpuEvents=[];globalThis.__gpuOwner=null;globalThis.__gpuRec=null;});
 await page.route(/\/modules\/gpu-map-renderer\.js(?:\?|$)/,async route=>{
  const response=await route.fetch();
  let src=await response.text();
  const anchor='export function createGpuMapRenderer(';
  if(src.split(anchor).length!==2)throw Error('Renderer observer anchor changed');
  src=src.replace(anchor,'function observedGpuMapRenderer(');
  src+='\nexport function createGpuMapRenderer(...args){const v=observedGpuMapRenderer(...args);globalThis.__gpuOwner=v;return v;}\n';
  await route.fulfill({response,body:src});
 });
 await page.route(/\/modules\/gpu-context-recovery\.js(?:\?|$)/,async route=>{
  const response=await route.fetch();
  let src=await response.text();
  const anchor='export function createGpuContextRecovery(';
  if(src.split(anchor).length!==2)throw Error('Recovery observer anchor changed');
  src=src.replace(anchor,'function observedGpuContextRecovery(');
  src+='\nexport function createGpuContextRecovery(options) {\n'
    +' const log=(event,value)=>{(globalThis.__gpuEvents||=[]).push({event,at:performance.now(),value});};\n'
    +' const wrapped={...options,\n'
    +'  prepare:async t=>{log("prepare-start",{attempt:t.attemptId,context:t.identity?.context,project:t.identity?.project});try{const r=await options.prepare(t);log("prepare-end",{attempt:t.attemptId,base:r?.base?.length});return r;}catch(e){log("prepare-error",{name:e?.name,message:e?.message});throw e;}},\n'
    +'  commit:(...a)=>{try{const r=options.commit(...a);log("commit",r);return r;}catch(e){log("commit-error",e?.message);throw e;}},\n'
    +'  onCommitted:t=>{log("device-ready",{attempt:t.attemptId});return options.onCommitted(t);},\n'
    +'  onFailure:(e,t)=>{log("recovery-failure",{message:e?.message,code:e?.code,ticket:t?.recoveryId,phase:globalThis.__gpuRec?.snapshot()});return options.onFailure(e,t);},\n'
    +'  onFallbackFailure:e=>{log("canvas-failure",{message:e?.message,phase:globalThis.__gpuRec?.snapshot()});return options.onFallbackFailure(e);}\n'
    +' };\n const v=observedGpuContextRecovery(wrapped);globalThis.__gpuRec=v;return v;\n}\n';
  await route.fulfill({response,body:src});
 });
 const snap=()=>page.evaluate(()=>{const r=globalThis.__gpuOwner,g=globalThis.__gpuRec,s=r?.getRuntimeState(),u=r?.getStats({detailed:false});return {at:performance.now(),phase:g?.snapshot(),mode:s?.renderer,project:s?.projectGeneration,canonical:s?.canonicalMeshReady,blocked:s?.projectRenderBlocked,quality:s?.surfacePresentation?.quality,firstCountry:s?.firstCountryPublishedMs,sceneCache:s?.sceneCacheValid,upload:u?.uploads,events:globalThis.__gpuEvents,lastFrame:u?.lastCommittedVisualFrameId,readiness:s?.mapReadiness?.status};});
 let output={};
 try{
  await page.goto('/?renderer=webgl2&debug=1',{waitUntil:'domcontentloaded'});
  await expect.poll(async()=>{const s=await snap();return !!(s.mode==='webgl2'&&s.canonical&&s.firstCountry!==null&&s.firstCountry!==undefined);},{timeout:90000}).toBe(true);
  output.initial=await snap();trail.push(output.initial);
  const available=await page.evaluate(()=>{
   const d=globalThis.__gpuOwner?.getRenderDevice(),ext=d?.gl.getExtension('WEBGL_lose_context');
   if(!ext)return false;globalThis.__gpuExtension=ext;globalThis.__gpuLost=false;globalThis.__gpuRestored=false;
   d.canvas.addEventListener('webglcontextlost',()=>globalThis.__gpuLost=true,{once:true});
   d.canvas.addEventListener('webglcontextrestored',()=>globalThis.__gpuRestored=true,{once:true});
   ext.loseContext();return true;
  });
  expect(available,'real WEBGL_lose_context required').toBe(true);
  await expect.poll(()=>page.evaluate(()=>globalThis.__gpuLost),{timeout:10000}).toBe(true);
  output.lost=await snap();
  await page.evaluate(()=>globalThis.__gpuExtension.restoreContext());
  await expect.poll(()=>page.evaluate(()=>globalThis.__gpuRestored),{timeout:10000}).toBe(true);
  let last='';
  for(let i=0;i<180;i++){
    await page.waitForTimeout(250);
    const s=await snap();
    const signature=JSON.stringify([s.phase?.phase,s.phase?.uploadedBytes,s.phase?.idleMs,s.mode,s.upload?.pending,s.lastFrame]);
    if(signature!==last){trail.push(s);last=signature;}
    if(['complete','failed','canvas'].includes(s.phase?.phase))break;
  }
  output.final=await snap();
  expect(output.final.phase?.phase,'G4 restoration must end on an approved WebGL frame').toBe('complete');
  expect(output.final.mode).toBe('webgl2');
 }finally{
  output.trail=trail;output.errors=errors;output.requests=requests;
  mkdirSync('test-results/gpu-foreground-evidence',{recursive:true});
  writeFileSync('test-results/gpu-foreground-evidence/diagnosis.json',JSON.stringify(output,null,2));
  console.log('GPU_FOREGROUND_DIAG '+JSON.stringify({status:output.final?.phase?.phase,events:output.final?.events,trail:trail.map(s=>({at:Math.round(s.at),phase:s.phase?.phase,idle:Math.round(s.phase?.idleMs||0),bytes:s.phase?.uploadedBytes,mode:s.mode,pending:s.upload?.pending,firstCountry:s.firstCountry,lastFrame:s.lastFrame})),errors:errors.slice(0,5)}).slice(0,16000));
 }
});