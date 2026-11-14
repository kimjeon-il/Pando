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


test('map hover/click and visible layers share a camera after date changes',async({page})=>{
  const errors=[];
  page.on('console',message=>{
    if(message.type()==='error' && /PL-MAP-(HOVER|CLICK)-001/.test(message.text()))errors.push(message.text());
  });
  await page.setViewportSize({width:1280,height:800});
  await open(page);
  await month(page,'2024-12');
  await search(page);
  const point=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.project([127.8,36.6]));
  const bounds=await page.locator('#map').boundingBox();
  expect(point).toHaveLength(2);
  expect(point[0]).toBeGreaterThan(0);
  expect(point[0]).toBeLessThan(bounds.width);
  expect(point[1]).toBeGreaterThan(0);
  expect(point[1]).toBeLessThan(bounds.height);
  await page.mouse.move(bounds.x+point[0],bounds.y+point[1]);
  await page.waitForTimeout(180);
  await page.mouse.click(bounds.x+point[0],bounds.y+point[1]);
  await page.waitForTimeout(180);
  expect(errors).toEqual([]);
  const sameFrame=()=>page.evaluate(()=>{
    const selectors=['.map-base-svg','.gpu-map-canvas','.map-overlay-svg',
      '.map-interaction-svg','.territorial-label-layer','.labels-layer'];
    const nodes=selectors.map(selector=>document.querySelector(selector));
    const ids=nodes.map(node=>node?.dataset.visualFrameId);
    return ids.every(id=>!!id&&id===ids[0])
      && nodes.every(node=>node?.dataset.viewRevision===nodes[0]?.dataset.viewRevision);
  });
  await expect.poll(sameFrame).toBe(true);
  await month(page,'2025-12');
  await expect.poll(sameFrame).toBe(true);
  expect(errors).toEqual([]);
});

test('globe shader and SVG projection remain aligned near horizon, poles and at 32x',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await open(page);
  const samples=[
    [0,0],[45,0],[-45,0],[89.95,0],[-89.95,0],
    [0,89.95],[0,-89.95],[179.95,0],[-179.95,0],
    [127.8,36.6],[20,78],[-120,-77],
  ];
  async function assertParity(zoom,rotation){
    await page.evaluate(({zoom,rotation})=>{
      const host=window.__PANDOLAB_MAP_HOST__,current=host.getViewState();
      host.setViewState({projection:'globe',view:{
        globeZoom:zoom,flatZoom:current.flatZoom,
        globeRotation:rotation,flatCenter:current.flatCenter,
      }});
    },{zoom,rotation});
    await expect.poll(()=>page.evaluate(()=>{
      const canvas=document.querySelector('.gpu-map-canvas');
      return canvas?.dataset.viewRevision===String(window.__PANDOLAB_VIEW_REVISION__)
        && canvas?.dataset.visualFrameId===document.querySelector('.map-base-svg')?.dataset.visualFrameId;
    }),{timeout:90_000}).toBe(true);
    const result=await page.evaluate(coordinates=>
      window.__PANDOLAB_MAP_HOST__.getDebugState({projectionSamples:coordinates}).projectionParity,samples);
    expect(result.visibleSampleCount).toBeGreaterThan(0);
    expect(result.maxSvgVsD3Px).toBeLessThan(0.5);
    expect(result.maxGpuVsSvgPx).toBeLessThan(0.5);
    expect(result.maxGpuVsD3Px).toBeLessThan(0.5);
  }
  await assertParity(1,[0,0,0]);
  await assertParity(32,[-179,-45,0]);
  await page.setViewportSize({width:1024,height:768});
  await assertParity(32,[-90,-80,0]);
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
