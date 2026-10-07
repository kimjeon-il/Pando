import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs, { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helperUrl = new URL('../browser/helpers/native-action-timeline.mjs', import.meta.url);
const categories = ['__metadata', 'toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'blink', 'cc', 'gpu', 'viz', 'base', 'mojom.flow', 'v8'];
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function fixture(t, overrides = {}, options = {}) {
  assert.ok(existsSync(helperUrl), 'the bounded native timeline controller must exist');
  const { createBoundaryNativeTimeline } = await import(helperUrl.href);
  const directory = await mkdtemp(join(tmpdir(), 'native-timeline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [], lines = [], attachments = [], session = new EventEmitter();
  const raw = '{"traceEvents":[]}';
  session.send = async (method, params) => {
    calls.push({ method, params });
    if (overrides[method]) return overrides[method](params, session);
    if (method === 'Browser.getVersion') return { product: 'Chrome/151.0.7922.34', revision: '@revision', protocolVersion: '1.3', userAgent: 'fake', jsVersion: '15.1' };
    if (method === 'Tracing.getCategories') return { categories };
    if (method === 'Tracing.end') Promise.resolve().then(() => session.emit('Tracing.tracingComplete', { stream: 'stream-1', dataLossOccurred: false, traceFormat: 'json', streamCompression: 'none' }));
    if (method === 'IO.read') return { data: raw, eof: true };
    return {};
  };
  session.detach = async () => { calls.push({ method: 'detach' }); if (overrides.detach) return overrides.detach(); };
  const browser = { newBrowserCDPSession: async () => { calls.push({ method: 'session' }); return session; } };
  const controller = await createBoundaryNativeTimeline(browser, { enabled: true, metadata: { commit: 'a'.repeat(40), playwrightVersion: '1.62.1', launchOptions: {} }, write: line => lines.push(line), ...options });
  const testInfo = { outputPath: name => join(directory, name), attach: async (...args) => attachments.push(args) };
  return { controller, calls, session, testInfo, directory, lines, attachments, raw };
}
const count = (f, method) => f.calls.filter(call => call.method === method).length;

test('explicit opt-in and exact desktop title are the only enabled boundary', async () => {
  assert.ok(existsSync(helperUrl), 'the bounded native timeline controller must exist');
  const { createBoundaryNativeTimeline, isBoundaryNativeTraceEnabled, BOUNDARY_NATIVE_TRACE_TITLE } = await import(helperUrl.href);
  let sessions = 0;
  assert.equal(await createBoundaryNativeTimeline({ newBrowserCDPSession() { sessions++; } }), null);
  assert.equal(sessions, 0);
  assert.equal(isBoundaryNativeTraceEnabled(BOUNDARY_NATIVE_TRACE_TITLE, { PANDOLAB_BOUNDARY_NATIVE_TRACE: '1' }), true);
  for (const value of [undefined, 'true', '0']) assert.equal(isBoundaryNativeTraceEnabled(BOUNDARY_NATIVE_TRACE_TITLE, { PANDOLAB_BOUNDARY_NATIVE_TRACE: value }), false);
  assert.equal(isBoundaryNativeTraceEnabled('a mobile native touch stroke keeps editable hit targets and cancels without residue', { PANDOLAB_BOUNDARY_NATIVE_TRACE: '1' }), false);
});

test('exact allowlist and owned stop preserve raw evidence separately and defer every IO read until finish', async t => {
  const f = await fixture(t);
  await f.controller.start();
  assert.deepEqual(f.calls.find(call => call.method === 'Tracing.start').params, {
    traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 16384, enableSampling: false, enableSystrace: false,
      includedCategories: categories, excludedCategories: ['*'] },
    transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'none', tracingBackend: 'chrome', bufferUsageReportingInterval: 1000,
  });
  await f.controller.start();
  f.controller.requestStop('wrapper-finished'); f.controller.requestStop('duplicate');
  await flush();
  assert.equal(count(f, 'IO.read'), 0);
  const report = await f.controller.finish(f.testInfo);
  assert.equal(count(f, 'Tracing.start'), 1); assert.equal(count(f, 'Tracing.end'), 1);
  assert.equal(count(f, 'Tracing.recordClockSyncMarker'), 2);
  assert.deepEqual(f.calls.filter(call => call.method.startsWith('IO.')).map(call => call.method), ['IO.read', 'IO.close']);
  assert.equal(count(f, 'detach'), 1);
  const saved = await readFile(join(f.directory, report.raw.name));
  assert.equal(saved.toString(), f.raw);
  assert.equal(report.raw.bytes, saved.length);
  assert.equal(report.raw.sha256, createHash('sha256').update(saved).digest('hex'));
  assert.equal(report.raw.eof, true); assert.equal(report.captureComplete, true);
  const manifest = await readFile(join(f.directory, 'boundary-project-undo-native-timeline-manifest.json'));
  assert.ok(manifest.length <= 64 * 1024);
  assert.deepEqual(JSON.parse(manifest).metadata.launchOptions, {});
  assert.equal(f.attachments.length, 0, 'native files must not be embedded in the Playwright ZIP');
  const output = JSON.parse(f.lines.at(-1).slice('[native-action-timeline-output] '.length));
  assert.equal(output.manifestBytes, manifest.length);
  assert.equal(output.manifestSha256, createHash('sha256').update(manifest).digest('hex'));
  assert.deepEqual(await f.controller.finish(f.testInfo), report);
});

for (const [name, override] of [
  ['different browser version', { 'Browser.getVersion': async () => ({ product: 'Chrome/152.0.0.0' }) }],
  ['missing required category', { 'Tracing.getCategories': async () => ({ categories: categories.slice(1) }) }],
]) test(`preflight mismatch ${name} never starts or ends native tracing`, async t => {
  const f = await fixture(t, override);
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.preflight.status, 'unavailable'); assert.equal(report.captureComplete, false);
  assert.equal(count(f, 'Tracing.start'), 0); assert.equal(count(f, 'Tracing.end'), 0); assert.equal(count(f, 'detach'), 1);
});

test('a conflict rejection cannot stop or drain another native owner', async t => {
  const f = await fixture(t, { 'Tracing.start': async () => { throw new Error('Tracing has already been started'); } });
  await f.controller.start();
  f.session.emit('Tracing.tracingComplete', { stream: 'other-owner', dataLossOccurred: false });
  f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.ownership, 'not-owned'); assert.equal(report.stages.start.status, 'rejected');
  assert.equal(count(f, 'Tracing.end'), 0); assert.equal(count(f, 'IO.read'), 0); assert.equal(count(f, 'IO.close'), 0);
});

for (const settlement of ['resolve', 'reject']) test(`an expired start contains late ${settlement} and ends only a late successful owner`, async t => {
  const start = deferred();
  const f = await fixture(t, { 'Tracing.start': () => start.promise });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const starting = f.controller.start(); await flush();
  t.mock.timers.tick(2000); await starting;
  assert.equal(count(f, 'Tracing.end'), 0);
  start[settlement](settlement === 'reject' ? new Error('late conflict') : {});
  await flush(); t.mock.timers.reset();
  const report = await f.controller.finish(f.testInfo);
  assert.equal(count(f, 'Tracing.end'), settlement === 'resolve' ? 1 : 0);
  assert.equal(report.stages.start.status, `${settlement === 'resolve' ? 'fulfilled' : 'rejected'}-after-deadline`);
  assert.equal(report.captureComplete, false); assert.equal(count(f, 'detach'), 1);
});

test('watchdog starts at the request and buffer reports are bounded while fullness triggers one stop', async t => {
  let now = 10;
  const f = await fixture(t, {}, { now: () => now });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await f.controller.start();
  now = 45025; t.mock.timers.tick(45000); await flush();
  for (let i = 0; i < 80; i++) f.session.emit('Tracing.bufferUsage', { percentFull: i < 79 ? 0.2 : 0.9, eventCount: i });
  t.mock.timers.reset();
  const report = await f.controller.finish(f.testInfo);
  assert.equal(count(f, 'Tracing.end'), 1); assert.equal(report.stopReason, 'watchdog');
  assert.equal(report.host.stopRequestOverrunMs, 15); assert.equal(report.buffer.reports.length, 64);
  assert.equal(report.buffer.omittedReports, 16); assert.equal(report.buffer.maxFullness, 0.9);
  assert.equal(report.captureComplete, false);
});

test('buffer fullness at 80 percent stops before the watchdog without stream downloads', async t => {
  const f = await fixture(t); await f.controller.start();
  f.session.emit('Tracing.bufferUsage', { value: 0.8 }); await flush();
  assert.equal(count(f, 'Tracing.end'), 1); assert.equal(count(f, 'IO.read'), 0);
  assert.equal((await f.controller.finish(f.testInfo)).stopReason, 'buffer-fullness');
});

test('base64 stream chunks are decoded and saved without changing the original bytes', async t => {
  let read = 0;
  const chunks = [Buffer.from('{"traceEvents":['), Buffer.from('],"unicode":"한글"}')];
  const f = await fixture(t, { 'IO.read': async params => {
    assert.equal(params.size, 64 * 1024);
    const data = chunks[read++]; return { data: data.toString('base64'), base64Encoded: true, eof: read === chunks.length };
  } });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.deepEqual(await readFile(join(f.directory, report.raw.name)), Buffer.concat(chunks));
});

test('24 MiB saved prefix is partial and closes immediately without reading an unlimited stream', async t => {
  const f = await fixture(t, { 'IO.read': async () => ({ data: 'x'.repeat(64 * 1024), eof: false }) });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.raw.bytes, 24 * 1024 * 1024); assert.equal(report.raw.limitReached, true);
  assert.equal(count(f, 'IO.read'), 384); assert.equal(count(f, 'IO.close'), 1);
  assert.equal(report.captureComplete, false); assert.equal(report.raw.eof, false);
});

for (const problem of ['loss', 'stream-failure', 'missing-stream']) test(`${problem} remains inconclusive and preserves cleanup`, async t => {
  let reads = 0;
  const f = await fixture(t, problem === 'stream-failure' ? { 'IO.read': async () => {
    if (reads++) throw new Error('stream failed'); return { data: '{', eof: false };
  } } : { 'Tracing.end': async (params, session) => {
    Promise.resolve().then(() => session.emit('Tracing.tracingComplete', { ...(problem === 'loss' ? { stream: 'stream-1' } : {}), dataLossOccurred: problem === 'loss' }));
    return {};
  } });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.captureComplete, false); assert.equal(count(f, 'detach'), 1);
  assert.equal(count(f, 'IO.close'), problem === 'missing-stream' ? 0 : 1);
  if (problem === 'stream-failure') assert.equal((await readFile(join(f.directory, report.raw.name))).toString(), '{');
});

test('missing completion has a bounded teardown, no fake zero trace, and session cleanup', async t => {
  const f = await fixture(t, { 'Tracing.end': async () => ({}) });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const finishing = f.controller.finish(f.testInfo); await flush();
  t.mock.timers.tick(18500); await flush(); t.mock.timers.reset();
  const report = await finishing;
  assert.equal(report.captureComplete, false); assert.equal(report.raw.bytes, null);
  assert.equal(count(f, 'detach'), 1); assert.equal(count(f, 'IO.read'), 0);
  assert.ok(report.errors.some(item => item.phase === 'completion'));
});

test('an end rejection or late marker rejection never escapes and all errors are clipped', async t => {
  const marker = deferred();
  const f = await fixture(t, { 'Tracing.recordClockSyncMarker': () => marker.promise,
    'Tracing.end': async () => { throw new Error('x'.repeat(1000)); } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const starting = f.controller.start(); await flush(); t.mock.timers.tick(250); await starting;
  f.controller.requestStop('wrapper-finished'); await flush(); t.mock.timers.tick(250); await flush();
  const finishing = f.controller.finish(f.testInfo); await flush(); t.mock.timers.tick(18500); await flush();
  t.mock.timers.reset();
  const report = await finishing;
  marker.reject(new Error('late marker failure')); await flush();
  assert.equal(count(f, 'Tracing.end'), 1); assert.equal(report.captureComplete, false);
  assert.ok(report.errors.length <= 8); assert.ok(report.errors.every(item => item.error.length <= 240));
  assert.equal(count(f, 'detach'), 1);
});

for (const failed of [false, true]) test(`boundary fixture drains after the original body ${failed ? 'fails' : 'passes'} and keeps its exact outcome`, async t => {
  const f = await fixture(t, {}, { enabled: false });
  const { boundaryNativeTimelineFixture, BOUNDARY_NATIVE_TRACE_TITLE } = await import(helperUrl.href);
  assert.equal(typeof boundaryNativeTimelineFixture, 'function');
  const prior = process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE;
  process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE = '1';
  t.after(() => { if (prior === undefined) delete process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE; else process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE = prior; });
  const body = deferred(), reachedBody = deferred(), original = failed ? new Error('original semantic assertion') : {};
  const browser = { newBrowserCDPSession: async () => f.session };
  const running = boundaryNativeTimelineFixture({ page: {}, browser, browserName: 'chromium', channel: undefined, headless: true, launchOptions: { args: ['--example'] } }, async controller => {
    await controller.start(); controller.requestStop('wrapper-finished'); reachedBody.resolve(); return body.promise;
  }, { ...f.testInfo, title: BOUNDARY_NATIVE_TRACE_TITLE }).then(value => ({ value }), error => ({ error }));
  await reachedBody.promise;
  assert.equal(count(f, 'IO.read'), 0);
  if (failed) body.reject(original); else body.resolve(original);
  const result = await running;
  if (failed) assert.equal(result.error, original);
  assert.equal(count(f, 'IO.read'), 1); assert.equal(count(f, 'detach'), 1);
  const report = JSON.parse(await readFile(join(f.directory, 'boundary-project-undo-native-timeline-manifest.json')));
  assert.equal(report.metadata.playwrightVersion, '1.62.1');
  assert.match(report.metadata.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(report.metadata.launchOptions, { args: ['--example'] });
});

test('opt-out fixture creates no native session and passes straight through the existing body', async t => {
  const { boundaryNativeTimelineFixture, BOUNDARY_NATIVE_TRACE_TITLE } = await import(helperUrl.href);
  assert.equal(typeof boundaryNativeTimelineFixture, 'function');
  const prior = process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE;
  delete process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE;
  t.after(() => { if (prior !== undefined) process.env.PANDOLAB_BOUNDARY_NATIVE_TRACE = prior; });
  let sessions = 0, calls = 0;
  await boundaryNativeTimelineFixture({ page: {}, browser: { newBrowserCDPSession() { sessions++; } } }, async value => {
    assert.equal(value, null); calls++;
  }, { title: BOUNDARY_NATIVE_TRACE_TITLE });
  assert.equal(sessions, 0); assert.equal(calls, 1);
});

test('teardown retains an acknowledged end marker before publishing its host alignment interval', async t => {
  let now = 1000;
  const endMarker = deferred(), reachedEndMarker = deferred();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(t, { 'Tracing.recordClockSyncMarker': params => {
    if (params.syncId.endsWith('-end')) { reachedEndMarker.resolve(); return endMarker.promise; }
    return {};
  } }, { now: () => now });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  await reachedEndMarker.promise;
  let settled = false;
  const finishing = f.controller.finish(f.testInfo).then(report => { settled = true; return report; });
  await flush();
  assert.equal(settled, false, 'completion cannot discard a pending bounded clock calibration');
  assert.equal(count(f, 'IO.read'), 0, 'draining waits for the end marker acknowledgment');
  // Advance the measured clock and deadline timers without relying on host scheduling.
  now += 40; t.mock.timers.tick(40); await flush();
  assert.equal(settled, false, 'completion cannot discard a pending bounded clock calibration');
  assert.equal(count(f, 'IO.read'), 0);
  endMarker.resolve({});
  const report = await finishing;
  t.mock.timers.reset();
  assert.equal(report.captureComplete, true); assert.equal(report.stages.endMarker.status, 'fulfilled');
  assert.equal(report.stages.endMarker.requestedAtMs, 1000);
  assert.equal(report.stages.endMarker.acknowledgedAtMs, 1040);
  assert.equal(report.stages.endMarker.settledAtMs, 1040);
  assert.equal(report.stages.endMarker.deadlineExceededAtMs, null);
  assert.equal(report.stages.endMarker.roundTripMs, 40);
  const manifest = JSON.parse(await readFile(join(f.directory, 'boundary-project-undo-native-timeline-manifest.json')));
  assert.deepEqual(manifest.stages.endMarker, report.stages.endMarker);
});

test('a missing loss flag is unknown rather than proof of a complete trace', async t => {
  const f = await fixture(t, { 'Tracing.end': async (params, session) => {
    Promise.resolve().then(() => session.emit('Tracing.tracingComplete', { stream: 'stream-1' })); return {};
  } });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.completion.dataLossOccurred, null); assert.equal(report.captureComplete, false);
});

test('a preflight-expired late session is detached without issuing version, categories or tracing commands', async t => {
  const f = await fixture(t, {}, { enabled: false });
  const { createBoundaryNativeTimeline } = await import(helperUrl.href);
  const session = deferred();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const creating = createBoundaryNativeTimeline({ newBrowserCDPSession: () => session.promise }, { enabled: true, write: () => {} });
  await flush(); t.mock.timers.tick(2000);
  const controller = await creating;
  await controller.start();
  t.mock.timers.reset();
  const report = await controller.finish(f.testInfo);
  session.resolve(f.session); await flush();
  assert.equal(report.preflight.status, 'unavailable'); assert.equal(report.captureComplete, false);
  assert.deepEqual(f.calls.map(call => call.method), ['detach']);
});

test('an owned stream read expiry closes and detaches, handles late rejection, and keeps the saved prefix', async t => {
  const read = deferred(), requested = deferred();
  let reads = 0;
  const f = await fixture(t, { 'IO.read': () => {
    if (!reads++) return { data: 'first', eof: false };
    requested.resolve(); return read.promise;
  } });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const finishing = f.controller.finish(f.testInfo);
  await requested.promise; t.mock.timers.tick(18500); await flush(); t.mock.timers.reset();
  const report = await finishing;
  read.reject(new Error('late stream failure')); await flush();
  assert.equal(report.captureComplete, false); assert.equal(report.raw.eof, false);
  const saved = await readFile(join(f.directory, report.raw.name));
  assert.equal(saved.toString(), 'first'); assert.equal(report.raw.bytes, saved.length);
  assert.equal(report.raw.sha256, createHash('sha256').update(saved).digest('hex'));
  assert.equal(count(f, 'IO.close'), 1); assert.equal(count(f, 'detach'), 1);
  assert.equal(report.stages.read.status, 'pending-after-deadline');
});

test('oversized CDP chunks cannot bypass the 64 KiB read bound', async t => {
  const f = await fixture(t, { 'IO.read': async () => ({ data: 'x'.repeat(64 * 1024 + 1), eof: true }) });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.captureComplete, false); assert.equal(report.raw.bytes, 0);
  assert.ok(report.errors.some(item => /64 KiB/.test(item.error)));
  assert.equal(count(f, 'IO.close'), 1); assert.equal(count(f, 'detach'), 1);
});

test('late successful start after teardown still attempts one owned end and closes a late stream', async t => {
  const start = deferred();
  const f = await fixture(t, { 'Tracing.start': () => start.promise });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const starting = f.controller.start(); await flush(); t.mock.timers.tick(2000); await starting;
  const finishing = f.controller.finish(f.testInfo); await flush(); t.mock.timers.tick(18500); await flush(); t.mock.timers.reset();
  const report = await finishing;
  const saved = await readFile(join(f.directory, 'boundary-project-undo-native-timeline-manifest.json'));
  start.resolve({}); await flush();
  assert.equal(report.ownership, 'start-pending'); assert.equal(report.captureComplete, false);
  assert.equal(count(f, 'Tracing.end'), 1); assert.equal(count(f, 'IO.close'), 1); assert.equal(count(f, 'detach'), 1);
  assert.deepEqual(await readFile(join(f.directory, 'boundary-project-undo-native-timeline-manifest.json')), saved);
});


test('a late end acknowledgment retains its actual host time and overrun', async t => {
  let now = 0;
  const end = deferred();
  const f = await fixture(t, { 'Tracing.end': () => end.promise }, { now: () => now });
  await f.controller.start();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.controller.requestStop('wrapper-finished'); await flush();
  t.mock.timers.tick(2000); await flush();
  now = 47000; end.resolve({}); await flush();
  f.session.emit('Tracing.tracingComplete', { stream: 'stream-1', dataLossOccurred: false });
  t.mock.timers.reset();
  const report = await f.controller.finish(f.testInfo);
  assert.equal(report.stages.end.status, 'fulfilled-after-deadline');
  assert.equal(report.host.stopAcknowledgedAtMs, 47000);
  assert.equal(report.host.stopAcknowledgementOverrunMs, 2000);
  assert.equal(report.captureComplete, false);
});

test('a late manifest write cannot publish or leave a partial file after its deadline', async t => {
  const f = await fixture(t);
  const nativeWrite = fs.writeFile, late = deferred(), requested = deferred();
  t.mock.method(fs, 'writeFile', (path, body, options) => {
    if (path.includes('native-timeline-manifest')) {
      requested.resolve(); return late.promise.then(() => nativeWrite(path, body, { ...options, signal: undefined }));
    }
    return nativeWrite(path, body, options);
  });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const finishing = f.controller.finish(f.testInfo);
  await requested.promise; t.mock.timers.tick(1000); await flush(); t.mock.timers.reset();
  const report = await finishing;
  assert.equal(report.raw.eof, true);
  assert.equal(existsSync(join(f.directory, 'boundary-project-undo-native-timeline-manifest.json')), false);
  late.resolve(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(await readdir(f.directory), ['boundary-project-undo-native-timeline.json']);
  assert.ok(f.lines.some(line => line.includes('outputError')));
});

test('close and detach waits each have a 250 ms bound and cannot hold the fixture outcome', async t => {
  const closing = deferred(), detaching = deferred(), requested = deferred();
  const f = await fixture(t, { 'IO.close': () => { requested.resolve(); return closing.promise; }, detach: () => detaching.promise });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const finishing = f.controller.finish(f.testInfo);
  await requested.promise; t.mock.timers.tick(250); await flush(); t.mock.timers.tick(250); await flush(); t.mock.timers.reset();
  const report = await finishing;
  assert.equal(report.captureComplete, false);
  assert.equal(report.stages.close.status, 'pending-after-deadline'); assert.equal(report.stages.detach.status, 'pending-after-deadline');
  closing.reject(new Error('late close')); detaching.reject(new Error('late detach')); await flush();
  assert.equal(count(f, 'IO.close'), 1); assert.equal(count(f, 'detach'), 1);
});

test('an append settling after drain expiry during IO.close cannot publish unaccounted raw bytes', async t => {
  const append = deferred(), appendRequested = deferred(), appendSettled = deferred();
  const close = deferred(), closeRequested = deferred();
  let reads = 0, appends = 0;
  const f = await fixture(t, {
    'IO.read': async () => ({ data: reads++ ? 'second' : 'first', eof: false }),
    'IO.close': () => { closeRequested.resolve(); return close.promise; },
  });
  const nativeAppend = fs.appendFile, nativeRemove = fs.rm, queuedRemovals = [];
  t.mock.method(fs, 'appendFile', (path, body, options) => {
    if (++appends !== 2) return nativeAppend(path, body, options);
    appendRequested.resolve();
    return append.promise.then(async () => {
      // Model a write that succeeds despite best-effort AbortSignal cleanup.
      await nativeAppend(path, body, { ...options, signal: undefined });
      appendSettled.resolve();
    });
  });
  t.mock.method(fs, 'rm', (path, options) => {
    if (!path.includes('native-timeline.json.partial-')) return nativeRemove(path, options);
    // Do not let asynchronous removal accidentally hide an unsafe rename.
    queuedRemovals.push({ path, options }); return Promise.resolve();
  });
  await f.controller.start(); f.controller.requestStop('wrapper-finished');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const finishing = f.controller.finish(f.testInfo);
  await appendRequested.promise; t.mock.timers.tick(18500); await closeRequested.promise;
  append.resolve(); await appendSettled.promise; await flush();
  close.resolve({}); await flush(); t.mock.timers.reset();
  const report = await finishing;
  if (report.raw.name) {
    const saved = await readFile(join(f.directory, report.raw.name));
    assert.equal(saved.length, report.raw.bytes, 'every published raw file must match its manifest byte count');
    assert.equal(createHash('sha256').update(saved).digest('hex'), report.raw.sha256);
  }
  assert.equal(report.status, 'unavailable'); assert.equal(report.captureComplete, false);
  assert.equal(report.raw.name, null); assert.equal(report.raw.bytes, null); assert.equal(report.raw.sha256, null);
  assert.equal(existsSync(join(f.directory, 'boundary-project-undo-native-timeline.json')), false);
  assert.ok(report.errors.some(item => item.phase === 'raw-output' && /abandoned/.test(item.error)));
  assert.ok(queuedRemovals.length >= 2, 'staging cleanup repeats after the late write settlement');
  await Promise.all(queuedRemovals.map(({ path, options }) => nativeRemove(path, options)));
  assert.deepEqual(await readdir(f.directory), ['boundary-project-undo-native-timeline-manifest.json']);
});
