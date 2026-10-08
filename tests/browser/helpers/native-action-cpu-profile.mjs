import fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { withDiagnosticDeadline } from './map-diagnostics.mjs';

const compress = promisify(gzip);
const DEADLINE_MS = 250;
// Profiler commands can wait behind the observed ~9 s renderer tasks. These
// CPU-only budgets never change the original native action timeout or timer.
const SETUP_DEADLINE_MS = 15_000;
const STOP_DEADLINE_MS = 15_000;
const WATCHDOG_MS = 20_000;
const ENCODE_MS = 1000;
const RAW_BYTES = 2 * 1024 * 1024;
const GZIP_BYTES = 1024 * 1024;
const SUMMARY_BYTES = 32 * 1024;
const LIMITS = { setupMs: SETUP_DEADLINE_MS, stopMs: STOP_DEADLINE_MS, disableMs: DEADLINE_MS, detachMs: DEADLINE_MS,
  encodeMs: ENCODE_MS, outputMs: DEADLINE_MS, watchdogMs: WATCHDOG_MS, rawBytes: RAW_BYTES, gzipBytes: GZIP_BYTES, summaryBytes: SUMMARY_BYTES };
const clipped = value => String(value).slice(0, 240);
let nextOutput = 0;

// Dedicated CDP Profiler only: no tracing, page evaluation, action racing or
// application hooks. All waits here bound diagnostics, never the native action.
export async function startNativeActionCpuProfile(page, { label, now = () => performance.now(), write = console.log }) {
  const report = { label, status: 'unavailable', stopReason: null, samplingIntervalUs: 2000, limits: LIMITS,
    watchdogOrigin: 'Profiler.start request, not acknowledgement; start latency consumes the 20 s window. A delayed stop acknowledgement may overrun it.',
    setupExpiredStage: null,
    cdpStages: Object.fromEntries(['session', 'enable', 'samplingInterval', 'start', 'stop', 'disable', 'detach'].map(name => [name, {
      requestedAtMs: null, acknowledgedAtMs: null, settledAtMs: null, durationMs: null, deadlineExceededAtMs: null, status: 'not-requested',
    }])),
    coverage: 'Renderer main-thread V8 samples, including app, injected, native, idle and GC frames; no worker, GPU or other-process CPU coverage.',
    caveat: 'Sampling adds overhead. This diagnostic experiment is not a latency fix or benchmark. Empty or partial samples cannot rule out blocking.',
    clocks: { host: 'host performance.now() milliseconds', profile: 'CDP monotonic microseconds; separate origin from host and browser performance.now()' },
    host: { setupStartedAtMs: now(), setupEndedAtMs: null, startRequestedAtMs: null, startAcknowledgedAtMs: null,
      stopRequestedAtMs: null, stopAcknowledgedAtMs: null, watchdogDueAtMs: null, stopRequestOverrunMs: null,
      stopAcknowledgementOverrunMs: null, stopRoundTripMs: null, action: null }, errors: [] };
  let session, setupAbandoned = false, startIssued = false, watchdog, stopPromise, cleanupPromise, rawProfile;
  const record = (phase, error) => { if (report.errors.length < 8) report.errors.push({ phase, error: clipped(error) }); };
  const stage = async (name, operation, requestedAtMs = now()) => {
    const entry = report.cdpStages[name];
    entry.requestedAtMs = requestedAtMs; entry.status = 'pending';
    try {
      const value = await operation();
      entry.acknowledgedAtMs = now();
      entry.status = entry.deadlineExceededAtMs === null ? 'fulfilled' : 'fulfilled-after-deadline';
      return value;
    } catch (error) {
      entry.status = entry.deadlineExceededAtMs === null ? 'rejected' : 'rejected-after-deadline';
      throw error;
    } finally {
      entry.settledAtMs = now(); entry.durationMs = entry.settledAtMs - entry.requestedAtMs;
    }
  };
  const expireStage = name => {
    const entry = report.cdpStages[name];
    if (entry.status !== 'pending') return;
    entry.deadlineExceededAtMs = now(); entry.status = 'pending-after-deadline';
  };
  const log = (tag, value) => {
    try { Promise.resolve(write(`[${tag}] ${JSON.stringify(value)}`)).catch(() => {}); } catch (_) { /* Diagnostic only. */ }
  };
  const cleanup = () => {
    if (!session) return Promise.resolve();
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try { await withDiagnosticDeadline(() => stage('disable', () => session.send('Profiler.disable')), DEADLINE_MS); }
      catch (error) { expireStage('disable'); record('disable', error); }
      try { await withDiagnosticDeadline(() => stage('detach', () => session.detach()), DEADLINE_MS); }
      catch (error) { expireStage('detach'); record('detach', error); }
    })();
    return cleanupPromise;
  };
  const stop = (reason, action) => {
    if (action) report.host.action = { ...action };
    if (stopPromise) return stopPromise;
    report.stopReason = reason;
    clearTimeout(watchdog);
    report.host.stopRequestedAtMs = now();
    if (report.host.watchdogDueAtMs !== null) report.host.stopRequestOverrunMs = Math.max(0, now() - report.host.watchdogDueAtMs);
    stopPromise = (async () => {
      if (session && startIssued) {
        try {
          const result = await withDiagnosticDeadline(() => stage('stop', () => session.send('Profiler.stop')), STOP_DEADLINE_MS);
          report.host.stopAcknowledgedAtMs = now();
          report.host.stopRoundTripMs = report.host.stopAcknowledgedAtMs - report.host.stopRequestedAtMs;
          report.host.stopAcknowledgementOverrunMs = Math.max(0, now() - report.host.watchdogDueAtMs);
          rawProfile = result.profile;
          if (rawProfile) report.status = setupAbandoned ? 'partial' : 'captured';
          else record('stop', 'CPU profile missing');
        } catch (error) { expireStage('stop'); record('stop', error); }
      }
      await cleanup();
    })();
    return stopPromise;
  };
  try {
    await withDiagnosticDeadline(async () => {
      session = await stage('session', () => page.context().newCDPSession(page));
      if (setupAbandoned) { await cleanup(); return; }
      await stage('enable', () => session.send('Profiler.enable'));
      if (setupAbandoned) { await cleanup(); return; }
      await stage('samplingInterval', () => session.send('Profiler.setSamplingInterval', { interval: 2000 }));
      if (setupAbandoned) { await cleanup(); return; }
      startIssued = true;
      report.host.startRequestedAtMs = now();
      report.host.watchdogDueAtMs = report.host.startRequestedAtMs + WATCHDOG_MS;
      watchdog = setTimeout(() => { stop('watchdog').catch(error => record('watchdog', error)); }, WATCHDOG_MS);
      await stage('start', () => session.send('Profiler.start'), report.host.startRequestedAtMs);
      report.host.startAcknowledgedAtMs = now();
      // A stop is queued even while start is pending; CDP orders these commands.
      // No continuation after the setup deadline can start another profiler.
      if (setupAbandoned) await stop('setup-expired');
    }, SETUP_DEADLINE_MS);
  } catch (error) {
    setupAbandoned = true;
    const pending = ['session', 'enable', 'samplingInterval', 'start'].find(name => report.cdpStages[name].status === 'pending');
    if (pending) { report.setupExpiredStage = pending; expireStage(pending); }
    record('setup', error);
    stop('setup-failed').catch(error => record('cleanup', error));
  }
  report.host.setupEndedAtMs = now();
  let finishPromise;
  return { stop, finish(testInfo) {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      await stopPromise;
      let encoded;
      const encoding = new AbortController();
      try { if (rawProfile) encoded = await withDiagnosticDeadline(() => encodeCpuProfile(rawProfile, { signal: encoding.signal }), ENCODE_MS); }
      catch (error) { report.status = 'unavailable'; record('encode', error); }
      finally { encoding.abort(); rawProfile = null; }
      // Reserve space for publication status and a bounded output error.
      const summary = boundedSummary({ ...report, ...(encoded?.summary || {}), incomplete: setupAbandoned || report.stopReason === 'watchdog' || !encoded || encoded.summary.incomplete }, SUMMARY_BYTES - 2048);
      const controller = new AbortController();
      const staged = [], outputExpiresAtMs = performance.now() + DEADLINE_MS;
      const checkOutputDeadline = () => {
        if (controller.signal.aborted || performance.now() >= outputExpiresAtMs) throw new Error('CPU profile output deadline exceeded');
      };
      summary.output = { status: 'unpublished', profile: encoded ? 'unpublished' : 'unavailable', summary: 'unpublished' };
      const discardStaging = () => {
        // Do not await cleanup: late or stuck filesystem work must not hold the
        // action result. Repeat after a late write settles in case it recreated a file.
        for (const path of staged) fs.rm(path, { force: true }).catch(() => {});
      };
      try {
        await withDiagnosticDeadline(async () => {
          try {
            const published = { ...summary, output: { status: 'published', profile: encoded ? 'published' : 'unavailable', summary: 'published' } };
            const files = [
              ...(encoded ? [[`${label}-cpu-profile.cpuprofile.gz`, encoded.gzip, 'application/gzip']] : []),
              [`${label}-cpu-summary.json`, JSON.stringify(published), 'application/json'],
            ].map(([name, body, contentType]) => {
              const path = testInfo.outputPath(name), temporary = `${path}.partial-${process.pid}-${++nextOutput}`;
              staged.push(temporary);
              return { name, body, contentType, path, temporary };
            });
            for (const { temporary, body } of files) {
              checkOutputDeadline();
              await fs.writeFile(temporary, body, { signal: controller.signal, flag: 'wx' });
            }
            checkOutputDeadline();
            // No awaits during publication: an asynchronous rename could finish
            // after its diagnostic deadline. Each final path receives only a
            // completely written file; raw is published before its summary.
            for (const { temporary, path, contentType } of files) {
              renameSync(temporary, path);
              summary.output[contentType === 'application/gzip' ? 'profile' : 'summary'] = 'published';
            }
            summary.output = published.output;
            // Attachment failure cannot discard the successfully published files.
            for (const { name, path, contentType } of files) {
              checkOutputDeadline();
              await testInfo.attach(name, { path, contentType });
            }
          } finally { discardStaging(); }
        }, DEADLINE_MS);
      } catch (error) {
        if (summary.output.status === 'unpublished' && summary.output.profile === 'published') summary.output.status = 'partial';
        summary.output.error = clipped(error);
        log('native-action-cpu-output', { label, diagnosticError: clipped(error) });
      } finally { controller.abort(); discardStaging(); }
      // Only report published after final paths exist. A failed/stalled write
      // still has a host summary, explicitly labelled unpublished.
      log('native-action-cpu', summary);
      return summary;
    })().catch(error => { log('native-action-cpu-output', { label, diagnosticError: clipped(error) }); });
    return finishPromise;
  } };
}

function boundedSummary(summary, byteLimit = SUMMARY_BYTES) {
  // Limit frame strings and stack depth independently of the untouched raw data.
  while (Buffer.byteLength(JSON.stringify(summary)) > byteLimit) {
    const lists = ['topSelf', 'topInclusive'];
    const largest = lists.sort((a, b) => (summary[b]?.length || 0) - (summary[a]?.length || 0))[0];
    if (!summary[largest]?.length) throw new Error('CPU profile summary exceeds byte budget');
    summary[largest].pop(); summary.summaryTruncated = true;
  }
  return summary;
}

// Pure export preparation, also exercised without a browser. A full profile is
// byte-for-byte equivalent as JSON data. Oversized exports keep a chronological
// sample prefix and every ancestor, with no dangling children or sample IDs.
export async function encodeCpuProfile(profile, { signal } = {}) {
  const zip = async body => { signal?.throwIfAborted(); const result = await compress(body); signal?.throwIfAborted(); return result; };
  const { nodes, samples, timeDeltas, startTime, endTime } = profile;
  if (!Array.isArray(nodes) || !Array.isArray(samples) || !Array.isArray(timeDeltas) || samples.length !== timeDeltas.length ||
      !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) throw new Error('Invalid CPU profile arrays/times');
  if (!nodes.length) throw new Error('Invalid CPU profile missing root');
  const byId = new Map(nodes.map(node => [node.id, node]));
  const parents = new Map();
  if (byId.size !== nodes.length) throw new Error('Invalid CPU profile duplicate nodes');
  for (const node of nodes) {
    if (!node.callFrame) throw new Error('Invalid CPU profile call frame');
    for (const child of node.children || []) {
      if (!byId.has(child) || parents.has(child)) throw new Error('Invalid CPU profile child/parent reference');
      parents.set(child, node.id);
    }
  }
  for (const node of nodes) {
    const seen = new Set(); let id = node.id;
    while (id !== undefined) {
      if (seen.has(id)) throw new Error('Invalid CPU profile cyclic ancestry');
      seen.add(id); id = parents.get(id);
    }
  }
  for (let index = 0; index < samples.length; index++) {
    if (!byId.has(samples[index]) || !Number.isFinite(timeDeltas[index]) || timeDeltas[index] < 0) throw new Error('Invalid CPU profile sample/delta');
  }
  const roots = nodes.filter(node => !parents.has(node.id));
  if (roots.length !== 1) throw new Error('Invalid CPU profile root count');
  const full = Buffer.from(JSON.stringify(profile));
  const original = { nodeCount: nodes.length, sampleCount: samples.length, timeDeltaCount: timeDeltas.length,
    startTimeUs: startTime, endTimeUs: endTime, durationUs: endTime - startTime, rawBytes: full.byteLength };
  const prefix = count => {
    const retained = new Set([roots[0].id]);
    for (const sample of samples.slice(0, count)) {
      let id = sample;
      while (id !== undefined && !retained.has(id)) { retained.add(id); id = parents.get(id); }
    }
    const deltas = timeDeltas.slice(0, count);
    return { nodes: nodes.filter(node => retained.has(node.id)).map(node => ({ ...node,
      ...(node.children ? { children: node.children.filter(id => retained.has(id)) } : {}) })),
    startTime, endTime: startTime + deltas.reduce((a, b) => a + b, 0), samples: samples.slice(0, count), timeDeltas: deltas };
  };
  let exported = profile, raw = full, zipped;
  if (raw.byteLength <= RAW_BYTES) zipped = await zip(raw);
  if (raw.byteLength > RAW_BYTES || zipped.byteLength > GZIP_BYTES) {
    // Binary search checks both actual byte budgets. Compression is not strictly
    // monotonic: this selects a fitting prefix, not a promised maximal prefix.
    let low = 0, high = samples.length;
    exported = prefix(0); raw = Buffer.from(JSON.stringify(exported));
    if (raw.byteLength > RAW_BYTES) throw new Error('CPU profile root exceeds raw byte budget');
    zipped = await zip(raw);
    if (zipped.byteLength > GZIP_BYTES) throw new Error('CPU profile root exceeds gzip byte budget');
    while (low <= high) {
      const count = Math.floor((low + high) / 2), candidate = prefix(count);
      const body = Buffer.from(JSON.stringify(candidate));
      const compressed = body.byteLength <= RAW_BYTES ? await zip(body) : null;
      if (compressed && compressed.byteLength <= GZIP_BYTES) {
        exported = candidate; raw = body; zipped = compressed; low = count + 1;
      } else high = count - 1;
    }
  }
  const self = new Map(), inclusive = new Map();
  const sampledDurationUs = exported.timeDeltas.reduce((a, b) => a + b, 0);
  const bucketWidthUs = Math.max(1_000_000, Math.ceil(sampledDurationUs / 32_000_000) * 1_000_000);
  const timingDistribution = [];
  let elapsedUs = 0;
  for (let index = 0; index < exported.samples.length; index++) {
    let id = exported.samples[index]; const duration = exported.timeDeltas[index];
    self.set(id, (self.get(id) || 0) + duration);
    const bucketIndex = Math.max(0, Math.ceil((elapsedUs + duration) / bucketWidthUs) - 1);
    // Delta estimates are assigned to the bucket containing their sample's end.
    while (timingDistribution.length <= bucketIndex) {
      const fromUs = timingDistribution.length * bucketWidthUs;
      timingDistribution.push({ fromUs, toUs: fromUs + bucketWidthUs, sampleCount: 0, sampledDurationUs: 0 });
    }
    timingDistribution[bucketIndex].sampleCount++; timingDistribution[bucketIndex].sampledDurationUs += duration;
    elapsedUs += duration;
    while (id !== undefined) { inclusive.set(id, (inclusive.get(id) || 0) + duration); id = parents.get(id); }
  }
  const frame = id => { const value = byId.get(id).callFrame; return { functionName: clipped(value.functionName), url: clipped(value.url),
    scriptId: clipped(value.scriptId), lineNumber: value.lineNumber, columnNumber: value.columnNumber }; };
  const top = (values, key) => [...values].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 12).map(([id, duration]) => {
    const stack = []; let parent = id, depth = 0;
    while (parent !== undefined) { if (depth < 12) stack.push(frame(parent)); depth++; parent = parents.get(parent); }
    return { nodeId: id, callFrame: frame(id), [key]: duration, stack, stackOrder: 'leaf-to-root', omittedAncestorCount: Math.max(0, depth - stack.length) };
  });
  const summary = boundedSummary({ incomplete: exported !== profile, original,
    profileWindowOverrunUs: Math.max(0, endTime - startTime - WATCHDOG_MS * 1000),
    timingDistribution, timingDistributionClock: 'Profile-relative microseconds; each delta estimate belongs to the bucket containing its sample end.',
    omitted: { nodeCount: nodes.length - exported.nodes.length, sampleCount: samples.length - exported.samples.length, timeDeltaCount: timeDeltas.length - exported.timeDeltas.length },
    retained: { nodeCount: exported.nodes.length, sampleCount: exported.samples.length, timeDeltaCount: exported.timeDeltas.length,
      startTimeUs: exported.startTime, endTimeUs: exported.endTime, sampledDurationUs: exported.timeDeltas.reduce((a, b) => a + b, 0), rawBytes: raw.byteLength, gzipBytes: zipped.byteLength },
    retention: exported === profile ? 'full' : 'chronological-sample-prefix-with-ancestors; node hitCounts remain original CDP metadata',
    attribution: 'Durations are sample delta estimates, not exact function runtimes; line/column numbers are zero-based CDP locations.',
    topSelf: top(self, 'selfTimeUs'), topInclusive: top(inclusive, 'inclusiveTimeUs') });
  return { gzip: zipped, summary };
}
