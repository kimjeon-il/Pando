import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

async function ready(page){
  await expect.poll(()=>page.evaluate(()=>{
    const v=window.__PANDOLAB_VIEWER__,s=v?.rendererStats();
    return Boolean(v?.initialMapPresented()&&s?.mapReadiness?.mapReady
      &&!s.projectRenderBlocked&&s.displayedRevision>0
      &&document.querySelector('#viewerStatus')?.dataset.ready==='true');
  }),{timeout:90_000}).toBe(true);
}
async function open(page,query=''){
  page.on('pageerror',error=>console.error('Viewer page error:',error));
  page.on('console',message=>{if(message.type()==='error')console.error('Viewer error:',message.text());});
  await page.goto('./?debug=1'+query,{waitUntil:'domcontentloaded'});
  await ready(page);
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.visibleTerritorialCount())).toBeGreaterThan(0);
}
const camera=page=>page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState());
async function month(page,value){
  const [year,month]=value.split('-');
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill(year);
  await page.locator('#timelineMonthInput').selectOption(String(Number(month)));
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor),{timeout:60_000}).toBe(value);
  await ready(page);
}
async function search(page,touch=false){
  await page.locator('#objectSearchBtn')[touch?'tap':'click']();
  await page.getByLabel('지도에서 찾기',{exact:true}).fill('대한민국');
  await page.locator('#objectSearchResults button').filter({hasText:'대한민국'}).first()[touch?'tap':'click']();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot().items.map(x=>x.id))).toContain('KOR');
  await ready(page);
}

test('desktop Viewer presents the real map, changes year, searches and moves the camera',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await open(page);
  await month(page,'2024-12');
  await search(page);
  const before=await camera(page);
  await page.mouse.move(600,420);await page.mouse.down();
  await page.mouse.move(740,450,{steps:8});await page.mouse.up();
  await expect.poll(()=>camera(page)).not.toEqual(before);
  await ready(page);
});

test('touch Viewer searches, navigates and changes time in a mobile context',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();
    await open(page);
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().effectivePixelRatio)).toBe(0.75);
    await search(page,true);
    const before=await camera(page),cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:400}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:260,y:430}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
    await expect.poll(()=>camera(page)).not.toEqual(before);
    await month(page,'2025-12');
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.selectionSnapshot().items.map(x=>x.id))).toContain('KOR');
  }finally{await context.close();}
});

test('fixed GeoPackage opens in the read-only inspector and exports diagnostics without changing its project',async({page})=>{
  await open(page,'&inspect=1');
  await page.locator('#projectFileInput').setInputFiles(fileURLToPath(new URL('../fixtures/timeline-exchange/complex.gpkg',import.meta.url)));
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe('ac86aaa8-4f4a-5a94-bb06-912bf7851f74');
  const before=await page.evaluate(()=>({project:window.__PANDOLAB_VIEWER__.documentSnapshot(),state:window.__PANDOLAB_VIEWER__.documentState()}));
  expect(before.project.territorialEntities.map(x=>x.id)).toEqual(['A','B','C','R']);
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.readOnly)).toBe(true);
  await page.locator('#reviewTabPerformance').click();
  await page.locator('#reviewTabErrors').click();
  const pending=page.waitForEvent('download');
  await page.locator('#reviewExportDiagnostics').click();
  const download=await pending;
  expect(download.suggestedFilename()).toMatch(/^pando-viewer-inspection-.*\.json$/);
  const diagnostics=JSON.parse(await readFile(await download.path(),'utf8'));
  expect(diagnostics.schema).toBe('pando-viewer-inspection-v1');
  expect(diagnostics.data.projectId).toBe(before.project.documentId);
  expect(diagnostics.data.readOnly).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');await page.keyboard.press('Control+z');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before.project);
  const after=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState());
  expect({revision:after.revision,checkpoint:after.checkpoint,dirty:after.dirty,canUndo:after.canUndo})
    .toEqual({revision:before.state.revision,checkpoint:before.state.checkpoint,dirty:before.state.dirty,canUndo:before.state.canUndo});
});

test('WebGL2 unsupported ends loading with a visible support requirement',async({page})=>{
  await page.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      return kind==='webgl2'?null:getContext.call(this,kind,...args);
    };
  });
  await page.goto('./?debug=1',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats().renderer)).toBe('failed');
  await expect(page.locator('#viewerStatus')).toContainText(/WebGL2/);
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status)).toBe('error');
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
});

test('real WebGL context loss and restoration preserve displayed state and recover a ready frame',async({page})=>{
  await open(page);
  await month(page,'2024-12');
  await search(page);
  const before=await page.evaluate(()=>({project:window.__PANDOLAB_VIEWER__.documentSnapshot(),
    state:window.__PANDOLAB_VIEWER__.documentState(),selection:window.__PANDOLAB_VIEWER__.selectionSnapshot(),
    camera:window.__PANDOLAB_MAP_HOST__.getViewState()}));
  await page.evaluate(()=>{
    const gl=document.querySelector('.gpu-map-canvas').getContext('webgl2');
    const extension=gl?.getExtension('WEBGL_lose_context');
    if(!extension)throw Error('Real WebGL context loss unavailable');
    window.__contextLoss=extension;extension.loseContext();
  });
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().webglContextLost)).toBe(true);
  await page.evaluate(()=>window.__contextLoss.restoreContext());
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().webglContextLost)).toBe(false);
  await ready(page);
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().renderer)).toBe('webgl2');
  expect(await page.evaluate(()=>({project:window.__PANDOLAB_VIEWER__.documentSnapshot(),
    state:window.__PANDOLAB_VIEWER__.documentState(),selection:window.__PANDOLAB_VIEWER__.selectionSnapshot(),
    camera:window.__PANDOLAB_MAP_HOST__.getViewState()}))).toEqual(before);
  await page.evaluate(()=>window.__contextLoss.loseContext());
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().renderer),{timeout:15000}).toBe('failed');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status)).toBe('error');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before.project);
});

