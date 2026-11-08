
import assert from 'node:assert/strict';


import test from 'node:test';

import { createGpuMapRenderer } from "../../../src/rendering/gpu-map-renderer.js";

import {createObjectSearchModel,visibleObjectSearchRows} from "../../../src/document/object-search-model.js";

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

test('rivers and lakes remain individually searchable in the current visible object catalog', () => {
  const items=[{id:'river:one',name:'River One',hydroCategory:'river'},{id:'lake:one',name:'Lake One',hydroCategory:'lake'}];
  const model=visible=>createObjectSearchModel({groups:['hydro'],items:()=>items.filter(row=>visible.includes(row.id)),
    itemRef:(domain,id)=>({domain,id,key:domain+':'+id}),compare:(a,b)=>a.name.localeCompare(b.name)});
  const all=model(items.map(row=>row.id));
  assert.deepEqual(new Set(all.items.map(row=>row.typeLabel)),new Set(['강','호수']));
  assert.equal(visibleObjectSearchRows(all,'River One')[0].ref.id,'river:one');
  assert.deepEqual(model(['lake:one']).items.map(row=>row.ref.id),['lake:one']);
});
