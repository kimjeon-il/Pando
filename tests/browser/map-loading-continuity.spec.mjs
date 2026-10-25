import { expect, test } from '@playwright/test';

async function coloredMapPixels(page) {
  const clip=await page.locator('#map').boundingBox();
  const buffer=await page.screenshot({clip});
  return page.evaluate(async base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0);bitmap.close();const {data,width,height}=ctx.getImageData(0,0,canvas.width,canvas.height);
    let count=0;
    for(let y=100;y<height-60;y++)for(let x=0;x<width;x++){
      if(x>width*.27&&x<width*.73)continue; // Exclude the setup dialog and toast.
      const i=(y*width+x)*4;
      if(Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2])>40)count++;
    }
    return count;
  },buffer.toString('base64'));
}

test('new project keeps the old map through slow Core replacement and resize, then removes old objects',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let release,entered;const hold=new Promise(r=>release=r),arrival=new Promise(r=>entered=r);
  await page.route('**/__hold_new_baseline',async route=>{entered();await hold;if(!page.isClosed())await route.fulfill({body:'ok'});});
  await page.route('**/core-document-runtime.js*',async route=>{
    const source=await(await route.fetch()).text(),anchor="loadBaseline: (payload,context) => call('documentLoadBaseline'";
    expect(source).toContain(anchor);
    await route.fulfill({contentType:'text/javascript',body:source.replace(anchor,"loadBaseline: async (payload,context) => { await fetch('/__hold_new_baseline'); return call('documentLoadBaseline'").replace("[payload.baselineId,payload.setup],context,loadedResult),","[payload.baselineId,payload.setup],context,loadedResult); },")});
  });
  await page.route('**/modules/app-domain-assembly.js*',async route=>{
    const source=await(await route.fetch()).text();await route.fulfill({contentType:'text/javascript',body:source.replace('dependencies = ports;','dependencies = ports;window.__loadingDomain=()=>projectDomain;')});
  });
  try{
    await page.goto('/__editor/index.html?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:60000});
    const before=await coloredMapPixels(page);expect(before).toBeGreaterThan(10000);
    await page.locator('#newProjectBtn').evaluate(b=>b.click());
    await expect(page.locator('#projectSetupDialog')).toBeVisible();await page.locator('#projectSetupSubmit').click();
    await arrival;
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__.projectRenderBlocked)).toBe(true);
    expect(await coloredMapPixels(page)).toBeGreaterThan(before*.5);
    await page.setViewportSize({width:1280,height:820});
    expect(await coloredMapPixels(page)).toBeGreaterThan(10000);
    release();
    await expect(page.locator('#projectSetupDialog')).not.toBeVisible({timeout:20000});
    expect(await page.evaluate(()=>window.__loadingDomain().snapshot().territorialEntities.length)).toBeGreaterThan(200);
    await page.locator('#newProjectBtn').evaluate(b=>b.click());await page.locator('#projectSetupSource').selectOption('empty');await page.locator('#projectSetupSubmit').click();
    if(await page.locator('#confirmModal').isVisible())await page.locator('#confirmModalOkBtn').click();
    await expect(page.locator('#projectSetupDialog')).not.toBeVisible({timeout:20000});
    expect(await page.evaluate(()=>window.__loadingDomain().snapshot().territorialEntities.length)).toBe(0);
    expect(await coloredMapPixels(page)).toBeLessThan(1000);
    expect(errors).toEqual([]);
  }finally{release();}
});

test('initial land and ocean appear while country loading is held',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const hydroRequests=[];page.on('request',request=>{if(/\/hydro\/v[^/]+\/manifest\.json/.test(request.url()))hydroRequests.push(request.url());});
  let release,entered;const hold=new Promise(r=>release=r),arrival=new Promise(r=>entered=r);
  let releaseTiles;const tiles=new Promise(r=>releaseTiles=r);
  await page.route('**/*.webp*',async route=>{await tiles;if(!page.isClosed())await route.continue();});
  await page.route('**/__hold_builtin',async route=>{entered();await hold;if(!page.isClosed())await route.fulfill({body:'ok'});});
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const source=await(await route.fetch()).text(),anchor='startup:()=>open(()=>map.prepareBuiltinProject(),';
    expect(source).toContain(anchor);
    await route.fulfill({contentType:'text/javascript',body:source.replace(anchor,"startup:()=>open(async()=>{await fetch('/__hold_builtin');return map.prepareBuiltinProject();},")});
  });
  try{
    await page.goto('/?debug=1&demTerrain=raster');await arrival;
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().baseSceneDrawCount),{timeout:8000}).toBeGreaterThan(0);
    expect(await coloredMapPixels(page)).toBeGreaterThan(10000);
    const stats=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(stats.canonicalMeshReady).toBe(false);
    expect(stats.mapReadiness.status).toBe('boundaries');
    expect(await page.locator('#viewerStatus').getAttribute('data-ready')).toBe('false');
    expect(hydroRequests).toHaveLength(0);
    releaseTiles();
    release();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect.poll(()=>hydroRequests.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }finally{releaseTiles();release();}
});
