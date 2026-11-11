// Focused P7 diagnostic: CPU attribution only. No product-source change.
// Same runtime, library pin, Chromium backend, viewport and clock as P7.
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const output=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(!output)throw new TypeError('--out=path is required');
const src=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const pin=JSON.parse(readFileSync('config/library-data.json','utf8')).revision;
const report={schema:'pando-p7-cpu-hotspot-20261112-v1',sourceCommit:src,libraryPin:pin,
  scenario:'Ubuntu Chromium SwiftShader WebGL2, 1280x800, 2026-11-06 frozen date, same P7 server',
  status:'running',browserVersion:null,gpuBackend:null,
  phases:[],ablation:[],pageErrors:[],limitations:[
    'Chrome CPU sampling adds profiling overhead; compare with non-profiled P7 baseline.',
    'WebGL method wall-time includes synchronous browser/driver waits, not GPU execution time.',
    'Instanced-draw suppression is a diagnostic rendering ablation, not a correct frame.',
    'Other code still binds attributes, changes state and performs prepares during instanced suppression.',
  ]};
let server,browser,page,cdp,profilerActive=false;
const rounded=x=>Number.isFinite(x)?Math.round(x*10)/10:null;
const stat=async()=>await page.evaluate(()=>{
  const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
  if(!s)throw Error('Viewer renderer stats unavailable');
  return {
    frameCount:s.visualFrameConsumeCount??null,baseSceneFullDraws:s.sceneCacheFullDrawCount??null,
    lastBaseSubmitMs:s.webGlLastBaseSubmitMs??null,
    cpuP95:s.p95CpuSubmitMs??null,cpuP99:s.p99CpuSubmitMs??null,
    countryMeshRebuilds:s.countryMeshRebuildCount??null,
    countryMeshReuses:s.countryMeshReuseCount??null,
    countryMeshBuilds:s.countryMeshBuildSuccessCount??null,
    screenScale:s.screenScale??null,screenLodPrepared:s.screenLodPreparedCount??null,
    screenLodUploaded:s.screenLodUploadCount??null,
    screenLodPreparing:!!s.screenLodPreparingKey,screenLodFailure:s.screenLodFailure||null,
    meshQuality:s.activeMeshQuality,renderDevice:s.renderer,
    stroke:{drawMs:s.stroke?.drawMs??null,drawCount:s.stroke?.drawCount??null,
      drawCallCount:s.stroke?.drawCallCount??null,
      resourceCount:s.stroke?.resourceCount??null,buildMs:s.stroke?.buildMs??null},
    polygon:{drawMs:s.polygonOverlay?.drawMs??null,
      drawCallCount:s.polygonOverlay?.drawCallCount??null},
    gpuDrawCalls:s.webGlLastFrameSceneDrawCalls??null,
    terrain:{renderedLevel:s.terrainRenderedLevel??null,targetLevel:s.terrainTargetLevel??null,
      cachedBytes:s.terrainCacheBytes??null,readyTiles:s.terrainTargetTilesLoaded??null,
      targetTiles:s.terrainTargetTileCount??null},
    hydro:{cachedBytes:s.hydroCacheBytes??null,uploadBytes:s.hydroUploadBytes??null},
  };
});
const diff=(a,b)=>Object.fromEntries(Object.keys(b).filter(k=>typeof b[k]==='number'&&typeof a?.[k]==='number')
  .map(k=>[k,rounded(b[k]-a[k])]));
const getProbe=async()=>page.evaluate(()=>globalThis.__PANDO_GL_PROBE__?.finish()||null);
const beginProbe=async skipInstanced=>page.evaluate(skip=>globalThis.__PANDO_GL_PROBE__?.start(skip),skipInstanced);
const beginCpu=async()=>{
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval',{interval:1000});
  await cdp.send('Profiler.start');
  profilerActive=true;
};
const endCpu=async()=>{
  if(!profilerActive)return null;
  profilerActive=false;
  const {profile}=await cdp.send('Profiler.stop');
  const idToNode=new Map(profile.nodes.map(n=>[n.id,n]));
  const costs=new Map(),deltas=profile.timeDeltas||[],ids=profile.samples||[];
  for(let i=0;i<ids.length;i++){
    const n=idToNode.get(ids[i]);if(!n)continue;
    const f=n.callFrame,uri=String(f.url||'').replace(/^https?:\/\/[^/]+/,'');
    const key=[f.functionName||'(anonymous)',uri,f.lineNumber+1].join('|');
    costs.set(key,(costs.get(key)||0)+(deltas[i]||1000)/1000);
  }
  return {samples:ids.length,totalSampledMs:rounded(deltas.reduce((a,b)=>a+b,0)/1000),
    topSelf: [...costs].sort((a,b)=>b[1]-a[1]).slice(0,18)
      .map(([key,ms])=>({frame:key,ms:rounded(ms)}))};
};
const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
const sample=async(label,body,{cpu=true,skipInstanced=false}={})=>{
  const before=await stat(),perf0=await metrics();
  if(cpu)await beginCpu();
  await beginProbe(skipInstanced);
  const start=Date.now();
  let error=null;
  try{await body(before);}catch(e){error=String(e?.stack||e);}
  const elapsed=Date.now()-start;
  const gl=await getProbe();
  const cpuProfile=cpu?await endCpu().catch(e=>({error:String(e)})):null;
  const after=await stat(),perf1=await metrics();
  const data={label,elapsedMs:elapsed,before,after,
    delta:{scene:diff(before,after),stroke:diff(before.stroke,after.stroke),
      polygon:diff(before.polygon,after.polygon)},
    gl,cpuProfile,
    browserCpu:{taskMs:rounded((perf1.TaskDuration-perf0.TaskDuration)*1000),
      scriptMs:rounded((perf1.ScriptDuration-perf0.ScriptDuration)*1000)},
    error};
  if(error)report.pageErrors.push(label+': '+error);
  return data;
};
async function waitFullScene(before,timeout=40000){
  await page.waitForFunction(base=>{
    const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
    return s?.sceneCacheFullDrawCount>base;
  },before.baseSceneFullDraws,{timeout,polling:100});
}
async function modifyLongitude(longitude){
  await page.evaluate(lon=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
    if(!host)throw Error('Map host missing');
    host.setViewState({projection:'globe',view:{...view,globeRotation:[-lon,-30,0],
      globeZoom:32,flatCenter:[lon,30],flatZoom:32}});
    host.requestRepaint('p7-cpu-hotspot-zoom');
  },longitude);
}
async function zoomInto(longitude){
  await modifyLongitude(longitude);
  await page.waitForFunction(()=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__;
    return Math.abs((host?.getViewState()?.globeZoom??0)-32)<0.01;
  },null,{timeout:25000,polling:100});
  await page.waitForFunction(()=>{
    const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
    return s?.screenLodTargetKey && !s?.screenLodPreparingKey;
  },null,{timeout:20000,polling:200}).catch(()=>{});
  await page.waitForTimeout(750);
}
const exerciseFrame=async(lon,before)=>{await modifyLongitude(lon);await waitFullScene(before);await page.waitForTimeout(90);};

async function serve(){
  server=spawn(process.execPath,['tests/browser/server.mjs'],{env:{...process.env,PANDOLAB_TEST_PORT:'4173'},
    stdio:['ignore','pipe','pipe']});
  let outputText='';
  for(const s of [server.stdout,server.stderr])s.on('data',chunk=>outputText=(outputText+String(chunk)).slice(-6000));
  for(let n=0;n<600;n++){
    if(server.exitCode!==null)throw Error('Test server exited: '+outputText);
    try{const response=await fetch('http://127.0.0.1:4173/',{signal:AbortSignal.timeout(3000)});
      if(response.ok)return;
    }catch{}
    await sleep(350);
  }
  throw Error('Viewer server did not start: '+outputText);
}
try{
  await serve();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader',
    '--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  report.browserVersion=browser.version();
  page=await browser.newPage({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul'});
  page.on('pageerror',e=>report.pageErrors.push(String(e)));
  // Capture synchronous API-entry cost. Suppression is limited to the ablation samples.
  await page.addInitScript(()=>{
    const probe=globalThis.__PANDO_GL_PROBE__={active:false,skipInstanced:false,perMethod:{},
      start(skip=false){this.perMethod={};this.skipInstanced=skip;this.active=true;},
      finish(){this.active=false;this.skipInstanced=false;return JSON.parse(JSON.stringify(this.perMethod));}};
    for(const Ctor of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext]){
      if(!Ctor?.prototype)continue;
      for(const name of ['drawElements','drawArrays','drawArraysInstanced','drawElementsInstanced',
        'readPixels','getParameter','getError','checkFramebufferStatus','clear','flush']){
        const desc=Object.getOwnPropertyDescriptor(Ctor.prototype,name);
        if(typeof desc?.value!=='function'||!desc.configurable)continue;
        Object.defineProperty(Ctor.prototype,name,{...desc,value:function(...args){
          if(!probe.active)return desc.value.apply(this,args);
          const started=performance.now();
          const suppress=probe.skipInstanced&&(name==='drawArraysInstanced'||name==='drawElementsInstanced');
          try{if(!suppress)return desc.value.apply(this,args);}
          finally{
            const elapsed=performance.now()-started;
            const row=probe.perMethod[name]||(probe.perMethod[name]={calls:0,executed:0,skipped:0,totalMs:0,maxMs:0});
            row.calls++;if(suppress)row.skipped++;else row.executed++;
            row.totalMs+=elapsed;row.maxMs=Math.max(row.maxMs,elapsed);
          }
        }});
      }
    }
  });
  await page.clock.setFixedTime(new Date('2026-11-06T03:00:00+09:00'));
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto('http://127.0.0.1:4173/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>{
    const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats?.();
    return s?.projectGeneration>0&&s.canonicalMeshReady&&
      s.countriesPublishedGeneration===s.projectGeneration&&
      document.getElementById('viewerStatus')?.dataset.ready==='true';
  },null,{timeout:210000,polling:300});
  report.initial=await stat();
  report.gpuBackend=await page.evaluate(()=>{
    const gl=document.querySelector('#viewerCanvas')?.getContext('webgl2');
    const ext=gl?.getExtension('WEBGL_debug_renderer_info');
    return {version:gl?.getParameter(gl.VERSION)??null,
      renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)??null};
  });
  report.phases.push(await sample('zoom32-europe',()=>zoomInto(10)));
  // At the SAME 32x globe viewport, alternate normal and skipped instanced
  // draw calls across four small camera rotations that invalidate the globe cache.
  for(const [label,lon,omit] of [
    ['same-area-normal-1',10.005,false],['same-area-no-instanced-1',10.010,true],
    ['same-area-normal-2',10.015,false],['same-area-no-instanced-2',10.020,true]
  ]){
    const row=await sample(label,before=>exerciseFrame(lon,before),{cpu:false,skipInstanced:omit});
    report.ablation.push(row);
    console.log('P7_CPU_ABLATION '+JSON.stringify({label,elapsedMs:row.elapsedMs,
      delta:row.delta,gl:row.gl,error:row.error}).slice(0,7000));
  }
  report.phases.push(await sample('zoom32-east-asia',()=>zoomInto(130)));
  report.status=report.pageErrors.length?'failed':'passed';
}catch(error){report.error=String(error?.stack||error);report.status='failed';}
finally{
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log('P7_CPU_ATTRIBUTION '+JSON.stringify({
    status:report.status,sourceCommit:src,libraryPin:pin,
    phases:report.phases.map(p=>({phase:p.label,elapsedMs:p.elapsedMs,
      scriptMs:p.browserCpu?.scriptMs,strokeDrawMs:p.delta?.stroke?.drawMs,
      fullSceneDraws:p.delta?.scene?.baseSceneFullDraws,
      gl:p.gl,cpuTop:p.cpuProfile?.topSelf?.slice(0,12),error:p.error})),
    ablation:report.ablation.map(p=>({label:p.label,elapsedMs:p.elapsedMs,
      strokeDrawMs:p.delta?.stroke?.drawMs,fullSceneDraws:p.delta?.scene?.baseSceneFullDraws,
      gl:p.gl,error:p.error})),
    error:report.error,pageErrors:report.pageErrors
  }).slice(0,24000));
  try{await cdp?.detach();}catch{}
  try{await browser?.close();}catch{}
  if(server){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),sleep(3000)]);
    if(server.exitCode===null)server.kill('SIGKILL');}
}
if(report.status!=='passed')process.exitCode=1;
