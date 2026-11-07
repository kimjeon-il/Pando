import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { waitForCanonicalMap } from './helpers/viewer-acceptance.mjs';

// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe("Initial Viewer presentation", () => {
const profiles=[
  {name:'desktop-light',viewport:{width:1280,height:800},theme:'light',reduced:false,reload:true},
  {name:'narrow-dark-reduced',viewport:{width:390,height:844},theme:'dark',reduced:true,reload:false},
];
async function gated(page){
  await page.addInitScript(()=>{window.__p1Hold=true;});
  await page.route('**/modules/viewer-map.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const anchor='prepareBuiltinProject:async(month,options)=>{';
    if(source.split(anchor).length!==2)throw Error('P1 candidate gate source changed');
    await route.fulfill({response,body:source.replace(anchor,anchor+
      'if(window.__p1Hold)await new Promise(resolve=>{window.__p1Release=resolve;});')});
  });
}
async function observe(page,profile,info,label){
  const preview=page.locator('#viewerInitialPreview'),status=page.locator('#viewerStatus');
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','true',{timeout:40000});
  await expect(preview).toBeVisible({timeout:90000});
  await expect(status).toHaveClass('ui-visually-hidden');
  await expect(status).toHaveAttribute('aria-live','polite');
  await expect.poll(()=>page.evaluate(()=>typeof window.__p1Release)).toBe('function');
  const state=await page.evaluate(()=>{
    const map=document.getElementById('map'),svg=document.getElementById('viewerInitialPreview');
    const land=svg.querySelector('.viewer-initial-preview-land'),ocean=svg.querySelector('.viewer-initial-preview-ocean');
    const a=map.getBoundingClientRect(),b=svg.getBoundingClientRect();
    return {ready:document.getElementById('viewerStatus').dataset.ready,
      landLength:land.getAttribute('d')?.length||0,oceanLength:ocean.getAttribute('d')?.length||0,
      initialGlobeDiameter:ocean.getBoundingClientRect().width,
      globeTransform:ocean.getAttribute('transform'),
      color:land.getAttribute('fill'),theme:document.documentElement.dataset.theme,
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation:getComputedStyle(svg).animationName,
      pointerEvents:getComputedStyle(svg).pointerEvents,ariaHidden:svg.getAttribute('aria-hidden'),
      map:[a.x,a.y,a.width,a.height],preview:[b.x,b.y,b.width,b.height]};
  });
  expect(state.ready).toBe('false');expect(state.landLength).toBeGreaterThan(100);
  expect(state.landLength,'The preview should no longer contain the full 10m coastline path').toBeLessThan(3000000);
  expect(state.oceanLength).toBeGreaterThan(0);expect(state.theme).toBe(profile.theme);
  expect(state.color).toBe(profile.theme==='light'?'#cccccc':'#63758a');
  expect(state.reduced).toBe(profile.reduced);expect(state.animation).toBe('none');
  expect(state.pointerEvents).toBe('none');expect(state.ariaHidden).toBe('true');
  for(let i=0;i<4;i++)expect(Math.abs(state.map[i]-state.preview[i])).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath(label+'-preview.png')});
  return state;
}
async function finish(page,{reduced=false}={}){
  await page.evaluate(() => {
    window.__viewerFirstRevealPhases = [];
    const root = document.getElementById('viewer');
    const observer = new MutationObserver(() => {
      window.__viewerFirstRevealPhases.push(root.dataset.initialReveal ?? 'unset');
    });
    observer.observe(root,{attributes:true,attributeFilter:['data-initial-reveal']});
    window.__viewerFirstRevealObserver = observer;
  });
  await page.evaluate(()=>{window.__p1Hold=false;window.__p1Release();});
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false',{timeout:100000});
  await expect(page.locator('#viewerInitialPreview')).toBeHidden();
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  if(!reduced)await expect.poll(()=>page.evaluate(() =>
    window.__viewerFirstRevealPhases?.includes('labels') ?? false),{timeout:10000}).toBe(true);
  const phases=await page.evaluate(() => {
    window.__viewerFirstRevealObserver?.disconnect();
    return window.__viewerFirstRevealPhases || [];
  });
  if(reduced){
    expect(phases).not.toContain('countries');
    expect(phases).not.toContain('labels');
  }else{
    expect(phases).toContain('countries');
    expect(phases).toContain('labels');
    expect(phases.indexOf('countries')).toBeLessThan(phases.indexOf('labels'));
  }
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.initialMapPresented())).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.visibleTerritorialCount())).toBeGreaterThan(0);
  return await page.evaluate(()=>({scale:window.__PANDOLAB_VIEWER__.rendererStats().screenScale,
    camera:window.__PANDOLAB_MAP_HOST__?.getViewState?.()||null,
    revealPhases:window.__viewerFirstRevealPhases}));
}
for(const profile of profiles){
  test('P1-4 startup/reload and tab: '+profile.name,async({page},info)=>{
    test.setTimeout(240000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewportSize(profile.viewport);
    await page.emulateMedia({reducedMotion:profile.reduced?'reduce':'no-preference'});
    await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
    await page.addInitScript(theme=>localStorage.setItem('pandolab-user-preferences',
      JSON.stringify({version:2,appearance:{theme}})),profile.theme);
    await gated(page);
    await page.goto('/?debug=1');
    const first=await observe(page,profile,info,'initial');
    const finalMap=await finish(page,profile);
    expect(first.initialGlobeDiameter,{message:'Preview globe must use final canonical camera scale, not initial zoom=1'}).toBeGreaterThan(0);
    expect(finalMap.scale).toBeGreaterThan(0);
    expect(Math.abs(first.initialGlobeDiameter/(2*finalMap.scale)-1),
      `Initial preview diameter ${first.initialGlobeDiameter} vs final ${2*finalMap.scale}`).toBeLessThan(0.025);
    await page.screenshot({path:info.outputPath('complete.png')});
    await page.locator('#timelinePreviousYear').click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth().month),
      {timeout:95000}).toBe('2025-12');
    await expect(page.locator('#viewerInitialPreview')).toBeHidden();
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-reveal','complete');
    await page.evaluate(()=>{
      window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
    await expect(page.locator('#viewerInitialPreview')).toBeHidden();
    if(profile.reload){
      await page.reload();
      const afterReload=await observe(page,profile,info,'reload');
      expect(afterReload.color).toBe(first.color);
      const afterReloadFinal=await finish(page,profile);
      expect(Math.abs(afterReload.initialGlobeDiameter/(2*afterReloadFinal.scale)-1),
        'Reloaded initial preview diameter must match the canonical map').toBeLessThan(0.025);
    }
    writeFileSync(info.outputPath('p1-4.json'),JSON.stringify({profile,first,finalMap,scaleError:Math.abs(first.initialGlobeDiameter/(2*finalMap.scale)-1),errors},null,2));
    expect(errors).toEqual([]);
  });
}
test('P1-4 ungated startup has no forced preview duration',async({page})=>{
  test.setTimeout(125000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:100000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.initialMapPresented())).toBe(true);
  await expect(page.locator('#viewerInitialPreview')).toBeHidden();
  await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading','false');
  expect(errors).toEqual([]);
});
});


test.describe("Derived coast and land preview", () => {
for(const profile of [
 {name:'desktop-light',width:1280,height:800,theme:'light'},
 {name:'narrow-dark',width:390,height:844,theme:'dark'}
]){
 test('P1-4c simplified coast matches pinned source pixels: '+profile.name,async({page},info)=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:profile.width,height:profile.height});
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  await page.addInitScript(theme=>{
   localStorage.setItem('pandolab-user-preferences',JSON.stringify({version:2,appearance:{theme}}));
   window.__p1cHold=true;
  },profile.theme);
  await page.route('**/modules/viewer-map.js*',async route=>{
   const response=await route.fetch(),source=await response.text();
   const anchor='prepareBuiltinProject:async(month,options)=>{';
   if(source.split(anchor).length!==2)throw Error('P1-4c candidate hold anchor changed');
   await route.fulfill({response,body:source.replace(anchor,
     anchor+'if(window.__p1cHold)await new Promise(resolve=>window.__p1cRelease=resolve);')});
  });
  await page.route('**/modules/viewer-initial-preview.js*',async route=>{
   const response=await route.fetch(),source=await response.text(),anchor='geometry = result.geometry;';
   if(source.split(anchor).length!==2)throw Error('P1-4c preview module anchor changed');
   await route.fulfill({response,body:source.replace(anchor,anchor+
    'window.__p1cFrame=()=>lastFrame;window.__p1cGeometry=()=>geometry;')});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerInitialPreview')).toBeVisible({timeout:95000});
  await expect.poll(()=>page.evaluate(()=>typeof window.__p1cFrame)).toBe('function');
  const proof=await page.evaluate(async()=>{
   const meta=window.PANDOLAB_BUILD_META,frame=window.__p1cFrame(),preview=window.__p1cGeometry();
   const land=document.querySelector('.viewer-initial-preview-land');
   const response=await fetch('/'+meta.physicalLand.url);
   if(!response.ok)throw Error('Canonical land fetch failed: '+response.status);
   const bytes=await response.arrayBuffer();
   const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   const original=JSON.parse(new TextDecoder().decode(raw));
   const [width,height]=frame.cssViewport;
   const rasterize=pathString=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#000';ctx.fill(new Path2D(pathString));
    const pixels=ctx.getImageData(0,0,width,height).data;
    const mask=new Uint8Array(width*height);
    for(let i=0;i<mask.length;i++)mask[i]=pixels[i*4+3]>64?1:0;
    canvas.width=0;canvas.height=0;
    return mask;
   };
   const ref=rasterize(frame.projectPath(original)),candidate=rasterize(land.getAttribute('d'));
   let overlap=0,refPixels=0,changed=0,union=0;
   for(let i=0;i<ref.length;i++){
    if(ref[i])refPixels++;
    if(ref[i]&&candidate[i])overlap++;
    if(ref[i]!==candidate[i])changed++;
    if(ref[i]||candidate[i])union++;
   }
   return{sourceSha:meta.physicalLand.sha256,derivativeSourceSha:meta.initialLandPreview.sourceSha256,
    compressedOriginalBytes:meta.physicalLand.compressedBytes,compressedPreviewBytes:meta.initialLandPreview.compressedBytes,
    originalPoints:meta.initialLandPreview.sourceCoordinateCount,previewPoints:meta.initialLandPreview.coordinateCount,
    previewPathLength:land.getAttribute('d').length,polygonCount:original.coordinates.length,
    previewPolygonCount:preview.coordinates.length,
    sameHoleCounts:original.coordinates.every((p,i)=>p.length===preview.coordinates[i]?.length),
    screen:{width,height,referenceLandPixels:refPixels,overlapPixels:overlap,
      differingPixels:changed,unionPixels:union,changedOverLand:changed/Math.max(1,refPixels),
      intersectionOverUnion:overlap/Math.max(1,union)}};
  });
  console.log('P1_4C_SCREEN '+JSON.stringify({profile:profile.name,...proof}));
  writeFileSync(info.outputPath('coast-pixel-comparison.json'),JSON.stringify({profile,proof,errors},null,2));
  expect(proof.sourceSha).toBe(proof.derivativeSourceSha);
  expect(proof.previewPolygonCount).toBe(proof.polygonCount);
  expect(proof.sameHoleCounts).toBe(true);
  expect(proof.previewPoints/proof.originalPoints).toBeLessThan(0.18);
  expect(proof.compressedPreviewBytes/proof.compressedOriginalBytes).toBeLessThan(0.3);
  expect(proof.previewPathLength).toBeLessThan(2800000);
  expect(proof.screen.referenceLandPixels).toBeGreaterThan(10000);
  expect(proof.screen.changedOverLand).toBeLessThan(0.055);
  await page.screenshot({path:info.outputPath('initial-lightweight.png')});
  await page.evaluate(()=>{window.__p1cHold=false;window.__p1cRelease();});
  await expect(page.locator('#viewerInitialPreview')).toBeHidden({timeout:100000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  expect(errors).toEqual([]);
 });
}
});


test.describe("Canonical map and terrain publication", () => {
test('Web publishes sharp ocean and land before countries, then reuses prepared terrain and meshes', async ({ page }) => {
  test.setTimeout(120000);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  let release; const gate=new Promise(resolve=>{ release=resolve; });
  await page.route(/\/terrain\/[^/]+\/(?:tint|\d+\/\d+-\d+)\.webp/, async route=>{ await gate; await route.continue(); });
  await page.addInitScript(()=>{
    const timer=setInterval(()=>{
      const viewer=window.__PANDOLAB_VIEWER__, host=window.__PANDOLAB_MAP_HOST__;
      const stats=viewer?.rendererStats();
      if(!host || !stats?.projectGeneration || stats.projectRenderBlocked)return;
      host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-24.6,-38.5,0],globeZoom:8}});
      host.requestRepaint('startup-sharp-regression');clearInterval(timer);
    },20);
  });
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
  try {
    await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
    await expect.poll(async()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats().canonicalMeshReady),{timeout:60000}).toBe(true);
    // The first physical WebGL country frame is allowed before optional DEM
    // tiles resolve. Readiness is distinct from successful base publication.
    await expect.poll(async() => {
      const state = await stats();
      return state.countriesPublishedGeneration === state.projectGeneration
        && state.firstCountryPublishedMs !== null
        && (state.surfaceDraw?.countryIndexCount || 0) > 0;
    }, { timeout: 30000 }).toBe(true);
    const early = await stats();
    expect(early.surfacePresentation.quality).toBe('canonical');
    expect(early.mapReadiness.mapReady).toBe(true);
    expect(early.terrainReady).toBe(false);
    expect(early.mapReadiness.status).not.toBe('ready');
    release();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect.poll(async() => {
      const state = await stats();
      return state.countriesPublishedGeneration === state.projectGeneration;
    }, { timeout: 60000 }).toBe(true);
    // User-visible map readiness is independent of optional DEM completion.
    // Observe both milestones separately without weakening either invariant.
    await expect.poll(async()=>(await stats()).terrainReady,{timeout:60000}).toBe(true);
    const cold=await stats();
    expect(cold.firstBackgroundFrameMs).toBeLessThan(cold.firstCountryPublishedMs);
    expect(cold.terrainReady).toBe(true);
    expect(cold.surfaceDraw.countryIndexCount).toBeGreaterThan(0);
    await expect.poll(async()=>(await stats()).terrainTilesLoading,{timeout:15000}).toBe(0);
    await expect.poll(async()=>(await stats()).terrainPendingDecodedBytes,{timeout:15000}).toBe(0);
    const beforeUploads=(await stats()).terrainUploadCount;
    await page.getByRole('button',{name:'파일 메뉴 열기'}).click();
    await page.locator('#builtinMapBtn').click();
    await expect.poll(async()=>(await stats()).projectGeneration,{timeout:60000}).toBeGreaterThan(cold.projectGeneration);
    await waitForCanonicalMap(page,{timeout:60000});
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    const warm=await stats();
    expect(warm.terrainUploadCount).toBe(beforeUploads);
    expect(warm.countryMeshReuseCount).toBeGreaterThan(cold.countryMeshReuseCount || 0);
    expect(warm.countryMeshRebuildCount).toBe(cold.countryMeshRebuildCount);
    expect(warm.countryBoundaryPrepareCount).toBe(cold.countryBoundaryPrepareCount);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({cold:cold.lastMeshPreparation,warm:warm.lastMeshPreparation,background:cold.firstBackgroundFrameMs,countries:cold.firstCountryPublishedMs,uploads:beforeUploads}));
  } finally { release(); }
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

test('WebGL publishes an actual physical country frame before optional terrain detail resolves',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(/\/terrain\/[^/]+\/(?:tint|\d+\/\d+-\d+)\.webp/,async route=>{
    await gate;
    if(!page.isClosed())await route.continue();
  });
  try{
    await page.goto('/?renderer=webgl2&debug=1',{waitUntil:'domcontentloaded'});
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__?.rendererStats();
      return stats?.canonicalMeshReady===true&&stats?.projectRenderBlocked===false;
    }),{timeout:90000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return stats.countriesPublishedGeneration===stats.projectGeneration&&
        stats.firstBackgroundFrameMs!==null&&stats.firstCountryPublishedMs!==null;
    }),{timeout:30000}).toBe(true);
    const stats=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(stats.terrainReady).toBe(false);
    expect(stats.mapReadiness.terrainReady).toBe(false);
    expect(stats.webGlFirstBackgroundSceneDrawCalls?.total).toBeGreaterThan(0);
    expect(stats.webGlFirstCountrySceneDrawCalls?.total).toBeGreaterThan(0);
    expect(stats.webGlFirstCountrySceneDrawCalls.total).toBeGreaterThanOrEqual(
      stats.webGlFirstCountrySceneDrawCalls.direct);
    expect(stats.mapReadiness.status).not.toBe('ready');
    console.log('WEBGL_INITIAL_POSTING '+JSON.stringify({
      firstBackgroundMs:stats.firstBackgroundFrameMs,
      firstCountryMs:stats.firstCountryPublishedMs,
      firstBackgroundDrawCalls:stats.webGlFirstBackgroundSceneDrawCalls,
      firstCountryDrawCalls:stats.webGlFirstCountrySceneDrawCalls,
      baseSubmitMs:stats.webGlLastBaseSubmitMs,
      terrainReady:stats.mapReadiness.terrainReady,
    }));
    expect(errors).toEqual([]);
  }finally{release();}
});
});
