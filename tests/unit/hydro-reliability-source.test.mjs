import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function hydroRendererFixture(t) {
  const workers = [];
  class FakeWorker {
    constructor() { workers.push(this); this.messages = []; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    send(data) { this.onmessage({ data }); }
  }
  const previous = { Worker: globalThis.Worker, window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  Object.assign(globalThis, { Worker: FakeWorker, window: { devicePixelRatio: 1 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  const state = { projection: 'flat', size: { width: 100, height: 100 },
    view: { flatCenter: [0, 0], globeRotation: [0, 0, 0] }, physicalLoadState: {},
    hydroFeatureCache: new Map(), hydroFeatureByFid: new Map(), hydroFragmentsByLogicalId: new Map(),
    physicalSettings: { hiddenHydroIds: {} }, hydroEdits: [], stateRevision: 0, selected: null };
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path, isMobile: () => false,
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null,
    flatProjection: { scale: () => 100, translate: () => [50, 50], center: () => [0, 0] }, hydroVisibilityThreshold: () => 1,
    hydroFeatureById: id => state.hydroFeatureCache.get(id), prepareHydroFeature: feature => feature,
    scheduleGpuFrame() {}, reportOperationError() {}, setActionStatus() {} });
  t.after(() => {
    renderer.dispose();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  renderer.setRenderQuality({ hydroCacheBudgetBytes: 8 * 1024 * 1024 });
  const ready = renderer.setHydroManifest({ stages: [{ id: 0, minZoom: 0, columns: 1, rows: 1 }] },
    'https://example.test/hydro/index.json');
  const worker = workers[0]; worker.send({ type: 'ready' }); await ready;
  const pack = (id, descriptors, bytes = 0, features = []) => worker.send({
    type: 'pack', packId: id, revision: 1, descriptors, features, mesh: { riverStarts: new ArrayBuffer(bytes) },
  });
  return { state, renderer, worker, pack };
}

const descriptor = (packId, fid, minZoom = 2, bounds = [0, 0, 2e6, 2e6]) => ({
  packId, fid, logicalFid: 10, awId: 'river:R', category: 'river', name: 'River R', minZoom, bounds,
});

for (const type of ['river', 'lake']) {
  test(`selected ${type} packs survive cache pressure by domain until the selection is cleared`, async t => {
    const { state, renderer, worker, pack } = await hydroRendererFixture(t);
    const id = `${type}:selected`;
    pack(7, [{ ...descriptor(7, 100), awId: id, category: type }]);
    pack(8, [{ ...descriptor(8, 101), awId: 'river:active', logicalFid: 11 }]);
    state.selected = { domain: 'hydro', type, id, key: `hydro:${type}:${id}` };
    worker.send({ type: 'active', revision: 1, packIds: [8, 9] });
    pack(9, [], 9 * 1024 * 1024);
    assert.deepEqual(state.hydroFeatureCache.get(id)?.properties.pack_ids, [7]);
    assert.equal(state.hydroFeatureByFid.has(100), true);
    assert.equal(state.hydroFeatureByFid.has(101), true, 'the active pack protection remains intact');
    assert.equal(renderer.getStats().hydroPacksLoaded, 3);
    state.selected = null;
    worker.send({ type: 'active', revision: 1, packIds: [9] });
    assert.equal(state.hydroFeatureCache.size, 0);
    assert.equal(state.hydroFeatureByFid.size, 0);
    assert.equal(renderer.getStats().hydroDescriptorPackCount, 0);
    worker.send({ type: 'active', revision: 1, packIds: [] });
    assert.equal(renderer.getStats().hydroPacksLoaded, 0);
  });
}

test('descriptor eviction rebuilds live logical aggregates and removes FIDs only after their last pack', async t => {
  const { state, renderer, worker, pack } = await hydroRendererFixture(t);
  pack(7, [descriptor(7, 100, 0, [-10e6, -10e6, 10e6, 10e6]), descriptor(7, 101)]);
  pack(8, [descriptor(8, 100, 2), descriptor(8, 102)]);
  const hydrated = state.hydroFeatureCache.get('river:R');
  const fullGeometry = { type: 'LineString', coordinates: [[0, 0], [10, 10]] };
  hydrated.geometry = fullGeometry;
  assert.deepEqual(state.hydroFeatureCache.get('river:R').properties.pack_ids, [7, 8]);
  worker.send({ type: 'active', revision: 1, packIds: [8, 9] });
  pack(9, [], 9 * 1024 * 1024);
  const remaining = state.hydroFeatureCache.get('river:R');
  assert.strictEqual(remaining.geometry, fullGeometry, 'a surviving live feature retains its loaded full geometry');
  assert.deepEqual(remaining.properties.pack_ids, [8]);
  assert.equal(remaining.properties.min_zoom, 2);
  assert.deepEqual(remaining.__awBounds, [0, 0, 2, 2]);
  assert.deepEqual(remaining.__awCentroid, [1, 1]);
  assert.equal(remaining.__awRadius, Math.SQRT2);
  assert.strictEqual(state.hydroFeatureByFid.get(100), remaining);
  assert.strictEqual(state.hydroFeatureByFid.get(102), remaining);
  assert.equal(state.hydroFeatureByFid.has(101), false);
  worker.send({ type: 'active', revision: 1, packIds: [9] });
  assert.equal(state.hydroFeatureCache.size, 0);
  assert.equal(state.hydroFeatureByFid.size, 0);
  assert.equal(renderer.getStats().hydroDescriptorLogicalCount, 0);
  assert.equal(renderer.getStats().hydroDescriptorFidCount, 0);
});

test('descriptor replacement and repeated load/evict cycles return renderer indices to baseline', async t => {
  const { state, renderer, worker, pack } = await hydroRendererFixture(t);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    worker.send({ type: 'active', revision: 1, packIds: [7, 8, 9] });
    pack(7, [descriptor(7, 100)]);
    pack(8, [descriptor(8, 101)]);
    pack(7, [{ ...descriptor(7, 103), awId: 'river:new', logicalFid: 11 }]);
    assert.equal(state.hydroFeatureByFid.has(100), false);
    assert.deepEqual(state.hydroFeatureCache.get('river:R').properties.pack_ids, [8]);
    assert.equal(renderer.getStats().hydroDescriptorPackCount, 2);
    pack(9, [], 9 * 1024 * 1024);
    worker.send({ type: 'active', revision: 1, packIds: [] });
    assert.equal(renderer.getStats().hydroPacksLoaded, 0);
    assert.equal(renderer.getStats().hydroDescriptorPackCount, 0);
    assert.equal(renderer.getStats().hydroDescriptorLogicalCount, 0);
    assert.equal(renderer.getStats().hydroDescriptorFidCount, 0);
    assert.equal(state.hydroFeatureCache.size, 0);
    assert.equal(state.hydroFeatureByFid.size, 0);
  }
  pack(7, [descriptor(7, 100)]);
  const resetting = renderer.setHydroManifest(null, null); await resetting;
  assert.equal(state.hydroFeatureCache.size, 0);
  assert.equal(state.hydroFeatureByFid.size, 0);
});

test('fragment pack replacement and disposal retain the existing Canvas aggregation contract', async t => {
  const { state, renderer, pack } = await hydroRendererFixture(t);
  const fragment = (fid, packId) => ({ type: 'Feature', id: 'river:R',
    properties: { pandolab_id: 'river:R', __fid: fid, pack_id: packId, category: 'river', fragment_index: fid },
    geometry: { type: 'LineString', coordinates: [[fid, 0], [fid + 1, 0]] } });
  pack(7, [], 0, [fragment(100, 7)]);
  pack(8, [], 0, [fragment(101, 8)]);
  assert.deepEqual(state.hydroFeatureCache.get('river:R').properties.pack_ids, [7, 8]);
  pack(7, [], 0, [fragment(102, 7)]);
  assert.equal(state.hydroFeatureByFid.has(100), false);
  assert.deepEqual([...state.hydroFeatureByFid.keys()].sort(), [101, 102]);
  renderer.dispose();
  assert.equal(state.hydroFeatureCache.size, 0);
  assert.equal(state.hydroFeatureByFid.size, 0);
  assert.equal(state.hydroFragmentsByLogicalId.size, 0);
});

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

test('hydro preparation separates requested and loaded views and treats cache failure as unavailable', () => {
  const source = read('assets/js/modules/gpu-hydro-preparation.js');
  assert.ok(source.includes('hydroViewRequests.start(key, hydroRequestRevision + 1)'));
  assert.ok(source.includes('hydroViewRequests.ready(revision)'));
  assert.ok(source.includes('hydroViewRequests.fail(revision, message)'));
  assert.ok(source.includes("loadState.hydroCache = 'unavailable';"));
  assert.ok(read('assets/js/modules/hydro-view-requests.js').includes('message.retryable !== false'));
  assert.ok(!source.includes("hydroViewKey = key"));
});

test('app waits for actual hydro worker readiness and retries manifests', () => {
  const app = readApplicationOwners('physical-resources', 'layer-list', 'hydro-settings');
  const service = read('assets/js/modules/physical-layer-service.js');
  assert.ok(app.includes('await gpuMapRenderer.setHydroManifest(manifest, manifestUrl)'));
  assert.ok(app.includes("state.physicalLoadState.hydroWorker = 'starting';"));
  assert.ok(app.includes("state.physicalLoadState.hydroManifest = 'loading';"));
  assert.ok(service.includes('fetchWithRetry(url'));
  assert.ok(service.includes('maxAttempts: 3'));
  assert.ok(service.includes('timeoutMs: 15000'));
});

test('rivers and lakes share the landforms folder while retaining hydro item visibility', () => {
  const source = readApplicationOwners('physical-resources', 'layer-list', 'hydro-settings');
  const model = read('assets/js/modules/layer-list-model.js');
  assert.ok(!source.includes('HYDRO_FOLDER_STATE_PREFIX'));
  assert.ok(model.includes("name: '지형지물'"));
  assert.ok(model.includes("layerGroup === 'hydro') bundles[1].items.push(item)"));
  assert.ok(source.includes('name: meta.sourceLabel'));
  assert.ok(source.includes('state.physicalSettings.hydroLayers[item.id] = !!visible'));
});

test('all hydro renderers inherit ocean colour with only the configured layer opacity', () => {
  const rendering = read('assets/js/modules/rendering-domain.js');
  const css = read('assets/css/features/map-rendering.css');
  const gpu = read('assets/js/modules/gpu-map-renderer.js');
  const canvas = read('assets/js/workers/canvas-render-worker.js');
  const canvasHydro = canvas.slice(canvas.indexOf('function renderHydroPass'), canvas.indexOf('function pickHydroFeature'));
  assert.match(css, /\.hydro-lake-group\s*\{\s*fill: var\(--map-ocean\);\s*fill-opacity: 1;\s*stroke: var\(--map-ocean\)/);
  assert.match(css, /\.hydro-river-group\s*\{\s*fill: none;\s*stroke: var\(--map-ocean\);\s*stroke-opacity: 1/);
  assert.ok(!css.includes('.hydro-lake-group { fill: #376f91'));
  assert.ok(!css.includes('.hydro-river-group { stroke: #66b5e5'));
  assert.ok(rendering.includes(".style('fill-opacity', lakeStyle.opacity)"));
  assert.ok(rendering.includes(".style('stroke-opacity', riverStyle.opacity)"));
  assert.ok(gpu.includes('const color = [...rgb, hydroOpacity];'));
  assert.ok(!gpu.includes("(category === 'lake' ? 0.92 : 0.96)"));
  assert.ok(canvasHydro.includes('context.globalAlpha = reserve ? 1 : hydroOpacity;'));
  assert.ok(!canvasHydro.includes('context.globalAlpha = 0.92;'));
  assert.ok(!canvasHydro.includes('context.globalAlpha = 0.96;'));
});

test('bootstrap cache revision comes from generated build metadata', () => {
  const bootstrap = read('assets/js/bootstrap.js');
  const metadata = read('assets/js/build-meta.js');
  assert.ok(bootstrap.includes('buildMeta.assetRevision'));
  assert.match(metadata, /"assetRevision":\s*"[0-9]+\.[0-9]+\.[0-9]+-build-[A-Za-z0-9._-]+"/);
});

test('completed hydro renders before canonical country boundaries in every native path', () => {
  const gpu = read('assets/js/modules/gpu-map-renderer.js');
  const worker = read('assets/js/workers/canvas-render-worker.js');
  const webgl = read('assets/js/modules/gpu-base-scene-pass.js');
  assert.ok(gpu.includes('lastBaseSceneResult = drawGpuBaseScene('));
  assert.ok(webgl.indexOf("drawHydro('border-river')") >= 0);
  assert.ok(webgl.indexOf("drawHydro('border-river')") < webgl.indexOf('drawCountryBoundaryStrokes(dynamicResources,'));
  const canvas = gpu.slice(gpu.indexOf('function renderCanvasFallback'), gpu.indexOf('function canvasWorkerStyleMessage'));
  assert.ok(canvas.indexOf('renderCanvasHydro(canvasPath, theme)') >= 0);
  assert.ok(canvas.indexOf('renderCanvasHydro(canvasPath, theme)') < canvas.indexOf('renderCanvasCountryBoundaries(canvasPath, theme, countryFeatures)'));
  assert.ok(gpu.includes('path(countryOutlineFeature(feature))'));
  const workerRender = worker.slice(worker.indexOf('function render(message)'), worker.indexOf('self.onmessage'));
  assert.ok(workerRender.indexOf('renderHydroPass(message, projection, dpr, true)') >= 0);
  assert.ok(workerRender.indexOf('renderHydroPass(message, projection, dpr, true)') < workerRender.indexOf('renderCountryBoundaries(message, projection, dpr)'));
  assert.ok(worker.includes('path(countryOutlineFeature(feature))'));
  assert.doesNotMatch(workerRender, /strokeStyle = '#346733'/);
  assert.ok(gpu.includes('setHydroEdits'));
  assert.ok(worker.includes("message.type === 'hydro-edits'"));
});
