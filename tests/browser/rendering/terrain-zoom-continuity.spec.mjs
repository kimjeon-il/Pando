import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "../helpers/synthetic-dem-terrain.mjs";
import * as __suiteDependency3 from "@playwright/test";
import * as __suiteDependency4 from "node:fs/promises";
import * as __suiteDependency5 from "@playwright/test";
import * as __suiteDependency6 from "node:path";
import * as __suiteDependency7 from "node:fs/promises";
import * as __suiteDependency8 from "@playwright/test";
import * as __suiteDependency9 from "@playwright/test";
import * as __suiteDependency11 from "../helpers/synthetic-dem-terrain.mjs";

// Playwright worker-scoped options belong to the file, not nested feature groups.
featureTest.use({
  trace: 'off',screenshot: 'off',
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11']
    : ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox'] },
});

// The accepted numerical frame remains visible while a finer DEM stage loads.
featureTest.describe('terrain-zoom-continuity',()=>{
  const {test,expect}=__suiteDependency0;
  const {routeSyntheticDem}=__suiteDependency1;
  test.use({viewport:{width:1100,height:760}});
  for(const renderer of ['webgl2','canvas'])test(renderer+' retains numerical terrain during delayed detail',async({page,context},testInfo)=>{
    test.setTimeout(180000);
    await routeSyntheticDem(context);
    let held=false,release,delayed=0;
    const gate=new Promise(resolve=>{release=resolve;});
    await context.route('**/terrain/v*/**/*.webp*',async route=>{
      if(held){delayed++;await gate;}
      if(!page.isClosed())await route.fallback();
    });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const browserWarnings=[];
    page.on('console',message=>{if(['error','warning'].includes(message.type()))browserWarnings.push(message.text().slice(0,380));});
    page.on('requestfailed',request=>browserWarnings.push('REQUEST '+request.url().slice(0,250)+' '+request.failure()?.errorText));
    const stats=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats());
    // Do not treat fetched DEM as an admitted on-screen picture.
    // A pre-geometry white frame is not a terrain regression baseline.
    const countTerrainPixels=bytes=>page.evaluate(async pixelsIn=>{
      const image=await createImageBitmap(new Blob([new Uint8Array(pixelsIn)],{type:'image/png'}));
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let colored=0;
      for(let i=0;i<pixels.length;i+=64)
        if(pixels[i+3]&&Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>20)colored++;
      return colored;
    },[...bytes]);
    try {
      await page.goto('/?renderer='+renderer+'&debug=1',{waitUntil:'domcontentloaded'});
      await expect.poll(()=>page.evaluate(()=>{
        const s=window.__PANDOLAB_VIEWER__?.rendererStats(),r=s?.mapReadiness;
        return r?.mapReady===true&&r?.terrainReady===true&&['ready','limited'].includes(r?.status);
      }),{timeout:90000}).toBe(true).catch(async error=>{
        console.log('TERRAIN_BOOT_DIAGNOSTIC '+JSON.stringify({renderer,errors,logs:browserWarnings.slice(-35),stats:await stats().catch(reason=>({failure:reason.message}))}).slice(0,14500));
        throw error;
      });
      expect((await stats()).renderer).toBe(renderer==='canvas'?'canvas-worker':renderer);
      await page.evaluate(()=>{
        const host=window.__PANDOLAB_MAP_HOST__;
        host.setViewState({projection:'globe',view:{...host.getViewState(),globeRotation:[-30,-40,0],globeZoom:1}});
        host.requestRepaint('numerical-terrain-baseline');
      });
      await expect.poll(async()=>{const s=await stats();return s.mapReadiness.mapReady&&s.mapReadiness.terrainReady&&s.screenScale>0;},{timeout:60000}).toBe(true);
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
      // Establish that the old complete frame is *visibly* present before a new LOD is withheld.
      await expect.poll(async()=>countTerrainPixels(await page.locator('canvas.gpu-map-canvas').first().screenshot()),
        {timeout:45000}).toBeGreaterThan(100);
      const baseline=await stats();held=true;
      await page.evaluate(()=>{
        const host=window.__PANDOLAB_MAP_HOST__;
        host.setViewState({projection:'globe',view:{...host.getViewState(),globeZoom:3}});
        host.requestRepaint('numerical-terrain-delayed-detail');
      });
      await expect.poll(()=>delayed,{timeout:30000}).toBeGreaterThan(0);
      await expect.poll(async()=>{const s=await stats();return s.terrainTargetLevel>baseline.terrainTargetLevel&&!s.mapReadiness.terrainReady;},{timeout:30000}).toBe(true);
      await expect.poll(()=>page.evaluate(()=>{
        const s=window.__PANDOLAB_VIEWER__.rendererStats(),v=window.__PANDOLAB_MAP_HOST__.getViewState();
        return Math.abs(s.screenScale-v.scale)<1 && (s.renderer!=='canvas-worker'
          ||s.canvasDisplayedStyleRevision===s.canvasStyleRevision&&!s.canvasWorkerBusy&&!s.canvasWorkerHasPendingFrame);
      }),{timeout:30000}).toBe(true);
      const shot=await page.locator('canvas.gpu-map-canvas').first().screenshot({path:testInfo.outputPath('delayed-numerical-detail.png')});
      const painted=await countTerrainPixels(shot);
      expect(painted).toBeGreaterThan(100);
      held=false;release();
      await expect.poll(async()=>{const s=await stats();return s.mapReadiness.terrainReady&&s.terrainTargetLevel>baseline.terrainTargetLevel;},{timeout:90000}).toBe(true);
      expect(errors).toEqual([]);
    }finally{held=false;release();}
  });
});
// Preserved Viewer feature contract: terrain-inheritance.spec.mjs
featureTest.describe("terrain-inheritance", () => {
  const {  test, expect  } = __suiteDependency3;
  const {  writeFile  } = __suiteDependency4;
test.use({ viewport: { width: 1280, height: 800 } });

for (const renderer of ['webgl2', 'canvas']) for (const mode of ['political', 'physical']) {
  test(`child land enters the viewport and follows map themes (${renderer}, ${mode})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ renderer, mode }) => {
      localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
        appearance: { mapStyle: mode === 'physical' ? 'standard' : 'classic' } }));
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
    const originalTheme=mode==='physical'?'standard':'classic';
    const nextTheme=mode==='physical'?'classic':'standard';
    const receipts=[];
    for (const theme of [nextTheme,originalTheme]) {
      await page.locator('#preferencesBtn').click();
      await page.locator(`input[name="preferencesMapStyle"][value="${theme}"]`).locator('..').click();
      await page.locator('#preferencesCloseBtn').click();
      await expect(page.locator('html')).toHaveAttribute('data-map-style',theme);
      await expect.poll(()=>page.evaluate(key=>window.__terrainPackets.find(packet=>packet.key===key)?.style.fillAlpha,childKey))
        .toBeCloseTo(theme==='standard'?0:0.45);
      const packet=await page.evaluate(key=>{
        const item=window.__terrainPackets.find(packet=>packet.key===key);
        return {key:item.key,role:item.role,style:item.style};
      },childKey);
      expect(packet.role).toBe('territorial-fill');
      expect(packet.style.color).toBe(theme==='standard'?'#cc3333':'');
      receipts.push({theme,packet});
    }
    expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState())).toEqual(documentBefore);
    expect(errors).toEqual([]);
    await writeFile(testInfo.outputPath('child-land-and-transport.json'),JSON.stringify({renderer,mode,receipts},null,2));
  });
}
});
// Preserved Viewer feature contract: terrain-progressive.spec.mjs
featureTest.describe("terrain-progressive", () => {
  const {  expect, test  } = __suiteDependency5;
  const path = __suiteDependency6.default;
  const {  readFile  } = __suiteDependency7;

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
  await page.route('**/terrain/v*/**', async route => {
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
    await page.goto('/?renderer=webgl2&debug=1', { waitUntil: 'domcontentloaded' });
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
  const { routeSyntheticDem } = __suiteDependency11;
test.use({viewport:{width:1440,height:900}});

// Numerical shade and fractional pixel parity are covered by terrain-dem-shader.spec.mjs.
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
  await expect.poll(()=>page.evaluate(()=>{
    const s=window.__PANDOLAB_VIEWER__.rendererStats(),r=s.mapReadiness;
    return r.mapReady&&r.terrainReady&&(r.status==='ready'||r.status==='limited'&&s.terrainResolutionLimited===true);
  }),{timeout:30000}).toBe(true).catch(async error=>{
    console.log('TERRAIN_INTERACTION_BOOT_DIAGNOSTIC '+JSON.stringify({viewport,errors,stats:await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats())}).slice(0,13000));
    throw error;
  });
  const box=await page.locator('#map').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2);
  try{
    await page.locator('#map').evaluate(map=>{const r=map.getBoundingClientRect();map.dispatchEvent(new window.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-1800}));});
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.screenScale>=642&&s.terrainTargetLevel>0&&s.terrainRenderedLevel===s.terrainTargetLevel&&s.mapReadiness.terrainReady&&(s.mapReadiness.status==='ready'||s.mapReadiness.status==='limited'&&s.terrainResolutionLimited===true);}),{timeout:5000}).toBe(true);
    expect(errors).toEqual([]);
  }finally{await page.mouse.up();}
  await page.evaluate(()=>{window.__detailedTerrainDraws=[];window.__captureTerrainDraws=true;window.__PANDOLAB_MAP_HOST__.requestRepaint('terrain-current-level-evidence');});
  const target=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().terrainTargetLevel);
  await expect.poll(()=>page.evaluate(width=>window.__detailedTerrainDraws.includes(width),manifest.levels[target].width),{timeout:3000}).toBe(true);
  expect(errors).toEqual([]);
});
});
});
