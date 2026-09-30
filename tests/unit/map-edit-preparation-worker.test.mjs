import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createMapEditWorkerClient } from '../../assets/js/modules/map-edit-worker-client.js';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { area, multiCoordinates, hasCanonicalCountryWinding } from '../../assets/js/modules/map-edit-geometry.js';

function harness(t, rows, { failFirstClipMethod = '' } = {}) {
  const script = new URL('../../assets/js/workers/map-edit-worker.js', import.meta.url).href;
  const createWorker = () => {
    const worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      const fs = require('node:fs'), vm = require('node:vm');
      global.self = global;
      self.location = new URL(${JSON.stringify(script)});
      global.importScripts = (...urls) => urls.forEach(url => vm.runInThisContext('(function(module,exports){' + fs.readFileSync(new URL(url), 'utf8') + '\\n}).call(globalThis,undefined,undefined)'));
      self.postMessage = data => parentPort.postMessage(data);
      vm.runInThisContext(fs.readFileSync(self.location, 'utf8'), {
        filename: self.location.href,
        importModuleDynamically: specifier => import(new URL(specifier, self.location).href),
      });
      const failMethod = ${JSON.stringify(failFirstClipMethod)};
      if (failMethod) {
        const operation = self.polygonClipping[failMethod].bind(self.polygonClipping);
        let failed = false;
        self.polygonClipping[failMethod] = (...args) => {
          if (!failed) {
            failed = true;
            throw new Error('Unable to find segment in SweepLine tree');
          }
          return operation(...args);
        };
      }
      parentPort.on('message', data => self.onmessage({ data }));
    `, { eval: true, execArgv: ['--experimental-vm-modules'] });
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

function assertNewCountryPartition(result, original, selected) {
  const remaining = result.features.find(item => item.id === 'A');
  const created = result.features.find(item => item.id === 'B');
  assert.ok(remaining?.geometry);
  assert.ok(created?.geometry);
  assert.equal(result.newCountryId, 'B');
  assert.equal(result.preview.validation.blocking, false);
  assert.ok(Number.isFinite(result.transferredArea) && result.transferredArea > 0);
  const createdArea = area(created.geometry);
  const areaTolerance = Math.max(1e-12, createdArea * 1e-12);
  const geometryTolerance = Math.max(1e-10, area(original) * 1e-10);
  assert.ok(Math.abs(result.transferredArea - createdArea) <= areaTolerance);
  assert.ok(hasCanonicalCountryWinding(remaining.geometry));
  assert.ok(hasCanonicalCountryWinding(created.geometry));
  const clipper = globalThis.polygonClipping;
  const a = multiCoordinates(remaining.geometry), b = multiCoordinates(created.geometry);
  assert.ok(area(clipper.xor(b, multiCoordinates(selected))) <= geometryTolerance);
  assert.ok(area(clipper.intersection(a, b)) <= geometryTolerance);
  assert.ok(area(clipper.xor(clipper.union(a, b), multiCoordinates(original))) <= geometryTolerance);
  return created;
}

test('actual Worker creates a country, discards a preview and commits a reversible partition', async t => {
  const original = feature('A', square(0, 0, 10, 10));
  const selected = square(1, 1, 3, 3);
  const payload = { sourceIds: ['A'], newFeature: feature('B', selected), transferredGeometry: selected };
  const before = structuredClone({ original, payload });
  const client = harness(t, [{ kind: 'country', feature: original }]);
  const first = await client.execute('new-country', payload);
  assertNewCountryPartition(first.result, original.geometry, selected);
  assert.ok(Math.abs(first.result.transferredArea - 4) <= 4e-12);
  assert.ok(Math.abs(area(first.result.features.find(item => item.id === 'A').geometry) - 96) <= 1e-8);
  client.discard(first.requestId);
  const second = await client.execute('new-country', payload);
  assert.deepEqual(second.result.features, first.result.features);
  assertNewCountryPartition(second.result, original.geometry, selected);
  client.commit(second.requestId);
  const merged = await client.execute('merge', { sourceId: 'A', targetIds: ['B'] });
  assert.deepEqual(merged.result.removedIds, ['B']);
  assert.equal(merged.result.preview.validation.blocking, false);
  assert.ok(area(globalThis.polygonClipping.xor(
    multiCoordinates(merged.result.features[0].geometry), multiCoordinates(original.geometry),
  )) <= 1e-8);
  assert.deepEqual({ original, payload }, before);
});

test('actual Worker returns final clipped new-country area instead of the raw fringe area', async t => {
  const original = feature('A', square(0, 0, 10, 10));
  const raw = square(-1e-9, 2, 3, 5);
  const payload = { sourceIds: ['A'], newFeature: feature('B', raw), transferredGeometry: raw };
  const before = structuredClone({ original, payload });
  const client = harness(t, [{ kind: 'country', feature: original }]);
  const { result } = await client.execute('new-country', payload);
  const created = assertNewCountryPartition(result, original.geometry, square(0, 2, 3, 5));
  const tolerance = Math.max(1e-12, area(created.geometry) * 1e-12);
  assert.ok(Math.abs(result.transferredArea - 9) <= tolerance);
  assert.ok(Math.abs(result.transferredArea - area(raw)) > tolerance);
  assert.deepEqual({ original, payload }, before);
});

test('actual territorial-cut Worker preserves a partition and reuses its cached source', async t => {
  const source = square(0, 0, 10, 10);
  const payload = {
    sourceKey: 'rectangle-cut', source, coords: [[0, 5], [10, 5]], buildPreview: true,
    view: { kind: 'flat', scale: 1000, translate: [400, 300], rotate: [0, 0, 0], center: [0, 0],
      size: { width: 800, height: 600 }, coarsePointer: false, snapDistance: { mouse: 10, touch: 18 } },
  };
  const before = structuredClone(payload);
  const client = harness(t, [{ kind: 'country', feature: feature('A', source) }]);
  const { result } = await client.execute('territorial-cut', { payload });
  assert.equal(result.valid, true);
  assert.equal(result.split.candidates.length, 2);
  for (const candidate of result.split.candidates) {
    assert.ok(Number.isFinite(candidate.area) && candidate.area > 0);
    assert.ok(hasCanonicalCountryWinding(candidate.geometry));
    assert.ok(Math.abs(area(candidate.geometry) - 50) <= 1e-8);
  }
  const [a, b] = result.split.candidates.map(candidate => multiCoordinates(candidate.geometry));
  assert.ok(area(globalThis.polygonClipping.intersection(a, b)) <= 1e-8);
  assert.ok(area(globalThis.polygonClipping.xor(globalThis.polygonClipping.union(a, b), multiCoordinates(source))) <= 1e-8);
  const cachedPayload = { ...payload };
  delete cachedPayload.source;
  const cached = await client.execute('territorial-cut', { payload: cachedPayload });
  assert.equal(cached.result.valid, true);
  assert.deepEqual(cached.result.split.candidates, result.split.candidates);
  assert.deepEqual(payload, before);
});

test('country command previews stay pending until commit and discard preserves worker originals', async t => {
  const originals = [feature('a', square(0, 0, 1, 1)), feature('b', square(1, 0, 2, 1))];
  const before = structuredClone(originals);
  const client = harness(t, originals.map(feature => ({ kind: 'country', feature })));
  const first = await client.execute('merge', { sourceId: 'a', targetIds: ['b'] });
  assert.deepEqual(first.result.removedIds, ['b']);
  assert.equal(first.result.seamless, true);
  assert.equal(first.result.preview.validation.blocking, false);
  client.discard(first.requestId);
  const second = await client.execute('merge', { sourceId: 'a', targetIds: ['b'] });
  assert.deepEqual(second.result.features, first.result.features);
  client.commit(second.requestId);
  await assert.rejects(client.execute('merge', { sourceId: 'a', targetIds: ['b'] }), /합병할 국가/);
  assert.deepEqual(originals, before);
});

test('actual map-edit Worker retries country clipping sweep failures through the shared calculation', async t => {
  const originals = [feature('a', square(0.1234567896, 0, 1.1234567896, 1)), feature('b', square(1.1234567896, 0, 2.1234567896, 1))];
  const client = harness(t, originals.map(feature => ({ kind: 'country', feature })), { failFirstClipMethod: 'union' });
  const response = await client.execute('merge', { sourceId: 'a', targetIds: ['b'] });
  assert.deepEqual(response.result.removedIds, ['b']);
  assert.equal(response.result.preview.validation.blocking, false);
});

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

test('actual worker prepares parents, indexed snaps and grouped boundaries', { timeout: 15000 }, async t => {
  const rows = [
    { kind: 'country', feature: feature('RUS', square(0, 0, 10, 10)) },
    { kind: 'territorial', feature: feature('child', square(0, 0, 5, 10), { unitType: 'subunit', sovereignId: 'RUS', parentId: 'RUS' }) },
  ];
  const client = harness(t, rows);
  const parents = await client.execute('territorial-parents', { payload: { targetId: 'child', candidateIds: ['RUS', 'missing'] } });
  assert.deepEqual(parents.result.ids, ['RUS']);
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

test('snap intersections use connected geometry ports and retain both owners', async t => {
  const a = feature('horizontal', square(0, 1, 4, 2));
  const b = feature('vertical', square(1, 0, 2, 4));
  const before = structuredClone([a, b]);
  const client = harness(t, [{ kind: 'country', feature: a }, { kind: 'generic', feature: b }]);
  const { result } = await client.execute('territorial-snap', {
    payload: { coordinate: [1, 1], margin: 0.1, activeOwnerIds: ['horizontal'] },
  });
  const crossing = result.candidates.find(candidate => candidate.kind === 'intersection'
    && candidate.coordinate[0] === 1 && candidate.coordinate[1] === 1);
  assert.ok(crossing);
  assert.deepEqual(crossing.ownerIds, ['horizontal', 'vertical']);
  assert.deepEqual([a, b], before);
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
