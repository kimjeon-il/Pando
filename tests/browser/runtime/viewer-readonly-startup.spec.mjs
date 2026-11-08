import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// A data-ready flag is not a render receipt. Require the current country and
// boundary frame before checking whether startup used generated geometry.
test('builtin cold and cached reload present prepared country geometry without triangulation',async({page},info)=>{
  test.setTimeout(180_000);
  const errors=[],samples=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const visit of ['cold','warm']){
    const start=Date.now();
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
        metrics:globalThis.__PANDOLAB_PERFORMANCE_REPORT__?.()||null};
    });
    samples.push({visit,elapsedMs:Date.now()-start,...row});
  }
  await writeFile(info.outputPath('readonly-startup.json'),JSON.stringify({samples,errors},null,2)+'\n');
  console.log('READONLY_STARTUP '+JSON.stringify({samples,errors}));
  expect(errors).toEqual([]);
  for(const row of samples){
    expect(row.entities).toBeGreaterThan(0);
    expect(row.mesh,'startup must report which prepared source was used').not.toBeNull();
    expect(row.mesh.builtCount,'a cached gzip is not a prepared mesh').toBe(0);
    expect(row.mesh.preparedCount,'actual initial countries must consume offline mesh packets').toBeGreaterThan(0);
  }
});
