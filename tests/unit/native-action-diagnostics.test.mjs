import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import vm from 'node:vm';
import { mkdtempSync } from 'node:fs';
import fs, { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimePerformanceMetrics } from '../../assets/js/modules/runtime-performance-metrics.js';
import { installLongAnimationFrameProbe } from '../browser/helpers/long-animation-frame-diagnostics.mjs';
import { withNativeActionDiagnostics, nativeActionProbe } from '../browser/helpers/native-action-diagnostics.mjs';

const temporaryDirectories = [];
after(async () => { await Promise.all(temporaryDirectories.map(path => rm(path, { recursive: true, force: true }))); });

function hostFixture(evaluate = async () => ({ installed: true })) {
  const attachments = [], lines = [];
  const directory = mkdtempSync(join(tmpdir(), 'native-action-diagnostics-'));
  temporaryDirectories.push(directory);
  return { page: { evaluate }, testInfo: {
    outputPath: name => join(directory, name),
    attach: async (name, attachment) => attachments.push({ name, ...attachment }),
  },
    attachments, lines, options: { label: 'project-undo', selector: '#undoBtn', write: line => lines.push(line) } };
}

test('one unchanged native action retains its return value and measures only the action interval', async () => {
  let attempts = 0, now = 0, reads = 0;
  const fixture = hostFixture(async () => { now = ++reads === 1 ? 100 : 20000; return { installed: true }; });
  const result = {};
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo,
    { ...fixture.options, now: () => now }, async () => { attempts++; now = 9750; return result; }), result);
  assert.equal(attempts, 1);
  const report = JSON.parse(await readFile(fixture.attachments[0].path, 'utf8'));
  assert.deepEqual(report.host, { startedAtMs: 100, endedAtMs: 9750, durationMs: 9650, outcome: 'fulfilled' });
  assert.equal(report.label, 'project-undo');
  assert.equal(fixture.lines.length, 1);
});

test('a successful action persists compact JSON in the test output directory and attaches the saved path', async () => {
  const fixture = hostFixture();
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options, () => 42), 42);
  const path = fixture.testInfo.outputPath('project-undo-native-action.json');
  const text = await readFile(path, 'utf8');
  const report = JSON.parse(text);
  assert.equal(report.host.outcome, 'fulfilled');
  assert.equal(report.label, 'project-undo');
  assert.deepEqual(report.browser, { installed: true });
  assert.equal(text, JSON.stringify(report));
  assert.deepEqual(fixture.attachments, [{ name: 'project-undo-native-action.json', path, contentType: 'application/json' }]);
});

test('a failed action retains its real output file even when the reporter attachment fails', async () => {
  const fixture = hostFixture();
  fixture.testInfo.attach = () => { throw new Error('reporter unavailable'); };
  const original = new Error('native timeout');
  await assert.rejects(withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options,
    () => { throw original; }), error => error === original);
  const report = JSON.parse(await readFile(fixture.testInfo.outputPath('project-undo-native-action.json'), 'utf8'));
  assert.equal(report.host.outcome, 'rejected');
});

test('a rejected real file write cannot change the successful native outcome or create a body-only attachment', async () => {
  const fixture = hostFixture();
  const directory = fixture.testInfo.outputPath('');
  fixture.testInfo.outputPath = () => directory; // Writing a file over a directory rejects.
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options, () => 42), 42);
  assert.equal(fixture.attachments.length, 0);
  assert.ok(fixture.lines.some(line => line.startsWith('[native-action-output] ')));
});

test('a never-settling file write is aborted at the output deadline and cannot attach after late fulfillment', { timeout: 1500 }, async t => {
  const fixture = hostFixture();
  let resolveWrite, signal;
  t.mock.method(fs, 'writeFile', (path, data, options) => {
    signal = options.signal;
    return new Promise(resolve => { resolveWrite = resolve; });
  });
  const original = new Error('native failure');
  const startedAt = performance.now();
  await assert.rejects(withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options,
    () => { throw original; }), error => error === original);
  assert.ok(performance.now() - startedAt < 1000);
  assert.equal(signal.aborted, true);
  assert.equal(fixture.attachments.length, 0);
  resolveWrite();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(fixture.attachments.length, 0);
});

test('late file-write rejection remains handled after a successful action returns', { timeout: 1500 }, async t => {
  const fixture = hostFixture();
  let rejectWrite;
  t.mock.method(fs, 'writeFile', () => new Promise((_, reject) => { rejectWrite = reject; }));
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options, () => 42), 42);
  rejectWrite(new Error('late disk closure'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(fixture.attachments.length, 0);
});

test('setup, collection and attachment rejection never replace the original action error', async () => {
  const fixture = hostFixture(() => { throw new Error('page closed'); });
  fixture.testInfo.attach = () => { throw new Error('output closed'); };
  const original = new Error('original locator timeout');
  let attempts = 0;
  await assert.rejects(withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options,
    () => { attempts++; throw original; }), error => error === original);
  assert.equal(attempts, 1);
  assert.equal(JSON.parse(fixture.lines[0].slice('[native-action] '.length)).host.outcome, 'rejected');
});

test('never-settling diagnostics cannot block a failed action indefinitely, including attachment', { timeout: 2000 }, async () => {
  const fixture = hostFixture(() => new Promise(() => {}));
  fixture.testInfo.attach = () => new Promise(() => {});
  const original = new Error('native failure');
  const startedAt = performance.now();
  await assert.rejects(withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options,
    () => { throw original; }), error => error === original);
  assert.ok(performance.now() - startedAt < 1500);
});

test('timed-out diagnostic promises contain late rejection and preserve a successful result', { timeout: 2000 }, async () => {
  const pending = [];
  const fixture = hostFixture(() => new Promise((_, reject) => pending.push(reject)));
  fixture.testInfo.attach = () => new Promise((_, reject) => pending.push(reject));
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options, () => 42), 42);
  for (const reject of pending) reject(new Error('late closure'));
  await Promise.resolve();
});

test('diagnostic writer failure does not turn a successful native action into a failure', async () => {
  const fixture = hostFixture();
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo,
    { ...fixture.options, write: () => { throw new Error('closed log'); } }, () => 42), 42);
});

test('asynchronously rejected diagnostic output is also contained', async () => {
  const fixture = hostFixture();
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo,
    { ...fixture.options, write: async () => { throw new Error('closed asynchronous log'); } }, () => 42), 42);
});

function browserFixture({ report, observerThrows = false } = {}) {
  let now = 100, row = null;
  const listeners = [], frames = new Map(), timers = new Map(), observers = [];
  let frameId = 0, timerId = 0, geometryReads = 0;
  const root = { id: 'layerSearchResults', getAttribute: () => null, querySelector: () => row };
  const scope = { Date, performance: { now: () => now, timeOrigin: 123000 },
    document: {
      querySelector: selector => selector === '#layerSearchResults' ? root : row,
      addEventListener: (type, callback, capture) => listeners.push({ type, callback, capture }),
      removeEventListener(type, callback, capture) {
        const index = listeners.findIndex(item => item.type === type && item.callback === callback && item.capture === capture);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() { if (observerThrows) throw new Error('observer unavailable'); }
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    getComputedStyle: () => { geometryReads++; throw new Error('layout read forbidden'); },
    __PANDOLAB_PERFORMANCE_REPORT__: report || (() => ({ longTasks: { samples: [] }, eventTimings: { samples: [] }, operations: {} })),
  };
  const call = options => vm.runInNewContext(`(${nativeActionProbe.toString()})(options)`, { ...scope, options, globalThis: scope });
  const node = (key = 'hydro:river:exact', extra = {}) => ({ nodeType: 1, id: '', tagName: 'DIV', isConnected: true,
    hidden: false, dataset: { objectKey: key },
    getAttribute: name => name === 'data-object-key' ? key : null,
    matches: selector => selector.includes(key),
    querySelector: () => null,
    closest: () => row,
    getBoundingClientRect: () => { geometryReads++; throw new Error('layout read forbidden'); }, ...extra });
  return { call, node, listeners, observers, frames, timers, scope,
    install: (options = {}) => call({ command: 'install', token: 'test', selector: '.layer-search-result', rowSelector: '[data-object-key="hydro:river:exact"]', ...options }),
    take: () => call({ command: 'take', token: 'test' }),
    setRow: value => { row = value; }, setNow: value => { now = value; },
    mutate(records = []) { for (const observer of observers) if (!observer.disconnected) observer.callback(records); },
    dispatch(type, target, capture, event = { type, target, timeStamp: now - 1, isTrusted: true }) {
      for (const item of [...listeners]) if (item.type === type && item.capture === capture) item.callback(event);
      return event;
    },
    frame() { const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(now); },
    get geometryReads() { return geometryReads; },
  };
}

test('exact row appearance, identity replacement and intra-batch removal are observed without layout reads', () => {
  const fixture = browserFixture();
  fixture.install();
  const first = fixture.node(); fixture.setRow(first);
  fixture.mutate([{ addedNodes: [first], removedNodes: [] }]);
  const second = fixture.node(); fixture.setRow(second);
  fixture.mutate([{ addedNodes: [second], removedNodes: [first] }]);
  const report = fixture.take();
  assert.deepEqual(Array.from(report.rows, row => row.reason), ['initial', 'mutation', 'mutation']);
  assert.equal(report.rows[0].row, null);
  assert.notEqual(report.rows[1].row.identity, report.rows[2].row.identity);
  assert.equal(report.rowChanges.added, 2);
  assert.equal(report.rowChanges.removed, 1);
  assert.equal(report.rowChanges.replacements, 1);
  assert.equal(fixture.geometryReads, 0);
  assert.equal(fixture.listeners.length, 0);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.timers.size, 0);
  assert.ok(fixture.observers.every(observer => observer.disconnected));
});

test('event capture and bubble expose dispatch and bounded RAF checkpoints without replacing handlers', () => {
  const fixture = browserFixture();
  const target = fixture.node(); fixture.setRow(target); fixture.install();
  fixture.setNow(110); const event = fixture.dispatch('click', target, true);
  fixture.setNow(180); fixture.dispatch('click', target, false, event);
  fixture.setNow(190); fixture.frame(); fixture.setNow(207); fixture.frame(); fixture.frame();
  const report = fixture.take();
  assert.deepEqual(Array.from(report.events, entry => [entry.type, entry.phase, entry.atMs]), [['click', 'capture', 110], ['click', 'bubble', 180]]);
  assert.equal(report.frames.length, 4);
  assert.ok(report.frames.every(entry => typeof entry.atMs === 'number'));
  assert.equal(fixture.geometryReads, 0);
});

test('bubble timing retains capture identity when the native click target detaches during an earlier handler', () => {
  const fixture = browserFixture();
  const target = fixture.node(); fixture.setRow(target); fixture.install();
  const event = Object.freeze({ type: 'click', target, timeStamp: 109, isTrusted: true });
  fixture.setNow(110); fixture.dispatch('click', target, true, event);
  // The browser's propagation path still reaches document, but a selector with
  // the old results ancestor no longer matches the now-detached native target.
  target.isConnected = false;
  target.closest = () => null;
  fixture.setRow(fixture.node());
  fixture.setNow(180); fixture.dispatch('click', target, false, event);
  const report = fixture.take();
  assert.deepEqual(Array.from(report.events, entry => [entry.type, entry.phase, entry.atMs]),
    [['click', 'capture', 110], ['click', 'bubble', 180]]);
  assert.equal(report.events[0].eventId, report.events[1].eventId);
  assert.equal(typeof report.events[0].eventId, 'number');
  assert.deepEqual(report.events[0].target, report.events[1].target);
  assert.equal(report.events[1].target.connected, true, 'target metadata describes capture time');
  assert.equal(report.errors.length, 0);
  assert.equal(fixture.geometryReads, 0);
});

test('an unrelated event cannot become a matched bubble event after its target moves into the selector', () => {
  const fixture = browserFixture(); fixture.install();
  const target = fixture.node();
  const event = Object.freeze({ type: 'click', target, timeStamp: 109, isTrusted: true });
  fixture.dispatch('click', target, true, event);
  fixture.setRow(target);
  fixture.dispatch('click', target, false, event);
  // A different event object also cannot borrow capture membership.
  fixture.dispatch('click', target, false);
  assert.equal(fixture.take().events.length, 0);
});

test('performance samples overlap the browser observation window and remain bounded scalars', () => {
  const fixture = browserFixture({ report: () => ({
    longTasks: { samples: [{ startTime: 0, durationMs: 50 }, { startTime: 90, durationMs: 100, secret: 'omit' }] },
    eventTimings: { samples: Array.from({ length: 70 }, (_, i) => ({ startTime: 100 + i, durationMs: 16, name: 'click', target: 'undoBtn', interactionId: i, secret: 'omit' })) },
    operations: { 'autosave.persist': { samples: [{ atMs: 170, durationMs: 9, detail: { geometry: 'omit' } }] } },
  }) });
  fixture.install(); fixture.setNow(200);
  const report = fixture.take();
  assert.equal(report.performance.longTasks.samples.length, 1);
  assert.equal(report.performance.longTasks.samples[0].startTime, 90);
  assert.equal(report.performance.eventTimings.samples.length, 32);
  assert.equal(report.performance.eventTimings.omitted, 38);
  assert.ok(!JSON.stringify(report).includes('omit"'));
});

test('mutation volume has bounded rings and a hard observation cap', () => {
  const fixture = browserFixture(); fixture.install();
  for (let i = 0; i < 200; i++) {
    const row = fixture.node(); fixture.setRow(row); fixture.mutate([{ addedNodes: [row], removedNodes: [] }]);
  }
  const report = fixture.take();
  assert.equal(report.rows.length, 32);
  assert.equal(report.dropped.rows, 97);
  assert.equal(report.rowChanges.observationTruncated, true);
  assert.equal(report.rowChanges.batches, 128);
  assert.equal(fixture.geometryReads, 0);
});

test('automatic cleanup expires a probe even if the host cannot collect it', () => {
  const fixture = browserFixture(); fixture.install();
  for (const callback of [...fixture.timers.values()]) callback();
  assert.equal(fixture.take().expired, true);
  assert.equal(fixture.listeners.length, 0);
  assert.equal(fixture.frames.size, 0);
});

test('observer and performance-report failures are contained in diagnostic output', () => {
  const fixture = browserFixture({ observerThrows: true, report: () => { throw new Error('metrics unavailable'); } });
  assert.doesNotThrow(() => fixture.install());
  const report = fixture.take();
  assert.ok(report.errors.some(value => value.includes('observer unavailable')));
  assert.ok(report.errors.some(value => value.includes('metrics unavailable')));
  assert.equal(fixture.listeners.length, 0);
});

test('late setup cannot install an observer after its host deadline', () => {
  const fixture = browserFixture();
  assert.equal(fixture.call({ command: 'install', token: 'late', selector: '#undoBtn', installBeforeEpochMs: 0 }).installationExpired, true);
  assert.equal(fixture.listeners.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.take().unavailable, true);
});

test('a new probe disposes the old one and a stale take cannot remove the new probe', () => {
  const fixture = browserFixture(); fixture.install();
  fixture.call({ command: 'install', token: 'new', selector: '#undoBtn' });
  assert.equal(fixture.listeners.length, 10);
  assert.equal(fixture.timers.size, 1);
  assert.equal(fixture.take().unavailable, true);
  assert.equal(fixture.call({ command: 'take', token: 'new' }).expired, false);
  assert.equal(fixture.listeners.length, 0);
});

test('mutation record and node caps disclose lost observations and ignore unrelated row identities', () => {
  const fixture = browserFixture(); fixture.install();
  const unrelated = fixture.node('hydro:river:another');
  const exact = fixture.node(); fixture.setRow(exact);
  fixture.mutate([{ addedNodes: [unrelated, exact], removedNodes: [] }]);
  fixture.mutate(Array.from({ length: 40 }, () => ({ addedNodes: Array.from({ length: 40 }, () => unrelated), removedNodes: [] })));
  const report = fixture.take();
  assert.equal(report.rowChanges.added, 1);
  assert.equal(report.rowChanges.omittedRecords, 8);
  assert.equal(report.rowChanges.omittedNodes, 32 * 8);
});

test('event observer exceptions do not escape into the native event dispatch', () => {
  const fixture = browserFixture(); fixture.install();
  assert.doesNotThrow(() => fixture.dispatch('click', { closest() { throw new Error('detached target probe'); } }, true));
  assert.ok(fixture.take().errors.some(value => value.includes('detached target probe')));
});

test('missing performance reporting is explicitly unavailable rather than an empty success', () => {
  const fixture = browserFixture(); fixture.scope.__PANDOLAB_PERFORMANCE_REPORT__ = undefined; fixture.install();
  const report = fixture.take();
  assert.equal(report.performance, null);
  assert.ok(report.errors.some(value => value.includes('Performance report unavailable')));
});


test('an unarmed take retains startup metrics with collection clocks and an explicitly unknown native window', () => {
  let reads = 0;
  const fixture = browserFixture({ report: () => {
    reads++; fixture.setNow(121);
    return { version: 1, installedAtMs: 4, capturedAt: '2026-10-07T08:00:00.000Z',
      longTasks: { samples: [{ startTime: 10, durationMs: 60, name: 'longtask' }] },
      eventTimings: { samples: [] }, operations: {} };
  } });
  const report = fixture.take();
  assert.equal(report.unavailable, true);
  assert.equal(report.unavailableReason, 'missing-token');
  assert.equal(report.nativeWindow, null);
  assert.equal(report.performance.longTasks.samples[0].startTime, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(report.performanceCollection)), {
    status: 'available', source: '__PANDOLAB_PERFORMANCE_REPORT__', version: 1,
    installedAtMs: 4, capturedAt: '2026-10-07T08:00:00.000Z', timeOrigin: 123000,
    startedAtMs: 100, endedAtMs: 121, scope: 'retained-startup-samples', partial: true,
    coverage: 'Unknown observer support and prior buffer loss; empty samples do not rule out JavaScript blocking.',
  });
  assert.equal(reads, 1);
  assert.equal(fixture.listeners.length, 0);
  assert.equal(fixture.observers.length, 0);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.timers.size, 0);
});

test('expired installation retains the existing startup report without arming a native probe', () => {
  const fixture = browserFixture({ report: () => ({
    longTasks: { samples: [{ startTime: 20, durationMs: 500 }] },
  }) });
  const setup = fixture.call({ command: 'install', token: 'test', selector: '#undoBtn', installBeforeEpochMs: 0 });
  assert.equal(setup.installationExpired, true);
  const report = fixture.take();
  assert.equal(report.unavailable, true);
  assert.equal(report.nativeWindow, null);
  assert.equal(report.performance.longTasks.samples.length, 1);
  assert.equal(fixture.listeners.length, 0);
  assert.equal(fixture.observers.length, 0);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.timers.size, 0);
});

test('a stale take collects startup metrics without consuming or disposing the newer native probe', () => {
  let reads = 0;
  const fixture = browserFixture({ report: () => {
    reads++;
    return { longTasks: { samples: [{ startTime: 20, durationMs: 50 }, { startTime: 110, durationMs: 50 }] } };
  } });
  fixture.call({ command: 'install', token: 'new', selector: '#undoBtn' });
  const active = fixture.scope.__PANDOLAB_NATIVE_ACTION_TEST_PROBE__;
  const report = fixture.take();
  assert.equal(report.unavailable, true);
  assert.equal(report.unavailableReason, 'token-mismatch');
  assert.equal(report.nativeWindow, null);
  assert.equal(report.performance.longTasks.samples.length, 2);
  assert.equal(fixture.scope.__PANDOLAB_NATIVE_ACTION_TEST_PROBE__, active);
  assert.equal(fixture.listeners.length, 10);
  assert.equal(fixture.frames.size, 1);
  assert.equal(fixture.timers.size, 1);
  fixture.setNow(200);
  const ready = fixture.call({ command: 'take', token: 'new' });
  assert.equal(ready.performance.longTasks.samples.length, 1);
  assert.equal(ready.performance.longTasks.samples[0].startTime, 110);
  assert.deepEqual(JSON.parse(JSON.stringify(ready.nativeWindow)), { startedAtMs: 100, endedAtMs: 200 });
  assert.equal(ready.performanceCollection.scope, 'native-window-overlap');
  assert.equal(reads, 2);
  assert.equal(fixture.listeners.length, 0);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.timers.size, 0);
});

for (const [description, hook, status, message] of [
  ['missing', undefined, 'unavailable', 'Performance report unavailable'],
  ['throwing', () => { throw new Error('metrics unavailable'); }, 'error', 'metrics unavailable'],
]) test(`an unarmed take labels a ${description} metrics hook without fabricating empty evidence`, () => {
  const fixture = browserFixture(); fixture.scope.__PANDOLAB_PERFORMANCE_REPORT__ = hook;
  const report = fixture.take();
  assert.equal(report.unavailable, true);
  assert.equal(report.nativeWindow, null);
  assert.equal(report.performance, null);
  assert.equal(report.performanceCollection.status, status);
  assert.equal(report.performanceCollection.partial, true);
  assert.match(report.performanceCollection.coverage, /empty samples do not rule out JavaScript blocking/);
  assert.ok(report.errors.some(error => error.includes(message)));
});

test('startup sample exports disclose retained counts, output caps, extents and unknown source losses', () => {
  const samples = Array.from({ length: 120 }, (_, i) => ({
    startTime: i * 100, atMs: i * 100 + 60, durationMs: 60, name: 'x'.repeat(1000),
    target: 'y'.repeat(1000), interactionId: i, detail: { secret: 'excluded' },
  }));
  const fixture = browserFixture({ report: () => ({
    version: 1, installedAtMs: 0, longTasks: { count: 120, samples }, eventTimings: { count: 120, samples },
    operations: Object.fromEntries(['autosave.persist', 'project.command', 'project.transaction', 'unrelated'].map(name => [name, { count: 120, samples }])),
    startup: { secret: 'excluded' },
  }) });
  const report = fixture.take(), metrics = report.performance;
  assert.equal(metrics.longTasks.samples.length, 120);
  assert.equal(metrics.longTasks.retainedCount, 120);
  assert.equal(metrics.longTasks.exportedCount, 120);
  assert.equal(metrics.longTasks.omitted, 0);
  assert.equal(metrics.longTasks.oldestRetainedStartTimeMs, 0);
  assert.equal(metrics.longTasks.newestRetainedEndTimeMs, 11960);
  for (const category of [metrics.longTasks, metrics.eventTimings, ...Object.values(metrics.operations)]) {
    assert.equal(category.retentionLimitReached, true);
    assert.equal(category.observerSupported, null);
    assert.equal(category.droppedBeforeSnapshot, null);
    assert.equal(category.status, 'available');
  }
  for (const category of [metrics.eventTimings, ...Object.values(metrics.operations)]) {
    assert.equal(category.retainedCount, 120);
    assert.equal(category.exportedCount, 32);
    assert.equal(category.omitted, 88);
  }
  assert.equal(metrics.eventTimings.samples[0].startTime, 8800);
  assert.deepEqual(Object.keys(metrics.operations), ['autosave.persist', 'project.command', 'project.transaction']);
  assert.equal(metrics.longTasks.samples[0].name.length, 160);
  assert.equal(metrics.eventTimings.samples[0].target.length, 160);
  assert.ok(!JSON.stringify(report).includes('excluded'));
  assert.ok(JSON.stringify(report).length < 55000);
});

test('empty and missing retained categories remain distinct and neither claims complete observation', () => {
  const fixture = browserFixture({ report: () => ({ longTasks: { samples: [] } }) });
  const report = fixture.take();
  assert.equal(report.performance.longTasks.status, 'available');
  assert.equal(report.performance.longTasks.retainedCount, 0);
  assert.equal(report.performance.longTasks.oldestRetainedStartTimeMs, null);
  assert.equal(report.performance.longTasks.newestRetainedEndTimeMs, null);
  assert.equal(report.performance.longTasks.retentionLimitReached, false);
  assert.equal(report.performance.eventTimings.status, 'unavailable');
  assert.equal(report.performance.eventTimings.retainedCount, null);
  assert.equal(report.performance.eventTimings.retentionLimitReached, null);
  assert.equal(report.performanceCollection.partial, true);
});

test('ready native windows keep interval filtering, including end-timestamp operation overlap', () => {
  const fixture = browserFixture({ report: () => ({
    longTasks: { samples: [{ startTime: 0, durationMs: 50 }, { startTime: 90, durationMs: 10 },
      { startTime: 200, durationMs: 30 }, { startTime: 201, durationMs: 50 }] },
    operations: { 'project.command': { samples: [{ atMs: 99, durationMs: 60 }, { atMs: 110, durationMs: 20 },
      { atMs: 240, durationMs: 40 }, { atMs: 251, durationMs: 50 }] } },
  }) });
  fixture.install(); fixture.setNow(200);
  const report = fixture.take();
  assert.deepEqual(Array.from(report.performance.longTasks.samples, sample => sample.startTime), [90, 200]);
  assert.deepEqual(Array.from(report.performance.operations['project.command'].samples, sample => sample.atMs), [110, 240]);
  assert.equal(report.performance.longTasks.retainedCount, 4);
  assert.equal(report.performance.longTasks.exportedCount, 2);
  assert.equal(report.performance.longTasks.omitted, 0);
  assert.equal(report.performanceCollection.scope, 'native-window-overlap');
  assert.equal(fixture.listeners.length, 0);
});

test('a late rejected setup still permits one bounded final startup collection and preserves the action error', { timeout: 1500 }, async () => {
  const browser = browserFixture({ report: () => ({ longTasks: { samples: [{ startTime: 10, durationMs: 100 }] } }) });
  let reads = 0, rejectSetup, actions = 0;
  const fixture = hostFixture((probe, options) => {
    reads++;
    if (options.command === 'install') return new Promise((_, reject) => { rejectSetup = reject; });
    return Promise.resolve(browser.call(options));
  });
  const original = new Error('original native timeout');
  const startedAt = performance.now();
  await assert.rejects(withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options, () => {
    actions++;
    assert.equal(browser.call({ command: 'install', token: 'late', installBeforeEpochMs: 0 }).installationExpired, true);
    throw original;
  }), error => error === original);
  assert.ok(performance.now() - startedAt < 1000);
  rejectSetup(new Error('late page closure'));
  await Promise.resolve(); await Promise.resolve();
  const report = JSON.parse(await readFile(fixture.attachments[0].path, 'utf8'));
  assert.equal(actions, 1);
  assert.equal(reads, 2);
  assert.match(report.setup.diagnosticError, /250 ms/);
  assert.equal(report.host.outcome, 'rejected');
  assert.equal(report.browser.unavailable, true);
  assert.equal(report.browser.nativeWindow, null);
  assert.equal(report.browser.performance.longTasks.samples.length, 1);
  assert.equal(browser.listeners.length, 0);
});


test('a rolled-over production metrics ring retains 120 long tasks without claiming the lost history is known', () => {
  const observers = new Map();
  const fixture = browserFixture();
  const metrics = createRuntimePerformanceMetrics({
    globalObject: {}, performanceObject: fixture.scope.performance,
    PerformanceObserverCtor: class {
      constructor(callback) { this.callback = callback; }
      observe({ type }) { observers.set(type, this.callback); }
      disconnect() {}
    },
  });
  metrics.observe();
  observers.get('longtask')({ getEntries: () => Array.from({ length: 140 }, (_, i) => ({ startTime: i * 100, duration: 60 })) });
  fixture.scope.__PANDOLAB_PERFORMANCE_REPORT__ = metrics.snapshot;
  const report = fixture.take();
  const tasks = report.performance.longTasks;
  assert.equal(tasks.retainedCount, 120);
  assert.equal(tasks.exportedCount, 120);
  assert.equal(tasks.omitted, 0, 'export omissions cannot count entries lost before the snapshot');
  assert.equal(tasks.samples[0].startTime, 2000);
  assert.equal(tasks.samples.at(-1).startTime, 13900);
  assert.equal(tasks.oldestRetainedStartTimeMs, 2000);
  assert.equal(tasks.newestRetainedEndTimeMs, 13960);
  assert.equal(tasks.retentionLimitReached, true);
  assert.equal(tasks.droppedBeforeSnapshot, null, 'production does not expose the 20 overwritten entries');
  assert.equal(tasks.observerSupported, null, 'snapshot does not expose the actual observer installation result');
  assert.equal(report.performanceCollection.partial, true);
  metrics.dispose();
});

for (const [description, hook] of [
  ['missing', undefined], ['throwing', () => { throw new Error('unarmed metrics failure'); }],
]) test(`an unarmed ${description} metrics hook preserves the original host result and saved diagnostic error`, async () => {
  const browser = browserFixture(); browser.scope.__PANDOLAB_PERFORMANCE_REPORT__ = hook;
  let reads = 0;
  const fixture = hostFixture((probe, options) => {
    reads++;
    return Promise.resolve(browser.call({ ...options, installBeforeEpochMs: 0 }));
  });
  const originalResult = {};
  assert.equal(await withNativeActionDiagnostics(fixture.page, fixture.testInfo, fixture.options, () => originalResult), originalResult);
  const report = JSON.parse(await readFile(fixture.attachments[0].path, 'utf8'));
  assert.equal(reads, 2);
  assert.equal(report.host.outcome, 'fulfilled');
  assert.equal(report.browser.unavailable, true);
  assert.equal(report.browser.performance, null);
  assert.equal(report.browser.errors.length, 1);
  assert.equal(browser.listeners.length, 0);
});

test('LoAF collection is opt-in and consumes the independently installed snapshot only in the final read', () => {
  const f = browserFixture(); let takes = 0;
  const frames = { status: 'available', frames: [{ startTime: 1, duration: 70 }] };
  f.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { takes++; return frames; } };
  f.install({ longAnimationFrames: true }); assert.equal(takes, 0);
  const native = f.call({ command: 'take', token: 'test', longAnimationFrames: true });
  assert.equal(takes, 1); assert.equal(native.longAnimationFrames, frames);
  assert.equal(native.events.length, 0);
  const other = browserFixture(); other.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { throw new Error('must not consume'); } };
  other.install(); assert.equal(other.take().longAnimationFrames, undefined);
});

test('an expired associated native probe captures LoAF while missing and stale tokens cannot consume it', () => {
  for (const scenario of ['expired', 'missing', 'stale']) {
    const f = browserFixture(); let takes = 0;
    f.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { takes++; return { status: 'available' }; } };
    if (scenario === 'expired') { f.install({ longAnimationFrames: true }); for (const callback of [...f.timers.values()]) callback(); }
    if (scenario === 'stale') f.call({ command: 'install', token: 'new', selector: '#undoBtn' });
    const result = f.call({ command: 'take', token: 'test', longAnimationFrames: true });
    assert.equal(takes, scenario === 'expired' ? 1 : 0);
    assert.equal(result.longAnimationFrames.status, scenario === 'expired' ? 'available' : 'unavailable');
    if (scenario === 'expired') assert.equal(result.expired, true);
  }
});

for (const throws of [false, true]) test(`LoAF ${throws ? 'snapshot failure' : 'missing init script'} is explicit diagnostic evidence`, () => {
  const f = browserFixture();
  if (throws) f.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { throw new Error('snapshot failure'); } };
  f.install({ longAnimationFrames: true });
  const result = f.call({ command: 'take', token: 'test', longAnimationFrames: true });
  assert.equal(result.longAnimationFrames.status, throws ? 'error' : 'unavailable');
  assert.equal(result.longAnimationFrames.frames, null);
  assert.match(result.longAnimationFrames.coverage, /cannot rule out/);
  assert.equal(f.listeners.length, 0);
});

for (const failed of [false, true]) test(`final take waits for already-awaited CPU stop/finish and preserves ${failed ? 'error' : 'result'} and host timing`, async () => {
  let resolveStop, requestedStop, now = 1, attempts = 0;
  const stop = new Promise(resolve => { resolveStop = resolve; });
  const stopped = new Promise(resolve => { requestedStop = resolve; });
  const stages = [];
  const f = hostFixture(async (probe, options) => { stages.push(options.command); return { command: options.command, longAnimationFrames: options.longAnimationFrames }; });
  f.page.context = () => ({ newCDPSession: async () => ({
    async send(method) {
      stages.push(method);
      if (method === 'Profiler.stop') { requestedStop(); return stop; }
      return {};
    }, async detach() { stages.push('detach'); },
  }) });
  const original = failed ? new Error('original locator timeout') : {};
  const running = withNativeActionDiagnostics(f.page, f.testInfo,
    { ...f.options, cpuProfile: true, longAnimationFrames: true, now: () => now }, () => {
      attempts++; now = 9751; if (failed) throw original; return original;
    });
  const settled = running.then(value => ({ value }), error => ({ error }));
  await stopped;
  for (let i = 0; i < 30; i++) await Promise.resolve();
  // Resolve before assertions so a red test cannot leave the profiler hanging.
  const tookBeforeStop = stages.includes('take');
  const host = JSON.parse(f.lines.find(line => line.startsWith('[native-action] ')).slice('[native-action] '.length)).host;
  now = 20000; resolveStop({}); const result = await settled;
  assert.equal(tookBeforeStop, false);
  assert.ok(stages.indexOf('detach') < stages.indexOf('take'));
  assert.equal(stages.filter(value => value === 'take').length, 1);
  assert.equal(stages.filter(value => value === 'Profiler.stop').length, 1);
  assert.equal(result[failed ? 'error' : 'value'], original); assert.equal(attempts, 1);
  assert.deepEqual(host, { startedAtMs: 1, endedAtMs: 9751, durationMs: 9750, outcome: failed ? 'rejected' : 'fulfilled' });
  const report = JSON.parse(await readFile(f.testInfo.outputPath('project-undo-native-action.json'), 'utf8'));
  assert.equal(report.setup.longAnimationFrames, true);
  assert.equal(report.browser.longAnimationFrames, true);
  assert.deepEqual(report.host, host);
});

test('a stale native take after navigation cannot consume a newer document observer', () => {
  const oldPage = browserFixture(); oldPage.install();
  const nextPage = browserFixture(); let takes = 0;
  nextPage.scope.performance.timeOrigin = 456000;
  nextPage.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { takes++; return { status: 'available' }; } };
  const result = nextPage.call({ command: 'take', token: 'test', longAnimationFrames: true });
  assert.equal(result.unavailableReason, 'missing-token');
  assert.equal(result.longAnimationFrames.status, 'unavailable');
  assert.equal(result.longAnimationFrames.reason, 'missing-native-token');
  assert.equal(takes, 0);
});

test('a native take consumes only its installation-associated observer, not a replacement', () => {
  const f = browserFixture(); let oldTakes = 0, newTakes = 0;
  const oldProbe = { take() { oldTakes++; return { status: 'available', identity: 'old' }; } };
  f.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = oldProbe;
  f.call({ command: 'install', token: 'test', selector: '#undoBtn', longAnimationFrames: true });
  f.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { newTakes++; return { status: 'available', identity: 'new' }; } };
  const result = f.call({ command: 'take', token: 'test', longAnimationFrames: true });
  assert.equal(result.longAnimationFrames.identity, 'old');
  assert.equal(oldTakes, 1); assert.equal(newTakes, 0);
});

test('late observer installation cannot arm an unassociated native take', () => {
  const f = browserFixture(); f.call({ command: 'install', token: 'test', selector: '#undoBtn', longAnimationFrames: true });
  let takes = 0;
  f.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ = { take() { takes++; return { status: 'available' }; } };
  const result = f.call({ command: 'take', token: 'test', longAnimationFrames: true });
  assert.equal(result.longAnimationFrames.status, 'unavailable'); assert.equal(takes, 0);
});

function addRealLongAnimationFrameObserver(fixture) {
  const observers = [];
  fixture.scope.PerformanceObserver = class {
    static supportedEntryTypes = ['long-animation-frame'];
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    takeRecords() { return []; }
    disconnect() { this.disconnected = true; }
  };
  fixture.scope.addEventListener = () => {};
  fixture.scope.removeEventListener = () => {};
  vm.runInNewContext(`(${installLongAnimationFrameProbe.toString()})()`, { globalThis: fixture.scope });
  return { observer: observers[0], emit: startTime => observers[0].callback({
    getEntries: () => [{ startTime, duration: 75, scripts: [] }],
  }) };
}

for (const scenario of ['expired-install', 'new-document', 'stale-token', 'late-observer']) {
  test(`real LoAF ${scenario} snapshots are useful but non-destructive and explicitly unassociated`, () => {
    const f = browserFixture();
    if (scenario === 'new-document') {
      const old = browserFixture(); const oldLoaf = addRealLongAnimationFrameObserver(old); old.install({ longAnimationFrames: true });
      old.scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__.dispose('pagehide');
      assert.equal(oldLoaf.observer.disconnected, true);
      f.scope.performance.timeOrigin = 456000;
    }
    if (scenario === 'late-observer') f.install({ longAnimationFrames: true });
    const loaf = addRealLongAnimationFrameObserver(f); loaf.emit(555);
    if (scenario === 'expired-install') assert.equal(f.call({ command: 'install', token: 'test', selector: '#undoBtn',
      longAnimationFrames: true, installBeforeEpochMs: 0 }).installationExpired, true);
    if (scenario === 'stale-token') f.call({ command: 'install', token: 'new', selector: '#undoBtn', longAnimationFrames: true });
    const result = f.call({ command: 'take', token: 'test', longAnimationFrames: true });
    assert.equal(result.longAnimationFrames.status, 'available');
    assert.equal(result.longAnimationFrames.collectionMode, 'non-destructive-snapshot');
    assert.equal(result.longAnimationFrames.nativeAssociation, 'unknown');
    assert.equal(result.longAnimationFrames.nativeAssociationReason, scenario === 'stale-token' ? 'token-mismatch'
      : scenario === 'late-observer' ? 'missing-init-script-at-native-install' : 'missing-native-token');
    assert.equal(result.longAnimationFrames.frames[0].startTime, 555);
    assert.equal(result.longAnimationFrames.timeOrigin, scenario === 'new-document' ? 456000 : 123000);
    assert.equal(loaf.observer.disconnected, false);
    loaf.emit(777);
    assert.equal(result.longAnimationFrames.frames.length, 1, 'earlier snapshots remain independent');
    if (scenario !== 'stale-token') f.call({ command: 'install', token: 'new', selector: '#undoBtn', longAnimationFrames: true });
    const final = f.call({ command: 'take', token: 'new', longAnimationFrames: true });
    assert.equal(final.longAnimationFrames.collectionMode, 'final-take');
    assert.deepEqual(Array.from(final.longAnimationFrames.frames, frame => frame.startTime), [555, 777]);
    assert.equal(loaf.observer.disconnected, true);
  });
}

function enableFixtureCpuProfile(fixture) {
  const stages = [];
  fixture.page.context = () => ({ newCDPSession: async () => ({
    async send(method) { stages.push(method); return {}; },
    async detach() { stages.push('detach'); },
  }) });
  return stages;
}

for (const failed of [false, true]) test(`CPU opt-in retains a real-timer final take beyond 250 ms and preserves the action ${failed ? 'error' : 'result'}`, { timeout: 2500 }, async () => {
  let now = 5, attempts = 0;
  const reads = [];
  const captured = { longAnimationFrames: { status: 'available', frames: [{ startTime: 100, duration: 75 }] } };
  let readStartedAt;
  const f = hostFixture(async (probe, options) => {
    reads.push(options.command);
    if (options.command === 'install') return { installed: true };
    readStartedAt = performance.now();
    await new Promise(resolve => setTimeout(resolve, 350));
    now = 20000; return captured;
  });
  const stages = enableFixtureCpuProfile(f);
  const original = failed ? new Error('original native timeout') : {};
  const result = await withNativeActionDiagnostics(f.page, f.testInfo,
    { ...f.options, cpuProfile: true, now: () => now }, () => {
      attempts++; now = 9805; if (failed) throw original; return original;
    }).then(value => ({ value }), error => ({ error }));
  assert.equal(result[failed ? 'error' : 'value'], original);
  const report = JSON.parse(await readFile(f.testInfo.outputPath('project-undo-native-action.json'), 'utf8'));
  assert.deepEqual(report.browser, captured);
  assert.ok(performance.now() - readStartedAt >= 300, 'uses real elapsed time beyond the former deadline');
  assert.deepEqual(report.diagnosticDeadlinesMs, { setup: 250, finalTake: 15000, output: 250 });
  const logged = JSON.parse(f.lines.find(line => line.startsWith('[native-action] ')).slice('[native-action] '.length));
  assert.deepEqual(logged.diagnosticDeadlinesMs, report.diagnosticDeadlinesMs);
  assert.deepEqual(report.host, { startedAtMs: 5, endedAtMs: 9805, durationMs: 9800, outcome: failed ? 'rejected' : 'fulfilled' });
  assert.equal(attempts, 1); assert.deepEqual(reads, ['install', 'take']);
  assert.equal(stages.filter(stage => stage === 'Profiler.stop').length, 1);
});

for (const [cpuProfile, failed, late] of [[true, true, 'reject'], [true, false, 'fulfill'], [false, true, 'reject'], [false, false, 'fulfill']]) {
  test(`${cpuProfile ? 'CPU' : 'non-CPU'} final take has a ${cpuProfile ? 15000 : 250} ms bound and contains late ${late} without replacing the action`, { timeout: 2500 }, async t => {
    let announceTake, resolveTake, rejectTake, nativeOutputStarted = false, attempts = 0;
    const takeRequested = new Promise(resolve => { announceTake = resolve; });
    const read = new Promise((resolve, reject) => { resolveTake = resolve; rejectTake = reject; });
    const reads = [];
    const f = hostFixture((probe, options) => {
      reads.push(options.command);
      if (options.command === 'install') return Promise.resolve({ installed: true });
      announceTake(); return read;
    });
    const outputPath = f.testInfo.outputPath;
    f.testInfo.outputPath = name => { if (name === 'project-undo-native-action.json') nativeOutputStarted = true; return outputPath(name); };
    if (cpuProfile) enableFixtureCpuProfile(f);
    const original = failed ? new Error('original native action failed') : {};
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const running = withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, cpuProfile }, () => {
      attempts++; if (failed) throw original; return original;
    }).then(value => ({ value }), error => ({ error }));
    await takeRequested;
    const deadline = cpuProfile ? 15000 : 250;
    t.mock.timers.tick(deadline - 1);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const outputBeforeDeadline = nativeOutputStarted;
    t.mock.timers.tick(1);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const outputAtDeadline = nativeOutputStarted;
    t.mock.timers.reset();
    const result = await running;
    const path = outputPath('project-undo-native-action.json');
    const saved = await readFile(path, 'utf8'), report = JSON.parse(saved);
    if (late === 'reject') rejectTake(new Error('late page closure'));
    else resolveTake({ lateData: 'must not republish' });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(outputBeforeDeadline, false); assert.equal(outputAtDeadline, true);
    assert.equal(result[failed ? 'error' : 'value'], original); assert.equal(attempts, 1);
    assert.match(report.browser.diagnosticError, new RegExp(`exceeded ${deadline} ms`));
    assert.deepEqual(report.diagnosticDeadlinesMs, { setup: 250, finalTake: deadline, output: 250 });
    assert.deepEqual(reads, ['install', 'take']);
    assert.equal(await readFile(path, 'utf8'), saved);
  });
}

test('CPU opt-in final read rejection preserves the original action error without waiting or retrying', async () => {
  const reads = [];
  const f = hostFixture((probe, options) => {
    reads.push(options.command);
    if (options.command === 'take') throw new Error('page closed during final take');
    return Promise.resolve({ installed: true });
  });
  enableFixtureCpuProfile(f);
  const original = new Error('original locator timeout');
  await assert.rejects(withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, cpuProfile: true },
    () => { throw original; }), error => error === original);
  const report = JSON.parse(await readFile(f.testInfo.outputPath('project-undo-native-action.json'), 'utf8'));
  assert.match(report.browser.diagnosticError, /page closed during final take/);
  assert.deepEqual(report.diagnosticDeadlinesMs, { setup: 250, finalTake: 15000, output: 250 });
  assert.deepEqual(reads, ['install', 'take']);
});

test('CPU opt-in leaves native setup at 250 ms and contains its late rejection', { timeout: 2500 }, async t => {
  let requestedSetup, rejectSetup, attempts = 0;
  const requested = new Promise(resolve => { requestedSetup = resolve; });
  const pending = new Promise((resolve, reject) => { rejectSetup = reject; });
  const f = hostFixture((probe, options) => {
    if (options.command === 'install') { requestedSetup(); return pending; }
    return Promise.resolve({ captured: true });
  });
  enableFixtureCpuProfile(f);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const running = withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, cpuProfile: true }, () => { attempts++; return 42; });
  await requested;
  t.mock.timers.tick(249); for (let i = 0; i < 30; i++) await Promise.resolve();
  const attemptsBefore = attempts;
  t.mock.timers.tick(1); for (let i = 0; i < 50; i++) await Promise.resolve();
  const attemptsAtDeadline = attempts;
  t.mock.timers.reset();
  assert.equal(await running, 42);
  rejectSetup(new Error('late native setup closure'));
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(attemptsBefore, 0); assert.equal(attemptsAtDeadline, 1);
  const report = JSON.parse(await readFile(f.testInfo.outputPath('project-undo-native-action.json'), 'utf8'));
  assert.match(report.setup.diagnosticError, /exceeded 250 ms/);
  assert.equal(report.browser.captured, true);
  assert.deepEqual(report.diagnosticDeadlinesMs, { setup: 250, finalTake: 15000, output: 250 });
});

test('CPU opt-in leaves native output at 250 ms without replacing the original error', { timeout: 2500 }, async t => {
  let announceOutput, rejectOutput, settled = false;
  const requested = new Promise(resolve => { announceOutput = resolve; });
  const pending = new Promise((resolve, reject) => { rejectOutput = reject; });
  const f = hostFixture(); enableFixtureCpuProfile(f);
  f.testInfo.attach = (name, value) => {
    if (name === 'project-undo-native-action.json') { announceOutput(); return pending; }
    f.attachments.push({ name, ...value }); return Promise.resolve();
  };
  const original = new Error('original action failure');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const running = withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, cpuProfile: true }, () => { throw original; })
    .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  await requested;
  t.mock.timers.tick(249); for (let i = 0; i < 30; i++) await Promise.resolve();
  const settledBefore = settled;
  t.mock.timers.tick(1); for (let i = 0; i < 30; i++) await Promise.resolve();
  const settledAtDeadline = settled;
  t.mock.timers.reset();
  assert.equal((await running).error, original);
  rejectOutput(new Error('late output rejection'));
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(settledBefore, false); assert.equal(settledAtDeadline, true);
  assert.ok(f.lines.some(line => line.includes('[native-action-output]') && line.includes('exceeded 250 ms')));
});
