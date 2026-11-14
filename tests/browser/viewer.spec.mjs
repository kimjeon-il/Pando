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


// Core Viewer acceptance: a real terrain frame must remain visible while an
// optional immutable natural tile is delayed; measure the actual WebGL2 image,
// resident caches and rAF pacing without treating them as physical GPU timing.
async function stage4Raf(page,durationMs=700){
  return page.evaluate(ms=>new Promise(resolve=>{
    const gaps=[];let first=null,last=null;
    const next=now=>{
      if(first===null)first=now;
      if(last!==null)gaps.push(now-last);
      last=now;
      if(now-first<ms)return requestAnimationFrame(next);
      const sorted=gaps.sort((a,b)=>a-b),pct=p=>sorted.length
        ?Number(sorted[Math.floor((sorted.length-1)*p)].toFixed(2)):null;
      resolve({samples:sorted.length,p50Ms:pct(.5),p95Ms:pct(.95),
        p99Ms:pct(.99),maxMs:sorted.length?Number(sorted.at(-1).toFixed(2)):null,
        kind:'requestAnimationFrame scheduling gap (NOT physical GPU frame time)'});
    };
    requestAnimationFrame(next);
  }),durationMs);
}
async function stage4Memory(page){
  const session=await page.context().newCDPSession(page);
  try{
    await session.send('Performance.enable');
    const values=(await session.send('Performance.getMetrics')).metrics;
    const m=Object.fromEntries(values.map(row=>[row.name,row.value]));
    return {mainThreadJsHeapUsedBytes:m.JSHeapUsedSize??null,
      mainThreadJsHeapTotalBytes:m.JSHeapTotalSize??null,
      taskDurationSeconds:m.TaskDuration??null,scriptDurationSeconds:m.ScriptDuration??null,
      physicalGpuVramBytes:null};
  }finally{await session.detach();}
}
async function stage4SetGlobe(page,zoom){
  await page.evaluate(z=>{
    const host=window.__PANDOLAB_MAP_HOST__;
    if(!host)throw Error('Real Viewer map host is unavailable');
    const view=host.getViewState();
    host.setViewState({projection:'globe',
      view:{...view,globeRotation:[-106,-30,0],globeZoom:z}});
    host.requestRepaint('terrain-stage4-measured-zoom-'+z);
  },zoom);
}
async function stage4PixelDifference(page,first,second){
  return page.evaluate(async({left,right})=>{
    const decode=async values=>{
      const img=await createImageBitmap(new Blob([new Uint8Array(values)],{type:'image/png'}));
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
      const ctx=c.getContext('2d');ctx.drawImage(img,0,0);img.close();
      return {data:ctx.getImageData(0,0,c.width,c.height).data,width:c.width,height:c.height};
    };
    const a=await decode(left),b=await decode(right);
    if(a.width!==b.width||a.height!==b.height)throw Error('Screenshot sizes differ');
    let changed=0,maxDifference=0;
    for(let i=0;i<a.data.length;i+=4){
      const diff=Math.max(Math.abs(a.data[i]-b.data[i]),
        Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2]));
      if(diff>8)changed++;if(diff>maxDifference)maxDifference=diff;
    }
    return {comparedPixels:a.width*a.height,changedPixels:changed,maxChannelDifference:maxDifference};
  },{left:[...first],right:[...second]});
}

for(const viewCase of [{name:'desktop',size:{width:1280,height:800}},
  {name:'mobile-viewport',size:{width:390,height:844}}]){
  test('terrain stage 4 real WebGL2 relief capture and memory: '+viewCase.name,
    async({page},info)=>{
      test.setTimeout(420_000);
      const records=[],errors=[],http=[];
      const heldTiles={count:0,active:true};
      let unlock=()=>{};
      const gate=new Promise(resolve=>{unlock=resolve;});
      page.on('pageerror',e=>errors.push(e.message));
      page.on('response',r=>{
        if(/\/terrain\/natural\//.test(r.url()))http.push({status:r.status(),
          url:r.url().split('/').slice(-3).join('/'),
          reportedLength:Number(r.headers()['content-length'])||null});
      });
      await page.route(/\/terrain\/natural\/v[^/]+\/\d+\/\d+-\d+\.webp/,async route=>{
        if(heldTiles.active){heldTiles.count++;await gate;}
        if(!page.isClosed())await route.continue().catch(()=>{});
      });
      await page.setViewportSize(viewCase.size);
      await page.addInitScript(()=>localStorage.setItem('pandolab-user-preferences',
        JSON.stringify({version:2,appearance:{mapStyle:'standard',theme:'light'}})));
      const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats());
      const canvas=page.locator('canvas.gpu-map-canvas').first();
      let naturalBefore=null,naturalAfter=null,pixelDifference=null,problem=null;
      try{
        await open(page,'&naturalTerrain=observed');
        expect((await stats()).renderer).toBe('webgl2');
        await stage4SetGlobe(page,16);
        // Keep optional natural imagery delayed while a numerical terrain
        // frame is fully drawable and preserve that actual screenshot.
        await expect.poll(async()=>Boolean((await stats())?.mapReadiness?.terrainReady),
          {timeout:110_000}).toBe(true);
        // The observed candidate contains LOD4-only patches. A low-end
        // profile can legitimately select LOD3 and request no natural tile.
        // Preserve useful DEM measurements and fail with a precise reason
        // instead of waiting 110 seconds without a screenshot or metrics.
        await expect.poll(()=>heldTiles.count,{timeout:20_000}).toBeGreaterThan(0)
          .catch(()=>{});
        console.log('STAGE4_ADMISSION='+JSON.stringify({
          profile:viewCase.name,held:heldTiles.count,stats:await stats(),
          physicalSettings:await page.evaluate(()=>window.__PANDOLAB_VIEWER__?.documentState()?.physicalSettings??null),
          view:await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__?.getViewState?.()??null),
        }));
        naturalBefore=await canvas.screenshot({
          timeout:50_000,path:info.outputPath('stage4-'+viewCase.name+'-terrain-before-natural.png')});
        const baseline={stats:await stats(),memory:await stage4Memory(page),
          pacing:await stage4Raf(page)};
        heldTiles.active=false;unlock();
        if(heldTiles.count>0){
          await expect.poll(async()=>Number((await stats())?.terrainNaturalTilesLoaded||0),
            {timeout:90_000}).toBeGreaterThan(0);
          await page.waitForTimeout(450);
        }
        naturalAfter=await canvas.screenshot({
          timeout:50_000,path:info.outputPath('stage4-'+viewCase.name+'-natural-after.png')});
        pixelDifference=await stage4PixelDifference(page,naturalBefore,naturalAfter);
        records.push({scene:'china-globe-16x-observed',zoom:16,
          stats:await stats(),memory:await stage4Memory(page),
          pacing:await stage4Raf(page),baseline,pixelDifference});
        // Only four actual camera states, not a synthetic animation and not
        // a blanket UI regression. This also records source/LOD downshifts.
        for(const zoom of [1,8,32]){
          await stage4SetGlobe(page,zoom);
          await expect.poll(async()=>Boolean((await stats())?.mapReadiness?.mapReady),
            {timeout:75_000}).toBe(true);
          await page.waitForTimeout(220);
          await canvas.screenshot({timeout:50_000,
            path:info.outputPath('stage4-'+viewCase.name+'-globe-'+zoom+'x.png')});
          records.push({scene:'china-globe-'+zoom+'x',zoom,
            stats:await stats(),memory:await stage4Memory(page),
            pacing:await stage4Raf(page)});
        }
        // Lack of observed imagery is an explicit incomplete-coverage result,
        // not evidence that natural-color comparison passed.
        expect(heldTiles.count,'observed LOD4 sample must be requested').toBeGreaterThan(0);
        expect(pixelDifference.changedPixels).toBeGreaterThan(100);
      }catch(error){problem=error.stack||String(error);throw error;}
      finally{
        heldTiles.active=false;unlock();
        const evidence={
          schema:'pando-stage4-real-viewer-v1',appCommit:process.env.GITHUB_SHA||null,
          renderer:'webgl2',actualViewer:true,environment:'GitHub Actions Chromium (GPU backend reported in capabilities)',
          emulatedViewport:viewCase.name==='mobile-viewport',
          flatProjection:'unsupported by current product (not benchmarked)',
          gpuTimerQueriesMeasured:false,physicalGpuMemoryMeasured:false,
          heldNaturalRequests:heldTiles.count,pixelDifference,records,
          naturalHttpResponses:http,scriptErrors:errors,problem,
          status:heldTiles.count===0?'observed-image-not-requested':'observed-image-requested'
        };
        await writeFile(info.outputPath('stage4-'+viewCase.name+'-metrics.json'),
          JSON.stringify(evidence,null,2));
        console.log('STAGE4_METRICS='+JSON.stringify(evidence).slice(0,16000));
      }
    });
}
