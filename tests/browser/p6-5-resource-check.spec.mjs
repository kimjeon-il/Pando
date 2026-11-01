import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromiumProcessPss,createWorkerMemoryProbe} from './helpers/soviet-memory-attribution.mjs';

test.use({timezoneId:'Asia/Seoul',locale:'ko-KR',viewport:{width:1280,height:800},trace:'off'});
const MIB=1024*1024;
const miB=value=>Number.isFinite(value)?Number((value/MIB).toFixed(2)):null;
const delta=(after,before)=>Number.isFinite(after)&&Number.isFinite(before)?Number((after-before).toFixed(2)):null;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function ready(page,month){
  await expect.poll(()=>page.evaluate(()=> {
    const viewer=globalThis.__PANDOLAB_VIEWER__,renderer=viewer?.rendererStats?.();
    return {
      month:viewer?.builtinMonth?.().month??null,
      cursor:viewer?.documentState?.().timelineCursor??null,
      ready:document.querySelector('#viewerStatus')?.dataset.ready??null,
      renderer:renderer?.renderer??null,
      canonical:renderer?.canonicalMeshReady??false,
      pendingBoundary:renderer?.countrySharedBoundaryReplacementPending??null,
      pendingTemporal:renderer?.temporalPresentationPending??null,
      uploadPending:renderer?.uploads?.pending??null,
      uploadActive:renderer?.uploads?.active??null,
    };
  }),{timeout:90000,intervals:[250,500,1000]}).toEqual({
    month,cursor:month,ready:'true',renderer:'webgl2',canonical:true,
    pendingBoundary:false,pendingTemporal:false,uploadPending:0,uploadActive:false,
  });
}

async function move(page,control,month){
  await page.locator('#'+control).click();
  await ready(page,month);
}

async function sample(page,cdp,probe,label){
  const workerMemory=await probe.sample({collectGarbage:true});
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(250);
  const main=await cdp.send('Runtime.getHeapUsage');
  const app=await page.evaluate(()=> {
    const renderer=globalThis.__PANDOLAB_VIEWER__.rendererStats();
    const sourceCache=globalThis.__PANDOLAB_VIEWER__.p65SourceCacheStats();
    const meshVariantBytes=renderer.meshVariantBytes||{};
    return {
      month:globalThis.__PANDOLAB_VIEWER__.builtinMonth().month,
      visible:globalThis.__PANDOLAB_VIEWER__.visibleTerritorialCount(),
      renderer:renderer.renderer,
      activeWebGlContextCount:renderer.activeWebGlContextCount,
      uploads:{pending:renderer.uploads?.pending??null,active:renderer.uploads?.active??null},
      meshVariantCount:Object.keys(meshVariantBytes).length,
      meshVariantBytes:Object.values(meshVariantBytes).reduce((sum,value)=>sum+(Number(value)||0),0),
      polygonResourceCount:renderer.polygonOverlay?.resourceCount??null,
      polygonActiveBytes:renderer.polygonOverlay?.resourceBudget?.activeBytes??renderer.polygonOverlay?.activeBufferBytes??null,
      strokeResourceCount:renderer.stroke?.resourceCount??null,
      strokeActiveBytes:renderer.stroke?.resourceBudget?.activeBytes??renderer.stroke?.activeBufferBytes??null,
      selectionActiveBytes:renderer.selection?.activeBufferBytes??null,
      selectionStagingBytes:renderer.selection?.stagingBufferBytes??null,
      terrainCacheBytes:renderer.terrainCacheBytes??null,
      hydroCacheBytes:renderer.hydroCacheBytes??null,
      sceneCache:{valid:renderer.sceneCache?.valid??null,entryGeneration:renderer.sceneCache?.generation??null,
        hitCount:renderer.sceneCache?.hitCount??null,missCount:renderer.sceneCache?.missCount??null,
        recreateCount:renderer.sceneCache?.recreateCount??null},
      reuse:{mesh:renderer.countryMeshReuseCount??null,boundary:renderer.countryBoundaryReuseCount??null,
        meshRebuild:renderer.countryMeshRebuildCount??null,boundaryPrepare:renderer.countryBoundaryPrepareCount??null},
      sourceCache,
    };
  });
  const chromium=await chromiumProcessPss();
  return {label,at:new Date().toISOString(),app,workerMemory,chromium,
    memory:{mainJsMiB:miB(main.usedSize),workerJsMiB:miB(workerMemory.jsUsedBytes),
      workerWasmMiB:miB(workerMemory.wasmAllocatedBytes),chromiumPssMiB:chromium.pssMiB??null}};
}

function resourceFingerprint(row){
  const app=row.app;
  return {
    workers:row.workerMemory.count,
    activeWebGlContextCount:app.activeWebGlContextCount,
    meshVariantCount:app.meshVariantCount,
    meshVariantBytes:app.meshVariantBytes,
    polygonResourceCount:app.polygonResourceCount,
    polygonActiveBytes:app.polygonActiveBytes,
    strokeResourceCount:app.strokeResourceCount,
    strokeActiveBytes:app.strokeActiveBytes,
    selectionActiveBytes:app.selectionActiveBytes,
  };
}

test('P6-5 six adjacent year round trips keep active resources bounded across three batches',async({page,browser},info)=>{
  test.setTimeout(480000);
  await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
  const errors=[],samples=[],cycles=[];
  page.on('pageerror',error=>errors.push(String(error.stack||error)));
  await page.route('**/modules/viewer-composition.js*',async route=>{
    const response=await route.fetch();let source=await response.text();
    const anchor='diagnostics:diagnostics.snapshot,rendererStats:()=>map.renderer.getStats(),visibleTerritorialCount:';
    if(source.split(anchor).length!==2)throw Error('P6-5 Viewer cache observation anchor changed');
    source=source.replace(anchor,
      'diagnostics:diagnostics.snapshot,rendererStats:()=>map.renderer.getStats(),p65SourceCacheStats:()=>owners.builtinSession.sourceCacheStats(),visibleTerritorialCount:');
    await route.fulfill({response,body:source});
  });
  let cdp,probe,failure=null;
  const result={schema:'pando-p6-5-resource-check-v1',codeSha:process.env.GITHUB_SHA||null,
    browser:browser.version(),environment:'Ubuntu CI Chromium SwiftShader WebGL2; forced V8 GC at samples',
    method:'one warm-up round trip, then six 2026-10 <-> 2025-12 round trips in three batches of two; sample only at idle batch boundaries',
    limitations:['Chromium PSS is process-level, not per Worker and not VRAM.',
      'Worker WASM is allocated linear memory, not live C++ heap.',
      'Tracked WebGL resource bytes are application counters, not total GPU VRAM.',
      'Forced GC makes samples more comparable but does not compel Chromium or native allocators to return memory.',
      'Six cycles can expose obvious retention but cannot prove absence of leaks.'],
    samples,cycles,errors};
  try{
    await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
    await ready(page,'2026-10');
    cdp=await page.context().newCDPSession(page);
    probe=await createWorkerMemoryProbe(cdp,{origin:new URL(page.url()).origin,timeoutMs:15000});

    // Warm both adjacent source/cache paths before taking the comparison baseline.
    await move(page,'timelinePreviousYear','2025-12');
    await move(page,'timelineNextYear','2026-10');
    await page.waitForTimeout(1500);
    samples.push(await sample(page,cdp,probe,'warm-baseline'));
    const baseline=samples[0],fingerprint=resourceFingerprint(baseline);
    expect(baseline.app.visible).toBeGreaterThan(0);
    expect(baseline.app.sourceCache.entries).toBeLessThanOrEqual(baseline.app.sourceCache.maxEntries);
    expect(baseline.app.sourceCache.bytes).toBeLessThanOrEqual(baseline.app.sourceCache.maxBytes);

    for(let batch=1;batch<=3;batch++){
      for(let local=1;local<=2;local++){
        const cycle=(batch-1)*2+local,started=Date.now();
        await move(page,'timelinePreviousYear','2025-12');
        await move(page,'timelineNextYear','2026-10');
        cycles.push({cycle,elapsedMs:Date.now()-started});
      }
      await page.waitForTimeout(750);
      const row=await sample(page,cdp,probe,'batch-'+batch);
      samples.push(row);
      expect(row.app.visible).toBeGreaterThan(0);
      expect(row.app.activeWebGlContextCount).toBe(1);
      expect(row.app.uploads).toEqual({pending:0,active:false});
      expect(row.app.sourceCache.entries).toBeLessThanOrEqual(row.app.sourceCache.maxEntries);
      expect(row.app.sourceCache.bytes).toBeLessThanOrEqual(row.app.sourceCache.maxBytes);
      expect(resourceFingerprint(row)).toEqual(fingerprint);
    }

    await page.waitForTimeout(5000);
    const idle=await sample(page,cdp,probe,'idle-final-5s');samples.push(idle);
    expect(idle.app.activeWebGlContextCount).toBe(1);
    expect(idle.app.uploads).toEqual({pending:0,active:false});
    expect(resourceFingerprint(idle)).toEqual(fingerprint);
    expect(idle.app.sourceCache.entries).toBeLessThanOrEqual(idle.app.sourceCache.maxEntries);
    expect(idle.app.sourceCache.bytes).toBeLessThanOrEqual(idle.app.sourceCache.maxBytes);
    expect(errors).toEqual([]);

    const state=await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.documentState());
    expect(state.timelineCursor).toBe('2026-10');
    expect(state.dirty).toBe(false);expect(state.canUndo).toBe(false);expect(state.canRedo).toBe(false);
    result.finalDocumentSha256=digest(await page.evaluate(()=>globalThis.__PANDOLAB_VIEWER__.documentSnapshot()));
    result.outcome='passed';
  }catch(error){failure=String(error.stack||error);result.outcome='failed';result.failure=failure;throw error;}
  finally{
    if(samples.length){
      const base=samples[0],last=samples.at(-1);
      result.summary={cyclesCompleted:cycles.length,resourceBaseline:resourceFingerprint(base),
        resourceFinal:resourceFingerprint(last),
        memoryDelta:{mainJsMiB:delta(last.memory.mainJsMiB,base.memory.mainJsMiB),
          workerJsMiB:delta(last.memory.workerJsMiB,base.memory.workerJsMiB),
          workerWasmMiB:delta(last.memory.workerWasmMiB,base.memory.workerWasmMiB),
          chromiumPssMiB:delta(last.memory.chromiumPssMiB,base.memory.chromiumPssMiB)},
        sourceCache:{baseline:base.app.sourceCache,final:last.app.sourceCache},
        memorySeries:samples.map(row=>({label:row.label,...row.memory,workerCount:row.workerMemory.count}))};
    }
    result.failure=failure;
    await mkdir('test-results/p6-5-resources',{recursive:true});
    const path='test-results/p6-5-resources/measurement.json';
    await writeFile(path,JSON.stringify(result,null,2));
    await info.attach('p6-5-resource-measurement',{path,contentType:'application/json'});
    console.log('P6_5_RESOURCE_RESULT '+JSON.stringify({outcome:result.outcome,summary:result.summary,failure}));
    if(probe)await probe.dispose();
    if(cdp)await cdp.detach().catch(()=>{});
  }
});
