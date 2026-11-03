import {expect,test} from '@playwright/test';
import {createViewerProjectPackage} from '../fixtures/viewer-project-package.mjs';

// Worker-scoped launch settings belong at file scope. The Canvas cases still
// select the supported Canvas renderer explicitly through the page query.
test.use({trace:'off',actionTimeout:15000,launchOptions:{args:[
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
]}});

async function start(page,renderer){
  if(renderer==='canvas2d'){
    await page.addInitScript(()=>Object.defineProperty(window,'OffscreenCanvas',
      {configurable:true,value:undefined}));
  }
  await page.clock.setFixedTime(new Date(2026,9,24,12));
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const source=await(await route.fetch()).text();
    const boot='  const disposables=[',debug='productMode,documentState:',reader='()=>map.prepareBuiltinProject(month,{isCurrent,transition})';
    for(const anchor of [boot,debug,reader])expect(source.includes(anchor),`Missing observation boundary: ${anchor}`).toBe(true);
    await route.fulfill({contentType:'text/javascript',body:source
      .replace(boot,`  window.__temporalPackets=[];
  documentSession.commandOwner.subscribeTransitions((packet,operation)=>{
    if(['core.document-load','core.document-load-baseline','core.document-temporal-candidate-adopt'].includes(operation))
      window.__temporalPackets.push({operation,fullProject:Object.hasOwn(packet,'project'),
        geometryCount:packet.delta?.geometries?.length??null,month:packet.state?.timelineCursor});
  });
  const disposables=[`)
      .replace(debug,'cameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),'+debug)
      .replace(reader,'async()=>{if(window.__temporalRead)await window.__temporalRead(month);return map.prepareBuiltinProject(month,{isCurrent,transition});}')});
  });
  // This suite verifies document and frame admission. Full DEM streaming is
  // covered by the dedicated terrain scenarios.
  await page.goto('/?debug=1'+(renderer==='webgl'?'':'&renderer=canvas')
    +(renderer==='canvas-worker'?'&demTerrain=raster':''));
  await ready(page,'2026-10');
  if (renderer !== 'canvas-worker') await expect.poll(() => page.evaluate(() => {
    const state = window.__PANDOLAB_VIEWER__.rendererStats();
    return ['ready', 'limited'].includes(state.mapReadiness.status) && !state.canvasWorkerBusy;
  }), { timeout: 90000 }).toBe(true);
}
async function ready(page,month){
  await expect.poll(()=>page.evaluate(()=>({month:window.__PANDOLAB_VIEWER__?.builtinMonth().month,
    cursor:window.__PANDOLAB_VIEWER__?.documentState().timelineCursor,
    ready:document.querySelector('#viewerStatus')?.dataset.ready})),{timeout:90000}).toEqual({month,cursor:month,ready:'true'});
}
for(const renderer of ['webgl','canvas-worker','canvas2d'])for(const width of [1280,390])test.describe(`${renderer} ${width}px`,()=>{
  test.use({viewport:{width,height:844},hasTouch:width===390});
  test('dedicated temporal path presents dated frames without another whole-document load',async({page},testInfo)=>{
    test.setTimeout(210000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await start(page,renderer);
    const backend=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().renderer);
    if(renderer==='webgl')expect(backend).toMatch(/^webgl[12]$/);
    else expect(backend,'Canvas Worker and Canvas2D must not silently substitute').toBe(renderer);
    const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot());
    const identity=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId);
    const activate=async id=>{const control=page.locator('#'+id);if(width===390)await control.tap();else await control.click();};
    await activate('timelinePreviousYear');await ready(page,'2025-12');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    await activate('timelineNextYear');await ready(page,'2026-10');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    await expect(page.locator('#viewerInitialPreview')).toBeHidden();
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
    // A newer Core cursor is not sufficient proof of a painted frame.
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return !!(['ready','limited'].includes(stats.mapReadiness?.status)
        && !stats.projectRenderBlocked
        && stats.countriesPublishedGeneration===stats.projectGeneration
        && stats.canonicalMeshReady
        && stats.displayedGeometryRevision===stats.committedGeometryRevision
        && (stats.renderer!=='canvas-worker'||!stats.canvasWorkerBusy
          && stats.canvasDisplayedStyleRevision===stats.canvasStyleRevision));
    }),{timeout:45000,message:'Current dated frame must be presented by the selected renderer'}).toBe(true);
    const packets=await page.evaluate(()=>window.__temporalPackets);
    expect(packets.filter(row=>row.operation==='core.document-load-baseline')).toHaveLength(0);
    const adoptions=packets.filter(row=>row.operation==='core.document-temporal-candidate-adopt');
    expect(adoptions.filter(row=>row.fullProject)).toHaveLength(1);
    const transitions=adoptions.filter(row=>!row.fullProject);
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe(identity);
    expect(transitions.map(row=>row.month)).toEqual(['2025-12','2026-10']);
    expect(transitions.every(row=>row.fullProject===false&&Number.isInteger(row.geometryCount))).toBe(true);
    expect(errors).toEqual([]);
    await testInfo.attach('temporal-packets',{body:JSON.stringify({renderer,backend,width,packets,renderedVerified:true}),contentType:'application/json'});
  });
});

test('temporal failures and superseded source reads preserve the last displayed date',async({page})=>{
  test.setTimeout(150000);
  await start(page,'canvas-worker');
  const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot());
  await page.evaluate(()=>{window.__temporalRead=async()=>{throw Error('temporal source unavailable');};});
  await page.locator('#timelinePreviousYear').click();
  await expect(page.locator('#timelineDateError')).toHaveText('temporal source unavailable');
  await ready(page,'2026-10');await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.__temporalRead=month=>month==='2025-12'?new Promise(resolve=>{window.__releaseTemporal=resolve;}):Promise.resolve();});
  await page.locator('#timelinePreviousYear').click();
  await page.waitForFunction(()=>typeof window.__releaseTemporal==='function');
  try{await page.locator('#timelinePreviousYear').click();}
  finally{await page.evaluate(()=>window.__releaseTemporal());}
  await ready(page,'2024-12');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
  const transitions=await page.evaluate(()=>window.__temporalPackets.filter(row=>row.operation==='core.document-temporal-candidate-adopt'&&!row.fullProject));
  expect(transitions.map(row=>row.month)).toEqual(['2024-12']);
});


test('Canvas user-file opening retains full document admission after a builtin delta transition',async({page})=>{
  test.setTimeout(150000);
  await start(page,'canvas-worker');
  await page.locator('#timelinePreviousYear').click();await ready(page,'2025-12');
  const previous=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId);
  const fixture=await createViewerProjectPackage('시점 전환 후 사용자 파일');
  await page.locator('#projectFileInput').setInputFiles({name:'temporal-user-file.gpkg',
    mimeType:'application/geopackage+sqlite3',buffer:fixture.bytes});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset),
    {timeout:60000}).toBe(fixture.project.baseDataset);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const loaded=await page.evaluate(()=>({id:window.__PANDOLAB_VIEWER__.documentSnapshot().documentId,
    packet:window.__temporalPackets.at(-1)}));
  expect(loaded.id).not.toBe(previous);
  expect(loaded.packet.operation).toBe('core.document-load');
  expect(loaded.packet.fullProject).toBe(true);
});
