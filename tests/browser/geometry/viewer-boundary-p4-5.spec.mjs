import { test as featureTest } from '@playwright/test';
featureTest.use({trace:'off'});
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "@playwright/test";
import * as __suiteDependency2 from "@playwright/test";
import * as __suiteDependency3 from "@playwright/test";
import * as __suiteDependency4 from "node:fs/promises";
import * as __suiteDependency5 from "node:path";

// Preserved Viewer feature contract: viewer-boundary-p4-5.spec.mjs
featureTest.describe("viewer-boundary-p4-5", () => {
  const { test,expect } = __suiteDependency0;
test.use({viewport:{width:1280,height:800}});
test('P4-5 real viewer WebGL boundary Worker presents prepared shared borders',async({page})=>{
  test.setTimeout(130000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{
    if(message.type()==='error'&&message.text().includes('PL-COUNTRY-BOUNDARY'))
      errors.push(message.text());
  });
  await page.goto('/?renderer=webgl2&demTerrain=raster&debug=1');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:105000});
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats()||{});
  try {
    await expect.poll(async()=>(await stats()).countrySharedBoundarySegmentCount||0,
      {timeout:20000}).toBeGreaterThan(100);
  } catch(error){
    console.log('P4_5_VIEWER_BOUNDARY_DIAG',JSON.stringify(await page.evaluate(()=>{
      const r=window.__PANDOLAB_VIEWER__?.rendererStats()||{};
      return {renderer:r.renderer,quality:r.activeMeshQuality,ready:r.mapReadiness,
        boundaryReady:r.countrySharedBoundaryReady,boundaryCount:r.countrySharedBoundarySegmentCount,
        worker:r.countrySharedBoundaryWorkerActive,lastWorkerMessage:r.countrySharedBoundaryLastMessage,
        pending:r.countrySharedBoundaryReplacementPending,boundaryRequests:r.countrySharedBoundaryRequestId,
        generation:r.projectGeneration,countries:r.countriesPublishedGeneration,
        contextLost:r.webglContextLost};
    })),errors);
    throw error;
  }
  const first=await stats();
  expect(first.renderer).toMatch(/webgl/);
  expect(first.countrySharedBoundaryReady).toBe(true);
  // A verified prepared boundary asset may publish the same packet without starting a Worker.
  // Preserve the public segment/geometry assertions; do not demand a particular backend.
  expect(first.countrySharedBoundaryWorkerActive || first.countryBoundaryPreparedAssetCount > 0).toBe(true);
  expect(first.countrySharedBoundaryReplacementPending).toBe(false);
  const baseline=first.countrySharedBoundarySegmentCount;
  await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__?.requestRepaint?.('p4-5-boundary-repaint'));
  await expect.poll(async()=>(await stats()).countrySharedBoundarySegmentCount,{timeout:15000})
    .toBe(baseline);
  expect(errors).toEqual([]);
});
});
// Preserved Viewer feature contract: korean-boundaries.spec.mjs
featureTest.describe("korean-boundaries", () => {
  const { expect,test } = __suiteDependency1;
test.use({viewport:{width:1440,height:900}});
test('public Viewer opens pinned Korean map data without invalid historical records',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?debug=1&demTerrain=raster');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  const snapshot=await page.evaluate(async()=>{
    const viewer=window.__PANDOLAB_VIEWER__;
    const timeline=viewer.documentSnapshot().timelineRecords;
    const response=await fetch('assets/data/builtin-world/generated/v1/index.json');
    if(!response.ok)throw Error('Builtin country index is unavailable');
    const index=await response.json();
    return {month:viewer.builtinMonth().month, lifetimes:timeline.lifetimes
      .filter(row=>row.objectRef?.domain==='territorial'&&['KOR','PRK'].includes(row.objectRef.id))
      .map(({objectRef,validFrom,validTo})=>({entityId:objectRef.id,validFrom,validTo})),
    coverage:index.entities.filter(row=>['KOR','PRK'].includes(row.entityId))
      .map(({entityId,coverage})=>({entityId,coverage}))};
  });
  expect(snapshot.month).toMatch(/^\d{4}-\d{2}$/);
  expect(snapshot.lifetimes).toHaveLength(2);
  expect(snapshot.lifetimes).toEqual(expect.arrayContaining([
    {entityId:'KOR',validFrom:'1948-08-15',validTo:null},
    {entityId:'PRK',validFrom:'1948-09-09',validTo:null},
  ]));
  expect(snapshot.coverage).toHaveLength(2);
  expect(snapshot.coverage).toEqual(expect.arrayContaining([
    {entityId:'KOR',coverage:[{validFrom:'1948-08-15',validTo:null}]},
    {entityId:'PRK',coverage:[{validFrom:'1948-09-09',validTo:null}]},
  ]));
  expect(errors).toEqual([]);
});
});
// Preserved Viewer feature contract: viewer-temporal-boundary-worker-rollback.spec.mjs
featureTest.describe("viewer-temporal-boundary-worker-rollback", () => {
  const { expect,test } = __suiteDependency2;
// Regression for the W2-P5-2 timed-out error-injection probe. This test
// injects a real Worker-protocol error at the owned channel boundary, rather
// than polling __w2Current (overwritten by unrelated Worker messages).
// Shipping Viewer/Worker files remain unchanged; routes affect this page only.
test.use({viewport:{width:1280,height:800},deviceScaleFactor:1});

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
    const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify(value))))]
      .map(byte=>byte.toString(16).padStart(2,'0')).join('');
    const parts=Object.fromEntries(await Promise.all(Object.entries(records).map(async([kind,value])=>[
      kind,{sha:await digest(value),count:Array.isArray(value)?value.length:Object.keys(value||{}).length},
    ])));
    const hash=await digest(records);
    return {
      month:viewer.builtinMonth().month,cursor:viewer.documentState().timelineCursor,
      documentId:d.documentId,hash,parts,ready:document.querySelector('#viewerStatus')?.dataset.ready,
      generation:stats.projectGeneration,canonicalMeshReady:stats.canonicalMeshReady,
      boundaryReady:stats.countrySharedBoundaryReady,
      blocked:stats.projectRenderBlocked,countriesPublishedGeneration:stats.countriesPublishedGeneration,
    };
  });
}

// Renderer readiness can precede asynchronous SVG label hydration. Verify the
// fully revealed initial map and a stable label snapshot before taking the
// authoritative rollback reference; do not weaken the exact hash/pixel checks.
async function settledMap(page) {
  const deadline=Date.now()+30000;
  let previous='', stableSince=0, last=null;
  while(Date.now()<deadline) {
    const ready=await page.evaluate(()=>{
      const root=document.querySelector('#viewer');
      return {presented:globalThis.__PANDOLAB_VIEWER__?.initialMapPresented()===true,
        loading:root?.dataset.initialLoading,
        reveal:root?.dataset.initialReveal};
    });
    const current=await currentMap(page);
    const stableKey=current.parts.labels.sha+':'+current.parts.paths.sha;
    const complete=ready.presented&&ready.loading==='false'
      &&current.parts.labels.count>0&&current.ready==='true'&&current.boundaryReady;
    if(complete&&stableKey===previous) {
      if(Date.now()-stableSince>=1200)return current;
    } else {
      previous=complete?stableKey:'';
      stableSince=Date.now();
    }
    last={ready,labels:current.parts.labels,count:current.parts.labels.count};
    await page.waitForTimeout(200);
  }
  throw new Error('Viewer labels did not settle before rollback comparison: '+JSON.stringify(last));
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
           && (['replace','patch','delta'].includes(data.type)) && data.features?.length>0){
          // The original latest-request metadata is used unchanged. Refuse
          // to deliver a real prepared packet for the deliberately failed
          // generation, and send exactly one matching Worker error.
          if(probe.fired===0){
            probe.fired=1;
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
          probe.events.push({stage:'later-request-forwarded',requestId:data.requestId,
            projectGeneration:data.projectGeneration,geometryRevision:data.geometryRevision});
        }
        return super.postMessage(data,transfer);
      }
    }
    globalThis.Worker=FaultInjectedBoundaryWorker;
  });
  let routeCount=0;
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    const force='      const canonicalBoundaryFeatures=renderCountryBoundaryFeatures();';
    const receipt='          countryBoundaryLastMessage = ';
    if(source.split(force).length!==2||source.split(receipt).length!==2)
      throw Error('W2-P5 rollback test ports changed; inspect renderer source');
    source=source.replace(force,
      "      if(globalThis.__W5Rollback?.targetGeneration===projectGeneration && !globalThis.__W5Rollback.forceDone){\n"+
      "        globalThis.__W5Rollback.forceDone=true;\n"+
      "        globalThis.__W5Rollback.events.push({stage:'force-new-generation-boundary',generation:projectGeneration});\n"+
      "        countryBoundaryDependencies=null;\n"+
      "        builtinPreparedBoundary=null;\n"+
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
  if(process.env.PANDOLAB_W5_REQUIRE_GTX1650==='1'){
    const browser=page.context().browser();
    const session=await browser.newBrowserCDPSession();
    try{
      const gpu=(await session.send('SystemInfo.getInfo')).gpu;
      const version=browser.version();
      const identity=await page.evaluate(()=>{
        const canvas=document.querySelector('#viewerCanvas'),gl=canvas?.getContext('webgl2');
        const unmasked=gl?.getExtension('WEBGL_debug_renderer_info');
        return{renderer:gl?.getParameter(unmasked.UNMASKED_RENDERER_WEBGL),
          version:gl?.getParameter(gl.VERSION),width:canvas?.width,height:canvas?.height,
          dpr:globalThis.devicePixelRatio,build:globalThis.PANDOLAB_BUILD_META};
      });
      expect(version).toBe('151.0.7922.34');
      expect(gpu.devices.some(device=>device.deviceString==='NVIDIA GeForce GTX 1650'
        &&device.driverVersion==='32.0.16.1088')).toBe(true);
      expect(gpu.featureStatus.gpu_compositing).toBe('enabled');
      expect(identity.renderer).toMatch(/NVIDIA.*Direct3D11/);
      expect(identity.version).toContain('WebGL 2.0');
      expect([identity.width,identity.height,identity.dpr]).toEqual([1280,752,1]);
      expect(identity.build.sourceCommit).toBe('fe8282ba32761ab9586348d1712e11cc1f4e7882');
      expect(identity.build.dataRevision).toBe('data-f50b7f480c812df6f5ea0c40f5461ab0');
      await info.attach('w2-p5-worker-rollback-verified-gtx1650',
        {body:JSON.stringify({version,gpu,identity},null,2),contentType:'application/json'});
    }finally{await session.detach();}
  }
  const before=await settledMap(page);
  expect(before.ready).toBe('true');
  expect(before.boundaryReady).toBe(true);
  const targetGeneration=before.generation+1;
  await page.evaluate(generation=>{globalThis.__W5Rollback.targetGeneration=generation;},targetGeneration);
  // Screenshot only the GPU canvas: alert toasts and the timeline form are
  // expected UI differences after failure, not changes to rendered map pixels.
  const mapCaptureStyle='body * {visibility:hidden!important} #viewerCanvas {visibility:visible!important}';
  const beforePicture=await page.locator('#viewerCanvas').screenshot({animations:'disabled',style:mapCaptureStyle});
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
    after=await settledMap(page);
    expect(after.month).toBe(before.month);
    expect(after.cursor).toBe(before.cursor);
    expect(after.documentId).toBe(before.documentId);
    console.log('W5_ROLLBACK_SEMANTIC_COMPARISON '+JSON.stringify({before,after,
      events:await page.evaluate(()=>globalThis.__W5Rollback.events)}).slice(0,16000));
    expect(after.hash,'rollback must restore the prior authoritative country/label/timeline state').toBe(before.hash);
    const afterPicture=await page.locator('#viewerCanvas').screenshot({animations:'disabled',style:mapCaptureStyle});
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
    await info.attach('w2-p5-rollback-canvas-before',{body:beforePicture,contentType:'image/png'});
    await info.attach('w2-p5-rollback-canvas-after',{body:afterPicture,contentType:'image/png'});
    console.log('W5_ROLLBACK_MAP_PIXEL_DIFFERENCE '+JSON.stringify(pictureCompare));
    expect(pictureCompare.differentPixels,'a failed date switch must preserve its previous map pixels').toBe(0);
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
    console.log('BOUNDARY_ROLLBACK_FAILURE_DIAGNOSTIC '+JSON.stringify(await page.evaluate(()=>({
      probe:globalThis.__W5Rollback,stats:globalThis.__PANDOLAB_VIEWER__?.rendererStats(),
      errorText:document.querySelector('#timelineDateError')?.textContent
    }))).slice(0,14000));
    await info.attach('w2-p5-rollback-observations',{
      body:JSON.stringify({before,after,afterRetry,errors,
        events:await page.evaluate(()=>globalThis.__W5Rollback.events)},null,2),
      contentType:'application/json'});
  }
});
});
// Preserved Viewer feature contract: viewer-w2-p3-packet-reuse.spec.mjs
featureTest.describe("viewer-w2-p3-packet-reuse", () => {
  const { test,expect } = __suiteDependency3;
  const { writeFile } = __suiteDependency4;
  const { join } = __suiteDependency5;
test.use({viewport:{width:1280,height:800}});

test('W2-P3 real Viewer reuses attached Worker packet copies for identical dated boundaries',async({page},info)=>{
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{globalThis.__W2P3_PACKETS__=[];globalThis.__W2P6_ACCEPTED__=[];});
  await page.addInitScript(()=>{
    globalThis.__W2P6_TRANSPORT__=[];
    const NativeWorker=globalThis.Worker;
    globalThis.Worker=class BoundaryTransportObservedWorker extends NativeWorker {
      constructor(url,options){
        super(url,options);
        this.__boundary=options?.name==='pandolab-country-shared-boundary';
      }
      postMessage(data,transfer){
        if(this.__boundary && data?.type==='delta' && globalThis.__W2P6_CORRUPT_NEXT__){
          globalThis.__W2P6_CORRUPT_NEXT__=false;
          data={...data,baseToken:'integration-deliberately-invalid-base'};
        }
        if(this.__boundary && ['replace','delta'].includes(data?.type)){
          const total=data.features?.length||0;
          const included=(data.features||[]).filter(row=>Object.hasOwn(row,'geometry')).length;
          globalThis.__W2P6_TRANSPORT__.push({type:data.type,requestId:data.requestId,
            generation:data.projectGeneration,quality:data.quality,total,included,omitted:total-included,
            removed:(data.removedIds||[]).length,hasBaseToken:typeof data.baseToken==='string'});
        }
        return super.postMessage(data,transfer);
      }
    };
  });
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch();let src=await response.text();
    const marker='if (Number(data?.requestId) !== countryBoundaryRequestId';
    if(src.split(marker).length!==2)throw Error('W2-P3 GPU renderer boundary response port changed');
    src=src.replace(marker,[
      'globalThis.__W2P3_PACKETS__.push({',
      'kind:data?.type,requestId:data?.requestId,projectGeneration:data?.projectGeneration,',
      'geometryRevision:data?.geometryRevision,quality:data?.quality,',
      'packetCacheHit:data?.packetCacheHit??null,packetPreparationMs:data?.packetPreparationMs??null,',
      'packetCacheResidentEstimate:data?.packetCacheResidentEstimate??null,',
      'segments:data?.packet?.segments?.length??0,receivedAt:performance.now()',
      '});',
      marker
    ].join('\n          '));
    const acceptedPort="          if (data.type !== 'prepared' || !countryBoundaryTask) return;";
    if(src.split(acceptedPort).length!==2)throw Error('Boundary acceptance port changed');
    src=src.replace(acceptedPort,acceptedPort+'\n          globalThis.__W2P6_ACCEPTED__.push(data.requestId);');
    const diagnosticPort='    function syncCountryBoundaryScene() {\n      prepareCountrySharedBoundary({ replace: true, baselineCache: false });\n    }';
    if(src.split(diagnosticPort).length!==2)throw Error('Boundary diagnostic port changed');
    src=src.replace(diagnosticPort,diagnosticPort+
      '\n    // Test-only: demand the same exact authoritative full input without altering it.\n'+
      '    globalThis.__W2P3_REPREPARE__ = (resetTransport = false) => {\n'+
      '      countryBoundaryDependencies = null;\n'+
      '      builtinPreparedBoundary = null;\n'+
      '      countryBoundaryTask = null;\n'+
      '      if (resetTransport) countryBoundaryGeometryTransport.reset();\n'+
      '      prepareCountrySharedBoundary({ replace: true, baselineCache: false });\n'+
      '      return countryBoundaryRequestId;\n'+
      '    };');
    await route.fulfill({response,body:src});
  });
  const ready=async month=>{
    await expect.poll(()=>page.evaluate(()=>({
      month:globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month,
      cursor:globalThis.__PANDOLAB_VIEWER__?.documentState()?.timelineCursor,
      ready:document.getElementById('viewerStatus')?.dataset.ready
    })),{timeout:95000}).toEqual({month,cursor:month,ready:'true'});
    await expect.poll(()=>page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.countrySharedBoundaryReady),
      {timeout:25000}).toBe(true);
  };
  await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:105000});
  const initial=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.builtinMonth()?.month);
  expect(initial).toMatch(/^\d{4}-\d{2}$/);
  const previous=String(Number(initial.slice(0,4))-1)+'-12';
  const records=[];
  try{
    for(const [target,selector] of [[previous,'#timelinePreviousYear'],[initial,'#timelineNextYear']]){
      await page.locator(selector).click();
      await ready(target);
      const row=await page.evaluate(()=>({
        month:globalThis.__PANDOLAB_VIEWER__.builtinMonth().month,
        stats:(()=>{
          const r=globalThis.__PANDOLAB_VIEWER__.rendererStats();
          return {countrySharedBoundaryReady:r.countrySharedBoundaryReady,
            countryBoundaryReplacementPending:r.countrySharedBoundaryReplacementPending,
            countrySharedBoundarySegmentCount:r.countrySharedBoundarySegmentCount,
            currentGeneration:r.projectGeneration};
        })(),
        packets:globalThis.__W2P3_PACKETS__.map(packet=>({...packet}))
      }));
      expect(row.stats.countrySharedBoundaryReady).toBe(true);
      expect(row.stats.countryBoundaryReplacementPending).toBe(false);
      expect(row.stats.countrySharedBoundarySegmentCount).toBeGreaterThan(100);
      records.push(row);
    }
    console.log('W2_P3_REAL_PACKET_CACHE '+JSON.stringify({initial,previous,records}).slice(0,13000));
    let all=records.at(-1).packets.filter(p=>p.kind==='prepared');
    const currentGeneration=records.at(-1).stats.currentGeneration;
    const expectedSegments=records.at(-1).stats.countrySharedBoundarySegmentCount;
    // A verified prepared scene can bypass full Worker construction. A cache
    // test must first establish and observe a genuine acknowledged Worker base.
    if (!all.some(p=>p.packetCacheHit===false&&p.segments===expectedSegments)) {
      const seedId=await page.evaluate(()=>globalThis.__W2P3_REPREPARE__(true));
      await expect.poll(()=>page.evaluate(({seedId,expectedSegments})=>globalThis.__W2P3_PACKETS__
        .some(p=>p.kind==='prepared'&&p.requestId===seedId&&p.segments===expectedSegments),
      {seedId,expectedSegments}),{timeout:90000}).toBe(true);
      const seed=await page.evaluate(id=>globalThis.__W2P6_TRANSPORT__.find(p=>p.requestId===id),seedId);
      expect(seed?.type,'a full Worker transport must seed the cache').toBe('replace');
      all=await page.evaluate(()=>globalThis.__W2P3_PACKETS__.filter(p=>p.kind==='prepared'));
    }
    // Normal date changes may correctly reuse the already certified renderer
    // packet. Verify a real Worker hit only after a controlled full seed.
    const beforeReprepare=all.length;
    const forcedId=await page.evaluate(()=>globalThis.__W2P3_REPREPARE__());
    await expect.poll(()=>page.evaluate(id=>globalThis.__W2P3_PACKETS__
      .filter(p=>p.kind==='prepared'&&p.requestId===id).length,forcedId),{timeout:60000}).toBe(1);
    await expect.poll(()=>page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__?.rendererStats()?.countrySharedBoundaryReady),
      {timeout:25000}).toBe(true);
    const final=await page.evaluate(()=>({
      packets:globalThis.__W2P3_PACKETS__.map(row=>({...row})),
      stats:globalThis.__PANDOLAB_VIEWER__.rendererStats()
    }));
    const forced=final.packets.find(p=>p.kind==='prepared'&&p.requestId===forcedId);
    expect(forced).toMatchObject({packetCacheHit:true,projectGeneration:currentGeneration,
      segments:expectedSegments});
    const transport=await page.evaluate(()=>globalThis.__W2P6_TRANSPORT__.map(row=>({...row})));
    const forcedInput=transport.find(row=>row.requestId===forcedId);
    expect(forcedInput?.type,'a certified Worker base must permit a changed-only resend').toBe('delta');
    expect(forcedInput?.hasBaseToken).toBe(true);
    expect(forcedInput?.omitted,'same immutable dated geometry should avoid cloning its coordinates').toBeGreaterThan(0);
    expect(forcedInput.total).toBe(forcedInput.included+forcedInput.omitted);
    expect(final.stats.countryBoundaryDeltaCount).toBeGreaterThanOrEqual(1);
    console.log('W2_P6_3_REAL_VIEWER_TRANSPORT '+JSON.stringify({forcedInput,transport,
      deltaCount:final.stats.countryBoundaryDeltaCount,
      reusedGeometry:final.stats.countryBoundaryReusedGeometryCount}));
    expect(forced.packetCacheResidentEstimate).toBeGreaterThan(0);
    const firstFull=all.find(p=>p.packetCacheHit===false&&p.segments===expectedSegments);
    expect(firstFull,'at least one actual full-world packet computation is required').toBeTruthy();
    expect(firstFull.packetPreparationMs).toBeGreaterThan(forced.packetPreparationMs);
    console.log('W2_P3_PACKET_PREPARATION_COST '+JSON.stringify({
      fullWorldMs:firstFull.packetPreparationMs,reusedMs:forced.packetPreparationMs,
      estimatedRetainedBytes:forced.packetCacheResidentEstimate,segments:expectedSegments
    }));
    expect(final.stats.countrySharedBoundarySegmentCount).toBe(expectedSegments);
    expect(final.stats.countrySharedBoundaryReplacementPending).toBe(false);
    expect(final.packets.filter(p=>p.kind==='prepared')).toHaveLength(beforeReprepare+1);
    expect(errors).toEqual([]);
    console.log('W2_P3_REAL_REPREPARE '+JSON.stringify({
      initial,previous,forced,baseline:all,finalSegments:final.stats.countrySharedBoundarySegmentCount
    }).slice(0,13000));
    const semantic=()=>page.evaluate(async()=>{
      const d=globalThis.__PANDOLAB_VIEWER__.documentSnapshot();
      const bytes=new TextEncoder().encode(JSON.stringify({entities:d.territorialEntities,
        geometries:d.geometries,timeline:d.timelineRecords}));
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
        .map(x=>x.toString(16).padStart(2,'0')).join('');
    });
    const beforeResync={hash:await semantic(),pixels:await page.locator('#viewerCanvas').screenshot()};
    const invalidId=await page.evaluate(()=>{
      globalThis.__W2P6_CORRUPT_NEXT__=true;
      return globalThis.__W2P3_REPREPARE__();
    });
    await expect.poll(()=>page.evaluate(id=>globalThis.__W2P3_PACKETS__
      .filter(p=>p.kind==='resync'&&p.requestId===id).length,invalidId),{timeout:60000}).toBe(1);
    await expect.poll(()=>page.evaluate(id=>globalThis.__W2P3_PACKETS__
      .some(p=>p.kind==='prepared'&&p.requestId>id),invalidId),{timeout:60000}).toBe(true);
    await ready(initial);
    const recovery=await page.evaluate(id=>globalThis.__W2P6_TRANSPORT__.filter(p=>p.requestId>=id),invalidId);
    expect(recovery[0].type).toBe('delta');
    expect(recovery.some(p=>p.requestId>invalidId&&p.type==='replace'&&p.omitted===0)).toBe(true);
    const burst=await page.evaluate(()=>Array.from({length:3},()=>globalThis.__W2P3_REPREPARE__()));
    expect(burst[1]).toBeGreaterThan(burst[0]);
    expect(burst[2]).toBeGreaterThan(burst[1]);
    const latest=burst.at(-1);
    await expect.poll(()=>page.evaluate(id=>globalThis.__W2P3_PACKETS__
      .some(p=>p.kind==='prepared'&&p.requestId===id),latest),{timeout:60000}).toBe(true);
    await ready(initial);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const accepted=await page.evaluate(()=>globalThis.__W2P6_ACCEPTED__);
    expect(accepted).toContain(latest);
    expect(accepted).not.toContain(burst[0]);
    expect(accepted).not.toContain(burst[1]);
    expect(await semantic()).toBe(beforeResync.hash);
    expect((await page.locator('#viewerCanvas').screenshot()).equals(beforeResync.pixels)).toBe(true);
    expect(errors).toEqual([]);
    records.push({kind:'resync-supersession',invalidId,burst,latest,accepted,recovery,
      semanticUnchanged:true,pixelsUnchanged:true});
    console.log('W2_P6_3_REAL_RESYNC_SUPERSESSION '+JSON.stringify({invalidId,burst,latest,accepted,recovery,semanticUnchanged:true,pixelsUnchanged:true}));
  }finally{
    console.log('BOUNDARY_PACKET_REUSE_DIAGNOSTIC '+JSON.stringify(await page.evaluate(()=>({
      packets:globalThis.__W2P3_PACKETS__,transport:globalThis.__W2P6_TRANSPORT__,
      accepted:globalThis.__W2P6_ACCEPTED__,stats:globalThis.__PANDOLAB_VIEWER__?.rendererStats()
    }))).slice(0,17000));
    await info.attach('w2-p3-real-boundary-cache',{body:JSON.stringify({initial,previous,records,errors},null,2),contentType:'application/json'});
    if(process.env.PANDOLAB_W3_EVIDENCE)await writeFile(
      join(process.env.PANDOLAB_W3_EVIDENCE,`viewer-resync-supersession-${Date.now()}.json`),
      JSON.stringify({initial,previous,records,errors},null,2),{flag:'wx'});
  }
});
});
