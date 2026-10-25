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
    await expect.poll(async()=>(await stats()).surfacePresentation.quality).toBe('pending');
    expect((await stats()).surfaceDraw?.countryIndexCount || 0).toBe(0);
    expect((await stats()).terrainRenderedLevel).toBe(-1);
    release();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect.poll(async()=>(await stats()).countriesPublishedGeneration).toBe((await stats()).projectGeneration);
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
    expect(warm.lastMeshPreparation.reusedCount).toBe(warm.lastMeshPreparation.featureCount);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({cold:cold.lastMeshPreparation,warm:warm.lastMeshPreparation,background:cold.firstBackgroundFrameMs,countries:cold.firstCountryPublishedMs,uploads:beforeUploads}));
  } finally { release(); }
});
