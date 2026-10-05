import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 760 }, trace: 'off', reducedMotion: 'reduce',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });
const site = baseURL => process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;

test('multiply strokes preserve opacity at centers and antialiased edges', async ({ page, baseURL }) => {
  await page.goto(new URL('assets/js/build-meta.js', site(baseURL)).href);
  const result = await page.evaluate(async root => {
    const { createRenderDevice } = await import(new URL('assets/js/modules/render-device.js', root).href);
    const { createGpuStrokeRenderer } = await import(new URL('assets/js/modules/gpu-stroke-renderer.js', root).href);
    const canvas = new OffscreenCanvas(64, 32), gl = canvas.getContext('webgl2');
    const names = new Map(), halfWidths = [];
    const location = gl.getUniformLocation.bind(gl), uniform = gl.uniform1f.bind(gl);
    gl.getUniformLocation = (program, name) => { const value = location(program, name); names.set(value, name); return value; };
    gl.uniform1f = (value, number) => { if (names.get(value) === 'uHalfWidth') halfWidths.push(number); uniform(value, number); };
    const renderer = createGpuStrokeRenderer();
    if (!renderer.initialize(createRenderDevice({ gl, canvas }))) throw new Error('Stroke initialization failed');
    gl.viewport(0, 0, 64, 32); gl.clearColor(0.4, 0.4, 0.4, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const drawn = renderer.drawBatches([{ key: 'multiply', geometryRevision: 1,
      startsEnds: new Float32Array([-2, 0, 2, 0]), blendMode: 'multiply',
      style: { color: '#ff0000', width: 8, alpha: 0.5, cap: 'round', join: 'round' } }],
    { viewport: [64, 32], translate: [32, 16], scale: 400, mode: 1, flatCenter: [0, 0], worldOffsets: [0],
      rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1] });
    const pixels = new Uint8Array(64 * 32 * 4); gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const sample = (x, y) => [...pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
    const reference = new OffscreenCanvas(64, 32).getContext('2d');
    reference.fillStyle = '#666666'; reference.fillRect(0, 0, 64, 32);
    reference.globalCompositeOperation = 'multiply'; reference.globalAlpha = 0.5;
    reference.strokeStyle = '#ff0000'; reference.lineWidth = 8;
    reference.beginPath(); reference.moveTo(18, 16); reference.lineTo(46, 16); reference.stroke();
    const expected = [...reference.getImageData(32, 16, 1, 1).data].slice(0, 3);
    const edges = [[32, 11], [32, 12], [18, 16], [17, 16]].map(([x, y]) => sample(x, y));
    const center = sample(32, 16);
    const frame = { viewport: [64, 32], translate: [32, 16], scale: 400, mode: 1, flatCenter: [0, 0], worldOffsets: [0],
      rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1] };
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.drawBatches([{ key: 'normal', startsEnds: new Float32Array([-2, 0, 2, 0]),
      style: { color: '#ff0000', width: 8, alpha: 0.5, cap: 'round' } }], frame);
    gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const normalCenter = sample(32, 16);
    reference.globalCompositeOperation = 'source-over'; reference.stroke();
    // Compare the normal blend against a fresh Canvas substrate.
    reference.globalAlpha = 1; reference.fillStyle = '#666666'; reference.fillRect(0, 0, 64, 32);
    reference.globalAlpha = 0.5; reference.stroke();
    const normalExpected = [...reference.getImageData(32, 16, 1, 1).data].slice(0, 3);
    const joins = [];
    for (const join of ['round', 'bevel', 'miter']) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.drawBatches([{ key: `join-${join}`, blendMode: 'multiply', startsEnds: new Float32Array([-2, -1, 0, 1, 0, 1, 2, -1]),
        style: { color: '#ff0000', width: 8, alpha: 0.5, cap: 'round', join } }], frame);
      gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      joins.push(Math.max(...Array.from({ length: 64 * 32 }, (_, index) => pixels[index * 4])));
    }
    const { createRenderSceneBuilder } = await import(new URL('assets/js/modules/render-scene.js', root).href);
    const preview = createRenderSceneBuilder().build({ strokes: [{ key: 'preview', geometry: { type: 'LineString', coordinates: [[-2, 0], [2, 0]] },
      style: { color: '#ffffff', width: 5, scaleWithView: true, antiAlias: false } }] }).strokes;
    halfWidths.length = 0; gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.drawBatches(preview, { ...frame, projection: 'globe', size: { width: 1000, height: 1000 }, scale: 200 });
    const scaledHalfWidths = [...halfWidths];
    renderer.dispose(); return { succeeded: drawn.succeeded, center, expected, edges, normalCenter, normalExpected, joins, scaledHalfWidths };
  }, site(baseURL));
  expect(result.succeeded).toBe(true);
  result.center.forEach((value, index) => expect(Math.abs(value - result.expected[index])).toBeLessThanOrEqual(3));
  for (const edge of result.edges) expect(edge[0]).toBeLessThanOrEqual(105);
  result.normalCenter.forEach((value, index) => expect(Math.abs(value - result.normalExpected[index])).toBeLessThanOrEqual(3));
  for (const red of result.joins) expect(red).toBeLessThanOrEqual(105);
  expect(result.scaledHalfWidths.length).toBeGreaterThan(0);
  expect(result.scaledHalfWidths.every(width => Math.abs(width * 2 - 2.25) < 0.0001)).toBe(true);
});

test('Canvas receives the graticule scene and paints mixed overlays with protected base pixels', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const coreRequests = [];
  page.on('request', request => { if (request.url().includes('canvas-scene-composition-core.js')) coreRequests.push(request.url()); });
  await page.addInitScript(() => {
    window.__graticulePackets = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      for (const packet of message.sceneStrokes || []) if (packet.key === 'base:graticule') window.__graticulePackets.push(packet.key);
      return post.call(this, message, ...args);
    };
  });
  await page.goto(new URL('?renderer=canvas&debug=1', site(baseURL)).href);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__graticulePackets.length), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator('path.map-graticule')).toHaveCount(0);
  const build = await page.evaluate(() => window.PANDOLAB_BUILD_META.assetRevision);
  expect(coreRequests.some(url => new URL(url).searchParams.get('v') === build)).toBe(true);
  const pixels = await page.evaluate(async root => {
    await import(new URL('assets/js/workers/canvas-scene-composition-core.js', root).href);
    const { createRenderSceneBuilder } = await import(new URL('assets/js/modules/render-scene.js', root).href);
    const { createRenderDevice } = await import(new URL('assets/js/modules/render-device.js', root).href);
    const { createGpuStrokeRenderer } = await import(new URL('assets/js/modules/gpu-stroke-renderer.js', root).href);
    const { createGpuPolygonOverlayPass } = await import(new URL('assets/js/modules/gpu-polygon-overlay-pass.js', root).href);
    const { prepareGpuBaseScene } = await import(new URL('assets/js/modules/gpu-scene-preparation.js', root).href);
    const { drawGpuBaseScene } = await import(new URL('assets/js/modules/gpu-base-scene-pass.js', root).href);
    const scene = createRenderSceneBuilder().build({ polygons: [{ key: 'upper', order: 200,
      geometry: { type: 'Polygon', coordinates: [[[-5, -5], [-5, 5], [5, 5], [5, -5], [-5, -5]]] },
      style: { color: '#ff0000', fillAlpha: 1 } }], strokes: [{ key: 'base:graticule', order: 100,
      geometry: { type: 'LineString', coordinates: [[-10, 0], [10, 0]] }, style: { color: '#0000ff', width: 4, alpha: 1 } }] });
    const context = new OffscreenCanvas(100, 100).getContext('2d');
    context.fillStyle = '#00ff00'; context.fillRect(0, 0, 100, 100);
    const path = window.d3.geo.path().projection(window.d3.geo.equirectangular().scale(200).translate([50, 50])).context(context);
    window.PandoLabCanvasSceneComposition.drawOverlays(context, path, scene.polygons, scene.strokes, 1, {
      key: 'protected', draw: mask => { mask.fillStyle = '#ffffff'; mask.fillRect(48, 0, 4, 100); },
    });
    const sample = (x, y) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
    const forward = { grid: sample(20, 50), covered: sample(40, 50), protected: sample(50, 55) };
    const glCanvas = new OffscreenCanvas(100, 100), gl = glCanvas.getContext('webgl2', { stencil: true });
    const device = createRenderDevice({ gl, canvas: glCanvas });
    const polygonOverlayPass = createGpuPolygonOverlayPass(), strokeRenderer = createGpuStrokeRenderer();
    if (!polygonOverlayPass.initialize(device) || !strokeRenderer.initialize(device)) throw new Error('GPU scene initialization failed');
    const frame = { viewport: [100, 100], translate: [50, 50], scale: 200, mode: 1, flatCenter: [0, 0], worldOffsets: [0],
      rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1] };
    const water = createRenderSceneBuilder().build({ polygons: [{ key: 'water', geometry: { type: 'Polygon',
      coordinates: [[[-0.573, -15], [-0.573, 15], [0.573, 15], [0.573, -15], [-0.573, -15]]] },
      style: { color: '#00ff00', fillAlpha: 1 } }] }).polygons[0];
    polygonOverlayPass.ensureResource(water);
    const drawGpu = current => {
      const prepared = prepareGpuBaseScene({ scene: current, frame, presentedStrokeDomains: new Map() }, { polygonOverlayPass, strokeRenderer });
      drawGpuBaseScene({ gl, frame, width: 100, height: 100, countriesVisible: false, countries: {}, prepared }, {
        polygonOverlayPass, strokeRenderer, drawCountryBoundaryStrokes() {},
        renderTerrain: () => { gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
        drawHydro: kind => { if (kind === 'lake') polygonOverlayPass.drawPackets([water], frame, { preparedOnly: true }); },
      });
      const pixel = (x, y) => { const values = new Uint8Array(4); gl.readPixels(x, 99 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, values); return [...values].slice(0, 3); };
      return { grid: pixel(20, 50), covered: pixel(40, 50), protected: pixel(50, 55) };
    };
    const gpuForward = drawGpu(scene);
    const reversed = { ...scene, strokes: scene.strokes.map(packet => ({ ...packet, order: 300 })) };
    const gpuReverse = drawGpu(reversed);
    context.globalAlpha = 1; context.fillStyle = '#00ff00'; context.fillRect(0, 0, 100, 100);
    window.PandoLabCanvasSceneComposition.drawOverlays(context, path, reversed.polygons, reversed.strokes, 1);
    const canvasReverse = sample(40, 50);
    const workerPixels = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('assets/js/workers/canvas-render-worker.js', root));
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
        if (data.type === 'ready') worker.postMessage({ type: 'render', width: 100, height: 100, dpr: 1,
          projection: 'flat', view: { flatCenter: [0, 0] }, renderProjection: { scale: 200, translate: [50, 50] } });
        if (data.type === 'frame') {
          const target = new OffscreenCanvas(100, 100).getContext('2d'); target.drawImage(data.bitmap, 0, 0);
          const grid = [...target.getImageData(20, 50, 1, 1).data], covered = [...target.getImageData(40, 50, 1, 1).data];
          data.bitmap.close(); worker.terminate(); resolve({ grid, covered });
        }
      };
      worker.postMessage({ type: 'init', features: [], visible: false, fills: {}, countryBoundaryStyles: {},
        physicalSettings: { terrainVisible: false }, riversVisible: false, lakesVisible: false,
        theme: { baseLandAlpha: 1, defaultLand: '#00ff00', border: '#000000', borderAlpha: 1, borderWidth: 1 },
        scenePolygons: scene.polygons, sceneStrokes: scene.strokes.map(packet => ({ ...packet, style: { ...packet.style, alpha: 0.5 } })) });
    });
    polygonOverlayPass.dispose(); strokeRenderer.dispose();
    return { ...forward, gpuForward, gpuReverse, canvasReverse, workerPixels };
  }, site(baseURL));
  expect(pixels.grid).toEqual([0, 0, 255]);
  expect(pixels.covered).toEqual([255, 0, 0]);
  expect(pixels.protected).toEqual([0, 255, 0]);
  expect(pixels.gpuForward).toEqual({ grid: pixels.grid, covered: pixels.covered, protected: pixels.protected });
  expect(pixels.canvasReverse).toEqual([0, 0, 255]);
  expect(pixels.gpuReverse.covered).toEqual(pixels.canvasReverse);
  expect(pixels.workerPixels.grid.slice(0, 3)).toEqual([0, 0, 255]);
  expect(pixels.workerPixels.grid[3]).toBeGreaterThanOrEqual(127);
  expect(pixels.workerPixels.grid[3]).toBeLessThanOrEqual(128);
  expect(pixels.workerPixels.covered).toEqual([255, 0, 0, 255]);
});

test('main-thread Canvas draws the graticule when the Canvas Worker is unavailable', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes('canvas-render-worker.js')) throw new Error('Injected Canvas Worker unavailable');
        super(url, options);
      }
    };
    window.__gridChangedPixels = 0;
    const stroke = window.CanvasRenderingContext2D.prototype.stroke;
    window.CanvasRenderingContext2D.prototype.stroke = function(...args) {
      const inspect = !window.__gridChangedPixels && this.canvas.classList?.contains('gpu-map-canvas')
        && this.strokeStyle === '#aaaaaa' && this.canvas.width > 100;
      const before = inspect ? this.getImageData(0, 0, this.canvas.width, this.canvas.height).data : null;
      stroke.apply(this, args);
      if (inspect) {
        const after = this.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
        let changed = 0;
        for (let index = 0; index < after.length; index += 4) if (after[index] !== before[index]
          || after[index + 1] !== before[index + 1] || after[index + 2] !== before[index + 2] || after[index + 3] !== before[index + 3]) changed++;
        window.__gridChangedPixels = changed;
      }
    };
  });
  await page.goto(new URL('?renderer=canvas&debug=1', site(baseURL)).href);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.renderer)).toBe('canvas2d');
  await expect.poll(() => page.evaluate(() => window.__gridChangedPixels), { timeout: 30_000 }).toBeGreaterThan(100);
  await expect(page.locator('path.map-graticule')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const failure of ['compile-exception', 'self-test-false', 'webgl1-no-instancing']) {
test(`${failure} switches the real app to Canvas`, async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await page.addInitScript(failure => {
    window.__strokeInitFailures = 0;
    for (const prototype of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype].filter(Boolean)) {
      const check = prototype.getShaderParameter;
      prototype.getShaderParameter = function(shader, parameter) {
        if (failure === 'compile-exception' && parameter === this.COMPILE_STATUS && this.getShaderSource(shader)?.includes('uniform vec2 uDash')) {
          window.__strokeInitFailures++; return false;
        }
        return check.call(this, shader, parameter);
      };
      const read = prototype.readPixels;
      prototype.readPixels = function(x, y, width, height, format, type, pixels, ...args) {
        if (failure === 'self-test-false' && width === 16 && height === 16) {
          window.__strokeInitFailures++; pixels.fill(0); return;
        }
        return read.call(this, x, y, width, height, format, type, pixels, ...args);
      };
      const extension = prototype.getExtension;
      prototype.getExtension = function(name) {
        if (failure === 'webgl1-no-instancing' && name === 'ANGLE_instanced_arrays') {
          window.__strokeInitFailures++; return null;
        }
        return extension.call(this, name);
      };
    }
  }, failure);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL(`?renderer=${failure === 'webgl1-no-instancing' ? 'webgl1' : 'webgl2'}&debug=1`, site(baseURL)).href);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.renderer), { timeout: 45_000 }).toMatch(/^canvas/);
  expect(await page.evaluate(() => window.__strokeInitFailures)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
}
