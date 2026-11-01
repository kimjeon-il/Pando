import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off'});
test('P4-5 real viewer WebGL boundary Worker presents prepared shared borders',async({page})=>{
  test.setTimeout(130000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error'&&message.text().includes('PL-COUNTRY-BOUNDARY'))
      errors.push(message.text());
  });
  await page.goto('/?renderer=webgl2&demTerrain=raster&debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:105000});
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats()||{});
  try {
    await expect.poll(async()=>(await stats()).countrySharedBoundarySegmentCount||0,
      {timeout:20000}).toBeGreaterThan(100);
  } catch(error){
    console.log('P4_5_VIEWER_BOUNDARY_DIAG',JSON.stringify(await page.evaluate(()=>{
      const r=window.__PANDOLAB_VIEWER__?.rendererStats()||{};
      return {renderer:r.renderer,quality:r.activeMeshQuality,ready:r.mapReadiness,
        boundaryReady:r.countrySharedBoundaryReady,boundaryCount:r.countrySharedBoundarySegmentCount,
        worker:r.countrySharedBoundaryWorkerActive,lastWorkerMessage:r.countrySharedBoundaryLastMessage,
        pending:r.countrySharedBoundaryReplacementPending,boundaryRequests:r.countrySharedBoundaryRequestId,
        generation:r.projectGeneration,countries:r.countriesPublishedGeneration,
        contextLost:r.webglContextLost};
    })),errors);
    throw error;
  }
  const first=await stats();
  expect(first.renderer).toMatch(/webgl/);
  expect(first.countrySharedBoundaryReady).toBe(true);
  expect(first.countrySharedBoundaryWorkerActive).toBe(true);
  expect(first.countrySharedBoundaryReplacementPending).toBe(false);
  const baseline=first.countrySharedBoundarySegmentCount;
  await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__?.requestRepaint?.('p4-5-boundary-repaint'));
  await expect.poll(async()=>(await stats()).countrySharedBoundarySegmentCount,{timeout:15000})
    .toBe(baseline);
  expect(errors).toEqual([]);
});
