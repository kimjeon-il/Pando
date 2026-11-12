#!/usr/bin/env node
// P7-based, opt-in regional A1/512 tile experiment. No production assets change.
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {a1TerrainFragmentSource} from './a1-shader.mjs';
import {makeViewerFixtureManifest,experimentCenter} from './viewer-fixture.mjs';
import {serve,identity,mapSummary,chromiumProcessMemory} from '../p7-browser-ab-measure.mjs';
import {performanceCounters,performanceDelta,captureAcceptedFrame,runViewerPhases,waitForViewerReady} from './viewer-phases.mjs';
import {inspectFixtureCoverage,withNormalizedAdmissionBudget,withExperimentViewInvalidation,withExperimentFlatStartup,withPlaceSnapshotTrace,withTerrainOnlyCapture,scaleAtZoom} from './fixture-coverage.mjs';
import {regionalOrigin} from './gutter-fixture.mjs';
import {candidateSequence} from './candidate-sequence.mjs';
import {prefetchFixtureTiles} from './fixture-transfer.mjs';

const region=process.argv.find(arg=>arg.startsWith('--region='))?.slice('--region='.length)||'southwest-china';
if(!['southwest-china','thai-lowland','himalaya','netherlands-coast'].includes(region))throw Error('Unknown representative region');
const projection=process.argv.find(arg=>arg.startsWith('--projection='))?.slice('--projection='.length)||'globe';
if(!['flat','globe'].includes(projection))throw Error('Unknown experiment projection');
const revision=region==='southwest-china'?'523a446540dabc0cd69fc8e6484a0288b6999dd3':'86bc6dc7cfbc5485ca384d34c516750e3576170f';
const fixturePath=region==='southwest-china'?'p4/china-5x4-fixtures':'p4/regions-extended-fixtures';
const base=`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/reports/development/performance/terrain-architecture-2026-11-12/${fixturePath}/webp/`;
const manifestHash=region==='southwest-china'?'fe5c13892c0fd295e93fdeac9bf695649a382e11a0ddd6ed55ef79ac55b1d778':'751715a551bd5444aba1c82fa8894e017e0e1e31eda700dafc69a442a7d2bf83';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
const smoke=process.argv.includes('--smoke');
const phaseSmoke=process.argv.includes('--phase-smoke');
const includeCog=process.argv.includes('--cog');
const includeScreen=process.argv.includes('--screen');
const includeBatch=process.argv.includes('--batch');
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
if(phaseSmoke&&(!smoke||!only))throw Error('Phase smoke requires --smoke and one explicit candidate');
const sequence=candidateSequence({smoke,cog:includeCog,screen:includeScreen,batch:includeBatch,only});
let tilePrefetch=null;
if(sequence.some(candidate=>['a1','b512','batch','screen'].includes(candidate))){
  try{tilePrefetch=await prefetchFixtureTiles({records:fixture.records,region,base});}
  catch(error){
    await writeFile(`${out}/preflight-error.json`,JSON.stringify({status:'failed',stage:'tile-prefetch',region,
      fixtureRevision:revision,error:String(error?.stack||error)},null,2)+'\n');
    throw error;
  }
}
let cogManifest,cogBytes,cogBundle,cogSource;
if(includeCog&&(!only||only==='cog')){
  const hashes={'southwest-china':'7b50a48bbce1b2a6439cf40ce4011e0a2a105d46765a8d4c6239583a475d92e3',
    'thai-lowland':'3eb83a450b442e4243cd2a8290764aff440765b9cc821cf9447daba2b84e3a6a',
    'himalaya':'969ed916f8a1ceb8cf321901bf83e1f89f2ff7a9970ace3bdfdbe4a03eca8d60',
    'netherlands-coast':'4cab20aab2c03970b8e771cc2a3bc353611fdf0d07f15950e8f73e45e717510b'};
  const settings={revision,folder:region==='southwest-china'?'p4/china-5x4-fixtures/cog':`p4/regions-extended-fixtures/cog-${region}`,hash:hashes[region]};
  cogSource=settings;
  const root=`https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${settings.revision}/reports/development/performance/terrain-architecture-2026-11-12/${settings.folder}/`;
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
let batchBundle;
if(includeBatch&&(!only||only==='batch')){
  const bundle=await build({stdin:{contents:"export {createTerrainTileBatch} from './scripts/terrain-experiment/viewer-tile-batch.mjs';",
    resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'PandoBatchFixture',write:false});
  batchBundle=bundle.outputFiles[0].text;
}
const report={schema:'pando-terrain-viewer-regional-ab-v1',identity:identity(),fixtureRevision:revision,region,projection,
  fixtureManifestSha256:manifestHash,sequence,startedAt:new Date().toISOString(),runs,status:'running',
  ...(tilePrefetch?{tilePrefetch:{files:tilePrefetch.files,bytes:tilePrefetch.bytes,durationMs:tilePrefetch.durationMs}}:{}),
  comparisonPolicy,normalizedBudget,
  ...(cogSource?{cogSource}:{}),
  clockPolicy:'Date offset starts at 2026-11-06; native timers and elapsed time continue normally.',
  limitations:['Only a bounded LOD5 region uses Q1; lower LODs use the original v0.14 tiles.',
    ...(projection==='flat'?['Experimental flat Viewer bootstrap overrides the current product startup; flat is not a current Viewer feature.']:[]),
    'A0 is a separate existing-data baseline served by the existing local server; it does not use Q1, the experiment shader, a modified admission budget, or the in-memory fixture proxy.',
    ...(normalizedBudget?['A1/B512/batch/C/D use an experiment-only 192MiB visible DEM admission limit; A0 retains the product default of 96MiB and may select a coarser level.']:[]),
    'Programmatic camera setup triggers the full view invalidation in this experiment so label layout follows the camera.',
    `Only WebGL2 at desktop DPR 1 on SwiftShader; ${smoke&&!phaseSmoke?'smoke mode covers one stationary 32x scene only':'interaction phases are included'}.`,
    'Warm return is same-page memory/cache reuse, not a separate browser warm-navigation measurement.',
    'The b512 candidate varies tile partition only; batch separately adds bounded WebGL2 atlas and instancing.',
    'B batch supports only 512 LOD5 tiles; other levels use the existing path and are not counted as batch.',
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
    const candidate=sequence[index],size=['b512','batch','screen'].includes(candidate)?512:1024;
    const run={index:index+1,candidate,tileSize:candidate==='a0'?null:size,admissionBudgetMiB:candidate==='a0'?96:(normalizedBudget?192:96),status:'running',candidateRequests:[],placeNetwork:[],placeWorkers:[],pageErrors:[],consoleErrors:[],routeErrors:[],error:null};
    runs.push(run);const page=await browser.newPage({viewport:{width:1280,height:800},locale:'ko-KR',timezoneId:'Asia/Seoul'});
    let selected=candidate==='a0'?{center:experimentCenter(region)}:null;
    let manifestRequests=0,shaderRequests=0,budgetRequests=0,hostRequests=0,flatStartupRequests=0,processCdp,pageCdp,phaseName='startup';
    const network=new Map();
    try{
      page.on('pageerror',error=>run.pageErrors.push(String(error)));
      page.on('console',message=>{if(message.type()==='error'&&run.consoleErrors.length<50)run.consoleErrors.push(message.text().slice(0,2000));});
      const placeRequest=request=>/\/places\/|place-worker|worker-rpc-host/.test(request.url());
      page.on('worker',worker=>{if(worker.url().includes('place-worker'))run.placeWorkers.push({url:worker.url(),observedAt:new Date().toISOString()});});
      page.on('requestfinished',request=>{if(placeRequest(request))run.placeNetwork.push({url:request.url(),outcome:'finished',timing:request.timing()});});
      page.on('requestfailed',request=>{if(placeRequest(request))run.placeNetwork.push({url:request.url(),outcome:'failed',failure:request.failure()?.errorText,timing:request.timing()});});
      await page.addInitScript(()=>{globalThis.__pandoPlaceSnapshots=[];});
      if(projection==='flat')await page.route('**/assets/js/modules/viewer-composition.js*',async route=>{
        try{const response=await route.fetch(),body=withExperimentFlatStartup(await response.text());flatStartupRequests++;
          return await route.fulfill({status:200,contentType:'text/javascript',body});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
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
        const center=experimentCenter(region);
        const origin=[regionalOrigin(Math.floor((center[0]+180)*120),1024,{alignWorld:true,block2:true}),
          regionalOrigin(Math.floor((90-center[1])*120),1024,{alignWorld:true,block2:true})];
        await page.addInitScript({content:`${screenBundle}\nglobalThis.__pandoScreen=PandoScreenFixture.createViewerScreenSpace(${JSON.stringify({origin,tileSize:512})});`});
      }
      if(candidate==='batch')await page.addInitScript({content:`${batchBundle}\nglobalThis.__pandoBatch=PandoBatchFixture.createTerrainTileBatch();`});
      if(normalizedBudget&&candidate!=='a0')await page.route('**/terrain-tile-selection-core.js*',async route=>{
        try{
          const response=await route.fetch(),source=await response.text();
          const body=withNormalizedAdmissionBudget(source);
          budgetRequests++;
          return await route.fulfill({status:200,contentType:'text/javascript',body});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      await page.addInitScript(()=>{globalThis.__pandoCaptureFrame={requested:false,result:null,entries:0,attempts:0,lastAttempt:null};globalThis.__pandoTerrainCapture={requested:false,result:null};});
      await page.route('**/assets/js/modules/gpu-base-scene-pass.js*',async route=>{
        try{const response=await route.fetch(),body=withTerrainOnlyCapture(await response.text());
          return await route.fulfill({status:200,contentType:'text/javascript',body});
        }catch(error){run.routeErrors.push(String(error));return route.abort('failed');}
      });
      await page.route('**/assets/js/modules/gpu-map-renderer.js*',async route=>{
        try{
          const response=await route.fetch();let source=await response.text();
          if(candidate==='screen'){
            const marker="function renderTerrain(pass = 'land') {\n      for (const tile of preparedTerrain) drawTerrainTile(tile, pass);\n    }";
            if(!source.includes(marker))throw Error('Viewer terrain render contract changed');
            const replacement=`function renderTerrain(pass = 'land') {\n      const dark=getSystemTheme()==='dark';\n      const palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme(dark?'dark':'light');\n      if(globalThis.__pandoScreen?.draw({gl,tiles:preparedTerrain,frame:activeFrameContext || lastVisualFrame,pass,physicalStyle:state.physicalSettings.terrainStyle==='physical',dark,palette})){performanceMetrics.webGlDirectDrawCallCount++;return;}\n      for (const tile of preparedTerrain) drawTerrainTile(tile, pass);\n    }`;
            source=source.replace(marker,replacement);
          }
          if(candidate==='batch'){
            const marker="function renderTerrain(pass = 'land') {\n      for (const tile of preparedTerrain) drawTerrainTile(tile, pass);\n    }";
            if(!source.includes(marker))throw Error('Viewer batched terrain render contract changed');
            const replacement=`function renderTerrain(pass = 'land') {\n      const dark=getSystemTheme()==='dark',palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme(dark?'dark':'light');\n      const before=globalThis.__pandoBatch.stats.draws;\n      if(globalThis.__pandoBatch.draw({gl,tiles:preparedTerrain,frame:activeFrameContext||lastVisualFrame,pass,physicalStyle:state.physicalSettings.terrainStyle==='physical',dark,palette,vertexSource:terrainVertexSourceWebGl2,fragmentSource:terrainDemFragmentSource(2),setViewUniforms})){performanceMetrics.webGlDirectDrawCallCount+=globalThis.__pandoBatch.stats.draws-before;return;}\n      for(const tile of preparedTerrain)drawTerrainTile(tile,pass);\n    }`;
            source=source.replace(marker,replacement);
          }
          const renderMarker='    function renderWebGl(visualFrame, { interactionOnly = false } = {}) {';
          if(!source.includes(renderMarker))throw Error('Viewer render entrypoint changed');
          source=source.replace(renderMarker,renderMarker+`\n      if(globalThis.__pandoCaptureFrame?.requested)globalThis.__pandoCaptureFrame.entries++;\n      if(globalThis.__pandoCaptureFrame?.forceBase){\n        sceneColorCache.invalidate('experiment-capture');interactionOnly=false;globalThis.__pandoCaptureFrame.forceBase=false;\n      }`);
          const marker='      frameTimes.push(performance.now() - started);';
          if(!source.includes(marker))throw Error('Viewer capture point changed');
          const capture=`      if(globalThis.__pandoCaptureFrame?.requested&&!globalThis.__pandoCaptureFrame.result){\n        const diagnostic={webglContextLost,baseSubmissionFailed,mapReady:mapReadiness().mapReady,terrainVisible:state.physicalSettings.terrainVisible,terrainReady:terrainPreparation?.stats().terrainReady,defaultFramebuffer:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null,baseResult:!!baseResult,frameId:visualFrame.frameId};\n        globalThis.__pandoCaptureFrame.attempts++;globalThis.__pandoCaptureFrame.lastAttempt=diagnostic;\n        if(!diagnostic.webglContextLost&&!diagnostic.baseSubmissionFailed&&diagnostic.mapReady\n          &&(!diagnostic.terrainVisible||diagnostic.terrainReady)&&diagnostic.defaultFramebuffer){\n          const pixels=new Uint8Array(pixelWidth*pixelHeight*4);\n          gl.readPixels(0,0,pixelWidth,pixelHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);\n          globalThis.__pandoCaptureFrame.result={pixels,width:pixelWidth,height:pixelHeight,frameId:visualFrame.frameId,scale:visualFrame.scale};\n          globalThis.__pandoTerrainCapture.requested=false;\n        }\n      }\n`;
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
      run.startupWait=await waitForViewerReady(page);
      if(!selected||(candidate!=='a0'&&(manifestRequests!==1||shaderRequests<1)))throw Error('Experiment manifest or shader was not consumed');
      if(candidate==='a0'){
        const original=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats().terrainDatasetVersion);
        if(original!=='0.14.0')throw Error('A0 did not consume the current pinned DEM');
        run.terrainDatasetVersion=original;
      }
      if(!hostRequests)throw Error('Experimental full-view camera invalidation was not consumed');
      if(projection==='flat'&&flatStartupRequests!==1)throw Error('Experimental flat startup was not consumed exactly once');
      if(normalizedBudget&&candidate!=='a0'&&!budgetRequests)throw Error('Experimental normalized admission policy was not consumed');
      run.budgetRequests=budgetRequests;
      if(projection==='flat'){
        await page.evaluate(center=>{const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
          host.setViewState({projection:'flat',view:{...view,flatCenter:center,flatZoom:1}});
          host.requestRepaint('terrain-experiment-flat-initial');},selected.center);
        await page.waitForFunction(()=>{const host=globalThis.__PANDOLAB_MAP_HOST__,s=globalThis.__PANDOLAB_VIEWER__?.rendererStats();
          return host?.getViewState()?.flatZoom===1&&s?.mapReadiness?.mapReady===true&&s.terrainReady===true&&!s.screenLodPreparingKey;
        },null,{timeout:180000,polling:250});
      }
      const initialScreenshot=await page.screenshot({timeout:30000});
      await writeFile(`${out}/viewer-${index+1}-${size}-initial.png`,initialScreenshot);
      try{run.initialFrameCapture=await captureAcceptedFrame(page,`${out}/viewer-${index+1}-${size}-initial-framebuffer.png`);}
      catch(error){run.initialFrameCaptureError=String(error);}
      if(!run.initialFrameCapture)throw Error('Cannot preflight the actual Viewer camera without its initial accepted frame');
      const initialZoom=await page.evaluate(kind=>globalThis.__PANDOLAB_MAP_HOST__.getViewState()[kind==='flat'?'flatZoom':'globeZoom'],projection);
      const predictedScale=scaleAtZoom(run.initialFrameCapture.scale,initialZoom,32);
      if(candidate!=='a0')run.fixtureCoverage=inspectFixtureCoverage({manifest:selected.manifest,
        availableKeys:new Set([...selected.tiles.keys()].map(key=>key.replace(/\.webp$/, ''))),
        center:selected.center,viewport:[run.initialFrameCapture.width,run.initialFrameCapture.height],
        scale:predictedScale,projection,policy:comparisonPolicy});
      if(candidate!=='a0'){
        run.fixtureCoverage.initialZoom=initialZoom;run.fixtureCoverage.predictedScale=predictedScale;
        if(!run.fixtureCoverage.valid)throw Error('Experimental fixture does not cover the actual Viewer visibility or admission policy');
      }
      phaseName='zoom32';const countersBefore=await performanceCounters(pageCdp);
      await page.evaluate(()=>globalThis.__terrainFixtureFrames.start());
      const started=Date.now();
      await page.evaluate(({center,projection})=>{
        const host=globalThis.__PANDOLAB_MAP_HOST__,view=host.getViewState();
        const camera=projection==='flat'?{flatCenter:center,flatZoom:32}:{globeRotation:[-center[0],-center[1],0],globeZoom:32};
        host.setViewState({projection,view:{...view,...camera}});
        host.requestRepaint('terrain-regional-fixture');
      },{center:selected.center,projection});
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
      if(candidate==='batch'){
        run.batch=await page.evaluate(()=>({...globalThis.__pandoBatch.stats}));
        if(!run.batch.draws)throw Error('B batched tile candidate did not draw a frame');
      }
      if(candidate==='cog'){
        run.cog=await page.evaluate(async()=>{const adapter=await globalThis.__pandoCogReady;
          return {counts:{...adapter.counts},range:{...adapter.statistics}};});
        if(!run.cog.counts.decodedTiles)throw Error('COG did not supply any visible tile');
      }
      run.center=selected.center;run.manifestRequests=manifestRequests;run.shaderRequests=shaderRequests;
      try{
        run.frameCapture=await captureAcceptedFrame(page,`${out}/viewer-${index+1}-${size}-framebuffer.png`,{screen:candidate==='screen',batch:candidate==='batch'});
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
      if(run.status==='passed'&&(!smoke||phaseSmoke)){
        run.status='running';run.phases=[];
        await runViewerPhases({page,pageCdp,processCdp,out,prefix:`viewer-${index+1}-${size}`,screen:candidate==='screen',batch:candidate==='batch',center:selected.center,
          projection,
          expectedLevel:candidate==='a0'?null:5,phases:run.phases,onStart:name=>{phaseName=name;},
          diagnostics:()=>page.evaluate(async current=>{
            if(current==='screen')return {screen:{...globalThis.__pandoScreen.stats}};
            if(current==='batch')return {batch:{...globalThis.__pandoBatch.stats}};
            if(current==='cog'){const adapter=await globalThis.__pandoCogReady;return {counts:{...adapter.counts},range:{...adapter.statistics}};}
            return null;
          },candidate),
          onPhase:()=>writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n')});
        if(run.pageErrors.length||run.consoleErrors.length||run.routeErrors.length||run.candidateRequests.some(x=>x.error)){
          run.status='failed';run.error='Console, candidate request, route, or page error during interaction phases';
        }else run.status='passed';
      }
    }catch(error){run.status='failed';run.error=String(error?.stack||error).slice(0,5000);
      run.diagnostics=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats?.()||null).catch(()=>null);
      run.startupDiagnostics=await page.evaluate(()=>({
        statusReady:document.getElementById('viewerStatus')?.dataset.ready??null,
        initialLoading:document.getElementById('viewer')?.dataset.initialLoading??null,
        month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth?.()?.month??null,
        view:globalThis.__PANDOLAB_MAP_HOST__?.getViewState?.()??null,
      })).catch(()=>null);
      run.captureDiagnostics=await page.evaluate(()=>{const c=globalThis.__pandoCaptureFrame,t=globalThis.__pandoTerrainCapture;
        return c?{requested:c.requested,forceBase:c.forceBase,entries:c.entries,attempts:c.attempts,lastAttempt:c.lastAttempt,
          hasFull:!!c.result,hasTerrain:!!t?.result,terrainFrameId:t?.result?.frameId??null}:null;}).catch(()=>null);
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
