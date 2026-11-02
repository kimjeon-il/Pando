import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'off'});

test('W2-P3 real Viewer reuses attached Worker packet copies for identical dated boundaries',async({page},info)=>{
  test.setTimeout(240000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{globalThis.__W2P3_PACKETS__=[];});
  await page.route('**/modules/gpu-map-renderer.js*',async route=>{
    const response=await route.fetch();let src=await response.text();
    const marker='if (Number(data?.requestId) !== countryBoundaryRequestId';
    if(src.split(marker).length!==2)throw Error('W2-P3 GPU renderer boundary response port changed');
    src=src.replace(marker,[
      'globalThis.__W2P3_PACKETS__.push({',
      'kind:data?.type,requestId:data?.requestId,projectGeneration:data?.projectGeneration,',
      'geometryRevision:data?.geometryRevision,quality:data?.quality,',
      'packetCacheHit:data?.packetCacheHit??null,',
      'packetCacheResidentEstimate:data?.packetCacheResidentEstimate??null,',
      'segments:data?.packet?.segments?.length??0,receivedAt:performance.now()',
      '});',
      marker
    ].join('\n          '));
    const diagnosticPort='    function syncCountryBoundaryScene() {\n      prepareCountrySharedBoundary({ replace: true, baselineCache: false });\n    }';
    if(src.split(diagnosticPort).length!==2)throw Error('Boundary diagnostic port changed');
    src=src.replace(diagnosticPort,diagnosticPort+
      '\n    // Test-only: demand the same exact authoritative full input without altering it.\n'+
      '    globalThis.__W2P3_REPREPARE__ = () => {\n'+
      '      countryBoundaryDependencies = null;\n'+
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
    expect(forced.packetCacheResidentEstimate).toBeGreaterThan(0);
    expect(final.stats.countrySharedBoundarySegmentCount).toBe(expectedSegments);
    expect(final.stats.countrySharedBoundaryReplacementPending).toBe(false);
    expect(final.packets.filter(p=>p.kind==='prepared')).toHaveLength(beforeReprepare+1);
    expect(errors).toEqual([]);
    console.log('W2_P3_REAL_REPREPARE '+JSON.stringify({
      initial,previous,forced,baseline:all,finalSegments:final.stats.countrySharedBoundarySegmentCount
    }).slice(0,13000));
  }finally{
    await info.attach('w2-p3-real-boundary-cache',{body:JSON.stringify({initial,previous,records,errors},null,2),contentType:'application/json'});
  }
});
