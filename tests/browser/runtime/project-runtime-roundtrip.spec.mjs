import {test,expect} from '@playwright/test';

test.use({
  viewport:{width:1280,height:800},
  launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']},
  trace:'retain-on-failure',
  screenshot:'only-on-failure',
});

const read=page=>page.evaluate(()=>{
  const app=globalThis.__PANDOLAB_VIEWER__;
  if(!app)return null;
  const document=app.documentSnapshot(),core=app.documentState(),render=app.rendererStats();
  return {
    documentId:document.documentId,sourceMode:document.projectSetup?.sourceMode,
    month:core.timelineCursor,epoch:core.epoch,selection:app.selectionSnapshot()?.items?.length||0,
    countries:app.visibleTerritorialCount(),generation:render.projectGeneration,
    publishedGeneration:render.countriesPublishedGeneration,
    ready:globalThis.document.getElementById('viewerStatus')?.dataset.ready,
    renderer:render.renderer,canonical:render.canonicalMeshReady,
    blocked:render.projectRenderBlocked,readiness:render.mapReadiness?.status,
    hydroFeatures:render.hydroFeaturesLoaded??null,
    countryIndices:render.surfaceDraw?.countryIndexCount??null,
  };
});
async function assertMapReady(page){
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120_000});
  await expect.poll(async()=>{
    const state=await read(page);
    return !!state&&state.ready==='true'&&state.countries>0
      &&state.publishedGeneration===state.generation
      &&state.canonical===true&&state.blocked===false
      &&['ready','limited'].includes(state.readiness);
  },{timeout:100_000,message:'accepted C++ country source must be painted on a current browser frame'}).toBe(true);
}
async function chooseYear(page,year){
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineYearInput').fill(String(year));
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor),
    {timeout:65_000}).toBe(year+'-12');
  await assertMapReady(page);
}
test('real Viewer keeps source cache, C++ time, country selection, GeoPackage switch and return in one session',async({page},info)=>{
  test.setTimeout(300_000);
  const errors=[],consoleErrors=[],observations=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')
    consoleErrors.push(message.text().slice(0,1500));});
  await page.goto('/?debug=1&renderer=webgl2&demTerrain=raster',{waitUntil:'domcontentloaded',timeout:40_000});
  try{await assertMapReady(page);}
  catch(error){
    const startup=await page.evaluate(()=>{
      const viewer=globalThis.__PANDOLAB_VIEWER__;
      return {status:document.getElementById('viewerStatus')?.outerHTML,
        message:document.getElementById('viewerStatus')?.textContent,
        bootstrap:document.getElementById('bootstrapLoading')?.textContent,
        diagnostic:viewer?.diagnostics?.()?.slice(-30)||[],
        core:viewer?.documentState?.()||null,
        render:viewer?.rendererStats?.()||null,
      };
    }).catch(reason=>({captureError:String(reason)}));
    console.log('PROJECT_RUNTIME_STARTUP_FAILURE '+JSON.stringify({
      startup,errors,consoleErrors:consoleErrors.slice(-30)}));
    throw error;
  }
  const initial=await read(page);
  observations.push({stage:'default',...initial});
  expect(initial.countries).toBeGreaterThan(0);
  expect(initial.countryIndices).toBeGreaterThan(0);
  // Real object-search controller and C++ selection, not a synthetic selection.
  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchInput')).toBeEnabled();
  await page.locator('#objectSearchInput').fill('프랑스');
  const first=page.locator('#objectSearchResults [data-object-search-select]').first();
  await expect(first).toBeVisible({timeout:25_000});
  await first.click();
  await expect.poll(async()=>(await read(page)).selection,{timeout:20_000}).toBeGreaterThan(0);
  await chooseYear(page,2024);
  const dated=await read(page);
  observations.push({stage:'dated-default',...dated});
  expect(dated.documentId).toBe(initial.documentId);
  expect(dated.generation).toBe(initial.generation);
  // Exercise the real GeoPackage worker reader with a canonical C++ snapshot.
  // The project-state table is the authoritative GPKG document container.
  await page.addScriptTag({url:'/assets/js/vendor/sql/sql-wasm.js'});
  const opened=await page.evaluate(async()=>{
    const viewer=window.__PANDOLAB_VIEWER__;
    const source=structuredClone(viewer.documentSnapshot());
    source.documentId=crypto.randomUUID();
    source.projectSetup={...source.projectSetup,sourceMode:'empty'};
    const SQL=await window.initSqlJs({locateFile:file=>'/assets/js/vendor/sql/'+file});
    const db=new SQL.Database();
    db.run('CREATE TABLE pandolab_project_settings (setting_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)');
    db.run('INSERT INTO pandolab_project_settings (setting_key, json_value) VALUES (?, ?)',
      ['project_state',JSON.stringify(source)]);
    const bytes=db.export();
    db.close();
    const file=new File([bytes],'runtime-roundtrip.gpkg',{type:'application/geopackage+sqlite3'});
    return {accepted:await viewer.openFile(file),documentId:source.documentId,bytes:bytes.length};
  });
  expect(opened.accepted).toBe(true);
  await assertMapReady(page);
  const imported=await read(page);
  observations.push({stage:'imported',...imported});
  expect(imported.documentId).toBe(opened.documentId);
  expect(imported.documentId).not.toBe(dated.documentId);
  expect(imported.generation).toBeGreaterThan(dated.generation);
  expect(imported.selection).toBe(0);
  expect(imported.sourceMode).toBe('empty');
  await chooseYear(page,2023);
  const importedDated=await read(page);
  observations.push({stage:'imported-date',...importedDated});
  expect(importedDated.documentId).toBe(opened.documentId);
  expect(importedDated.generation).toBe(imported.generation);
  // UI action opens the manifest-backed default-world as a fresh C++ document.
  await page.evaluate(()=>document.getElementById('builtinMapBtn').click());
  await expect.poll(async()=>(await read(page))?.documentId,{timeout:120_000})
    .not.toBe(opened.documentId);
  await assertMapReady(page);
  const returned=await read(page);
  observations.push({stage:'returned-default',...returned});
  expect(returned.sourceMode).toBe('builtin');
  expect(returned.generation).toBeGreaterThan(importedDated.generation);
  expect(returned.countries).toBeGreaterThan(0);
  expect(returned.selection).toBe(0);
  expect(errors).toEqual([]);
  console.log('PROJECT_RUNTIME_BROWSER '+JSON.stringify({observations,opened,errors}));
  await info.attach('project-runtime-observations.json',{
    body:Buffer.from(JSON.stringify({observations,opened,errors},null,2)),contentType:'application/json'});
  await info.attach('project-runtime-return.png',{
    body:await page.screenshot({animations:'disabled'}),contentType:'image/png'});
});
