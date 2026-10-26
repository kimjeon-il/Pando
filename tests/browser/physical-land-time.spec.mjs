import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off' });

for (const renderer of ['canvas', 'webgl2']) test(`${renderer} keeps physical land across empty time and hidden objects with immutable Workers`, async ({ playwright }, info) => {
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
      backgrounds: { viewer: { terrainVisible: true, terrainStyle: 'physical' } } }));
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
    const anchor = 'export function createMapRenderer(dependencies, { productMode }) {';
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
  if (renderer === 'canvas') await page.route('**/workers/canvas-render-worker.js*', async route => {
    const response = await route.fetch(), source = await response.text();
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
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="objects"]').click();
    await page.locator('[data-layer-style-color="objects"]').locator('..').click();
    await expect(page.locator('[data-layer-style-color="objects"]')).not.toBeChecked();
    await expect.poll(() => page.evaluate(key => window.__landPaints?.[key], childKey)).toBe(0);
    await page.locator('#mapDisplayBtn').click();
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
    await page.locator('#timelinePreviousMonth').click();
    await expect.poll(visibleCount, { timeout: 30_000 }).toBeLessThan(initialCount);
    const empty = await settledPixel();
    console.log(renderer, 'empty', empty, await page.evaluate(() => window.__landProbeMeta));
    expect(empty).toEqual(before);
    await page.locator('#timelineNextMonth').click();
    await expect.poll(visibleCount, { timeout: 30_000 }).toBe(initialCount);
    await expect.poll(() => page.evaluate(key => window.__landPaints?.[key], childKey)).toBe(0);
    const restored = await settledPixel();
    console.log(renderer, 'restored', restored, await page.evaluate(() => window.__landProbeMeta));
    expect(restored).toEqual(before);
    await page.keyboard.press('Escape');
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="objects"]').click();
    await page.locator('#objectsVisible').locator('..').click();
    await expect.poll(visibleCount).toBe(0);
    await page.locator('#mapDisplayBtn').click();
    expect(await settledPixel()).toEqual(before);
    // Epoch counts accepted read projections, including the two cursor moves.
    const stateAfter = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState());
    expect({ ...stateAfter, epoch: 0 }).toEqual({ ...documentBefore, epoch: 0 });
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(snapshotBefore);
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="terrain"]').click();
    await page.locator('#terrainPoliticalRadio').locator('..').click();
    await page.locator('#mapDisplayBtn').click();
    const gray = await settledPixel('political');
    expect(gray[3]).toBe(255);
    expect(Math.max(...gray.slice(0, 3)) - Math.min(...gray.slice(0, 3))).toBeLessThanOrEqual(1);
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
