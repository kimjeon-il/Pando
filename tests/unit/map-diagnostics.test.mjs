import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync, mkdtempSync } from 'node:fs';
import fs, { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { expect as playwrightExpect } from '@playwright/test';
import { withPollTimingDiagnostics, installGpuStrokeDiagnostics, instrumentSelectionPassSource, instrumentStrokeRendererSource, summarizeStrokeUploadState, boundedDiagnostic, installCanvasTransportDiagnostics, instrumentCanvasTransportSource, logMapDiagnostic, withDiagnosticDeadline, withMapDiagnostics } from '../browser/helpers/map-diagnostics.mjs';

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

function pollTimingFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'poll-timing-'));
  pollTimingDirectories.push(directory);
  let hostNow = 0, pageNow = 100;
  const lines = [], attachments = [], requests = [];
  const scope = { performance: { now: () => pageNow }, window: {} };
  const fixture = { scope, lines, attachments, requests, directory,
    host: value => { hostNow = value; }, browser: value => { pageNow = value; },
    options: { label: 'secondary-draw', now: () => hostNow, write: line => lines.push(line) },
    info: { outputPath: name => join(directory, name), attach: async (name, options) => attachments.push({ name, ...options }) },
    page: { evaluate(fn, ...args) {
      requests.push({ fn, args });
      return Promise.resolve(vm.runInNewContext(`(${fn.toString()})(...args)`, { ...scope, args }));
    } },
    read: async phase => JSON.parse(await readFile(join(directory, `secondary-draw-poll-timing-${phase}.json`), 'utf8')),
  };
  return fixture;
}

const pollTimingDirectories = [];
after(async () => { await Promise.all(pollTimingDirectories.map(path => rm(path, { recursive: true, force: true }))); });

const secondaryRead = () => { globalThis.window.calls = (globalThis.window.calls || 0) + 1; return globalThis.window.ready || false; };

test('poll timing retains stale false sampled before success and delivered after it, without another predicate call', async () => {
  const f = pollTimingFixture();
  let deliver;
  const evaluate = f.page.evaluate;
  f.page.evaluate = (fn, ...args) => {
    const value = evaluate(fn, ...args);
    if (f.requests.length === 1) return new Promise(resolve => { deliver = () => value.then(resolve); });
    return value;
  };
  let inFlight;
  const original = new Error('original 30000 ms assertion');
  const action = withPollTimingDiagnostics(f.page, f.info, f.options, async timing => {
    f.host(25000); f.browser(70000);
    inFlight = timing.call(evaluate => evaluate(secondaryRead));
    f.scope.window.ready = true; f.host(29950); f.browser(75000); deliver();
    assert.equal(await inFlight, false);
    f.host(30000); throw original;
  });
  await assert.rejects(action, error => error === original);
  const host = await f.read('settled'), page = await f.read('observed');
  assert.equal(f.scope.window.calls, 1);
  assert.deepEqual(host.calls[0], { id: 1, startedAtMs: 25000, settledAtMs: 29950, outcome: 'fulfilled', valueType: 'boolean', value: false, late: false });
  assert.equal(page.browser.calls[0].value, false);
  assert.equal(page.browser.calls[0].startedAtMs, 70000);
  assert.equal(page.browser.calls[0].settledAtMs, 70000);
  assert.equal(host.gate.error.message, original.message);
  assert.equal(host.gate.settledAtMs, 30000);
});

test('pending poll writes its host file before a stalled page read and persists asynchronous late observation separately', async () => {
  const f = pollTimingFixture();
  let deliver, lateDone;
  const evaluate = f.page.evaluate;
  f.page.evaluate = (fn, ...args) => {
    if (f.requests.length === 0) {
      f.requests.push({ fn, args });
      return new Promise(resolve => { deliver = () => {
        f.browser(900); resolve(vm.runInNewContext(`(${fn.toString()})(...args)`, { ...f.scope, args }));
      }; });
    }
    return evaluate(fn, ...args);
  };
  const original = new Error('original poll deadline');
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, async timing => {
    lateDone = timing.call(evaluate => evaluate(secondaryRead));
    f.host(8000); throw original;
  }), error => error === original);
  const pending = await f.read('settled');
  assert.equal(pending.pendingCalls, 1);
  assert.equal(pending.calls[0].outcome, 'pending');
  assert.equal((await f.read('observed')).browser.unavailable, true);
  f.host(9500); deliver();
  assert.equal(await lateDone, false);
  // Wait on the actual path-based attachment, never launch Playwright/browser.
  for (let count = 0; count < 100 && !f.attachments.some(item => item.name.includes('late-1')); count++) await new Promise(resolve => setTimeout(resolve, 5));
  const late = await f.read('late-1');
  assert.equal(late.calls[0].late, true);
  assert.equal(late.calls[0].settledAtMs, 9500);
  assert.equal(late.browser.calls[0].startedAtMs, 900);
  assert.equal(late.browser.calls[0].value, false);
  assert.equal(f.scope.window.calls, 1);
  assert.equal(pending.calls[0].outcome, 'pending');
  assert.ok(f.lines.findIndex(line => line.includes('"phase":"settled"')) < f.lines.findIndex(line => line.includes('"phase":"observed"')));
});

test('page and host errors stay exact and diagnostics never invoke an original predicate twice', async () => {
  const f = pollTimingFixture();
  const original = new Error('native evaluate error');
  f.scope.window.failure = original;
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, timing => timing.call(evaluate => evaluate(() => { throw globalThis.window.failure; }))), error => error === original);
  const data = await f.read('observed');
  assert.equal(data.calls.length, 1);
  assert.equal(data.calls[0].outcome, 'rejected');
  assert.equal(data.calls[0].error.message, original.message);
  assert.equal(data.browser.calls[0].error.message, original.message);
});

test('poll timing keeps only eight scalar calls, bounds strings and preserves original evaluate arguments and values', async () => {
  const f = pollTimingFixture();
  const argument = { status: 'x'.repeat(1000), geometry: 'forbidden' };
  let result;
  assert.equal(await withPollTimingDiagnostics(f.page, f.info, { ...f.options, valueField: 'status' }, async timing => {
    for (let i = 0; i < 20; i++) result = await timing.call(async evaluate => (await evaluate(value => value, argument)).status);
    return 42;
  }), 42);
  const report = await f.read('observed');
  assert.equal(result, argument.status);
  assert.equal(report.calls.length, 8);
  assert.equal(report.droppedCalls, 12);
  assert.equal(report.browser.calls.length, 8);
  assert.equal(report.browser.droppedCalls, 12);
  assert.equal(report.calls[0].value.length, 240);
  assert.equal(report.browser.calls[0].value.length, 240);
  assert.ok(!JSON.stringify(report).includes('forbidden'));
  assert.ok(JSON.stringify(report).length < 16000);
  assert.ok(f.requests.slice(0, 20).every(call => call.args.length === 1 && call.args[0] === argument));
});

test('a failed real output write or rejected diagnostic logger cannot mask a successful poll', async () => {
  const f = pollTimingFixture();
  f.info.outputPath = () => f.directory;
  assert.equal(await withPollTimingDiagnostics(f.page, f.info, { ...f.options, write: async () => { throw new Error('log closed'); } }, timing => timing.call(evaluate => evaluate(() => true))), true);
  assert.equal(f.attachments.length, 0);
});

function specScope(path, extras = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const browserTest = () => {};
  browserTest.use = browserTest.beforeEach = browserTest.afterEach = () => {};
  return { source, scope: { test: browserTest, withPollTimingDiagnostics: (page, info, options, action) => withPollTimingDiagnostics(page, info, { ...options, write: () => {} }, action), ...extras } };
}

test('real Russia gate keeps its 30000 ms secondary predicate and modifier click unchanged', async () => {
  const f = pollTimingFixture();
  f.scope.window.__PANDOLAB_RENDER_DEBUG__ = { snapshot: () => ({ gpuSelection: { drawCoverage: { secondary: { drawSucceeded: true } } } }) };
  const actions = [], pollOptions = [];
  f.page.locator = selector => ({ click: async options => actions.push({ selector, options }) });
  const expect = { poll: (read, options) => { pollOptions.push(options); return { toBe: async value => assert.equal(await read(), value) }; } };
  const { source, scope } = specScope('../browser/interaction-unification.spec.mjs', { page: f.page, renderer: 'webgl1', expect });
  scope.test.info = () => f.info;
  const begin = source.indexOf("  await page.locator('[data-object-search-select=\"countries\"][data-item-id=\"RUS\"]').click({ modifiers: ['Control'] });");
  const end = source.indexOf('  const overlap = await pixels();', begin);
  assert.ok(begin > 0 && end > begin);
  await vm.runInNewContext(`(async () => { ${source.slice(begin, end)} })()`, scope);
  assert.equal(actions.length, 1);
  assert.deepEqual(Array.from(actions[0].options.modifiers), ['Control']);
  assert.equal(pollOptions[0].timeout, 30000);
  assert.equal(pollOptions.length, 1);
  const report = JSON.parse(await readFile(join(f.directory, 'russia-secondary-webgl1-poll-timing-observed.json'), 'utf8'));
  assert.equal(report.callCount, 1);
  assert.equal(report.browser.calls[0].value, true);
});

test('real preview-entry path keeps full snapshot work, six native move steps and default timeout; lake is an untouched control', async () => {
  for (const kind of ['river', 'lake']) {
    const f = pollTimingFixture(), actions = [], pollOptions = [];
    let snapshots = 0, packets = 0;
    f.scope.window.__m2Preview = () => ({ snapshot: () => { snapshots++; return { id: 1, status: 'dragging' }; }, packet: () => { packets++; return null; } });
    f.scope.window.__m2EditingPacket = () => ({ boundaryActiveCoordinate: null });
    f.scope.window.__m2State = () => ({ geometryPreview: {} });
    f.scope.document = { querySelector: () => null };
    f.page.mouse = { move: async (...args) => actions.push(['move', ...args]), down: async () => actions.push(['down']) };
    const expect = { poll: (read, ...options) => { pollOptions.push(options); return { toBe: async value => assert.equal(await read(), value) }; } };
    const { source, scope } = specScope('../browser/edit-preview-handoff.spec.mjs', { page: f.page, renderer: 'canvas', kind, outlineVisible: false, box: { x: 0, y: 0, width: 10, height: 10 }, expect });
    scope.test.info = () => f.info;
    const snapshotStart = source.indexOf('\nconst snapshot =');
    const snapshotEnd = source.indexOf('\n\nasync function loadProjectFile', snapshotStart);
    const blockStart = source.indexOf('    await page.mouse.move(box.x', source.indexOf("for (const { kind, outlineVisible }"));
    const blockEnd = source.indexOf('    const firstId =', blockStart);
    await vm.runInNewContext(`${source.slice(snapshotStart, snapshotEnd)}; (async () => { ${source.slice(blockStart, blockEnd)} })()`, scope);
    assert.equal(actions.length, 3);
    assert.equal(actions[2][3].steps, 6);
    assert.equal(snapshots, 2); assert.equal(packets, 1);
    assert.equal(pollOptions.length, 1); assert.equal(pollOptions[0].length, 0);
    if (kind === 'river') {
      const report = JSON.parse(await readFile(join(f.directory, 'canvas-river-preview-entry-poll-timing-observed.json'), 'utf8'));
      assert.equal(report.browser.calls[0].value, 'dragging');
      assert.equal(report.calls[0].value, 'dragging');
    } else { assert.equal(f.attachments.length, 0); assert.equal(f.requests.length, 1); }
  }
});

const waitForPollAttachment = async (fixture, phase) => {
  for (let count = 0; count < 100 && !fixture.attachments.some(item => item.name.includes(phase)); count++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(fixture.attachments.some(item => item.name.includes(phase)));
};

test('late original rejection is observed and cannot alter a following collector or its captured destination', async () => {
  const f = pollTimingFixture();
  let rejectRead, pending;
  const original = new Error('original evaluate closed after timeout');
  const gateError = new Error('original assertion timed out');
  const evaluate = f.page.evaluate;
  f.page.evaluate = (fn, ...args) => {
    if (!f.requests.length) {
      f.requests.push({ fn, args });
      return new Promise((resolve, reject) => { rejectRead = reject; });
    }
    return evaluate(fn, ...args);
  };
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, timing => {
    pending = timing.call(evaluate => evaluate(secondaryRead));
    pending.catch(() => {}); // Same rejection observation as Playwright's deadline race.
    throw gateError;
  }), error => error === gateError);
  const next = pollTimingFixture();
  assert.equal(await withPollTimingDiagnostics(f.page, next.info, next.options, timing => timing.call(evaluate => evaluate(() => true))), true);
  const before = await next.read('observed');
  f.info.outputPath = () => { throw new Error('Cannot consult next test info'); };
  f.host(9000); rejectRead(original);
  await assert.rejects(pending, error => error === original);
  await waitForPollAttachment(f, 'late-1');
  const late = await f.read('late-1');
  assert.equal(late.settledCall.outcome, 'rejected');
  assert.equal(late.settledCall.error.message, original.message);
  assert.equal(late.gate.error.message, gateError.message);
  assert.deepEqual(await next.read('observed'), before);
  assert.notEqual(late.token, before.token);
  assert.equal(late.browser.unavailable, true);
});

test('host evidence is on disk before a stalled diagnostic read and the original assertion is still exact', { timeout: 2000 }, async () => {
  const f = pollTimingFixture();
  const original = new Error('original gate error');
  const reads = [];
  f.page.evaluate = async () => {
    reads.push(await f.read('settled'));
    return new Promise(() => {});
  };
  const started = performance.now();
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, () => { throw original; }), error => error === original);
  assert.ok(performance.now() - started < 1200);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].gate.error.message, original.message);
  const report = await f.read('observed');
  assert.equal(report.browser.incomplete, true);
  assert.match(report.browser.error.message, /exceeded 250 ms/);
});

test('stalled real-output operations are aborted and cannot attach after late settlement', { timeout: 2000 }, async t => {
  const f = pollTimingFixture(), writes = [];
  t.mock.method(fs, 'writeFile', (path, data, options) => new Promise((resolve, reject) => writes.push({ path, data, options, resolve, reject })));
  assert.equal(await withPollTimingDiagnostics(f.page, f.info, f.options, timing => timing.call(evaluate => evaluate(() => true))), true);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(row => row.options.signal.aborted));
  writes[0].resolve(); writes[1].reject(new Error('late disk closure'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.attachments.length, 0);
  assert.ok(f.lines.filter(line => line.includes('outputError')).length === 2);
});

test('page observer failures and host clock errors cannot replace native returns or original errors', async () => {
  const f = pollTimingFixture();
  Object.freeze(f.scope.window);
  f.scope.performance.now = () => { throw new Error('page clock failed'); };
  const options = { ...f.options, now: () => { throw new Error('host clock failed'); } };
  assert.equal(await withPollTimingDiagnostics(f.page, f.info, options, timing => timing.call(evaluate => evaluate(() => true))), true);
  const report = await f.read('observed');
  assert.equal(report.gate.startedAtMs, null);
  assert.equal(report.calls[0].value, true);
  assert.equal(report.browser.unavailable, true);
  const original = new Error('unaltered host predicate error');
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, options, timing => timing.call(() => { throw original; })), error => error === original);
});

test('late-output budget remains bounded even with more outstanding calls than the retained ring', async () => {
  const f = pollTimingFixture(), completions = [], pending = [];
  f.page.evaluate = () => new Promise(resolve => completions.push(resolve));
  const original = new Error('gate deadline');
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, timing => {
    for (let i = 0; i < 12; i++) pending.push(timing.call(evaluate => evaluate(() => false)));
    throw original;
  }), error => error === original);
  const report = await f.read('settled');
  assert.equal(report.pendingCalls, 12); assert.equal(report.calls.length, 8); assert.equal(report.droppedCalls, 4);
  f.page.evaluate = async () => ({ unavailable: true });
  completions.slice(0, 12).forEach(resolve => resolve(false));
  await Promise.all(pending);
  await waitForPollAttachment(f, 'late-8');
  assert.equal(f.attachments.filter(item => item.name.includes('late-')).length, 8);
  const last = await f.read('late-8');
  assert.equal(last.omittedLateReports, 4);
  assert.equal(last.calls.length, 8);
});

test('missing secondary coverage stays undefined and its evidence distinguishes it from null', async () => {
  const f = pollTimingFixture();
  const actual = await withPollTimingDiagnostics(f.page, f.info, f.options, timing => timing.call(evaluate => evaluate(() => undefined)));
  assert.equal(actual, undefined);
  const report = await f.read('observed');
  assert.equal(report.calls[0].valueType, 'undefined');
  assert.equal(report.browser.calls[0].valueType, 'undefined');
  assert.equal(report.calls[0].value, null);
});

test('page intervals separate wrapper entry from the unchanged predicate body and record nonzero duration', async () => {
  const f = pollTimingFixture();
  let pageNow = 0;
  f.scope.performance.now = () => ++pageNow;
  assert.equal(await withPollTimingDiagnostics(f.page, f.info, f.options, timing => timing.call(evaluate => evaluate(() => true))), true);
  const report = await f.read('observed');
  assert.equal(report.browser.calls[0].enteredAtMs, 1);
  assert.equal(report.browser.calls[0].startedAtMs, 2);
  assert.equal(report.browser.calls[0].settledAtMs, 3);
});

test('real Playwright deadline leaves a pending original evaluate observable after the assertion already failed', { timeout: 2000 }, async () => {
  const f = pollTimingFixture();
  let deliver, original;
  const evaluate = f.page.evaluate;
  f.page.evaluate = (fn, ...args) => {
    if (!f.requests.length) {
      f.requests.push({ fn, args });
      return new Promise(resolve => { deliver = () => resolve(vm.runInNewContext(`(${fn.toString()})(...args)`, { ...f.scope, args })); });
    }
    return evaluate(fn, ...args);
  };
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, async timing => {
    try { await playwrightExpect.poll(() => timing.call(evaluate => evaluate(secondaryRead)), { timeout: 30 }).toBe(true); }
    catch (error) { original = error; throw error; }
  }), error => error === original && /Timeout 30ms exceeded/.test(error.message));
  const pending = await f.read('settled');
  assert.equal(pending.pendingCalls, 1); assert.equal(pending.callCount, 1);
  f.scope.window.ready = true; f.host(40); deliver();
  await waitForPollAttachment(f, 'late-1');
  const late = await f.read('late-1');
  assert.equal(late.gate.outcome, 'rejected');
  assert.equal(late.calls[0].value, true);
  assert.equal(late.browser.calls[0].value, true);
  assert.equal(late.calls[0].late, true);
  assert.equal(f.scope.window.calls, 1);
});

test('real Playwright polling does not turn a delivered stale false into a fresh success', { timeout: 2000 }, async () => {
  const f = pollTimingFixture();
  const evaluate = f.page.evaluate;
  f.page.evaluate = (fn, ...args) => {
    const sampled = evaluate(fn, ...args);
    if (f.requests.length === 1) return new Promise(resolve => setTimeout(() => {
      f.scope.window.ready = true; sampled.then(resolve);
    }, 10));
    return sampled;
  };
  await assert.rejects(withPollTimingDiagnostics(f.page, f.info, f.options, timing =>
    playwrightExpect.poll(() => timing.call(evaluate => evaluate(secondaryRead)), { timeout: 50 }).toBe(true)), /Received: false/);
  const report = await f.read('observed');
  assert.equal(report.gate.outcome, 'rejected');
  assert.equal(report.calls[0].value, false);
  assert.equal(report.browser.calls[0].value, false);
  assert.equal(f.scope.window.ready, true);
  assert.equal(f.scope.window.calls, 1);
});
