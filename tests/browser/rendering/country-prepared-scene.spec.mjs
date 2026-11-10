import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {navigateViewerStartup} from '../helpers/viewer-acceptance.mjs';

// This is a real pinned world, not a status-only mock. Do not fake performance.now.
test('prepared initial scene publishes country triangles and borders on cold and cached loads',async({page},info)=>{
  test.setTimeout(210_000);
  const errors=[],observations=[],consoleErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',e=>errors.push(String(e)));
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  const read=()=>page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__,s=api?.rendererStats();
    return {ready:document.getElementById('viewerStatus')?.dataset.ready,
      presented:api?.initialMapPresented(),visible:api?.visibleTerritorialCount(),
      month:api?.builtinMonth()?.month,cursor:api?.documentState()?.timelineCursor,
      renderer:s?.renderer,canonical:s?.canonicalMeshReady,blocked:s?.projectRenderBlocked,
      generation:s?.projectGeneration,published:s?.countriesPublishedGeneration,
      countryTriangles:s?.surfaceDraw?.countryIndexCount,boundaries:s?.countrySharedBoundaryReady,
      preparation:s?.lastMeshPreparation,rebuilds:s?.countryMeshRebuildCount||0,
      preparedHits:s?.preparedCountrySceneHits||0,boundaryHits:s?.countryBoundaryPreparedAssetCount||0,
      boundaryWorker:s?.countrySharedBoundaryWorkerActive,diagnostics:api?.diagnostics?.(),statusText:document.getElementById('viewerStatus')?.textContent};
  });
  const ready=()=>expect.poll(async()=>{
    const s=await read();return s.ready==='true'&&s.presented&&s.canonical&&s.boundaries
      &&s.generation>0&&s.published===s.generation&&s.countryTriangles>0&&!s.blocked;
  },{timeout:90_000,message:'Current country triangles and shared borders must actually publish'}).toBe(true);
  try {
    for(const mode of ['cold','cached-reload']){
      const started=Date.now();
      await navigateViewerStartup(page,{cold:mode==='cold'});
      await ready();const state=await read();observations.push({mode,elapsedMs:Date.now()-started,...state});
      expect(state.preparation.source).toBe('prepared-country-scene');
      expect(state.preparation.builtCount).toBe(0);
      expect(state.preparation.reusedCount).toBeGreaterThan(0);
      expect(state.preparation.triangulationMs).toBe(0);
      expect(state.preparation.strokeMs).toBe(0);expect(state.preparation.spatialMs).toBe(0);
      expect(state.rebuilds).toBe(0);expect(state.boundaryWorker).toBe(false);
      expect(state.preparedHits).toBeGreaterThan(0);expect(state.boundaryHits).toBeGreaterThan(0);
      expect(state.month).toMatch(/^-?\d{4,}-\d{2}$/);
      expect(state.month).toBe(state.cursor);expect(state.visible).toBeGreaterThan(0);
    }
    const original=(await read()).month;
    await page.locator('#timelinePreviousYear').click();await ready();
    const previous=await read();expect(previous.month).not.toBe(original);expect(previous.cursor).toBe(previous.month);
    await page.locator('#timelineNextYear').click();await ready();
    expect((await read()).month).toBe(original);
    observations.push({mode:'date-return',...await read()});
    expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('prepared-initial-scene.png')});
  } finally {
    const state=await read().catch(()=>null);
    await writeFile(info.outputPath('prepared-scene.json'),JSON.stringify({observations,errors,consoleErrors,last:state},null,2));
    console.log('PREPARED_SCENE_BROWSER '+JSON.stringify({observations,errors,consoleErrors,last:state}));
  }
});

// Draft extension for tests/browser/rendering/country-prepared-scene.spec.mjs.
// Requires the reviewed thin-render contract AND a completed, pinned mesh6 bundle.
// This observes the real pipeline; it never supplies geometry or fabricated receipts.
// scope.extra is a generator compatibility packet, not an independent runtime
// display feature. Exercise the real historical UI without injecting that packet.
test('historical Soviet scope remains ready across reload, date return and real WebGL context restoration', async ({ page }, info) => {
  test.setTimeout(360_000);
  const observations = [], errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const snapshot = () => page.evaluate(() => {
    const viewer = globalThis.__PANDOLAB_VIEWER__, stats = viewer?.rendererStats();
    return { month: viewer?.builtinMonth().month, ready: document.querySelector('#viewerStatus')?.dataset.ready,
      presented: viewer?.initialMapPresented(), stats };
  });
  const ready = async month => {
    await expect.poll(async () => {
      const value = await snapshot(), s = value.stats;
      return !!(s && (!month || value.month === month) && value.ready === 'true' && value.presented
        && s.canonicalMeshReady && !s.projectRenderBlocked && s.countriesPublishedGeneration === s.projectGeneration
        && s.pendingCountryCount === 0 && s.surfaceDraw?.countryIndexCount > 0 && s.countrySharedBoundaryReady);
    }, { timeout: 90_000 }).toBe(true);
  };
  const year = async value => {
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineViewUnit').selectOption('month');
    await page.locator('#timelineYearInput').fill(String(value));
    await page.locator('#timelineMonthInput').selectOption('12');
    await page.locator('#timelineGoBtn').click();
    await ready(value + '-12');
  };
  const record = async label => {
    const selected = await page.evaluate(async () => {
      const { temporalMonthEnd } = await import('./assets/js/modules/temporal.js?v=' + PANDOLAB_BUILD_META.assetRevision);
      const month = __PANDOLAB_VIEWER__.builtinMonth().month;
      return { month, effectiveDate: temporalMonthEnd(month).canonical };
    });
    expect(selected).toEqual({ month: '1922-12', effectiveDate: '1922-12-31' });
    observations.push({ label, selected, ...await snapshot() });
  };
  try {
    await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
    await ready();
    const bindings = await page.evaluate(async () => {
      const response = await fetch(PANDOLAB_BUILD_META.builtinWorld.url);
      if (!response.ok) throw Error('Pinned builtin scope index unavailable');
      const index = await response.json();
      return ['state:soviet-union', 'state:soviet-union-ukrainian-ssr'].map(id => {
        const row = index.readIndex.records.geometryBindings.find(value => value.objectRef.id === id && value.validFrom === '1922-12-30');
        return { id, validFrom: row?.validFrom, validTo: row?.validTo };
      });
    });
    for (const binding of bindings) {
      expect(binding.validFrom).toBe('1922-12-30'); expect(binding.validTo).toBe('1925-05-12');
    }
    observations.push({ bindings });
    for (const mode of ['cold', 'reload']) {
      if (mode === 'reload') { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
      await year(1922); await record(mode + '-historical');
      await year(2024); observations.push({ label: mode + '-ordinary-control', ...await snapshot() });
      await year(1922); await record(mode + '-historical-return');
    }
    const documentPoint = () => page.evaluate(() => {
      const { revision, checkpoint, timelineCursor } = __PANDOLAB_VIEWER__.documentState();
      return { revision, checkpoint, timelineCursor };
    });
    const beforeRestore = await documentPoint();
    await page.evaluate(() => {
      const gl = document.querySelector('#viewerCanvas').getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) throw Error('Real WebGL context-loss exercise is unavailable');
      globalThis.__historicalContextRestore = extension;
      extension.loseContext();
    });
    await expect.poll(() => page.evaluate(() => __PANDOLAB_VIEWER__.rendererStats().webglContextLost)).toBe(true);
    await page.evaluate(() => globalThis.__historicalContextRestore.restoreContext());
    await ready('1922-12');
    await expect.poll(async () => {
      const { stats } = await snapshot();
      return stats.renderer === 'webgl2' && stats.webglContextLost === false;
    }, { timeout: 30_000 }).toBe(true);
    await record('real-context-restored');
    expect(await documentPoint()).toEqual(beforeRestore);
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: info.outputPath('historical-prepared-scene.png') });
  } finally {
    const last = await snapshot().catch(error => ({ unavailable: error.message }));
    await writeFile(info.outputPath('historical-prepared-scene.json'), JSON.stringify({ observations, last, errors, consoleErrors,
      limits: ['The generated Soviet scope.extra no-raster packet is not a normal runtime display feature. This UI test does not claim that packet was drawn or uploaded.', 'Exact no-raster packet and GPU lifecycle contracts are covered separately by component tests.', 'Reload alone does not prove a persistent cache hit; Canvas fallback is not exercised.'],
    }, null, 2));
  }
});
