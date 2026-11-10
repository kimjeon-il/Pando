import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// A data-ready flag is not a render receipt. Require the current country and
// boundary frame before checking whether startup used generated geometry.
test('cold and cached startup publish prepared countries and borders without reconstruction',async({page},info)=>{
  test.setTimeout(210_000);
  const errors=[],consoleErrors=[],samples=[],requests=[];
  page.on('request',request=>requests.push(request.url()));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  const ready=()=>page.waitForFunction(()=>{
    const api=globalThis.__PANDOLAB_VIEWER__,stats=api?.rendererStats();
    return api?.initialMapPresented()===true&&stats.canonicalMeshReady===true
      &&stats.projectGeneration>0&&stats.countriesPublishedGeneration===stats.projectGeneration
      &&stats.surfaceDraw?.countryIndexCount>0&&stats.mapReadiness?.mapReady===true
      &&stats.countrySharedBoundaryReady===true&&!stats.projectRenderBlocked
      &&document.querySelector('#viewerStatus')?.dataset.ready==='true';
  },null,{timeout:90_000});
  try {
    for(const visit of ['cold','warm']){
      const start=Date.now(),requestStart=requests.length;
      if(visit==='cold')await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
      else await page.reload({waitUntil:'domcontentloaded'});
      await ready();
      const row=await page.evaluate(()=>{
        const api=globalThis.__PANDOLAB_VIEWER__,stats=api.rendererStats();
        return {month:api.builtinMonth().month,entities:api.visibleTerritorialCount(),
          mesh:stats.lastMeshPreparation,renderer:stats.renderer,
          cursor:api.documentState().timelineCursor,rebuilds:stats.countryMeshRebuildCount||0,
          preparedHits:stats.preparedCountrySceneHits||0,boundaryHits:stats.countryBoundaryPreparedAssetCount||0,
          boundaryWorker:stats.countrySharedBoundaryWorkerActive,
          countryIndexCount:stats.surfaceDraw?.countryIndexCount,
          firstCountryPublishedMs:stats.firstCountryPublishedMs,
          firstCountryPresentedNavigationMs:stats.firstCountryPresentedNavigationMs,
          gpuUpload:stats.gpuUpload,firstMeshUploadTiming:stats.firstMeshUploadTiming,
          metrics:globalThis.__PANDOLAB_PERFORMANCE_REPORT__?.()||null};
      });
      const network=requests.slice(requestStart).map(url=>new URL(url).pathname);
      samples.push({visit,elapsedMs:Date.now()-start,...row,
        wasmRequests:network.filter(path=>path.endsWith('/pandoeditor-core.wasm')).length,
        countryDescriptorRequests:network.filter(path=>/builtin-world\/generated\/v1\/(countries|country-parts)\//.test(path)).length});
    }
    expect(errors).toEqual([]);
    for(const row of samples){
      expect(row.entities).toBeGreaterThan(0);
      expect(row.mesh.source).toBe('prepared-country-scene');
      expect(row.mesh.reusedCount).toBeGreaterThan(0);
      expect(row.mesh.triangulationMs).toBe(0);expect(row.mesh.strokeMs).toBe(0);expect(row.mesh.spatialMs).toBe(0);
      expect(row.rebuilds).toBe(0);expect(row.boundaryWorker).toBe(false);
      expect(row.preparedHits).toBeGreaterThan(0);expect(row.boundaryHits).toBeGreaterThan(0);
      expect(row.month).toMatch(/^-?\d{4,}-\d{2}$/);expect(row.month).toBe(row.cursor);
      expect(row.wasmRequests,'workers reuse the verified compiled Core').toBeLessThanOrEqual(1);
      expect(row.countryDescriptorRequests,'runtime never reconstructs authoring documents').toBe(0);
      expect(row.metrics?.operations?.['core.worker-ready']?.count).toBeGreaterThan(0);
      expect(row.firstMeshUploadTiming?.submittedAtMs).toBeGreaterThan(row.firstMeshUploadTiming?.queuedAtMs);
      expect(row.firstCountryPresentedNavigationMs).toBeGreaterThan(0);
      expect(row.mesh,'startup must report which prepared source was used').not.toBeNull();
      expect(row.mesh.builtCount,'a cached gzip is not a prepared mesh').toBe(0);
      expect(row.mesh.preparedCount,'actual initial countries must consume offline mesh packets').toBeGreaterThan(0);
    }
    const read=()=>page.evaluate(()=>({month:globalThis.__PANDOLAB_VIEWER__.builtinMonth().month,cursor:globalThis.__PANDOLAB_VIEWER__.documentState().timelineCursor}));
    const original=(await read()).month;
    await page.locator('#timelinePreviousYear').click();await ready();
    const previous=await read();expect(previous.month).not.toBe(original);expect(previous.cursor).toBe(previous.month);
    await page.locator('#timelineNextYear').click();await ready();expect((await read()).month).toBe(original);
    expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('prepared-initial-scene.png')});
  } finally {
    const last=await page.evaluate(()=>({stats:globalThis.__PANDOLAB_VIEWER__?.rendererStats(),month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth(),cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor})).catch(()=>null);
    const result={samples,errors,consoleErrors,requests,last};
    await writeFile(info.outputPath('readonly-startup.json'),JSON.stringify(result,null,2)+'\n');
    console.log('READONLY_STARTUP '+JSON.stringify({samples:samples.map(({visit,elapsedMs,month,entities,wasmRequests,countryDescriptorRequests,mesh})=>({visit,elapsedMs,month,entities,wasmRequests,countryDescriptorRequests,mesh})),errors,consoleErrors,requestCount:requests.length}));
  }
});
