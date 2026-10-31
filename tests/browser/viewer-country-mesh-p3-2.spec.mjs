import {test,expect} from '@playwright/test';

for(const mode of ['webgl','canvas']){
 test('P3-2 identical cloned polygons retain canonical country mesh: '+mode,async({page},testInfo)=>{
  test.setTimeout(155000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  if(mode==='canvas')await page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      return String(type).includes('webgl')?null:get.call(this,type,...args);
    };
  });
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const anchor="if (Number(taskProjectGeneration) !== projectGeneration) return Promise.resolve(false);";
    if(source.split(anchor).length!==2)throw Error('P3-2 canonical mesh request anchor moved');
    const clone="features = features.map(feature=>({...feature,geometry:feature.geometry?structuredClone(feature.geometry):null}));";
    await route.fulfill({response,body:source.replace(anchor,anchor+'\n      '+clone)});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount())).toBeGreaterThan(0);
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
  const before=await stats();
  if(mode==='webgl')expect(before.renderer).toMatch(/webgl/);
  const beforeMonth=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month);
  expect(beforeMonth).toBe('2026-10');
  // Follow-now always requests the same canonical document month again, but
  // route-cloning guarantees brand-new geometry objects at the mesh boundary.
  if(await page.locator('#mobileFileBtn').isVisible())await page.locator('#mobileFileBtn').click();
  else {await page.locator('#mobileMenuBtn').click();await page.locator('#mobileMenuFileBtn').click();}
  await page.locator('#builtinMapBtn').click();
  await expect.poll(async()=> (await stats()).projectGeneration,{timeout:80000}).toBeGreaterThan(before.projectGeneration);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:80000});
  await expect.poll(async()=> (await stats()).countriesPublishedGeneration,{timeout:25000}).toBe((await stats()).projectGeneration);
  const after=await stats();
  if(mode==='webgl'){
    expect(after.countryMeshRebuildCount||0).toBe(before.countryMeshRebuildCount||0);
    expect(after.countryMeshReuseCount||0).toBeGreaterThan(before.countryMeshReuseCount||0);
    expect(after.surfacePresentation.quality).toBe('canonical');
  }
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2026-10');
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
  const result={mode,from:{generation:before.projectGeneration,rebuilds:before.countryMeshRebuildCount||0,reuses:before.countryMeshReuseCount||0},
    to:{generation:after.projectGeneration,rebuilds:after.countryMeshRebuildCount||0,reuses:after.countryMeshReuseCount||0},renderer:after.renderer};
  console.log('P3_2_COUNTRY_MESH '+JSON.stringify(result));
  await page.screenshot({path:testInfo.outputPath('identical-geometry-'+mode+'.png')});
  expect(errors).toEqual([]);
 });
}


test('P3-2 shared GPU renderer starts in editor without changing its document',async({page})=>{
  test.setTimeout(130000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const {gotoEditor}=await import('./helpers/editor-entry.mjs');
  await gotoEditor(page,'/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:110000});
  await expect(page.locator('#map')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__?.renderer||null),
    {timeout:60000}).toMatch(/webgl|canvas/);
  const editor=await page.evaluate(()=>({
    readiness:document.querySelector('#app').dataset.readiness,
    renderer:window.__PANDOLAB_GPU_METRICS__?.renderer,
    month:window.__testEditorTimeline?.month(),
    geometryCount:window.__testEditorTimeline?.project()?.geometries?.length,
  }));
  expect(editor.readiness).toBe('enhanced');
  expect(errors).toEqual([]);
  console.log('P3_2_EDITOR_SMOKE '+JSON.stringify(editor));
});
