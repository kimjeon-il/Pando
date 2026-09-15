import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createMapEditWorkerClient } from '../../assets/js/modules/map-edit-worker-client.js';

function harness(t, rows) {
  const script = new URL('../../assets/js/workers/map-edit-worker.js', import.meta.url).href;
  const createWorker = () => {
    const worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      const fs = require('node:fs'), vm = require('node:vm');
      global.self = global;
      self.location = new URL(${JSON.stringify(script)});
      global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext('(function(module,exports){' + fs.readFileSync(new URL(url), 'utf8') + '\\n}).call(globalThis,undefined,undefined)'));
      self.postMessage = data => parentPort.postMessage(data);
      vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), { filename: self.location.href, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
      parentPort.on('message', data => self.onmessage({ data }));
    `, { eval: true });
    const adapter = { postMessage: value => worker.postMessage(value), terminate: () => worker.terminate() };
    worker.on('message', data => adapter.onmessage?.({ data }));
    worker.on('error', error => adapter.onerror?.(error));
    return adapter;
  };
  const client = createMapEditWorkerClient({ createWorker, getEditSources: () => rows,
    getFeatures: () => rows.filter(row => row.kind === 'country').map(row => row.feature),
    getFeatureById: id => rows.find(row => row.feature.id === id)?.feature,
    readyTimeoutMs: 5000,
  });
  t.after(() => client.stop());
  return client;
}
const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const feature = (id, geometry, properties = {}) => ({ type: 'Feature', id, geometry, properties });

test('actual worker validates normalized edits and invalidates receipts after lock changes', { timeout: 15000 }, async t => {
  const parent = feature('RUS', square(0, 0, 10, 10));
  const rows = [{ kind: 'country', feature: parent }], client = harness(t, rows);
  const response = await client.execute('territorial-edit', { payload: { operation: 'create', targetId: 'RUS', parentId: 'RUS', sovereignId: 'RUS',
    draft: square(1, 1, 2, 2), newFeature: feature('child', square(1, 1, 2, 2), { unitType: 'subunit', parentId: 'RUS', sovereignId: 'RUS' }) } });
  assert.equal(response.result.features.length, 1);
  assert.equal(response.result.preview.validation.blocking, false);
  const validation = await client.execute('territorial-validation', { payload: { preparationId: response.result.preparationId } });
  assert.equal(validation.result.valid, true);
  parent.properties.locked = true;
  await assert.rejects(client.execute('territorial-validation', { payload: { preparationId: response.result.preparationId } }), /변경|다시/);
  assert.deepEqual(parent.geometry, square(0, 0, 10, 10));
});

test('actual worker prepares parents, land clipping, indexed snaps and grouped boundaries', { timeout: 15000 }, async t => {
  const rows = [
    { kind: 'country', feature: feature('RUS', square(0, 0, 10, 10)) },
    { kind: 'territorial', feature: feature('child', square(0, 0, 5, 10), { unitType: 'subunit', sovereignId: 'RUS', parentId: 'RUS' }) },
    { kind: 'generic', feature: feature('area', square(-1, -1, 1, 1), { ownerId: 'RUS' }) },
  ];
  const client = harness(t, rows);
  const parents = await client.execute('territorial-parents', { payload: { targetId: 'child', candidateIds: ['RUS', 'missing'] } });
  assert.deepEqual(parents.result.ids, ['RUS']);
  const clip = await client.execute('territorial-land-clip', { payload: { targetId: 'area' } });
  assert.ok(clip.result.geometry.coordinates.length);
  const snap = await client.execute('territorial-snap', { payload: { coordinate: [0, 0], margin: 0.1, activeOwnerIds: ['RUS'] } });
  assert.ok(snap.result.candidates.some(candidate => candidate.kind === 'vertex'));
  const boundaries = await client.execute('territorial-display', { payload: { kind: 'boundaries' } });
  assert.ok(boundaries.result.segments.length);
});

test('library batch preserves order and refuses locked donors without changing synchronized originals', { timeout: 15000 }, async t => {
  const original = feature('RUS', square(0, 0, 10, 10));
  const client = harness(t, [{ kind: 'country', feature: original }]);
  const payload = { countries: [feature('first', square(0, 0, 3, 3)), feature('second', square(2, 0, 4, 3))], units: [] };
  const result = (await client.execute('territorial-library-batch', { payload })).result;
  assert.equal(result.transfers.length, 2);
  assert.ok(result.features.some(item => item.id === 'second'));
  assert.deepEqual(original.geometry, square(0, 0, 10, 10));
  original.properties.locked = true;
  await assert.rejects(client.execute('territorial-library-batch', { payload }), /잠긴/);
});

test('snap broad phase retains edges crossing the date line', async t => {
  const client = harness(t, [{ kind: 'country', feature: feature('island', square(179, 5, -179, 6)) }]);
  const snap = await client.execute('territorial-snap', { payload: { coordinate: [180, 5], margin: 0.1 } });
  assert.ok(snap.result.candidates.some(candidate => candidate.a && candidate.b));
});

test('drawn clipping and region previews stay in the worker and reject changed locks', async t => {
  const a = feature('a', square(0, 0, 4, 4), { unitType: 'region', parentId: 'RUS', sovereignId: 'RUS' });
  const b = feature('b', square(4, 0, 8, 4), { unitType: 'region', parentId: 'RUS', sovereignId: 'RUS' });
  const client = harness(t, [{ kind: 'country', feature: feature('RUS', square(0, 0, 10, 10)) },
    { kind: 'territorial', feature: a }, { kind: 'territorial', feature: b }]);
  const drawn = await client.execute('territorial-drawn', { payload: { draft: square(-2, -2, 2, 2), source: square(0, 0, 10, 10) } });
  assert.ok(drawn.result.geometry.coordinates);
  const merged = await client.execute('territorial-region-merge', { payload: { targetId: 'a', targetIds: ['b'] } });
  assert.deepEqual(merged.result.removedIds, ['b']);
  const preview = await client.execute('territorial-preview', { payload: { operation: 'merge-region', beforeIds: ['a', 'b'], afterFeatures: [merged.result.survivor], removedIds: ['b'] } });
  assert.equal(preview.result.validation.blocking, false);
  await assert.rejects(client.execute('territorial-region-redraw', { payload: { targetId: 'a', containerId: 'RUS', siblingIds: ['b'], draft: square(0, 0, 5, 4) } }), /겹칩니다/);
  b.properties.locked = true;
  await assert.rejects(client.execute('territorial-validation', { payload: { preparationId: preview.result.preparationId } }), /변경|다시/);
  assert.deepEqual(a.geometry, square(0, 0, 4, 4));
});

test('Russia detailed source remains intact after a small child preview and source reuse', { timeout: 30000 }, async t => {
  const collection = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url), 'utf8'));
  const original = collection.features.find(item => item.id === 'RUS');
  assert.ok(original);
  const polygons = original.geometry.type === 'Polygon' ? [original.geometry.coordinates] : original.geometry.coordinates;
  const pairs = polygons.reduce((sum, polygon) => sum + polygon.reduce((count, ring) => count + ring.length, 0), 0);
  assert.equal(polygons.length, 214);
  assert.equal(pairs, 36756);
  const before = JSON.stringify(original.geometry);
  const client = harness(t, [{ kind: 'country', feature: original }]);
  const start = performance.now();
  await client.execute('territorial-source', { payload: { parentId: 'RUS' } });
  const firstMs = performance.now() - start;
  const geometry = { type: 'Polygon', coordinates: polygons.at(-1) };
  const child = feature('child', geometry, { unitType: 'subunit', parentId: 'RUS', sovereignId: 'RUS' });
  const previewStart = performance.now();
  const preview = await client.execute('territorial-edit', { payload: { operation: 'create', targetId: 'RUS', parentId: 'RUS', sovereignId: 'RUS', draft: geometry, newFeature: child } });
  assert.equal(preview.result.preview.validation.blocking, false);
  assert.equal(preview.result.features.length, 1);
  assert.equal(JSON.stringify(original.geometry), before);
  t.diagnostic(JSON.stringify({ dataset: 'countries-ne-5.1.1', polygons: 214, coordinatePairs: pairs,
    sourcePreparationMs: Math.round(firstMs), smallChildPreviewMs: Math.round(performance.now() - previewStart), scope: 'Node Worker, not browser input latency' }));
});
