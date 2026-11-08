import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "../helpers/synthetic-dem-terrain.mjs";
import * as __suiteDependency2 from "../../fixtures/viewer-project-package.mjs";
import * as __suiteDependency3 from "@playwright/test";
import * as __suiteDependency4 from "node:fs/promises";
import * as __suiteDependency5 from "@playwright/test";
import * as __suiteDependency6 from "node:path";
import * as __suiteDependency7 from "node:fs/promises";
import * as __suiteDependency8 from "@playwright/test";
import * as __suiteDependency9 from "@playwright/test";
import * as __suiteDependency10 from "../../../src/rendering/terrain-dem-shaders.js";
import * as __suiteDependency11 from "../helpers/synthetic-dem-terrain.mjs";

// Playwright worker-scoped options belong to the file, not nested feature groups.
featureTest.use({
  trace: 'off',screenshot: 'off',
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11']
    : ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'] },
});

// Preserved Viewer feature contract: terrain-zoom-continuity.spec.mjs
featureTest.describe("terrain-zoom-continuity", () => {
  const {  expect, test  } = __suiteDependency0;
  const { routeSyntheticDem } = __suiteDependency1;
  const {  createViewerProjectPackage  } = __suiteDependency2;
test.use({ viewport: { width: 1100, height: 760 } });

for (const initialQuality of ['preview', 'detail', 'startup']) {
test(`zoom keeps loaded ${initialQuality} terrain painting while the next LOD is delayed`, async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  const overview = initialQuality !== 'detail';
  if (initialQuality === 'startup') await page.addInitScript(() => {
    window.__countryMeshGate = new Promise(resolve => { window.__releaseCountryMesh = resolve; });
  });
  let heldLevel = -1;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/modules/gpu-map-renderer.js*', async route => {
    const response = await route.fetch(), anchor = 'prepareTerrain(activeFrameContext);';
    let source = await response.text();
    if (initialQuality === 'startup') {
      const countryAnchor = "      const nextDependencies = { source: 'country-mesh',";
      expect(source.split(countryAnchor)).toHaveLength(2);
      source = source.replace(countryAnchor, `      window.__countryMeshHeld = true; await window.__countryMeshGate;\n${countryAnchor}`);
    }
    expect(source.split(anchor)).toHaveLength(2);
    await route.fulfill({ response, body: source.replace(anchor, anchor + `
      window.__terrainDrawTargetLevel = currentTerrainReadiness().terrainLevel;
      if (window.__captureTerrainCoverage) {
        const host = window.__PANDOLAB_MAP_HOST__, points = [];
        const {width, height} = host.getViewportSize();
        for (let row=1; row<8; row++) for (let column=1; column<10; column++) {
          const coordinate=host.unproject([width*column/10,height*row/8]);
          if(coordinate)points.push(coordinate);
        }
        window.__terrainCoverage.push({points,tiles:preparedTerrain.map(tile=>tile.spec.bounds)});
      }`) });
  });
  await page.route('**/terrain/v*/**/*.webp*', async route => {
    const match = new URL(route.request().url()).pathname.match(/\/terrain\/v[^/]+\/(\d+)\/\d+-\d+\.webp$/);
    if (match && (Number(match[1]) === heldLevel || heldLevel === -2 && Number(match[1]) > 1)) await gate;
    if (!page.isClosed()) await route.continue();
  });
  await page.addInitScript(() => {
    window.__terrainDrawPixels = [];
    const prototype = window.WebGL2RenderingContext.prototype;
    const draw = prototype.drawElements;
    prototype.drawElements = function(...args) {
      const result = draw.apply(this, args);
      if (!window.__captureTerrainDraws) return result;
      const program = this.getParameter(this.CURRENT_PROGRAM);
      const location = program && this.getUniformLocation(program, 'uLevelSize');
      if (!location) return result;
      const size = this.getUniform(program, location);
      const viewport = this.getParameter(this.VIEWPORT);
      const pixels = new Uint8Array(viewport[2] * viewport[3] * 4);
      this.readPixels(0, 0, viewport[2], viewport[3], this.RGBA, this.UNSIGNED_BYTE, pixels);
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 64) {
        if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) colored++;
      }
      const level = Math.round(Math.log2(size[0] / 1350));
      const targetLevel = window.__terrainDrawTargetLevel;
      window.__terrainDrawPixels.push({ level, colored, targetLevel });
      if (window.__terrainDrawPixels.length > 20) window.__terrainDrawPixels.shift();
      if (colored > 100 && level === window.__terrainExpectedFallbackLevel && targetLevel > level) window.__captureTerrainDraws = false;
      return result;
    };
  });
  try {
    const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
    await page.goto(new URL('?renderer=webgl2&debug=1', site).href, { waitUntil: 'domcontentloaded' });
    if (initialQuality === 'startup') {
      await expect.poll(() => page.evaluate(() => !!window.__countryMeshHeld), { timeout: 90_000 }).toBe(true);
    } else await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    await page.evaluate(quality => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { flatCenter: [30, 40], flatZoom: 1, globeRotation: [-30, -40], globeZoom: quality === 'detail' ? 3 : 1 } });
      host.requestRepaint('terrain-zoom-baseline');
    }, initialQuality);
    await expect.poll(() => page.evaluate(quality => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return m?.terrainTargetLevel === (quality === 'detail' ? 3 : 1)
        && m.terrainTargetTilesLoaded === m.terrainTargetTileCount && m.terrainTintReady;
    }, initialQuality), { timeout: 60_000 }).toBe(true);
    const previousLevel = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel);
    if (overview) expect(previousLevel).toBe(1);
    if (initialQuality === 'startup') expect(await page.evaluate(() => {
      const s = window.__PANDOLAB_VIEWER__.rendererStats();
      return s.countriesPublishedGeneration === s.projectGeneration;
    })).toBe(false);
    expect(previousLevel).toBeLessThan(5);
    heldLevel = overview ? -2 : previousLevel + 1;
    await page.evaluate(level => {
      window.__terrainExpectedFallbackLevel = level; window.__captureTerrainDraws = true;
      window.__terrainCoverage = []; window.__captureTerrainCoverage = true;
    }, previousLevel);
    const bounds = await page.locator('#map').boundingBox();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(center.x, center.y);
    // Cross the globe's 2.2x country-detail threshold from the initial overview.
    if (initialQuality === 'startup') await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { ...host.getViewState(), globeZoom: 3 } });
      host.requestRepaint('terrain-zoom-before-countries');
    });
    else await page.mouse.wheel(0, -Math.log(overview ? 3 : 2) / 0.0013);
    if (overview) {
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetLevel), { timeout: 30_000 }).toBeGreaterThan(previousLevel);
      heldLevel = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel);
    } else await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetLevel), { timeout: 30_000 }).toBe(heldLevel);
    await expect.poll(() => page.evaluate(level => window.__terrainDrawPixels.some(draw => draw.level === level && draw.targetLevel > level && draw.colored > 100), previousLevel)).toBe(true);
    expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetTilesLoaded)).toBe(0);
    const assertCoverage = async () => {
      const frames = await page.evaluate(() => window.__terrainCoverage);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(frame.points.length).toBeGreaterThan(0);
        expect(frame.points.filter(([lon,lat])=>!frame.tiles.some(([west,north,east,south])=>
          lon>=west && lon<=east && lat>=south && lat<=north)), 'terrain gaps during zoom').toEqual([]);
      }
    };
    await assertCoverage();
    if (initialQuality === 'preview') {
      await page.evaluate(() => { window.__terrainDrawPixels = []; window.__captureTerrainDraws = true; });
      await page.mouse.down();
      await page.mouse.move(center.x + 40, center.y + 40, { steps: 5 });
      await page.mouse.up();
      await expect.poll(() => page.evaluate(level => window.__terrainDrawPixels.some(draw => draw.level === level && draw.targetLevel > level && draw.colored > 100), previousLevel)).toBe(true);
      expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetTilesLoaded)).toBe(0);
      await assertCoverage();
    }
    await page.screenshot({ path: test.info().outputPath('terrain-during-zoom.png') });
    // Pixel reads prove fallback coverage above; stop synchronizing the whole
    // software GPU on every tile draw while checking replacement completion.
    await page.evaluate(() => { window.__captureTerrainDraws = false; window.__captureTerrainCoverage = false; });
    release();
    // Camera-selected detail can stream twenty remote DEM textures on
    // SwiftShader. This checks eventual replacement, not a load-time SLA.
    await expect.poll(() => page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return m.terrainTargetTilesLoaded === m.terrainTargetTileCount && m.terrainRenderedLevel === m.terrainTargetLevel;
    }), { timeout: 120_000 }).toBe(true);
    expect(errors).toEqual([]);
  } catch (error) {
    console.log('TERRAIN_ZOOM_FAILURE', JSON.stringify(await page.evaluate(() => ({
      metrics: Object.fromEntries(Object.entries(window.__PANDOLAB_GPU_METRICS__)
        .filter(([key]) => key.startsWith('terrain') || ['p99CpuSubmitMs', 'effectivePixelRatio', 'interactionActive'].includes(key))),
      view: window.__PANDOLAB_MAP_HOST__.getViewState(),
      renderer: window.__PANDOLAB_VIEWER__.rendererStats().renderer,
    }))));
    throw error;
  } finally {
    release();
    if (initialQuality === 'startup' && !page.isClosed()) await page.evaluate(() => window.__releaseCountryMesh?.());
  }
});
}

for (const phase of ['loaded', 'startup']) {
test(`Canvas keeps land and ocean terrain through ${phase} zoom while new detail is delayed`, async ({ page }) => {
  test.setTimeout(240_000);
  if (phase === 'startup') {
    await page.addInitScript(() => {
      window.__countryMeshGate = new Promise(resolve => { window.__releaseCountryMesh = resolve; });
    });
    await page.route('**/modules/gpu-map-renderer.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = "      const nextDependencies = { source: 'country-mesh',";
      expect(source.split(anchor)).toHaveLength(2);
      await route.fulfill({response, body: source.replace(anchor,
        `      window.__countryMeshHeld = true; await window.__countryMeshGate;\n${anchor}`)});
    });
  }
  const workers = [], errors = [], heldRequests = [];
  let held = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  page.on('worker', worker => workers.push(worker));
  page.on('pageerror', error => errors.push(error.message));
  await routeSyntheticDem(page.context());
  await page.context().route('**/terrain/v*/**/*.webp*', async route => {
    if (held && /\/[1-9]\d*\/\d+-\d+\.webp/.test(new URL(route.request().url()).pathname)) {
      heldRequests.push(route.request().url()); await gate;
    }
    if (!page.isClosed()) await route.fallback();
  });
  await page.route('**/workers/canvas-render-worker.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = 'const sourceLevel = demLevel || targetLevel;';
    const painted = 'return terrainComplete && demSpecs.every(spec => demTiles.has(spec.key));';
    expect(source.split(anchor)).toHaveLength(2);
    expect(source.split(painted)).toHaveLength(2);
    await route.fulfill({response, body:source.replace(anchor, `
      const points = [], center = projection.translate();
      for(let row=1;row<8;row++)for(let column=1;column<10;column++) {
        const point=[width*column/10,height*row/8];
        if(message.projection==='globe' && Math.hypot(point[0]-center[0],point[1]-center[1])>projection.scale())continue;
        const coordinate=projection.invert(point);
        if(coordinate && coordinate.every(Number.isFinite))points.push(coordinate);
      }
      self.__terrainLast={scale:projection.scale(),baseReady,
        ready:terrainComplete&&(!terrainDemManifestUrl||!!terrainDemManifest&&!!terrainTint)&&demSpecs.every(spec=>demTiles.has(spec.key)),points,
        tiles:drawSpecs.filter(spec=>terrainTiles.has(spec.key)).map(spec=>spec.bounds)};
      self.__terrainCacheReadiness=()=>({baseReady:baseSpecs.every(spec=>terrainTiles.has(spec.key)),
        ready:targetSpecs.every(spec=>terrainTiles.has(spec.key))&&(!terrainDemManifestUrl||!!terrainDemManifest&&!!terrainTint)&&demSpecs.every(spec=>demTiles.has(spec.key)),
        missingBase:baseSpecs.filter(spec=>!terrainTiles.has(spec.key)).map(spec=>spec.key),
        missingDem:demSpecs.filter(spec=>!demTiles.has(spec.key)).map(spec=>spec.key),
        requests:[...demRequests.keys()],queued:demQueue.map(item=>item.spec.key),
        failures:[...demFailures.entries()],cacheBytes:demCacheBytes,cacheLimit:demCacheLimit});
      if(self.__captureTerrainCoverage)(self.__terrainFrames??=[]).push(self.__terrainLast);
      ` + anchor).replace(painted, `
      if(self.__captureTerrainCoverage)self.__terrainLast.pixels=[[32,39],[20,35]].map(coordinate=>{
        const point=projection(coordinate);
        return [...context.getImageData(Math.round(point[0]*dpr),Math.round(point[1]*dpr),1,1).data];
      });
      ` + painted)});
  });
  try {
    await page.goto('/?renderer=canvas&debug=1');
    if (phase === 'startup') await expect.poll(() => page.evaluate(() => !!window.__countryMeshHeld), {timeout:90000}).toBe(true);
    else await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().renderer)).toBe('canvas-worker');
    const worker = workers.find(worker=>worker.url().includes('canvas-render-worker'));
    expect(worker).toBeTruthy();
    // Match the WebGL overview baseline. Initial app framing is not the
    // subject of this test; the L0/L1 world reserve must precede zooming.
    const baselineScale = await page.evaluate(() => {
      const host=window.__PANDOLAB_MAP_HOST__;
      host.setViewState({projection:'globe',view:{...host.getViewState(),globeZoom:1,globeRotation:[-30,-40,0]}});
      host.requestRepaint('canvas-terrain-zoom-baseline');
      return host.getViewState().scale;
    });
    // Offscreen reserve uploads need not redraw an already-ready viewport.
    // Inspect the live resource owner rather than the last painted plan.
    await expect.poll(()=>worker.evaluate(expectedScale=>{
      const current=globalThis.__terrainCacheReadiness?.();
      return Math.abs(globalThis.__terrainLast?.scale-expectedScale)<0.1 && !!current?.ready&&current.baseReady;
    },baselineScale),{timeout:90000}).toBe(true);
    if (phase === 'startup') expect(await page.evaluate(() => {
      const s = window.__PANDOLAB_VIEWER__.rendererStats();
      return s.countriesPublishedGeneration === s.projectGeneration;
    })).toBe(false);
    const scale = await worker.evaluate(()=>{globalThis.__captureTerrainCoverage=true;globalThis.__terrainFrames=[];return globalThis.__terrainLast.scale;});
    held = true;
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    if (phase === 'startup') await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__, view = host.getViewState();
      host.setViewState({projection: 'globe', view: {...view, globeZoom: view.globeZoom * 3}});
      host.requestRepaint('canvas-zoom-before-countries');
    });
    else await page.mouse.wheel(0,-750);
    await expect.poll(()=>worker.evaluate(before=>globalThis.__terrainLast.scale>before*1.3 && !globalThis.__terrainLast.ready,scale),{timeout:60000}).toBe(true);
    await expect.poll(()=>heldRequests.length,{timeout:30000}).toBeGreaterThan(0);
    const frames = await worker.evaluate(()=>globalThis.__terrainFrames);
    expect(frames.length).toBeGreaterThan(0);
    for(const frame of frames) {
      expect(frame.points.length).toBeGreaterThan(0);
      expect(frame.points.filter(([lon,lat])=>!frame.tiles.some(([west,north,east,south])=>
        lon>=west && lon<=east && lat>=south && lat<=north)), 'Canvas terrain gaps during zoom').toEqual([]);
    }
    const paintedFrames=frames.filter(frame=>frame.pixels);
    expect(paintedFrames.length).toBeGreaterThan(0);
    for(const frame of paintedFrames)for(const rgba of frame.pixels) {
      expect(rgba[3]).toBe(255);
      expect(Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3)), 'land/ocean terrain color').toBeGreaterThan(5);
    }
    await page.screenshot({path:test.info().outputPath('canvas-terrain-during-zoom.png')});
    await worker.evaluate(()=>{globalThis.__captureTerrainCoverage=false;});
    held = false; release();
    await expect.poll(()=>worker.evaluate(()=>globalThis.__terrainLast.ready),{timeout:90000}).toBe(true);
    expect(errors).toEqual([]);
  } catch(error) {
    console.log('CANVAS_TERRAIN_FAILURE',JSON.stringify({
      view:await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState()),
      worker:await workers.find(worker=>worker.url().includes('canvas-render-worker')).evaluate(()=>({scale:globalThis.__terrainLast?.scale,ready:globalThis.__terrainLast?.ready,cache:globalThis.__terrainCacheReadiness?.()})),heldRequests,errors,
    }));
    throw error;
  } finally {
    release();
    if (phase === 'startup' && !page.isClosed()) await page.evaluate(() => window.__releaseCountryMesh?.());
  }
});
}


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


// One zoom/LOD feature suite for both the actual frame and DEM transition.
test.describe('Screen scale and physical map readiness', () => {
async function scaleTo(page, scale, stats) {
  await expect(page.locator('#map')).not.toHaveClass(/dragging/);
  const current = (await stats()).screenScale;
  await page.locator('#map').evaluate((map, { current, scale }) => {
    const rect = map.getBoundingClientRect();
    map.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      deltaY: -Math.log(scale / current) / 0.0013 }));
  }, { current, scale });
  await expect.poll(async () => Math.abs((await stats()).screenScale - scale), { timeout: 15000 }).toBeLessThan(1);
  await expect(page.locator('#map')).not.toHaveClass(/dragging/);
}

for (const setup of [
  { name: 'desktop WebGL', viewport: { width: 1440, height: 900 }, canvas: false },
  { name: 'mobile WebGL', viewport: { width: 390, height: 844 }, canvas: false },
  { name: 'desktop Canvas Worker', viewport: { width: 1440, height: 900 }, canvas: true },
]) test.describe(setup.name, () => {
  test.use({ viewport: setup.viewport, hasTouch: setup.name.startsWith('mobile') });
  test('screen scale governs quality and actual frame governs readiness', async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (setup.canvas) await page.addInitScript(() => {
      const getContext = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
      };
    });
    await page.goto('/?debug=1');
    await page.waitForFunction(() => !!window.__PANDOLAB_VIEWER__);
    const fixture = await createViewerProjectPackage('지도 준비 검증');
    await page.locator('#projectFileInput').setInputFiles({ name: 'map-readiness.gpkg',
      mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset), { timeout: 60000 }).toBe(fixture.project.baseDataset);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
    const stats = () => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats());
    await expect.poll(async () => (await stats()).canonicalMeshReady, { timeout: 90000 }).toBe(true);
    for (const [scale, band] of [[700, 'high'], [570, 'high'], [500, 'low'], [570, 'low'], [700, 'high']]) {
      await scaleTo(page, scale, stats);
      await expect.poll(async () => (await stats()).scaleBand, { message: `${setup.name} S=${scale}`, timeout: 15000 }).toBe(band);
      await expect.poll(async () => (await stats()).activeMeshQuality, { timeout: 30000 }).toBe('canonical');
    }
    const geometry = () => page.evaluate(() => JSON.stringify(window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities));
    const beforeDrag = await geometry();
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 25, { steps: 3 });
    await expect.poll(async () => (await stats()).activeMeshQuality, { timeout: 30000 }).toBe('canonical');
    await page.mouse.up();
    expect(await geometry()).toBe(beforeDrag);
    // Turning terrain off excludes its requests from completion without changing editing readiness.
    await page.evaluate(() => {
      document.getElementById('mapDisplayBtn').click();
      const toggle = document.getElementById('terrainNoneRadio');
      if (!toggle) throw new Error('Terrain visibility command is missing');
      toggle.click();
    });
    await expect.poll(async () => (await stats()).mapReadiness.status, { timeout: 15000 }).toBe('ready');
    await expect(page.locator('#mapPreparationNotice')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
});
});
// Preserved Viewer feature contract: terrain-inheritance.spec.mjs
featureTest.describe("terrain-inheritance", () => {
  const {  test, expect  } = __suiteDependency3;
  const {  writeFile  } = __suiteDependency4;
test.use({ viewport: { width: 1280, height: 800 } });

for (const renderer of ['webgl2', 'canvas']) for (const mode of ['political', 'physical']) {
  test(`child land enters the viewport and survives paint toggles (${renderer}, ${mode})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ renderer, mode }) => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
        backgrounds: { viewer: { terrainVisible: true, terrainStyle: mode } } }));
      if (renderer === 'canvas') {
        const original = window.HTMLCanvasElement.prototype.getContext;
        window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return String(type).includes('webgl') ? null : original.call(this, type, ...args);
        };
      }
    }, { renderer, mode });
    await page.route('**/modules/map-renderer-composition.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'export function createMapRenderer(dependencies, { presentMapPreparation, onMapPreparationStatus = null } = {}) {';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor, anchor + '\nwindow.__terrainPorts = dependencies;') });
    });
    await page.route('**/modules/gpu-scene.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = 'function replaceGpuSceneDomain(domain, { polygons = [], strokes = [] } = {}) {';
      expect(source).toContain(anchor);
      await route.fulfill({ response, body: source.replace(anchor,
        anchor + '\nif(domain === "territorial-units") window.__terrainPackets = polygons;') });
    });
    await page.goto(`/?debug=1&renderer=${renderer}`);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().renderer))
      .toBe(renderer === 'canvas' ? 'canvas-worker' : 'webgl2');
    const documentBefore = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
    const childId = await page.evaluate(() => window.__terrainPorts.territorialModel.entityRepository.list()
      .find(entity => entity.properties.metadata?.builtinSubunit?.sourceCountryId === 'HKG').id);
    const childKey = `territorial:entity:${childId}:fill`;
    const hasChild = () => page.evaluate(key => window.__terrainPackets.some(packet => packet.key === key), childKey);
    // Prepare a known offscreen set, then use real pointer navigation to enter it.
    await page.evaluate(async () => {
      const ports = window.__terrainPorts, state = ports.projectState.state;
      window.__PANDOLAB_MAP_HOST__.setViewState({ projection: 'globe',
        view: { ...state.view, globeRotation: [-101, -22.27, 0], globeZoom: 32 } });
      ports.domains.renderingDomain.invalidateOverlayStyle('offscreen-test-fixture');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(await hasChild()).toBe(false);
    const box = await page.locator('#map').boundingBox();
    const drag=13.17/(.22/Math.sqrt(32)),start=box.x+box.width*.8;
    await page.mouse.move(start, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(start-drag, box.y + box.height * .5, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('#map')).not.toHaveClass(/dragging/);
    await expect.poll(hasChild, { timeout: 5000 }).toBe(true);
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="objects"]').click();
    const color = page.locator('[data-layer-style-color="objects"]');
    await expect(color).toBeChecked();
    const replacements = () => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats().canvasWorkerMessagesByType['replace-data'] || 0);
    const replacementsBefore = await replacements();
    const receipts = [];
    for (const visible of [false, true]) {
      await color.locator('..').click();
      await expect(color).toBeChecked({ checked: visible });
      await expect.poll(() => page.evaluate(key => window.__terrainPackets.find(packet => packet.key === key)?.style.fillAlpha,
        childKey)).toBeCloseTo(visible ? mode === 'physical' ? .22 : .68 : 0);
      const packet = await page.evaluate(key => {
        const item = window.__terrainPackets.find(packet => packet.key === key);
        return { key: item.key, role: item.role, style: item.style };
      }, childKey);
      expect(packet.role).toBe('territorial-fill');
      expect(packet.style.color).toBe(visible ? '#cc3333' : '');
      if (renderer === 'canvas') expect(await replacements(), 'paint toggles must not resend the world geometry').toBe(replacementsBefore);
      receipts.push({ visible, packet, replacements: await replacements() });
    }
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState())).toEqual(documentBefore);
    expect(errors).toEqual([]);
    await writeFile(testInfo.outputPath('child-land-and-transport.json'), JSON.stringify({ renderer, mode, receipts }, null, 2));
  });
}
});
// Preserved Viewer feature contract: terrain-progressive.spec.mjs
featureTest.describe("terrain-progressive", () => {
  const {  expect, test  } = __suiteDependency5;
  const path = __suiteDependency6.default;
  const {  readFile  } = __suiteDependency7;
const DEM_ORIGIN = 'https://kimjeon-il.github.io/PandoLab-library-data';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  deviceScaleFactor: 2,
  // Trace/driver options are selected once at the file worker boundary.
});
test.skip(process.env.PANDOLAB_VERIFY_LIVE_DEM !== '1' && !process.env.PANDOLAB_DEM_OUTPUT_DIR,
  'Opt in to hosted DEM network regression or provide generated DEM assets');

test('slow mobile globe retains loaded DEM while requesting promoted detail directly', async ({ page }) => {
  test.setTimeout(240_000);
  const started = [];
  let delayFine = false, initialLevel, manifest;
  let releaseFine;
  const fineGate = new Promise(resolve => { releaseFine = resolve; });
  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  await page.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await canonicalGate;
    if (!page.isClosed()) await route.continue();
  });
  await page.route(`${DEM_ORIGIN}/terrain/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    const output = process.env.PANDOLAB_DEM_OUTPUT_DIR;
    if (pathname.endsWith('/manifest.json')) {
      if (output) {
        const file = path.join(output, pathname.match(/\/terrain\/v[^/]+\/(.*)$/)[1]);
        manifest = JSON.parse(await readFile(file, 'utf8'));
        await route.fulfill({ path: file, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
      } else {
        const response = await route.fetch();
        manifest = await response.json();
        await route.fulfill({ response });
      }
      return;
    }
    const tile = pathname.match(/\/terrain\/v\d+\.\d+\.\d+\/(\d+)\/(\d+)-(\d+)\.webp$/);
    if (tile) {
      started.push({ level: Number(tile[1]), column: Number(tile[2]), row: Number(tile[3]) });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (delayFine && Number(tile[1]) > initialLevel) await fineGate;
    }
    if (output) {
      const relative = pathname.match(/\/terrain\/v[^/]+\/(.*)$/)[1];
      await route.fulfill({ path: path.join(output, relative),
        contentType: pathname.endsWith('.webp') ? 'image/webp' : 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' } });
    } else await route.continue().catch(error => {
      if (!route.request().failure() && !page.isClosed()) throw error;
    });
  });

  try {
    await page.goto('/?renderer=webgl2&debug=1&demTerrain=preview', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRepresentation),
      { timeout: 120_000 }).toBe('dem-relief-v1');
    await expect.poll(() => started.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect(started.slice(0, 2).every(tile => tile.level === 0)).toBe(true);
    // Camera requirement from CSS scale and DPR, independent of the
    // renderer's selected level and country mesh quality.
    initialLevel = await page.evaluate(levels => {
      const view = window.__PANDOLAB_MAP_HOST__.getViewState();
      const requiredWidth = 2 * Math.PI * view.scale * Math.min(2, window.devicePixelRatio) * 1.12;
      return (levels.find(level => level.width >= requiredWidth) || levels.at(-1)).id;
    }, manifest.levels);
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__;
      return { targetLevel: metrics?.terrainTargetLevel, renderedLevel: metrics?.terrainRenderedLevel,
        complete: metrics?.terrainTargetTileCount > 0 && metrics.terrainTargetTilesLoaded === metrics.terrainTargetTileCount,
        settled: metrics?.terrainTargetTilesSettled };
    }), { timeout: 90_000 }).toEqual({ targetLevel: initialLevel, renderedLevel: initialLevel, complete: true, settled: true });
    expect([...new Set(started.map(tile => tile.level))].sort()).toEqual([0, initialLevel]);
    releaseCanonical();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    delayFine = true;
    await page.evaluate(() => {
      const map = document.getElementById('map');
      const rect = map.getBoundingClientRect();
      const current = window.__PANDOLAB_MAP_HOST__.getViewState().zoom;
      map.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        deltaY: -Math.log(3 / current) / 0.0013 }));
    });
    await expect.poll(() => page.evaluate(level => {
      const metrics = window.__PANDOLAB_GPU_METRICS__;
      return metrics?.terrainTargetLevel > level && metrics.terrainRenderedLevel === level;
    }, initialLevel), { timeout: 60_000 }).toBe(true);
    const targetLevel = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel);
    expect(started.filter(tile => tile.level > initialLevel).every(tile => tile.level === targetLevel)).toBe(true);

    for (const longitude of [-90, 0, 90]) {
      await page.evaluate(value => {
        const host = window.__PANDOLAB_MAP_HOST__;
        const view = host.getViewState();
        host.setViewState({ projection: 'globe', view: { ...view, globeRotation: [value, 0] } });
        host.requestRepaint('terrain-progressive-rotation');
      }, longitude);
      await page.waitForTimeout(90);
    }
    const priorRequests = started.length;
    releaseFine();
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__;
      return { level: metrics?.terrainTargetLevel, rendered: metrics?.terrainRenderedLevel,
        loaded: metrics?.terrainTargetTilesLoaded, target: metrics?.terrainTargetTileCount,
        settled: metrics?.terrainTargetTilesSettled };
    }), { timeout: 90_000 }).toMatchObject({ level: targetLevel, rendered: targetLevel, settled: true }).catch(async error => {
      console.log(`TERRAIN_MOBILE_FAILURE ${JSON.stringify(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__))}`);
      throw error;
    });
    const complete = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__);
    expect(complete.terrainTargetTilesLoaded).toBe(complete.terrainTargetTileCount);
    expect(complete.terrainFailureCount).toBe(0);
    console.log(`TERRAIN_MOBILE ${JSON.stringify({ initialLevel, targetLevel, loaded: complete.terrainTargetTilesLoaded })}`);
    const afterRotation = started.slice(priorRequests).filter(tile => tile.level > 0);
    expect(afterRotation.length).toBeGreaterThan(0);
    const currentViewRequests = afterRotation.filter(tile => {
      const width = 1350 * 2 ** tile.level;
      const pixelWidth = Math.min(1024, width - tile.column * 1024);
      const centerLongitude = -180 + (tile.column * 1024 + pixelWidth / 2) / width * 360;
      const distanceFromFinalView = Math.abs((((centerLongitude + 90) + 540) % 360) - 180);
      return distanceFromFinalView < 80;
    });
    expect(currentViewRequests.length).toBeGreaterThan(0);
  } finally {
    releaseCanonical();
    releaseFine();
    await page.close();
  }
});
});
// Preserved Viewer feature contract: terrain-request-priority.spec.mjs
featureTest.describe("terrain-request-priority", () => {
  const {  expect, test  } = __suiteDependency8;
test.use({ viewport: { width: 1100, height: 760 } });

test('rotating the globe loads the new viewport while obsolete responses remain stalled', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  let phase = 'startup', changedAt = 0;
  let release;
  const stalled = new Promise(resolve => { release = resolve; });
  const oldRequests = new Set(), newRequests = [], cancelled = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (oldRequests.has(request.url())) cancelled.push(request.url()); });
  await page.route('**/terrain/v*/**/*.webp*', async route => {
    const match = new URL(route.request().url()).pathname.match(/\/terrain\/v[^/]+\/(\d+)\/\d+-\d+\.webp$/);
    if (match && Number(match[1]) > 0) {
      if (phase === 'old') { oldRequests.add(route.request().url()); await stalled; }
      else if (phase === 'new') newRequests.push({ url: route.request().url(), delayMs: Date.now() - changedAt });
    }
    if (!page.isClosed()) await route.continue().catch(error => {
      if (!route.request().failure() && !page.isClosed()) throw error;
    });
  });
  const move = rotation => page.evaluate(value => {
    const host = window.__PANDOLAB_MAP_HOST__;
    host.setViewState({ projection: 'globe', view: {
      flatCenter: [0, 0], flatZoom: 1, globeRotation: value, globeZoom: 3,
    } });
    host.requestRepaint('terrain-priority-rotation');
  }, rotation);
  try {
    const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
    await page.goto(new URL('?renderer=webgl2&debug=1', site).href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    phase = 'old';
    await move([0, 0, 0]);
    await expect.poll(() => oldRequests.size, { timeout: 15_000 }).toBe(6);
    phase = 'new'; changedAt = Date.now();
    await move([-160, 0, 0]);
    await expect.poll(() => newRequests.length, { timeout: 3_000 }).toBeGreaterThan(0);
    await expect.poll(() => cancelled.length, { timeout: 3_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetTilesLoaded || 0),
      { timeout: 45_000 }).toBeGreaterThan(0);
    const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__);
    expect(metrics.terrainFailureCount).toBe(0);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ newViewportRequestDelayMs: newRequests[0].delayMs, cancelled: cancelled.length,
      loadedCurrentTiles: metrics.terrainTargetTilesLoaded }));
    await page.screenshot({ path: test.info().outputPath('current-globe-tiles.png') });
  } finally { release(); }
});
});
// Preserved Viewer feature contract: terrain-interaction-streaming.spec.mjs
featureTest.describe("terrain-interaction-streaming", () => {
  const { expect,test } = __suiteDependency9;
  const { terrainDemFragmentSource } = __suiteDependency10;
  const { routeSyntheticDem } = __suiteDependency11;
test.use({viewport:{width:1440,height:900}});

// Flat encoded elevation with deliberately coarse precomputed shade. The
// production shader must derive the same detailed light before/during input.
for (const version of [1,2]) test(`WebGL${version} prepared elevation keeps detailed shading without a later settle transition`,async({page})=>{
  await page.goto('about:blank');
  const rgba=await page.evaluate(({fragment,version})=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const gl=canvas.getContext(version===2?'webgl2':'webgl');if(!gl)throw new Error(`WebGL${version} required`);
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
    const program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,`${version===2?'#version 300 es\n':''}precision highp float;${version===2?'in':'attribute'} vec2 aPosition;${version===2?'out':'varying'} vec2 vUv;${version===2?'out':'varying'} vec2 vLonLat;${version===2?'out':'varying'} float vDepth;void main(){gl_Position=vec4(aPosition,0,1);vUv=vec2(0.5);vLonLat=vec2(0);vDepth=1.0;}`));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const texture=(unit,width,height,rgba)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);};
    const pixels=new Uint8Array(4*4*4);for(let i=0;i<pixels.length;i+=4)pixels.set([46,224,128,255],i);
    texture(0,4,4,pixels);texture(1,1,1,new Uint8Array([200,100,50,255]));
    const loc=name=>gl.getUniformLocation(program,name);gl.uniform1i(loc('uTerrain'),0);gl.uniform1i(loc('uTint'),1);gl.uniform1i(loc('uMode'),1);gl.uniform2f(loc('uTextureSize'),4,4);gl.uniform2f(loc('uLevelSize'),43200,21600);gl.uniform1f(loc('uPhysicalStyle'),0);gl.uniform1f(loc('uLandPass'),1);gl.uniform1f(loc('uDarkTheme'),0);
    gl.drawArrays(gl.TRIANGLES,0,3);const result=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,result);return [...result];
  },{fragment:terrainDemFragmentSource(version),version});
  expect(rgba).toEqual([148,148,148,255]);
});

for(const viewport of [{width:1440,height:900,dpr:1},{width:390,height:844,dpr:2}]) test.describe(`${viewport.width}px terrain streaming`,()=>{
test.use({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:viewport.dpr,hasTouch:viewport.dpr===2});
test('current-view detail reaches an actual WebGL frame while the pointer remains held',async({page})=>{
  const manifest=await routeSyntheticDem(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__detailedTerrainDraws=[];
    const proto=window.WebGL2RenderingContext.prototype,getLocation=proto.getUniformLocation,draw=proto.drawElements;
    const programs=new WeakMap();
    proto.getUniformLocation=function(program,name){const value=getLocation.call(this,program,name);if(name==='uLevelSize')programs.set(program,value);return value;};
    proto.drawElements=function(...args){const result=draw.apply(this,args);if(window.__captureTerrainDraws){const program=this.getParameter(this.CURRENT_PROGRAM),location=program&&programs.get(program);if(location)window.__detailedTerrainDraws.push(this.getUniform(program,location)[0]);}return result;};
  });
  await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status),{timeout:30000}).toBe('ready');
  const box=await page.locator('#map').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2);
  try{
    await page.locator('#map').evaluate(map=>{const r=map.getBoundingClientRect();map.dispatchEvent(new window.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-1800}));});
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.screenScale>=642&&s.terrainTargetLevel===5&&s.terrainRenderedLevel===5&&s.terrainDetailedShade&&s.mapReadiness.status==='ready';}),{timeout:5000}).toBe(true);
    expect(errors).toEqual([]);
  }finally{await page.mouse.up();}
  if(viewport.dpr===1){
    // Globe camera scale drives terrain preparation independently of scene reprojection.
    const zoom=async scale=>{
      await page.locator('#map').evaluate((map,scale)=>{const r=map.getBoundingClientRect(),current=window.__PANDOLAB_VIEWER__.rendererStats().screenScale;map.dispatchEvent(new window.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-Math.log(scale/current)/.0013}));},scale);
      await expect.poll(()=>page.evaluate(scale=>Math.abs(window.__PANDOLAB_VIEWER__.rendererStats().screenScale-scale),scale)).toBeLessThan(1);
    };
    await zoom(450);await zoom(620);
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.screenScale>615&&s.screenScale<625&&s.mapReadiness.status==='ready';})).toBe(true);
    await page.evaluate(()=>{window.__detailedTerrainDraws=[];window.__captureTerrainDraws=true;});
    await zoom(650);
    await expect.poll(()=>page.evaluate(width=>window.__detailedTerrainDraws.includes(width),manifest.levels[2].width),{timeout:3000}).toBe(true);
    await zoom(3000);
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.terrainTargetLevel===4&&s.mapReadiness.status==='ready';})).toBe(true);
    await page.mouse.down();
    try{
      await zoom(3200);
      await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.terrainTargetLevel===5&&s.terrainRenderedLevel===5&&s.mapReadiness.status==='ready';}),{timeout:3000}).toBe(true);
    }finally{await page.mouse.up();}
    expect(errors).toEqual([]);
  }
});
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
});
