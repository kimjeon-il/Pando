import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 760 }, trace: 'off',
  launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

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
  await page.context().route('**/terrain/v*/**/*.webp*', async route => {
    if (held && /\/[1-9]\d*\/\d+-\d+\.webp/.test(new URL(route.request().url()).pathname)) {
      heldRequests.push(route.request().url()); await gate;
    }
    if (!page.isClosed()) await route.continue();
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
    await expect.poll(()=>worker.evaluate(()=>!!globalThis.__terrainLast?.ready && globalThis.__terrainLast.baseReady),{timeout:90000}).toBe(true);
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
    await expect.poll(()=>heldRequests.length,{timeout:30000}).toBeGreaterThan(0);
    await expect.poll(()=>worker.evaluate(before=>globalThis.__terrainLast.scale>before*1.3 && !globalThis.__terrainLast.ready,scale),{timeout:60000}).toBe(true);
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
      worker:await workers.find(worker=>worker.url().includes('canvas-render-worker')).evaluate(()=>({scale:globalThis.__terrainLast?.scale,ready:globalThis.__terrainLast?.ready})),heldRequests,errors,
    }));
    throw error;
  } finally {
    release();
    if (phase === 'startup' && !page.isClosed()) await page.evaluate(() => window.__releaseCountryMesh?.());
  }
});
}
