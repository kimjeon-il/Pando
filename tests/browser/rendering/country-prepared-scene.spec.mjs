import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// This is a real pinned world, not a status-only mock. Do not fake performance.now.
test('prepared initial scene publishes country triangles and borders on cold and cached loads',async({page},info)=>{
  test.setTimeout(210_000);
  const errors=[],observations=[],consoleErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',e=>errors.push(String(e)));
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  const read=()=>page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__,s=api?.rendererStats();
    return {ready:document.getElementById('viewerStatus')?.dataset.ready,
      presented:api?.initialMapPresented(),visible:api?.visibleTerritorialCount(),
      month:api?.builtinMonth().month,cursor:api?.documentState().timelineCursor,
      renderer:s?.renderer,canonical:s?.canonicalMeshReady,blocked:s?.projectRenderBlocked,
      generation:s?.projectGeneration,published:s?.countriesPublishedGeneration,
      countryTriangles:s?.surfaceDraw?.countryIndexCount,boundaries:s?.countrySharedBoundaryReady,
      preparation:s?.lastMeshPreparation,rebuilds:s?.countryMeshRebuildCount||0,
      preparedHits:s?.preparedCountrySceneHits||0,boundaryHits:s?.countryBoundaryPreparedAssetCount||0,
      boundaryWorker:s?.countrySharedBoundaryWorkerActive,diagnostics:api?.diagnostics?.(),statusText:document.getElementById('viewerStatus')?.textContent};
  });
  const ready=()=>expect.poll(async()=>{
    const s=await read();return s.ready==='true'&&s.presented&&s.canonical&&s.boundaries
      &&s.generation>0&&s.published===s.generation&&s.countryTriangles>0&&!s.blocked;
  },{timeout:90_000,message:'Current country triangles and shared borders must actually publish'}).toBe(true);
  try {
    for(const mode of ['cold','cached-reload']){
      const started=Date.now();
      if(mode==='cold')await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
      else await page.reload({waitUntil:'domcontentloaded'});
      await ready();const state=await read();observations.push({mode,elapsedMs:Date.now()-started,...state});
      expect(state.preparation.source).toBe('prepared-country-scene');
      expect(state.preparation.builtCount).toBe(0);
      expect(state.preparation.reusedCount).toBeGreaterThan(0);
      expect(state.preparation.triangulationMs).toBe(0);
      expect(state.preparation.strokeMs).toBe(0);expect(state.preparation.spatialMs).toBe(0);
      expect(state.rebuilds).toBe(0);expect(state.boundaryWorker).toBe(false);
      expect(state.preparedHits).toBeGreaterThan(0);expect(state.boundaryHits).toBeGreaterThan(0);
      expect(state.month).toBe(state.cursor);expect(state.visible).toBeGreaterThan(0);
    }
    const original=(await read()).month;
    await page.locator('#timelinePreviousYear').click();await ready();
    const previous=await read();expect(previous.month).not.toBe(original);expect(previous.cursor).toBe(previous.month);
    await page.locator('#timelineNextYear').click();await ready();
    expect((await read()).month).toBe(original);
    observations.push({mode:'date-return',...await read()});
    expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('prepared-initial-scene.png')});
  } finally {
    const state=await read().catch(()=>null);
    await writeFile(info.outputPath('prepared-scene.json'),JSON.stringify({observations,errors,consoleErrors,last:state},null,2));
    console.log('PREPARED_SCENE_BROWSER '+JSON.stringify({observations,errors,consoleErrors,last:state}));
  }
});
