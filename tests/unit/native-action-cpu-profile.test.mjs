import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs, { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { withNativeActionDiagnostics } from '../browser/helpers/native-action-diagnostics.mjs';

const directories = [];
after(async () => { await Promise.all(directories.map(path => rm(path, { recursive: true, force: true }))); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const load = () => import('../browser/helpers/native-action-cpu-profile.mjs');
function profile() {
  const names = ['(root)', 'undoProject', 'snapshotInjected', '(program)', '(idle)', '(garbage collector)'];
  return { startTime: 9000000, endTime: 9012000,
    nodes: names.map((functionName, i) => ({ id: i + 1, callFrame: { functionName, scriptId: String(i),
      url: i === 1 ? 'http://localhost/assets/app.js' : i === 2 ? 'playwright://injected.js' : '', lineNumber: i, columnNumber: 3 },
    ...(i === 0 ? { children: [2, 3, 4, 5, 6] } : {}) })),
    samples: [2, 3, 4, 5, 6, 2], timeDeltas: [1000, 2000, 3000, 1000, 1000, 2000] };
}
async function fixture(send = async method => method === 'Profiler.stop' ? { profile: profile() } : {}) {
  const directory = await mkdtemp(join(tmpdir(), 'native-cpu-profile-')); directories.push(directory);
  const calls = [], attachments = [], lines = [];
  const session = { send(method, params) { calls.push([method, params]); return send(method, params); },
    async detach() { calls.push(['detach']); } };
  const page = { context: () => ({ newCDPSession: async () => { calls.push(['newCDPSession']); return session; } }),
    evaluate: async () => ({ installed: true }) };
  return { page, session, calls, attachments, lines,
    options: { label: 'boundary-project-undo', selector: '#undoBtn', cpuProfile: true, write: line => lines.push(line) },
    testInfo: { outputPath: name => join(directory, name), attach: async (name, value) => attachments.push({ name, ...value }) } };
}
const cpuSummary = async f => JSON.parse(await readFile(f.testInfo.outputPath('boundary-project-undo-cpu-summary.json'), 'utf8'));

test('CPU collection is opt-in and disabled diagnostics never create a CDP session', async () => {
  const f = await fixture(); let attempts = 0;
  assert.equal(await withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, cpuProfile: false }, () => { attempts++; return 42; }), 42);
  assert.equal(attempts, 1); assert.equal(f.calls.length, 0);
  assert.equal(f.attachments.length, 1);
});

test('opt-in profiling invokes the unchanged action once, outside setup, preserving identity and host timing', async () => {
  let now = 0;
  const f = await fixture(async method => { now += 50; return method === 'Profiler.stop' ? { profile: profile() } : {}; });
  let attempts = 0; const result = {};
  assert.equal(await withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, now: () => now }, () => {
    attempts++; assert.deepEqual(f.calls.map(call => call[0]), ['newCDPSession', 'Profiler.enable', 'Profiler.setSamplingInterval', 'Profiler.start']);
    now += 800; return result;
  }), result);
  assert.equal(attempts, 1);
  assert.deepEqual(f.calls.find(call => call[0] === 'Profiler.setSamplingInterval')[1], { interval: 2000 });
  const native = JSON.parse(await readFile(f.testInfo.outputPath('boundary-project-undo-native-action.json'), 'utf8'));
  assert.deepEqual(native.host, { startedAtMs: 150, endedAtMs: 950, durationMs: 800, outcome: 'fulfilled' });
  const summary = await cpuSummary(f);
  assert.equal(summary.host.action.durationMs, 800);
  assert.equal(summary.stopReason, 'action-settled');
  assert.equal(summary.samplingIntervalUs, 2000);
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.stop').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.disable').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
});

test('original synchronous and asynchronous action errors retain object identity through profile collection', async () => {
  for (const asynchronous of [false, true]) {
    const f = await fixture(); const original = new Error('original locator timeout'); let attempts = 0;
    await assert.rejects(withNativeActionDiagnostics(f.page, f.testInfo, f.options, () => {
      attempts++; if (asynchronous) return Promise.reject(original); throw original;
    }), error => error === original);
    assert.equal(attempts, 1); assert.equal((await cpuSummary(f)).host.action.outcome, 'rejected');
  }
});

test('unsupported CDP and rejected setup do not prevent or retry the original action', async () => {
  for (const stage of ['newCDPSession', 'Profiler.enable', 'Profiler.setSamplingInterval', 'Profiler.start']) {
    const f = await fixture(async method => { if (method === stage) throw new Error(`unsupported ${stage}`); return {}; });
    if (stage === 'newCDPSession') f.page.context = () => ({ newCDPSession: () => { throw new Error('CDP unsupported'); } });
    let attempts = 0;
    assert.equal(await withNativeActionDiagnostics(f.page, f.testInfo, f.options, () => { attempts++; return 42; }), 42);
    assert.equal(attempts, 1); const summary = await cpuSummary(f);
    assert.equal(summary.status, 'unavailable'); assert.ok(summary.errors.length);
    if (stage !== 'newCDPSession') assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
  }
});

test('setup waits at most 250 ms and a late session is cleaned without ever starting sampling', async t => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture(); const pending = deferred();
  f.page.context = () => ({ newCDPSession: () => pending.promise });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const begun = startNativeActionCpuProfile(f.page, f.options); await flush();
  t.mock.timers.tick(250); await flush(); const capture = await begun;
  capture.stop('action-settled', { durationMs: 0 });
  pending.resolve(f.session); await flush();
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.start').length, 0);
  assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
});

test('late start acknowledgement after setup expiry cannot leave an active profiler or duplicate stop', async t => {
  const { startNativeActionCpuProfile } = await load(); const pending = deferred();
  const f = await fixture(async method => method === 'Profiler.start' ? pending.promise : method === 'Profiler.stop' ? { profile: profile() } : {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const begun = startNativeActionCpuProfile(f.page, f.options); await flush(); t.mock.timers.tick(250); await flush();
  const capture = await begun; capture.stop('action-settled'); pending.resolve({}); await flush();
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.stop').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.disable').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
});

test('20 s watchdog stops sampling but never settles, cancels, or retries a pending native action', async t => {
  const f = await fixture(); const action = deferred(); let attempts = 0, settled = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = withNativeActionDiagnostics(f.page, f.testInfo, f.options, () => { attempts++; return action.promise; });
  result.then(() => { settled = true; }); await flush();
  t.mock.timers.tick(19999); await flush(); assert.equal(f.calls.some(([method]) => method === 'Profiler.stop'), false);
  t.mock.timers.tick(1); await flush(); assert.equal(settled, false); assert.equal(attempts, 1);
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.stop').length, 1);
  action.resolve(42); t.mock.timers.reset(); assert.equal(await result, 42);
  assert.equal((await cpuSummary(f)).stopReason, 'watchdog');
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.stop').length, 1);
});

test('action settlement racing the watchdog and repeated stop calls share one stop and cleanup', async t => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const capture = await startNativeActionCpuProfile(f.page, f.options);
  t.mock.timers.tick(20000); capture.stop('action-settled'); capture.stop('action-settled'); await flush();
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.stop').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
});

test('stop timeout still disables and detaches; late stop rejection is handled', async t => {
  const { startNativeActionCpuProfile } = await load(); const pending = deferred();
  const f = await fixture(async method => method === 'Profiler.stop' ? pending.promise : {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const capture = await startNativeActionCpuProfile(f.page, f.options); capture.stop('action-settled'); await flush();
  t.mock.timers.tick(250); await flush();
  assert.equal(f.calls.filter(([method]) => method === 'Profiler.disable').length, 1);
  assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
  pending.reject(new Error('late page close')); await flush();
});

test('never-settling disable and detach each have bounded independent cleanup budgets', async t => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture(async method => method === 'Profiler.disable' ? new Promise(() => {}) : method === 'Profiler.stop' ? { profile: profile() } : {});
  f.session.detach = () => { f.calls.push(['detach']); return new Promise(() => {}); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const capture = await startNativeActionCpuProfile(f.page, f.options); const stopped = capture.stop('action-settled'); await flush();
  t.mock.timers.tick(250); await flush(); assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
  t.mock.timers.tick(250); await flush(); await stopped;
});

test('stop, output path, file write, attachment, and diagnostic logger failures preserve the native error', async () => {
  for (const failure of ['stop', 'path', 'file', 'attach', 'log']) {
    const f = await fixture(async method => { if (method === 'Profiler.stop' && failure === 'stop') throw new Error('stop failed'); return method === 'Profiler.stop' ? { profile: profile() } : {}; });
    if (failure === 'path') f.testInfo.outputPath = () => { throw new Error('closed output'); };
    if (failure === 'file') { const directory = f.testInfo.outputPath(''); f.testInfo.outputPath = () => directory; }
    if (failure === 'attach') f.testInfo.attach = () => { throw new Error('closed reporter'); };
    if (failure === 'log') f.options.write = () => Promise.reject(new Error('closed logger'));
    const original = new Error('native failure'); let attempts = 0;
    await assert.rejects(withNativeActionDiagnostics(f.page, f.testInfo, f.options, () => { attempts++; throw original; }), error => error === original);
    assert.equal(attempts, 1); assert.equal(f.calls.filter(([method]) => method === 'detach').length, 1);
  }
});

test('full profile retains raw nodes, samples, timeDeltas and every app, injected, native, idle and GC frame', async () => {
  const { encodeCpuProfile } = await load(); const original = profile(); const saved = structuredClone(original);
  const encoded = await encodeCpuProfile(original);
  assert.deepEqual(JSON.parse(gunzipSync(encoded.gzip).toString()), saved);
  assert.deepEqual(original, saved); assert.equal(encoded.summary.incomplete, false);
  assert.equal(encoded.summary.original.sampleCount, 6); assert.equal(encoded.summary.retained.sampleCount, 6);
  assert.equal(encoded.summary.original.durationUs, 12000);
  assert.equal(encoded.summary.retained.sampledDurationUs, 10000);
  const functions = encoded.summary.topSelf.map(item => item.callFrame.functionName);
  for (const name of ['undoProject', 'snapshotInjected', '(program)', '(idle)', '(garbage collector)']) assert.ok(functions.includes(name));
  assert.equal(encoded.summary.topSelf.find(item => item.callFrame.functionName === 'undoProject').selfTimeUs, 3000);
  assert.equal(encoded.summary.topInclusive[0].inclusiveTimeUs, 10000);
  assert.ok(encoded.summary.topSelf.every(item => Array.isArray(item.stack)));
});

test('2 MiB raw cap retains a chronological prefix with complete ancestor paths and exact counts', async () => {
  const { encodeCpuProfile } = await load(); const original = profile();
  original.nodes[0].children = [];
  original.nodes = [original.nodes[0]];
  for (let i = 0; i < 2200; i++) {
    const id = i + 2; original.nodes[0].children.push(id);
    original.nodes.push({ id, callFrame: { functionName: `fn${i}`, scriptId: '1', url: 'x'.repeat(1500), lineNumber: i, columnNumber: 0 } });
  }
  original.samples = original.nodes.slice(1).map(node => node.id); original.timeDeltas = original.samples.map(() => 2000);
  original.endTime = original.startTime + original.samples.length * 2000;
  const encoded = await encodeCpuProfile(original); const body = gunzipSync(encoded.gzip); const retained = JSON.parse(body);
  assert.ok(body.byteLength <= 2 * 1024 * 1024); assert.ok(encoded.gzip.byteLength <= 1024 * 1024);
  assert.ok(encoded.summary.incomplete); assert.ok(retained.samples.length > 0 && retained.samples.length < original.samples.length);
  assert.deepEqual(retained.samples, original.samples.slice(0, retained.samples.length));
  assert.deepEqual(retained.timeDeltas, original.timeDeltas.slice(0, retained.samples.length));
  const ids = new Set(retained.nodes.map(node => node.id));
  for (const node of retained.nodes) for (const child of node.children || []) assert.ok(ids.has(child));
  for (const sample of retained.samples) assert.ok(ids.has(sample));
  assert.deepEqual(retained.nodes[0].children, retained.samples);
  assert.equal(encoded.summary.original.nodeCount, original.nodes.length);
  assert.equal(encoded.summary.retained.nodeCount, retained.nodes.length);
  assert.equal(encoded.summary.retained.sampleCount, retained.samples.length);
  assert.ok(Buffer.byteLength(JSON.stringify(encoded.summary)) <= 32 * 1024);
});

test('1 MiB gzip cap is independently enforced on poorly compressing node strings', async () => {
  const { encodeCpuProfile } = await load(); const original = profile();
  original.nodes[0].children = []; original.nodes = [original.nodes[0]];
  for (let i = 0; i < 850; i++) {
    const id = i + 2; original.nodes[0].children.push(id);
    original.nodes.push({ id, callFrame: { functionName: randomBytes(650).toString('base64'), scriptId: '1', url: randomBytes(650).toString('base64'), lineNumber: i, columnNumber: 0 } });
  }
  original.samples = original.nodes.slice(1).map(node => node.id); original.timeDeltas = original.samples.map(() => 2000);
  const encoded = await encodeCpuProfile(original);
  assert.ok(encoded.summary.incomplete); assert.ok(encoded.gzip.byteLength <= 1024 * 1024);
  assert.ok(encoded.summary.original.rawBytes < 2 * 1024 * 1024);
  assert.ok(encoded.summary.retained.sampleCount < original.samples.length);
});

test('invalid sample references or delta alignment are reported instead of emitting a corrupt profile', async () => {
  const { encodeCpuProfile } = await load();
  for (const mutate of [p => p.samples.push(999), p => p.samples[0] = 999, p => p.timeDeltas[0] = -1, p => p.nodes[0].children.push(999)]) {
    const value = profile(); mutate(value);
    await assert.rejects(encodeCpuProfile(value), /profile/i);
  }
});

test('CPU output deadline aborts a stalled write and prevents any attachment after late completion', { timeout: 1500 }, async t => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture(); const pending = deferred(); let signal;
  t.mock.method(fs, 'writeFile', (path, data, options) => { signal = options.signal; return pending.promise; });
  const capture = await startNativeActionCpuProfile(f.page, f.options); await capture.stop('action-settled');
  const started = performance.now(); await capture.finish(f.testInfo);
  assert.ok(performance.now() - started < 1000); assert.equal(signal.aborted, true); assert.equal(f.attachments.length, 0);
  pending.resolve(); await flush(); assert.equal(f.attachments.length, 0);
});

test('CPU attachment deadline prevents another attachment after late settlement while preserving both files', { timeout: 1500 }, async () => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture(); const pending = deferred(); let attachments = 0;
  f.testInfo.attach = () => { attachments++; return pending.promise; };
  const capture = await startNativeActionCpuProfile(f.page, f.options); await capture.stop('action-settled');
  await capture.finish(f.testInfo); assert.equal(attachments, 1);
  pending.reject(new Error('late reporter close')); await flush(); assert.equal(attachments, 1);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(f.testInfo.outputPath('boundary-project-undo-cpu-profile.cpuprofile.gz')))), profile());
});

test('summary separates host/profile clocks and reports delayed stop and per-second sample distribution', async () => {
  let now = 300; const input = profile(); input.endTime = input.startTime + 22_000_000;
  input.timeDeltas = [1_000_000, 2_000_000, 3_000_000, 1_000_000, 1_000_000, 2_000_000];
  const f = await fixture(async method => { if (method === 'Profiler.stop') { now = 24000; return { profile: input }; } return {}; });
  await withNativeActionDiagnostics(f.page, f.testInfo, { ...f.options, now: () => now }, () => { now = 22000; return 42; });
  const summary = await cpuSummary(f);
  assert.equal(summary.host.stopRequestOverrunMs, 1700);
  assert.equal(summary.host.stopAcknowledgementOverrunMs, 3700);
  assert.equal(summary.host.stopRoundTripMs, 2000);
  assert.equal(summary.profileWindowOverrunUs, 2_000_000);
  assert.equal(summary.original.startTimeUs, 9000000);
  assert.ok(summary.clocks.profile.includes('separate origin'));
  assert.equal(summary.timingDistribution.reduce((sum, bucket) => sum + bucket.sampleCount, 0), input.samples.length);
  assert.equal(summary.timingDistribution.reduce((sum, bucket) => sum + bucket.sampledDurationUs, 0), 10_000_000);
});

test('zero retained samples preserve a root node and too-large single-root data fails explicitly', async () => {
  const { encodeCpuProfile } = await load(); const input = profile();
  input.nodes[1].callFrame.url = 'x'.repeat(3 * 1024 * 1024);
  const encoded = await encodeCpuProfile(input); const raw = JSON.parse(gunzipSync(encoded.gzip));
  assert.equal(raw.samples.length, 0); assert.equal(raw.nodes.length, 1); assert.equal(raw.nodes[0].id, 1);
  assert.deepEqual(raw.nodes[0].children, []);
  input.nodes[0].callFrame.url = 'x'.repeat(3 * 1024 * 1024);
  await assert.rejects(encodeCpuProfile(input), /budget/i);
});

test('both evidence files survive a reporter rejection after profile collection', async () => {
  const f = await fixture(); f.testInfo.attach = () => { throw new Error('closed reporter'); };
  assert.equal(await withNativeActionDiagnostics(f.page, f.testInfo, f.options, () => 42), 42);
  const raw = await readFile(f.testInfo.outputPath('boundary-project-undo-cpu-profile.cpuprofile.gz'));
  assert.deepEqual(JSON.parse(gunzipSync(raw)), profile());
  assert.equal((await cpuSummary(f)).status, 'captured');
});

test('physical partial gzip writes never leave final-named evidence or publish after a deadline', { timeout: 1500 }, async t => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture(); const pending = deferred();
  const originalWrite = fs.writeFile; let partialPath;
  t.mock.method(fs, 'writeFile', async (path, body, options) => {
    if (Buffer.isBuffer(body)) {
      partialPath = path; await originalWrite(path, body.subarray(0, 10), options); return pending.promise;
    }
    return originalWrite(path, body, options);
  });
  const capture = await startNativeActionCpuProfile(f.page, f.options); await capture.stop('action-settled');
  const summary = await capture.finish(f.testInfo);
  assert.equal(summary.output.status, 'unpublished');
  assert.equal(summary.output.profile, 'unpublished');
  const finalPath = f.testInfo.outputPath('boundary-project-undo-cpu-profile.cpuprofile.gz');
  await assert.rejects(readFile(finalPath), /ENOENT/);
  await assert.rejects(readFile(f.testInfo.outputPath('boundary-project-undo-cpu-summary.json')), /ENOENT/);
  assert.equal(f.attachments.length, 0);
  pending.resolve(); await flush();
  await assert.rejects(readFile(finalPath), /ENOENT/);
  assert.notEqual(partialPath, finalPath);
});


test('failure publishing the summary explicitly reports the already published complete raw file', async () => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture();
  const summaryPath = f.testInfo.outputPath('boundary-project-undo-cpu-summary.json');
  await fs.mkdir(summaryPath);
  const capture = await startNativeActionCpuProfile(f.page, f.options); await capture.stop('action-settled');
  const summary = await capture.finish(f.testInfo);
  assert.equal(summary.output.status, 'partial'); assert.equal(summary.output.profile, 'published');
  assert.equal(summary.output.summary, 'unpublished'); assert.ok(summary.output.error);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(f.testInfo.outputPath('boundary-project-undo-cpu-profile.cpuprofile.gz')))), profile());
  assert.equal(f.attachments.length, 0);
});

test('publication checks elapsed time even before the host timeout callback gets a chance to run', { timeout: 1500 }, async t => {
  const { startNativeActionCpuProfile } = await load(); const f = await fixture(); const originalWrite = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (path, body, options) => {
    await originalWrite(path, body, options);
    if (!Buffer.isBuffer(body)) { const deadline = performance.now() + 270; while (performance.now() < deadline) { /* Model a delayed host turn. */ } }
  });
  const capture = await startNativeActionCpuProfile(f.page, f.options); await capture.stop('action-settled');
  const summary = await capture.finish(f.testInfo);
  assert.equal(summary.output.status, 'unpublished'); assert.equal(f.attachments.length, 0);
  await assert.rejects(readFile(f.testInfo.outputPath('boundary-project-undo-cpu-profile.cpuprofile.gz')), /ENOENT/);
});
