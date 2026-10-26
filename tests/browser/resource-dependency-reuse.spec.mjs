import {test,expect} from '@playwright/test';

const stats=page=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
async function month(page,value){
  const [year,month]=value.split('-');
  await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill(year);
  await page.locator('#timelineMonthInput').selectOption(String(Number(month)));
  await page.locator('#timelineGoBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.builtinMonth().month),{timeout:60000}).toBe(value);
  await expect.poll(async()=>{const s=await stats(page);return s.countriesPublishedGeneration===s.projectGeneration;}).toBe(true);
}

for(const renderer of ['webgl2','canvas'])test(`${renderer}: unchanged date queries retain prepared resources`,async({page},info)=>{
  test.setTimeout(120000);
  const errors=[],workers=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('worker',w=>workers.push(w.url()));
  page.on('request',r=>{if(r.url().includes('/assets/data/'))requests.push(r.url());});
  await page.addInitScript(()=>{
    window.__resourceLargeBufferUploads=0;
    for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
      if(!type)continue;
      const original=type.prototype.bufferData;
      type.prototype.bufferData=function(target,data,...args){
        if((typeof data==='number'?data:data?.byteLength)>=256*1024)window.__resourceLargeBufferUploads++;
        return original.call(this,target,data,...args);
      };
    }
  });
  await page.goto(`/?debug=1&renderer=${renderer}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
  await page.evaluate(()=>{const h=window.__PANDOLAB_MAP_HOST__;h.setViewState({projection:'globe',view:{...h.getViewState(),globeRotation:[-24.6,-38.5,0],globeZoom:5}});h.requestRepaint('dependency-regression');});
  await expect.poll(async()=>(await stats(page)).hydroPacksLoaded,{timeout:30000}).toBeGreaterThan(0);
  await month(page,'2026-09');
  await expect.poll(async()=>(await stats(page)).countrySharedBoundaryReady,{timeout:30000}).toBe(true);
  if(renderer==='webgl2'){
    await expect.poll(async()=>(await stats(page)).terrainTilesLoading).toBe(0);
    await expect.poll(async()=>(await stats(page)).terrainPendingDecodedBytes).toBe(0);
    await expect.poll(async()=>(await stats(page)).hydroPendingUploadCount).toBe(0);
  }
  const before=await stats(page),requestCount=requests.length,workerCount=workers.length;
  const uploads=await page.evaluate(()=>window.__resourceLargeBufferUploads);
  await month(page,'2026-10');
  await month(page,'2026-09');
  const after=await stats(page);
  expect(after.renderer).toBe(renderer==='canvas'?'canvas-worker':renderer);
  expect(after.countryMeshRebuildCount).toBe(before.countryMeshRebuildCount);
  expect(after.countryBoundaryPrepareCount).toBe(before.countryBoundaryPrepareCount);
  expect(after.hydroUploadBytes).toBe(before.hydroUploadBytes);
  expect(after.hydroPacksLoaded).toBe(before.hydroPacksLoaded);
  expect(after.terrainUploadCount).toBe(before.terrainUploadCount);
  expect(workers.slice(workerCount)).toEqual([]);
  expect(requests.slice(requestCount)).toEqual([]);
  expect(await page.evaluate(()=>window.__resourceLargeBufferUploads)).toBe(uploads);
  if(renderer==='webgl2'){
    await page.evaluate(()=>{window.__resourceContext=document.querySelector('#viewerCanvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__resourceContext.loseContext();});
    await expect.poll(async()=>(await stats(page)).webglContextLost).toBe(true);
    await page.evaluate(()=>window.__resourceContext.restoreContext());
    await expect.poll(async()=>(await stats(page)).webglContextLost,{timeout:30000}).toBe(false);
    await expect.poll(async()=>{const s=await stats(page);return s.countriesPublishedGeneration===s.projectGeneration;},{timeout:30000}).toBe(true);
    await expect.poll(async()=>(await stats(page)).terrainTilesLoading).toBe(0);
    await expect.poll(async()=>(await stats(page)).terrainPendingDecodedBytes).toBe(0);
    await expect.poll(async()=>(await stats(page)).hydroPendingUploadCount).toBe(0);
    const restoredUploads=await page.evaluate(()=>window.__resourceLargeBufferUploads);
    expect(restoredUploads).toBeGreaterThan(uploads);
    await month(page,'2026-10');
    expect(await page.evaluate(()=>window.__resourceLargeBufferUploads)).toBe(restoredUploads);
  }
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('date-reuse.png')});
  console.log(JSON.stringify({renderer,before:{mesh:before.countryMeshRebuildCount,boundary:before.countryBoundaryPrepareCount,hydro:before.hydroUploadBytes,terrain:before.terrainUploadCount},after:{mesh:after.countryMeshRebuildCount,boundary:after.countryBoundaryPrepareCount,hydro:after.hydroUploadBytes,terrain:after.terrainUploadCount},additionalRequests:requests.length-requestCount,additionalWorkers:workers.length-workerCount}));
});
