import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceCache = resolve(process.env.PANDOLAB_TERRAIN_SOURCE_CACHE || '.terrain-preview-cache/source');
const demManifest = resolve('contracts/terrain/preview-dem-source.json');
const demOrigin = 'https://kimjeon-il.github.io/PandoLab-library-data';
test.use({ viewport: { width: 960, height: 720 }, launchOptions: {
  args: process.platform==='win32' ? ['--use-angle=d3d11']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
} });

async function terrainStyle(page, style) {
  // This suite exercises renderer transitions through the canonical style input.
  // Keep menu layout outside the terrain source and color transition checks.
  const input = page.locator('#terrain' + (style === 'physical' ? 'Physical' : 'Political') + 'Radio');
  await input.evaluate(element => element.click());
  await expect(input).toBeChecked();
}

test('WebGL DEM failure uses the new preview through color, gray and view changes', async ({ page, context }, testInfo) => {
  const errors = [], oldRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => { if (request.url().includes('/terrain/v0.12.6/')) oldRequests.push(request.url()); });
  await context.route(`${demOrigin}/terrain/**`, route => route.fulfill({ status: 503, body: 'fixed DEM failure' }));
  await page.goto('/?renderer=webgl2&debug=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainDatasetVersion), { timeout: 30000 }).toBe('0.13.3-p2');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTilesLoaded || 0),{timeout:30000}).toBeGreaterThan(0).catch(async error=>{console.log(await page.evaluate(()=>window.__PANDOLAB_GPU_METRICS__));throw error;});
  await terrainStyle(page, 'physical');
  await page.screenshot({ path: testInfo.outputPath('webgl-preview-color.png') });
  await terrainStyle(page, 'political');
  await page.evaluate(() => {
    const host = window.__PANDOLAB_MAP_HOST__, view = host.getViewState();
    host.setViewState({ projection: 'globe', view: { ...view, globeZoom: 8, globeRotation: [-180, -30, 0] } });
    host.requestRepaint('preview-dateline');
  });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetLevel)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('webgl-preview-dateline-gray.png') });
  expect(oldRequests).toEqual([]);expect(errors).toEqual([]);
});

test('Canvas Worker keeps preview while DEM is delayed and replaces it with detailed DEM', async ({ page, context }, testInfo) => {
  test.skip(!existsSync(resolve(sourceCache, 'terrain/v0.13.3/tint.webp')), 'Run the pinned preview generator with --rebuild-check to prepare DEM test inputs');
  const errors = [];
  await page.addInitScript(() => {
    window.__terrainFrames = [];
    window.__terrainWorkerEvents = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => {
        if (data.type === 'terrain-ready' || data.type === 'terrain-warning' || data.type === 'dem-diagnostic')
          window.__terrainWorkerEvents.push({ kind: data.type, key: data.key, message: data.message,
            stage: data.stage, bytes: data.bytes, at: performance.now() });
        if (data.type === 'frame') window.__terrainFrames.push({
          stats: data.terrainStats, revision: data.revision, style: data.styleRevision,
          complete: data.terrainComplete, frameId: data.frameId, renderRequestId: data.renderRequestId,
          presentationKey: data.presentationKey, backgroundPresentationKey: data.backgroundPresentationKey,
          backgroundOnly: data.backgroundOnly, physicalStyleRevision: data.physicalStyleRevision,
          projectGeneration: data.projectGeneration, surfaceQuality: data.surfaceQuality,
          geometryRevision: data.geometryRevision, physicalLandCount: data.physicalLandCount,
          physicalWaterCount: data.physicalWaterCount, physicalLandRevision: data.physicalLandRevision,
        });
      }); }
      postMessage(message, ...args) {
        if (message?.type === 'init')
          window.__terrainWorkerEvents.push({ kind: 'init', enabled: message.terrainEnabled,
            raster: message.terrainManifestUrl, dem: message.terrainDemManifestUrl });
        return super.postMessage(message, ...args);
      }
    };
  });
  // The classic Worker is instrumented only in this browser regression; no
  // production debug hooks or duplicate loaders are introduced.
  await page.route(/\/workers\/canvas-render-worker\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    let source = await response.text();
    const anchor = (before, after) => {
      if (source.split(before).length !== 2) throw new Error('DEM diagnostic anchor changed: ' + before.slice(0, 60));
      source = source.replace(before, after);
    };
    const mark = stage => `self.postMessage({type:'dem-diagnostic',stage:${JSON.stringify(stage)},at:performance.now()});`;
    anchor('    async function loadDemManifest(url) {',
      '    async function loadDemManifest(url) {\n      ' + mark('manifest-enter'));
    anchor('        const validationUrl = new URL(\'../modules/terrain-manifest.js\', self.location.href);',
      '        ' + mark('manifest-response') + '\n        const validationUrl = new URL(\'../modules/terrain-manifest.js\', self.location.href);');
    anchor('        const manifest = validateTerrainManifest(await response.json());',
      '        ' + mark('validator-imported') + '\n        const manifest = validateTerrainManifest(await response.json());\n        ' + mark('manifest-validated'));
    anchor('        const tintResponse = await fetch(tintUrl);',
      '        ' + mark('tint-request') + '\n        const tintResponse = await fetch(tintUrl);');

    anchor('        const tint = await readRgba(await tintResponse.blob(), true);',
      '        ' + mark('tint-response') + '\n        const tint = await readRgba(await tintResponse.blob(), true);\n        ' + mark('tint-decoded'));
    anchor('    async function readRgba(blob, preferImageDecoder = false) {',
      '    async function readRgba(blob, preferImageDecoder = false) {\n      ' + `self.postMessage({type:'dem-diagnostic',stage:'read-rgba-enter',bytes:blob.size,at:performance.now()});`);
    anchor('      const source = new OffscreenCanvas(bitmap.width, bitmap.height);\n      const read = source.getContext',
      '      ' + mark('bitmap-decoded') + '\n      const source = new OffscreenCanvas(bitmap.width, bitmap.height);\n      const read = source.getContext');
    await route.fulfill({ response, body: source });
  });
  const requests = [];
  context.on('request', request => {
    if (request.url().includes('/terrain/v0.13.3/'))
      requests.push({ kind: 'request', url: request.url().split('?')[0] });
  });
  context.on('response', response => {
    if (response.url().includes('/terrain/v0.13.3/'))
      requests.push({ kind: 'response', status: response.status(), url: response.url().split('?')[0] });
  });
  context.on('requestfailed', request => {
    if (request.url().includes('/terrain/v0.13.3/'))
      requests.push({ kind: 'failed', error: request.failure()?.errorText, url: request.url().split('?')[0] });
  });
  page.on('pageerror', error => errors.push(error.message));
  let releaseDem;
  const gate = new Promise(resolveGate => { releaseDem = resolveGate; });
  await context.route(`${demOrigin}/terrain/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/manifest.json')) {
      await gate;
      if (!page.isClosed()) await route.fulfill({ path: demManifest, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    // The generator pins the original L0/L1 DEM bytes under v0.13.0 while
    // v0.13.3 publishes those tiles with its updated tint and manifest.
    const relative = pathname.slice(pathname.indexOf('/terrain/') + 1);
    const tile = /^terrain\/v0\.13\.3\/([01])\/(\d+-\d+\.webp)$/.exec(relative);
    const file = resolve(sourceCache, tile
      ? `terrain/v0.13.0/${tile[1]}/${tile[2]}`
      : relative);
    if (!existsSync(file)) { await route.fulfill({ status: 503, body: 'fixed uncached detail failure' }); return; }
    await route.fulfill({ path: file, contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  try {
    await page.goto('/?renderer=canvas&debug=1', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer)).toBe('canvas-worker');
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainSource), { timeout: 30000 }).toBe('dem-preview');
    await terrainStyle(page, 'physical');
    await page.screenshot({ path: testInfo.outputPath('canvas-dem-delayed-preview.png') });
    releaseDem();
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection)).toBe('globe');
    await page.evaluate(() => {
      // This fixed fixture owns only L0/L1 tiles. Keep the camera within that
      // coverage while testing the real preview-to-DEM renderer transition.
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({projection:'globe',view:{...host.getViewState(),globeZoom:1,globeRotation:[0,0,0]}});
      host.requestRepaint('pinned-dem-fixture');
    });
    await expect.poll(() => page.evaluate(() => window.__terrainWorkerEvents.some(event =>
      event.kind === 'terrain-ready' && event.key === 'dem-manifest')), { timeout: 45000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__terrainWorkerEvents.some(event =>
      event.kind === 'terrain-ready' && String(event.key).startsWith('dem:'))), { timeout: 45000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainDetailTileCount || 0), { timeout: 30000 }).toBeGreaterThan(0);
    const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__);
    expect(metrics.terrainSource).toBe('dem-derived-canvas');
    expect(metrics.terrainDemCacheBytes).toBeGreaterThan(0);
    expect(metrics.terrainDatasetVersion).toBe('0.13.3');
    expect(metrics.terrainDemCacheBytes).toBeLessThanOrEqual(96 * 1024 * 1024);
    await terrainStyle(page, 'physical');
    await page.screenshot({ path: testInfo.outputPath('canvas-dem-detail-color.png') });
    await terrainStyle(page, 'political');
    await page.screenshot({ path: testInfo.outputPath('canvas-dem-detail-gray.png') });
    expect(errors).toEqual([]);
  } catch (error) {
    if (!page.isClosed()) {
      const diagnostics = await page.evaluate(() => ({ metrics: window.__PANDOLAB_GPU_METRICS__,
        frames: window.__terrainFrames.slice(-5), events: window.__terrainWorkerEvents.slice(-40) })).catch(() => null);
      console.log('CANVAS_DEM_DIAGNOSTIC '+JSON.stringify({ ...diagnostics, requests: requests.slice(-60) }));
    }
    throw error;
  } finally { releaseDem(); }
});

test('Canvas without OffscreenCanvas displays the bundled preview', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.OffscreenCanvas = undefined; });
  await context.route(`${demOrigin}/terrain/**`, route => route.fulfill({ status: 503, body: 'fixed DEM failure' }));
  await page.goto('/?renderer=canvas&debug=1', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer), { timeout: 30000 }).toBe('canvas2d');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRenderedLevel), { timeout: 30000 }).toBe(1);
  await terrainStyle(page, 'physical');
  await page.screenshot({ path: testInfo.outputPath('canvas2d-preview-color.png') });
  expect(errors).toEqual([]);
});
