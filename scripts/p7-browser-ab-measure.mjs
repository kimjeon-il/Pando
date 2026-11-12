// P7: one fixed Ubuntu/Chromium/SwiftShader scenario, executed sequentially
// at two Git commits on the SAME CI runner. A failed sample is not a speedup.
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const options=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const [key,...rest]=arg.replace(/^--/,'').split('=');
  return [key,rest.join('=')];
}));
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const pin=()=>readJson('config/library-data.json').revision;
const sha=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const write=(path,report)=>writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const format=value=>Number.isFinite(value)?Math.round(value*10)/10:null;
const median=values=>{
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};
function medianObject(values) {
  if(values.every(value=>typeof value==='number'&&Number.isFinite(value)))return median(values);
  if(values.every(value=>value===null||value===undefined))return null;
  if(values.every(value=>value&&typeof value==='object'&&!Array.isArray(value))){
    const keys=Object.keys(values[0]);
    if(values.every(value=>keys.length===Object.keys(value).length&&keys.every(key=>Object.hasOwn(value,key))))
      return Object.fromEntries(keys.map(key=>[key,medianObject(values.map(value=>value[key]))]));
  }
  return values.every(value=>JSON.stringify(value)===JSON.stringify(values[0]))?values[0]:null;
}
export async function chromiumProcessMemory(cdp) {
  if(!cdp)return null;
  try{
    const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
    const processes=processInfo.filter(p=>Number.isSafeInteger(p.id)&&p.id>0);
    let bytes=0;
    for(const process of processes){
      const rollup=readFileSync('/proc/'+process.id+'/smaps_rollup','utf8');
      const match=rollup.match(/^Pss:\s+(\d+)\s+kB$/m);
      if(!match)return null;
      bytes+=Number(match[1])*1024;
    }
    return {pssBytes:bytes,processes:processes.length};
  }catch{return null;} // Never substitute zero for an unavailable process metric.
}
export const mapSummary=stats=>{
  const s=stats||{};
  return {
    p95CpuSubmitMs:s.p95CpuSubmitMs??null,
    p99CpuSubmitMs:s.p99CpuSubmitMs??null,
    gpuDrawCalls:s.webGlLastFrameSceneDrawCalls??null,
    gpuFirstBackgroundDrawCalls:s.webGlFirstBackgroundSceneDrawCalls??null,
    gpuFirstCountryDrawCalls:s.webGlFirstCountrySceneDrawCalls??null,
    gpuTrackedBuffersBytes:Object.values(s.meshVariantBytes||{}).reduce((n,v)=>n+(Number(v)||0),0)
      +(Number(s.stroke?.activeBufferBytes)||0)+(Number(s.polygonOverlay?.activeBufferBytes)||0),
    gpuSceneCacheDraws:s.sceneCacheFullDrawCount??null,
    countryMeshPreparationMs:s.lastMeshPreparation?.totalMs??null,
    countryTriangulationMs:s.lastMeshPreparation?.triangulationMs??null,
    countryStrokePreparationMs:s.lastMeshPreparation?.strokeMs??null,
    renderer:s.renderer,projectGeneration:s.projectGeneration,countriesPublishedGeneration:s.countriesPublishedGeneration,
    canonicalMeshReady:s.canonicalMeshReady,firstBackgroundFrameMs:s.firstBackgroundFrameMs,
    firstCountryPublishedMs:s.firstCountryPublishedMs,
    mapReadiness:s.mapReadiness?.status,terrainReady:s.terrainReady,
    terrainRenderedLevel:s.terrainRenderedLevel,terrainTargetLevel:s.terrainTargetLevel,
    terrainCacheBytes:s.terrainCacheBytes??null,terrainPendingDecodedBytes:s.terrainPendingDecodedBytes??null,
    hydroCacheBytes:s.hydroCacheBytes??null,hydroUploadBytes:s.hydroUploadBytes??null,
    meshVariantBytes:s.meshVariantBytes??null,strokeGpuBufferBytes:s.stroke?.activeBufferBytes??null,
    polygonGpuBufferBytes:s.polygonOverlay?.activeBufferBytes??null,
    workerMessageBytes:s.canvasWorkerMessageBytes??null,
    countryMeshRebuildCount:s.countryMeshRebuildCount??null,
    countryMeshReuseCount:s.countryMeshReuseCount??null,
    countryMeshBuildSuccessCount:s.countryMeshBuildSuccessCount??null,
    screenScale:s.screenScale??null,
    activeMeshQuality:s.activeMeshQuality??null,
    screenLodTargetKey:s.screenLodTargetKey??null,
    screenLodPreparingKey:s.screenLodPreparingKey??null,
    screenLodFailure:s.screenLodFailure??null,
    screenLodPreparedCount:s.screenLodPreparedCount??null,
    screenLodUploadCount:s.screenLodUploadCount??null,
    screenLodBudgetRejectCount:s.screenLodBudgetRejectCount??null,
  };
};
export const identity=()=>({commit:sha(),pin:pin(),platform:process.platform,node:process.version,
  scenario:'Chromium SwiftShader; 1280x800; light UI; 2026-11-06 clock; 1 fresh browser per revision; same runner',
  viewport:[1280,800],cachePolicy:'separate fresh browser instances; browser default cache; same-page date-return reuse',
  memoryPolicy:'V8 main page used heap via CDP after GC; Chromium process-family PSS via Linux procfs when available (includes workers/WASM in process memory, excludes GPU VRAM).',
  cpuPolicy:'CDP TaskDuration and ScriptDuration are renderer task/script time (not system-wide CPU percent).',
  framePolicy:'requestAnimationFrame pacing is a scheduling FPS proxy, not measured GPU presentation rate.',
  gpuPolicy:'GPU draw-call and buffer counts from renderer; actual VRAM/utilization/kernel timing not measured.'});
export async function serve(){
  const child=spawn(process.execPath,['tests/browser/server.mjs'],{cwd:process.cwd(),
    env:{...process.env,PANDOLAB_TEST_PORT:'4173'},stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
    output=(output+String(chunk)).slice(-6000);
  });
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw Error('Viewer server exited: '+output);
    try{
      const response=await fetch('http://127.0.0.1:4173/',{signal:AbortSignal.timeout(3000)});
      if(response.ok)return child;
    }catch { /* server is still starting */ }
    await delay(350);
  }
  child.kill('SIGTERM');
  throw Error('Viewer server startup timeout: '+output);
}
async function sample(){
  const report={schema:'pando-p7-browser-ab-v1',identity:identity(),label:options.label,
    status:'running',startedAt:new Date().toISOString(),phases:[],pageErrors:[],screenshotErrors:[],error:null};
  let server=null,browser=null,page=null,cdp=null,processCdp=null,previousPerf=null;
  const performanceCounters=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const snapshot=async(phase,elapsedMs)=>{
    if(options['strict-frames']==='1'){
      await page.waitForFunction(()=>{
        const stats=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
        return stats?.terrainReady===true&&stats.terrainTargetLevel!=null
          &&stats.terrainRenderedLevel===stats.terrainTargetLevel&&!stats.screenLodPreparingKey
          &&stats.mapReadiness?.mapReady===true;
      },null,{polling:250,timeout:180000});
      // A timeout is a failed measurement, never a short successful sample.
      await page.waitForFunction(()=>globalThis.__pandoAbFps?.gaps.length>=300,null,{polling:250,timeout:180000});
    }
    const view=await page.evaluate(()=>{
      const api=globalThis.__PANDOLAB_VIEWER__,document=api?.documentSnapshot();
      const core=api?.documentState();
      return {map:api?.rendererStats(),month:api?.builtinMonth().month,cursor:core?.timelineCursor,
        entities:document?.territorialEntities?.length,geometries:document?.geometries?.length,
        status:globalThis.document.getElementById('viewerStatus')?.dataset.ready};
    });
    const raf=await page.evaluate(strict=>globalThis.__pandoAbFps?.finish(strict)||null,options['strict-frames']==='1');
    await cdp.send('HeapProfiler.collectGarbage').catch(()=>{});
    const byName=await performanceCounters();
    const cpuMs=Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>{
      const before=previousPerf?.[name],after=byName[name];
      return [name,Number.isFinite(before)&&Number.isFinite(after)?format((after-before)*1000):null];
    }));
    previousPerf=byName;
    const processMemory=await chromiumProcessMemory(processCdp);
    report.phases.push({phase,elapsedMs:format(elapsedMs),month:view.month,cursor:view.cursor,
      cpuMs,raf,
      entities:view.entities,geometries:view.geometries,documentReady:view.status,
      jsHeapUsedBytes:byName.JSHeapUsedSize??null,jsHeapTotalBytes:byName.JSHeapTotalSize??null,
      chromiumProcessPssBytes:processMemory?.pssBytes??null,chromiumProcessCount:processMemory?.processes??null,
      domNodes:byName.Nodes??null,jsListeners:byName.JSEventListeners??null,
      webWorkers:page.workers().length,renderer:mapSummary(view.map)});
    if(options['strict-frames']==='1'&&options['screenshot-dir']){
      try{await page.screenshot({path:options['screenshot-dir']+'/'+phase+'.png'});}
      catch(error){report.screenshotErrors.push({phase,error:String(error)});}
    }
  };
  const ready=async expected=>{
    await page.waitForFunction(month=>{
      const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
      return !!s&&s.projectGeneration>0&&s.canonicalMeshReady===true
        &&s.countriesPublishedGeneration===s.projectGeneration
        &&api.builtinMonth().month===month&&api.documentState()?.timelineCursor===month
        &&globalThis.document.getElementById('viewerStatus')?.dataset.ready==='true';
    },expected,{polling:300,timeout:210000});
  };
  try{
    if(!options.out||!['main','p7'].includes(options.label))throw Error('Expected --label=main|p7 and --out=...');
    server=await serve();
    browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader',
      '--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
    page=await browser.newPage({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul'});
    page.on('pageerror',error=>report.pageErrors.push(String(error)));
    await page.addInitScript(()=>{
      const meter=globalThis.__pandoAbFps={
        started:performance.now(),active:true,last:null,gaps:[],
        glCalls:0,
        start(){this.started=performance.now();this.active=true;this.last=null;this.gaps=[];this.glCalls=0;},
        finish(includeRaw=false){
          this.active=false;
          const duration=Math.max(1,performance.now()-this.started);
          const gaps=[...this.gaps].sort((a,b)=>a-b);
          return {rafFps:Math.round(gaps.length*10000/duration)/10,
            maxFrameGapMs:gaps.length?Math.round(gaps.at(-1)*10)/10:null,
            p50FrameGapMs:gaps.length?Math.round(gaps[Math.floor((gaps.length-1)*0.50)]*10)/10:null,
            p95FrameGapMs:gaps.length?Math.round(gaps[Math.floor((gaps.length-1)*0.95)]*10)/10:null,
            p99FrameGapMs:gaps.length?Math.round(gaps[Math.floor((gaps.length-1)*0.99)]*10)/10:null,
            rafFrames:gaps.length,durationMs:Math.round(duration),glDrawCalls:this.glCalls,
            ...(includeRaw?{frameGapsMs:[...this.gaps]}:{})};
        },
      };
      const tick=now=>{if(meter.active){if(meter.last!==null)meter.gaps.push(now-meter.last);meter.last=now;}requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
      // Instrument the exact WebGL entry points in both revisions. The same
      // lightweight wrapper is installed before any app shader draws.
      for(const Ctor of [globalThis.WebGLRenderingContext,globalThis.WebGL2RenderingContext]){
        if(!Ctor?.prototype)continue;
        for(const name of ['drawElements','drawArrays','drawArraysInstanced','drawElementsInstanced']){
          const desc=Object.getOwnPropertyDescriptor(Ctor.prototype,name);
          if(!desc?.configurable||typeof desc.value!=='function')continue;
          Object.defineProperty(Ctor.prototype,name,{...desc,value:function(...args){
            if(meter.active)meter.glCalls++;
            return desc.value.apply(this,args);
          }});
        }
      }
    });
    await page.clock.setFixedTime(new Date('2026-11-06T03:00:00+09:00'));
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    processCdp=await browser.newBrowserCDPSession();
    previousPerf=await performanceCounters();
    let started=Date.now();
    await page.goto('http://127.0.0.1:4173/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:120000});
    await ready('2026-11');
    await snapshot('cold-current',Date.now()-started);
    report.gpuBackend=await page.evaluate(()=>{
      const gl=document.querySelector('#viewerCanvas')?.getContext('webgl2');
      const ext=gl?.getExtension('WEBGL_debug_renderer_info');
      return {version:gl?.getParameter(gl.VERSION)??null,
        renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)??null};
    });
    await page.evaluate(()=>globalThis.__pandoAbFps.start());
    started=Date.now();
    await page.locator('#timelinePreviousYear').click({timeout:10000});
    await ready('2025-12');
    await snapshot('previous-year',Date.now()-started);
    await page.evaluate(()=>globalThis.__pandoAbFps.start());
    started=Date.now();
    await page.locator('#timelineNextYear').click({timeout:10000});
    await ready('2026-11');
    await snapshot('same-page-return',Date.now()-started);
    if(options['measure-zoom']==='1'){
      // Only the focused renderer profile requests maximum project-relative
      // zoom. The historical P7 paired A/B scenario stays unchanged.
      const zoomTo=async (longitude,phase)=>{
        await page.evaluate(()=>globalThis.__pandoAbFps.start());
        started=Date.now();
        await page.evaluate(longitude=>{
          const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
          host.setViewState({projection:'globe',view:{
            ...view,globeRotation:[-longitude,-30,0],globeZoom:32,
            flatCenter:[longitude,30],flatZoom:32
          }});
          host.requestRepaint('renderer-metrics-zoom32');
        },longitude);
        await page.waitForFunction(()=>Math.abs(
          globalThis.__PANDOLAB_MAP_HOST__?.getViewState()?.globeZoom-32)<0.01,
          null,{timeout:20000,polling:100});
        const lodReady=page.waitForFunction(()=>{
          const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats?.();
          return s?.screenLodTargetKey && !s?.screenLodPreparingKey;
        },null,{timeout:20000,polling:200});
        if(options['strict-frames']==='1')await lodReady;
        else await lodReady.catch(()=>{});
        // One bounded settle interval samples the accepted visual frame as
        // well as any expensive LOD preparation; never claim GPU timing.
        await page.waitForTimeout(750);
        await snapshot(phase,Date.now()-started);
      };
      await zoomTo(10,'zoom32-europe');
      await zoomTo(130,'zoom32-east-asia');
    }
    report.browserVersion=browser.version();
    report.status=report.pageErrors.length||report.screenshotErrors.length?'failed':'passed';
    if(report.pageErrors.length||report.screenshotErrors.length)
      report.error='Browser page/screenshot errors: '+JSON.stringify({page:report.pageErrors,screenshots:report.screenshotErrors});
  }catch(error){
    report.status='failed';report.error=String(error?.stack||error).slice(0,5000);
    if(page)report.diagnostics=await page.evaluate(()=>({
      stats:globalThis.__PANDOLAB_VIEWER__?.rendererStats?.()||null,
      month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth?.()||null
    })).catch(()=>null);
  }finally{
    report.finishedAt=new Date().toISOString();
    if(options.out)write(options.out,report);
    try{await cdp?.detach();}catch { /* page may already be closed */ }
    try{await processCdp?.detach();}catch { /* browser may already be closed */ }
    try{await browser?.close();}catch { /* browser may already be closed */ }
    if(server){
      server.kill('SIGTERM');
      await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(5000)]);
      if(server.exitCode===null)server.kill('SIGKILL');
    }
  }
  console.log('P7_AB_SAMPLE '+JSON.stringify({label:report.label,identity:report.identity,
    status:report.status,phases:report.phases.map(x=>({phase:x.phase,elapsedMs:x.elapsedMs,
    jsHeapUsedBytes:x.jsHeapUsedBytes,chromiumProcessPssBytes:x.chromiumProcessPssBytes,
    firstCountryMs:x.renderer.firstCountryPublishedMs})),
    error:report.error?.slice(0,700)}));
  if(report.status!=='passed')process.exitCode=1;
}
function aggregate(){
  const paths=String(options.samples||'').split(',').filter(Boolean);
  if(paths.length<3||!options.out)throw Error('At least 3 retained sample files and --out are required.');
  const samples=paths.map(readJson),first=samples[0];
  const same=samples.every(sample=>sample.status==='passed'&&sample.label===first.label
    &&sample.identity?.commit===first.identity?.commit
    &&JSON.stringify(sample.identity)===JSON.stringify(first.identity)
    &&sample.browserVersion===first.browserVersion
    &&JSON.stringify(sample.gpuBackend)===JSON.stringify(first.gpuBackend)
    &&sample.phases.length===first.phases.length
    &&sample.phases.every((phase,i)=>phase.phase===first.phases[i].phase
      &&phase.month===first.phases[i].month&&phase.cursor===first.phases[i].cursor
      &&phase.entities===first.phases[i].entities&&phase.geometries===first.phases[i].geometries));
  const result={
    schema:'pando-p7-browser-ab-aggregate-v1',label:first.label,identity:first.identity,
    browserVersion:first.browserVersion,gpuBackend:first.gpuBackend,
    sampleCount:samples.length,status:same?'passed':'failed',
    phases:same?first.phases.map((phase,i)=>({
      ...medianObject(samples.map(sample=>sample.phases[i])),
      wallTimeRangeMs:[Math.min(...samples.map(sample=>sample.phases[i].elapsedMs)),
        Math.max(...samples.map(sample=>sample.phases[i].elapsedMs))],
    })):[],
    error:same?null:'Unmatched or failed replicate; see each retained raw JSON file.',
  };
  write(options.out,result);
  console.log('P7_AB_AGGREGATE '+JSON.stringify({label:result.label,status:result.status,
    count:result.sampleCount,phases:result.phases.map(x=>({phase:x.phase,medianMs:x.elapsedMs,rangeMs:x.wallTimeRangeMs}))}));
  if(!same)process.exitCode=1;
}
function compare(){
  const main=readJson(options.main),candidate=readJson(options.candidate);
  const comparable=main.identity?.pin===candidate.identity?.pin&&main.identity?.scenario===candidate.identity?.scenario
    &&main.browserVersion===candidate.browserVersion
    &&main.gpuBackend?.renderer===candidate.gpuBackend?.renderer
    &&main.status==='passed'&&candidate.status==='passed'
    &&main.sampleCount>=3&&main.sampleCount===candidate.sampleCount
    &&main.phases.length===candidate.phases.length
    &&main.phases.every((row,i)=>row.phase===candidate.phases[i]?.phase&&row.month===candidate.phases[i]?.month
      &&row.cursor===candidate.phases[i]?.cursor&&row.entities===candidate.phases[i]?.entities);
  const rows=main.phases.map((row,i)=>{
    const next=candidate.phases[i];
    const diff=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?format(b-a):null;
    const rate=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>0?format((b-a)/a*100):null;
    return {phase:row.phase,mainMs:row.elapsedMs,p7Ms:next?.elapsedMs??null,
      elapsedDeltaPercent:rate(row.elapsedMs,next?.elapsedMs),
      baseCpuTaskMs:row.cpuMs?.TaskDuration??null,candidateCpuTaskMs:next?.cpuMs?.TaskDuration??null,
      baseCpuScriptMs:row.cpuMs?.ScriptDuration??null,candidateCpuScriptMs:next?.cpuMs?.ScriptDuration??null,
      baseRafFps:row.raf?.rafFps??null,candidateRafFps:next?.raf?.rafFps??null,
      baseMaxFrameGapMs:row.raf?.maxFrameGapMs??null,candidateMaxFrameGapMs:next?.raf?.maxFrameGapMs??null,
      baseGpuDrawCalls:row.raf?.glDrawCalls??null,candidateGpuDrawCalls:next?.raf?.glDrawCalls??null,
      baseCountryPreparationMs:row.renderer?.countryMeshPreparationMs??null,
      candidateCountryPreparationMs:next?.renderer?.countryMeshPreparationMs??null,
      baseGpuBuffers:row.renderer?.gpuTrackedBuffersBytes??null,candidateGpuBuffers:next?.renderer?.gpuTrackedBuffersBytes??null,
      baseProcessPssBytes:row.chromiumProcessPssBytes??null,
      candidateProcessPssBytes:next?.chromiumProcessPssBytes??null,
      mainFirstBackgroundMs:row.renderer?.firstBackgroundFrameMs??null,
      p7FirstBackgroundMs:next?.renderer?.firstBackgroundFrameMs??null,
      baseWallRangeMs:row.wallTimeRangeMs,candidateWallRangeMs:next?.wallTimeRangeMs??null,
      deltaMs:diff(row.elapsedMs,next?.elapsedMs),
      mainJsHeapBytes:row.jsHeapUsedBytes,p7JsHeapBytes:next?.jsHeapUsedBytes??null,
      heapDeltaBytes:diff(row.jsHeapUsedBytes,next?.jsHeapUsedBytes),
      mainFirstCountryMs:row.renderer?.firstCountryPublishedMs,
      p7FirstCountryMs:next?.renderer?.firstCountryPublishedMs??null};
  });
  const result={schema:'pando-p7-browser-ab-comparison-v1',comparable,
    status:comparable?'paired':'incomplete',reference:main.identity,candidate:candidate.identity,
    browserVersion:main.browserVersion,gpuBackend:main.gpuBackend,sampleCount:main.sampleCount,rows,
    limitations:['Three or more sequential samples per revision (median), not hardware-independent confidence intervals',
      'requestAnimationFrame is not the actual presented GPU frame rate',
      'GPU draw calls/buffers are app-tracked; GPU utilization and actual VRAM are unavailable',
      'Chromium main-thread heap excludes WASM and Worker heaps; Linux PSS sums browser-process memory when supported',
      'No performance improvement threshold approved; failures are not zero'],
    errors:[main.error,candidate.error].filter(Boolean)};
  if(options.out)write(options.out,result);
  console.log('P7_AB_COMPARISON '+JSON.stringify(result).slice(0,5000));
  if(process.env.GITHUB_STEP_SUMMARY){
    const lines=['### P7 same-run browser A/B','Baseline: '+main.identity.commit,
      'Candidate: '+candidate.identity.commit,'Comparable: '+comparable,
      '| Phase | main ms | optimized ms | delta % | CPU task ms main/optimized | rAF FPS main/optimized | JS heap MiB main/optimized |',
      '|---|---:|---:|---:|---|---|---|',
      ...rows.map(r=>'| '+r.phase+' | '+r.mainMs+' | '+r.p7Ms+' | '+r.elapsedDeltaPercent+
        ' | '+r.baseCpuTaskMs+'/'+r.candidateCpuTaskMs+' | '+r.baseRafFps+'/'+r.candidateRafFps+
        ' | '+format(r.mainJsHeapBytes/1048576)+'/'+format(r.p7JsHeapBytes/1048576)+' |')];
    writeFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
  }
  if(!comparable)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(options.mode==='compare')compare();
  else if(options.mode==='aggregate')aggregate();
  else await sample();
}
