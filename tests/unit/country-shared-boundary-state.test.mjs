import '../helpers/spherical-core.mjs';
const verifiedNodeCoreUrl = new URL('../../tools/load-spherical-core.mjs', import.meta.url).href;
import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createCountrySharedBoundaryState, prepareCountrySharedBoundaryPacket } from "../../shared/frontend/js/modules/country-shared-boundary-packet.js";
import { boundarySourceSegments, buildCountrySharedBoundarySegments, serializeCountrySharedBoundarySegments, hasOpposingBoundaryInteriors } from "../../shared/frontend/js/modules/boundary-topology.js";
import { countryGeometrySignature } from "../../shared/frontend/js/modules/country-shared-boundary-cache.js";
import { geometryRevisionKey } from "../../shared/frontend/js/modules/geometry-versions.js";
import { MAX_BOUNDARY_EDGE_DEGREES } from "../../shared/frontend/js/modules/geographic-boundary.js";
import { sharedCalculationCore } from "../../shared/frontend/js/modules/temporal.js";

const rectangle = (id, west, south, east, north, root = id) => {
  const geometry = { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
  return { type: 'Feature', id, properties: {}, geometry, boundaryRootId: root,
    boundaryGeometryRevision: geometryRevisionKey(geometry) };
};
const coordinates = state => serializeCountrySharedBoundarySegments(state.segments());

test('large outlines cross the compiled boundary budget without losing edges or ordering', t => {
  const count = 20_000, radius = .1;
  const ring = Array.from({ length: count }, (_, index) => {
    const angle = index / count * 2 * Math.PI;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  ring.push([...ring[0]]);
  const geometry = { type: 'Polygon', coordinates: [ring] };
  const feature = { type: 'Feature', id: 'A', properties: {}, geometry,
    boundaryGeometryRevision: geometryRevisionKey(geometry) };
  const original = sharedCalculationCore.boundarySubtractOverlapsBatch, batches = [];
  t.mock.method(sharedCalculationCore, 'boundarySubtractOverlapsBatch', rows => {
    // Reproduce the real WASM request guard at a smaller fixture budget.
    if (rows.length > 16_384) throw new Error('INVALID_BOUNDARY_OVERLAP: too many source edges');
    batches.push(rows.length);
    return original.call(sharedCalculationCore, rows);
  });
  const packet = prepareCountrySharedBoundaryPacket([], [feature]);
  const outline = packet.outlineOverrides.segments;
  assert.ok(batches.length > 1);
  assert.equal(batches.reduce((sum, size) => sum + size, 0), count);
  assert.equal(outline.length, count);
  const expected = sharedCalculationCore.boundaryRefineSegments(
    ring.slice(0, -1).map((start, index) => [start, ring[index + 1]]), MAX_BOUNDARY_EDGE_DEGREES);
  for (let index = 0; index < count; index++) {
    assert.deepEqual(outline[index].ownerIds, ['A']);
    assert.deepEqual(outline[index].start, expected[index][0]);
    assert.deepEqual(outline[index].end, expected[index][1]);
  }
});

const packetLength = packet => packet.segments.reduce((sum, segment) => sum
  + Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]), 0);
const sphericalEdgeDegrees = (a, b) => {
  const radians = Math.PI / 180;
  const direction = ([longitude, latitude]) => [
    Math.cos(latitude * radians) * Math.cos(longitude * radians),
    Math.cos(latitude * radians) * Math.sin(longitude * radians),
    Math.sin(latitude * radians),
  ];
  const x = direction(a), y = direction(b);
  return Math.acos(Math.max(-1, Math.min(1, x.reduce((sum, value, index) => sum + value * y[index], 0)))) / radians;
};

test('display subdivision updates owner ranges and keeps dash phases along reversed connected source edges', () => {
  const input = [
    { start: [0, 0], end: [2, 0], ownerIds: ['A', 'B'] },
    { start: [50, 1], end: [52, 1], ownerIds: ['X', 'Y'] },
    { start: [4, 0], end: [2, 0], ownerIds: ['A', 'B'] },
    { start: [10, 0], end: [11, 0], ownerIds: ['A', 'B'] },
  ];
  const before = structuredClone(input);
  const packet = prepareCountrySharedBoundaryPacket(input);
  assert.deepEqual(input, before);
  assert.equal(packetLength(packet), 7);
  assert.ok(packet.segments.length > input.length);
  const first = packet.ownerRanges['A|B'], second = packet.ownerRanges['X|Y'];
  assert.equal(first.first, 0);
  assert.equal(second.first, first.count);
  assert.equal(first.count + second.count, packet.segments.length);
  assert.equal(packet.startsEnds.length, packet.segments.length * 4);
  assert.deepEqual(packet.preparedGeometry.ownerRanges, packet.ownerRanges);
  assert.equal(packet.preparedGeometry.capCount, 6, 'subdivision must not create separate dash chains');
  packet.segments.forEach((segment, index) => {
    assert.ok(Math.max(Math.abs(segment.end[0] - segment.start[0]), Math.abs(segment.end[1] - segment.start[1]))
      <= MAX_BOUNDARY_EDGE_DEGREES + 1e-6);
    assert.deepEqual(segment.ownerIds, index < second.first ? ['A', 'B'] : ['X', 'Y']);
    const expectedPhase = segment.start[0] < 4 ? segment.start[0]
      : segment.start[0] < 20 ? segment.start[0] - 10 : segment.start[0] - 50;
    assert.ok(Math.abs(packet.chainPhase[index] - expectedPhase) < 1e-5);
    assert.equal(packet.preparedGeometry.instances[index * 10 + 8], packet.chainPhase[index]);
  });
});

test('replacement outlines are subdivided only after the internal contact is removed', () => {
  const state = createCountrySharedBoundaryState();
  state.replace([rectangle('ROOT', 0, 0, 2, 6), rectangle('CHILD', 2, 1, 3, 5, 'ROOT')]);
  const packet = prepareCountrySharedBoundaryPacket(state.segments(), state.features(), { preparedStore: state.preparedStore });
  assert.equal(packetLength(packet), 4);
  assert.deepEqual(packet.internalOwners['CHILD|ROOT'], ['CHILD']);
  const outlines = packet.outlineOverrides;
  assert.ok(Math.abs(packetLength(outlines) - 18) < 1e-9);
  assert.deepEqual(outlines.ownerIds, ['CHILD', 'ROOT']);
  assert.deepEqual(outlines.internalOwners.CHILD, ['CHILD']);
  assert.deepEqual(outlines.preparedGeometry.ownerRanges, outlines.ownerRanges);
  assert.equal(outlines.preparedGeometry.capCount, 4);
  for (const segment of outlines.segments) {
    assert.ok(sphericalEdgeDegrees(segment.start, segment.end) <= MAX_BOUNDARY_EDGE_DEGREES + 1e-6);
    if (segment.start[0] === 2 && segment.end[0] === 2) {
      assert.ok(Math.max(segment.start[1], segment.end[1]) <= 1 || Math.min(segment.start[1], segment.end[1]) >= 5);
    }
  }
});

test('terrain packets defer exterior outlines while preserving shared and internal borders', () => {
  const state = createCountrySharedBoundaryState();
  state.replace([rectangle('ROOT', 0, 0, 2, 6), rectangle('CHILD', 2, 1, 3, 5, 'ROOT')]);
  const stats = state.stats();
  const terrain = prepareCountrySharedBoundaryPacket(state.segments(), state.features(),
    { preparedStore: state.preparedStore, includeOutlines: false });
  assert.deepEqual(terrain.outlineOverrides.segments, []);
  assert.equal(terrain.outlineOverrides.preparedGeometry.segmentCount, 0);
  assert.deepEqual(terrain.internalOwners['CHILD|ROOT'], ['CHILD']);
  const political = prepareCountrySharedBoundaryPacket(state.segments(), state.features(),
    { preparedStore: state.preparedStore, includeOutlines: true });
  assert.deepEqual(terrain.segments, political.segments);
  assert.deepEqual(terrain.internalOwners, political.internalOwners);
  assert.deepEqual(terrain.outlineOwnerIds, political.outlineOwnerIds);
  assert.ok(packetLength(political.outlineOverrides) > 0);
  assert.deepEqual(state.stats(), stats, 'map-mode changes reuse prepared topology without recalculating contacts');
});

test('dateline display pieces keep one dash phase without a long closing chord', () => {
  const packet = prepareCountrySharedBoundaryPacket([{ start: [179, 0], end: [-179, 0], ownerIds: ['A', 'B'] }]);
  assert.equal(packetLength(packet), 2);
  let phase = 0;
  packet.segments.forEach((segment, index) => {
    assert.ok(Math.abs(segment.end[0] - segment.start[0]) <= MAX_BOUNDARY_EDGE_DEGREES + 1e-6);
    assert.ok(Math.abs(packet.chainPhase[index] - phase) < 1e-5);
    assert.equal(packet.preparedGeometry.instances[index * 10 + 8], packet.chainPhase[index]);
    phase += Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]);
  });
});

test('parent-child exterior classification is unchanged by equivalent dateline longitude representations', () => {
  const child = rectangle('CHILD', 179, 0, 179.5, 1, 'ROOT');
  for (const east of [-179, 181]) {
    const parent = rectangle('ROOT', 179, 0, east, 1);
    const before = structuredClone([parent, child]);
    const state = createCountrySharedBoundaryState(); state.replace([parent, child]);
    const west = state.segments().find(segment => segment.start[0] === 179 && segment.end[0] === 179);
    assert.ok(west);
    assert.equal(hasOpposingBoundaryInteriors(west), false, `parent east ${east}`);
    assert.deepEqual([parent, child], before, 'classification must preserve source coordinates');
  }
});

test('both polar caps classify their coincident child perimeter as an exterior', () => {
  for (const latitude of [80, -80]) {
    const north = latitude > 0;
    const ring = (north ? [[-135, latitude], [135, latitude], [45, latitude], [-45, latitude], [-135, latitude]]
      : [[-135, latitude], [-45, latitude], [45, latitude], [135, latitude], [-135, latitude]]);
    const parent = { id: 'ROOT', geometry: { type: 'Polygon', coordinates: [ring] } };
    const childRing = north ? [[45, 80], [45, 85], [135, 85], [135, 80], [45, 80]]
      : [[-45, -80], [-45, -85], [45, -85], [45, -80], [-45, -80]];
    const child = { id: 'CHILD', geometry: { type: 'Polygon', coordinates: [childRing] } };
    const edge = boundarySourceSegments(parent).find(row => row.segmentIndex === 1);
    const childEdge = boundarySourceSegments(child).find(row => row.segmentIndex === 3);
    const segment = { start: edge.a, end: edge.b, ownerIds: ['ROOT', 'CHILD'], refs: [edge, childEdge] };
    assert.equal(hasOpposingBoundaryInteriors(segment), false, `polar cap ${latitude}`);
    const hole = { id: 'HOLE', geometry: { type: 'Polygon', coordinates: [ring, childRing] } };
    const holeEdge = boundarySourceSegments(hole).find(row => row.ringIndex === 1 && row.segmentIndex === 3);
    assert.equal(hasOpposingBoundaryInteriors({ ...segment, ownerIds: ['HOLE', 'CHILD'], refs: [holeEdge, childEdge] }), true,
      'the hole and its occupant have land on opposite sides');
  }
});

test('a dateline-crossing source edge retains its direction relative to a short shared segment', () => {
  const parent = rectangle('ROOT', 179, 0, -179, 1);
  const child = rectangle('CHILD', 179.2, 0.5, 179.8, 1, 'ROOT');
  const parentEdge = boundarySourceSegments(parent).find(row => row.segmentIndex === 2);
  const childEdge = boundarySourceSegments(child).find(row => row.segmentIndex === 2);
  const segment = { start: [179.2, 1], end: [179.8, 1], ownerIds: ['ROOT', 'CHILD'], refs: [parentEdge, childEdge] };
  assert.equal(hasOpposingBoundaryInteriors(segment), false);
  assert.equal(hasOpposingBoundaryInteriors({ ...segment, start: segment.end, end: segment.start }), false);
});

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

test('prepared shared geometry reuses the first hierarchy and outline derivation without revisiting coordinates', () => {
  const state = createCountrySharedBoundaryState();
  const parent = rectangle('ROOT', 0, 0, 4, 4), child = rectangle('CHILD', 0, 0, 2, 4, 'ROOT');
  state.replace([parent, child]);
  const first = prepareCountrySharedBoundaryPacket(state.segments(), state.features(), { preparedStore: state.preparedStore });
  for (const row of [parent, child]) Object.defineProperty(row.geometry, 'coordinates', {
    get: () => { throw new Error('unchanged geometry was traversed again'); },
  });
  const packet = prepareCountrySharedBoundaryPacket(state.segments(), state.features(), { preparedStore: state.preparedStore });
  assert.deepEqual(packet.internalOwners, first.internalOwners);
  assert.deepEqual(packet.segments, first.segments);
  assert.deepEqual(packet.outlineOverrides.segments, first.outlineOverrides.segments);
  assert.deepEqual(packet.outlineOwnerIds, ['CHILD', 'ROOT']);
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

function countryWorker(t, cache, quality = 'preview') {
  const moduleUrl = new URL("../../shared/frontend/js/workers/country-shared-boundary-worker.js", import.meta.url).href;
  const wrapper = `import { parentPort, workerData } from 'node:worker_threads';
    import { gzipSync } from 'node:zlib';
    globalThis.self = { location: { href: ${JSON.stringify(moduleUrl)} }, postMessage: (...args) => parentPort.postMessage(...args) };
    if (workerData.cache) globalThis.fetch = async () => new Response(gzipSync(JSON.stringify(workerData.cache)));
    await import(${JSON.stringify(verifiedNodeCoreUrl)});
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
    worker.postMessage({ requestId: ++requestId, projectGeneration: 8, geometryRevision: 3, quality, ...message });
  });
}

test('the real Worker preserves canonical replace preparation and updates only patched contacts', async t => {
  const request = countryWorker(t, undefined, 'canonical');
  const rows = [rectangle('A', 0, 0, 1, 1), rectangle('B', 1, 0, 2, 1), rectangle('C', 4, 0, 5, 1)];
  const first = await request({ type: 'replace', features: rows });
  assert.equal(first.projectGeneration, 8); assert.equal(first.geometryRevision, 3);
  assert.ok(first.packet.ownerRanges['A|B'].count > 1);
  assert.equal(first.packet.startsEnds.length, first.packet.ownerRanges['A|B'].count * 4);
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
  const moduleUrl = new URL("../../shared/frontend/js/workers/country-shared-boundary-worker.js", import.meta.url).href;
  const wrapper = `import { parentPort, workerData } from 'node:worker_threads';
    import { gzipSync } from 'node:zlib';
    let release;
    globalThis.self = { location: { href: ${JSON.stringify(moduleUrl)} }, postMessage: (...args) => parentPort.postMessage(...args) };
    globalThis.fetch = async () => {
      parentPort.postMessage({ type: 'cache-stalled' });
      return new Promise(resolve => { release = () => resolve(new Response(gzipSync(JSON.stringify(workerData.cache)))); });
    };
    await import(${JSON.stringify(verifiedNodeCoreUrl)});
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
