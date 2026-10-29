import {test,expect} from '@playwright/test';

test.use({viewport:{width:960,height:640},trace:'off'});

for (const mode of ['webgl','canvas','canvas-worker']) test(`temporal map holds its last complete ${mode} frame until its successor is presented`,async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  // Keep this measured transition on one source snapshot when another local
  // task refreshes the shared development server.
  await page.route('**/__frontend/reload.js',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.addInitScript(mode=>{
    const getContext=window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(String(type).includes('webgl') && mode.startsWith('canvas'))return null;
      return getContext.call(this,type,...args);
    };
    if(mode==='canvas'){
      const WorkerClass=window.Worker;
      window.Worker=class extends WorkerClass{constructor(url,options){if(String(url).includes('canvas-render-worker'))throw new Error('Canvas2D test path');super(url,options);}};
    }
  },mode);
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker="const nextDependencies = { source: 'country-mesh',";
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,`
      window.__temporalWaterPresented=()=>preparedBaseScene?.physicalWaterItems.length>0
        && preparedBaseScene.physicalWaterItems.every(({packet})=>polygonOverlayPass.hasPreparedResource(packet))
        && lastBaseSceneResult?.overlayRenderedKeys.includes('physical-water');
      if (window.__temporalGate) await window.__temporalGate();
    `+marker)});
  });
  await page.route('**/modules/country-index.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker='function scheduleCountryLabelAnchors(ids = null, delay = 30) {';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,marker+'\nwindow.__pendingCountryAnchors = () => pendingCountryLabelAnchors.size;')});
  });
  await page.route('**/modules/rendering-domain.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker='const canPresentFrame =';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,
      "window.__temporalInvalidate = () => { invalidateLabels('country-label-anchor-ready'); invalidateSelection('selection-ready'); invalidateGpuInteraction('highlight-ready'); };\n"+marker)});
  });
  await page.goto('/?debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  try {
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status),{timeout:90000}).toMatch(/ready|limited/);
  } catch(error) {
    console.log('startup errors',errors,consoleErrors);
    console.log('initial readiness',await page.evaluate(()=>{const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return {readiness:stats.mapReadiness,terrainReady:stats.terrainReady,terrainFailed:stats.terrainFailed,renderer:stats.renderer};}));throw error;
  }
  await expect.poll(()=>page.evaluate(()=>window.__pendingCountryAnchors?.()),{timeout:45000}).toBe(0);
  const image=async()=>{
    // Read WebGL through the compositor without changing its context options.
    // Read bitmaprenderer directly: toggling visibility for a screenshot can
    // retain its earlier compositor image even after a new bitmap is accepted.
    const png=mode==='canvas-worker'?null:await page.locator('.gpu-map-canvas').screenshot({style:
      'body * {visibility:hidden!important} .gpu-map-canvas {visibility:visible!important}'});
    return page.evaluate(async encoded=>{
    const bitmap=encoded?await createImageBitmap(await (await fetch('data:image/png;base64,'+encoded)).blob()):document.querySelector('.gpu-map-canvas');
    const snapshot=document.createElement('canvas');snapshot.width=bitmap.width;snapshot.height=bitmap.height;
    const context=snapshot.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close?.();
    const pixels=context.getImageData(0,0,snapshot.width,snapshot.height).data;
    let hash=2166136261;for(let i=0;i<pixels.length;i++)hash=Math.imul(hash^pixels[i],16777619);
    const previous=window.__temporalPixels;let different=0,maxDelta=0;
    if(previous&&previous.length===pixels.length)for(let i=0;i<pixels.length;i++){if(previous[i]!==pixels[i])different++;maxDelta=Math.max(maxDelta,Math.abs(previous[i]-pixels[i]));}
    if(!previous)window.__temporalPixels=pixels.slice();
    return {hash:hash>>>0,width:snapshot.width,height:snapshot.height,different,maxDelta};
    },png?.toString('base64'));
  };
  const date=await page.locator('#timelineDateButtonText').textContent();
  const labelPositions=()=>page.locator('#map .territorial-label-item, #map .user-label').evaluateAll(nodes=>
    nodes.map(node=>({text:node.textContent,transform:node.getAttribute('transform')})));
  // General readiness precedes asynchronous borders and selected historical
  // water. Compare retained frames only after those pixels have been submitted.
  const waitForCompleteScene=async()=>{
    if(mode!=='webgl')return;
    await expect.poll(()=>page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return window.__temporalWaterPresented() && s.countrySharedBoundaryReady
        && !s.countrySharedBoundaryReplacementPending && s.surfacePresentation.quality==='canonical'
        && s.sceneCache.valid && !s.sceneCache.dirty;
    }),{timeout:45000}).toBe(true);
  };
  await page.evaluate(()=>{window.__temporalHeld=[];window.__temporalGate=()=>new Promise((resolve,reject)=>window.__temporalHeld.push({resolve,reject}));});
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill('1922');
  await page.locator('#timelineMonthInput').selectOption('12');
  await waitForCompleteScene();
  const before=await image(),labels=await page.locator('#map').innerText(),positions=await labelPositions();
  expect(positions.length).toBeGreaterThan(0);
  await page.screenshot({path:test.info().outputPath(`before-${mode}.png`)});
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length)).toBe(1);
  await expect(page.locator('#viewerStatus')).toHaveText('다음 시점 준비 중…');
  await page.evaluate(()=>window.__temporalInvalidate());
  const mapBox=await page.locator('#map').boundingBox();
  const camera=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().screenScale);
  await page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
  await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width/2+100,mapBox.y+mapBox.height/2,{steps:5});await page.mouse.up();
  await page.mouse.wheel(0,-120);
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().screenScale)).toBe(camera);
  expect(await page.locator('#timelineDateButtonText').textContent()).toBe(date);
  const held=await image();console.log('temporal pixel comparison',JSON.stringify({before,held}));
  // Canvas alpha round-trips may differ by one byte at antialiased edges.
  // A partially replaced or cleared frame exceeds this bound immediately.
  if(mode==='webgl')expect(held.hash).toBe(before.hash);
  else expect(held.maxDelta).toBeLessThanOrEqual(1);
  expect(await page.locator('#map').innerText()).toBe(labels);
  expect(await labelPositions()).toEqual(positions);
  await page.evaluate(()=>{window.__temporalGate=null;window.__temporalHeld.shift().resolve();});
  try {
    await expect(page.locator('#timelineDateButtonText')).toHaveText('1922년 12월',{timeout:60000});
  } catch(error) {
    console.log('transition errors',errors,consoleErrors);
    console.log('transition readiness',await page.evaluate(()=>{const stats=window.__PANDOLAB_VIEWER__.rendererStats();return {readiness:stats.mapReadiness,generation:stats.projectGeneration,blocked:stats.projectRenderBlocked,terrain:stats.terrainReady,boundary:stats.countrySharedBoundaryReady};}));
    throw error;
  }
  await expect(page.locator('#viewerStatus')).toBeHidden();
  expect((await image()).hash).not.toBe(before.hash);
  if(mode==='webgl'){
    await page.locator('#timelineDateButton').click();
    await page.mouse.move(20,20);
    await waitForCompleteScene();
    const committed=await image();
    await page.evaluate(()=>{window.__temporalGate=()=>{window.__temporalGate=null;return Promise.reject(new Error('controlled temporal preparation failure'));};});
    await page.locator('#timelineNextMonth').click();
    await expect(page.locator('#timelineDateError')).toContainText('controlled temporal preparation failure',{timeout:45000});
    expect(await page.locator('#timelineDateButtonText').textContent()).toBe('1922년 12월');
    expect((await image()).hash).toBe(committed.hash);
    await page.locator('#timelineYearInput').fill('1922');
    await page.locator('#timelineMonthInput').selectOption('12');
    await page.evaluate(()=>{window.__temporalHeld=[];window.__temporalGate=()=>new Promise(resolve=>window.__temporalHeld.push({resolve}));});
    await page.locator('#timelineNextMonth').click();
    await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length)).toBe(1);
    await page.locator('#timelineNextMonth').click();
    await page.evaluate(()=>window.__temporalHeld.shift().resolve());
    await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length),{timeout:45000}).toBe(1);
    expect(await page.locator('#timelineDateButtonText').textContent()).toBe('1922년 12월');
    expect((await image()).hash).toBe(committed.hash);
    await page.evaluate(()=>{window.__temporalGate=null;window.__temporalHeld.shift().resolve();});
    await expect(page.locator('#timelineDateButtonText')).toHaveText('1923년 2월',{timeout:45000});
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month)).toBe('1923-02');
    await expect(page.locator('#viewerStatus')).toBeHidden();
    const preparation=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    await page.locator('#timelineGoBtn').click();
    await expect(page.locator('#timelinePopover')).toBeHidden({timeout:45000});
    const reused=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(reused.countryMeshRebuildCount||0).toBe(preparation.countryMeshRebuildCount||0);
    expect(reused.countryMeshReuseCount||0).toBeGreaterThan(preparation.countryMeshReuseCount||0);
  }
  const beforeDrag=await image(),positionsBeforeDrag=await labelPositions();
  await page.mouse.move(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
  await page.mouse.down();await page.mouse.move(mapBox.x+mapBox.width/2+100,mapBox.y+mapBox.height/2,{steps:5});await page.mouse.up();
  await expect.poll(labelPositions).not.toEqual(positionsBeforeDrag);
  await expect.poll(async()=> (await image()).hash,{timeout:mode==='canvas-worker'?60000:15000}).not.toBe(beforeDrag.hash);
  const committedFrames=await page.locator('#map [data-visual-frame-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-visual-frame-id')));
  expect(new Set(committedFrames).size).toBe(1);
  expect((await image()).hash).not.toBe(beforeDrag.hash);
  await page.screenshot({path:test.info().outputPath(`temporal-${mode}.png`)});
  expect(errors).toEqual([]);
});
