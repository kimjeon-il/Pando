import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createMapEditWorkerClient } from '../../assets/js/modules/map-edit-worker-client.js';
import '../../assets/js/vendor/polygon-clipping.min.js';
import { area, multiCoordinates, hasCanonicalPolygonWinding } from '../../assets/js/modules/map-edit-geometry.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { normalizeCountryFeature } from '../../assets/js/modules/country-feature.js';

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
  const client = createMapEditWorkerClient({ createWorker, getEditSources: () => rows.map(row => ({...row,kind: 'territorial'})),
    getEntities: () => rows.map(row => row.feature),
    getFeatureById: id => rows.find(row => row.feature.id === id)?.feature,
    readyTimeoutMs: 5000,
  });
  t.after(() => client.stop());
  return client;
}
const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const feature = (id, geometry, properties = {}) => createTerritorialFeature({ id, geometry,
  entityKind: properties.entityKind || 'general', ...properties,
  parentId: properties.parentId || '' } );

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
  assert.ok(hasCanonicalPolygonWinding(remaining.geometry));
  assert.ok(hasCanonicalPolygonWinding(created.geometry));
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
    assert.ok(hasCanonicalPolygonWinding(candidate.geometry));
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
  const response = await client.execute('territorial-edit', { payload: { operation: 'create', targetId: 'RUS', parentId: 'RUS',
    draft: square(1, 1, 2, 2), newFeature: feature('child', square(1, 1, 2, 2), { entityKind: 'general', parentId: 'RUS' }) } });
  assert.equal(response.result.features.length, 1);
  assert.equal(response.result.preview.validation.blocking, false);
  const validation = await client.execute('territorial-validation', { payload: { preparationId: response.result.preparationId } });
  assert.equal(validation.result.valid, true);
  parent.properties.locked = true;
  await assert.rejects(client.execute('territorial-validation', { payload: { preparationId: response.result.preparationId } }), /변경|다시/);
  assert.deepEqual(parent.geometry, square(0, 0, 10, 10));
});

test('actual worker prepares uncovered source, indexed snaps and grouped boundaries', { timeout: 15000 }, async t => {
  const rows = [
    { kind: 'country', feature: feature('RUS', square(0, 0, 10, 10)) },
    { kind: 'territorial', feature: feature('child', square(0, 0, 5, 10), { entityKind: 'general', parentId: 'RUS' }) },
  ];
  const client = harness(t, rows);
  const source = await client.execute('territorial-source', { payload: { parentId: 'RUS' } });
  assert.equal(area(source.result.geometry), 50);
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

test('library batch validates nested subunits from parent chains without a stored country ID', { timeout: 15000 }, async t => {
  const original = feature('A', square(0, 0, 10, 10));
  const parent = feature('S', square(0, 0, 5, 5), { entityKind: 'general', parentId: 'A' });
  const child = feature('T', square(0, 0, 2, 2), { entityKind: 'general', parentId: 'S' });
  const client = harness(t, [{ feature: original }]);
  const result = (await client.execute('territorial-library-batch', { payload: { countries: [], units: [parent, child] } })).result;
  assert.deepEqual(result.removedIds, []);
  assert.deepEqual(result.features, []);
  assert.deepEqual(result.transfers, []);
  assert.equal(Object.hasOwn(child.properties, 'sovereignId'), false);
  const invalid = { ...child, properties: { ...child.properties, parentId: 'missing' } };
  await assert.rejects(client.execute('territorial-library-batch', { payload: { countries: [], units: [invalid] } }), /부모|상위/);
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
  const a = feature('a', square(0, 0, 4, 4), { entityKind: 'regional', parentId: '' });
  const b = feature('b', square(4, 0, 8, 4), { entityKind: 'regional', parentId: '' });
  const client = harness(t, [{ kind: 'country', feature: feature('RUS', square(0, 0, 10, 10)) },
    { kind: 'territorial', feature: a }, { kind: 'territorial', feature: b }]);
  const drawn = await client.execute('territorial-drawn', { payload: { draft: square(-2, -2, 2, 2), source: square(0, 0, 10, 10) } });
  assert.ok(drawn.result.geometry.coordinates);
  const merged = await client.execute('territorial-edit', { payload: { operation: 'merge', targetId: 'a', sourceIds: ['b'] } });
  assert.deepEqual(merged.result.removedIds, ['b']);
  const preview = { result: merged.result.preview };
  preview.result.preparationId = merged.result.preparationId;
  assert.equal(preview.result.validation.blocking, false);
  const redrawn = await client.execute('territorial-region-redraw', { payload: { targetId: 'a', draft: square(0, 0, 5, 4) } });
  assert.ok(area(redrawn.result.feature.geometry) > area(a.geometry), 'independent region may overlap another region');
  b.properties.locked = true;
  await assert.rejects(client.execute('territorial-validation', { payload: { preparationId: preview.result.preparationId } }), /변경|다시/);
  assert.deepEqual(a.geometry, square(0, 0, 4, 4));
});

test('Russia detailed source remains intact after a small child preview and source reuse', { timeout: 30000 }, async t => {
  const collection = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url), 'utf8'));
  const original = normalizeCountryFeature(collection.features.find(item => item.id === 'RUS'));
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
  const child = feature('child', geometry, { entityKind: 'general', parentId: 'RUS' });
  const previewStart = performance.now();
  const preview = await client.execute('territorial-edit', { payload: { operation: 'create', targetId: 'RUS', parentId: 'RUS', draft: geometry, newFeature: child } });
  assert.equal(preview.result.preview.validation.blocking, false);
  assert.equal(preview.result.features.length, 1);
  assert.equal(JSON.stringify(original.geometry), before);
  t.diagnostic(JSON.stringify({ dataset: 'countries-ne-5.1.1', polygons: 214, coordinatePairs: pairs,
    sourcePreparationMs: Math.round(firstMs), smallChildPreviewMs: Math.round(performance.now() - previewStart), scope: 'Node Worker, not browser input latency' }));
});


const cutPayload = (source, coords) => ({
  sourceKey: 'cut-fixture', source, coords, buildPreview: true,
  view: { kind: 'flat', scale: 1000, translate: [400, 300], rotate: [0, 0, 0], center: [0, 0],
    size: { width: 800, height: 600 }, coarsePointer: false, snapDistance: { mouse: 0, touch: 0 } },
});

function assertCutPartition(result, source, count) {
  assert.equal(result.valid, true, result.message || result.splitError);
  assert.equal(result.split.candidates.length, count);
  assert.equal(new Set(result.split.candidates.map(item => item.id)).size, count);
  const pieces = result.split.candidates.map(item => multiCoordinates(item.geometry));
  const clipper = globalThis.polygonClipping;
  for (let i = 0; i < pieces.length; i += 1) {
    assert.ok(hasCanonicalPolygonWinding(result.split.candidates[i].geometry));
    assert.ok(result.split.candidates[i].area > 0);
    for (let j = i + 1; j < pieces.length; j += 1) assert.ok(area(clipper.intersection(pieces[i], pieces[j])) < 1e-8);
  }
  assert.ok(area(clipper.xor(clipper.union(...pieces), multiCoordinates(source))) < 1e-8);
}

test('territorial-cut splits repeated crossings into individual canonical pieces and excludes untouched islands', async t => {
  const mainland = square(0, 0, 10, 10);
  const island = square(20, 0, 21, 1);
  const source = { type: 'MultiPolygon', coordinates: [...multiCoordinates(mainland), ...multiCoordinates(island)] };
  const before = structuredClone(source);
  const client = harness(t, [{ kind: 'country', feature: feature('A', source) }]);
  const payload = cutPayload(source, [[-2, 2], [12, 2], [12, 4], [-2, 4], [-2, 6], [12, 6]]);
  const { result } = await client.execute('territorial-cut', { payload });
  assertCutPartition(result, mainland, 4);
  for (const candidate of result.split.candidates) assert.ok(area(globalThis.polygonClipping.intersection(multiCoordinates(candidate.geometry), multiCoordinates(island))) < 1e-8);
  assert.deepEqual(source, before);
});

test('territorial-cut preserves a hole whether the line crosses it or passes beside it', async t => {
  const source = square(0, 0, 10, 10);
  source.coordinates.push(square(4, 3, 6, 7).coordinates[0]);
  const client = harness(t, [{ kind: 'country', feature: feature('A', source) }]);
  for (const [coords, count] of [
    [[[-2, 5], [12, 5]], 2],
    [[[-2, 2], [12, 2], [12, 8], [-2, 8]], 3],
  ]) {
    const { result } = await client.execute('territorial-cut', { payload: cutPayload(source, coords) });
    assertCutPartition(result, source, count);
  }
});

test('territorial-cut allows a boundary touch amid valid cuts and rejects overlap, self intersection and contact alone', async t => {
  const source = square(0, 0, 10, 10);
  const client = harness(t, [{ kind: 'country', feature: feature('A', source) }]);
  const touch = await client.execute('territorial-cut', { payload: cutPayload(source, [[-2, 5], [5, 10], [12, 5]]) });
  assertCutPartition(touch.result, source, 3);
  for (const [coords, issue] of [
    [[[-2, 5], [5, 5], [5, 10], [8, 10], [12, 5]], 'boundary-overlap'],
    [[[-2, 2], [8, 8], [2, 8], [8, 2], [12, 2]], 'self-intersection'],
    [[[-2, 2], [0, 0], [2, -2]], null],
  ]) {
    const { result } = await client.execute('territorial-cut', { payload: cutPayload(source, coords) });
    assert.equal(result.valid, false);
    if (issue) assert.equal(result.issues[0].kind, issue);
  }
});

test('territorial-cut keeps dateline pieces within longitude bounds without lost or overlapping area', async t => {
  const source = { type: 'MultiPolygon', coordinates: [square(179, 0, 180, 10).coordinates, square(-180, 0, -179, 10).coordinates] };
  const client = harness(t, [{ kind: 'country', feature: feature('A', source) }]);
  const { result } = await client.execute('territorial-cut', { payload: cutPayload(source, [[178, 5], [-178, 5]]) });
  assertCutPartition(result, source, 4);
  for (const candidate of result.split.candidates) for (const polygon of multiCoordinates(candidate.geometry)) for (const ring of polygon) for (const [longitude] of ring) {
    assert.ok(longitude >= -180 && longitude <= 180);
  }
});


test('territorial-cut unwraps a connected dateline polygon and wraps only the final candidates', async t => {
  const source = square(179, 0, 181, 10);
  const expected = { type: 'MultiPolygon', coordinates: [square(179, 0, 180, 10).coordinates, square(-180, 0, -179, 10).coordinates] };
  const client = harness(t, [{ kind: 'country', feature: feature('A', source) }]);
  const { result } = await client.execute('territorial-cut', { payload: cutPayload(source, [[178, 5], [-178, 5]]) });
  assertCutPartition(result, expected, 2);
});

const datelineSource = { type: 'Polygon', coordinates: [[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]] };
const datelineWrapped = { type: 'MultiPolygon', coordinates: [square(179,-2,180,2).coordinates, square(-180,-2,-179,2).coordinates] };
const datelineView = { kind: 'flat', scale: 500, translate: [512,384], rotate: [0,0,0], center: [180,0],
  size: { width: 1024, height: 768 }, coarsePointer: false, snapDistance: { mouse: 10, touch: 18 } };

for (const scope of ['root', 'child']) test(`actual ${scope} split Worker accepts wrapped candidates and preserves preview partition`, async t => {
  const parent = feature('parent', { type: 'Polygon', coordinates: [[[178,-3],[178,3],[-178,3],[-178,-3],[178,-3]]] });
  const original = feature('A', datelineSource, scope === 'child' ? { parentId: 'parent' } : {});
  const rows = [original, ...(scope === 'child' ? [parent] : [])].map(feature => ({ kind: 'territorial', feature }));
  const before = structuredClone(rows);
  const client = harness(t, rows);
  const cut = await client.execute('territorial-cut', { payload: { source: original.geometry, sourceKey: scope,
    coords: [[178,0],[-178,0]], view: datelineView, buildPreview: true } });
  assert.equal(cut.result.valid, true);
  assert.equal(cut.result.split.candidates.length, 2);
  const selected = cut.result.split.candidates[0].geometry;
  const payload = scope === 'root' ? { sourceIds: ['A'], newFeature: feature('B', selected), transferredGeometry: selected }
    : { payload: { operation: 'create', targetId: 'parent', parentId: 'parent', sourceId: 'A', draft: selected,
      newFeature: feature('B', selected, { parentId: 'parent' }) } };
  const operation = scope === 'root' ? 'new-country' : 'territorial-edit';
  const first = await client.execute(operation, payload);
  assert.equal(first.result.preview.validation.blocking, false);
  const retained = first.result.features.find(row => row.id === 'A').geometry;
  const created = first.result.features.find(row => row.id === 'B').geometry;
  assert.equal(area(retained), 4);
  assert.equal(area(created), 4);
  assert.deepEqual(globalThis.polygonClipping.xor(globalThis.polygonClipping.union(multiCoordinates(retained), multiCoordinates(created)), datelineWrapped.coordinates), []);
  assert.deepEqual(globalThis.polygonClipping.intersection(multiCoordinates(retained), multiCoordinates(created)), []);
  assert.equal(first.result.preview.delta.removedGeometry, null);
  assert.equal(first.result.preview.delta.addedGeometry, null);
  client.discard(first.requestId);
  const second = await client.execute(operation, payload);
  assert.deepEqual(second.result.features, first.result.features);
  client.commit(second.requestId);
  assert.deepEqual(rows, before);
});

for (const scope of ['root', 'child']) for (const variant of ['hole', 'multiple-crossings', 'island']) {
  test(`actual ${scope} dateline split preserves ${variant} and rejects genuine outside area`, async t => {
    const hole = [[179.5,0.5],[-179.5,0.5],[-179.5,1.5],[179.5,1.5],[179.5,0.5]];
    const source = variant === 'hole' ? { ...datelineSource, coordinates: [...datelineSource.coordinates, hole] }
      : variant === 'island' ? { type: 'MultiPolygon', coordinates: [datelineSource.coordinates, square(174,0,175,1).coordinates] } : datelineSource;
    const parent = feature('parent', { type: 'Polygon', coordinates: [[[173,-3],[173,3],[-178,3],[-178,-3],[173,-3]]] });
    const original = feature('A', source, scope === 'child' ? { parentId: 'parent' } : {});
    const rows = [original, ...(scope === 'child' ? [parent] : [])].map(feature => ({ kind: 'territorial', feature }));
    const before = structuredClone(rows), client = harness(t, rows);
    const coords = variant === 'multiple-crossings' ? [[178,-1],[-178,-1],[-178,0],[178,0],[178,1],[-178,1]] : [[178,0],[-178,0]];
    const cut = await client.execute('territorial-cut', { payload: { source, sourceKey: variant, coords, view: datelineView, buildPreview: true } });
    assert.equal(cut.result.valid, true);
    assert.equal(cut.result.split.candidates.length, variant === 'multiple-crossings' ? 4 : 2);
    const selected = cut.result.split.candidates[0].geometry;
    const payload = selected => scope === 'root' ? { sourceIds: ['A'], newFeature: feature('B', selected), transferredGeometry: selected }
      : { payload: { operation: 'create', targetId: 'parent', parentId: 'parent', sourceId: 'A', draft: selected,
        newFeature: feature('B', selected, { parentId: 'parent' }) } };
    const operation = scope === 'root' ? 'new-country' : 'territorial-edit';
    const { result } = await client.execute(operation, payload(selected));
    const retained = result.features.find(row => row.id === 'A').geometry;
    const created = result.features.find(row => row.id === 'B').geometry;
    const pc = globalThis.polygonClipping;
    const expected = variant === 'hole' ? pc.difference(datelineWrapped.coordinates, [square(179.5,0.5,180,1.5).coordinates, square(-180,0.5,-179.5,1.5).coordinates])
      : variant === 'island' ? [...datelineWrapped.coordinates, square(174,0,175,1).coordinates] : datelineWrapped.coordinates;
    assert.equal(result.preview.validation.blocking, false);
    assert.deepEqual(pc.xor(pc.union(multiCoordinates(retained), multiCoordinates(created)), expected), []);
    assert.deepEqual(pc.intersection(multiCoordinates(retained), multiCoordinates(created)), []);
    assert.equal(result.preview.delta.removedGeometry, null);
    assert.equal(result.preview.delta.addedGeometry, null);
    if (variant === 'island') assert.deepEqual(pc.difference([square(174,0,175,1).coordinates], multiCoordinates(retained)), []);
    await assert.rejects(client.execute(operation, payload(square(178.5,-1,179,0))), /밖으로/u);
    assert.deepEqual(rows, before);
  });
}

test('actual new-country Worker rejects both sides of a crossing hole in a full-world seam shell', async t => {
  const source = { type: 'Polygon', coordinates: [
    [[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]],
    [[179,-2],[-179,-2],[-179,2],[179,2],[179,-2]],
  ] };
  const original = feature('A', source), client = harness(t, [{ kind: 'territorial', feature: original }]);
  for (const selected of [square(179.25,0,179.5,1), square(-179.5,0,-179.25,1)]) {
    await assert.rejects(client.execute('new-country', { sourceIds: ['A'], transferredGeometry: selected, newFeature: feature('B', selected) }), /밖으로/u);
  }
});

test('actual new-country Worker preserves a subdivided wide source and its preview extent', async t => {
  const wide = top => ({ type: 'Polygon', coordinates: [[[-170,0],[-170,top],[0,top],[170,top],[170,0],[0,0],[-170,0]]] });
  const source = wide(10), selected = wide(5), original = feature('A', source);
  const client = harness(t, [{ kind: 'territorial', feature: original }]);
  const { result } = await client.execute('new-country', { sourceIds: ['A'], transferredGeometry: selected, newFeature: feature('B', selected) });
  assert.equal(area(result.features.find(row => row.id === 'A').geometry), 1700);
  assert.equal(area(result.features.find(row => row.id === 'B').geometry), 1700);
  assert.equal(result.preview.delta.removedGeometry, null);
  assert.equal(result.preview.delta.addedGeometry, null);
  assert.deepEqual(globalThis.polygonClipping.xor(multiCoordinates(result.preview.delta.afterUnion), multiCoordinates(source)), []);
});


test('library batch replaces an overlapping previous instance with its fresh ID and leaves import provenance intact for commit', async t => {
  const old=feature('old-copy',square(0,0,2,2),{sourceEntityId:'state:fixture',sourceGeometryVersion:'v1'});
  const next=feature('new-copy',square(0,0,2,2),{sourceEntityId:'state:fixture',sourceGeometryVersion:'v1'});
  const before=structuredClone(old),client=harness(t,[{kind:'country',feature:old}]);
  const result=(await client.execute('territorial-library-batch',{payload:{countries:[next],units:[]}})).result;
  assert.deepEqual(result.removedIds,['old-copy']);
  assert.deepEqual(result.features.map(f=>f.id),['new-copy']);
  assert.equal(next.properties.sourceEntityId,'state:fixture');
  assert.equal(next.properties.sourceGeometryVersion,'v1');
  assert.deepEqual(old,before);assert.equal(result.deleted,1);
});
