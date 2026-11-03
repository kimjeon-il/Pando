import {chromium,expect} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createWorkerMemoryProbe} from '../tests/browser/helpers/soviet-memory-attribution.mjs';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Specify evidence directory');mkdirSync(base,{recursive:true});
const sourceA='ee6efddb7335a6665647cc69951e40103830c3e8',sourceB='0af8b63d2efbeb19e9b677ec23d5f3fb92abfb83';
function nativeMemory(info){const ids=info.map(p=>Number(p.id)).filter(Number.isInteger);if(!ids.length)return[];return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','@(Get-Process -Id '+ids.join(',')+' -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true})||'[]');}
async function cacheState(cdp){
 const target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='worker'&&t.url.includes('country-shared-boundary-worker.js'));if(!target)return{available:false,reason:'No boundary target'};
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let listener,timer;
 try{const result=new Promise((resolve,reject)=>{listener=p=>{if(p.sessionId!==sessionId)return;const m=JSON.parse(p.message);if(m.id!==901)return;clearTimeout(timer);m.error?reject(Error(m.error.message)):resolve(m.result);};cdp.on('Target.receivedMessageFromTarget',listener);timer=setTimeout(()=>reject(Error('cache query timeout')),15000);});
 await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:901,method:'Runtime.evaluate',params:{returnByValue:true,expression:`(()=>{if(typeof retainedPacket==='undefined')return{supported:false,count:null,residentBytes:null};const r=retainedPacket;return{supported:true,count:r?1:0,residentBytes:r?.residentBytes||0,budget:PACKET_REUSE_BUDGET,arrays:r?[r.packet,r.packet.outlineOverrides].flatMap(p=>[p.startsEnds,p.preparedGeometry.instances,p.preparedGeometry.nodes].map(a=>({bytes:a.byteLength,detached:typeof a.buffer.detached==='boolean'?a.buffer.detached:null}))):[],segments:r?.packet?.segments?.length??0};})()`}})});
 const r=await result;return r.exceptionDetails?{available:false,reason:r.exceptionDetails.text}:{available:true,...r.result.value};
 }finally{clearTimeout(timer);if(listener)cdp.removeListener('Target.receivedMessageFromTarget',listener);await cdp.send('Target.detachFromTarget',{sessionId});}
}
async function checkpoint(cdp,main,workers,at){
 const before={main:await main.send('Runtime.getHeapUsage'),workers:await workers.sample({collectGarbage:false}),cache:await cacheState(cdp),native:nativeMemory((await cdp.send('SystemInfo.getProcessInfo')).processInfo)};
 await main.send('HeapProfiler.collectGarbage');const after={main:await main.send('Runtime.getHeapUsage'),workers:await workers.sample({collectGarbage:true}),cache:await cacheState(cdp),native:nativeMemory((await cdp.send('SystemInfo.getProcessInfo')).processInfo)};
 if(after.cache.supported&&(after.cache.residentBytes>96*1024**2||after.cache.count>1||after.cache.arrays.some(a=>a.detached===true)))throw Error('Retained cache bound/detach failure');
 console.log('W3_MEMORY '+JSON.stringify({at,main:after.main.usedSize,worker:after.workers.workers.find(w=>w.url.includes('country-shared-boundary-worker.js'))?.jsHeap?.usedBytes,cache:after.cache}));return{at,before,after};
}
async function snapshot(page){return page.evaluate(async()=>{
 const d=__PANDOLAB_VIEWER__.documentSnapshot(),labels=[...document.querySelectorAll('svg text')].map(e=>[e.textContent,e.getAttribute('x'),e.getAttribute('y'),e.parentElement.getAttribute('transform')]).sort();
 const body={entities:d.territorialEntities,geometries:d.geometries,timeline:d.timelineRecords,labels,paths:[...document.querySelectorAll('#viewerLabels path')].map(e=>e.getAttribute('d')).sort()};
 const bytes=new TextEncoder().encode(JSON.stringify(body));const digest=await crypto.subtle.digest('SHA-256',bytes);return{hash:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''),labels,bytes:bytes.length,visible:__PANDOLAB_VIEWER__.visibleTerritorialCount(),month:__PANDOLAB_VIEWER__.builtinMonth().month,cursor:__PANDOLAB_VIEWER__.documentState().timelineCursor};
 });}
async function run(name,{port,expected,transitions=2,memory=false,forced=false,forcedCount=3,safety=false,trace=true}={}){
 if(['.json','.json.gz','-trace.json.gz','-checkpoint.json','-checkpoint.json.gz','-0.png'].some(s=>existsSync(base+'/'+name+s)))throw Error('Preserve existing evidence '+name);
 console.log('W3_START '+name);const report={name,port,expected,memory,trace,samples:[],checkpoints:[],errors:[],warnings:[],status:'pending',startedAt:new Date().toISOString()};const events=[];let browser,cdp,main,workers,allPids=[];
 try{
  browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});report.browserVersion=browser.version();cdp=await browser.newBrowserCDPSession();report.system=(await cdp.send('SystemInfo.getInfo')).gpu;
  if(trace){cdp.on('Tracing.dataCollected',e=>events.push(...e.value));await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,cc,gpu',transferMode:'ReportEvents'});}
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,timezoneId:'Asia/Seoul',locale:'ko-KR',reducedMotion:'reduce'});
  await context.addInitScript(()=>{globalThis.__w2Mark=(stage,edge,extra={})=>performance.mark('W2|'+JSON.stringify({stage,edge,...extra}));globalThis.__w3Long=[];new PerformanceObserver(list=>{for(const e of list.getEntries())__w3Long.push({start:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push({type:m.type(),text:m.text()});});
  await page.goto('http://127.0.0.1:'+port+'/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:90000});await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:150000});
  report.identity=await page.evaluate(()=>{const c=document.querySelector('#viewerCanvas'),g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return{renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),version:g.getParameter(g.VERSION),width:c.width,height:c.height,dpr:devicePixelRatio,build:PANDOLAB_BUILD_META,month:__PANDOLAB_VIEWER__.builtinMonth().month};});
  const id=report.identity;if(report.browserVersion!=='151.0.7922.34'||!report.system.devices.some(d=>d.deviceString==='NVIDIA GeForce GTX 1650'&&d.driverVersion==='32.0.16.1088')||!/NVIDIA.*Direct3D11/.test(id.renderer)||report.system.featureStatus.gpu_compositing!=='enabled'||id.width!==1280||id.height!==752||id.dpr!==1||!id.version.includes('WebGL 2.0')||id.build.sourceCommit!==expected||id.build.dataRevision!=='data-f50b7f480c812df6f5ea0c40f5461ab0'||id.month!=='2026-11')throw Error('Hardware/source/data identity mismatch');
  if(process.argv[2]==='initial'){report.initialReadiness=await page.evaluate(()=>__w2Readiness());report.initialSemantic=await snapshot(page);await page.screenshot({path:base+'/'+name+'-initial.png'});}
  if(memory){await expect.poll(()=>page.evaluate(()=>__PANDOLAB_VIEWER__.rendererStats().countrySharedBoundaryReady),{timeout:120000}).toBe(true);main=await context.newCDPSession(page);workers=await createWorkerMemoryProbe(cdp,{origin:'http://127.0.0.1:'+port});report.checkpoints.push(await checkpoint(cdp,main,workers,0));}
  for(let i=0;i<transitions;i++){
   const target=i%2===0?'2025-12':'2026-11';await page.evaluate(()=>{performance.clearMarks();__w3Long=[];});
   await page.locator(i%2===0?'#timelinePreviousYear':'#timelineNextYear').click();await expect.poll(()=>page.evaluate(()=>({month:__PANDOLAB_VIEWER__.builtinMonth().month,cursor:__PANDOLAB_VIEWER__.documentState().timelineCursor,ready:document.querySelector('#viewerStatus').dataset.ready})),{timeout:120000}).toEqual({month:target,cursor:target,ready:'true'});
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const row=await page.evaluate(()=>{const marks=performance.getEntriesByType('mark').filter(e=>e.name.startsWith('W2|')).map(e=>({...JSON.parse(e.name.slice(3)),at:e.startTime}));const at=edge=>marks.find(m=>m.stage==='transition'&&m.edge===edge)?.at;return{requested:at('requested'),presented:at('presented'),ready:at('ready'),marks,longTasks:__w3Long.filter(e=>e.start<at('ready')&&e.start+e.ms>=at('requested'))};});
   if(![row.requested,row.presented,row.ready].every(Number.isFinite))throw Error('Missing timing markers');Object.assign(row,{index:i,target,displayMs:row.presented-row.requested,readyMs:row.ready-row.requested,semantic:await snapshot(page)});
   if(row.semantic.visible<=0||!row.semantic.labels.length||row.semantic.month!==target||row.semantic.cursor!==target)throw Error('Map correctness failed');report.samples.push(row);
   console.log('W3_SAMPLE '+JSON.stringify({name,i,target,display:row.displayMs,ready:row.readyMs,hash:row.semantic.hash}));
   if(i===0||i===transitions-1)await page.screenshot({path:base+'/'+name+'-'+i+'.png'});
   if(memory&&[10,20,40,60,100,160].includes(i+1)){report.checkpoints.push(await checkpoint(cdp,main,workers,i+1));writeFileSync(base+'/'+name+'-checkpoint.json',JSON.stringify(report,null,2));}
  }
  if(forced){report.forced=[];for(let i=0;i<forcedCount;i++){const id=await page.evaluate(()=>__W3_FORCE());await expect.poll(()=>page.evaluate(id=>performance.getEntriesByType('mark').some(e=>e.name.includes('"stage":"main-receive"')&&e.name.includes('"requestId":'+id+',')),id),{timeout:60000}).toBe(true);await expect.poll(()=>page.evaluate(()=>__PANDOLAB_VIEWER__.rendererStats().countrySharedBoundaryReady),{timeout:60000}).toBe(true);report.forced.push({id,semantic:await snapshot(page)});if(memory&&[10,20,40,60].includes(i+1))report.checkpoints.push(await checkpoint(cdp,main,workers,'forced-'+(i+1)));}}
  if(safety){const before=await snapshot(page);await page.evaluate(()=>__w2ReplayStale());const rejected=await page.evaluate(()=>performance.getEntriesByType('mark').filter(e=>e.name.includes('"stage":"rejected"')).length);const after=await snapshot(page);report.stale={rejected,unchanged:before.hash===after.hash};if(rejected!==4||before.hash!==after.hash)throw Error('Stale safety failed');}
  allPids=(await cdp.send('SystemInfo.getProcessInfo')).processInfo;report.processesEnd=allPids;report.status='passed';if(report.errors.length)throw Error('Browser errors');
 }catch(e){report.status='failed';report.failure=String(e.stack||e);console.log('W3_ERROR '+name+' '+report.failure);}
 finally{await workers?.dispose();if(cdp&&trace){try{const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');await done;writeFileSync(base+'/'+name+'-trace.json.gz',gzipSync(JSON.stringify({traceEvents:events})));}catch(e){report.traceError=String(e);}}await browser?.close();report.processesAfterClose=nativeMemory(allPids);report.finishedAt=new Date().toISOString();writeFileSync(base+'/'+name+'.json',JSON.stringify(report,null,2));}
 if(report.status!=='passed')throw Error('Failed '+name);
}



const arm=process.env.W65_ARM, port=Number(process.env.W65_PORT), expected=process.env.W65_SOURCE;if(!['A','B','A2'].includes(arm))throw Error('Invalid arm');await run('w65-'+arm+'-memory',{port,expected,memory:true,trace:false,transitions:60});
