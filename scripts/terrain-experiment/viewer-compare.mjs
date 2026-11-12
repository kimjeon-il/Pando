#!/usr/bin/env node
// P7-based, opt-in regional A1/512 tile experiment. No production assets change.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {a1TerrainFragmentSource} from './a1-shader.mjs';
import {makeViewerFixtureManifest} from './viewer-fixture.mjs';
import {serve,identity,mapSummary,chromiumProcessMemory} from '../p7-browser-ab-measure.mjs';
import {performanceCounters,performanceDelta,captureAcceptedFrame,runViewerPhases} from './viewer-phases.mjs';
import {inspectFixtureCoverage,withNormalizedAdmissionBudget,withExperimentViewInvalidation,withPlaceSnapshotTrace,scaleAtZoom} from './fixture-coverage.mjs';
import {regionalOrigin} from './gutter-fixture.mjs';
import {candidateSequence} from './candidate-sequence.mjs';
import {prefetchFixtureTiles} from './fixture-transfer.mjs';

const region=process.argv.find(arg=>arg.startsWith('--region='))?.slice('--region='.length)||'southwest-china';
if(!['southwest-china','thai-lowland','netherlands-coast'].includes(region))throw Error('Unknown representative region');
const revision='11c1d4be35ec3d5aeab57393f2f947f6d810ad7d';
const base=`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/reports/development/performance/terrain-architecture-2026-11-12/p2/fixtures-coverage/webp/`;
const manifestHash='3093b6164d6907ce78f48e2ceade139274aea73827c124f878b721407eaa7e82';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
const smoke=process.argv.includes('--smoke');
const includeCog=process.argv.includes('--cog');
const includeScreen=process.argv.includes('--screen');
const normalizedBudget=process.argv.includes('--normalized-budget');
const comparisonPolicy={byteBudget:(normalizedBudget?192:96)*1024*1024,bytesPerPixel:12};
if(!out)throw Error('Explicit --out directory required');
await mkdir(out,{recursive:false});
const fixtureResponse=await fetch(base+'manifest.json');
if(!fixtureResponse.ok)throw Error(`Fixture manifest HTTP ${fixtureResponse.status}`);
const fixtureBytes=Buffer.from(await fixtureResponse.arrayBuffer());
if(digest(fixtureBytes)!==manifestHash)throw Error('Fixture manifest hash mismatch');
const fixture=JSON.parse(fixtureBytes),runs=[];
const only=process.argv.find(arg=>arg.startsWith('--candidate='))?.slice('--candidate='.length)||null;
const sequence=candidateSequence({smoke,cog:includeCog,screen:includeScreen,only});
let tilePrefetch=null;
if(sequence.some(candidate=>['a1','b512','screen'].includes(candidate))){
  try{tilePrefetch=await prefetchFixtureTiles({records:fixture.records,region,base});}
  catch(error){
    await writeFile(`${out}/preflight-error.json`,JSON.stringify({status:'failed',stage:'tile-prefetch',region,
      fixtureRevision:revision,error:String(error?.stack||error)},null,2)+'\n');
    throw error;
  }
}
let cogManifest,cogBytes,cogBundle,cogSource;
if(includeCog&&(!only||only==='cog')){
  const hashes={'southwest-china':'b578c6f0e7e2df30d267c2ece476f7e889c149319595e710e6ae0110fef183ab',
    'thai-lowland':'e49dde3cd8fff7ef1f73a401d222d517b57f092913c6e7c2f54649a7d273d8db',
    'netherlands-coast':'2200c4247f04c524ad3656883bf2738b72e39f931731dc3243a16686070a739c'};
  const names={'southwest-china':'china','thai-lowland':'thai','netherlands-coast':'netherlands'};
  const settings={revision:'0fc425921e1fb431ef35d9af6f5ac762f2b3a269',folder:`coverage-${names[region]}`,hash:hashes[region]};
  cogSource=settings;
  const root=`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${settings.revision}/reports/development/performance/terrain-architecture-2026-11-12/p3/${settings.folder}/`;
  const response=await fetch(root+'manifest.json');if(!response.ok)throw Error('COG manifest download failed');
  const raw=Buffer.from(await response.arrayBuffer());
  if(digest(raw)!==settings.hash)throw Error('COG manifest hash mismatch');
  cogManifest=JSON.parse(raw);const file=await fetch(root+cogManifest.filename);if(!file.ok)throw Error('COG fixture download failed');
  cogBytes=Buffer.from(await file.arrayBuffer());
  if(cogBytes.length!==cogManifest.bytes||digest(cogBytes)!==cogManifest.sha256)throw Error('COG fixture hash mismatch');
  const bundle=await build({stdin:{contents:"export {openViewerCogTiles} from './scripts/terrain-experiment/viewer-cog-tiles.mjs';",
    resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'PandoCogFixture',write:false});
  cogBundle=bundle.outputFiles[0].text;
}
let screenBundle;
if(includeScreen&&(!only||only==='screen')){
  const bundle=await build({stdin:{contents:"export {createViewerScreenSpace} from './scripts/terrain-experiment/viewer-screen-space.mjs';",
    resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'PandoScreenFixture',write:false});
  screenBundle=bundle.outputFiles[0].text;
}
const report={schema:'pando-terrain-viewer-regional-ab-v1',identity:identity(),fixtureRevision:revision,region,
  fixtureManifestSha256:manifestHash,sequence,startedAt:new Date().toISOString(),runs,status:'running',
  ...(tilePrefetch?{tilePrefetch:{files:tilePrefetch.files,bytes:tilePrefetch.bytes,durationMs:tilePrefetch.durationMs}}:{}),
  comparisonPolicy,normalizedBudget,
  ...(cogSource?{cogSource}:{}),
  clockPolicy:'Date offset starts at 2026-11-06; native timers and elapsed time continue normally.',
  limitations:['Only a bounded LOD5 region uses Q1; lower LODs use the original v0.14 tiles.',
    'A0 is a separate existing-data baseline served by the existing local server; it does not use Q1, the experiment shader, a modified admission budget, or the in-memory fixture proxy.',
    ...(normalizedBudget?['A1/B/C/D use an experiment-only 192MiB visible DEM admission limit; A0 retains the product default of 96MiB and may select a coarser level.']:[]),
    'Programmatic camera setup triggers the full view invalidation in this experiment so label layout follows the camera.',
    'Only WebGL2 at desktop DPR 1 on SwiftShader; smoke mode covers one stationary 32x scene only.',
    'Warm return is same-page memory/cache reuse, not a separate browser warm-navigation measurement.',
    '512 versus 1024 varies tile partition only; an atlas or instancing optimization is not implemented.',
    'Verified tiles and COG bytes are prefetched outside timing and served from memory through interception; request origins differ and CDP totals are not real-host transfer measurements.',
    'COG runs use a simulated same-origin 206 range host; GitHub raw CORS is not fixed by this test.',
    'Screen-space D is a bounded 512-tile atlas prototype; unsupported coverage retains the existing tile path and is not counted as D.',
    'The 8x and 16x phases use existing lower-LOD data; screen-space D is not verified in those phases.',
    'rAF intervals are scheduling proxies, not actual GPU presentation or GPU time.']};
let server,browser;
try{
  server=await serve();
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader',
    '--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  report.browserVersion=browser.version();
  for(let index=0;index<sequence.length;index++){
    const candidate=sequence[index],size=['b512','screen'].includes(candidate)?512:1024;
    const run={index:index+1,candidate,tileSize:candidate==='a0'?null:size,admissionBudgetMiB:candidate==='a0'?96:(normalizedBudget?192:96),status:'running',candidateRequests:[],placeNetwork:[],placeWorkers:[],pageErrors:[],consoleErrors:[],routeErrors:[],error:null};
    runs.push(run);const page=await browser.newPage({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul'});
    let selected=candidate==='a0'?{center:region==='southwest-china'?[102,28]:region==='thai-lowland'?[100,15]:[5.5,53]}:null;
    let manifestRequests=0,shaderRequests=0,budgetRequests=0,hostRequests=0,processCdp,pageCdp,phaseName='startup';
    const network=new Map();
    try{
      page.on('pageerror',error=>run.pageErrors.push(String(error)));
      page.on('console',message=>{if(message.type()==='error'&&run.consoleErrors.length<50)run.consoleErrors.push(message.text().slice(0,2000));});
      const placeRequest=request=>/\/places\/|place-worker|worker-rpc-host/.test(request.url());
      page.on('worker',worker=>{if(worker.url().includes('place-worker'))run.placeWorkers.push({url:worker.url(),observedAt:new Date().toISOString()});});
      page.on('requestfinished',request=>{if(placeRequest(request))run.placeNetwork.push({url:request.url(),outcome:'finished',timing:request.timing()});});
      page.on('requestfailed',request=>{if(placeRequest(request))run.placeNetwork.push({url:request.url(),outcome:'failed',failure:request.failure()?.errorText,timing:request.timing()});});
      await page.addInitScript(()=>{globalThis.__pandoPlaceSnapshots=[];});
      await page.route('**/assets/js/modules/territorial-labels.js*',async route=>{
        try{const response=await route.fetch(),body=withPlaceSnapshotTrace(await response.text());
          return await route.fulfill({status:200,contentType:'text/javascript',body});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      await page.route('**/assets/js/modules/map-workspace-host.js*',async route=>{
        try{const response=await route.fetch(),body=withExperimentViewInvalidation(await response.text());hostRequests++;
          return await route.fulfill({status:200,contentType:'text/javascript',body});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      if(candidate==='screen'){
        const center=region==='southwest-china'?[102,28]:region==='thai-lowland'?[100,15]:[5.5,53];
        const origin=[regionalOrigin(Math.floor((center[0]+180)*120),1024,{alignWorld:true,block2:true}),
          regionalOrigin(Math.floor((90-center[1])*120),1024,{alignWorld:true,block2:true})];
        await page.addInitScript({content:`${screenBundle}\nglobalThis.__pandoScreen=PandoScreenFixture.createViewerScreenSpace(${JSON.stringify({origin,tileSize:512})});`});
      }
      if(normalizedBudget&&candidate!=='a0')await page.route('**/terrain-tile-selection-core.js*',async route=>{
        try{
          const response=await route.fetch(),source=await response.text();
          const body=withNormalizedAdmissionBudget(source);
          budgetRequests++;
          return await route.fulfill({status:200,contentType:'text/javascript',body});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      await page.addInitScript(()=>{globalThis.__pandoCaptureFrame={requested:false,result:null};});
      await page.route('**/assets/js/modules/gpu-map-renderer.js*',async route=>{
        try{
          const response=await route.fetch();let source=await response.text();
          if(candidate==='screen'){
            const marker="function renderTerrain(pass = 'land') {\n      for (const tile of preparedTerrain) drawTerrainTile(tile, pass);\n    }";
            if(!source.includes(marker))throw Error('Viewer terrain render contract changed');
            const replacement=`function renderTerrain(pass = 'land') {\n      const dark=getSystemTheme()==='dark';\n      const palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme(dark?'dark':'light');\n      if(globalThis.__pandoScreen?.draw({gl,tiles:preparedTerrain,frame:activeFrameContext || lastVisualFrame,pass,physicalStyle:state.physicalSettings.terrainStyle==='physical',dark,palette})){performanceMetrics.webGlDirectDrawCallCount++;return;}\n      for (const tile of preparedTerrain) drawTerrainTile(tile, pass);\n    }`;
            source=source.replace(marker,replacement);
          }
          const renderMarker='    function renderWebGl(visualFrame, { interactionOnly = false } = {}) {';
          if(!source.includes(renderMarker))throw Error('Viewer render entrypoint changed');
          source=source.replace(renderMarker,renderMarker+`\n      if(globalThis.__pandoCaptureFrame?.forceBase){\n        sceneColorCache.invalidate('experiment-capture');interactionOnly=false;globalThis.__pandoCaptureFrame.forceBase=false;\n      }`);
          const marker='      frameTimes.push(performance.now() - started);';
          if(!source.includes(marker))throw Error('Viewer capture point changed');
          const capture=`      if(globalThis.__pandoCaptureFrame?.requested&&!globalThis.__pandoCaptureFrame.result\n        &&!webglContextLost&&!baseSubmissionFailed&&mapReadiness().mapReady\n        &&terrainPreparation?.stats().terrainReady&&gl.getParameter(gl.FRAMEBUFFER_BINDING)===null){\n        const pixels=new Uint8Array(pixelWidth*pixelHeight*4);\n        gl.readPixels(0,0,pixelWidth,pixelHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);\n        globalThis.__pandoCaptureFrame.result={pixels,width:pixelWidth,height:pixelHeight,frameId:visualFrame.frameId,scale:visualFrame.scale};\n      }\n`;
          return await route.fulfill({status:200,contentType:'text/javascript',body:source.replace(marker,capture+marker)});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      if(candidate==='cog'){
        await page.route('**/__terrain_experiment/regional-q1.tif',route=>{
          const match=/^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range||'');
          if(!match)return route.fulfill({status:416,body:''});
          const start=Number(match[1]),end=Math.min(Number(match[2]),cogBytes.length-1);
          if(start>=cogBytes.length||end<start)return route.fulfill({status:416,body:''});
          return route.fulfill({status:206,contentType:'image/tiff',body:cogBytes.subarray(start,end+1),
            headers:{'Content-Range':`bytes ${start}-${end}/${cogBytes.length}`,'Accept-Ranges':'bytes'}});
        });
        const init=`${cogBundle}\nglobalThis.__pandoCogReady=PandoCogFixture.openViewerCogTiles(${JSON.stringify({
          url:'http://127.0.0.1:4173/__terrain_experiment/regional-q1.tif',cogManifest,tileManifest:fixture,tileSize:size,region})});`;
        await page.addInitScript({content:init});
        await page.route('**/assets/js/modules/terrain-manifest.js*',async route=>{
          try{
            const response=await route.fetch(),source=await response.text();
            const marker='export async function fetchTerrainTile(request, { signal, fetchFn = fetch } = {}) {';
            if(!source.includes(marker))throw Error('Terrain tile source contract changed');
            const injection=`\n  if(globalThis.__pandoCogReady&&new URL(request.url).pathname.includes('/terrain/v0.15.0/5/')){\n    const key='5/'+new URL(request.url).pathname.split('/5/').pop();\n    return (await globalThis.__pandoCogReady).readTile(key,{signal});\n  }\n`;
            return await route.fulfill({status:200,contentType:'text/javascript',body:source.replace(marker,marker+injection)});
          }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
        });
      }
      if(candidate!=='a0')await page.route('**/assets/js/modules/terrain-dem-shaders.js*',route=>{
        shaderRequests++;
        const body=`export function terrainDemFragmentSource(v){if(v===1)return ${JSON.stringify(a1TerrainFragmentSource(1))};if(v===2)return ${JSON.stringify(a1TerrainFragmentSource(2))};throw Error('WebGL version');}`;
        return route.fulfill({status:200,contentType:'text/javascript',body});
      });
      if(candidate!=='a0')await page.route('**/terrain/v0.14.0/manifest.json*',async route=>{
        try{
          const original=await route.fetch();if(!original.ok())throw Error('Original terrain manifest fetch failed');
          selected=makeViewerFixtureManifest(await original.json(),fixture,size,region);manifestRequests++;
          return await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(selected.manifest)});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      if(candidate!=='a0')await page.route('https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/**/terrain/v0.15.0/**',async route=>{
        try{
        const url=new URL(route.request().url()),parts=url.pathname.split('/terrain/v0.15.0/');
        const key=parts[1];
        if(!selected||!key)return route.abort('failed');
        if(key.startsWith('5/')){
          const item=selected.tiles.get(key);if(!item){run.candidateRequests.push({key,error:'outside fixture'});return route.abort('failed');}
          const bytes=tilePrefetch?.tiles.get(item.file);
          if(!bytes||bytes.length!==item.bytes)throw Error('Verified fixture tile unavailable: '+key);
          run.candidateRequests.push({key,bytes:bytes.length,sha256:item.sha256});
          return await route.fulfill({status:200,contentType:'image/webp',body:bytes});
        }
        const original=url.href.replace('/terrain/v0.15.0/','/terrain/v0.14.0/');
        return await route.fulfill({response:await route.fetch({url:original})});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      await page.addInitScript(()=>{
        const meter=globalThis.__terrainFixtureFrames={active:false,last:null,gaps:[],start(){this.active=true;this.last=null;this.gaps=[];},
          stop(){this.active=false;return [...this.gaps];}};
        const tick=now=>{if(meter.active){if(meter.last!==null)meter.gaps.push(now-meter.last);meter.last=now;}requestAnimationFrame(tick);};
        requestAnimationFrame(tick);
      });
      // Keep wall-clock dates reproducible without Playwright's virtual timer
      // scheduler changing Worker RPC and retry timing in the measured app.
      await page.addInitScript(()=>{
        const NativeDate=Date,offset=NativeDate.parse('2026-11-06T03:00:00+09:00')-NativeDate.now();
        function ExperimentDate(...args){
          if(new.target)return Reflect.construct(NativeDate,args.length?args:[NativeDate.now()+offset],new.target===ExperimentDate?NativeDate:new.target);
          return new NativeDate(NativeDate.now()+offset).toString();
        }
        Object.setPrototypeOf(ExperimentDate,NativeDate);ExperimentDate.prototype=NativeDate.prototype;
        ExperimentDate.now=()=>NativeDate.now()+offset;globalThis.Date=ExperimentDate;
      });
      await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
      processCdp=await browser.newBrowserCDPSession();
      pageCdp=await page.context().newCDPSession(page);
      await pageCdp.send('Performance.enable');await pageCdp.send('Network.enable');
      pageCdp.on('Network.requestWillBeSent',event=>{
        if(/\/terrain\/|\/__terrain_experiment\//.test(event.request.url))
          network.set(event.requestId,{url:event.request.url,method:event.request.method,phase:phaseName});
      });
      pageCdp.on('Network.responseReceived',event=>{const row=network.get(event.requestId);if(row)Object.assign(row,
        {status:event.response.status,fromDiskCache:event.response.fromDiskCache,fromServiceWorker:event.response.fromServiceWorker});});
      pageCdp.on('Network.loadingFinished',event=>{const row=network.get(event.requestId);if(row)row.encodedBytes=event.encodedDataLength;});
      pageCdp.on('Network.loadingFailed',event=>{const row=network.get(event.requestId);if(row)row.failure=event.errorText;});
      await page.goto('http://127.0.0.1:4173/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>{
        const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
        return s?.canonicalMeshReady===true&&s.countriesPublishedGeneration===s.projectGeneration&&s.projectGeneration>0
          &&s.mapReadiness?.mapReady===true&&s.terrainReady===true
          &&api.builtinMonth().month==='2026-11'&&document.getElementById('viewerStatus')?.dataset.ready==='true';
      },null,{timeout:210000,polling:300});
      if(!selected||(candidate!=='a0'&&(manifestRequests!==1||shaderRequests<1)))throw Error('Experiment manifest or shader was not consumed');
      if(candidate==='a0'){
        const original=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats().terrainDatasetVersion);
        if(original!=='0.14.0')throw Error('A0 did not consume the current pinned DEM');
        run.terrainDatasetVersion=original;
      }
      if(!hostRequests)throw Error('Experimental full-view camera invalidation was not consumed');
      if(normalizedBudget&&candidate!=='a0'&&!budgetRequests)throw Error('Experimental normalized admission policy was not consumed');
      run.budgetRequests=budgetRequests;
      const initialScreenshot=await page.screenshot({timeout:30000});
      await writeFile(`${out}/viewer-${index+1}-${size}-initial.png`,initialScreenshot);
      try{run.initialFrameCapture=await captureAcceptedFrame(page,`${out}/viewer-${index+1}-${size}-initial-framebuffer.png`);}
      catch(error){run.initialFrameCaptureError=String(error);}
      if(!run.initialFrameCapture)throw Error('Cannot preflight the actual Viewer camera without its initial accepted frame');
      const initialZoom=await page.evaluate(()=>globalThis.__PANDOLAB_MAP_HOST__.getViewState().globeZoom);
      const predictedScale=scaleAtZoom(run.initialFrameCapture.scale,initialZoom,32);
      if(candidate!=='a0')run.fixtureCoverage=inspectFixtureCoverage({manifest:selected.manifest,
        availableKeys:new Set([...selected.tiles.keys()].map(key=>key.replace(/\.webp$/, ''))),
        center:selected.center,viewport:[run.initialFrameCapture.width,run.initialFrameCapture.height],
        scale:predictedScale,policy:comparisonPolicy});
      if(candidate!=='a0'){
        run.fixtureCoverage.initialZoom=initialZoom;run.fixtureCoverage.predictedScale=predictedScale;
        if(!run.fixtureCoverage.valid)throw Error('Experimental fixture does not cover the actual Viewer visibility or admission policy');
      }
      phaseName='zoom32';const countersBefore=await performanceCounters(pageCdp);
      await page.evaluate(()=>globalThis.__terrainFixtureFrames.start());
      const started=Date.now();
      await page.evaluate(center=>{
        const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
        host.setViewState({projection:'globe',view:{...view,globeRotation:[-center[0],-center[1],0],globeZoom:32}});
        host.requestRepaint('terrain-regional-fixture');
      },selected.center);
      await page.waitForFunction(current=>{
        const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats();
        return (current==='a0'?s?.terrainTargetLevel>=0&&s.terrainRenderedLevel===s.terrainTargetLevel:s?.terrainTargetLevel===5&&s.terrainRenderedLevel===5)&&s.terrainTargetTileCount>0
          &&s.terrainTargetTilesLoaded===s.terrainTargetTileCount&&s.terrainReady===true&&!s.screenLodPreparingKey
          &&s.mapReadiness?.mapReady===true;
      },candidate,{timeout:180000,polling:250});
      run.readyMs=Date.now()-started;
      await page.waitForFunction(()=>globalThis.__terrainFixtureFrames.gaps.length>=300,null,{timeout:180000,polling:250});
      run.frameGapsMs=await page.evaluate(()=>globalThis.__terrainFixtureFrames.stop());
      const sorted=[...run.frameGapsMs].sort((a,b)=>a-b),at=q=>sorted[Math.floor((sorted.length-1)*q)];
      run.frames={count:sorted.length,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99)};
      run.renderer=mapSummary(await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats()));
      run.performance=performanceDelta(countersBefore,await performanceCounters(pageCdp));
      run.chromiumProcessMemory=await chromiumProcessMemory(processCdp);
      if(candidate==='screen'){
        run.screen=await page.evaluate(()=>({...globalThis.__pandoScreen.stats}));
        if(!run.screen.draws)throw Error('Screen-space D did not draw a frame');
      }
      if(candidate==='cog'){
        run.cog=await page.evaluate(async()=>{const adapter=await globalThis.__pandoCogReady;
          return {counts:{...adapter.counts},range:{...adapter.statistics}};});
        if(!run.cog.counts.decodedTiles)throw Error('COG did not supply any visible tile');
      }
      run.center=selected.center;run.manifestRequests=manifestRequests;run.shaderRequests=shaderRequests;
      try{
        run.frameCapture=await captureAcceptedFrame(page,`${out}/viewer-${index+1}-${size}-framebuffer.png`,{screen:candidate==='screen'});
        if(Math.abs(run.frameCapture.scale-predictedScale)>Math.max(0.01,predictedScale*1e-5))throw Error('Actual 32x scale differs from preflight camera');
      }catch(error){run.frameCaptureError=String(error);}
      const screenshotPath=`${out}/viewer-${index+1}-${size}.png`,screenshotCdp=await page.context().newCDPSession(page);
      try{
        let timer;
        const capture=await Promise.race([screenshotCdp.send('Page.captureScreenshot',{
          format:'png',fromSurface:false,captureBeyondViewport:false}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP screenshot timed out')),45000);})]).finally(()=>clearTimeout(timer));
        const bytes=Buffer.from(capture.data,'base64');
        if(bytes.length<1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid screenshot payload');
        await writeFile(screenshotPath,bytes);run.screenshotMethod='CDP Page.captureScreenshot fromSurface=false';
      }catch(error){
        run.screenshotCdpError=String(error);
        try{await page.screenshot({path:screenshotPath,timeout:30000});run.screenshotMethod='Playwright page.screenshot';}
        catch(fallback){run.screenshotError=String(fallback);}
      }finally{await screenshotCdp.detach().catch(()=>{});}
      if(!run.screenshotError){
        const afterScreenshot=await readFile(screenshotPath);
        run.screenshotChange=await page.evaluate(async({before,after})=>{
          const load=async data=>createImageBitmap(await (await fetch('data:image/png;base64,'+data)).blob());
          const [a,b]=await Promise.all([load(before),load(after)]),canvas=new OffscreenCanvas(160,100),ctx=canvas.getContext('2d');
          ctx.drawImage(a,0,0,160,100);const x=ctx.getImageData(0,0,160,100).data;
          ctx.clearRect(0,0,160,100);ctx.drawImage(b,0,0,160,100);const y=ctx.getImageData(0,0,160,100).data;a.close();b.close();
          let changed=0,total=0;for(let row=8;row<94;row++)for(let col=5;col<155;col++){
            const i=(row*160+col)*4;if(Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2])>30)changed++;total++;
          }
          return {changed,total,fraction:changed/total};
        },{before:initialScreenshot.toString('base64'),after:afterScreenshot.toString('base64')});
        if(run.screenshotChange.fraction<.1)run.screenshotError='Screenshot differs too little from the initial view to establish that the zoomed frame was captured';
        if(!run.frameCaptureError){
          const captured=await readFile(`${out}/viewer-${index+1}-${size}-framebuffer.png`);
          run.screenshotFrameMatch=await page.evaluate(async({screen,frame})=>{
            const load=async data=>createImageBitmap(await (await fetch('data:image/png;base64,'+data)).blob());
            const [a,b]=await Promise.all([load(screen),load(frame)]),rect=document.getElementById('viewerCanvas').getBoundingClientRect();
            const canvas=new OffscreenCanvas(160,100),ctx=canvas.getContext('2d');
            ctx.drawImage(a,rect.left,rect.top,rect.width,rect.height,0,0,160,100);const x=ctx.getImageData(0,0,160,100).data;
            ctx.clearRect(0,0,160,100);ctx.drawImage(b,0,0,160,100);const y=ctx.getImageData(0,0,160,100).data;a.close();b.close();
            let similar=0,total=0;for(let row=8;row<94;row++)for(let col=5;col<155;col++){
              const i=(row*160+col)*4;if(Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2])<18)similar++;total++;
            }
            return {similar,total,fraction:similar/total,canvasRect:{x:rect.left,y:rect.top,width:rect.width,height:rect.height}};
          },{screen:afterScreenshot.toString('base64'),frame:captured.toString('base64')});
          if(run.screenshotFrameMatch.fraction<.4)run.screenshotError='Screenshot does not match the accepted WebGL framebuffer';
        }
      }
      run.status=run.pageErrors.length||run.consoleErrors.length||run.routeErrors.length||run.screenshotError||
        run.initialFrameCaptureError||run.frameCaptureError||run.candidateRequests.some(x=>x.error)?'failed':'passed';
      if(run.status!=='passed')run.error='Screenshot, console, candidate request, route, or page error';
      if(run.status==='passed'&&!smoke){
        run.status='running';run.phases=[];
        await runViewerPhases({page,pageCdp,processCdp,out,prefix:`viewer-${index+1}-${size}`,screen:candidate==='screen',center:selected.center,
          expectedLevel:candidate==='a0'?null:5,phases:run.phases,onStart:name=>{phaseName=name;},onPhase:()=>writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n')});
        if(run.pageErrors.length||run.consoleErrors.length||run.routeErrors.length||run.candidateRequests.some(x=>x.error)){
          run.status='failed';run.error='Console, candidate request, route, or page error during interaction phases';
        }else run.status='passed';
      }
    }catch(error){run.status='failed';run.error=String(error?.stack||error).slice(0,5000);
      run.diagnostics=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats?.()||null).catch(()=>null);
    }finally{run.placeSnapshots=await page.evaluate(()=>globalThis.__pandoPlaceSnapshots||[]).catch(()=>[]);
      run.network=[...network.values()];await pageCdp?.detach().catch(()=>{});await processCdp?.detach().catch(()=>{});await page.close();
      await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
  }
  report.status=runs.length===sequence.length&&runs.every(run=>run.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error?.stack||error).slice(0,5000);}
finally{
  report.finishedAt=new Date().toISOString();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
  await browser?.close().catch(()=>{});
  if(server){server.kill('SIGTERM');await Promise.race([new Promise(done=>server.once('exit',done)),delay(5000)]);if(server.exitCode===null)server.kill('SIGKILL');}
}
console.log('TERRAIN_REGIONAL_EXPERIMENT '+JSON.stringify({status:report.status,runs:runs.map(run=>({candidate:run.candidate,tileSize:run.tileSize,status:run.status,error:run.error?.slice(0,200)}))}));
if(report.status!=='passed')process.exitCode=1;
