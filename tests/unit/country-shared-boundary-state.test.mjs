import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createCountrySharedBoundaryState, prepareCountrySharedBoundaryPacket } from '../../assets/js/modules/country-shared-boundary-packet.js';
import { buildCountrySharedBoundarySegments, serializeCountrySharedBoundarySegments, hasOpposingBoundaryInteriors } from '../../assets/js/modules/boundary-topology.js';
import { countryGeometrySignature } from '../../assets/js/modules/country-shared-boundary-cache.js';
import { geometryRevisionKey } from '../../assets/js/modules/geometry-versions.js';

const rectangle = (id, west, south, east, north, root = id) => {
  const geometry = { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
  return { type: 'Feature', id, properties: {}, geometry, boundaryRootId: root,
    boundaryGeometryRevision: geometryRevisionKey(geometry) };
};
const coordinates = state => serializeCountrySharedBoundarySegments(state.segments());

test('unchanged replacement and metadata preserve geometry preparation and source references', () => {
  const rows = [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1)];
  const state = createCountrySharedBoundaryState(); state.replace(rows);
  const prepared = state.preparedStore.get('A'), shared = state.segments()[0];
  const before = state.stats();
  const changed = state.replace(structuredClone(rows).map(row => ({ ...row, properties: { name: 'renamed' } })));
  assert.equal(changed.size, 0);
  assert.strictEqual(state.preparedStore.get('A'), prepared);
  assert.strictEqual(state.segments()[0], shared);
  assert.deepEqual(state.stats(), before);
  assert.equal(prepared.feature.properties.name, 'renamed');
  for (const ref of shared.refs) {
    const original = state.preparedStore.get(ref.featureId).segments.find(row => row.polygonIndex === ref.polygonIndex
      && row.ringIndex === ref.ringIndex && row.segmentIndex === ref.segmentIndex);
    assert.strictEqual(ref.a, original.a);
    assert.strictEqual(ref.b, original.b);
    assert.equal(ref.interiorSide, original.interiorSide);
  }
});

test('a new allocation at mutable revision zero replaces its old geometry preparation', () => {
  const state = createCountrySharedBoundaryState();
  const original = rectangle('A', 0, 0, 1, 1); state.replace([original]);
  const prepared = state.preparedStore.get('A');
  const replacement = rectangle('A', 10, 0, 11, 1);
  assert.notEqual(replacement.boundaryGeometryRevision, original.boundaryGeometryRevision);
  assert.deepEqual([...state.patch([replacement])], ['A']);
  assert.notStrictEqual(state.preparedStore.get('A'), prepared);
  assert.deepEqual(state.preparedStore.get('A').bounds, [10, 0, 11, 1]);
});

test('moving one owner removes old contacts and finds new contacts without touching distant preparation', () => {
  const rows = [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1), rectangle('C', 4, 0, 5, 1),
    rectangle('D', 20, 0, 21, 1), rectangle('E', 21, 0, 22, 1)];
  const state = createCountrySharedBoundaryState(); state.replace(rows);
  const distant = state.segments().find(segment => segment.ownerIds.includes('D'));
  const distantPreparation = state.preparedStore.get('D');
  const before = state.stats();
  state.patch([rectangle('B', 3, 0, 4, 1)]);
  assert.strictEqual(state.preparedStore.get('D'), distantPreparation);
  assert.strictEqual(state.segments().find(segment => segment.ownerIds.includes('D')), distant);
  assert.equal(state.stats().preparationCount, before.preparationCount + 1);
  assert.equal(state.stats().contactComputationCount, before.contactComputationCount + 1);
  assert.deepEqual(state.segments().map(segment => segment.ownerIds).sort(), [['B', 'C'], ['D', 'E']]);
  assert.equal(hasOpposingBoundaryInteriors(state.segments().find(segment => segment.ownerIds.includes('B'))), true);
});

test('deletion removes only its contacts and restores a coast; insertion finds a new shared contact', () => {
  const state = createCountrySharedBoundaryState();
  state.replace([rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1)]);
  state.patch([], ['B']);
  assert.equal(state.preparedStore.get('B'), undefined);
  assert.deepEqual(coordinates(state), []);
  state.patch([rectangle('C', 1, 0, 2, 1)]);
  assert.deepEqual(state.segments()[0].ownerIds, ['A', 'C']);
});

test('one removed owner of a coincident multi-owner edge preserves the remaining real refs', () => {
  const state = createCountrySharedBoundaryState();
  state.replace([rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1), rectangle('C', 1, 0, 2, 1)]);
  state.patch([], ['A']);
  assert.ok(state.segments().length > 0);
  for (const segment of state.segments()) {
    assert.deepEqual(segment.ownerIds, ['B', 'C']);
    assert.ok(segment.refs.every(ref => ['B', 'C'].includes(ref.featureId)));
  }
});

test('classification reads prepared ring direction instead of revisiting complete geometry', () => {
  const state = createCountrySharedBoundaryState();
  const parent = rectangle('ROOT', 0, 0, 4, 4), child = rectangle('CHILD', 0, 0, 2, 4, 'ROOT');
  state.replace([parent, child]);
  for (const row of [parent, child]) Object.defineProperty(row.geometry, 'coordinates', {
    get: () => { throw new Error('unchanged geometry was traversed again'); },
  });
  const packet = prepareCountrySharedBoundaryPacket(state.segments(), state.features(), { preparedStore: state.preparedStore });
  assert.deepEqual(packet.internalOwners, {});
  assert.deepEqual(packet.segments, []);
  assert.deepEqual(packet.outlineOwnerIds, ['CHILD']);
});

test('hole contacts respect filled-side direction and sibling contacts use territorial stroke ownership', () => {
  const parent = rectangle('ROOT', 0, 0, 4, 4);
  parent.geometry.coordinates.push([[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]);
  const child = rectangle('CHILD', 1, 1, 3, 3, 'ROOT');
  let state = createCountrySharedBoundaryState(); state.replace([parent, child]);
  assert.ok(state.segments().every(segment => hasOpposingBoundaryInteriors(segment)));
  let packet = prepareCountrySharedBoundaryPacket(state.segments(), state.features(), { preparedStore: state.preparedStore });
  assert.deepEqual(packet.internalOwners['CHILD|ROOT'], ['CHILD']);
  state = createCountrySharedBoundaryState();
  state.replace([rectangle('FIRST', 0, 0, 1, 1, 'ROOT'), rectangle('SECOND', 1, 0, 2, 1, 'ROOT')]);
  packet = prepareCountrySharedBoundaryPacket(state.segments(), state.features(), { preparedStore: state.preparedStore });
  assert.deepEqual(packet.segments, []);
  assert.deepEqual(packet.outlineOwnerIds, ['FIRST', 'SECOND']);
});

test('precomputed cache resolves source refs once and later patches reuse untouched geometry', () => {
  const rows = [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1)];
  const cached = serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(rows));
  const state = createCountrySharedBoundaryState();
  state.replace(rows, { cachedSegments: cached, changedIds: new Set() });
  assert.equal(state.stats().contactComputationCount, 0);
  assert.equal(hasOpposingBoundaryInteriors(state.segments()[0]), true);
  const previous = state.segments()[0];
  state.patch([rectangle('ISLAND', 10, 10, 11, 11)]);
  assert.strictEqual(state.segments()[0], previous);
  assert.deepEqual(coordinates(state), cached);
});

function countryWorker(t, cache) {
  const moduleUrl = new URL('../../assets/js/workers/country-shared-boundary-worker.js', import.meta.url).href;
  const wrapper = `import { parentPort, workerData } from 'node:worker_threads';
    import { gzipSync } from 'node:zlib';
    globalThis.self = { location: { href: ${JSON.stringify(moduleUrl)} }, postMessage: (...args) => parentPort.postMessage(...args) };
    if (workerData.cache) globalThis.fetch = async () => new Response(gzipSync(JSON.stringify(workerData.cache)));
    await import(${JSON.stringify(moduleUrl)});
    parentPort.on('message', data => self.onmessage({ data }));`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(wrapper)}`), { workerData: { cache } });
  t.after(() => worker.terminate());
  let requestId = 0;
  return async message => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('country boundary Worker timed out')), 10000);
    const received = data => {
      clearTimeout(timeout);
      worker.off('error', failed);
      if (data.type === 'error') reject(new Error(data.message));
      else resolve(data);
    };
    const failed = error => { clearTimeout(timeout); worker.off('message', received); reject(error); };
    worker.once('message', received);
    worker.once('error', failed);
    worker.postMessage({ requestId: ++requestId, projectGeneration: 8, geometryRevision: 3, quality: 'preview', ...message });
  });
}

test('the real Worker preserves unchanged replace preparation and updates only patched contacts', async t => {
  const request = countryWorker(t);
  const rows = [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1), rectangle('C', 4, 0, 5, 1)];
  const first = await request({ type: 'replace', features: rows });
  assert.equal(first.projectGeneration, 8); assert.equal(first.geometryRevision, 3);
  assert.equal(first.packet.startsEnds.length, 4);
  const same = await request({ type: 'replace', features: structuredClone(rows) });
  assert.deepEqual(same.preparationStats, first.preparationStats);
  const moved = await request({ type: 'patch', features: [rectangle('B', 3, 0, 4, 1)] });
  assert.equal(moved.preparationStats.preparationCount, first.preparationStats.preparationCount + 1);
  assert.deepEqual(moved.packet.segments[0].ownerIds, ['B', 'C']);
  assert.equal(moved.packet.segments[0].refs, undefined, 'source refs stay in the Worker rather than being cloned to renderers');
  const deleted = await request({ type: 'patch', removedIds: ['C'] });
  assert.deepEqual(deleted.packet.segments, []);
});

test('the real Worker hydrates the current cache payload before classifying parent-child interiors', async t => {
  const rows = [rectangle('ROOT', 0, 0, 1, 1), rectangle('CHILD', 1, 0, 2, 1, 'ROOT')];
  const cache = { version: 1, quality: 'preview', signatures: Object.fromEntries(rows.map(row => [row.id, countryGeometrySignature(row)])),
    segments: serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(rows)) };
  const request = countryWorker(t, cache);
  const initial = await request({ type: 'replace', features: rows, cacheUrl: 'https://test.invalid/cache', skipCacheReconcile: true });
  assert.equal(initial.preparationStats.contactComputationCount, 0);
  assert.deepEqual(initial.packet.internalOwners['CHILD|ROOT'], ['CHILD']);
  const same = await request({ type: 'replace', features: rows, cacheUrl: 'https://test.invalid/cache', skipCacheReconcile: true });
  assert.deepEqual(same.preparationStats, initial.preparationStats);
});

test('the real Worker coalesces rapid replace patches and deletions while preserving the latest owner metadata', async t => {
  const old = [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1), rectangle('OLD_ONLY', 100, 0, 101, 1)];
  const cache = { version: 1, quality: 'preview', signatures: Object.fromEntries(old.map(row => [row.id, countryGeometrySignature(row)])),
    segments: serializeCountrySharedBoundarySegments(buildCountrySharedBoundarySegments(old)) };
  const moduleUrl = new URL('../../assets/js/workers/country-shared-boundary-worker.js', import.meta.url).href;
  const wrapper = `import { parentPort, workerData } from 'node:worker_threads';
    import { gzipSync } from 'node:zlib';
    let release;
    globalThis.self = { location: { href: ${JSON.stringify(moduleUrl)} }, postMessage: (...args) => parentPort.postMessage(...args) };
    globalThis.fetch = async () => {
      parentPort.postMessage({ type: 'cache-stalled' });
      return new Promise(resolve => { release = () => resolve(new Response(gzipSync(JSON.stringify(workerData.cache)))); });
    };
    await import(${JSON.stringify(moduleUrl)});
    parentPort.on('message', data => data.type === 'release-cache' ? release() : self.onmessage({ data }));`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(wrapper)}`), { workerData: { cache } });
  t.after(() => worker.terminate());
  const send = (requestId, message) => worker.postMessage({ requestId, projectGeneration: 8,
    geometryRevision: requestId, quality: 'preview', ...message });
  const stalled = new Promise((resolve, reject) => {
    worker.once('message', message => message.type === 'cache-stalled' ? resolve() : reject(new Error(`Unexpected first reply: ${message.type}`)));
    worker.once('error', reject);
  });
  send(1, { type: 'replace', features: old, cacheUrl: 'https://test.invalid/cache', skipCacheReconcile: true });
  await stalled;
  const replies = [];
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('coalesced boundary request timed out')), 10000);
    worker.on('message', message => {
      if (message.type === 'error') { clearTimeout(timeout); reject(new Error(message.message)); }
      if (message.type === 'prepared') {
        replies.push(message);
        if (message.requestId === 5) { clearTimeout(timeout); resolve(message); }
      }
    });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  send(2, { type: 'replace', features: [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1), rectangle('C', 4, 0, 5, 1)],
    cacheUrl: 'https://test.invalid/cache', skipCacheReconcile: true });
  send(3, { type: 'patch', features: [rectangle('B', 3, 0, 4, 1), rectangle('TEMP', 20, 0, 21, 1)] });
  send(4, { type: 'patch', features: [rectangle('C', 4, 0, 5, 1, 'B')], removedIds: ['TEMP'] });
  send(5, { type: 'patch', features: [rectangle('B', 3, 0, 4, 1)], removedIds: ['A', 'B'] });
  worker.postMessage({ type: 'release-cache' });
  const final = await result;
  assert.deepEqual(replies.map(message => message.requestId), [5], 'superseded jobs must not publish prepared packets');
  assert.equal(final.geometryRevision, 5);
  assert.equal(final.projectGeneration, 8);
  assert.equal(final.quality, 'preview');
  assert.equal(final.preparationStats.preparationCount, 2, 'only the final two geometries need preparation');
  assert.equal(final.preparationStats.contactComputationCount, 1);
  assert.deepEqual(final.packet.ownerIds.sort(), ['B', 'C']);
  assert.deepEqual(final.packet.internalOwners['B|C'], ['C'], 'latest child/root metadata must classify the contact');
  assert.ok(final.packet.segments.every(segment => segment.start[0] === 4 && segment.end[0] === 4));
});
