import { test, expect } from '@playwright/test';

test('Web publishes sharp ocean and land before countries, then reuses prepared terrain and meshes', async ({ page }) => {
  test.setTimeout(120000);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  let release; const gate=new Promise(resolve=>{ release=resolve; });
  await page.route(/\/terrain\/[^/]+\/(?:tint|\d+\/\d+-\d+)\.webp/, async route=>{ await gate; await route.continue(); });
  await page.addInitScript(()=>{
    const timer=setInterval(()=>{
      const viewer=window.__PANDOLAB_VIEWER__, host=window.__PANDOLAB_MAP_HOST__;
      const stats=viewer?.rendererStats();
      if(!host || !stats?.projectGeneration || stats.projectRenderBlocked)return;
      host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-24.6,-38.5,0],globeZoom:8}});
      host.requestRepaint('startup-sharp-regression');clearInterval(timer);
    },20);
  });
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
  try {
    await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
    await expect.poll(async()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats().canonicalMeshReady),{timeout:60000}).toBe(true);
    // The first physical WebGL country frame is allowed before optional DEM
    // tiles resolve. Readiness is distinct from successful base publication.
    await expect.poll(async() => {
      const state = await stats();
      return state.countriesPublishedGeneration === state.projectGeneration
        && state.firstCountryPublishedMs !== null
        && (state.surfaceDraw?.countryIndexCount || 0) > 0;
    }, { timeout: 30000 }).toBe(true);
    const early = await stats();
    expect(early.surfacePresentation.quality).toBe('canonical');
    expect(early.mapReadiness.mapReady).toBe(true);
    expect(early.terrainReady).toBe(false);
    expect(early.mapReadiness.status).not.toBe('ready');
    release();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect.poll(async() => {
      const state = await stats();
      return state.countriesPublishedGeneration === state.projectGeneration;
    }, { timeout: 60000 }).toBe(true);
    // User-visible map readiness is independent of optional DEM completion.
    // Observe both milestones separately without weakening either invariant.
    await expect.poll(async()=>(await stats()).terrainReady,{timeout:60000}).toBe(true);
    const cold=await stats();
    expect(cold.firstBackgroundFrameMs).toBeLessThan(cold.firstCountryPublishedMs);
    expect(cold.terrainReady).toBe(true);
    expect(cold.surfaceDraw.countryIndexCount).toBeGreaterThan(0);
    await expect.poll(async()=>(await stats()).terrainTilesLoading,{timeout:15000}).toBe(0);
    await expect.poll(async()=>(await stats()).terrainPendingDecodedBytes,{timeout:15000}).toBe(0);
    const beforeUploads=(await stats()).terrainUploadCount;
    await page.getByRole('button',{name:'파일 메뉴 열기'}).click();
    await page.locator('#builtinMapBtn').click();
    await expect.poll(async()=>(await stats()).projectGeneration,{timeout:60000}).toBeGreaterThan(cold.projectGeneration);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    const warm=await stats();
    expect(warm.terrainUploadCount).toBe(beforeUploads);
    expect(warm.countryMeshReuseCount).toBeGreaterThan(cold.countryMeshReuseCount || 0);
    expect(warm.countryMeshRebuildCount).toBe(cold.countryMeshRebuildCount);
    expect(warm.countryBoundaryPrepareCount).toBe(cold.countryBoundaryPrepareCount);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({cold:cold.lastMeshPreparation,warm:warm.lastMeshPreparation,background:cold.firstBackgroundFrameMs,countries:cold.firstCountryPublishedMs,uploads:beforeUploads}));
  } finally { release(); }
});


// Failures print the accepted C++ document and renderer state. Do not replace
// real readiness, date, GPU or terrain assertions with this diagnostic.
test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus)return;
  const state=await page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__,stats=api?.rendererStats?.()||{};
    const fields=['renderer','mapReadiness','projectGeneration','countriesPublishedGeneration',
      'canonicalMeshReady','projectRenderBlocked','surfacePresentation','terrainReady',
      'terrainTargetLevel','terrainRenderedLevel','terrainTargetTilesLoaded','terrainTargetTileCount',
      'terrainTilesLoading','terrainPendingDecodedBytes','screenScale','hydroPendingUploadCount',
      'webglContextLost','temporalPresentationPending','requestedRevision','displayedRevision',
      'firstBackgroundFrameMs','firstCountryPublishedMs','lastMeshPreparation'];
    return {documentState:api?.documentState?.()||null,
      builtinMonth:api?.builtinMonth?.()||null,
      map:Object.fromEntries(fields.map(k=>[k,stats[k]??null])),
      diagnostics:api?.diagnostics?.().slice(-12)||[],
      status:document.getElementById('viewerStatus')?.dataset.ready};
  }).catch(error=>({unavailable:String(error)}));
  console.error('P7_FAILED_MAP_STATE '+JSON.stringify({test:info.title,state}).slice(0,14000));
});

test('WebGL publishes an actual physical country frame before optional terrain detail resolves',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(/\/terrain\/[^/]+\/(?:tint|\d+\/\d+-\d+)\.webp/,async route=>{
    await gate;
    if(!page.isClosed())await route.continue();
  });
  try{
    await page.goto('/?renderer=webgl2&debug=1',{waitUntil:'domcontentloaded'});
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__?.rendererStats();
      return stats?.canonicalMeshReady===true&&stats?.projectRenderBlocked===false;
    }),{timeout:90000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return stats.countriesPublishedGeneration===stats.projectGeneration&&
        stats.firstBackgroundFrameMs!==null&&stats.firstCountryPublishedMs!==null;
    }),{timeout:30000}).toBe(true);
    const stats=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(stats.terrainReady).toBe(false);
    expect(stats.mapReadiness.terrainReady).toBe(false);
    expect(stats.webGlFirstBackgroundSceneDrawCalls?.total).toBeGreaterThan(0);
    expect(stats.webGlFirstCountrySceneDrawCalls?.total).toBeGreaterThan(0);
    expect(stats.webGlFirstCountrySceneDrawCalls.total).toBeGreaterThanOrEqual(
      stats.webGlFirstCountrySceneDrawCalls.direct);
    expect(stats.mapReadiness.status).not.toBe('ready');
    console.log('WEBGL_INITIAL_POSTING '+JSON.stringify({
      firstBackgroundMs:stats.firstBackgroundFrameMs,
      firstCountryMs:stats.firstCountryPublishedMs,
      firstBackgroundDrawCalls:stats.webGlFirstBackgroundSceneDrawCalls,
      firstCountryDrawCalls:stats.webGlFirstCountrySceneDrawCalls,
      baseSubmitMs:stats.webGlLastBaseSubmitMs,
      terrainReady:stats.mapReadiness.terrainReady,
    }));
    expect(errors).toEqual([]);
  }finally{release();}
});
