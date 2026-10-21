import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';

test('country coverage stays uniform across dense joins and preserves GPU state and resources', { timeout: 60_000 }, async () => {
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body>'); return; }
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) throw new Error('Outside test root');
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const proof = await page.evaluate(async () => {
      const { createGpuStrokeRenderer } = await import('/assets/js/modules/gpu-stroke-renderer.js');
      const { createRenderDevice } = await import('/assets/js/modules/render-device.js');
      const { resolveMapStrokeStyle } = await import('/assets/js/modules/map-interaction-style.js');
      const results = [];
      for (const version of [2, 1]) for (const dpr of [1, 2]) {
        const canvas = globalThis.document.createElement('canvas'); canvas.width = 256 * dpr; canvas.height = 64 * dpr;
        const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { alpha: true, antialias: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error(`WebGL${version} unavailable`);
        const errors = [], renderer = createGpuStrokeRenderer({ onError: event => errors.push(event.error.message) });
        if (!renderer.initialize(createRenderDevice({ gl, canvas, version }))) throw new Error('Stroke initialization failed');
        const counts = { textures: 0, textureDeletes: 0, framebuffers: 0, framebufferDeletes: 0, storage: 0 };
        for (const [method, counter] of [['createTexture', 'textures'], ['deleteTexture', 'textureDeletes'], ['createFramebuffer', 'framebuffers'], ['deleteFramebuffer', 'framebufferDeletes'], ['texImage2D', 'storage']]) {
          const original = gl[method].bind(gl); gl[method] = (...args) => { counts[counter]++; return original(...args); };
        }
        const marker = gl.createTexture(); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, marker);
        const frame = { viewport: [canvas.width, canvas.height], translate: [0, 32.25 * dpr], scale: 180 / Math.PI * dpr,
          dpr, rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1], flatCenter: [0, 0], mode: 1, worldOffsets: [0] };
        const country = resolveMapStrokeStyle({ theme: { border: '#ffffff', borderAlpha: 1 } }, 'country');
        function draw(key, step, alpha = 1, multiply = false, duplicate = false) {
          const values = [];
          for (let x = 32; x < 224; x += step) values.push(x, 0, Math.min(x + step, 224), 0);
          const coords = duplicate ? [...values, ...values] : values;
          gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.colorMask(true, true, true, true);
          gl.viewport(0, 0, ...frame.viewport); gl.clearColor(0.2, 0.3, 0.4, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.SCISSOR_TEST); gl.scissor(8 * dpr, 8 * dpr, 240 * dpr, 48 * dpr);
          gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          const result = renderer.drawBatches([{ key, startsEnds: new Float32Array(coords),
            style: { ...country, alpha, color: multiply ? '#447799' : '#ffffff', blendMode: multiply ? 'multiply' : 'normal' } }], frame);
          const rgba = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          const interior = [];
          for (let y = 28 * dpr; y < 37 * dpr; y++) for (let x = 48 * dpr; x < 208 * dpr; x++) interior.push(...rgba.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4));
          const state = { framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null,
            texture: gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE3 && gl.getParameter(gl.TEXTURE_BINDING_2D) === marker,
            viewport: Array.from(gl.getParameter(gl.VIEWPORT)), clear: Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)),
            scissor: gl.isEnabled(gl.SCISSOR_TEST), stencil: gl.isEnabled(gl.STENCIL_TEST),
            equation: gl.getParameter(gl.BLEND_EQUATION_RGB), error: gl.getError() };
          return { result, interior, state };
        }
        const sparse = draw('sparse', 192), dense = draw('dense', 1);
        const transparent = draw('alpha', 1, 0.4), repeated = draw('repeat', 1, 0.4, false, true);
        const multiply = draw('multiply', 192, 0.4, true), multiplyRepeated = draw('multiply-repeat', 1, 0.4, true, true);
        const maxDiff = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
        const beforeResize = { ...counts };
        canvas.width += 32 * dpr; frame.viewport[0] = canvas.width;
        draw('resized', 192);
        const afterResize = { ...counts };
        renderer.dispose();
        const afterDispose = { ...counts };
        results.push({ version, dpr, coverage: country.coverage,
          densityDifference: maxDiff(sparse.interior, dense.interior), duplicateDifference: maxDiff(transparent.interior, repeated.interior),
          multiplyDifference: maxDiff(multiply.interior, multiplyRepeated.interior),
          occupied: dense.interior.some((value, index) => index % 4 === 3 && value > 0),
          intermediate: dense.interior.some((value, index) => index % 4 === 3 && value > 0 && value < 255),
          states: [sparse, dense, transparent, repeated, multiply, multiplyRepeated].map(row => row.state),
          succeeded: [sparse, dense, transparent, repeated, multiply, multiplyRepeated].every(row => row.result.succeeded),
          beforeResize, afterResize, afterDispose, errors });
        gl.deleteTexture(marker); gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      return results;
    });
    for (const row of proof) {
      const label = `WebGL${row.version}/DPR${row.dpr}`;
      assert.equal(row.coverage, 'union', label);
      assert.ok(row.densityDifference <= 1, `${label}: density changed coverage by ${row.densityDifference}`);
      assert.ok(row.duplicateDifference <= 1, `${label}: alpha was applied more than once`);
      assert.ok(row.multiplyDifference <= 1, `${label}: multiply coverage accumulated`);
      assert.ok(row.occupied && row.intermediate && row.succeeded, label);
      assert.deepEqual(row.errors, [], label);
      for (const state of row.states) {
        assert.ok(state.framebuffer && state.texture && state.scissor && state.stencil, `${label}: GPU state leaked`);
        assert.deepEqual(state.viewport, [0, 0, 256 * row.dpr, 64 * row.dpr]);
        assert.equal(state.equation, 32774); assert.equal(state.error, 0);
        assert.ok(Math.abs(state.clear[0] - 0.2) < 1e-6);
      }
      assert.equal(row.beforeResize.textures, 2, `${label}: one reusable mask plus marker`);
      assert.equal(row.beforeResize.framebuffers, 1);
      assert.equal(row.beforeResize.storage, 1);
      assert.equal(row.afterResize.textures, row.beforeResize.textures);
      assert.equal(row.afterResize.storage, 2);
      assert.equal(row.afterDispose.textureDeletes, 1); assert.equal(row.afterDispose.framebufferDeletes, 1);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
