import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency2 from "../helpers/viewer-acceptance.mjs";
import * as __suiteDependency3 from "@playwright/test";
import * as __suiteDependency4 from "node:fs/promises";

// Preserved Viewer feature contract: viewer-startup-and-terrain.spec.mjs
featureTest.use({trace:'off'});
featureTest.describe("viewer-startup-and-terrain", () => {
  const {  test, expect  } = __suiteDependency0;
  const {  waitForCanonicalMap  } = __suiteDependency2;
// Keep renderer-specific fixtures and failure evidence scoped to each contract family.


test.describe('Initial formal map presentation', () => {
  for (const profile of [
    { name: 'desktop-light', viewport: { width: 1280, height: 800 }, theme: 'light', reduced: false, reload: true },
    { name: 'narrow-dark-reduced', viewport: { width: 390, height: 844 }, theme: 'dark', reduced: true, reload: false },
  ]) test('loading, first accepted frame and reload: ' + profile.name, async ({ page }) => {
    test.setTimeout(240000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(profile.viewport);
    await page.emulateMedia({ reducedMotion: profile.reduced ? 'reduce' : 'no-preference' });
    await page.clock.setFixedTime(new Date('2026-10-31T00:00:00+09:00'));
    await page.addInitScript(theme => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2, appearance: { theme } }));
      window.__firstMapHold = true;
    }, profile.theme);
    await page.route('**/modules/viewer-map.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'prepareBuiltinProject:async(month,options)=>{';
      if (source.split(anchor).length !== 2) throw Error('First-map admission gate changed');
      await route.fulfill({ response, body: source.replace(anchor, anchor +
        'if(window.__firstMapHold)await new Promise(resolve=>{window.__firstMapRelease=resolve;});') });
    });
    async function finishFirstMap() {
      await expect.poll(() => page.evaluate(() => typeof window.__firstMapRelease), { timeout: 90000 }).toBe('function');
      await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'true');
      await expect(page.locator('#viewerStatus')).toHaveAttribute('aria-live', 'polite');
      expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.initialMapPresented())).toBe(false);
      await page.evaluate(() => { window.__firstMapHold = false; window.__firstMapRelease(); });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.initialMapPresented()), { timeout: 100000 }).toBe(true);
      await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'false');
      await expect.poll(() => page.evaluate(() => {
        const stats = window.__PANDOLAB_VIEWER__.rendererStats();
        return stats.countriesPublishedGeneration === stats.projectGeneration && stats.mapReadiness.mapReady;
      })).toBe(true);
    }
    await page.goto('/?debug=1');
    await finishFirstMap();
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator('#viewer')).toHaveAttribute('data-initial-loading', 'false');
    if (profile.reload) { await page.reload(); await finishFirstMap(); }
    expect(errors).toEqual([]);
  });
});

test.describe("Canonical map and terrain publication", () => {
test('Web publishes sharp ocean and land before countries, then reuses prepared terrain and meshes', async ({ page }) => {
  test.setTimeout(120000);
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  let release; const gate=new Promise(resolve=>{ release=resolve; });
  await page.route(/\/terrain\/[^/]+\/(?:\d+\/\d+-\d+)\.webp/, async route=>{ await gate; await route.continue(); });
  await page.addInitScript(()=>{
    const timer=setInterval(()=>{
      const viewer=window.__PANDOLAB_VIEWER__, host=window.__PANDOLAB_MAP_HOST__;
      const stats=viewer?.rendererStats();
      if(!host || !stats?.projectGeneration || stats.projectRenderBlocked)return;
      host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-24.6,-38.5,0],globeZoom:8}});
      host.requestRepaint('startup-sharp-regression');clearInterval(timer);
    },20);
  });
  const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
  try {
    await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
    await expect.poll(async()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.rendererStats().canonicalMeshReady),{timeout:60000}).toBe(true);
    // The first physical WebGL country frame is allowed before optional DEM
    // tiles resolve. Readiness is distinct from successful base publication.
    await expect.poll(async() => {
      const state = await stats();
      return state.countriesPublishedGeneration === state.projectGeneration
        && state.firstCountryPublishedMs !== null
        && (state.surfaceDraw?.countryIndexCount || 0) > 0;
    }, { timeout: 30000 }).toBe(true).catch(async error=>{
      console.log('INITIAL_COUNTRY_PUBLICATION_DIAGNOSTIC '+JSON.stringify({stats:await stats(),errors}).slice(0,15000));
      throw error;
    });
    const early = await stats();
    expect(early.surfacePresentation.quality).toBe('canonical');
    expect(early.mapReadiness.mapReady).toBe(true);
    expect(early.terrainReady).toBe(false);
    expect(early.mapReadiness.status).not.toBe('ready');
    release();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect.poll(async() => {
      const state = await stats();
      return state.countriesPublishedGeneration === state.projectGeneration;
    }, { timeout: 60000 }).toBe(true);
    // User-visible map readiness is independent of optional DEM completion.
    // Observe both milestones separately without weakening either invariant.
    await expect.poll(async()=>(await stats()).terrainReady,{timeout:60000}).toBe(true);
    const cold=await stats();
    expect(cold.firstBackgroundFrameMs).toBeLessThan(cold.firstCountryPublishedMs);
    expect(cold.terrainReady).toBe(true);
    expect(cold.surfaceDraw.countryIndexCount).toBeGreaterThan(0);
    await expect.poll(async()=>(await stats()).terrainTilesLoading,{timeout:15000}).toBe(0);
    await expect.poll(async()=>(await stats()).terrainPendingDecodedBytes,{timeout:15000}).toBe(0);
    const beforeUploads=(await stats()).terrainUploadCount;
    await page.getByRole('button',{name:'파일 메뉴 열기'}).click();
    await page.locator('#builtinMapBtn').click();
    await expect.poll(async()=>(await stats()).projectGeneration,{timeout:60000}).toBeGreaterThan(cold.projectGeneration);
    await waitForCanonicalMap(page,{timeout:60000});
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
    await expect(page.locator('#mapPreparationNotice')).toBeHidden();
    await expect(page.locator('#mapPreparationRetry')).toBeHidden();
    const warm=await stats();
    expect(warm.terrainUploadCount).toBe(beforeUploads);
    expect(warm.countryMeshReuseCount).toBeGreaterThan(cold.countryMeshReuseCount || 0);
    expect(warm.countryMeshRebuildCount).toBe(cold.countryMeshRebuildCount);
    expect(warm.countryBoundaryPrepareCount).toBe(cold.countryBoundaryPrepareCount);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({cold:cold.lastMeshPreparation,warm:warm.lastMeshPreparation,background:cold.firstBackgroundFrameMs,countries:cold.firstCountryPublishedMs,uploads:beforeUploads}));
  } finally { release(); }
});


// Failures print the accepted C++ document and renderer state. Do not replace
// real readiness, date, GPU or terrain assertions with this diagnostic.
test.afterEach(async({page},info)=>{
  if(info.status===info.expectedStatus)return;
  const state=await page.evaluate(()=>{
    const api=window.__PANDOLAB_VIEWER__,stats=api?.rendererStats?.()||{};
    const fields=['renderer','mapReadiness','projectGeneration','countriesPublishedGeneration',
      'canonicalMeshReady','projectRenderBlocked','surfacePresentation','terrainReady',
      'terrainTargetLevel','terrainRenderedLevel','terrainTargetTilesLoaded','terrainTargetTileCount',
      'terrainTilesLoading','terrainPendingDecodedBytes','screenScale','hydroPendingUploadCount',
      'webglContextLost','temporalPresentationPending','requestedRevision','displayedRevision',
      'firstBackgroundFrameMs','firstCountryPublishedMs','lastMeshPreparation'];
    return {documentState:api?.documentState?.()||null,
      builtinMonth:api?.builtinMonth?.()||null,
      map:Object.fromEntries(fields.map(k=>[k,stats[k]??null])),
      diagnostics:api?.diagnostics?.().slice(-12)||[],
      status:document.getElementById('viewerStatus')?.dataset.ready};
  }).catch(error=>({unavailable:String(error)}));
  console.error('P7_FAILED_MAP_STATE '+JSON.stringify({test:info.title,state}).slice(0,14000));
});

test('WebGL publishes an actual physical country frame before optional terrain detail resolves',async({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(/\/terrain\/[^/]+\/(?:\d+\/\d+-\d+)\.webp/,async route=>{
    await gate;
    if(!page.isClosed())await route.continue();
  });
  try{
    await page.goto('/?renderer=webgl2&debug=1',{waitUntil:'domcontentloaded'});
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__?.rendererStats();
      return stats?.canonicalMeshReady===true&&stats?.projectRenderBlocked===false;
    }),{timeout:90000}).toBe(true);
    await expect.poll(()=>page.evaluate(()=>{
      const stats=window.__PANDOLAB_VIEWER__.rendererStats();
      return stats.countriesPublishedGeneration===stats.projectGeneration&&
        stats.firstBackgroundFrameMs!==null&&stats.firstCountryPublishedMs!==null;
    }),{timeout:30000}).toBe(true);
    const stats=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    expect(stats.terrainReady).toBe(false);
    expect(stats.mapReadiness.terrainReady).toBe(false);
    expect(stats.webGlFirstBackgroundSceneDrawCalls?.total).toBeGreaterThan(0);
    expect(stats.webGlFirstCountrySceneDrawCalls?.total).toBeGreaterThan(0);
    expect(stats.webGlFirstCountrySceneDrawCalls.total).toBeGreaterThanOrEqual(
      stats.webGlFirstCountrySceneDrawCalls.direct);
    expect(stats.mapReadiness.status).not.toBe('ready');
    console.log('WEBGL_INITIAL_POSTING '+JSON.stringify({
      firstBackgroundMs:stats.firstBackgroundFrameMs,
      firstCountryMs:stats.firstCountryPublishedMs,
      firstBackgroundDrawCalls:stats.webGlFirstBackgroundSceneDrawCalls,
      firstCountryDrawCalls:stats.webGlFirstCountrySceneDrawCalls,
      baseSubmitMs:stats.webGlLastBaseSubmitMs,
      terrainReady:stats.mapReadiness.terrainReady,
    }));
    expect(errors).toEqual([]);
  }finally{release();}
});
});
});
// Preserved Viewer feature contract: physical-land-time.spec.mjs
featureTest.describe("physical-land-time", () => {
  const {  test, expect  } = __suiteDependency3;
  const {  writeFile  } = __suiteDependency4;
test.use({ viewport: { width: 1280, height: 800 } });

for (const renderer of ['canvas', 'webgl2']) test(`${renderer} keeps physical land across empty time and theme changes with immutable Workers`, async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const browser = await playwright.chromium.launch({ ...info.project.use.launchOptions,
    channel: info.project.use.channel, args: renderer === 'webgl2'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] : [] });
  const page = await browser.newPage({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(20_000);
  const errors = [], unversioned = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.text().startsWith('Canvas worker failed')) { errors.push(message.text()); console.log(renderer, message.text().slice(0, 600)); } });
  // A stale original calculation URL must never be requested by new Workers.
  await page.route(url => url.pathname === '/assets/js/modules/boundary-topology.js' && !url.search, async route => {
    unversioned.push(route.request().url());
    await route.fulfill({ contentType: 'text/javascript', body: "throw Error('stale cached calculation');" });
  });
  await page.addInitScript(forceCanvas => {
    localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
      appearance: { mapStyle: 'standard' } }));
    window.__landPixels = []; window.__landWorkerUrls = []; window.__landMeshRequests = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options); window.__landWorkerUrls.push(String(url));
        const requests = new Map();
        const post = this.postMessage.bind(this);
        this.postMessage = (message, ...args) => {
          if (message.type === 'request' && message.operation?.startsWith('geometry.')) {
            const request = { requestId: message.requestId, worker: String(url), started: performance.now(),
              operation: message.operation, featureCount: message.payload.features?.length,
              keys: (message.payload.items || []).map(item => item.cacheKey), status: 'pending' };
            requests.set(message.requestId, request); window.__landMeshRequests.push(request);
          }
          return post(message, ...args);
        };
        this.addEventListener('message', event => {
          const request = requests.get(event.data.requestId || event.data.payload?.requestId);
          if (request && event.data.type === 'event' && event.data.operation === 'geometry.prepare-progress')
            (request.progress ||= []).push(event.data.payload);
          if (request && event.data.type === 'result') {
            request.elapsed = performance.now() - request.started; request.status = event.data.ok ? 'passed' : 'failed';
            request.stats = event.data.result?.stats;
          }
          if (event.data.landProbe) {
            window.__landPixels.push(event.data.landProbe);
            window.__landPixelRevision = event.data.styleRevision;
            window.__landComplete = event.data.terrainComplete;
            window.__landProbeMeta = event.data.landProbeMeta;
          }
        });
      }
    };
    if (forceCanvas) {
      const getContext = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
      };
    } else {
      const prototype = window.WebGL2RenderingContext.prototype;
      const capture = function() {
        if (!window.__landProbe || this.getParameter(this.FRAMEBUFFER_BINDING)) return;
        const program = this.getParameter(this.CURRENT_PROGRAM);
        if (!program || !this.getUniformLocation(program, 'uScene')) return;
        const point = window.__PANDOLAB_MAP_HOST__.project([114.15, 22.35]);
        const box = this.canvas.getBoundingClientRect(), rgba = new Uint8Array(4);
        this.readPixels(Math.floor(point[0] * this.canvas.width / box.width),
          this.canvas.height - 1 - Math.floor(point[1] * this.canvas.height / box.height), 1, 1, this.RGBA, this.UNSIGNED_BYTE, rgba);
        window.__landPixels.push(Array.from(rgba));
        if (window.__landPixels.length > 100) window.__landPixels.shift();
      };
      for (const name of ['drawArrays']) {
        const draw = prototype[name];
        prototype[name] = function(...args) { const result = draw.apply(this, args); capture.call(this); return result; };
      }
    }
  }, renderer === 'canvas');
  await page.route('**/modules/map-renderer-composition.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = 'export function createMapRenderer(dependencies, { presentMapPreparation, onMapPreparationStatus = null } = {}) {';
    expect(source).toContain(anchor);
    await route.fulfill({ response, body: source.replace(anchor, anchor + '\nwindow.__landPorts = dependencies;') });
  });
  await page.route('**/modules/gpu-map-renderer.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = 'function renderFrame(visualFrame, { interactionOnly = false } = {}) {';
    expect(source).toContain(anchor);
    await route.fulfill({ response, body: source.replace(anchor, anchor + `
      window.__landPaints = Object.fromEntries((renderScene?.polygons || []).filter(packet => packet.role === 'territorial-fill')
        .map(packet => [packet.key, packet.style.fillAlpha]));`) });
  });
  if (renderer === 'canvas') await page.route('**/workers/canvas-render-core.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    // Instrument the imported implementation rather than its six-line Worker bootstrap.
    const anchor = 'const bitmap = canvas.transferToImageBitmap();';
    expect(source).toContain(anchor);
    const capture = `const landProbe = Array.from(context.getImageData(...createProjection(message, width, height)([114.15, 22.35]).map(value => Math.round(value * dpr)), 1, 1).data);
      const landProbeMeta = { land: (message.scenePolygons || []).filter(packet => packet.role === 'physical-land').map(packet => packet.ringCoordinates?.length), zoom: message.view?.globeZoom, style: message.physicalSettings?.terrainStyle };`;
    await route.fulfill({ response, body: source.replace(anchor, capture + anchor)
      .replace("type: 'frame',", "type: 'frame', landProbe, landProbeMeta,") });
  });
  try {
    // Canvas exercises its DEM Worker; WebGL uses pinned local terrain tiles.
    await page.goto(renderer === 'canvas' ? '/?debug=1' : '/?debug=1&demTerrain=raster');
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    const visibleCount = () => page.evaluate(() => window.__PANDOLAB_VIEWER__.visibleTerritorialCount());
    const initialCount = await visibleCount();
    const documentBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
    const initialMonth = documentBefore.timelineCursor;
    const snapshotBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
    const childKey = await page.evaluate(() => {
      const child = window.__landPorts.territorialModel.entityRepository.list()
        .find(entity => entity.properties.metadata?.builtinSubunit?.sourceCountryId === 'HKG');
      return `territorial:entity:${child.id}:fill`;
    });
    await page.evaluate(() => {
      window.__landProbe = true;
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { flatCenter: [0, 0], flatZoom: 1,
        globeRotation: [-114.17, -22.27, 0], globeZoom: 16 } });
      host.requestRepaint('physical-land-time');
    });
    await expect.poll(() => page.evaluate(() => {
      const stats = window.__PANDOLAB_VIEWER__.rendererStats();
      return stats.renderer === 'canvas-worker' ? window.__landComplete === true && window.__landProbeMeta?.zoom === 16
        : stats.terrainTargetTileCount > 0 && stats.terrainTargetTilesLoaded === stats.terrainTargetTileCount;
    }), { timeout: 20_000 }).toBe(true).catch(async error => {
      console.log(renderer, await page.evaluate(() => ({ meta: window.__landProbeMeta, complete: window.__landComplete,
        stats: Object.fromEntries(Object.entries(window.__PANDOLAB_VIEWER__.rendererStats()).filter(([key]) => /terrain|renderer|fallback/i.test(key))) })));
      throw error;
    });
    // Country fills stay present in the standard map theme; the theme, not
    // an obsolete per-layer color checkbox, owns their visual appearance.
    await expect.poll(() => page.evaluate(key => window.__landPaints?.[key], childKey))
      .toBeGreaterThan(0);
    const settledPixel = async (style = 'physical') => {
      await page.evaluate(() => { window.__landPixels = []; window.__PANDOLAB_MAP_HOST__.requestRepaint('probe-land'); });
      await expect.poll(() => page.evaluate(style => {
        const stats = window.__PANDOLAB_VIEWER__.rendererStats();
        if (stats.displayedRevision !== stats.requestedRevision) return 0;
        return stats.renderer === 'canvas-worker'
          && (window.__landPixelRevision !== stats.canvasStyleRevision || window.__landComplete === false)
          ? 0 : stats.renderer === 'canvas-worker' && window.__landProbeMeta?.style !== style
            ? 0 : window.__landPixels.length;
      }, style)).toBeGreaterThan(0);
      return page.evaluate(() => window.__landPixels.at(-1));
    };
    const before = await settledPixel();
    expect(before[3]).toBe(255);
    expect(before.slice(0, 3)).not.toEqual([106, 168, 210]);
    expect(before[1]).toBeGreaterThan(before[2] + 5);
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineViewUnit').selectOption('month');
    await page.locator('#timelineYearInput').fill('-1');
    await page.locator('#timelineMonthInput').selectOption('12');
    await page.locator('#timelineYearInput').press('Enter');
    await expect.poll(visibleCount, { timeout: 30_000 }).toBeLessThan(initialCount);
    await expect(page.locator('#timelineDateButton')).toHaveAttribute('aria-expanded', 'false', { timeout: 30000 });
    const empty = await settledPixel();
    console.log(renderer, 'empty', empty, await page.evaluate(() => window.__landProbeMeta));
    expect(empty).toEqual(before);
    const [initialYear, initialMonthNumber] = initialMonth.split('-');
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineYearInput').fill(initialYear);
    await page.locator('#timelineMonthInput').selectOption(String(Number(initialMonthNumber)));
    await page.locator('#timelineYearInput').press('Enter');
    await expect.poll(visibleCount, { timeout: 30_000 }).toBe(initialCount);
    await expect.poll(() => page.evaluate(key => window.__landPaints?.[key], childKey))
      .toBeGreaterThan(0);
    const restored = await settledPixel();
    console.log(renderer, 'restored', restored, await page.evaluate(() => window.__landProbeMeta));
    expect(restored).toEqual(before);
    await expect.poll(() => page.evaluate(() => {
      const stats = window.__PANDOLAB_VIEWER__.rendererStats();
      return ['ready', 'limited'].includes(stats.mapReadiness.status) && !stats.projectRenderBlocked;
    }), { timeout: 90_000 }).toBe(true);
    await page.keyboard.press('Escape');
    // Independent hydro visibility can change without removing countries.
    await page.locator('#preferencesBtn').click();
    await page.locator('#preferencesRiversInput').locator('..').click();
    await page.locator('#preferencesCloseBtn').click();
    await expect.poll(visibleCount).toBe(initialCount);
    expect(await settledPixel()).toEqual(before);
    // Epoch counts accepted read projections, including the two cursor moves.
    const stateAfter = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
    expect({ ...stateAfter, epoch: 0, storageBaselineId: 0 }).toEqual({ ...documentBefore, epoch: 0, storageBaselineId: 0 });
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(snapshotBefore);
    await page.locator('#preferencesBtn').click();
    await page.locator('input[name="preferencesMapStyle"][value="classic"]').locator('..').click();
    await page.locator('#preferencesCloseBtn').click();
    await expect(page.locator('html')).toHaveAttribute('data-map-style','classic');
    await expect.poll(() => page.evaluate(key => window.__landPaints?.[key],childKey)).toBe(0);
    const gray = await settledPixel('political');
    expect(gray[3]).toBe(255);
    // The classic theme deliberately uses warm cartographic inks rather than neutral gray.
    expect(gray[0]).toBeLessThan(250);
    await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { flatCenter: [114.17, 22.27], flatZoom: 16,
        globeRotation: [-114.17, -22.27, 0], globeZoom: 16 } });
      host.requestRepaint('detailed-globe-physical-land');
    });
    const detailed = await settledPixel('political');
    expect(detailed[3]).toBe(255);
    expect(detailed[0]).toBeLessThan(250);
    expect(await page.evaluate(() => window.__landWorkerUrls.every(url => /assets\/worker-runtime\/[a-f0-9]{32}\//.test(url)))).toBe(true);
    expect(unversioned).toEqual([]); expect(errors).toEqual([]);
    if (renderer === 'webgl2') {
      const landRequests = await page.evaluate(() => window.__landMeshRequests.filter(request =>
        request.status === 'passed' && request.keys.some(key => key.startsWith('polygon:physical-land:'))));
      expect(landRequests.length).toBeGreaterThan(0);
      expect(landRequests.every(request => request.stats.assetHits > 0 && request.stats.builds === 0)).toBe(true);
      expect(landRequests.every(request => request.progress?.at(-1).completed === request.keys.length + 1)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`${renderer}-empty-time-land.png`) });
  } finally {
    const path = info.outputPath('mesh-requests.json');
    await writeFile(path, JSON.stringify(await page.evaluate(() => window.__landMeshRequests), null, 2));
    await info.attach('mesh-requests', { path, contentType: 'application/json' });
    const statePath = info.outputPath('viewer-state.json');
    await writeFile(statePath, JSON.stringify(await page.evaluate(() => ({
      document: window.__PANDOLAB_VIEWER__.documentState(),
      timeline: document.getElementById('timelineDateButton')?.textContent,
      timelineError: document.getElementById('timelineDateError')?.textContent,
      renderer: window.__PANDOLAB_VIEWER__.rendererStats(),
    })), null, 2));
    await info.attach('viewer-state', { path: statePath, contentType: 'application/json' });
    await browser.close();
  }
});
});
