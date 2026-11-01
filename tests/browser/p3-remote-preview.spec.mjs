import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

function p3PresentationFailures(state, requestedRenderer) {
  const render = state?.render;
  if (!render) return ['renderer diagnostics are missing'];
  const failures = [], positive = value => Number.isFinite(value) && value > 0;
  if (render.canonicalMeshReady !== true || render.surfaceQuality !== 'canonical' || render.canonicalPromotionError) {
    failures.push('canonical country geometry is not ready');
  }
  if (render.projectRenderBlocked !== false || !['ready', 'limited'].includes(render.readiness)) {
    failures.push('the current map has not been presented');
  }
  if (!Number.isSafeInteger(render.projectGeneration) || render.projectGeneration <= 0
    || render.countriesPublishedGeneration !== render.projectGeneration) failures.push('country publication is stale');
  for (const [displayed, requested] of [['displayedRevision', 'requestedRevision'], ['displayedGeometryRevision', 'committedGeometryRevision']]) {
    if (!Number.isSafeInteger(render[requested]) || render[requested] < 0 || render[displayed] !== render[requested]) {
      failures.push(`${requested} has no current display acknowledgement`);
    }
  }
  if (!positive(render.displayedRevision) || !positive(state.frameId) || !positive(state.countryFeatureCount)
    || render.pendingCountryCount !== 0) failures.push('the current country frame is incomplete');
  if (requestedRenderer === 'webgl2') {
    if (render.renderer !== 'webgl2' || render.webglContextLost !== false
      || render.surfaceDraw?.quality !== 'canonical' || render.surfaceDraw?.landSource !== 'physical-canonical') {
      failures.push('the WebGL country surface is not drawn');
    }
    if (![render.countries, render.surfaceDraw?.countryIndexCount, render.countryBaseIndexCount,
      render.countryVisibleCount, render.baseSceneDrawCount].every(positive)) failures.push('no visible country triangles were submitted');
  } else {
    if (!['canvas-worker', 'canvas2d'].includes(render.renderer)) failures.push('the requested Canvas renderer is unavailable');
    if (render.renderer === 'canvas-worker' && (!Number.isSafeInteger(render.canvasStyleRevision)
      || render.canvasDisplayedStyleRevision !== render.canvasStyleRevision)) failures.push('the Canvas bitmap style acknowledgement is stale');
    if (!state.pixels || state.pixels.colors <= 8 || state.pixels.opaque === 0) failures.push('the displayed Canvas is empty or uniform');
  }
  return failures;
}

async function readP3Presentation(page) {
  return page.evaluate(() => {
    const snapshot = globalThis.__PANDOLAB_RENDER_DEBUG__?.snapshot(), gpu = snapshot?.gpu;
    if (!gpu) return { render: null };
    const state = { frameId: snapshot.lastCommittedVisualFrameId,
      countryFeatureCount: globalThis.PANDOLAB_TERRITORIAL?.list({ kind: 'general', parentId: '' }).filter(feature => !!feature.geometry).length ?? 0,
      render: {
      renderer: gpu.renderer, readiness: gpu.mapReadiness?.status,
      canonicalMeshReady: gpu.canonicalMeshReady, canonicalPromotionError: gpu.canonicalPromotionError,
      surfaceQuality: gpu.surfacePresentation?.quality, surfaceDraw: gpu.surfaceDraw,
      projectGeneration: gpu.projectGeneration, countriesPublishedGeneration: gpu.countriesPublishedGeneration,
      projectRenderBlocked: gpu.projectRenderBlocked, webglContextLost: gpu.webglContextLost,
      requestedRevision: gpu.requestedRevision, displayedRevision: gpu.displayedRevision,
      committedGeometryRevision: gpu.committedGeometryRevision, displayedGeometryRevision: gpu.displayedGeometryRevision,
      pendingCountryCount: gpu.pendingCountryCount, countries: gpu.countries,
      countryBaseIndexCount: gpu.countryBaseIndexCount, countryVisibleCount: gpu.countryVisibleCount,
      baseSceneDrawCount: gpu.baseSceneDrawCount, canvasStyleRevision: gpu.canvasStyleRevision,
      canvasDisplayedStyleRevision: gpu.canvasDisplayedStyleRevision,
    } };
    // Read the renderer's actual bitmap, excluding loading text and other DOM
    // overlays. This is a bounded visibility check, not a geographic pixel golden.
    if (['canvas-worker', 'canvas2d'].includes(gpu.renderer)) {
      const canvas = document.querySelector('#map canvas.gpu-map-canvas');
      if (canvas?.width > 0 && canvas?.height > 0) {
        const sample = document.createElement('canvas'); sample.width = 64; sample.height = 64;
        const context = sample.getContext('2d', { willReadFrequently: true });
        context.drawImage(canvas, 0, 0, 64, 64);
        const rgba = context.getImageData(0, 0, 64, 64).data, colors = new Set();
        let opaque = 0;
        for (let index = 0; index < rgba.length; index += 4) if (rgba[index + 3] > 0) {
          opaque++; colors.add((rgba[index] << 16) | (rgba[index + 1] << 8) | rgba[index + 2]);
        }
        state.pixels = { colors: colors.size, opaque, width: canvas.width, height: canvas.height };
      }
    }
    return state;
  });
}

// CI screenshots document browser/viewport output, not physical GPU/mobile devices.
test.use({
  launchOptions: { args: [
    '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'
  ] },
  trace: 'off',
  screenshot: 'only-on-failure',
});
for(const config of [
  {label:'desktop',width:1280,height:800,mobile:false,renderer:'webgl2'},
  {label:'mobile-emulation',width:390,height:844,mobile:true,renderer:'canvas'},
]) {
  test(config.label+' loads real map and captures screenshot',async({browser},testInfo)=>{
    test.setTimeout(150_000);
    const ctx=await browser.newContext({
      viewport:{width:config.width,height:config.height},
      deviceScaleFactor:config.mobile?2:1,
      isMobile:config.mobile,
      hasTouch:config.mobile,
    });
    const page=await ctx.newPage(),runtimeErrors=[];
    const events={console:[],requestFailures:[],failedResponses:[]},eventCounts={console:0,requestFailures:0,failedResponses:0},consoleCaptures=[];
    const record=(kind,value)=>{
      eventCounts[kind]++;
      if(events[kind].length>=32)return false;
      events[kind].push(value);
      return true;
    };
    page.on('pageerror',err=>runtimeErrors.push(err.message));
    page.on('console',message=>{
      if(!['error','warning'].includes(message.type()))return;
      const location=message.location();
      const row={type:message.type(),text:message.text().slice(0,2048),
        location:{url:location.url.slice(0,1024),line:location.lineNumber,column:location.columnNumber}};
      if(!record('console',row))return;
      consoleCaptures.push(Promise.allSettled(message.args().slice(0,2).map(handle=>handle.evaluate(value=>
        value&&typeof value==='object'?{name:String(value.name||'').slice(0,200),message:String(value.message||value).slice(0,2048),
          code:String(value.code||'').slice(0,200),stack:String(value.stack||'').slice(0,4096)}:String(value).slice(0,2048))))
        .then(values=>{row.arguments=values.map(value=>value.status==='fulfilled'?value.value:{captureError:String(value.reason).slice(0,1024)});}));
    });
    ctx.on('requestfailed',request=>record('requestFailures',{
      url:request.url().slice(0,1024),type:request.resourceType(),error:request.failure()?.errorText?.slice(0,2048)||''}));
    ctx.on('response',response=>{
      if(response.status()>=400)record('failedResponses',{url:response.url().slice(0,1024),status:response.status()});
    });
    let ready=false,failure,presentation=null;
    try {
      await gotoEditor(page, '/?renderer='+config.renderer+'&demTerrain=raster&perf=1',
        {waitUntil:'domcontentloaded',timeout:30_000});
      const readinessDeadline=Date.now()+110_000;
      const app=page.locator('#app');
      await expect(app).toHaveAttribute('data-readiness',/^(preview|editable|enhanced)$/,
        {timeout:110_000});
      if(process.env.PANDO_P9_ACCEPTANCE==='true') {
        await page.waitForFunction(()=>/^(enhanced|error)$/.test(document.getElementById('app')?.dataset.readiness||''),undefined,{timeout:Math.max(1,readinessDeadline-Date.now())});
        await testInfo.attach('p9-startup-errors.json',{
          body:Buffer.from(JSON.stringify({runtimeErrors,readiness:await app.getAttribute('data-readiness')},null,2)),contentType:'application/json'});
        await expect(app).toHaveAttribute('data-readiness','enhanced',{timeout:1000});
      }
      await expect(page.locator('#map')).toBeVisible();
      const mapBounds=await page.locator('#map').boundingBox();
      expect(mapBounds.width).toBeGreaterThan(80);
      expect(mapBounds.height).toBeGreaterThan(80);
      await expect.poll(async()=>{
        presentation=await readP3Presentation(page);
        return p3PresentationFailures(presentation,config.renderer);
      },{timeout:Math.max(1,readinessDeadline-Date.now()),message:'the current canonical country map must actually be displayed'}).toEqual([]);
      ready=true;
      const diagnostic=await page.evaluate(()=>({
        readiness:document.getElementById('app')?.dataset.readiness,
        renderer:globalThis.__PANDOLAB_GPU_METRICS__?.renderer??null,
        previewMs:globalThis.__PANDOLAB_STARTUP_METRICS__?.previewDisplayMs??null,
        mapCanvasCount:document.querySelectorAll('#map canvas').length,
        documentTitle:document.title
      }));
      const runtimeFile=testInfo.outputPath('p3-'+config.label+'-runtime.json');
      await writeFile(runtimeFile,JSON.stringify({branch:process.env.PANDO_P3_BRANCH||'unknown',
          sha:process.env.GITHUB_SHA||'local',viewport:config,diagnostic,presentation,
          runtimeErrors},null,2)+'\n');
      await testInfo.attach('p3-'+config.label+'-runtime.json',{path:runtimeFile,contentType:'application/json'});
      expect(diagnostic.documentTitle).toBeTruthy();
      expect(runtimeErrors).toEqual([]);
    } catch(error){failure=error;} finally {
      await Promise.allSettled(consoleCaptures);
      const startup={pageClosed:page.isClosed()};
      if(!startup.pageClosed) {
        try {
          startup.state=await page.evaluate(()=>{
            const scalars=(source,keys)=>Object.fromEntries(keys.map(key=>{
              const value=source?.[key];
              return [key,typeof value==='string'?value.slice(0,2048):['number','boolean'].includes(typeof value)?value:null];
            }));
            return {
              url:location.href.slice(0,2048),title:document.title.slice(0,512),readiness:document.getElementById('app')?.dataset.readiness??null,
              bootstrap:{error:document.getElementById('bootstrapLoading')?.classList.contains('error')??false,
                message:document.getElementById('bootstrapLoadingText')?.textContent?.slice(0,512)??null,
                probe:document.getElementById('startupProbe')?.textContent?.slice(0,512)??null},
              build:scalars(globalThis.PANDOLAB_BUILD_META,['appVersion','buildId','assetRevision','dataRevision']),
              metrics:scalars(globalThis.__PANDOLAB_STARTUP_METRICS__,['startupPhase','previewReceivedMs','interactiveMs',
                'editableMs','readyMs','geometryError','meshError','canonicalGeometryReceivedMs','canonicalMeshReceivedMs','rendererStatus']),
              entry:{geometryCore:!!globalThis.PandoLabSphericalCore,countries:!!globalThis.PANDOLAB_COUNTRIES,
                mesh:!!globalThis.PANDOLAB_GPU_MESH_BUFFER,mapHost:!!globalThis.__PANDOLAB_MAP_HOST__},
              wasmMemoryResizable:typeof globalThis.WebAssembly.Memory.prototype.toResizableBuffer==='function',
              scripts:[...document.scripts].map(script=>script.src.slice(0,1024)).filter(Boolean).slice(-24),
            };
          });
        }catch(error){startup.captureError=String(error?.message||error).slice(0,2048);}
      }
      try {
        const diagnostic={branch:process.env.PANDO_P3_BRANCH||'unknown',sha:process.env.GITHUB_SHA||'local',
            viewport:config,startup,presentation,presentationPassed:ready,eventCounts,events,pageErrorCount:runtimeErrors.length,
            runtimeErrors:runtimeErrors.slice(-32).map(message=>message.slice(0,2048))};
        const file=testInfo.outputPath('p3-'+config.label+'-startup.json');
        await writeFile(file,JSON.stringify(diagnostic,null,2)+'\n');
        console.log('P3_STARTUP '+JSON.stringify(diagnostic));
        await testInfo.attach('p3-'+config.label+'-startup.json',{path:file,contentType:'application/json'});
      }catch(error){
        console.error('[P3-STARTUP-DIAGNOSTIC]',error);
        failure ||= error;
      }
      if(!page.isClosed()) {
        const file=testInfo.outputPath('p3-'+config.label+(ready?'-map.png':'-startup-failure.png'));
        try{
          await page.screenshot({path:file,fullPage:false,animations:'disabled',timeout:20_000});
          await testInfo.attach('p3-'+config.label+'-screenshot',{
            path:file,contentType:'image/png'});
        }catch(e){
          // Never turn an earlier map failure into a false successful screenshot.
          if(ready)failure ||= e;
        }
      }
      try{await ctx.close();}catch(error){failure ||= error;}
    }
    if(failure)throw failure;
  });
}
