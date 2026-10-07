import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { installGpuStrokeDiagnostics, instrumentSelectionPassSource, instrumentStrokeRendererSource, summarizeStrokeUploadState, boundedDiagnostic, installCanvasTransportDiagnostics, instrumentCanvasTransportSource, logMapDiagnostic, withDiagnosticDeadline, withMapDiagnostics } from '../browser/helpers/map-diagnostics.mjs';

test('diagnostic summaries bound arrays, strings, depth and cycles without mutating input', () => {
  const source = { keys: Array.from({ length: 20 }, (_, i) => `key-${i}`), message: 'x'.repeat(1000) };
  source.self = source;
  const result = boundedDiagnostic(source);
  assert.equal(result.keys.count, 20);
  assert.equal(result.keys.items.length, 8);
  assert.ok(result.message.length < 300);
  assert.equal(result.self, '[circular]');
  assert.equal(source.keys.length, 20);
  assert.equal(source.message.length, 1000);
});

test('JSON diagnostics include boundary and phase and impose a total output bound', async () => {
  const lines = [];
  await logMapDiagnostic('selection', 'before', () => ({ values: Array.from({ length: 100 }, () => ({ long: 'x'.repeat(10000) })) }), line => lines.push(line));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length <= 24000);
  const row = JSON.parse(lines[0].slice('[map-diagnostic] '.length));
  assert.equal(row.boundary, 'selection');
  assert.equal(row.phase, 'before');
  assert.equal(row.data.values.count, 100);
});

test('failed diagnostic reads retain the exact original assertion error and run action once', async () => {
  const original = new Error('rendered coverage assertion');
  const lines = [];
  let attempts = 0;
  await assert.rejects(withMapDiagnostics('selection', () => { throw new Error('page closed'); }, async () => {
    attempts += 1;
    throw original;
  }, line => lines.push(line)), error => error === original);
  assert.equal(attempts, 1);
  assert.deepEqual(lines.map(line => JSON.parse(line.slice('[map-diagnostic] '.length)).phase), ['before', 'failed']);
  assert.ok(lines.every(line => line.includes('page closed')));
});

test('failed diagnostic output cannot fail a successful action or mask its result', async () => {
  const result = await withMapDiagnostics('color', () => ({ revision: 1 }), async () => 42, () => { throw new Error('closed output'); });
  assert.equal(result, 42);
});

test('nested diagnostic summaries stop at the depth limit', () => {
  let source = { leaf: true };
  for (let i = 0; i < 20; i++) source = { child: source };
  let result = boundedDiagnostic(source);
  for (let i = 0; i < 8; i++) result = result.child;
  assert.equal(result, '[depth limit]');
});

test('large escaped output stays valid JSON below the log limit', async () => {
  const source = Array.from({ length: 8 }, () => Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, '\\'.repeat(1000)])));
  const lines = [];
  await logMapDiagnostic('large-result', 'failed', () => source, line => lines.push(line));
  assert.ok(lines[0].length < 24000);
  assert.equal(JSON.parse(lines[0].slice('[map-diagnostic] '.length)).truncated, true);
});

test('successful boundary reports before/after once without repeating the action', async () => {
  let revision = 0;
  const lines = [];
  const result = await withMapDiagnostics('color', () => ({ revision }), async () => ++revision, line => lines.push(line));
  assert.equal(result, 1);
  assert.deepEqual(lines.map(line => JSON.parse(line.slice('[map-diagnostic] '.length))), [
    { boundary: 'color', phase: 'before', data: { revision: 0 } },
    { boundary: 'color', phase: 'after', data: { revision: 1 } },
  ]);
});


test('a never-settling failure read cannot hide the exact original assertion', { timeout: 4000 }, async () => {
  const original = new Error('original pixel assertion');
  let reads = 0;
  const lines = [];
  await assert.rejects(withMapDiagnostics('color', () => {
    if (++reads === 1) return { ready: true };
    return new Promise(() => {});
  }, async () => { throw original; }, line => lines.push(line)), error => error === original);
  const failed = JSON.parse(lines.at(-1).slice('[map-diagnostic] '.length));
  assert.equal(failed.phase, 'failed');
  assert.match(failed.data.diagnosticError.message, /Diagnostic read exceeded 1000 ms/);
});

test('a timed-out read contains its later rejection', async () => {
  let rejectRead;
  const pending = new Promise((_, reject) => { rejectRead = reject; });
  await assert.rejects(withDiagnosticDeadline(() => pending, 1), /Diagnostic read exceeded 1 ms/);
  rejectRead(new Error('late page closure'));
  // Flush the already-observed rejection; node:test reports any unhandled one.
  await Promise.resolve();
});

test('diagnostic deadlines clear timers after successful and rejected reads', async t => {
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (...args) => {
    const timer = originalSetTimeout(...args); timers.push(timer); return timer;
  });
  const cleared = t.mock.method(globalThis, 'clearTimeout', timer => originalClearTimeout(timer));
  assert.equal(await withDiagnosticDeadline(() => 42), 42);
  await assert.rejects(withDiagnosticDeadline(() => { throw new Error('read rejected'); }), /read rejected/);
  await assert.rejects(withDiagnosticDeadline(() => new Promise(() => {}), 1), /exceeded/);
  assert.deepEqual(cleared.mock.calls.map(call => call.arguments[0]), timers);
});


const canvasTransportSource = readFileSync(new URL('../../assets/js/modules/gpu-canvas-worker.js', import.meta.url), 'utf8');
function observedCanvasTransport() {
  const scope = { window: {}, performance: { now: () => 123 }, setTimeout, clearTimeout };
  vm.runInNewContext(`(${installCanvasTransportDiagnostics.toString()})()`, scope);
  const factory = vm.runInNewContext(instrumentCanvasTransportSource(canvasTransportSource)
    .replace('export function createGpuCanvasWorker', 'function createGpuCanvasWorker') + '\ncreateGpuCanvasWorker;', scope);
  return { factory, scope };
}

test('Canvas observation requires both exact source anchors once', () => {
  assert.throws(() => instrumentCanvasTransportSource('unrelated source'), /anchor/);
  assert.throws(() => instrumentCanvasTransportSource(canvasTransportSource + '\nworker.postMessage(...args); return true;'), /anchor/);
  assert.throws(() => instrumentCanvasTransportSource(canvasTransportSource.replace('&& acceptFrame(message);', '&& acceptFrame({ ...message });')), /anchor/);
});

test('Canvas observation preserves successful postMessage receiver, arguments and transport return', () => {
  const { factory, scope } = observedCanvasTransport();
  const calls = [];
  const native = { postMessage(...args) { calls.push({ receiver: this, args }); return 'native-return'; }, terminate() {} };
  const channel = factory({ worker: native, generation: 7, acceptFrame: () => true });
  const fill = { color: '#ef4444', fillAlpha: 1, opacity: 0.5, geometry: { forbidden: true } };
  const message = { type: 'style', styleRevision: 8, fills: { TUR: fill, FRA: { color: '#abc' } } };
  const transfers = [{}], options = { transfer: transfers };
  assert.equal(channel.postMessage(message, transfers), true);
  assert.equal(channel.postMessage(message, options), true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.receiver === native && call.args[0] === message));
  assert.equal(calls[0].args[1], transfers);
  assert.equal(calls[1].args[1], options);
  const observed = scope.window.__canvasTransportProbe;
  assert.equal(observed.latestStyle.fill.color, '#ef4444');
  assert.equal(observed.latestStyle.fillPresent, true);
  assert.equal(observed.latestStyle.generation, 7);
  assert.equal(observed.latestStyle.requestedRevision, 0);
  fill.color = '#changed-after-send';
  assert.equal(observed.latestStyle.fill.color, '#ef4444');
  assert.ok(!JSON.stringify(observed).includes('forbidden'));
  assert.ok(!JSON.stringify(observed).includes('FRA'));
  const failure = new Error('postMessage failed');
  native.postMessage = () => { throw failure; };
  assert.throws(() => channel.postMessage(message), error => error === failure);
  assert.equal(observed.counts.sent, 2);
});

test('Canvas observation keeps the real acceptance short circuit and bitmap ownership unchanged', () => {
  const { factory, scope } = observedCanvasTransport();
  const sent = [], presented = [], stale = [];
  let accepts = 0, closed = 0;
  const native = { postMessage: value => sent.push(value), terminate() {} };
  const channel = factory({ worker: native, generation: 7, acceptFrame: () => { accepts++; return true; }, onStale: value => stale.push(value) });
  channel.onmessage = event => { if (event.data.type === 'frame') presented.push(event); };
  native.onmessage({ data: { type: 'ready' } });
  channel.queueFrame({ type: 'view', revision: 2, projectGeneration: 7 });
  const bitmap = { close: () => closed++, marker: 'never-retain-bitmap' };
  native.onmessage({ data: { type: 'frame', projectGeneration: 6, revision: 2, bitmap } });
  native.onmessage({ data: { type: 'frame', projectGeneration: 7, revision: 1, bitmap } });
  assert.equal(accepts, 0);
  const accepted = { data: { type: 'frame', projectGeneration: 7, revision: 2, styleRevision: 9, bitmap } };
  native.onmessage(accepted);
  assert.equal(accepts, 1);
  assert.equal(presented[0], accepted);
  assert.equal(closed, 2);
  assert.equal(stale.length, 2);
  const probe = scope.window.__canvasTransportProbe;
  assert.deepEqual(Array.from(probe.frameDecisions, row => row.current), [false, false, true]);
  assert.equal(probe.frameDecisions.at(-1).displayedRevision, 0);
  assert.equal(probe.frameDecisions.at(-1).requestedRevision, 2);
  assert.ok(!JSON.stringify(probe).includes('never-retain-bitmap'));
  assert.equal(sent.length, 1);
  scope.window.__recordCanvasTransport = () => { throw new Error('observer failed'); };
  assert.equal(channel.postMessage({ type: 'style' }), true);
  native.onmessage({ data: { type: 'frame', projectGeneration: 7, revision: 3, bitmap } });
  assert.equal(accepts, 2);
  assert.equal(presented.length, 2);
  assert.equal(closed, 2);
});

test('Canvas probe distinguishes absent fill from empty color and retains at most eight scalar rows', () => {
  const { factory, scope } = observedCanvasTransport();
  const native = { postMessage() {}, terminate() {} };
  const channel = factory({ worker: native, generation: 1, acceptFrame: () => false });
  channel.postMessage({ type: 'init', fills: {} });
  assert.equal(scope.window.__canvasTransportProbe.latestStyle.fillPresent, false);
  channel.postMessage({ type: 'style', fills: { TUR: { color: '' } } });
  assert.equal(scope.window.__canvasTransportProbe.latestStyle.fillPresent, true);
  assert.equal(scope.window.__canvasTransportProbe.latestStyle.fill.color, '');
  for (let i = 0; i < 20; i++) {
    channel.postMessage({ type: 'style', styleRevision: i, fills: { TUR: { color: '#c7e9b4' } } });
    channel.postMessage({ type: 'replace-data', geometryRevision: i, features: [{ huge: 'not-copied' }] });
    native.onmessage({ data: { type: 'frame', revision: i } });
  }
  const probe = scope.window.__canvasTransportProbe;
  assert.equal(probe.styleHistory.length, 8);
  assert.equal(probe.dataHistory.length, 8);
  assert.equal(probe.frameDecisions.length, 8);
  assert.equal(probe.latestData.featureCount, 1);
  assert.ok(!JSON.stringify(probe).includes('not-copied'));
});

test('Canvas observer errors do not change transport exceptions or acceptance calls', () => {
  const { factory, scope } = observedCanvasTransport();
  let sends = 0, accepts = 0;
  const sentFailure = new Error('original send callback');
  const acceptanceFailure = new Error('original acceptance callback');
  const native = { postMessage() { sends++; }, terminate() {} };
  const channel = factory({ worker: native, generation: 1, onSend: message => {
    if (message.rejectSend) throw sentFailure;
  }, acceptFrame: () => { accepts++; throw acceptanceFailure; } });
  assert.throws(() => channel.postMessage({ type: 'style', rejectSend: true }), error => error === sentFailure);
  assert.equal(sends, 0);
  assert.equal(scope.window.__canvasTransportProbe.counts.sent, 0);
  const diagnosticFailure = { type: 'style', get fills() { throw new Error('diagnostic getter'); } };
  assert.equal(channel.postMessage(diagnosticFailure), true);
  assert.equal(sends, 1);
  assert.equal(scope.window.__canvasTransportProbe.counts.observerErrors, 1);
  assert.throws(() => native.onmessage({ data: { type: 'frame', revision: 1 } }), error => error === acceptanceFailure);
  assert.equal(accepts, 1);
  assert.equal(scope.window.__canvasTransportProbe.frameDecisions.length, 0);
});

test('instrumented Canvas transport preserves coalescing, stale cleanup and shutdown behavior', () => {
  const original = vm.runInNewContext(canvasTransportSource.replace('export function createGpuCanvasWorker',
    'function createGpuCanvasWorker') + '\ncreateGpuCanvasWorker;', { setTimeout, clearTimeout });
  const observed = observedCanvasTransport().factory;
  const run = factory => {
    const events = [];
    const worker = { postMessage: message => events.push(['sent', message.revision]), terminate: () => events.push(['terminated']) };
    const channel = factory({ worker, generation: 2, acceptFrame: () => { events.push(['accept']); return true; },
      onStale: message => events.push(['stale', message.revision]) });
    channel.onmessage = event => events.push(['presented', event.data.type, event.data.revision]);
    channel.queueFrame({ type: 'view', revision: 1 });
    worker.onmessage({ data: { type: 'ready' } });
    channel.queueFrame({ type: 'view', revision: 2 });
    channel.queueFrame({ type: 'view', revision: 3 });
    for (const revision of [1, 3]) worker.onmessage({ data: { type: 'frame', revision,
      bitmap: { close: () => events.push(['closed', revision]) } } });
    channel.terminate();
    worker.onmessage({ data: { type: 'frame', revision: 4, bitmap: { close: () => events.push(['closed', 4]) } } });
    assert.equal(channel.postMessage({ type: 'style' }), false);
    return events;
  };
  assert.deepEqual(run(observed), run(original));
});

test('whole-case color failure emits cached stage/errors/sample even when its page read fails', async () => {
  const source = readFileSync(new URL('../browser/country-map-substrate.spec.mjs', import.meta.url), 'utf8');
  const lines = [];
  let afterEach;
  const browserTest = () => {};
  browserTest.use = () => {};
  browserTest.describe = (name, run) => run();
  browserTest.afterEach = hook => { afterEach = hook; };
  const caches = vm.runInNewContext(source.replace(/^import .*;\n/gm, '')
    + '\n({ pixelSamples, diagnosticStages, diagnosticErrors });', {
    test: browserTest,
    logMapDiagnostic: (boundary, phase, read) => logMapDiagnostic(boundary, phase, read, line => lines.push(line)),
  });
  const reads = [];
  const page = { evaluate: read => { reads.push(read.toString()); throw new Error('page unavailable'); } };
  const sample = { stage: 'reset-to-default', sampledAt: 123, value: [239, 68, 68], point: [32, 39] };
  caches.pixelSamples.set(page, sample);
  caches.diagnosticStages.set(page, 'reset-to-default');
  caches.diagnosticErrors.set(page, ['recorded page error']);
  await afterEach({ page }, { title: 'Canvas reset', status: 'failed', expectedStatus: 'passed' });
  const rows = lines.map(line => JSON.parse(line.slice('[map-diagnostic] '.length)));
  assert.equal(rows[0].phase, 'failed-case-cached');
  assert.deepEqual(rows[0].data, { stage: 'reset-to-default', lastPixelSample: sample, errors: ['recorded page error'] });
  assert.equal(rows[1].phase, 'failed-case');
  assert.match(rows[1].data.diagnosticError.message, /page unavailable/);
  assert.equal(reads.length, 1);
  assert.match(reads[0], /__PANDOLAB_RENDER_DEBUG__/);
  assert.doesNotMatch(reads[0], /captureScreenshot|getImageData|__PANDOLAB_MAP_HOST__\.project/);
  assert.equal(caches.pixelSamples.get(page), sample);
  await afterEach({ page }, { title: 'Canvas reset', status: 'passed', expectedStatus: 'passed' });
  assert.equal(lines.length, 2);
});


const selectionPassSource = readFileSync(new URL('../../assets/js/modules/selection-pass.js', import.meta.url), 'utf8');
const strokeRendererSource = readFileSync(new URL('../../assets/js/modules/gpu-stroke-renderer.js', import.meta.url), 'utf8');

test('stroke queue summaries identify signature, per-job progress and bytes ahead without retaining geometry', () => {
  const job = (part, offset, signature) => ({ part, offset, signature, geometry: { instances: new Uint8Array(100), nodes: new Uint8Array(60) }, buffers: [{ forbidden: true }] });
  const queue = new Map([['ahead', job(1, 20, 'ahead:1:high')], ['required', job(0, 30, 'required:2:high')]]);
  const resident = new Map([['required', { signature: 'required:1:high', byteLength: 12, buffer: { forbidden: true } }]]);
  const result = summarizeStrokeUploadState(resident, queue, 'required', 'required:2:high');
  assert.equal(result.storedSignature, 'required:1:high');
  assert.equal(result.matchesExpected, false);
  assert.equal(result.pending.matchesExpected, true);
  assert.equal(result.pending.totalBytes, 160);
  assert.equal(result.pending.uploadedBytes, 30);
  assert.equal(result.pending.remainingBytes, 130);
  assert.equal(result.queuePosition, 1);
  assert.equal(result.remainingBytesAhead, 40);
  assert.equal(result.pending.instancesBytes, 100);
  assert.equal(result.pending.nodesBytes, 60);
  assert.ok(!JSON.stringify(result).includes('forbidden'));
  queue.get('required').part = 1; queue.get('required').offset = 15;
  assert.equal(summarizeStrokeUploadState(resident, queue, 'required', 'required:2:high').pending.uploadedBytes, 115);
  queue.get('required').part = 2;
  assert.equal(summarizeStrokeUploadState(resident, queue, 'required', 'required:2:high').pending.remainingBytes, 0);
});

test('GPU source probes require exact unique original draw/upload anchors', () => {
  assert.throws(() => instrumentSelectionPassSource('missing'), /anchor/);
  assert.throws(() => instrumentStrokeRendererSource('missing'), /anchor/);
  const draw = 'const result = strokeRenderer.drawBatches([batch], frameContext, { preparedOnly });';
  assert.throws(() => instrumentSelectionPassSource(selectionPassSource + draw), /anchor/);
  const patched = instrumentStrokeRendererSource(strokeRendererSource);
  assert.ok(patched.includes('const { resource, reason } = preparedOnly'));
  assert.ok(patched.includes('if (isInputActive() || globalThis.document?.hidden || globalThis.navigator?.scheduling?.isInputPending?.()) return scheduleUpload();'));
  assert.ok(patched.includes('__readStrokeUploadDiagnostics'));
});

let observedGpuModuleSequence = 0;
async function observedGpuModule(name, source, instrument, scope) {
  globalThis.__mapDiagnosticTestWindow = scope.window;
  try {
    const url = new URL(`../../assets/js/modules/${name}`, import.meta.url);
    const patched = instrument(source).replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${new URL(relative, url).href}'`);
    return await import(`data:text/javascript,${encodeURIComponent(`// probe module ${++observedGpuModuleSequence}\nconst window = globalThis.__mapDiagnosticTestWindow;\n` + patched)}`);
  } finally { delete globalThis.__mapDiagnosticTestWindow; }
}
function gpuProbeScope() {
  const scope = { window: {}, performance: { now: () => 123 } };
  vm.runInNewContext(`(${installGpuStrokeDiagnostics.toString()})()`, scope);
  return scope;
}

test('selection raw-result observer preserves real draw call, returned coverage and owner counts', async () => {
  const scope = gpuProbeScope();
  const { createSelectionPass } = await observedGpuModule('selection-pass.js', selectionPassSource, instrumentSelectionPassSource, scope);
  const calls = [];
  const raw = Object.freeze({ succeeded: false, renderedKeys: [], missingKeys: ['shared'], failures: [{ key: 'shared', reason: 'resource-not-prepared' }] });
  const renderer = { isAvailable: () => true, stats: () => ({}), drawBatches(batches, frame, options) {
    calls.push({ self: this, batches, frame, options }); return raw;
  } };
  const pass = createSelectionPass();
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: renderer });
  pass.setCountryBoundaryResources({ revision: 'v1', visibleIds: ['DEU'], pendingIds: [], strokeResources: {
    selectionBase: { ownerIds: ['DEU'], packet: { key: 'shared', geometryRevision: 'v1', segmentCount: 5000,
      ownerRanges: { DEU: { first: 0, count: 3005 } } } },
  } });
  pass.updateData({ channels: { primary: [{ key: 'territorial:entity:DEU', boundaryOwnerId: 'DEU' }] } });
  const frame = { frameId: 7, viewRevision: 2 };
  const result = pass.draw({}, {}, { frameContext: frame, preparedOnly: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].self, renderer);
  assert.equal(calls[0].frame, frame);
  assert.equal(calls[0].options.preparedOnly, true);
  assert.deepEqual(result.channels.primary.missingKeys, ['territorial:entity:DEU']);
  const row = scope.window.__gpuStrokeProbe.draws.at(-1);
  assert.equal(row.resourceKey, 'shared');
  assert.equal(row.ownerSegmentCount, 3005);
  assert.equal(row.packetSegmentCount, 5000);
  assert.equal(row.result.failures[0].reason, 'resource-not-prepared');
  scope.window.__recordGpuStroke = () => { throw new Error('observer failure'); };
  assert.deepEqual(pass.draw({}, {}, { frameContext: frame, preparedOnly: true }).channels.primary.missingKeys, ['territorial:entity:DEU']);
  assert.equal(calls.length, 2);
});


function diagnosticGl() {
  const target = { getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0,
    getUniformLocation: (_, name) => name, isContextLost: () => false };
  return new Proxy(target, { get(object, name) {
    if (name in object) return object[name];
    if (/^[A-Z0-9_]+$/.test(name)) return name;
    if (name.startsWith('create')) return () => ({});
    if (name === 'getParameter') return () => [0, 0, 16, 16];
    if (name === 'checkFramebufferStatus') return () => 'FRAMEBUFFER_COMPLETE';
    if (name === 'readPixels') return (...args) => args.at(-1).fill(255);
    if (name === 'isEnabled') return () => false;
    return () => {};
  } });
}

test('real instrumented stroke owner exposes live progress, completion, replacement, removal and errors without re-reading input gates', async () => {
  const scope = gpuProbeScope();
  const { createGpuStrokeRenderer } = await observedGpuModule('gpu-stroke-renderer.js', strokeRendererSource, instrumentStrokeRendererSource, scope);
  let step, inputReads = 0;
  const ready = [], errors = [];
  const renderer = createGpuStrokeRenderer({ isInputActive: () => { inputReads++; return false; },
    onResourceReady: key => ready.push(key), onError: value => errors.push(value) });
  const gl = diagnosticGl();
  assert.equal(renderer.initialize({ gl, version: 2, capabilities: { instancing: true } }), true);
  renderer.setUploadScheduler({ enqueueUpload: job => { step = job.step; return new Promise(() => {}); } });
  const packet = { key: 'required', geometryRevision: 1, segmentCount: 2, preparedGeometry: {
    instances: new Float32Array(20), nodes: new Float32Array(16), segmentCount: 2, nodeCount: 2,
    ownerRanges: { DEU: { first: 0, count: 2 } }, ownerNodeRanges: { DEU: { first: 0, count: 2 } },
  } };
  assert.equal(renderer.ensureResource(packet).reason, 'upload-pending');
  const requests = [{ key: 'required', signature: 'required:1:high' }];
  const read = () => scope.window.__readStrokeUploadDiagnostics(requests).resources[0];
  assert.equal(read().pending.totalBytes, 144);
  const beforeRead = inputReads;
  read(); assert.equal(inputReads, beforeRead);
  renderer.drawBatches([packet], { frameId: 4, viewRevision: 2 }, { preparedOnly: true });
  assert.equal(scope.window.__gpuStrokeProbe.lookups.at(-1).reason, 'resource-not-prepared');
  step({ byteBudget: 32 }); // Allocation only, matching the production step contract.
  step({ byteBudget: 32 });
  assert.equal(read().pending.uploadedBytes, 32);
  for (let i = 0; i < 12 && !renderer.hasResource('required'); i++) step({ byteBudget: 32 });
  assert.equal(read().matchesExpected, true);
  assert.equal(read().pending, null);
  assert.deepEqual(ready, ['required']);
  assert.equal(scope.window.__gpuStrokeProbe.lifecycle.find(row => row.type === 'complete').uploadedBytes, 144);
  renderer.ensureResource({ ...packet, geometryRevision: 2 });
  renderer.ensureResource({ ...packet, geometryRevision: 3 });
  assert.equal(scope.window.__gpuStrokeProbe.lifecycle.at(-1).replacedSignature, 'required:2:high');
  renderer.retain([]);
  assert.equal(scope.window.__gpuStrokeProbe.lifecycle.at(-1).type, 'not-retained');
  renderer.ensureResource({ ...packet, geometryRevision: 4 });
  renderer.cancelPendingUploads();
  assert.equal(scope.window.__gpuStrokeProbe.lifecycle.at(-1).type, 'cancel-before-clear');
  assert.equal(read().pending, null);
  renderer.ensureResource({ ...packet, geometryRevision: 5 });
  gl.bufferData = () => { throw new Error('original staging failure'); };
  step({ byteBudget: 32 });
  assert.equal(errors.at(-1).stage, 'stroke-staging-upload');
  assert.ok(scope.window.__gpuStrokeProbe.lifecycle.some(row => row.type === 'error' && row.message === 'original staging failure'));
  assert.equal(read().pending, null);
  assert.ok(scope.window.__gpuStrokeProbe.lifecycle.length <= 8);
  scope.window.__recordGpuStroke = () => { throw new Error('observer failure'); };
  assert.equal(renderer.ensureResource({ ...packet, geometryRevision: 6 }).reason, 'upload-pending');
  renderer.cancelPendingUploads();
  assert.equal(read().pending, null);
});

test('the original child-existence query is called once and its boolean/error survives timestamp observation', () => {
  const source = readFileSync(new URL('../browser/interaction-unification.spec.mjs', import.meta.url), 'utf8');
  const match = source.match(/const result = await page\.evaluate\((name => \{[\s\S]*?\n {8}\}), name\);/);
  assert.ok(match, 'timestamped original child predicate exists');
  let rows = [{ properties: { name: 'expected', parentId: 'RUS' } }], calls = 0, time = 0, failure = null;
  const scope = { window: { PANDOLAB_TERRITORIAL: { list(options) {
    calls++; assert.equal(options.kind, 'general'); if (failure) throw failure; return rows;
  } } }, performance: { now: () => ++time } };
  const predicate = vm.runInNewContext(`(${match[1]})`, scope);
  assert.equal(predicate('expected'), true);
  assert.equal(calls, 1);
  rows = [{ properties: { name: 'expected', parentId: '' } }, { properties: { name: 'other', parentId: 'RUS' } }];
  assert.equal(predicate('expected'), false);
  assert.equal(calls, 2);
  assert.deepEqual(Array.from(scope.window.__childPredicateObservations, row => row.result), [true, false]);
  assert.ok(scope.window.__childPredicateObservations.every(row => row.completedAt > row.startedAt));
  failure = new Error('original list failure');
  assert.throws(() => predicate('expected'), error => error === failure);
  assert.equal(calls, 3);
  assert.equal(scope.window.__childPredicateObservations.at(-1).error, 'original list failure');
  failure = null;
  for (let i = 0; i < 12; i++) predicate('expected');
  assert.equal(scope.window.__childPredicateObservations.length, 8);
});

test('Canvas custom radio setup clicks its visible associated label and asserts the input state', () => {
  const source = readFileSync(new URL('../browser/interaction-unification.spec.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("  if (renderer === 'canvas') {");
  const setup = source.slice(start, source.indexOf('\n  }', start));
  assert.match(setup, /locator\('#mapDisplayBtn'\)\.click\(\)/);
  assert.match(setup, /locator\('\[data-map-display-row="terrain"\]'\)\.click\(\)/);
  assert.match(setup, /locator\('label\[for="terrainNoneRadio"\]'\)\.click\(\)/);
  assert.match(setup, /expect\(page\.locator\('#terrainNoneRadio'\)\)\.toBeChecked\(\)/);
  assert.doesNotMatch(setup, /\.check\(|force:|\.evaluate\(/);
});

test('GPU observation rings and required-key requests remain bounded without retaining raw draw objects', () => {
  const scope = gpuProbeScope();
  const result = { succeeded: false, failures: [{ key: 'resource', reason: 'not-ready' }] };
  for (let i = 0; i < 24; i++) scope.window.__recordGpuStroke('draw', { resourceKey: `resource-${i}`, geometryRevision: i,
    result, ownerIds: Array.from({ length: 20 }, (_, id) => String(id)) });
  const probe = scope.window.__gpuStrokeProbe;
  assert.equal(probe.draws.length, 8);
  assert.equal(probe.required.length, 8);
  assert.equal(probe.draws.at(-1).ownerIds.length, 8);
  result.failures[0].reason = 'changed-after-observation';
  assert.equal(probe.draws.at(-1).result.failures[0].reason, 'not-ready');
});

test('Canvas observer records submission identities and bitmap-free completions without acknowledging unsolicited frames', () => {
  const { factory, scope } = observedCanvasTransport();
  const sent = [], presented = [];
  const native = { postMessage: message => sent.push(message), terminate() {} };
  const channel = factory({ worker: native, generation: 2, acceptFrame: () => true });
  channel.onmessage = event => { if (event.data.type === 'frame') presented.push(event.data); };
  native.onmessage({ data: { type: 'ready' } });
  channel.queueFrame({ type: 'view', revision: 1, projectGeneration: 2 });
  channel.queueFrame({ type: 'view', revision: 2, projectGeneration: 2 });
  const firstId = sent[0].renderRequestId;
  assert.equal(scope.window.__canvasTransportProbe.latestView.renderRequestId, firstId);
  assert.equal(scope.window.__canvasTransportProbe.latestView.inFlightRenderRequestId, firstId);
  native.onmessage({ data: { type: 'frame', revision: 2, projectGeneration: 2, renderRequestId: null, bitmap: {} } });
  let row = scope.window.__canvasTransportProbe.frameDecisions.at(-1);
  assert.equal(row.renderRequestId, null);
  assert.equal(row.inFlightRenderRequestId, firstId);
  assert.equal(row.hasBitmap, true);
  assert.equal(channel.busy, true);
  assert.equal(sent.length, 1);
  native.onmessage({ data: { type: 'frame', revision: 1, projectGeneration: 2, renderRequestId: firstId } });
  row = scope.window.__canvasTransportProbe.frameDecisions.at(-1);
  assert.equal(row.renderRequestId, firstId);
  assert.equal(row.inFlightRenderRequestId, null);
  assert.equal(row.hasBitmap, false);
  assert.equal(row.current, false);
  assert.equal(sent.length, 2);
  const secondId = sent[1].renderRequestId;
  assert.notEqual(secondId, firstId);
  assert.equal(scope.window.__canvasTransportProbe.latestView.renderRequestId, secondId);
  assert.equal(channel.busy, true);
  native.onmessage({ data: { type: 'frame', revision: 2, projectGeneration: 2, renderRequestId: secondId, bitmap: {} } });
  assert.equal(scope.window.__canvasTransportProbe.frameDecisions.at(-1).inFlightRenderRequestId, null);
  assert.equal(channel.busy, false);
  assert.equal(presented.length, 2);
});
