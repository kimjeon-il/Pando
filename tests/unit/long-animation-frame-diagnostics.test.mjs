import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { installLongAnimationFrameProbe } from '../browser/helpers/long-animation-frame-diagnostics.mjs';

const KEY = '__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__';
const plain = value => JSON.parse(JSON.stringify(value));
function entry(fields) {
  // Browser PerformanceEntry fields are prototype accessors, not JSON data.
  return Object.create(Object.defineProperties({}, Object.fromEntries(Object.entries(fields).map(([key, value]) =>
    [key, { get: () => value, enumerable: true }]))));
}
const script = extra => entry({ startTime: 12, duration: 24, executionStart: 13,
  invoker: 'Window.requestAnimationFrame', invokerType: 'user-callback', sourceURL: 'http://localhost/assets/app.js',
  sourceFunctionName: 'render', sourceCharPosition: 123, forcedStyleAndLayoutDuration: 8, ...extra });
const frame = extra => entry({ entryType: 'long-animation-frame', startTime: 10, duration: 75,
  blockingDuration: 25, renderStart: 60, styleAndLayoutStart: 70, firstUIEventTimestamp: 11,
  scripts: [script()], ...extra });
function fixture({ supported = ['long-animation-frame'], absent = false, observeThrows = false, takeThrows = false } = {}) {
  let now = 5, nextTimer = 0;
  const observers = [], timers = new Map(), listeners = new Map();
  const scope = { performance: { now: () => now, timeOrigin: 123000 },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); },
    getComputedStyle: () => { throw new Error('layout forbidden'); },
    document: new Proxy({}, { get() { throw new Error('DOM access forbidden'); } }),
    PerformanceObserver: absent ? undefined : class {
      static supportedEntryTypes = supported;
      constructor(callback) { this.callback = callback; this.pending = []; this.disconnected = false; observers.push(this); }
      observe(options) { this.options = options; if (observeThrows) throw new Error('observe failed'); }
      takeRecords() { if (takeThrows) throw new Error('takeRecords failed'); const result = this.pending; this.pending = []; return result; }
      disconnect() { this.disconnected = true; }
    },
  };
  return { scope, observers, timers, listeners, setNow: value => { now = value; },
    install: () => vm.runInNewContext(`(${installLongAnimationFrameProbe.toString()})()`, { globalThis: scope }),
    emit: entries => observers.at(-1).callback({ getEntries: () => entries }),
    take: () => scope[KEY].take(),
  };
}

test('early buffered observation exports real-shaped scalar frame and script fields with independent clocks', () => {
  const f = fixture(); f.install(); f.setNow(110); f.emit([frame()]); f.setNow(120);
  const result = plain(f.take());
  assert.equal(result.status, 'available');
  assert.deepEqual(result.support, { performanceObserver: true, entryType: true, observed: true, bufferedRequested: true });
  assert.deepEqual(plain(f.observers[0].options), { type: 'long-animation-frame', buffered: true });
  assert.equal(result.installedAtMs, 5); assert.equal(result.collectedAtMs, 120); assert.equal(result.timeOrigin, 123000);
  assert.match(result.clock, /browser performance.now/); assert.match(result.coverage, /not.*click attribution/);
  assert.equal(result.frames[0].startTime, 10); assert.equal(result.frames[0].observedAtMs, 110);
  assert.equal(result.frames[0].scripts[0].sourceFunctionName, 'render');
  assert.equal(result.frames[0].scripts[0].forcedStyleAndLayoutDuration, 8);
  assert.equal(result.frames[0].scripts[0].pauseDuration, null);
  assert.ok(result.frames[0].scripts[0].unavailableFields.includes('pauseDuration'));
  assert.equal(result.stoppedReason, 'take'); assert.equal(f.observers[0].disconnected, true);
  assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

for (const absent of [true, false]) test(`unsupported ${absent ? 'observer' : 'entry type'} is explicit and starts no observer`, () => {
  const f = fixture({ absent, supported: [] }); f.install(); const result = f.take();
  assert.equal(result.status, 'unsupported'); assert.equal(result.support.performanceObserver, !absent);
  assert.equal(result.support.entryType, absent ? null : false);
  assert.equal(result.support.observed, false); assert.equal(result.frames.length, 0);
  assert.equal(f.observers.length, 0); assert.equal(f.timers.size, 0);
  assert.match(result.coverage, /empty.*cannot rule out/i);
});

test('observation failure is bounded evidence and disconnects without surfacing an app error', () => {
  const f = fixture({ observeThrows: true }); assert.doesNotThrow(f.install); const result = f.take();
  assert.equal(result.status, 'error'); assert.equal(result.support.observed, false);
  assert.match(result.errors[0], /observe failed/); assert.equal(f.observers[0].disconnected, true);
});

test('empty supported observation reports unknown browser omissions and no invented script coverage', () => {
  const f = fixture(); f.install(); const result = f.take();
  assert.equal(result.support.observed, true); assert.equal(result.totalFrameCount, 0);
  assert.equal(result.browserDroppedFrameCount, null);
  assert.match(result.coverage, /cross-origin|same-origin/);
  assert.match(result.coverage, /GPU/);
});

test('frame and script rings, field strings and output are capped with omission counts', () => {
  const f = fixture(); f.install();
  const manyScripts = Array.from({ length: 20 }, () => script({ sourceURL: 'x'.repeat(3000), sourceFunctionName: 'y'.repeat(3000), invoker: 'z'.repeat(3000) }));
  f.emit(Array.from({ length: 50 }, (_, i) => frame({ startTime: i, scripts: manyScripts })));
  const result = f.take();
  assert.equal(result.totalFrameCount, 50); assert.equal(result.retainedFrameCount, 32);
  assert.equal(result.droppedFrameCount, 18);
  assert.equal(result.frames.at(-1).startTime, 49);
  assert.ok(result.frames.every(value => value.scripts.length <= 16));
  assert.ok(result.frames.every(value => value.omittedScriptCount >= 4));
  assert.ok(result.frames.every(value => value.scripts.every(value => value.sourceURL.length <= 160)));
  assert.ok(result.outputOmittedFrameCount > 0);
  assert.ok(JSON.stringify(result).length <= result.limits.outputCharacters);
});

test('non-finite, missing, wrong-type and throwing fields are disclosed without traversing window or DOM', () => {
  const f = fixture(); f.install();
  const item = script({ duration: Infinity, sourceFunctionName: { secret: 'omit' }, windowAttribution: 'self' });
  Object.defineProperty(item, 'window', { get() { throw new Error('window traversal forbidden'); } });
  Object.defineProperty(item, 'pauseDuration', { get() { throw new Error('optional getter failed'); } });
  f.emit([frame({ renderStart: NaN, scripts: [item] })]); const result = f.take();
  const captured = result.frames[0].scripts[0];
  assert.equal(result.frames[0].renderStart, null); assert.equal(captured.duration, null);
  assert.equal(captured.sourceFunctionName, null); assert.equal(captured.windowAttribution, 'self');
  assert.ok(captured.unavailableFields.includes('pauseDuration'));
  assert.ok(result.errors.some(error => error.includes('optional getter failed')));
  assert.ok(!JSON.stringify(result).includes('window traversal forbidden'));
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('buffered entries predating installation are retained with source timestamps, never assigned to the click', () => {
  const f = fixture(); f.setNow(100); f.install(); f.setNow(150); f.emit([frame({ startTime: 1 })]);
  const result = f.take();
  assert.equal(result.frames[0].startTime, 1); assert.equal(result.frames[0].observedAtMs, 150);
  assert.equal(result.installedAtMs, 100); assert.equal(result.frames[0].attributedToClick, undefined);
  assert.match(result.coverage, /predate/);
});

test('final collection drains late queued records once and ignores callbacks after disconnection', () => {
  const f = fixture(); f.install(); f.observers[0].pending.push(frame({ startTime: 500 })); f.setNow(600);
  const result = f.take();
  assert.equal(result.totalFrameCount, 1); assert.equal(result.frames[0].startTime, 500);
  f.emit([frame({ startTime: 700 })]);
  assert.equal(f.take(), result); assert.equal(result.totalFrameCount, 1);
});

test('deadline cleanup drains delivered records but discloses the expired observation window', () => {
  const f = fixture(); f.install(); const { callback, delay } = [...f.timers.values()][0];
  assert.equal(delay, 360000); f.setNow(400000); f.observers[0].pending.push(frame()); callback();
  assert.equal(f.observers[0].disconnected, true); f.emit([frame()]);
  const result = f.take(); assert.equal(result.expired, true); assert.equal(result.stoppedReason, 'lifetime-limit');
  assert.equal(result.stoppedAtMs, 400000); assert.equal(result.totalFrameCount, 1);
});

test('pagehide and reinstallation dispose their own observer and pages never share data', () => {
  const first = fixture(), second = fixture(); first.install(); second.install(); first.emit([frame()]);
  const old = first.scope[KEY]; first.install();
  assert.equal(first.observers[0].disconnected, true); assert.equal(old.take().stoppedReason, 'reinstalled');
  first.listeners.get('pagehide')(); assert.equal(first.observers[1].disconnected, true);
  assert.equal(first.take().stoppedReason, 'pagehide');
  assert.equal(second.observers[0].disconnected, false); assert.equal(second.take().totalFrameCount, 0);
});

test('callback and drain errors remain capped and do not prevent cleanup', () => {
  const f = fixture({ takeThrows: true }); f.install();
  for (let i = 0; i < 30; i++) assert.doesNotThrow(() => f.observers[0].callback({ getEntries() { throw new Error('x'.repeat(1000)); } }));
  const result = f.take(); assert.equal(result.errors.length, 8);
  assert.ok(result.errors.every(error => error.length <= 240)); assert.ok(result.omittedErrorCount > 0);
  assert.equal(f.observers[0].disconnected, true);
});

test('a late callback does not read entries or mutate a consumed snapshot', () => {
  const f = fixture(); f.install(); const result = f.take();
  let reads = 0;
  f.observers[0].callback({ getEntries() { reads++; throw new Error('late callback'); } });
  assert.equal(reads, 0); assert.equal(result.errors.length, 0);
});

test('delayed lifetime cleanup is labelled even when final take runs before its delayed timer', () => {
  const f = fixture(); f.install(); f.setNow(400000); const result = f.take();
  assert.equal(result.expired, true); assert.equal(result.lifetimeDueAtMs, 360005);
  assert.equal(result.lifetimeOverrunMs, 39995);
  assert.equal(result.stoppedReason, 'take');
});

test('an absent supportedEntryTypes catalog is unknown support, not a negative capability claim', () => {
  const f = fixture(); f.scope.PerformanceObserver.supportedEntryTypes = undefined; f.install(); const result = f.take();
  assert.equal(result.status, 'unsupported'); assert.equal(result.support.entryType, null);
  assert.equal(f.observers.length, 0);
});

test('missing scripts are distinct from an available empty list', () => {
  const f = fixture(); f.install(); f.emit([frame({ scripts: undefined }), frame({ scripts: [] })]);
  const result = f.take();
  assert.equal(result.frames[0].scriptsStatus, 'unavailable'); assert.equal(result.frames[0].totalScriptCount, null);
  assert.equal(result.frames[1].scriptsStatus, 'available'); assert.equal(result.frames[1].totalScriptCount, 0);
});

test('successive deliveries keep the latest frames and disclose every dropped record', () => {
  const f = fixture(); f.install();
  for (let i = 0; i < 50; i++) f.emit([frame({ startTime: i, scripts: [] })]);
  const result = f.take();
  assert.equal(result.frames[0].startTime, 18); assert.equal(result.frames.at(-1).startTime, 49);
  assert.equal(result.totalFrameCount, 50); assert.equal(result.droppedFrameCount, 18);
  assert.equal(result.exportedFrameCount, 32); assert.equal(result.outputOmittedFrameCount, 0);
});

for (const malformed of ['entry-access', 'script-access', 'unprintable-field-error']) {
  test(`synthetic ${malformed} cannot discard a valid delivery tail or hide losses`, () => {
    const f = fixture(); f.install();
    const bad = frame({ startTime: 2 });
    const entries = [frame({ startTime: 1 }), bad, frame({ startTime: 3 })];
    if (malformed === 'entry-access') Object.defineProperty(entries, 1, { get() { throw new Error('entry unavailable'); } });
    if (malformed === 'script-access') {
      const scripts = [script(), script(), script()];
      Object.defineProperty(scripts, 1, { get() { throw new Error('script unavailable'); } });
      Object.defineProperty(bad, 'scripts', { value: scripts });
    }
    if (malformed === 'unprintable-field-error') Object.defineProperty(bad, 'duration', { get() { throw Object.create(null); } });
    assert.doesNotThrow(() => f.emit(entries)); const result = f.take();
    assert.equal(result.totalFrameCount, 3);
    assert.equal(result.frames.at(-1).startTime, 3);
    assert.equal(result.totalFrameCount, result.retainedFrameCount + result.droppedFrameCount);
    assert.equal(result.droppedFrameCount, malformed === 'entry-access' ? 1 : 0);
    assert.ok(result.errors.length > 0); assert.ok(result.errors.every(error => typeof error === 'string' && error.length <= 240));
    if (malformed === 'script-access') {
      assert.equal(result.frames[1].scripts.length, 2);
      assert.equal(result.frames[1].omittedScriptCount, 1);
    }
    if (malformed === 'unprintable-field-error') {
      assert.equal(result.frames[1].duration, null);
      assert.ok(result.frames[1].unavailableFields.includes('duration'));
    }
  });
}

test('an unarmed snapshot retains useful frames without disconnecting, consuming or falsely associating them', () => {
  const f = fixture(); f.install(); f.emit([frame({ startTime: 1 })]);
  f.observers[0].pending.push(frame({ startTime: 2 }));
  assert.equal(typeof f.scope[KEY].snapshot, 'function');
  const result = f.scope[KEY].snapshot('missing-native-token');
  assert.equal(result.collectionMode, 'non-destructive-snapshot');
  assert.equal(result.nativeAssociation, 'unknown'); assert.equal(result.nativeAssociationReason, 'missing-native-token');
  assert.deepEqual(Array.from(result.frames, value => value.startTime), [1, 2]);
  assert.equal(f.observers[0].disconnected, false); assert.equal(f.timers.size, 1);
  assert.equal(result.stoppedReason, null);
  f.emit([frame({ startTime: 3 })]);
  const final = f.take();
  assert.deepEqual(Array.from(final.frames, value => value.startTime), [1, 2, 3]);
  assert.equal(final.totalFrameCount, 3); assert.equal(final.collectionMode, 'final-take');
  assert.equal(f.observers[0].disconnected, true);
});

test('capped non-destructive snapshots do not truncate the live ring or mutate prior exports', () => {
  const f = fixture(); f.install();
  const scripts = Array.from({ length: 16 }, () => script({ sourceURL: 'x'.repeat(160), invoker: 'y'.repeat(160), sourceFunctionName: 'z'.repeat(160) }));
  f.emit(Array.from({ length: 32 }, (_, i) => frame({ startTime: i, scripts })));
  assert.equal(typeof f.scope[KEY].snapshot, 'function');
  const first = f.scope[KEY].snapshot('token-mismatch');
  assert.ok(first.outputOmittedFrameCount > 0); assert.equal(first.retainedFrameCount, 32);
  assert.ok(JSON.stringify(first).length <= first.limits.outputCharacters);
  first.frames.at(-1).startTime = -1;
  const final = f.take();
  assert.equal(final.retainedFrameCount, 32); assert.equal(final.frames.at(-1).startTime, 31);
  assert.equal(final.totalFrameCount, 32); assert.equal(final.droppedFrameCount, 0);
});
