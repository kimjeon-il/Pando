import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import { semanticSnapshot, summarizeLatency, resourceDelta, replaceExactlyOnce, installMapBaselineCollector, instrumentMapBaselineSource } from '../helpers/map-transition-baseline.mjs';

const document = () => ({
  documentId: 'ephemeral', projectSetup: { initialMonth: '1950-12' },
  territorialEntities: [{ id: 'B', geometry: { coordinates: [[1, 2]] }, properties: { name: 'Beta' } },
    { id: 'A', properties: { name: 'Alpha', color: '#123456', flag: 'flag-a', parentId: '' } }],
  geometries: [{ id: 'g', version: 1, coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] }],
  timelineRecords: { lifetimes: [], geometryBindings: [], propertyBindings: [], parentRelations: [] },
});

test('semantic baseline ignores document instance metadata, not map content', () => {
  const a = document(), b = document(); b.documentId = 'another'; b.projectSetup.initialMonth = '1951-12';
  assert.deepEqual(semanticSnapshot(a), semanticSnapshot(b));
  assert.ok(semanticSnapshot(a).territorialEntities.length === 2);
});
test('semantic baseline normalizes object keys and entity order without mutating source', () => {
  const a = document(), original = structuredClone(a), b = document(); b.territorialEntities.reverse();
  assert.deepEqual(semanticSnapshot(a), semanticSnapshot(b)); assert.deepEqual(a, original);
});
for (const [field, value] of [['name', 'Changed'], ['color', '#ffffff'], ['flag', 'flag-b'], ['parentId', 'B']]) {
  test(`semantic baseline detects ${field} changes`, () => {
    const a = document(), b = document(); b.territorialEntities[1].properties[field] = value;
    assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
  });
}
test('semantic baseline preserves full geometry coordinates and version', () => {
  const a = document(), b = document(); b.geometries[0].coordinates[0][1][1] = 1.00000001;
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
  b.geometries[0].coordinates = a.geometries[0].coordinates; b.geometries[0].version = 2;
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
});
test('semantic baseline detects entity existence and temporal record changes', () => {
  const a = document(), b = document(); b.territorialEntities.pop();
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(b));
  const c = document(); c.timelineRecords.lifetimes.push({ entityId: 'A', validTo: '1950-12-31' });
  assert.notDeepEqual(semanticSnapshot(a), semanticSnapshot(c));
});
test('missing semantic fields are a measurement failure, not an empty map', () => {
  assert.throws(() => semanticSnapshot({}), /territorialEntities/);
  const a = document(); delete a.geometries; assert.throws(() => semanticSnapshot(a), /geometries/);
});
test('latency summary uses nearest-rank percentiles and records sample count', () => {
  const result = summarizeLatency(Array.from({length: 20}, (_, i) => ({ ms: i + 1, outcome: 'success' })));
  assert.deepEqual(result, { count: 20, failed: 0, incomplete: 0, p50Ms: 10, p95Ms: 19, maxMs: 20, meanMs: 10.5 });
});
test('failed, incomplete and invalid samples cannot become zero-millisecond success', () => {
  assert.deepEqual(summarizeLatency([{ms: 7, outcome: 'success'}, {ms: 2, outcome: 'failed'}, {ms: null, outcome: 'incomplete'}]),
    {count: 1, failed: 1, incomplete: 1, p50Ms: 7, p95Ms: 7, maxMs: 7, meanMs: 7});
  for (const ms of [null, undefined, NaN, Infinity, -1]) assert.throws(() => summarizeLatency([{ms, outcome: 'success'}]), /latency/);
  assert.throws(() => summarizeLatency([{ms: 1, outcome: 'unknown'}]), /outcome/);
});
test('empty latency series remains explicitly unmeasured', () => {
  assert.deepEqual(summarizeLatency([]), {count: 0, failed: 0, incomplete: 0, p50Ms: null, p95Ms: null, maxMs: null, meanMs: null});
});
test('resource deltas preserve unsupported metrics and allow GC reductions', () => {
  assert.deepEqual(resourceDelta({heap: 10, gpu: null, workers: 2}, {heap: 8, gpu: null, workers: 3}),
    {heap: -2, gpu: null, workers: 1});
});
test('instrumentation must find one exact anchor; source drift fails closed', () => {
  assert.equal(replaceExactlyOnce('before ANCHOR after', 'ANCHOR', 'probe;ANCHOR'), 'before probe;ANCHOR after');
  assert.throws(() => replaceExactlyOnce('none', 'ANCHOR', 'probe'), /exactly one/);
  assert.throws(() => replaceExactlyOnce('ANCHOR ANCHOR', 'ANCHOR', 'probe'), /exactly one/);
});

function collector() {
  let now = 0; const handlers = {};
  const sandbox = { performance: {now: () => ++now},
    document: {addEventListener: (name, fn) => {handlers[name] = fn;}},
    PerformanceObserver: {supportedEntryTypes: []} };
  runInNewContext(`(${installMapBaselineCollector.toString()})()`, sandbox);
  return {probe: sandbox.__PANDO_P0__, handlers};
}
test('collector pairs actual input and displayed/settled markers without fabricating resources', () => {
  const {probe, handlers} = collector();
  handlers.click({target: {closest: () => ({id: 'timelinePreviousYear'})}});
  probe.begin('1950-12'); probe.presented('1950-12'); probe.settled();
  const data = probe.snapshot();
  assert.equal(data.events[0].origin, 'dom-input');
  assert.deepEqual(Array.from(data.events, row => row.kind), ['requested', 'presented', 'settled']);
  assert.equal(data.supported.longtask, false); assert.equal(data.resources.length, 0);
});
test('collector rejects wrong-month presentation and reports overlapping benchmark requests', () => {
  const {probe} = collector(); probe.begin('1950-12'); probe.presented('1951-12'); probe.begin('1952-12');
  assert.equal(probe.snapshot().errors.length, 2);
  assert.equal(probe.snapshot().events.some(row => row.kind === 'presented'), false);
});
test('collector distinguishes a handler-only start from a captured DOM input', () => {
  const {probe} = collector(); probe.begin('1950-12');
  assert.equal(probe.snapshot().events[0].origin, 'timeline-handler');
});
test('instrumentation preserves Core admission statement and refuses unsupported modules', () => {
  const statement = 'await commandOwner.loadBaseline(prepared.baselineId,prepared.setup);';
  const output = instrumentMapBaselineSource(statement, 'project-domain.js');
  assert.ok(output.includes(statement)); assert.ok(output.includes('core-load:start')); assert.ok(output.includes('core-load:end'));
  assert.throws(() => instrumentMapBaselineSource('', 'unknown.js'), /Unknown probe/);
});

test('diagnostic observation has a deadline when a browser stops replying', async () => {
  const {observeWithDeadline} = await import('../helpers/map-transition-baseline.mjs');
  const result = await observeWithDeadline(() => new Promise(() => {}), 5);
  assert.equal(result.status, 'timeout'); assert.equal(result.value, null);
});
test('diagnostic observation distinguishes a real null, thrown error and data', async () => {
  const {observeWithDeadline} = await import('../helpers/map-transition-baseline.mjs');
  assert.deepEqual(await observeWithDeadline(() => null), {status: 'ok', value: null});
  assert.deepEqual(await observeWithDeadline(() => ({count: 4})), {status: 'ok', value: {count: 4}});
  const failed = await observeWithDeadline(() => {throw new Error('closed page');});
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /closed page/);
});
