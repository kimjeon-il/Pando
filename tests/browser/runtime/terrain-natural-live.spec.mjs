import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';

// Candidate metadata is injected only into the test server's existing module.
// DEM and natural bytes are fetched normally from immutable external URLs.
// No synthetic map, changed operating pin, simulated device GPU or fake pixels.
const catalogPath=process.env.PANDO_NATURAL_SURFACE_CATALOG;
const catalog=catalogPath?JSON.parse(readFileSync(catalogPath,'utf8')):null;
test.skip(!catalog,'Explicit externally verified natural preview catalog required');
test.use({viewport:{width:960,height:540},deviceScaleFactor:1,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
const percentile=(values,q)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor((sorted.length-1)*q)]:null;};

async function prepare(page,backend){
  const evidence={backend,requests:[],responses:[],errors:[],consoleErrors:[],phases:[],moduleHooks:[],
    environment:{renderer:'Chromium software ANGLE/SwiftShader',viewport:[960,540],deviceScaleFactor:1,
      gpuTimeMeasured:false,hardwarePerformanceMeasured:false,frameMetric:'requestAnimationFrame pacing, not GPU presentation time',
      memoryMetric:'declared resident terrain bytes and JS heap, not physical VRAM'},
    sourceRevision:catalog.sourceRevision,edition:catalog.version};
  page.on('request',r=>{if(r.url().includes('/terrain/'))evidence.requests.push({url:r.url(),time:Date.now()});});
  page.on('response',async r=>{if(r.url().includes('/terrain/'))evidence.responses.push({url:r.url(),status:r.status(),length:r.headers()['content-length']||null});});
  page.on('pageerror',e=>evidence.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text());});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await page.addInitScript(value=>{
    globalThis.__NATURAL_CANDIDATE__=value;
    localStorage.setItem('pandolab-user-preferences',JSON.stringify({version:2,appearance:{mapStyle:'standard'}}));
  },catalog);
  await page.route('**/modules/physical-map-controller.js*',async route=>{
    const response=await route.fetch(),body=await response.text();
    const anchor='const acceptTerrainManifest = manifest => {';
    expect(body.split(anchor).length,'test activation must target actual terrain owner').toBe(2);
    evidence.moduleHooks.push('physical-map-controller');
    await route.fulfill({response,body:body.replace(anchor,anchor+'\n      if(globalThis.__NATURAL_CANDIDATE__)manifest=Object.freeze({...manifest,naturalSurface:globalThis.__NATURAL_CANDIDATE__});')});
  });
  await page.route('**/modules/map-renderer-composition.js*',async route=>{
    const response=await route.fetch(),body=await response.text(),anchor='    return gpuMapRenderer;';
    expect(body.split(anchor).length).toBe(2);evidence.moduleHooks.push('map-renderer-composition');
    await route.fulfill({response,body:body.replace(anchor,'    globalThis.__naturalRuntime={renderer:gpuMapRenderer,ports:dependencies};\n'+anchor)});
  });
  await page.goto('/?debug=1&renderer='+backend,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{
    const api=globalThis.__PANDOLAB_VIEWER__,s=api?.rendererStats();
    return !!globalThis.__naturalRuntime&&api?.initialMapPresented()&&s.projectGeneration>0
      &&s.countriesPublishedGeneration===s.projectGeneration&&!s.projectRenderBlocked;
  },null,{timeout:150000});
  const actual=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.rendererStats().renderer);
  expect(actual).toBe(backend==='canvas'?'canvas-worker':'webgl2');
  evidence.actualRenderer=actual;
  return evidence;
}
async function move(page,lon,lat,zoom=8){
  await page.evaluate(({lon,lat,zoom})=>{
    const host=globalThis.__PANDOLAB_MAP_HOST__,runtime=globalThis.__naturalRuntime;
    host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-lon,-lat,0],globeZoom:zoom}});
    runtime.ports.domains.renderingDomain?.invalidateView?.('natural-surface-review-camera');
    host.requestRepaint('natural-surface-review-camera');
  },{lon,lat,zoom});
}
async function ready(page,requireNatural){
  await page.waitForFunction(required=>{
    const s=globalThis.__PANDOLAB_VIEWER__?.rendererStats();
    return s?.terrainReady===true&&!s.canvasWorkerBusy&&s.countriesPublishedGeneration===s.projectGeneration
      &&(!required||s.terrainNaturalTilesLoaded>0);
  },requireNatural,{polling:200,timeout:120000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function snapshot(page,evidence,name,info){
  const value=await page.evaluate(()=>{
    const s=globalThis.__PANDOLAB_VIEWER__.rendererStats();
    return {renderer:s.renderer,view:globalThis.__PANDOLAB_MAP_HOST__.getViewState(),
      targetLevel:s.terrainTargetLevel,renderedLevel:s.terrainRenderedLevel,terrainReady:s.terrainReady,
      naturalTiles:s.terrainNaturalTilesLoaded??0,naturalBytes:s.terrainNaturalCacheBytes??0,
      naturalFailures:s.terrainNaturalFailures??0,naturalRequests:s.terrainNaturalRequests??0,
      terrainCacheBytes:s.terrainCacheBytes??null,pendingBytes:s.terrainPendingDecodedBytes??null,
      numericalPixels:s.canvasTerrainNumericPixels??null,numericalScratchBytes:s.canvasTerrainNumericScratchPeakBytes??null,
      draws:s.webGlLastFrameSceneDrawCalls??null,frameCpuMs:s.webGlLastBaseSubmitMs??null,
      jsHeap:performance.memory?.usedJSHeapSize??null,theme:document.documentElement.dataset.theme,
      mapReady:s.mapReadiness,projectGeneration:s.projectGeneration,countriesGeneration:s.countriesPublishedGeneration};
  });
  evidence.phases.push({name,...value});
  await page.screenshot({path:info.outputPath(name+'.png')});return value;
}
async function setStyle(page,style,theme='light'){
  await page.evaluate(({style,theme})=>{
    const {renderer,ports}=globalThis.__naturalRuntime;
    document.documentElement.dataset.theme=theme;
    ports.projectState.state.physicalSettings={...ports.projectState.state.physicalSettings,terrainVisible:true,terrainStyle:style};
    renderer.invalidatePhysicalStyle('natural-review-style');
    ports.domains.renderingDomain?.invalidateView?.('natural-review-style');
    globalThis.__PANDOLAB_MAP_HOST__.requestRepaint('natural-review-style');
  },{style,theme});
}
async function pacing(page,lon,lat){
  return page.evaluate(async({lon,lat})=>{
    const gaps=[];let previous=null,start=performance.now();
    while(performance.now()-start<2500){
      const timestamp=await new Promise(resolve=>requestAnimationFrame(resolve));
      if(previous!==null)gaps.push(timestamp-previous);previous=timestamp;
      const host=globalThis.__PANDOLAB_MAP_HOST__,elapsed=performance.now()-start;
      host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-(lon+0.3*Math.sin(elapsed/400)),-lat,0],globeZoom:8}});
      host.requestRepaint('natural-review-motion');
    }
    return gaps;
  },{lon,lat});
}
for(const backend of ['webgl2','canvas']){
  test('actual '+backend+' natural surface screenshots and scoped timing',async({page},info)=>{
    test.setTimeout(540000);
    const evidence=await prepare(page,backend);
    try{
      for(const [region,lon,lat] of backend==='canvas'?[['china',106,30]]:[['china',106,30],['himalaya',86,28],['greenland',-44,76]]){
        const started=Date.now();await move(page,lon,lat,8);await ready(page,true);
        const light=await snapshot(page,evidence,region+'-light',info);
        evidence.phases.at(-1).settleMs=Date.now()-started;
        expect(light.targetLevel,'candidate is LOD4; do not claim another LOD is validated').toBe(4);
        expect(light.naturalTiles).toBeGreaterThan(0);expect(light.naturalFailures).toBe(0);
        if(backend==='canvas'){
          expect(light.numericalPixels).toBeGreaterThan(0);
          expect(light.numericalScratchBytes).toBeLessThanOrEqual(256*1024);
        }
        const naturalCount=()=>evidence.requests.filter(r=>r.url.includes('/terrain/natural/')).length;
        const count=naturalCount();await setStyle(page,'physical','dark');await ready(page,true);
        await snapshot(page,evidence,region+'-dark',info);
        await setStyle(page,'physical','light');await ready(page,true);
        expect(naturalCount(),'theme changes must reuse immutable source data').toBe(count);
      }
      await move(page,106,30,8);await ready(page,true);
      evidence.motion=[];
      for(let repetition=0;repetition<3;repetition++){
        const gaps=await pacing(page,106,30);
        evidence.motion.push({repetition,frames:gaps.length,p50Ms:percentile(gaps,.5),p95Ms:percentile(gaps,.95),p99Ms:percentile(gaps,.99),gaps});
        await move(page,106,30,8);await ready(page,true);
      }
      const requestsBefore=evidence.requests.filter(r=>r.url.includes('/terrain/natural/')).length;
      await setStyle(page,'political','light');await ready(page,false);
      await snapshot(page,evidence,'china-monochrome',info);
      expect(evidence.requests.filter(r=>r.url.includes('/terrain/natural/')).length).toBe(requestsBefore);
      expect(evidence.errors).toEqual([]);
      evidence.status='captured-and-measured';
    }catch(error){evidence.status='failed';evidence.error=String(error);throw error;}
    finally{
      evidence.last=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats()).catch(()=>null);
      await writeFile(info.outputPath('natural-viewer-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
      console.log('NATURAL_VIEWER_EVIDENCE='+JSON.stringify({backend,status:evidence.status,phases:evidence.phases,errors:evidence.errors,consoleErrors:evidence.consoleErrors,motion:evidence.motion?.map(({gaps,...row})=>row)}));
    }
  });
}
