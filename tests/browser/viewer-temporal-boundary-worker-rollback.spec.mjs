import {expect,test} from '@playwright/test';

// Regression for the W2-P5-2 timed-out error-injection probe. This test
// injects a real Worker-protocol error at the owned channel boundary, rather
// than polling __w2Current (overwritten by unrelated Worker messages).
// Shipping Viewer/Worker files remain unchanged; routes affect this page only.
test.use({viewport:{width:1280,height:800},deviceScaleFactor:1,trace:'off'});

async function currentMap(page) {
  return page.evaluate(async()=>{
    const viewer=globalThis.__PANDOLAB_VIEWER__;
    const d=viewer.documentSnapshot(),stats=viewer.rendererStats();
    const labels=[...document.querySelectorAll('svg text')].map(element=>[
      element.textContent,element.getAttribute('x'),element.getAttribute('y'),
      element.parentElement?.getAttribute('transform'),
    ]).sort();
    const records={
      entities:d.territorialEntities,geometries:d.geometries,
      timeline:d.timelineRecords,labels,
      paths:[...document.querySelectorAll('#viewerLabels path')].map(e=>e.getAttribute('d')).sort(),
    };
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(records))))]
      .map(byte=>byte.toString(16).padStart(2,'0')).join('');
    return {
      month:viewer.builtinMonth().month,cursor:viewer.documentState().timelineCursor,
      documentId:d.documentId,hash,ready:document.querySelector('#viewerStatus')?.dataset.ready,
      generation:stats.projectGeneration,canonicalMeshReady:stats.canonicalMeshReady,
      boundaryReady:stats.countrySharedBoundaryReady,
      blocked:stats.projectRenderBlocked,countriesPublishedGeneration:stats.countriesPublishedGeneration,
    };
  });
}

test('matching boundary Worker protocol error rolls back the dated Core document and restores a certified frame',async({page},info)=>{
  test.setTimeout(240000);
  await page.clock.setFixedTime(new Date(2026,10,2,12));
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>{
    const NativeWorker=globalThis.Worker;
    globalThis.__W5Rollback={targetGeneration:null,events:[],fired:0};
    class FaultInjectedBoundaryWorker extends NativeWorker {
      constructor(url,options){
        super(url,options);
        this.__w5Boundary=options?.name==='pandolab-country-shared-boundary';
      }
      postMessage(data,transfer){
        const probe=globalThis.__W5Rollback;
        if(this.__w5Boundary && Number.isInteger(probe?.targetGeneration)
           && data?.projectGeneration===probe.targetGeneration
           && (data.type==='replace'||data.type==='patch') && data.features?.length>0){
          // The original latest-request metadata is used unchanged. Refuse
          // to deliver a real prepared packet for the deliberately failed
          // generation, and send exactly one matching Worker error.
          if(probe.fired++)throw Error('Duplicate error injection for the same new generation');
          const fault={type:'error',requestId:data.requestId,
            projectGeneration:data.projectGeneration,geometryRevision:data.geometryRevision,
            quality:data.quality,message:'W5_CONTROLLED_BOUNDARY_ERROR'};
          probe.events.push({stage:'worker-request-intercepted',...fault,features:data.features.length});
          queueMicrotask(()=>{
            probe.events.push({stage:'worker-error-dispatched',...fault});
            this.dispatchEvent(new MessageEvent('message',{data:fault}));
          });
          return;
        }
        return super.postMessage(data,transfer);
      }
    }
    globalThis.Worker=FaultInjectedBoundaryWorker;
  });
  let routeCount=0;
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    const force='      const boundaryFeatures = renderCountryBoundaryFeatures();';
    const receipt='          countryBoundaryLastMessage = ';
    if(source.split(force).length!==2||source.split(receipt).length!==2)
      throw Error('W2-P5 rollback test ports changed; inspect renderer source');
    source=source.replace(force,
      "      if(globalThis.__W5Rollback?.targetGeneration===projectGeneration){\n"+
      "        globalThis.__W5Rollback.events.push({stage:'force-new-generation-boundary',generation:projectGeneration});\n"+
      "        countryBoundaryDependencies=null;\n"+
      "      }\n"+force);
    source=source.replace(receipt,
      "          globalThis.__W5Rollback?.events.push({stage:'renderer-received',"+
      "type:data?.type,requestId:data?.requestId,projectGeneration:data?.projectGeneration,"+
      "geometryRevision:data?.geometryRevision,quality:data?.quality,message:data?.message});\n"+receipt);
    routeCount++;
    await route.fulfill({response,contentType:'text/javascript',body:source});
  });
  await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:120000});
  await expect.poll(()=>page.evaluate(()=>
    globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.countrySharedBoundaryReady),
  {timeout:120000}).toBe(true);
  expect(routeCount).toBe(1);
  const before=await currentMap(page);
  expect(before.ready).toBe('true');
  expect(before.boundaryReady).toBe(true);
  const targetGeneration=before.generation+1;
  await page.evaluate(generation=>{globalThis.__W5Rollback.targetGeneration=generation;},targetGeneration);
  const beforePicture=await page.locator('#viewerCanvas').screenshot({animations:'disabled'});
  let after,afterRetry;
  try{
    await page.locator('#timelinePreviousYear').click({timeout:30000});
    await expect.poll(()=>page.evaluate(()=>globalThis.__W5Rollback.events.some(event=>
      event.stage==='worker-request-intercepted')), {timeout:90000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>globalThis.__W5Rollback.events.some(event=>
      event.stage==='renderer-received'&&event.type==='error'&&
      event.message==='W5_CONTROLLED_BOUNDARY_ERROR')), {timeout:90000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>document.querySelector('#timelineDateError')?.textContent||''),
      {timeout:90000}).toContain('W5_CONTROLLED_BOUNDARY_ERROR');
    // Wait for the generation-monotonic Core rollback and a *newly*
    // certified frame. Merely observing the old month before rollback is
    // not sufficient.
    await expect.poll(async()=>{
      const result=await currentMap(page);
      return result.generation>targetGeneration && result.ready==='true' &&
        result.boundaryReady && result.canonicalMeshReady &&
        !result.blocked && result.countriesPublishedGeneration===result.generation;
    },{timeout:120000}).toBe(true);
    after=await currentMap(page);
    expect(after.month).toBe(before.month);
    expect(after.cursor).toBe(before.cursor);
    expect(after.documentId).toBe(before.documentId);
    expect(after.hash,'rollback must restore the prior authoritative country/label/timeline state').toBe(before.hash);
    const afterPicture=await page.locator('#viewerCanvas').screenshot({animations:'disabled'});
    const pictureCompare=await page.evaluate(async({beforeB64,afterB64})=>{
      async function pixels(base64){
        const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
        const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
        const canvas=document.createElement('canvas');
        canvas.width=bitmap.width;canvas.height=bitmap.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0);bitmap.close();
        return{width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
      }
      const a=await pixels(beforeB64),b=await pixels(afterB64);
      if(a.width!==b.width||a.height!==b.height)throw Error('Rollback canvas dimensions changed');
      let different=0;
      for(let offset=0;offset<a.data.length;offset+=4){
        if(a.data[offset]!==b.data[offset]||a.data[offset+1]!==b.data[offset+1]||
           a.data[offset+2]!==b.data[offset+2]||a.data[offset+3]!==b.data[offset+3])different++;
      }
      return{width:a.width,height:a.height,differentPixels:different};
    },{beforeB64:beforePicture.toString('base64'),afterB64:afterPicture.toString('base64')});
    expect(pictureCompare.differentPixels,'a failed date switch must preserve its previous map pixels').toBe(0);
    await info.attach('w2-p5-rollback-canvas-before',{body:beforePicture,contentType:'image/png'});
    await info.attach('w2-p5-rollback-canvas-after',{body:afterPicture,contentType:'image/png'});
    // The fault is armed only for one generation. After rollback, retry the
    // same year switch without a reload and demand a real new dated frame.
    await page.locator('#timelinePreviousYear').click({timeout:30000});
    const target=String(Number(before.month.slice(0,4))-1)+'-12';
    await expect.poll(async()=>{
      const result=await currentMap(page);
      return result.month===target&&result.cursor===target&&
        result.ready==='true'&&result.boundaryReady&&result.canonicalMeshReady&&
        !result.blocked&&result.countriesPublishedGeneration===result.generation;
    },{timeout:120000}).toBe(true);
    afterRetry=await currentMap(page);
    expect(afterRetry.hash).not.toBe(before.hash);
    expect(await page.evaluate(()=>globalThis.__W5Rollback.fired)).toBe(1);
    expect(errors).toEqual([]);
    console.log('W5_BOUNDARY_ROLLBACK_PASS '+JSON.stringify({
      initial:before,rolledBack:after,retried:afterRetry,
      pixelDifference:pictureCompare.differentPixels,
      events:await page.evaluate(()=>globalThis.__W5Rollback.events),
    }).slice(0,16000));
  }finally{
    await info.attach('w2-p5-rollback-observations',{
      body:JSON.stringify({before,after,afterRetry,errors,
        events:await page.evaluate(()=>globalThis.__W5Rollback.events)},null,2),
      contentType:'application/json'});
  }
});
