import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import vm from 'node:vm';
import { mkdtempSync } from 'node:fs';
import fs, { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    install: () => call({ command: 'install', token: 'test', selector: '.layer-search-result', rowSelector: '[data-object-key="hydro:river:exact"]' }),
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
