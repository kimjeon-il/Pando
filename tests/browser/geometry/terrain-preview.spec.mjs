import { test as featureTest, test, expect } from '@playwright/test';
featureTest.use({trace:'off',launchOptions:{args:process.platform==='win32'
  ? ['--use-angle=d3d11']
  : ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}});

// Actual numerical relief and palette coverage.
featureTest.describe("terrain-numeric-quality", () => {
test.use({viewport:{width:1000,height:760},deviceScaleFactor:1});

// Decode the actual screenshot rather than a discarded WebGL backbuffer.
async function samples(page,buffer){
  return page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;
    const context=copy.getContext('2d');context.drawImage(image,0,0);image.close();
    const canvas=document.querySelector('canvas.gpu-map-canvas'),rect=canvas.getBoundingClientRect();
    const host=window.__PANDOLAB_MAP_HOST__;
    return [[83,33],[85,33],[87,33],[80,25],[83,25],[86,25]].map(point=>{
      const xy=host.project(point);
      return [...context.getImageData(Math.round(xy[0]*copy.width/rect.width),Math.round(xy[1]*copy.height/rect.height),1,1).data];
    });
  },Array.from(buffer));
}

for(const renderer of ['webgl2','canvas'])test(`selected ${renderer} relief distinguishes Tibetan plateaus and Indian plains in color and grayscale`,async({page},testInfo)=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('pandolab-user-preferences',JSON.stringify({version:2,backgrounds:{viewer:{terrainVisible:true,terrainStyle:'physical'}}})));
  await page.goto(`/?renderer=${renderer}&debug=1`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  await page.evaluate(()=>{
    const host=window.__PANDOLAB_MAP_HOST__;
    host.setViewState({projection:'globe',view:{flatCenter:[85,31],flatZoom:1,globeRotation:[-85,-31,0],globeZoom:5.5}});
    host.requestRepaint('selected-terrain-quality');
  });
  await expect.poll(()=>page.evaluate(()=>{
    const s=window.__PANDOLAB_VIEWER__.rendererStats();
    return s.terrainReady&&s.mapReadiness.status==='ready'&&s.terrainDatasetVersion==='0.13.3'
      &&Math.abs(s.screenScale-window.__PANDOLAB_MAP_HOST__.getViewState().scale)<1
      &&(s.renderer==='webgl2'||s.renderer==='canvas-worker');
  }),{timeout:150000}).toBe(true).catch(async error=>{
    console.log('TERRAIN_QUALITY_FAILURE',JSON.stringify(await page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return {renderer:s.renderer,readiness:s.mapReadiness,terrain:Object.fromEntries(Object.entries(s).filter(([key])=>key.startsWith('terrain')))};
    })));throw error;
  });
  const settled=async()=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect.poll(()=>page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return s.mapReadiness.status==='ready'&&(s.renderer!=='canvas-worker'
        ||s.canvasDisplayedStyleRevision===s.canvasStyleRevision&&!s.canvasWorkerBusy&&!s.canvasWorkerHasPendingFrame);
    }),{timeout:60000}).toBe(true);
  };
  await settled();
  const visibleLand=await samples(page,await page.locator('canvas.gpu-map-canvas').first().screenshot());
  for(const rgba of visibleLand)expect(Math.max(rgba[0],rgba[1])-rgba[2],'land is actually painted before the overlay capture').toBeGreaterThan(8);
  await page.screenshot({path:testInfo.outputPath('terrain-with-borders-and-labels.png')});
  await page.evaluate(()=>{
    for(const id of ['objectsVisible','labelsVisible','riversVisible','lakesVisible']){
      const input=document.getElementById(id);if(input?.checked)input.click();
    }
  });
  await settled();
  const before=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState());
  for(const style of ['physical','political']){
    await page.locator(style==='physical'?'#terrainPhysicalRadio':'#terrainPoliticalRadio').evaluate(input=>input.click());
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
    await settled();
    const image=await page.locator('canvas.gpu-map-canvas').first().screenshot({path:testInfo.outputPath(`selected-${style}.png`)});
    const colors=await samples(page,image);
    for(const rgba of colors)expect(rgba[3]).toBe(255);
    if(style==='political'){
      for(const rgba of colors)expect(Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3))).toBeLessThanOrEqual(2);
      const median=values=>values.sort((a,b)=>a-b)[1];
      expect(median(colors.slice(0,3).map(c=>c[0]))-median(colors.slice(3).map(c=>c[0]))).toBeGreaterThan(20);
    }else expect(colors.slice(3).some(c=>c[1]>c[0]+10&&c[1]>c[2]+10)).toBe(true);
    expect(await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState())).toEqual(before);
    console.log(JSON.stringify({renderer,style,colors}));
  }
  expect(errors).toEqual([]);
});


// Failures print the accepted C++ document and renderer state. Do not replace
// real readiness, date, GPU or terrain assertions with this diagnostic.
test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus)return;
  const state=await page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__,stats=api?.rendererStats?.()||{};
    const fields=['renderer','mapReadiness','projectGeneration','countriesPublishedGeneration',
      'canonicalMeshReady','projectRenderBlocked','surfacePresentation','terrainReady',
      'terrainTargetLevel','terrainRenderedLevel','terrainTargetTilesLoaded','terrainTargetTileCount',
      'terrainTilesLoading','terrainPendingDecodedBytes','screenScale','hydroPendingUploadCount',
      'webglContextLost','temporalPresentationPending','requestedRevision','displayedRevision',
      'firstBackgroundFrameMs','firstCountryPublishedMs','lastMeshPreparation'];
    return {documentState:api?.documentState?.()||null,
      builtinMonth:api?.builtinMonth?.()||null,
      map:Object.fromEntries(fields.map(k=>[k,stats[k]??null])),
      diagnostics:api?.diagnostics?.().slice(-12)||[],
      status:document.getElementById('viewerStatus')?.dataset.ready};
  }).catch(error=>({unavailable:String(error)}));
  console.error('P7_FAILED_MAP_STATE '+JSON.stringify({test:info.title,state}).slice(0,14000));
});
});
featureTest.describe('terrain-ocean-loading', () => {
  test.use({viewport:{width:1100,height:760}});
  test('western Pacific retains ocean pixels while numerical DEM tiles are delayed', async ({page,context}, testInfo) => {
    test.setTimeout(150000);
    let release, delayed=0;
    const gate=new Promise(resolve=>{release=resolve;});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/terrain/v*/**/*.webp*',async route=>{
      delayed++;
      await gate;
      if(!page.isClosed())await route.continue();
    });
    try {
      await page.goto('/?renderer=webgl2&debug=1',{waitUntil:'domcontentloaded'});
      await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats().firstBackgroundFrameMs||0),{timeout:90000}).toBeGreaterThan(0);
      await page.evaluate(()=>{
        const host=window.__PANDOLAB_MAP_HOST__;
        host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-145,-15,0],globeZoom:3}});
        host.requestRepaint('western-pacific-loading');
      });
      await expect.poll(()=>delayed).toBeGreaterThan(0);
      await expect.poll(()=>page.evaluate(()=>{
        const s=window.__PANDOLAB_VIEWER__.rendererStats();
        return s.renderer==='webgl2' && !s.mapReadiness.terrainReady
          && Math.abs(s.screenScale-window.__PANDOLAB_MAP_HOST__.getViewState().scale)<1;
      })).toBe(true);
      const screenshot=await page.locator('canvas.gpu-map-canvas').first().screenshot({path:testInfo.outputPath('western-pacific-delayed-dem.png')});
      const rgba=await page.evaluate(async bytes=>{
        const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
        const copy=document.createElement('canvas');copy.width=bitmap.width;copy.height=bitmap.height;
        const ctx=copy.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
        const point=window.__PANDOLAB_MAP_HOST__.project([145,15]);
        const bounds=document.querySelector('canvas.gpu-map-canvas').getBoundingClientRect();
        return [...ctx.getImageData(Math.round(point[0]*copy.width/bounds.width),Math.round(point[1]*copy.height/bounds.height),1,1).data];
      },[...screenshot]);
      expect(rgba[3]).toBe(255);
      expect(rgba[2]-rgba[0]).toBeGreaterThan(15);
      release();
      await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.terrainReady),{timeout:90000}).toBe(true);
      expect(errors).toEqual([]);
    } finally {release();}
  });
});
