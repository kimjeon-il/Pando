import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

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
      if(mode==='cold')await page.goto('/?debug=1&renderer=webgl2',{waitUntil:'domcontentloaded'});
      else await page.reload({waitUntil:'domcontentloaded'});
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
import { createHash } from 'node:crypto';

const SOVIET_EXTRA = {
  scope: 'state:soviet-union:1922-12:extra', selectedMonth: '1922-12', effectiveDate: '1922-12-31',
  validFrom: '1922-12-30', validTo: '1925-05-12',
  digest: 'ab190310f2a1809494f81b531507f2a5412e4c93f4e3293b09bfa190b82034ca',
  coordinates: [48.84445074879411,38.793252790239734,48.844450748794124,38.793252790239706,
    48.81202354483041,38.844431391612304,48.84445074879411,38.793252790239734],
};

async function observeGridCollapsedPipeline(page) {
  await page.addInitScript(({ coordinates }) => {
    const probe = globalThis.__gridCollapsedAcceptance = { events: [], keys: new Set(), round: 0 };
    probe.record = event => { probe.events.push({ ...event, round: probe.round }); };
    probe.matches = packet => packet?.ringCoordinates?.length === coordinates.length
      && coordinates.every((value, i) => Object.is(value, packet.ringCoordinates[i]));
    probe.scene = scene => {
      for (const packet of scene?.polygons || []) if (probe.matches(packet)) {
        probe.keys.add(packet.key);
        probe.record({ stage: 'scene', key: packet.key, rasterState: packet.rasterState,
          triangleCount: packet.triangleCount, segmentCount: packet.segmentCount,
          coordinates: [...packet.ringCoordinates] });
      }
    };
    probe.wrap = (original, methods) => {
      const descriptors = Object.getOwnPropertyDescriptors(original);
      for (const [name, observe] of Object.entries(methods)) {
        const method = original[name];
        if (typeof method !== 'function') throw Error('Missing observed method: ' + name);
        descriptors[name] = { enumerable: true, configurable: false, writable: false,
          value(...args) {
            const before = { ...original.stats?.(), drawCallCount: original.drawCallCount };
            const result = method.apply(original, args);
            observe(result, args, original, before);
            return result;
          } };
      }
      return Object.freeze(Object.defineProperties({}, descriptors));
    };
    const OriginalWorker = globalThis.Worker;
    globalThis.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data?.rpc !== 'pandolab-worker-rpc' || data.operation !== 'geometry.prepare' || !data.ok) return;
          for (const { cacheKey, packet } of data.result?.packets || []) if (probe.matches(packet)) {
            probe.record({ stage: 'worker', cacheKey, rasterState: packet.rasterState,
              triangleCount: packet.triangleCount, segmentCount: packet.segmentCount,
              coordinates: [...packet.ringCoordinates], ringOffsets: [...packet.ringOffsets], polygonOffsets: [...packet.polygonOffsets], stats: data.result.stats });
          }
        });
      }
    };
  }, SOVIET_EXTRA);

  // Only main-thread factory exports are observed. Worker bytes, return values,
  // typed arrays, GPU calls, clock, readiness and draw counters are never changed.
  const wrappers = {
    'render-scene.js': ['createRenderSceneBuilder', `
      return p.wrap(original, { build: value => p.scene(value), patch: value => p.scene(value) });`],
    'gpu-polygon-overlay-pass.js': ['createGpuPolygonOverlayPass', `
      const draw = (value) => {
        const keys = [...p.keys].filter(key => value.gridCollapsedKeys?.includes(key));
        if (keys.length) p.record({ stage: 'gpu-draw', keys, succeeded: value.succeeded,
          renderedKeys: [...value.renderedKeys], missingKeys: [...value.missingKeys] });
      };
      return p.wrap(original, {
        hasPreparedResource: (value, [packet]) => {
          if (value === true && p.matches(packet)) { p.keys.add(packet.key); p.record({ stage: 'gpu-ready', key: packet.key, ready: value }); }
        },
        ensureResource: (value, [packet], pass, before) => {
          if (!p.matches(packet)) return;
          p.keys.add(packet.key);
          const after = pass.stats();
          p.record({ stage: 'gpu-resource', key: packet.key, ready: pass.hasPreparedResource(packet),
            rasterState: value.resource?.rasterState, byteLength: value.resource?.byteLength,
            uploadDelta: after.uploadBytes - before.uploadBytes,
            drawDelta: pass.drawCallCount - before.drawCallCount });
        }, drawPackets: draw, drawResourceItems: draw });`],
  };
  await page.route(/\/modules\/(render-scene|gpu-polygon-overlay-pass)\.js(?:\?|$)/, async route => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1);
    const [name, body] = wrappers[file], response = await route.fetch();
    const source = await response.text(), signature = 'export function ' + name + '(';
    if (!source.includes(signature)) throw Error('Observed factory moved: ' + file);
    const observed = source.replace(signature, 'function __observed_' + name + '(')
      + '\nexport function ' + name + '(...args) { const original = __observed_' + name
      + '(...args), p = globalThis.__gridCollapsedAcceptance; ' + body + '\n}\n';
    await route.fulfill({ response, body: observed });
  });
}

test('Soviet 1922 extra stays ready without fabricated raster draws across reload and date return', async ({ page }, info) => {
  test.setTimeout(360_000);
  const ring = Array.from({ length: SOVIET_EXTRA.coordinates.length / 2 }, (_, i) => SOVIET_EXTRA.coordinates.slice(i * 2, i * 2 + 2));
  expect(createHash('sha256').update(JSON.stringify(['Polygon', [ring]])).digest('hex')).toBe(SOVIET_EXTRA.digest);
  const errors = [], consoleErrors = [], observations = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await observeGridCollapsedPipeline(page);
  const ready = async month => {
    await expect.poll(() => page.evaluate(expected => {
      const viewer = globalThis.__PANDOLAB_VIEWER__, stats = viewer?.rendererStats();
      return !!(viewer && (!expected || viewer.builtinMonth().month === expected)
        && document.querySelector('#viewerStatus')?.dataset.ready === 'true'
        && viewer.initialMapPresented() && stats.canonicalMeshReady && !stats.projectRenderBlocked
        && stats.countriesPublishedGeneration === stats.projectGeneration
        && stats.pendingCountryCount === 0 && stats.surfaceDraw?.countryIndexCount > 0
        && stats.countrySharedBoundaryReady);
    }, month), { timeout: 90_000 }).toBe(true);
  };
  const year = async value => {
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineViewUnit').selectOption('month');
    await page.locator('#timelineYearInput').fill(String(value));
    await page.locator('#timelineMonthInput').selectOption('12');
    await page.locator('#timelineGoBtn').click();
    await ready(value + '-12');
  };
  const check = async (label, reuseScene = false) => {
    await expect.poll(() => page.evaluate(reuse => {
      const p = globalThis.__gridCollapsedAcceptance;
      const rows = p.events.filter(row => row.round === p.round);
      return (rows.some(row => row.stage === 'scene') || reuse && p.events.some(row => row.stage === 'scene'))
        && rows.some(row => row.stage === 'gpu-resource' || !reuse && row.stage === 'gpu-ready' && row.ready)
        && rows.some(row => row.stage === 'gpu-draw');
    }, reuseScene), { timeout: 30_000 }).toBe(true);
    const evidence = await page.evaluate(() => {
      const p = globalThis.__gridCollapsedAcceptance;
      return { rows: p.events.filter(row => row.round === p.round),
        workers: p.events.filter(row => row.stage === 'worker'), stats: __PANDOLAB_VIEWER__.rendererStats() };
    });
    expect(evidence.workers.length).toBeGreaterThan(0);
    for (const row of evidence.workers) {
      expect(row.rasterState).toBe('grid-collapsed');
      expect(row.triangleCount).toBe(0); expect(row.segmentCount).toBe(0);
      expect(row.coordinates).toEqual(SOVIET_EXTRA.coordinates);
      expect(row.ringOffsets).toEqual([0, 4]); expect(row.polygonOffsets).toEqual([0, 1]);
      expect(row.stats.builds).toBe(0); expect(row.stats.assetHits).toBeGreaterThan(0);
    }
    for (const row of evidence.rows) {
      if (row.stage === 'scene') {
        expect(row.coordinates).toEqual(SOVIET_EXTRA.coordinates);
        expect(row.rasterState).toBe('grid-collapsed'); expect(row.triangleCount).toBe(0); expect(row.segmentCount).toBe(0);
      }
      if (row.stage === 'gpu-resource') {
        expect(row.ready).toBe(true); expect(row.rasterState).toBe('grid-collapsed');
        expect(row.byteLength).toBe(0); expect(row.uploadDelta).toBe(0); expect(row.drawDelta).toBe(0);
      }
      if (row.stage === 'gpu-draw') {
        expect(row.succeeded).toBe(true);
        for (const key of row.keys) { expect(row.renderedKeys).not.toContain(key); expect(row.missingKeys).not.toContain(key); }
      }
    }
    const selected = await page.evaluate(async () => {
      const meta = globalThis.PANDOLAB_BUILD_META;
      const { temporalMonthEnd } = await import('./assets/js/modules/temporal.js?v=' + meta.assetRevision);
      const month = __PANDOLAB_VIEWER__.builtinMonth().month;
      return { month, effectiveDate: temporalMonthEnd(month).canonical };
    });
    expect(selected).toEqual({ month: SOVIET_EXTRA.selectedMonth, effectiveDate: SOVIET_EXTRA.effectiveDate });
    observations.push({ label, selected, expectedScope: SOVIET_EXTRA.scope, ...evidence });
  };
  try {
    await page.goto('/?debug=1&renderer=webgl2', { waitUntil: 'domcontentloaded' });
    await ready();
    const bindings = await page.evaluate(async () => {
      const response = await fetch(globalThis.PANDOLAB_BUILD_META.builtinWorld.url);
      if (!response.ok) throw Error('Pinned builtin scope index unavailable');
      const index = await response.json();
      return ['state:soviet-union', 'state:soviet-union-ukrainian-ssr'].map(id => {
        const row = index.readIndex.records.geometryBindings.find(value => value.objectRef.id === id
          && value.validFrom === '1922-12-30');
        return { id, validFrom: row?.validFrom, validTo: row?.validTo };
      });
    });
    for (const binding of bindings) {
      expect(binding.validFrom).toBe(SOVIET_EXTRA.validFrom); expect(binding.validTo).toBe(SOVIET_EXTRA.validTo);
    }
    observations.push({ selectedScopeBindings: bindings });
    for (const mode of ['cold', 'reload-reuse']) {
      if (mode === 'reload-reuse') { await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); }
      await year(1922); await check(mode + '-1922');
      await year(2024);
      await page.evaluate(() => { globalThis.__gridCollapsedAcceptance.round++; });
      await year(1922); await check(mode + '-return');
    }
    const beforeRestore = await page.evaluate(() => {
      const { revision, checkpoint, timelineCursor } = __PANDOLAB_VIEWER__.documentState();
      return { revision, checkpoint, timelineCursor };
    });
    await page.evaluate(() => {
      const gl = document.querySelector('#viewerCanvas').getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) throw Error('Real WebGL context-loss exercise is unavailable');
      globalThis.__gridCollapsedAcceptance.round++;
      globalThis.__gridAcceptanceContext = extension;
      extension.loseContext();
    });
    await expect.poll(() => page.evaluate(() => __PANDOLAB_VIEWER__.rendererStats().webglContextLost)).toBe(true);
    await page.evaluate(() => globalThis.__gridAcceptanceContext.restoreContext());
    await ready('1922-12');
    await check('real-context-restored', true);
    expect(await page.evaluate(() => {
      const { revision, checkpoint, timelineCursor } = __PANDOLAB_VIEWER__.documentState();
      return { revision, checkpoint, timelineCursor };
    })).toEqual(beforeRestore);
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: info.outputPath('soviet-1922-grid-collapse.png') });
  } finally {
    await writeFile(info.outputPath('soviet-1922-grid-collapse.json'), JSON.stringify({
      target: SOVIET_EXTRA, observations, errors, consoleErrors,
      limits: ['Main-thread observation wrappers are test-only; routing disables HTTP cache, so reload-reuse is not an HTTP-cache claim.', 'Canvas-specific fallback delivery is a separate acceptance case.'],
    }, null, 2));
  }
});
