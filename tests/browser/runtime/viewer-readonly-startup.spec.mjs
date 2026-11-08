import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// A data-ready flag is not a render receipt. Require the current country and
// boundary frame before checking whether startup used generated geometry.
test('builtin cold and cached reload present prepared country geometry without triangulation',async({page},info)=>{
  test.setTimeout(180_000);
  const errors=[],samples=[],requests=[];
  page.on('request',request=>requests.push(request.url()));
  page.on('pageerror',error=>errors.push(error.message));
  for(const visit of ['cold','warm']){
    const start=Date.now(),requestStart=requests.length;
    if(visit==='cold')await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
    else await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>{
      const api=globalThis.__PANDOLAB_VIEWER__,stats=api?.rendererStats();
      return api?.initialMapPresented()===true&&stats.canonicalMeshReady===true
        &&stats.countriesPublishedGeneration===stats.projectGeneration
        &&stats.surfaceDraw?.countryIndexCount>0&&stats.mapReadiness?.mapReady===true
        &&document.querySelector('#viewerStatus')?.dataset.ready==='true';
    },null,{timeout:75_000});
    const row=await page.evaluate(()=>{
      const api=globalThis.__PANDOLAB_VIEWER__,stats=api.rendererStats();
      return {month:api.builtinMonth().month,entities:api.visibleTerritorialCount(),
        mesh:stats.lastMeshPreparation,renderer:stats.renderer,
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
  await writeFile(info.outputPath('readonly-startup.json'),JSON.stringify({samples,errors},null,2)+'\n');
  console.log('READONLY_STARTUP '+JSON.stringify({samples,errors}));
  expect(errors).toEqual([]);
  for(const row of samples){
    expect(row.entities).toBeGreaterThan(0);
    expect(row.wasmRequests,'workers reuse the verified compiled Core').toBeLessThanOrEqual(1);
    expect(row.countryDescriptorRequests,'runtime never reconstructs authoring documents').toBe(0);
    expect(row.metrics?.operations?.['core.worker-ready']?.count).toBeGreaterThan(0);
    expect(row.firstMeshUploadTiming?.submittedAtMs).toBeGreaterThan(row.firstMeshUploadTiming?.queuedAtMs);
    expect(row.firstCountryPresentedNavigationMs).toBeGreaterThan(0);
    expect(row.mesh,'startup must report which prepared source was used').not.toBeNull();
    expect(row.mesh.builtCount,'a cached gzip is not a prepared mesh').toBe(0);
    expect(row.mesh.preparedCount,'actual initial countries must consume offline mesh packets').toBeGreaterThan(0);
  }
});
