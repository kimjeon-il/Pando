import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

const snapshot = page => page.evaluate(() => window.__terrainSnapshot());
const nextFrame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const covered = (tiles, [lon, lat]) => tiles.some(({ bounds: [west, north, east, south] }) =>
  lon >= west && lon <= east && lat >= south && lat <= north);
const expectCoverage = data => {
  expect(data.visibleCoordinates.length).toBeGreaterThan(0);
  expect(data.visibleCoordinates.filter(point => !covered(data.prepared, point)), 'visible terrain gaps').toEqual([]);
};

for (const source of ['dem', 'raster']) {
  test(`${source} keeps terrain resources across country LOD, style changes and delayed zoom tiles`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = [], requests = [];
    let delayDetail = true, release, releaseBase, baseResponses = 0;
    let gate = new Promise(resolve => { release = resolve; });
    const baseGate = new Promise(resolve => { releaseBase = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/\d+\/\d+-\d+\.webp/.test(request.url())) requests.push(request.url()); });
    await page.route('**/terrain/v*/**/*.webp*', async route => {
      const tile = new URL(route.request().url()).pathname.match(/\/(\d+)\/\d+-\d+\.webp$/);
      if (tile && Number(tile[1]) === 0) {
        const response = await route.fetch();
        baseResponses++;
        await baseGate;
        if (!page.isClosed()) await route.fulfill({ response });
        return;
      }
      if (delayDetail && tile && Number(tile[1]) > 0) await gate;
      if (!page.isClosed()) await route.continue().catch(error => {
        if (!route.request().failure() && !page.isClosed()) throw error;
      });
    });
    await page.route('**/assets/js/modules/gpu-map-renderer.js*', async route => {
      const response = await route.fetch();
      let body = await response.text();
      const anchor = 'dispose, attach,';
      expect(body.split(anchor)).toHaveLength(2);
      body = body.replace(anchor, `${anchor}
        terrainSnapshot: window.__terrainSnapshot = (() => {
          const textures = new WeakMap(); let nextTexture = 0;
          return () => {
            const host = window.__PANDOLAB_MAP_HOST__, visibleCoordinates = [];
            if (host) {
              const { width, height } = host.getViewportSize();
              for (let row = 1; row < 8; row++) for (let column = 1; column < 10; column++) {
                const coordinate = host.unproject([width * column / 10, height * row / 8]);
                if (coordinate) visibleCoordinates.push(coordinate);
              }
            }
            return ({
            ...terrainPreparation.stats(), quality: activeMeshQuality,
            visibleCoordinates,
            style: state.physicalSettings.terrainStyle,
            prepared: preparedTerrain.map(tile => {
              if (!textures.has(tile.texture)) textures.set(tile.texture, ++nextTexture);
              return { key: tile.spec.key, level: tile.spec.level, bounds: tile.spec.bounds, texture: textures.get(tile.texture) };
            }),
          }); };
        })(),`);
      const preparation = 'prepareTerrain(activeFrameContext);';
      expect(body.split(preparation)).toHaveLength(2);
      body = body.replace(preparation, `${preparation}
        if (window.__captureTerrainFrames) window.__terrainFrames.push(window.__terrainSnapshot());`);
      await route.fulfill({ response, body });
    });
    await page.addInitScript(() => {
      window.__terrainFrames = []; window.__terrainDraws = [];
      const prototype = window.WebGL2RenderingContext.prototype, draw = prototype.drawElements;
      prototype.drawElements = function(...args) {
        const result = draw.apply(this, args);
        const program = this.getParameter(this.CURRENT_PROGRAM);
        const style = program && this.getUniformLocation(program, 'uPhysicalStyle');
        if (style) {
          let pixel = null;
          if (window.__terrainProbe && window.__captureTerrainPixels) {
            const point = window.__PANDOLAB_MAP_HOST__.project(window.__terrainProbe);
            const canvas = document.querySelector('.gpu-map-canvas'), box = canvas.getBoundingClientRect();
            const viewport = this.getParameter(this.VIEWPORT);
            const x = Math.floor(point[0] * canvas.width / box.width);
            const y = viewport[3] - Math.floor(point[1] * canvas.height / box.height) - 1;
            if (x >= 0 && x < viewport[2] && y >= 0 && y < viewport[3]) {
              const rgba = new Uint8Array(4);
              this.readPixels(x, y, 1, 1, this.RGBA, this.UNSIGNED_BYTE, rgba);
              pixel = [...rgba];
            }
          }
          window.__terrainDraws.push({ style: this.getUniform(program, style),
            stencil: this.isEnabled(this.STENCIL_TEST),
            pass: this.getParameter(this.STENCIL_FUNC) === this.NOTEQUAL ? 'ocean' : 'land', pixel });
          if (window.__terrainDraws.length > 100) window.__terrainDraws.shift();
        }
        return result;
      };
    });
    const settleTiles = async () => {
      try {
        await expect.poll(async () => {
          const data = await snapshot(page);
          return data.prepared.length > 0 && data.terrainTargetTileCount > 0
            && data.terrainTargetTilesLoaded === data.terrainTargetTileCount && data.terrainTilesLoading === 0
            && data.terrainPendingDecodedBytes === 0 && data.prepared.every(tile => tile.level === data.terrainLevel);
        }, { timeout: 60_000 }).toBe(true);
      } catch (error) {
        console.log('TERRAIN_WAIT_FAILURE', JSON.stringify({ data: await snapshot(page), errors,
          uploads: await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().uploads) }));
        throw error;
      }
    };
    const setStyle = async style => {
      await page.locator(style === 'political' ? '#terrainPoliticalRadio' : '#terrainPhysicalRadio').evaluate(input => {
        window.__terrainDraws = []; window.__captureTerrainPixels = true; input.click();
      });
      await nextFrame(page);
      expect((await snapshot(page)).style).toBe(style);
      const drawn = await page.evaluate(() => window.__terrainDraws);
      await page.evaluate(() => { window.__captureTerrainPixels = false; });
      expect(drawn.length).toBeGreaterThan(0);
      expect(drawn.every(draw => draw.style === (style === 'physical' ? 1 : 0) && draw.stencil)).toBe(true);
      expect(drawn.some(draw => draw.pass === 'land')).toBe(true);
      if (style === 'physical') expect(drawn.some(draw => draw.pass === 'ocean')).toBe(true);
      const landPixels = drawn.filter(draw => draw.pass === 'land' && draw.pixel?.[3]).map(draw => draw.pixel);
      expect(landPixels.some(pixel => {
        const chroma = Math.max(...pixel.slice(0, 3)) - Math.min(...pixel.slice(0, 3));
        return style === 'physical' ? chroma > 8 : chroma <= 1;
      }), 'terrain itself must draw grayscale/color pixels before country paint').toBe(true);
    };
    try {
      await page.goto(`/?renderer=webgl2&debug=1${source === 'raster' ? '&demTerrain=raster' : ''}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRepresentation))
        .toBe(source === 'dem' ? 'dem-relief-v1' : 'raster-rgba-v1');
      await expect.poll(() => baseResponses, { timeout: 60_000 }).toBe(2);
      expect((await snapshot(page)).prepared).toEqual([]);
      await page.mouse.move(20, 20);
      releaseBase();
      let base;
      // Keep delivering real pointer moves more often than the 500ms upload
      // quiet window. Base textures must become GPU-ready during hover.
      for (let step = 0; step < 80; step++) {
        await page.mouse.move(20 + step % 40, 20);
        await page.waitForTimeout(100);
        base = await snapshot(page);
        if (base.prepared.length) break;
      }
      expectCoverage(base);
      expect(base.prepared.every(tile => tile.level === 0)).toBe(true);
      for (let lat = -80; lat <= 80; lat += 20) for (let lon = -170; lon <= 170; lon += 20) {
        expect(covered(base.prepared, [lon, lat]), `cold base gap at ${lon},${lat}`).toBe(true);
      }
      await page.evaluate(() => { window.__captureTerrainFrames = true; });
      await page.screenshot({ path: test.info().outputPath(`${source}-cold-base-during-hover.png`) });
      release(); delayDetail = false;
      await page.locator('#flatBtn').evaluate(button => button.click());
      await page.locator('#resetViewBtn').evaluate(button => button.click());
      expect(await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom)).toBe(1);
      await expect.poll(async () => (await snapshot(page)).terrainLevel).toBe(0);
      await settleTiles();
      if (source === 'dem') await expect.poll(async () => (await snapshot(page)).terrainTintReady).toBe(true);
      const low = await snapshot(page);
      expect(low.quality).toBe('preview');
      expect(low.terrainLevel).toBe(0, 'flat overview uses camera LOD even when countries use preview');
      await page.evaluate(() => { window.__captureTerrainFrames = true; window.__terrainProbe = [32, 39]; });
      const priorRequests = requests.length;
      for (const style of ['political', 'physical']) {
        await setStyle(style);
        const current = await snapshot(page);
        expect(current.prepared).toEqual(low.prepared);
        expect(current.terrainUploadCount).toBe(low.terrainUploadCount);
        expect(requests.length).toBe(priorRequests);
      }
      await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
      await expect.poll(async () => (await snapshot(page)).quality).toBe('canonical');
      expect((await snapshot(page)).terrainLevel).toBe(0);
      expect((await snapshot(page)).prepared).toEqual(low.prepared);
      await page.locator('#mobileEditBtn').evaluate(button => button.click());
      await expect.poll(async () => (await snapshot(page)).quality).toBe('preview');
      expect((await snapshot(page)).prepared).toEqual(low.prepared);
      gate = new Promise(resolve => { release = resolve; }); delayDetail = true;
      await page.evaluate(() => {
        const map = document.getElementById('map'), rect = map.getBoundingClientRect();
        const zoom = window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
        map.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          deltaY: -Math.log(3 / zoom) / 0.0013 }));
      });
      await expect.poll(async () => (await snapshot(page)).terrainLevel).toBeGreaterThan(0);
      const waiting = await snapshot(page);
      expectCoverage(waiting);
      expect(waiting.quality).toBe('canonical');
      expect(waiting.terrainTargetTilesLoaded).toBe(0);
      expect(waiting.prepared.length).toBeGreaterThan(0);
      expect(waiting.prepared.every(tile => tile.level < waiting.terrainLevel)).toBe(true);
      expect(waiting.prepared.some(tile => low.prepared.some(old => old.texture === tile.texture))).toBe(true);
      for (const style of ['political', 'physical']) {
        await setStyle(style);
        expect((await snapshot(page)).prepared).toEqual(waiting.prepared);
        await page.screenshot({ path: test.info().outputPath(`${source}-${style}-waiting.png`) });
      }
      await page.locator('#globeBtn').evaluate(button => button.click());
      await expect(page.locator('#globeBtn')).toHaveAttribute('aria-pressed', 'true');
      const globeBox = await page.locator('#map').boundingBox();
      for (let turn = 0; turn < 2; turn++) {
        const before = await page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().rotation);
        await page.mouse.move(globeBox.x + globeBox.width * 0.75, globeBox.y + globeBox.height * 0.45);
        await page.mouse.down();
        await page.mouse.move(globeBox.x + globeBox.width * 0.25, globeBox.y + globeBox.height * 0.5, { steps: 4 });
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().rotation))
          .not.toEqual(before);
        await nextFrame(page);
        const rotated = await snapshot(page);
        expectCoverage(rotated);
        expect(rotated.prepared.some(tile => base.prepared.some(old => old.texture === tile.texture))).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`${source}-rotated-base.png`) });
      await page.locator('#flatBtn').evaluate(button => button.click());
      await page.locator('#resetViewBtn').evaluate(button => button.click());
      await page.mouse.move(globeBox.x + globeBox.width / 2, globeBox.y + globeBox.height / 2);
      await page.mouse.wheel(0, -Math.log(3) / 0.0013);
      await expect.poll(async () => (await snapshot(page)).terrainLevel).toBe(waiting.terrainLevel);
      await nextFrame(page);
      release(); delayDetail = false;
      await settleTiles();
      const ready = await snapshot(page);
      expect(ready.prepared.every(tile => tile.level === ready.terrainLevel)).toBe(true);
      const bounds = await page.locator('#map').boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, Math.log(3) / 0.0013);
      await expect.poll(async () => (await snapshot(page)).quality).toBe('preview');
      await settleTiles();
      expect((await snapshot(page)).prepared).toEqual(low.prepared);
      const frames = await page.evaluate(() => window.__terrainFrames);
      expect(frames.length).toBeGreaterThan(4);
      for (const frame of frames) expectCoverage(frame);
      expect(errors).toEqual([]);
      console.log(`TERRAIN_CONTINUITY ${JSON.stringify({ source, frames: frames.length,
        minimumPrepared: Math.min(...frames.map(frame => frame.prepared.length)), targetLevel: ready.terrainLevel })}`);
    } finally { releaseBase(); release(); }
  });
}

test('raster surfaces exhausted world-base loading failure through the real operation boundary', async ({ page }) => {
  test.setTimeout(150_000);
  let failedBaseRequests = 0;
  const errors = [], diagnostics = [];
  // Shared operation feedback can be replaced by a later completed operation.
  // Observe the real visible alert at publication, including its accessible copy.
  await page.addInitScript(() => {
    window.__terrainFailureAlerts = [];
    new MutationObserver(() => {
      const notice = document.getElementById('actionStatus');
      if (notice?.getAttribute('role') !== 'alert' || !notice.getAttribute('aria-label')?.includes('PL-TERRAIN-001')) return;
      window.__terrainFailureAlerts.push({ label: notice.getAttribute('aria-label'),
        text: notice.textContent, visible: !notice.classList.contains('hidden') && notice.getClientRects().length > 0 });
    }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/HTTP 503|PL-TERRAIN-001/.test(message.text())) diagnostics.push(message.text()); });
  await page.route('**/terrain/v*/0/0-0.webp*', async route => {
    failedBaseRequests++;
    await route.fulfill({ status: 503, body: 'Terrain source temporarily unavailable',
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('/?renderer=webgl2&debug=1&demTerrain=raster', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => failedBaseRequests, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(() => page.evaluate(() => window.__terrainFailureAlerts), { timeout: 30_000 }).toEqual(
    expect.arrayContaining([expect.objectContaining({ visible: true,
      label: '지형 타일을 불러오지 못했습니다. · PL-TERRAIN-001',
      text: expect.stringContaining('PL-TERRAIN-001') })]));
  await expect.poll(() => page.evaluate(() => {
    const metrics = window.__PANDOLAB_GPU_METRICS__;
    return metrics.terrainTargetTileCount > 0 && metrics.terrainTargetTilesLoaded === metrics.terrainTargetTileCount;
  }), { timeout: 60_000 }).toBe(true);
  expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainRenderedLevel)).toBe(-1);
  expect(diagnostics.some(message => message.includes('HTTP 503'))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('raster-base-failure-reported.png') });
});
