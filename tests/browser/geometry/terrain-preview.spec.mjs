import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "node:fs";
import * as __suiteDependency2 from "node:path";
import * as __suiteDependency3 from "@playwright/test";
import * as __suiteDependency4 from "@playwright/test";

// Preserved Viewer feature contract: terrain-preview.spec.mjs
featureTest.describe("terrain-preview", () => {
  const {  expect, test  } = __suiteDependency0;
  const {  existsSync  } = __suiteDependency1;
  const {  resolve  } = __suiteDependency2;
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
  const errors = [], workerWarnings = [];
  page.on('console', message => {
    if (['error','warning'].includes(message.type())) workerWarnings.push(message.text().slice(0,1000));
  });
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
    // Do not judge a renderer-default metric before a physical bitmap has
    // actually been admitted. DEM remains gated during this first-frame check.
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.firstBackgroundFrameMs || 0),
      { timeout: 75000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainSource),
      { timeout: 30000 }).toBe('dem-preview');
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
      console.log('CANVAS_DEM_DIAGNOSTIC '+JSON.stringify({ ...diagnostics, workerWarnings:workerWarnings.slice(-15), requests: requests.slice(-60) }));
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
});
// Preserved Viewer feature contract: terrain-preview-quality.spec.mjs
featureTest.describe("terrain-preview-quality", () => {
  const { expect,test } = __suiteDependency3;
test.use({viewport:{width:1000,height:760},deviceScaleFactor:1,trace:'off',
  launchOptions:{args:process.platform==='win32'?['--use-angle=d3d11']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']}});

// Decode the actual screenshot rather than a discarded WebGL backbuffer.
async function samples(page,buffer){
  return page.evaluate(async bytes=>{
    const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;
    const context=copy.getContext('2d');context.drawImage(image,0,0);image.close();
    const canvas=document.querySelector('canvas.gpu-map-canvas'),rect=canvas.getBoundingClientRect();
    const host=window.__PANDOLAB_MAP_HOST__;
    return [[83,33],[85,33],[87,33],[80,25],[83,25],[86,25]].map(point=>{
      const xy=host.project(point);
      return [...context.getImageData(Math.round(xy[0]*copy.width/rect.width),Math.round(xy[1]*copy.height/rect.height),1,1).data];
    });
  },Array.from(buffer));
}

for(const renderer of ['webgl2','canvas'])test(`selected ${renderer} relief distinguishes Tibetan plateaus and Indian plains in color and grayscale`,async({page},testInfo)=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('pandolab-user-preferences',JSON.stringify({version:2,backgrounds:{viewer:{terrainVisible:true,terrainStyle:'physical'}}})));
  await page.goto(`/?renderer=${renderer}&debug=1`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
  await page.evaluate(()=>{
    const host=window.__PANDOLAB_MAP_HOST__;
    host.setViewState({projection:'globe',view:{flatCenter:[85,31],flatZoom:1,globeRotation:[-85,-31,0],globeZoom:5.5}});
    host.requestRepaint('selected-terrain-quality');
  });
  await expect.poll(()=>page.evaluate(()=>{
    const s=window.__PANDOLAB_VIEWER__.rendererStats();
    return s.terrainReady&&s.mapReadiness.status==='ready'&&s.terrainDatasetVersion==='0.13.3'
      &&Math.abs(s.screenScale-window.__PANDOLAB_MAP_HOST__.getViewState().scale)<1
      &&(s.renderer==='webgl2'||s.renderer==='canvas-worker');
  }),{timeout:150000}).toBe(true).catch(async error=>{
    console.log('TERRAIN_QUALITY_FAILURE',JSON.stringify(await page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return {renderer:s.renderer,readiness:s.mapReadiness,terrain:Object.fromEntries(Object.entries(s).filter(([key])=>key.startsWith('terrain')))};
    })));throw error;
  });
  const settled=async()=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect.poll(()=>page.evaluate(()=>{
      const s=window.__PANDOLAB_VIEWER__.rendererStats();
      return s.mapReadiness.status==='ready'&&(s.renderer!=='canvas-worker'
        ||s.canvasDisplayedStyleRevision===s.canvasStyleRevision&&!s.canvasWorkerBusy&&!s.canvasWorkerHasPendingFrame);
    }),{timeout:60000}).toBe(true);
  };
  await settled();
  const visibleLand=await samples(page,await page.locator('canvas.gpu-map-canvas').first().screenshot());
  for(const rgba of visibleLand)expect(Math.max(rgba[0],rgba[1])-rgba[2],'land is actually painted before the overlay capture').toBeGreaterThan(8);
  await page.screenshot({path:testInfo.outputPath('terrain-with-borders-and-labels.png')});
  await page.evaluate(()=>{
    for(const id of ['objectsVisible','labelsVisible','riversVisible','lakesVisible']){
      const input=document.getElementById(id);if(input?.checked)input.click();
    }
  });
  await settled();
  const before=await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState());
  for(const style of ['physical','political']){
    await page.locator(style==='physical'?'#terrainPhysicalRadio':'#terrainPoliticalRadio').evaluate(input=>input.click());
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:90000});
    await settled();
    const image=await page.locator('canvas.gpu-map-canvas').first().screenshot({path:testInfo.outputPath(`selected-${style}.png`)});
    const colors=await samples(page,image);
    for(const rgba of colors)expect(rgba[3]).toBe(255);
    if(style==='political'){
      for(const rgba of colors)expect(Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3))).toBeLessThanOrEqual(2);
      const median=values=>values.sort((a,b)=>a-b)[1];
      expect(median(colors.slice(0,3).map(c=>c[0]))-median(colors.slice(3).map(c=>c[0]))).toBeGreaterThan(20);
    }else expect(colors.slice(3).some(c=>c[1]>c[0]+10&&c[1]>c[2]+10)).toBe(true);
    expect(await page.evaluate(()=>window.__PANDOLAB_MAP_HOST__.getViewState())).toEqual(before);
    console.log(JSON.stringify({renderer,style,colors}));
  }
  expect(errors).toEqual([]);
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
// Preserved Viewer feature contract: terrain-ocean-loading.spec.mjs
featureTest.describe("terrain-ocean-loading", () => {
  const {  expect, test  } = __suiteDependency4;
test.use({ viewport: { width: 1100, height: 760 }, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

test('western Pacific keeps the ocean substrate while DEM colors are still loading', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  let releaseTint;
  const tintGate = new Promise(resolve => { releaseTint = resolve; });
  const timings = [], started = new Map(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/\d+\/\d+-\d+\.webp/.test(request.url())) started.set(request.url(), Date.now()); });
  page.on('requestfinished', request => {
    if (started.has(request.url())) timings.push({ tile: new URL(request.url()).pathname, ms: Date.now() - started.get(request.url()) });
  });
  await page.route('**/tint.webp*', async route => { await tintGate; if (!page.isClosed()) await route.continue(); });
  await page.addInitScript(() => {
    window.__oceanLoadingPixels = [];
    const prototype = window.WebGL2RenderingContext.prototype, draw = prototype.drawArrays;
    prototype.drawArrays = function(...args) {
      const result = draw.apply(this, args);
      if (!window.__oceanLoadingSample) return result;
      const program = this.getParameter(this.CURRENT_PROGRAM), land = this.getUniformLocation(program, 'uOceanColor');
      if (!land) return result;
      const point = window.__oceanLoadingSample, viewport = this.getParameter(this.VIEWPORT);
      const rgba = new Uint8Array(4);
      this.readPixels(Math.floor(point[0]), viewport[3] - Math.floor(point[1]) - 1, 1, 1, this.RGBA, this.UNSIGNED_BYTE, rgba);
      window.__oceanLoadingPixels.push([...rgba]);
      if (window.__oceanLoadingPixels.length > 100) window.__oceanLoadingPixels.shift();
      return result;
    };
  });
  try {
    const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
    await page.goto(new URL('?renderer=webgl2&debug=1', site).href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { flatCenter: [0, 0], flatZoom: 1, globeRotation: [-125, -20, 0], globeZoom: 3 } });
      const point = host.project([145, 15]);
      const canvas = document.querySelector('.gpu-map-canvas'), bounds = canvas.getBoundingClientRect();
      window.__oceanLoadingSample = [point[0] * canvas.width / bounds.width, point[1] * canvas.height / bounds.height];
      host.requestRepaint('western-pacific-loading');
    });
    await expect.poll(() => page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return m?.terrainTargetTileCount > 0 && m.terrainTargetTilesLoaded === m.terrainTargetTileCount;
    }), { timeout: 45_000 }).toBe(true);
    expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTintReady)).toBe(false);
    console.log(JSON.stringify({ networkTimings: timings, metrics: await page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return { level: m.terrainTargetLevel, loaded: m.terrainTargetTilesLoaded, target: m.terrainTargetTileCount, failures: m.terrainFailureCount };
    }), oceanPixels: await page.evaluate(() => window.__oceanLoadingPixels.slice(-3)) }));
    await expect.poll(() => page.evaluate(() => window.__oceanLoadingPixels.some(p => p[3] && p[2] > p[0] + 15)), { timeout: 5_000 }).toBe(true);
    await page.screenshot({ path: test.info().outputPath('western-pacific-without-land-tint.png') });
    expect(errors).toEqual([]);
  } finally { releaseTint(); }
});
});
