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
    const all=records.at(-1).packets.filter(p=>p.kind==='prepared');
    expect(all.length,'actual boundary Worker should publish canonical packets in the real Viewer').toBeGreaterThanOrEqual(2);
    expect(all.some(p=>p.packetCacheHit===true),
      'unchanged 2025/2026 borders should reuse one exact retained Worker packet').toBe(true);
    expect(all.every(p=>typeof p.packetCacheHit==='boolean')).toBe(true);
    expect(all.every(p=>p.packetCacheResidentEstimate>0),
      'full-world boundary packet should fit within the bounded one-entry cache').toBe(true);
    expect(errors).toEqual([]);
    console.log('W2_P3_REAL_PACKET_CACHE '+JSON.stringify({initial,previous,records}).slice(0,12000));
  }finally{
    await info.attach('w2-p3-real-boundary-cache',{body:JSON.stringify({initial,previous,records,errors},null,2),contentType:'application/json'});
  }
});
