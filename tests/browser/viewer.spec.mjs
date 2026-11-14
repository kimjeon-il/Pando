import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
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


// One-shot actual WebGL2 Viewer verification: this case is run only by the
// scoped GIS profiling workflow, not by the permanent Viewer smoke suite.
async function observedFrameGaps(page,durationMs=2600){
  return page.evaluate(duration=>new Promise(resolve=>{
    let first=null,previous=null;const gaps=[];
    const run=t=>{
      if(first===null)first=t;
      if(previous!==null)gaps.push(t-previous);
      previous=t;
      if(t-first<duration)return requestAnimationFrame(run);
      gaps.sort((a,b)=>a-b);
      const pct=p=>gaps.length?Math.round(gaps[Math.floor((gaps.length-1)*p)]*100)/100:null;
      resolve({count:gaps.length,p50:pct(.50),p95:pct(.95),p99:pct(.99),
        max:gaps.length?Math.round(gaps.at(-1)*100)/100:null,
        over50ms:gaps.filter(t=>t>50).length,over1000ms:gaps.filter(t=>t>=1000).length,
        interpretation:'rAF presentation scheduling gap; not hardware GPU timer'});
    };
    requestAnimationFrame(run);
  }),durationMs);
}
async function stage4Snapshot(page){
  const data=await page.evaluate(()=>{
    const w=window.__PANDOLAB_VIEWER__;
    if(!w)return {viewerMissing:true};
    const s=w.rendererStats(),t=s.gpuUpload||{};
    return {initialMapPresented:w.initialMapPresented(),renderer:s.renderer,
      readiness:s.mapReadiness,projectRenderBlocked:s.projectRenderBlocked,
      displayedRevision:s.displayedRevision,requestedRevision:s.requestedRevision,
      status:document.querySelector('#viewerStatus')?.textContent,
      statusReady:document.querySelector('#viewerStatus')?.dataset.ready,
      effectivePixelRatio:s.effectivePixelRatio,quality:s.renderQuality||null,
      terrainLevel:s.terrainTargetLevel,renderedLevel:s.terrainRenderedLevel,
      terrainReady:s.terrainReady,terrainTargetTileCount:s.terrainTargetTileCount,
      terrainTargetTilesLoaded:s.terrainTargetTilesLoaded,
      terrainCacheBytes:s.terrainCacheBytes,terrainBudgetBytes:s.terrainMemoryBudgetBytes,
      terrainCacheOverBudgetBytes:s.terrainCacheOverBudgetBytes??null,
      naturalRequests:s.terrainNaturalRequests,
      naturalLoaded:s.terrainNaturalTilesLoaded,
      naturalPendingBytes:s.terrainNaturalPendingBytes,
      naturalFailures:s.terrainNaturalFailures,naturalUploads:s.terrainNaturalUploadCount,
      naturalSourceRevision:s.terrainNaturalSourceRevision,
      managedGpuBytes:s.managedGpuBytes,
      overlayBufferBytes:s.polygonOverlay?.activeBufferBytes??null,
      overlayBudget:s.polygonOverlay?.resourceBudget??null,
      strokeBufferBytes:s.stroke?.activeBufferBytes??null,
      cpuSubmitP95Ms:s.p95CpuSubmitMs??null,cpuSubmitP99Ms:s.p99CpuSubmitMs??null,
      drawCalls:s.webGlLastFrameSceneDrawCalls??null,
      gpuUpload:{pending:t.pending,frames:t.frames,completed:t.completed,
        cancelled:t.cancelled,overrunCount:t.overrunCount,maxFrameMs:t.maxFrameMs},
      screenScale:s.screenScale};
  });
  const session=await page.context().newCDPSession(page);
  try{
    await session.send('Performance.enable');
    const vals=(await session.send('Performance.getMetrics')).metrics;
    const m=Object.fromEntries(vals.map(row=>[row.name,row.value]));
    data.mainJsHeapUsedBytes=m.JSHeapUsedSize??null;
    data.mainJsHeapTotalBytes=m.JSHeapTotalSize??null;
    data.cpuTaskDurationSeconds=m.TaskDuration??null;
  }finally{await session.detach();}
  return data;
}
async function stage4ColorDifference(page,a,b){
  return page.evaluate(async({a,b})=>{
    async function pixels(data){
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));
      const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
      const rgb=ctx.getImageData(0,0,c.width,c.height).data;
      bitmap.close();return rgb;
    }
    const before=await pixels(a),after=await pixels(b);
    if(before.length!==after.length)throw Error('Different image dimensions');
    let changed=0,max=0;
    for(let i=0;i<before.length;i+=4){
      const d=Math.max(Math.abs(before[i]-after[i]),Math.abs(before[i+1]-after[i+1]),
        Math.abs(before[i+2]-after[i+2]));
      if(d>8)changed++;
      if(d>max)max=d;
    }
    return {changedPixels:changed,maxChannelDifference:max,totalPixels:before.length/4};
  },{a:[...a],b:[...b]});
}
for(const profile of [{name:'desktop',viewport:{width:1280,height:800}},
  {name:'mobile-viewport',viewport:{width:390,height:844}}]){
  test('stage-4 immutable world natural actual Viewer '+profile.name,async({page},info)=>{
    test.setTimeout(420_000);
    const data={schema:'pando-stage4-world-v1',viewport:profile.viewport,
      appCommit:process.env.GITHUB_SHA||null,
      naturalEdition:'v0.2.0-world.1',gpuTimerMeasured:false,
      physicalGpuMemoryMeasured:false,
      actualMobileHardware:false,flatProjection:'unsupported',records:[],responses:[],errors:[],warnings:[]};
    let unblock;const gate=new Promise(resolve=>unblock=resolve);
    let held=0,blocking=true;
    page.on('pageerror',error=>data.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')data.warnings.push(message.text().slice(0,500));});
    page.on('response',response=>{
      if(response.url().includes('/terrain/natural/'))data.responses.push({
        status:response.status(),url:response.url().split('/').slice(-3).join('/'),
        bytes:Number(response.headers()['content-length'])||null});
    });
    await page.route(/\/terrain\/natural\/v0\.2\.0-world\.1\/\d+\/\d+-\d+\.webp/,async route=>{
      if(blocking){held++;await gate;}
      if(!page.isClosed())await route.continue().catch(()=>{});
    });
    try{
      await page.setViewportSize(profile.viewport);
      await page.goto('./?debug=1&naturalTerrain=world',{waitUntil:'domcontentloaded'});
      const startup=Date.now();
      const ready=await expect.poll(async()=>{
        const s=await stage4Snapshot(page);
        return s.initialMapPresented===true&&s.readiness?.mapReady===true
          &&s.displayedRevision>0&&s.statusReady==='true';
      },{timeout:85000,intervals:[700,1000,2000]}).toBe(true).then(()=>true,()=>false);
      data.startup={ready,elapsedMs:Date.now()-startup,details:await stage4Snapshot(page)};
      await page.screenshot({path:info.outputPath('world-'+profile.name+'-startup.png')});
      if(!ready)throw Error('Viewer startup has not presented a certified frame');
      const host=()=>page.evaluate(()=>{
        const h=window.__PANDOLAB_MAP_HOST__,v=h.getViewState();
        h.setViewState({projection:'globe',view:{...v,globeRotation:[-106,-30,0],globeZoom:1}});
        h.requestRepaint('stage4-world-source');
      });
      await host();
      // Wait for an actual DEM frame while the optional natural file is held.
      const heldReady=await expect.poll(()=>held,{timeout:40000,intervals:[300,700,1500]})
        .toBeGreaterThan(0).then(()=>true,()=>false);
      data.heldWorldTiles=held;
      data.heldWorldReady=heldReady;
      await page.waitForTimeout(1200);
      const before=await page.locator('canvas.gpu-map-canvas').first()
        .screenshot({path:info.outputPath('world-'+profile.name+'-before-natural.png')});
      data.records.push({stage:'before-natural',snapshot:await stage4Snapshot(page),
        pacing:await observedFrameGaps(page)});
      blocking=false;unblock();
      const admitted=await expect.poll(async()=>{
        const s=await stage4Snapshot(page);return s.naturalLoaded>0&&s.naturalUploads>0;
      },{timeout:60000,intervals:[400,1000,1600]}).toBe(true).then(()=>true,()=>false);
      data.naturalAdmission={admitted,details:await stage4Snapshot(page)};
      if(admitted){
        await page.waitForTimeout(900);
        const after=await page.locator('canvas.gpu-map-canvas').first()
          .screenshot({path:info.outputPath('world-'+profile.name+'-after-natural.png')});
        data.naturalDifference=await stage4ColorDifference(page,before,after);
      }else data.naturalDifference=null;
      for(const zoom of [1,8,16,32]){
        await page.evaluate(z=>{
          const h=window.__PANDOLAB_MAP_HOST__,v=h.getViewState();
          h.setViewState({projection:'globe',view:{...v,globeRotation:[-106,-30,0],globeZoom:z}});
          h.requestRepaint('stage4-world-zoom-'+z);
        },zoom);
        await page.waitForTimeout(1800);
        const snap=await stage4Snapshot(page);
        const pacing=await observedFrameGaps(page);
        await page.locator('canvas.gpu-map-canvas').first()
          .screenshot({path:info.outputPath('world-'+profile.name+'-'+zoom+'x.png')});
        data.records.push({stage:'zoom-'+zoom,zoom,snapshot:snap,pacing});
      }
      expect(data.heldWorldReady,'world natural tile fetch must occur').toBe(true);
      expect(data.naturalAdmission.admitted,'natural texture must reach GPU').toBe(true);
      expect(data.naturalDifference.changedPixels,'natural texture must affect actual pixels').toBeGreaterThan(100);
      expect(data.errors).toEqual([]);
    }catch(error){
      data.error=error.stack||String(error);
      throw error;
    }finally{
      blocking=false;unblock();
      await writeFile(info.outputPath('world-'+profile.name+'-metrics.json'),JSON.stringify(data,null,2));
    }
  });
}
