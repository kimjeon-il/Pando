import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test.use({viewport:{width:1280,height:800},trace:'off'});

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
      '    globalThis.__W2P3_REPREPARE__ = () => {\n'+
      '      countryBoundaryDependencies = null;\n'+
      '      countryBoundaryTask = null;\n'+
      '      prepareCountrySharedBoundary({ replace: true });\n'+
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
    const all=records.at(-1).packets.filter(p=>p.kind==='prepared');
    expect(all.length,'actual boundary Worker should publish canonical packets in the real Viewer').toBeGreaterThanOrEqual(2);
    // The normal adjacent switch can reuse the already certified main renderer
    // packet without issuing another Worker request. This is better than a
    // forced Worker cache hit and must remain the default product behavior.
    const beforeReprepare=all.length;
    const currentGeneration=records.at(-1).stats.currentGeneration;
    const expectedSegments=records.at(-1).stats.countrySharedBoundarySegmentCount;
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
    await info.attach('w2-p3-real-boundary-cache',{body:JSON.stringify({initial,previous,records,errors},null,2),contentType:'application/json'});
    if(process.env.PANDOLAB_W3_EVIDENCE)await writeFile(
      join(process.env.PANDOLAB_W3_EVIDENCE,`viewer-resync-supersession-${Date.now()}.json`),
      JSON.stringify({initial,previous,records,errors},null,2),{flag:'wx'});
  }
});
