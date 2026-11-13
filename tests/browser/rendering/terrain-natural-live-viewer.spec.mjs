import {test,expect} from '@playwright/test';

// Real Viewer, real immutable external library tiles and actual composited frame.
// SwiftShader Chromium is a browser-regression proxy, not a physical-GPU benchmark.
test.use({viewport:{width:1100,height:760},launchOptions:{
  args:process.platform==='win32'?['--use-angle=d3d11']:
    ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}});

function metrics(s) {
  return Object.fromEntries(['renderer','terrainReady','terrainTargetLevel','terrainTilesLoaded',
    'terrainTargetTileCount','terrainTargetTilesLoaded','terrainResolutionLimited',
    'terrainNaturalTilesLoaded','terrainNaturalCacheBytes','terrainNaturalPendingBytes',
    'terrainNaturalUploadCount','terrainNaturalRequests','terrainNaturalFailures',
    'terrainCacheBytes','terrainPendingDecodedBytes','terrainFetchConcurrency',
    'canvasTerrainNumericPixels','canvasTerrainNumericScratchPeakBytes',
    'p95CpuSubmitMs','p99CpuSubmitMs','webGlLastFrameSceneDrawCalls'].map(k=>[k,s?.[k]??null]));
}
async function imageDifference(page,first,second){
  return page.evaluate(async ({a,b})=>{
    const decode=async values=>{
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(values)],{type:'image/png'}));
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
      return {width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
    };
    const left=await decode(a),right=await decode(b);
    if(left.width!==right.width||left.height!==right.height)throw Error('Mismatched captures');
    let changed=0,maxDiff=0;
    for(let p=0;p<left.data.length;p+=4){
      const d=Math.max(...[0,1,2].map(c=>Math.abs(left.data[p+c]-right.data[p+c])));
      maxDiff=Math.max(maxDiff,d);if(d>8)changed++;
    }
    return {changedPixels:changed,maxChannelDifference:maxDiff,comparedPixels:left.width*left.height};
  },{a:[...first],b:[...second]});
}
async function sampleFramePacing(page,durationMs=1200) {
  return page.evaluate(durationMs=>new Promise(resolve=>{
    const gaps=[];let first=null,last=null;
    function frame(now){
      if(first===null)first=now;
      if(last!==null)gaps.push(now-last);
      last=now;
      if(now-first>=durationMs){
        const sorted=gaps.sort((a,b)=>a-b);
        const pct=p=>sorted.length?Math.round(sorted[Math.floor((sorted.length-1)*p)]*100)/100:null;
        resolve({rafFrames:sorted.length,durationMs:Math.round(now-first),
          gapP50Ms:pct(0.5),gapP95Ms:pct(0.95),gapP99Ms:pct(0.99),
          gapMaxMs:sorted.length?Math.round(sorted.at(-1)*100)/100:null,
          interpretation:'requestAnimationFrame scheduling proxy, not GPU presentation frame time'});
      }else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }),durationMs);
}
async function collectMemory(page){
  const session=await page.context().newCDPSession(page);
  try{
    await session.send('Performance.enable');
    await session.send('HeapProfiler.collectGarbage').catch(()=>{});
    const result=await session.send('Performance.getMetrics');
    const counters=Object.fromEntries(result.metrics.map(m=>[m.name,m.value]));
    return {mainThreadJsHeapUsedBytes:counters.JSHeapUsedSize??null,
      mainThreadJsHeapTotalBytes:counters.JSHeapTotalSize??null,
      taskDurationSeconds:counters.TaskDuration??null,
      scriptDurationSeconds:counters.ScriptDuration??null};
  }finally{await session.detach().catch(()=>{});}
}
for(const renderer of ['webgl2','canvas']){
  test('natural external preview incrementally repaints actual '+renderer+' Viewer',async({page},testInfo)=>{
    test.setTimeout(renderer==='canvas'?260_000:200_000);
    const errors=[],naturalRequests=[],catalogTraffic=[],consoleDiagnostics=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(/natural|terrain|shader|canvas|fallback/i.test(m.text()))
      consoleDiagnostics.push({type:m.type(),text:m.text().slice(0,700)});});
    page.on('request',req=>{
      if(/\/terrain\/natural\/v[^/]+\/\d+\/\d+-\d+\.webp/.test(req.url()))naturalRequests.push(req.url());
      if(/\/terrain\/natural\/candidates\//.test(req.url()))catalogTraffic.push({event:'request',url:req.url()});
    });
    page.on('response',response=>{
      if(/\/terrain\/natural\//.test(response.url()))
        catalogTraffic.push({event:'response',url:response.url(),status:response.status()});
    });
    page.on('requestfailed',req=>{
      if(/\/terrain\/natural\//.test(req.url()))
        catalogTraffic.push({event:'failed',url:req.url(),failure:req.failure()?.errorText||null});
    });
    await page.addInitScript(()=>localStorage.setItem('pandolab-user-preferences',
      JSON.stringify({version:2,appearance:{mapStyle:'standard',theme:'light'}})));
    let releaseNatural;
    const naturalGate=new Promise(resolve=>{releaseNatural=resolve;});
    let holdNatural=true,held=0;
    await page.route('**/terrain/natural/v*/*/*.webp*',async route=>{
      if(holdNatural){held++;await naturalGate;}
      if(!page.isClosed())await route.continue().catch(()=>{});
    });
    const screen=()=>page.locator('canvas.gpu-map-canvas').first();
    const read=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats());
    try{
      await page.goto('/?debug=1&renderer='+renderer+'&naturalTerrain=preview',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
      await expect.poll(async()=>{const s=await read();return s?.renderer;},{timeout:20000})
        .toBe(renderer==='canvas'?'canvas-worker':'webgl2');
      await page.evaluate(()=>{
        const host=window.__PANDOLAB_MAP_HOST__,v=host.getViewState();
        host.setViewState({projection:'globe',view:{...v,globeRotation:[-106,-30,0],globeZoom:16}});
        host.requestRepaint('natural-preview-region');
      });
      await expect.poll(async()=>{const s=await read();return s?.terrainTargetLevel===4&&s?.terrainReady;},{timeout:100000}).toBe(true);
      await expect.poll(()=>held,{timeout:25000}).toBeGreaterThan(0);
      // The DEM and physicalLand must already paint while the optional sample is held.
      const baseline=metrics(await read());
      expect(baseline.terrainReady).toBe(true);
      const baselineMemory=await collectMemory(page);
      const baselineFramePacing=await sampleFramePacing(page);
      await screen().screenshot({path:testInfo.outputPath(renderer+'-palette-before-natural.png')}).then(async()=>{});
      const before=await screen().screenshot();
      holdNatural=false;releaseNatural();
      await expect.poll(async()=>Number((await read())?.terrainNaturalTilesLoaded||0),{timeout:100000}).toBeGreaterThan(0);
      await expect.poll(async()=>Number((await read())?.terrainNaturalCacheBytes||0),{timeout:20000}).toBeGreaterThan(0);
      await page.waitForTimeout(450);
      const after=await screen().screenshot({path:testInfo.outputPath(renderer+'-natural-after.png')});
      const diff=await imageDifference(page,before,after);
      const final=metrics(await read()),memory=await collectMemory(page);
      const finalFramePacing=await sampleFramePacing(page);
      const result={schema:'pando-live-natural-preview-v1',environment:'Chromium SwiftShader (not real GPU)',
        appRevision:process.env.GITHUB_SHA??null,renderer,baseline,final,
        baselineMemory,memory,baselineFramePacing,finalFramePacing,
        naturalHttpRequests:naturalRequests.length,naturalHttpRequestUrls:naturalRequests,heldNaturalRequests:held,
        screenshotDifference:diff,pageErrors:errors,actualViewer:true,externalCandidate:'v0.1.0-preview.1',
        measuredPhysicalGpuMemory:false,measuredPhysicalGpuFrameTime:false};
      await testInfo.attach('live-natural-performance',{body:JSON.stringify(result,null,2),contentType:'application/json'});
      expect(diff.changedPixels,'Actual surface must change the presented frame, not just cache bytes').toBeGreaterThan(100);
      expect(final.terrainNaturalFailures).toBe(0);
      expect(errors).toEqual([]);
    }finally{
      holdNatural=false;releaseNatural();
      let runtime=null;
      try { runtime=await page.evaluate(()=>({
        mapStyle:document.documentElement.dataset.mapStyle,
        view:window.__PANDOLAB_MAP_HOST__?.getViewState?.(),
        physicalSettings:window.__PANDOLAB_VIEWER__?.documentState?.()?.physicalSettings ?? null,
        terrainStats:window.__PANDOLAB_VIEWER__?.rendererStats?.(),
      })); } catch(error) { runtime={error:String(error)}; }
      const diagnostic={renderer,held,errors,naturalRequests,catalogTraffic,
        consoleDiagnostics:consoleDiagnostics.slice(-25),runtime};
      console.log('NATURAL_VIEWER_DIAGNOSTIC='+JSON.stringify({
        renderer,held,errors,naturalRequests:naturalRequests.slice(0,20),catalogTraffic,
        consoleDiagnostics:consoleDiagnostics.slice(-15),
        rendererStats:metrics(runtime?.terrainStats),
        mapStyle:runtime?.mapStyle,physicalSettings:runtime?.physicalSettings,
        globeZoom:runtime?.view?.globeZoom,
      }));
      await testInfo.attach('natural-runtime-diagnostics',{body:JSON.stringify(diagnostic,null,2),contentType:'application/json'});
    }
  });
}
