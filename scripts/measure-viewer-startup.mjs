import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...rest]=arg.replace(/^--/,'').split('=');return [key,rest.join('=')];}));
if(!options.out||!options.label)throw Error('--out and --label are required');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const data=JSON.parse(readFileSync('config/library-data.json','utf8')).revision;
const report={schema:'pando-viewer-startup-pair-v1',commit,data,label:options.label,
  environment:{platform:process.platform,node:process.version,viewport:[1280,800],clock:'real; performance clock unmodified',
    server:'local pinned preview',cache:'fresh Chromium process for cold; same page and caches for reload'},samples:[],errors:[]};
let server,browser;
try{
  server=spawn(process.execPath,['tests/browser/server.mjs'],{env:{...process.env,PANDOLAB_TEST_PORT:'4173'},stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [server.stdout,server.stderr])stream.on('data',bytes=>{output=(output+bytes.toString()).slice(-4000);});
  let available=false;
  for(let i=0;i<300;i++){
    if(server.exitCode!==null)throw Error('Server exited: '+output);
    try{available=(await fetch('http://127.0.0.1:4173/',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
    if(available)break;await sleep(300);
  }
  if(!available)throw Error('Server did not start: '+output);
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  report.browser=browser.version();
  const context=await browser.newContext({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',colorScheme:'light'});
  const page=await context.newPage(),requests=[];
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  for(const visit of ['cold','warm']){
    const started=performance.now(),firstRequest=requests.length;
    if(visit==='cold')await page.goto('http://127.0.0.1:4173/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
    else await page.reload({waitUntil:'domcontentloaded'});
    const navigationWaitMs=performance.now()-started;
    await page.waitForFunction(()=>{
      const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
      return api?.initialMapPresented()&&s.canonicalMeshReady&&s.countrySharedBoundaryReady
        &&s.projectGeneration>0&&s.countriesPublishedGeneration===s.projectGeneration
        &&s.surfaceDraw?.countryIndexCount>0&&s.mapReadiness?.mapReady
        &&document.querySelector('#viewerStatus')?.dataset.ready==='true';
    },null,{timeout:75000,polling:100});
    const elapsedMs=performance.now()-started;
    const row=await page.evaluate(()=>{
      const api=globalThis.__PANDOLAB_VIEWER__,s=api.rendererStats();
      const gl=document.querySelector('#viewerCanvas')?.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
      return {month:api.builtinMonth().month,cursor:api.documentState().timelineCursor,visible:api.visibleTerritorialCount(),
        renderer:s.renderer,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
        mesh:s.lastMeshPreparation,countryIndexCount:s.surfaceDraw.countryIndexCount,
        boundaryWorker:s.countrySharedBoundaryWorkerActive,firstCountryPresentedNavigationMs:s.firstCountryPresentedNavigationMs??null,
        firstMeshUploadTiming:s.firstMeshUploadTiming??null,gpuUpload:s.gpuUpload??null,
        metrics:globalThis.__PANDOLAB_PERFORMANCE_REPORT__?.()??null};
    });
    const network=requests.slice(firstRequest);
    if(row.visible<=0||row.month!==row.cursor||row.mesh?.builtCount!==0||row.mesh?.source!=='prepared-country-scene')throw Error('Measurement did not present the exact prepared country scene');
    const rounded=value=>Number.isFinite(value)?Math.round(value*10)/10:null;
    const domContentLoadedMs=row.metrics?.browser?.navigation?.domContentLoadedMs??null;
    const firstCountryAfterDomMs=Number.isFinite(domContentLoadedMs)&&Number.isFinite(row.firstCountryPresentedNavigationMs)
      ?Math.max(0,row.firstCountryPresentedNavigationMs-domContentLoadedMs):null;
    const sample={visit,elapsedMs:rounded(elapsedMs),
      navigationWaitMs:rounded(navigationWaitMs),
      appAfterDomMs:rounded(elapsedMs-navigationWaitMs),
      firstCountryAfterDomMs:rounded(firstCountryAfterDomMs),...row,
      wasmRequests:network.filter(path=>path.endsWith('/pandoeditor-core.wasm')).length,
      countryDescriptorRequests:network.filter(path=>/builtin-world\/generated\/v1\/(countries|country-parts)\//.test(path)).length};
    report.samples.push(sample);
    console.log('VIEWER_STARTUP_PAIR '+JSON.stringify({label:options.label,commit,visit,elapsedMs:sample.elapsedMs,wasmRequests:sample.wasmRequests,
      countryDescriptorRequests:sample.countryDescriptorRequests,domWaitMs:sample.navigationWaitMs,appMs:sample.appAfterDomMs,firstCountryAfterDomMs:sample.firstCountryAfterDomMs,upload:sample.firstMeshUploadTiming,mesh:sample.mesh}));
  }
  if(report.errors.length)throw Error('Page errors: '+report.errors.join('; '));
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{
  writeFileSync(options.out,JSON.stringify(report,null,2)+'\n');
  await browser?.close();
  if(server){server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),sleep(2000)]);if(server.exitCode===null)server.kill('SIGKILL');}
}
