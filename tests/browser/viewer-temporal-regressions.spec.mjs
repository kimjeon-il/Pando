import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Canonical dated document/frame admission", () => {
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
    const returned=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(returned.mapReadiness.mapReady).toBe(true);
    expect(returned.countriesPublishedGeneration).toBe(returned.projectGeneration);
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
  try {
    // Core admits the file before Canvas can paint its new generation. Require
    // the actual new-country bitmap, rather than the old 8s status-only gate.
    await expect.poll(()=>page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return s.countriesPublishedGeneration===s.projectGeneration&&s.mapReadiness.mapReady;
    }),{timeout:60000}).toBe(true);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:15000});
  } catch(error) {
    const diagnostic=await page.evaluate(()=>{
      const api=window.__PANDOLAB_VIEWER__,s=api?.rendererStats?.()||{},m=window.__PANDOLAB_GPU_METRICS__||{};
      const keys=['renderer','mapReadiness','projectGeneration','countriesPublishedGeneration',
        'canonicalMeshReady','projectRenderBlocked','surfacePresentation','terrainReady','terrainFailed',
        'canvasWorkerBusy','canvasWorkerHasPendingFrame','canvasWorkerStaleFrameCount',
        'canvasStyleRevision','canvasDisplayedStyleRevision','canvasWorkerMessagesByType',
        'requestedRevision','displayedRevision','pendingCountryCount','committedGeometryRevision',
        'displayedGeometryRevision','firstBackgroundFrameMs','firstCountryPublishedMs',
        'gpuRecovery','mapHost'];
      return {status:document.querySelector('#viewerStatus')?.dataset.ready,
        map:Object.fromEntries(keys.map(key=>[key,s[key]??m[key]??null])),
        document:api?.documentState?.(),
        diagnostics:api?.diagnostics?.()?.slice(-10)};
    });
    console.error('CANVAS_DATE_GPKG_FRAME_DIAGNOSTIC '+JSON.stringify(diagnostic).slice(0,15000));
    throw error;
  }
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.mapReady)).toBe(true);
  const loaded=await page.evaluate(()=>({id:window.__PANDOLAB_VIEWER__.documentSnapshot().documentId,
    packet:window.__temporalPackets.at(-1)}));
  expect(loaded.id).not.toBe(previous);
  expect(loaded.packet.operation).toBe('core.document-load');
  expect(loaded.packet.fullProject).toBe(true);
});
});


test.describe("Unchanged resource reuse on date switch", () => {
test.use({viewport:{width:1280,height:800},trace:'off'});

test('P2-4 one accepted year switch loads physical resources once and preserves map/search state',async({page})=>{
  test.setTimeout(145000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.addInitScript(()=>{
    window.__P24_COUNTS__={land:0,physical:0,updates:0};
  });
  await page.route('**/modules/viewer-map.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const publicPorts='loadPhysicalResources:physicalResources.loadPhysicalData,loadPhysicalLandMask:physicalResources.loadPhysicalLandMask,';
    const update='async function update() {';
    if(source.split(publicPorts).length!==2||source.split(update).length!==2)
      throw Error('P2-4 viewer-map instrumentation port changed.');
    await route.fulfill({response,body:source.replace(update,
      update+'\n    window.__P24_COUNTS__.updates++;').replace(publicPorts,
      "loadPhysicalResources:(...args)=>{window.__P24_COUNTS__.physical++;return physicalResources.loadPhysicalData(...args);},"+
      "loadPhysicalLandMask:(...args)=>{window.__P24_COUNTS__.land++;return physicalResources.loadPhysicalLandMask(...args);},")});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount())).toBeGreaterThan(0);
  const initial=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  const expected={land:1,physical:1,updates:2};
  for(const month of ['2025-12','2026-10']){
    await page.evaluate(()=>{window.__P24_COUNTS__={land:0,physical:0,updates:0};});
    const button=month==='2025-12'?'#timelinePreviousYear':'#timelineNextYear';
    await page.locator(button).click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),
      {timeout:80000}).toBe(month);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
    // The post-presentation handler has had a chance to run. Do not sleep.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const counts=await page.evaluate(()=>({...window.__P24_COUNTS__}));
    console.log('P2_4_TRANSITION_COUNTS '+JSON.stringify({month,...counts}));
    expect(counts,{message:'A completed map already fetched physical land and resources in setSession'}).toEqual(expected);
    const cursor=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor);
    expect(cursor).toBe(month);
  }
  const restored=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot());
  expect(restored.territorialEntities.map(x=>x.id).sort()).toEqual(initial.territorialEntities.map(x=>x.id).sort());
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('대한민국');
  await expect(page.locator('#objectSearchResults button').first()).toBeVisible({timeout:20000});
  expect(errors).toEqual([]);
});
});
