import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('hydro worker reports typed init/view completion and failures', () => {
  const source = read('assets/js/workers/hydro-tile-worker.js');
  for (const token of ["type: 'ready'", "type: 'init-error'", "type: 'view-ready'", "type: 'view-error'"]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});

test('hydro worker probes Range with GET and can abort background cache', () => {
  const source = read('assets/js/workers/hydro-tile-worker.js');
  assert.ok(source.includes("Range: 'bytes=0-0'"));
  assert.ok(!source.includes("method: 'HEAD'"));
  assert.ok(source.includes('new AbortController()'));
  assert.ok(source.includes('abortBackgroundCache()'));
  assert.ok(source.includes('if (mobileSession && !force) return;'));
});

test('renderer separates requested and loaded hydro views and treats cache failure as unavailable', () => {
  const source = read('assets/js/modules/gpu-map-renderer.js');
  assert.ok(source.includes("let hydroViewRequestedKey = '';"));
  assert.ok(source.includes("let hydroViewLoadedKey = '';"));
  assert.ok(source.includes("let hydroViewRetryKey = '';"));
  assert.ok(source.includes("state.physicalLoadState.hydroCache = 'unavailable';"));
  assert.ok(source.includes("message.retryable !== false"));
  assert.ok(!source.includes("hydroViewKey = key"));
});

test('app waits for actual hydro worker readiness and retries manifests', () => {
  const app = read('assets/js/app.js');
  const service = read('assets/js/modules/physical-layer-service.js');
  assert.ok(app.includes('await gpuMapRenderer.setHydroManifest(manifest, manifestUrl)'));
  assert.ok(app.includes("state.physicalLoadState.hydroWorker = 'starting';"));
  assert.ok(app.includes("state.physicalLoadState.hydroManifest = 'loading';"));
  assert.ok(service.includes('fetchWithRetry(url'));
  assert.ok(service.includes('maxAttempts: 3'));
  assert.ok(service.includes('timeoutMs: 15000'));
});

test('built-in rivers and lakes use nested source folders without changing visibility storage', () => {
  const source = read('assets/js/app.js');
  assert.ok(source.includes("const HYDRO_FOLDER_STATE_PREFIX = 'hydro-folder:';"));
  assert.ok(source.includes('...Object.keys(HYDRO_LAYER_META).map(hydroFolderStateKey)'));
  assert.ok(source.includes('name: meta.sourceLabel'));
  assert.ok(source.includes('folderName: `지형지물 · ${meta.label}`'));
  assert.ok(source.includes('visibility.dataset.layerItemVisibility = itemGroup'));
  assert.ok(source.includes('state.physicalSettings.hydroLayers[key] = !!visible'));
});

test('all hydro renderers inherit ocean colour with only the configured layer opacity', () => {
  const app = read('assets/js/app.js');
  const css = read('assets/css/app.css');
  const gpu = read('assets/js/modules/gpu-map-renderer.js');
  const canvas = read('assets/js/workers/canvas-render-worker.js');
  const canvasHydro = canvas.slice(canvas.indexOf('function renderHydroPass'), canvas.indexOf('function pickHydroFeature'));
  assert.ok(css.includes('fill: var(--map-ocean); fill-opacity: 1; stroke: var(--map-ocean)'));
  assert.ok(css.includes('fill: none; stroke: var(--map-ocean); stroke-opacity: 1'));
  assert.ok(!css.includes('.hydro-lake-group { fill: #376f91'));
  assert.ok(!css.includes('.hydro-river-group { stroke: #66b5e5'));
  assert.ok(app.includes(".style('fill-opacity', hydroStyle.opacity)"));
  assert.ok(gpu.includes('const color = [...rgb, hydroOpacity];'));
  assert.ok(!gpu.includes("(category === 'lake' ? 0.92 : 0.96)"));
  assert.ok(canvasHydro.includes('context.globalAlpha = hydroOpacity;'));
  assert.ok(!canvasHydro.includes('context.globalAlpha = 0.92;'));
  assert.ok(!canvasHydro.includes('context.globalAlpha = 0.96;'));
});

test('bootstrap cache revision is advanced for the reliability build', () => {
  const source = read('assets/js/bootstrap.js');
  assert.ok(source.includes("const ASSET_REVISION = '0.30.0-r14';"));
});
