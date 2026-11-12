import { test as featureTest } from '@playwright/test';
import * as __suiteDependency0 from "@playwright/test";
import * as __suiteDependency1 from "@playwright/test";

// Browser launch arguments are worker-scoped and must be set at file scope.
// Both consolidated hydro cases share the same deterministic SwiftShader backend.
featureTest.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

// Preserved Viewer feature contract: hydro-sdf-webgl.spec.mjs
featureTest.describe("hydro-sdf-webgl", () => {
  const {  expect, test  } = __suiteDependency0;


test('real WebGL 1/2 compile and link SDF color and pick shaders without changing hydro IDs', async ({ page }) => {
  await page.route(/hydro-sdf-fixture$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Hydro SDF GPU</title>' }));
  await page.goto('/hydro-sdf-fixture');
  const reports = await page.evaluate(async () => {
    const { hydroSdfShaderSources } = await import('/assets/js/modules/gpu-hydro-sdf.js');
    const { createGpuHydroCoverage } = await import('/assets/js/modules/gpu-hydro-coverage.js');
    const { createRenderDevice } = await import('/assets/js/modules/render-device.js');
    const { linkGpuProgram } = await import('/assets/js/modules/gpu-shader-utils.js');
    const output = [];
    for (const version of [2, 1]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      document.body.append(canvas);
      const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', {
        alpha: true, stencil: true, antialias: false, preserveDrawingBuffer: true,
      });
      if (!gl) { output.push({ version, available: false }); continue; }
      const sources = hydroSdfShaderSources(version);
      let color = null, pick = null;
      try {
        color = linkGpuProgram(gl, sources.vertex, sources.fragment, { label: `hydro-sdf-color-gl${version}` });
        pick = linkGpuProgram(gl, sources.vertex, sources.pick, { label: `hydro-sdf-pick-gl${version}` });
        let driverStateReads = 0;
        const nativeGetParameter = gl.getParameter.bind(gl);
        gl.getParameter = (...args) => { driverStateReads++; return nativeGetParameter(...args); };
        const owner = createRenderDevice({gl, version, contextRevision: 1});
        const coverage = createGpuHydroCoverage();
        coverage.setContext(gl, version, owner);
        const readsBeforeRender = driverStateReads;
        const union = coverage.render({ width: 128, height: 128, color: [0.1, 0.4, 0.9, 0.65], paint() {} });
        const second = coverage.render({ width: 128, height: 128, color: [0.1, 0.4, 0.9, 0.65], paint() {} });
        const hotPathStateReads = driverStateReads - readsBeforeRender;
        const error = gl.getError();
        output.push({ version, available: true, compiled: true, union, second, error,
          tracked: owner.state.tracked, hotPathStateReads,
          supported: coverage.stats().maximumBlend });
        coverage.dispose();
      } catch (error) {
        output.push({ version, available: true, compiled: false, message: String(error) });
      } finally {
        if (color) gl.deleteProgram(color);
        if (pick) gl.deleteProgram(pick);
        canvas.remove();
      }
    }
    return output;
  });
  expect(reports).toHaveLength(2);
  for (const row of reports) {
    expect(row.available, `WebGL${row.version}`).toBe(true);
    expect(row.compiled, `${row.message || 'shader compilation'}`).toBe(true);
    expect(row.error).toBe(0);
    if (row.supported) {
      expect(row.union).toBe(true);
      expect(row.second).toBe(true);
      expect(row.tracked, 'real WebGL context must support RenderDevice ledger').toBe(true);
      expect(row.hotPathStateReads, 'coverage frames must not query driver state').toBe(0);
    }
  }
  expect(reports[0].supported, 'WebGL2 has MAX blending').toBe(true);
});
});
// Preserved Viewer feature contract: canvas-hydro-picking.spec.mjs
featureTest.describe("canvas-hydro-picking", () => {
  const {  test, expect  } = __suiteDependency1;
test('Canvas lake picking matches drawn holes, dateline parts, polar caps, and visibility', async ({ page }) => {
  await page.route('**/canvas-hydro-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Canvas hydro fixture</title>' }));
  await page.goto('/canvas-hydro-fixture');
  await page.addScriptTag({url:'/assets/js/build-meta.js'});
  const result = await page.evaluate(async () => {
    const {workerAssetUrl}=await import('/assets/js/modules/worker-asset-url.js');
    const worker = new Worker(workerAssetUrl(new URL('/assets/js/workers/canvas-render-worker.js',location.href)));
    const wait = type => new Promise((resolve, reject) => {
      const error = event => reject(new Error(event.message));
      worker.addEventListener('error', error, { once: true });
      const listen = event => {
        if (event.data.type !== type) return;
        worker.removeEventListener('message', listen); worker.removeEventListener('error', error); resolve(event.data);
      };
      worker.addEventListener('message', listen);
    });
    const channel = new MessageChannel();
    try {
      let pending = wait('ready');
      worker.postMessage({ type: 'init', width: 400, height: 300, projectGeneration: 1, features: [],
        projection: 'flat', view: { flatCenter: [0, 0] }, renderProjection: { scale: 180 / Math.PI, translate: [200, 150] },
        physicalSettings: {}, theme: {}, visible: false, lakesVisible: true, visualOrder: { base: [], hydro: [] } });
      await pending;
      worker.postMessage({ type: 'hydro-port', port: channel.port2 }, [channel.port2]);
      const lake = (fid, coordinates) => ({ type: 'Feature', properties: { category: 'lake', __fid: fid }, geometry: { type: 'Polygon', coordinates } });
      pending = wait('frame'); worker.postMessage({ type: 'view', revision: 1, viewRevision: 1 }); await pending;
      channel.port1.postMessage({ type: 'pack', packId: 1, features: [
        lake(7, [[[-4,-4],[-4,4],[4,4],[4,-4],[-4,-4]], [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]),
        lake(8, [[[179,-3],[179,3],[-179,3],[-179,-3],[179,-3]]]),
        lake(9, [[[-180,85],[180,85],[90,85],[0,85],[-90,85],[-180,85]]]),
      ] });
      pending = wait('frame'); channel.port1.postMessage({ type: 'active', packIds: [1] }); await pending;
      const pick = async point => { const reply = wait('hydro-pick'); worker.postMessage({ type: 'hydro-pick', requestId: 1, point }); return (await reply).fid; };
      const hits = [];
      for (const point of [[202,150],[200,150],[206,150],[204,150],[379.5,150],[20.5,150]]) hits.push(await pick(point));
      pending = wait('frame'); worker.postMessage({ type: 'view', revision: 2, viewRevision: 2, lakesVisible: false }); await pending;
      hits.push(await pick([202,150]));
      pending = wait('frame'); worker.postMessage({ type: 'view', revision: 3, viewRevision: 3, lakesVisible: true,
        projection: 'globe', view: { globeRotation: [0, -90, 0] }, renderProjection: { scale: 100, translate: [200,150] } }); await pending;
      hits.push(await pick([200,150]));
      hits.push(await pick([230,150]));
      return hits;
    } finally { channel.port1.close(); worker.terminate(); }
  });
  expect(result).toEqual([7, null, null, 7, 8, 8, null, 9, null]);
});
});
