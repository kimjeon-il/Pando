import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {reportPath} from "./data/report-paths.mjs";
const base=process.env.PANDOLAB_W2_EVIDENCE||reportPath('reports/development/performance/w2-p2-windows-first-transition-2026-11-02',{access:'write'});mkdirSync(base,{recursive:true});
const results=[];
function nativeMemory(processes){const ids=processes.map(p=>Number(p.id)).filter(Number.isInteger);return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','@(Get-Process -Id '+ids.join(',')+' -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true})||'[]');}
async function run(name,{plain=false,software=false,delay=null,warm=0,profile=true}={}){
 if(['.json','.png','-trace.json.gz'].some(suffix=>existsSync(base+'/'+name+suffix)))throw Error('Preserve existing evidence; select a fresh PANDOLAB_W2_EVIDENCE directory: '+name);
 console.log('W2_START '+name);
 const events=[],errors=[],warnings=[];let browser,cdp,context;
 const row={name,plain,software,delay,profile,samples:[],status:'running'};
 try{
  browser=await chromium.launch({headless:true,args:[software?'--use-angle=swiftshader':'--use-angle=d3d11']});row.version=browser.version();
  cdp=await browser.newBrowserCDPSession();row.system=(await cdp.send('SystemInfo.getInfo')).gpu;row.processes=(await cdp.send('SystemInfo.getProcessInfo')).processInfo;
  row.nativeStart=nativeMemory(row.processes);
  cdp.on('Tracing.dataCollected',e=>events.push(...e.value));
  if(!plain)await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,cc,gpu'+(profile?',disabled-by-default-v8.cpu_profiler':''),transferMode:'ReportEvents'});
  context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,timezoneId:'Asia/Seoul',locale:'ko-KR',reducedMotion:'reduce'});
  await context.addInitScript(()=>{globalThis.__w2Long=[];new PerformanceObserver(list=>{for(const e of list.getEntries())__w2Long.push({start:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});});
  await context.addInitScript(()=>{setInterval(()=>{if(globalThis.__W2Polling&&globalThis.__w2Readiness)globalThis.__w2Mark('readiness-sample','instant',globalThis.__w2Readiness());},50);});
  if(plain){await context.addInitScript(()=>{globalThis.__w2Mark=(stage,edge,extra={})=>performance.mark('W2|'+JSON.stringify({stage,edge,...extra}));});await context.route('**/modules/viewer-composition.js*',async route=>{const response=await route.fetch();let s=await response.text();for(const [a,b]of [["applyMonth:async(month,{isCurrent,commit})=>{","applyMonth:async(month,{isCurrent,commit})=>{__w2Mark('transition','requested',{month});"],["onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}","onPresented:()=>{commit();__w2Mark('transition','presented',{month});window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}"],["status.dataset.ready='true';","status.dataset.ready='true';__w2Mark('transition','ready');"]]){if(s.split(a).length!==2)throw Error('Plain marker anchor');s=s.replace(a,b);}await route.fulfill({response,body:s});});}
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['error','warning'].includes(m.type()))warnings.push({type:m.type(),text:m.text()});});
  await page.goto('http://127.0.0.1:'+(plain?4190:4191)+'/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:150000});
  row.identity=await page.evaluate(()=>{const gl=document.querySelector('#viewerCanvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),build:globalThis.PANDOLAB_BUILD_META,month:__PANDOLAB_VIEWER__.builtinMonth().month};});
  if(row.version!=='151.0.7922.34'||!row.identity.month.startsWith('2026-')||(!software&&!/NVIDIA.*Direct3D11/.test(row.identity.renderer))||(software&&!/SwiftShader/.test(row.identity.renderer))||row.system.featureStatus.gpu_compositing!=='enabled')throw Error('Environment identity mismatch '+JSON.stringify(row.identity));
  const pageCDP=await context.newCDPSession(page);await pageCDP.send('Performance.enable');row.memoryStart=(await pageCDP.send('Performance.getMetrics')).metrics;
  row.targetsStart=(await cdp.send('Target.getTargets')).targetInfos.map(t=>({type:t.type,url:t.url}));
  for(let i=0;i<2+warm;i++){
   const target=i%2===0?'2025-12':row.identity.month;
   await page.evaluate(d=>{globalThis.__W2Delay=d;globalThis.__w2ControlBoundary?.(d);globalThis.__W2Polling=true;globalThis.__w2Long=[];performance.clearMarks();},i===0?delay:null);
   const started=await page.evaluate(()=>performance.now());
   if(name.startsWith('safety')&&i===1){const before=await page.evaluate(()=>JSON.stringify({state:__PANDOLAB_VIEWER__.documentState(),month:__PANDOLAB_VIEWER__.builtinMonth(),visible:__PANDOLAB_VIEWER__.visibleTerritorialCount()}));await page.evaluate(()=>globalThis.__w2ReplayStale());const after=await page.evaluate(()=>JSON.stringify({state:__PANDOLAB_VIEWER__.documentState(),month:__PANDOLAB_VIEWER__.builtinMonth(),visible:__PANDOLAB_VIEWER__.visibleTerritorialCount()}));row.staleSafety={unchanged:before===after,rejections:await page.evaluate(()=>performance.getEntriesByType('mark').filter(e=>e.name.includes('"stage":"rejected"')).length)};if(!row.staleSafety.unchanged||row.staleSafety.rejections!==4)throw Error('Stale response safety failed');}
   await page.locator(i%2===0?'#timelinePreviousYear':'#timelineNextYear').click();
   await expect.poll(()=>page.evaluate(()=>({month:__PANDOLAB_VIEWER__.builtinMonth().month,cursor:__PANDOLAB_VIEWER__.documentState().timelineCursor,ready:document.querySelector('#viewerStatus').dataset.ready})),{timeout:120000}).toEqual({month:target,cursor:target,ready:'true'});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.evaluate(()=>{globalThis.__W2Polling=false;});
   const sample=await page.evaluate(async({target,started})=>{
    const observedReadyAt=performance.now();const marks=performance.getEntriesByType('mark').filter(e=>e.name.startsWith('W2|')).map(e=>({...JSON.parse(e.name.slice(3)),at:e.startTime}));
    const requested=marks.find(e=>e.stage==='transition'&&e.edge==='requested'&&e.month===target),presented=marks.find(e=>e.stage==='transition'&&e.edge==='presented'&&e.month===target),ready=marks.find(e=>e.stage==='transition'&&e.edge==='ready'&&e.at>=(requested?.at||started));
    const doc=__PANDOLAB_VIEWER__.documentSnapshot();const labelNodes=[...document.querySelectorAll('svg text')];const semantic={entities:doc.territorialEntities,geometries:doc.geometries,timeline:doc.timelineRecords,labels:labelNodes.map(e=>[e.textContent,e.getAttribute('x'),e.getAttribute('y'),e.parentElement.getAttribute('transform')]).sort(),paths:[...document.querySelectorAll('#viewerLabels path')].map(e=>e.getAttribute('d')).sort()};
    const bytes=new TextEncoder().encode(JSON.stringify(semantic)),digest=await crypto.subtle.digest('SHA-256',bytes);
    return {target,started,requested:requested?.at,presented:presented?.at,ready:ready?.at,observedReadyAt,wallToReady:observedReadyAt-started,marks,longTasks:__w2Long.filter(e=>e.start<(ready?.at||Infinity)&&e.start+e.ms>=started),semanticHash:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''),visible:__PANDOLAB_VIEWER__.visibleTerritorialCount(),labels:labelNodes.length,semanticBytes:bytes.length};
   },{target,started});
   if(!plain&&(!sample.requested||!sample.presented||!sample.ready))throw Error('Missing transition markers');
   if(sample.visible<=0||sample.labels<=0){row.samples.push(sample);await page.screenshot({path:base+'/'+name+'-failure.png'});row.dom=await page.content();throw Error('Empty map '+JSON.stringify({visible:sample.visible,labels:sample.labels}));}
   row.samples.push(sample);console.log('W2_SAMPLE '+JSON.stringify({name,index:i,target,display:sample.presented-sample.requested,ready:sample.ready-sample.requested,longTask:Math.max(0,...sample.longTasks.map(e=>e.ms)),hash:sample.semanticHash,labels:sample.labels}));
   if(i===0)await page.screenshot({path:base+'/'+name+'.png'});
  }
  row.memoryEnd=(await pageCDP.send('Performance.getMetrics')).metrics;row.targetsEnd=(await cdp.send('Target.getTargets')).targetInfos.map(t=>({type:t.type,url:t.url}));row.nativeEnd=nativeMemory((await cdp.send('SystemInfo.getProcessInfo')).processInfo);row.status='passed';
 }catch(e){row.status='failed';row.failure=String(e.stack||e);console.log('W2_ERROR '+name+' '+row.failure);}
 finally{
  if(cdp&&!plain){try{const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await done;writeFileSync(base+'/'+name+'-trace.json.gz',gzipSync(JSON.stringify({traceEvents:events})));}catch(e){row.traceError=String(e);}}
  await browser?.close();if(row.processes)row.processesAfterClose=nativeMemory(row.processes);row.errors=errors;row.warnings=warnings;row.traceEvents=events.length;results.push(row);writeFileSync(base+'/'+name+'.json',JSON.stringify(row,null,2));writeFileSync(base+'/'+phase+'-results.json',JSON.stringify(results,null,2));
 }
 if(row.status!=='passed'||errors.length)throw Error('Run failed '+name);
}
const phase=process.argv[2]||'smoke';
if(phase==='smoke')await run('smoke');
if(phase==='baseline'){
 for(let i=0;i<3;i++)await run('plain-'+i,{plain:true});
 for(let i=0;i<5;i++)await run('A-'+i);
 await run('B',{software:true,warm:8});
 for(let i=0;i<5;i++)await run('A2-'+i,{warm:i===4?20:0});
}
if(phase==='control')for(const point of ['worker','main'])for(let i=0;i<3;i++)for(const variant of ['normal','delay','restore'])await run(point+'-'+i+'-'+variant,{delay:variant==='delay'?{point,ms:1000}:null});
if(phase==='calibration'){for(let i=0;i<3;i++)await run('minimal-'+i,{plain:true});for(let i=0;i<3;i++)await run('thin-'+i,{profile:false});}
if(phase==='safety')await run('safety',{profile:false});
if(phase==='exact'){await run('safety-exact',{profile:false});await run('main-exact-delay',{profile:false,delay:{point:'main',ms:1000}});}
console.log('W2_DONE '+phase+' '+base);
