import {test,expect} from '@playwright/test';

test.use({viewport:{width:960,height:640},trace:'off'});

for (const mode of ['webgl','canvas','canvas-worker']) test(`temporal map holds its last complete ${mode} frame until its successor is presented`,async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
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
    await route.fulfill({response,body:source.replace(marker,"if (window.__temporalGate) await window.__temporalGate();\n"+marker)});
  });
  await page.route('**/modules/country-index.js*',async route=>{
    const response=await route.fetch(),source=await response.text();
    const marker='function scheduleCountryLabelAnchors(ids = null, delay = 30) {';
    expect(source).toContain(marker);
    await route.fulfill({response,body:source.replace(marker,marker+'\nwindow.__pendingCountryAnchors = () => pendingCountryLabelAnchors.size;')});
  });
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  try {
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status),{timeout:30000}).toMatch(/ready|limited/);
  } catch(error) {
    console.log('initial readiness',await page.evaluate(()=>{const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return {readiness:stats.mapReadiness,terrainReady:stats.terrainReady,terrainFailed:stats.terrainFailed,renderer:stats.renderer};}));throw error;
  }
  await page.waitForLoadState('networkidle');
  await expect.poll(()=>page.evaluate(()=>window.__pendingCountryAnchors?.()),{timeout:45000}).toBe(0);
  const image=async()=>{
    // Read the composited browser image, with the production WebGL context
    // options intact; do not enable preserveDrawingBuffer just for this test.
    const png=await page.locator('.gpu-map-canvas').screenshot({style:
      'body * {visibility:hidden!important} .gpu-map-canvas {visibility:visible!important}'});
    return page.evaluate(async encoded=>{
    const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+encoded)).blob());
    const snapshot=document.createElement('canvas');snapshot.width=bitmap.width;snapshot.height=bitmap.height;
    const context=snapshot.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
    const pixels=context.getImageData(0,0,snapshot.width,snapshot.height).data;
    let hash=2166136261;for(let i=0;i<pixels.length;i++)hash=Math.imul(hash^pixels[i],16777619);
    const previous=window.__temporalPixels;let different=0,maxDelta=0;
    if(previous&&previous.length===pixels.length)for(let i=0;i<pixels.length;i++){if(previous[i]!==pixels[i])different++;maxDelta=Math.max(maxDelta,Math.abs(previous[i]-pixels[i]));}
    if(!previous)window.__temporalPixels=pixels.slice();
    return {hash:hash>>>0,width:snapshot.width,height:snapshot.height,different,maxDelta};
    },png.toString('base64'));
  };
  const date=await page.locator('#timelineDateButtonText').textContent();
  await page.evaluate(()=>{window.__temporalHeld=[];window.__temporalGate=()=>new Promise((resolve,reject)=>window.__temporalHeld.push({resolve,reject}));});
  await page.locator('#timelineDateButton').click();
  await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill('1953');
  await page.locator('#timelineMonthInput').selectOption('6');
  const before=await image(),labels=await page.locator('#map').innerText();
  await page.screenshot({path:test.info().outputPath(`before-${mode}.png`)});
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length)).toBe(1);
  await expect(page.locator('#viewerStatus')).toHaveText('다음 시점 준비 중…');
  expect(await page.locator('#timelineDateButtonText').textContent()).toBe(date);
  const held=await image();console.log('temporal pixel comparison',JSON.stringify({before,held}));
  // Canvas alpha round-trips may differ by one byte at antialiased edges.
  // A partially replaced or cleared frame exceeds this bound immediately.
  if(mode==='webgl')expect(held.hash).toBe(before.hash);
  else expect(held.maxDelta).toBeLessThanOrEqual(1);
  expect(await page.locator('#map').innerText()).toBe(labels);
  await page.evaluate(()=>{window.__temporalGate=null;window.__temporalHeld.shift().resolve();});
  await expect(page.locator('#timelineDateButtonText')).toHaveText('1953년 6월',{timeout:60000});
  await expect(page.locator('#viewerStatus')).toBeHidden();
  expect((await image()).hash).not.toBe(before.hash);
  if(mode==='webgl'){
    await page.locator('#timelineDateButton').click();
    const committed=await image();
    await page.evaluate(()=>{window.__temporalGate=()=>{window.__temporalGate=null;return Promise.reject(new Error('controlled temporal preparation failure'));};});
    await page.locator('#timelineNextMonth').click();
    await expect(page.locator('#timelineDateError')).toContainText('controlled temporal preparation failure',{timeout:45000});
    expect(await page.locator('#timelineDateButtonText').textContent()).toBe('1953년 6월');
    expect((await image()).hash).toBe(committed.hash);
    await page.locator('#timelineMonthInput').selectOption('6');
    await page.evaluate(()=>{window.__temporalHeld=[];window.__temporalGate=()=>new Promise(resolve=>window.__temporalHeld.push({resolve}));});
    await page.locator('#timelineNextMonth').click();
    await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length)).toBe(1);
    await page.locator('#timelineNextMonth').click();
    await page.evaluate(()=>window.__temporalHeld.shift().resolve());
    await expect.poll(()=>page.evaluate(()=>window.__temporalHeld.length),{timeout:45000}).toBe(1);
    expect(await page.locator('#timelineDateButtonText').textContent()).toBe('1953년 6월');
    expect((await image()).hash).toBe(committed.hash);
    await page.evaluate(()=>{window.__temporalGate=null;window.__temporalHeld.shift().resolve();});
    await expect(page.locator('#timelineDateButtonText')).toHaveText('1953년 8월',{timeout:45000});
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month)).toBe('1953-08');
    await expect(page.locator('#viewerStatus')).toBeHidden();
    const preparation=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    await page.locator('#timelineGoBtn').click();
    await expect(page.locator('#timelinePopover')).toBeHidden({timeout:45000});
    const reused=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(reused.countryMeshRebuildCount||0).toBe(preparation.countryMeshRebuildCount||0);
    expect(reused.countryMeshReuseCount||0).toBeGreaterThan(preparation.countryMeshReuseCount||0);
  }
  await page.screenshot({path:test.info().outputPath(`temporal-${mode}.png`)});
  expect(errors).toEqual([]);
});
