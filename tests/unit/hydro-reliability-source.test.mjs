import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import {repositoryFrontendSnapshot} from '../helpers/frontend-source.mjs';
import {parseJavaScript,walkJavaScript} from '../../scripts/lib/source-analysis.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createGpuMapRenderer } from "../../shared/frontend/js/modules/gpu-map-renderer.js";
import { mapVisualOrder } from "../../shared/frontend/js/modules/layer-presentation.js";
import {createObjectSearchModel,visibleObjectSearchRows} from '../../shared/frontend/js/modules/object-search-model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const functionSource=(text,name)=>{let found;walkJavaScript(parseJavaScript(text),node=>{if(node.type==='FunctionDeclaration'&&node.id.name===name)found=node;});assert.ok(found,'Missing current function '+name);return text.slice(...found.range);};

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

test('duplicate immutable descriptor packs reuse the accepted bytes and eviction returns indices to baseline', async t => {
  const { state, renderer, worker, pack } = await hydroRendererFixture(t);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    worker.send({ type: 'active', revision: 1, packIds: [7, 8, 9] });
    pack(7, [descriptor(7, 100)]);
    pack(8, [descriptor(8, 101)]);
    pack(7, [{ ...descriptor(7, 103), awId: 'river:new', logicalFid: 11 }]);
    assert.equal(state.hydroFeatureByFid.has(100), true);
    assert.equal(state.hydroFeatureByFid.has(103), false, 'same source/content identity must not replace accepted bytes');
    assert.deepEqual(state.hydroFeatureCache.get('river:R').properties.pack_ids, [7, 8]);
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

test('duplicate immutable fragment packs retain accepted Canvas aggregation until disposal', async t => {
  const { state, renderer, pack } = await hydroRendererFixture(t);
  const fragment = (fid, packId) => ({ type: 'Feature', id: 'river:R',
    properties: { pandolab_id: 'river:R', __fid: fid, pack_id: packId, category: 'river', fragment_index: fid },
    geometry: { type: 'LineString', coordinates: [[fid, 0], [fid + 1, 0]] } });
  pack(7, [], 0, [fragment(100, 7)]);
  pack(8, [], 0, [fragment(101, 8)]);
  assert.deepEqual(state.hydroFeatureCache.get('river:R').properties.pack_ids, [7, 8]);
  pack(7, [], 0, [fragment(102, 7)]);
  assert.equal(state.hydroFeatureByFid.has(100), true);
  assert.deepEqual([...state.hydroFeatureByFid.keys()].sort(), [100, 101]);
  renderer.dispose();
  assert.equal(state.hydroFeatureCache.size, 0);
  assert.equal(state.hydroFeatureByFid.size, 0);
  assert.equal(state.hydroFragmentsByLogicalId.size, 0);
});

test('hydro worker reports typed init/view completion and failures', () => {
  const source = read('shared/frontend/js/workers/hydro-tile-worker.js');
  for (const token of ["type: 'ready'", "type: 'init-error'", "type: 'view-ready'", "type: 'view-error'"]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});

test('hydro worker probes Range with GET and can abort background cache', () => {
  const source = read('shared/frontend/js/workers/hydro-tile-worker.js');
  assert.ok(source.includes("Range: 'bytes=0-0'"));
  assert.ok(!source.includes("method: 'HEAD'"));
  assert.ok(source.includes('new AbortController()'));
  assert.ok(source.includes('abortBackgroundCache()'));
  assert.ok(source.includes('if (mobileSession && !force) return;'));
});

test('hydro preparation separates requested and loaded views and treats cache failure as unavailable', () => {
  const source = read('shared/frontend/js/modules/gpu-hydro-preparation.js');
  assert.ok(source.includes('hydroViewRequests.start(key, hydroRequestRevision + 1)'));
  assert.ok(source.includes('hydroViewRequests.ready(revision)'));
  assert.ok(source.includes('hydroViewRequests.fail(revision, message)'));
  assert.ok(source.includes("loadState.hydroCache = 'unavailable';"));
  assert.ok(read('shared/frontend/js/modules/hydro-view-requests.js').includes('message.retryable !== false'));
  assert.ok(!source.includes("hydroViewKey = key"));
});

test('app waits for actual hydro worker readiness and retries manifests', () => {
  const app = readApplicationOwners('physical-resources', 'object-catalog', 'hydro-settings');
  const service = read('shared/frontend/js/modules/physical-layer-service.js');
  assert.match(app,/await renderer\.setHydroManifest\(manifest,\s*manifestUrl\)/);
  assert.ok(app.includes("state.physicalLoadState.hydroWorker = 'starting';"));
  assert.ok(app.includes("state.physicalLoadState.hydroManifest = 'loading';"));
  assert.ok(service.includes('fetchWithRetry(url'));
  assert.ok(service.includes('maxAttempts: 3'));
  assert.ok(service.includes('timeoutMs: 15000'));
});

test('rivers and lakes remain individually searchable in the current visible object catalog', () => {
  const items=[{id:'river:one',name:'River One',hydroCategory:'river'},{id:'lake:one',name:'Lake One',hydroCategory:'lake'}];
  const model=visible=>createObjectSearchModel({groups:['hydro'],items:()=>items.filter(row=>visible.includes(row.id)),
    itemRef:(domain,id)=>({domain,id,key:domain+':'+id}),compare:(a,b)=>a.name.localeCompare(b.name)});
  const all=model(items.map(row=>row.id));
  assert.deepEqual(new Set(all.items.map(row=>row.typeLabel)),new Set(['강','호수']));
  assert.equal(visibleObjectSearchRows(all,'River One')[0].ref.id,'river:one');
  assert.deepEqual(model(['lake:one']).items.map(row=>row.ref.id),['lake:one']);
});

test('active GPU and Canvas hydro renderers inherit ocean colour and configured opacity', () => {
  const gpu = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const canvas = read('shared/frontend/js/workers/canvas-render-worker.js');
  const canvasHydro = functionSource(canvas,'renderHydroPass');
  assert.ok(gpu.includes('const color = [...rgb, hydroOpacity];'));
  assert.ok(!gpu.includes("(category === 'lake' ? 0.92 : 0.96)"));
  assert.ok(canvasHydro.includes('context.globalAlpha = reserve ? 1 : hydroOpacity;'));
  assert.ok(!canvasHydro.includes('context.globalAlpha = 0.92;'));
  assert.ok(!canvasHydro.includes('context.globalAlpha = 0.96;'));
});

test('bootstrap cache revision comes from generated build metadata', async () => {
  const bootstrap = read('apps/editor/frontend/js/bootstrap.js');
  const metadata = (await repositoryFrontendSnapshot()).assets.get('assets/js/build-meta.js').bytes.toString('utf8');
  assert.ok(bootstrap.includes('buildMeta.assetRevision'));
  assert.match(metadata, /"assetRevision":\s*"[0-9]+\.[0-9]+\.[0-9]+-build-[A-Za-z0-9._-]+"/);
});

test('completed hydro renders before canonical country boundaries in every native path', () => {
  const gpu = read('shared/frontend/js/modules/gpu-map-renderer.js');
  const worker = read('shared/frontend/js/workers/canvas-render-worker.js');
  const webgl = read('shared/frontend/js/modules/gpu-base-scene-pass.js');
  assert.ok(gpu.includes('const result = drawGpuBaseScene('));
  for (const backend of ['gpu', 'canvas']) {
    const order = mapVisualOrder('base', backend);
    assert.ok(order.indexOf('border-river') >= 0);
    assert.ok(order.indexOf('border-river') < order.indexOf('country-boundary'));
  }
  assert.ok(webgl.includes("for (const role of mapVisualOrder('base', 'gpu'))"));
  assert.ok(webgl.includes("for (const role of mapVisualOrder('hydro')) drawHydro(role)"));
  assert.ok(webgl.includes('drawCountryBoundaryStrokes()'));
  const canvas = functionSource(gpu,'renderCanvasFallback');
  assert.ok(canvas.includes("for (const role of mapVisualOrder('base'))"));
  assert.ok(canvas.includes('renderCanvasHydro(canvasPath, theme, ctx2d, false, role)'));
  assert.ok(canvas.includes("'country-boundary': () => renderCanvasCountryBoundaries(canvasPath, theme, countryFeatures)"));
  assert.ok(gpu.includes('canvasPath(countryOutlineFeature(feature))'));
  const workerRender = worker.slice(worker.search(/function render\(/), worker.indexOf('self.onmessage'));
  assert.ok(gpu.includes("visualOrder: { base: mapVisualOrder('base'), hydro: mapVisualOrder('hydro') }"));
  assert.ok(workerRender.includes('message.visualOrder.base'));
  assert.ok(workerRender.includes('renderHydroPass(message, projection, dpr, role)'));
  assert.ok(workerRender.includes('renderCountryBoundaries(message, projection, dpr)'));
  assert.ok(worker.includes('const outline = boundaryOutlineFeature(feature);'));
  assert.ok(worker.includes('geoPath(outline);'));
  assert.doesNotMatch(workerRender, /strokeStyle = '#346733'/);
  assert.ok(gpu.includes('setHydroEdits'));
  assert.ok(worker.includes("message.type === 'hydro-edits'"));
});
