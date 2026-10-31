import {expect,test} from '@playwright/test';

// Worker-scoped launch settings belong at file scope. The Canvas cases still
// select the supported Canvas renderer explicitly through the page query.
test.use({trace:'off',actionTimeout:15000,launchOptions:{args:[
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',
]}});

async function start(page,renderer){
  await page.clock.setFixedTime(new Date(2026,9,24,12));
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const source=await(await route.fetch()).text();
    const boot='  await documentSession.commandOwner.load(',debug='productMode,documentState:',reader='()=>map.prepareBuiltinProject(month,{isCurrent})';
    for(const anchor of [boot,debug,reader])expect(source).toContain(anchor);
    await route.fulfill({contentType:'text/javascript',body:source
      .replace(boot,`  window.__temporalPackets=[];
  documentSession.commandOwner.subscribeTransitions((packet,operation)=>{
    if(operation==='core.document-load-baseline'||operation==='core.document-transition-baseline')
      window.__temporalPackets.push({operation,fullProject:Object.hasOwn(packet,'project'),
        geometryCount:packet.delta?.geometries?.length??null,month:packet.state?.timelineCursor});
  });
  await documentSession.commandOwner.load(`)
      .replace(debug,'cameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),'+debug)
      .replace(reader,'async()=>{if(window.__temporalRead)await window.__temporalRead(month);return map.prepareBuiltinProject(month,{isCurrent});}')});
  });
  await page.goto('/?debug=1'+(renderer==='canvas'?'&renderer=canvas':''));
  await ready(page,'2026-10');
}
async function ready(page,month){
  await expect.poll(()=>page.evaluate(()=>({month:window.__PANDOLAB_VIEWER__?.builtinMonth().month,
    cursor:window.__PANDOLAB_VIEWER__?.documentState().timelineCursor,
    ready:document.querySelector('#viewerStatus')?.dataset.ready})),{timeout:90000}).toEqual({month,cursor:month,ready:'true'});
}
for(const renderer of ['webgl','canvas'])for(const width of [1280,390])test.describe(`${renderer} ${width}px`,()=>{
  test.use({viewport:{width,height:844},hasTouch:width===390});
  test('dedicated temporal path presents dated frames without another whole-document load',async({page},testInfo)=>{
    test.setTimeout(150000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await start(page,renderer);
    const backend=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().renderer);
    expect(backend).toMatch(renderer==='webgl'?/^webgl[12]$/:/^canvas/);
    const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot());
    const activate=async id=>{const control=page.locator('#'+id);if(width===390)await control.tap();else await control.click();};
    await activate('timelinePreviousYear');await ready(page,'2025-12');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    await activate('timelineNextYear');await ready(page,'2026-10');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.cameraSnapshot())).toEqual(camera);
    const packets=await page.evaluate(()=>window.__temporalPackets);
    expect(packets.filter(row=>row.operation==='core.document-load-baseline')).toHaveLength(1);
    const transitions=packets.filter(row=>row.operation==='core.document-transition-baseline');
    expect(transitions.map(row=>row.month)).toEqual(['2025-12','2026-10']);
    expect(transitions.every(row=>row.fullProject===false&&Number.isInteger(row.geometryCount))).toBe(true);
    expect(errors).toEqual([]);
    await testInfo.attach('temporal-packets',{body:JSON.stringify({renderer,backend,width,packets}),contentType:'application/json'});
  });
});

test('temporal failures and superseded source reads preserve the last displayed date',async({page})=>{
  test.setTimeout(150000);
  await start(page,'canvas');
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
  const transitions=await page.evaluate(()=>window.__temporalPackets.filter(row=>row.operation==='core.document-transition-baseline'));
  expect(transitions.map(row=>row.month)).toEqual(['2024-12']);
});
