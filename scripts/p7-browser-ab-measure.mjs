// P7: one fixed Ubuntu/Chromium/SwiftShader scenario, executed sequentially
// at two Git commits on the SAME CI runner. A failed sample is not a speedup.
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
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
const mapSummary=stats=>{
  const s=stats||{};
  return {
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
  };
};
const identity=()=>({commit:sha(),pin:pin(),platform:process.platform,node:process.version,
  scenario:'Chromium SwiftShader; 1280x800; light UI; 2026-11-06 clock; 1 fresh browser per revision; same runner',
  viewport:[1280,800],cachePolicy:'separate fresh browser instances; browser default cache; same-page date-return reuse',
  memoryPolicy:'main page V8 used heap via CDP after GC; excludes Worker, WASM and GPU VRAM. GPU counters are app-tracked, not total VRAM.'});
async function serve(){
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
    status:'running',startedAt:new Date().toISOString(),phases:[],pageErrors:[],error:null};
  let server=null,browser=null,page=null,cdp=null;
  const snapshot=async(phase,elapsedMs)=>{
    const view=await page.evaluate(()=>{
      const api=globalThis.__PANDOLAB_VIEWER__,document=api?.documentSnapshot();
      const core=api?.documentState();
      return {map:api?.rendererStats(),month:api?.builtinMonth().month,cursor:core?.timelineCursor,
        entities:document?.territorialEntities?.length,geometries:document?.geometries?.length,
        status:globalThis.document.getElementById('viewerStatus')?.dataset.ready};
    });
    await cdp.send('HeapProfiler.collectGarbage').catch(()=>{});
    const metrics=await cdp.send('Performance.getMetrics');
    const byName=Object.fromEntries(metrics.metrics.map(row=>[row.name,row.value]));
    report.phases.push({phase,elapsedMs:format(elapsedMs),month:view.month,cursor:view.cursor,
      entities:view.entities,geometries:view.geometries,documentReady:view.status,
      jsHeapUsedBytes:byName.JSHeapUsedSize??null,jsHeapTotalBytes:byName.JSHeapTotalSize??null,
      domNodes:byName.Nodes??null,jsListeners:byName.JSEventListeners??null,
      webWorkers:page.workers().length,renderer:mapSummary(view.map)});
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
    await page.clock.setFixedTime(new Date('2026-11-06T03:00:00+09:00'));
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    let started=Date.now();
    await page.goto('http://127.0.0.1:4173/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:120000});
    await ready('2026-11');
    await snapshot('cold-current',Date.now()-started);
    started=Date.now();
    await page.locator('#timelinePreviousYear').click({timeout:10000});
    await ready('2025-12');
    await snapshot('previous-year',Date.now()-started);
    started=Date.now();
    await page.locator('#timelineNextYear').click({timeout:10000});
    await ready('2026-11');
    await snapshot('same-page-return',Date.now()-started);
    report.browserVersion=browser.version();
    report.status=report.pageErrors.length?'failed':'passed';
    if(report.pageErrors.length)report.error='Browser page errors: '+report.pageErrors.join('; ');
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
    try{await browser?.close();}catch { /* browser may already be closed */ }
    if(server){
      server.kill('SIGTERM');
      await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(5000)]);
      if(server.exitCode===null)server.kill('SIGKILL');
    }
  }
  console.log('P7_AB_SAMPLE '+JSON.stringify({label:report.label,identity:report.identity,
    status:report.status,phases:report.phases.map(x=>({phase:x.phase,elapsedMs:x.elapsedMs,
    jsHeapUsedBytes:x.jsHeapUsedBytes,firstCountryMs:x.renderer.firstCountryPublishedMs})),
    error:report.error?.slice(0,700)}));
  if(report.status!=='passed')process.exitCode=1;
}
function compare(){
  const main=readJson(options.main),candidate=readJson(options.candidate);
  const comparable=main.identity?.pin===candidate.identity?.pin&&main.identity?.scenario===candidate.identity?.scenario
    &&main.browserVersion===candidate.browserVersion&&main.status==='passed'&&candidate.status==='passed';
  const rows=main.phases.map((row,i)=>{
    const next=candidate.phases[i];
    const diff=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?format(b-a):null;
    return {phase:row.phase,mainMs:row.elapsedMs,p7Ms:next?.elapsedMs??null,
      deltaMs:diff(row.elapsedMs,next?.elapsedMs),
      mainJsHeapBytes:row.jsHeapUsedBytes,p7JsHeapBytes:next?.jsHeapUsedBytes??null,
      heapDeltaBytes:diff(row.jsHeapUsedBytes,next?.jsHeapUsedBytes),
      mainFirstCountryMs:row.renderer?.firstCountryPublishedMs,
      p7FirstCountryMs:next?.renderer?.firstCountryPublishedMs??null};
  });
  const result={schema:'pando-p7-browser-ab-comparison-v1',comparable,
    status:comparable?'paired':'incomplete',reference:main.identity,candidate:candidate.identity,
    browserVersion:main.browserVersion,rows,
    limitations:['Only one sample per revision, no robust confidence interval',
      'GPU memory is app-tracked, not actual VRAM',
      'Chromium main-thread heap excludes WASM and Worker heaps',
      'No performance improvement threshold approved; failures are not zero'],
    errors:[main.error,candidate.error].filter(Boolean)};
  if(options.out)write(options.out,result);
  console.log('P7_AB_COMPARISON '+JSON.stringify(result).slice(0,5000));
  if(process.env.GITHUB_STEP_SUMMARY){
    const lines=['### P7 same-run browser A/B','Baseline: '+main.identity.commit,
      'Candidate: '+candidate.identity.commit,'Comparable: '+comparable,
      '| Phase | main ms | P7 ms | difference ms | main JS heap | P7 JS heap |',
      '|---|---:|---:|---:|---:|---:|',
      ...rows.map(r=>'| '+r.phase+' | '+r.mainMs+' | '+r.p7Ms+' | '+r.deltaMs+
        ' | '+r.mainJsHeapBytes+' | '+r.p7JsHeapBytes+' |')];
    writeFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
  }
  if(!comparable)process.exitCode=1;
}
if(options.mode==='compare')compare();
else await sample();
