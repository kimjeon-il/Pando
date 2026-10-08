import fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { withDiagnosticDeadline } from './map-diagnostics.mjs';

export const BOUNDARY_NATIVE_TRACE_TITLE = 'a child cut snaps to both parent boundaries, preserves coverage and undoes in one step';
const LABEL = 'boundary-project-undo';
const CATEGORIES = Object.freeze(['__metadata', 'toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'blink', 'cc', 'gpu', 'viz', 'base', 'mojom.flow', 'v8']);
const LIMITS = Object.freeze({ preflightMs: 2000, startMs: 2000, markerMs: 250, endMs: 2000, watchdogMs: 45000,
  teardownMs: 20000, drainMs: 18500, closeMs: 250, detachMs: 250, outputMs: 1000,
  readBytes: 64 * 1024, rawBytes: 24 * 1024 * 1024, manifestBytes: 64 * 1024, bufferReports: 64, errors: 8 });
const SETTINGS = Object.freeze({ traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 16384,
  enableSampling: false, enableSystrace: false, includedCategories: CATEGORIES, excludedCategories: ['*'] },
transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'none', tracingBackend: 'chrome', bufferUsageReportingInterval: 1000 });
const clipped = value => String(value).slice(0, 240);
let nextCapture = 0;

export function isBoundaryNativeTraceEnabled(title, env = process.env) {
  return title === BOUNDARY_NATIVE_TRACE_TITLE && env.PANDOLAB_BOUNDARY_NATIVE_TRACE === '1';
}

// The page dependency keeps this teardown ahead of page/browser disposal. It
// adds no page evaluation, warm-up, action, or stream work before the test body.
export async function boundaryNativeTimelineFixture({ page, browser, browserName, channel, headless, launchOptions }, use, testInfo) {
  if (!isBoundaryNativeTraceEnabled(testInfo.title)) { await use(null); return; }
  const controller = await createBoundaryNativeTimeline(browser, { enabled: true, metadata: () => ({
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 250 }).trim(),
    playwrightVersion: createRequire(import.meta.url)('@playwright/test/package.json').version,
    browserName, channel: channel ?? null, headless, launchOptions,
  }) });
  try { await use(controller); }
  finally { await controller.finish(testInfo); }
}

// One browser-target native owner. No page reads, native action, profiler,
// convenience tracing API, parsing engine, or Playwright trace attachments.
export async function createBoundaryNativeTimeline(browser, { enabled = false, metadata = {}, now = () => performance.now(), write = console.log } = {}) {
  if (!enabled) return null;
  const captureId = `${process.pid}-${++nextCapture}`;
  const report = { schemaVersion: 1, label: LABEL, captureId, status: 'unavailable', captureComplete: false,
    ownership: 'not-owned', limits: LIMITS, settings: SETTINGS, metadata: {},
    preflight: { status: 'pending', browser: null, availableCategories: [], categoryCount: null, omittedCategories: 0, missingCategories: [] },
    stages: {}, stopReason: null, host: { startRequestedAtMs: null, startAcknowledgedAtMs: null,
      watchdogDueAtMs: null, stopQueuedAtMs: null, stopRequestedAtMs: null, stopAcknowledgedAtMs: null,
      stopRequestOverrunMs: null, stopAcknowledgementOverrunMs: null, teardownStartedAtMs: null, teardownCollectedAtMs: null },
    clocks: { host: 'host performance.now() milliseconds', trace: 'native monotonic microseconds; separate from host/page/CPU-profile clocks',
      pageAlignment: 'Offline EventTiming creation timestamp and page-relative timeStamp; no additional page probe.',
      markerCaveat: 'A fulfilled marker lies within its host request/response interval; midpoint is not exact. Expired markers cannot tightly calibrate.' },
    markers: {}, buffer: { reports: [], omittedReports: 0, maxFullness: null, lastReportAtMs: null },
    completion: null, raw: { name: null, bytes: null, sha256: null, eof: false, limitReached: false, readCount: 0 },
    completenessCaveat: 'Transport completeness is not proof of attribution. False dataLossOccurred does not establish no loss after the last stats report; clocks, lanes and open spans require offline inspection.', errors: [] };
  let session, preflightExpired = false, owned = false, watchdog, startPromise, startCommand, endPromise,
    detachPromise, closePromise, endMarkerPromise, stream, finishPromise, abandoned = false, staging, outputController, writingRaw = false;
  let resolveComplete;
  const complete = new Promise(resolve => { resolveComplete = resolve; });
  const record = (phase, error) => { if (report.errors.length < LIMITS.errors) report.errors.push({ phase, error: clipped(error) }); };
  const log = value => { try { Promise.resolve(write(`[native-action-timeline-output] ${JSON.stringify(value)}`)).catch(() => {}); } catch (_) { /* Diagnostic only. */ } };
  const stage = async (name, operation) => {
    const entry = report.stages[name] = { requestedAtMs: now(), acknowledgedAtMs: null, settledAtMs: null, deadlineExceededAtMs: null, status: 'pending' };
    try { const result = await operation(); entry.acknowledgedAtMs = now(); entry.status = entry.deadlineExceededAtMs === null ? 'fulfilled' : 'fulfilled-after-deadline'; return result; }
    catch (error) { entry.status = entry.deadlineExceededAtMs === null ? 'rejected' : 'rejected-after-deadline'; throw error; }
    finally { entry.settledAtMs = now(); entry.roundTripMs = entry.settledAtMs - entry.requestedAtMs; }
  };
  const expire = name => {
    const entry = report.stages[name];
    if (entry?.status === 'pending') { entry.deadlineExceededAtMs = now(); entry.status = 'pending-after-deadline'; }
  };
  const bounded = async (name, operation, ms) => {
    try { return await withDiagnosticDeadline(() => stage(name, operation), ms); }
    catch (error) { expire(name); record(name, error); }
  };
  const closeStream = () => {
    if (!stream || !owned) return Promise.resolve();
    if (!closePromise) closePromise = bounded('close', () => session.send('IO.close', { handle: stream }), LIMITS.closeMs).finally(() => {
      if (abandoned) session.removeListener('Tracing.tracingComplete', onComplete);
    });
    return closePromise;
  };
  const detach = () => {
    if (!session) return Promise.resolve();
    if (!detachPromise) detachPromise = bounded('detach', () => session.detach(), LIMITS.detachMs).finally(() => {
      session.removeListener('Tracing.bufferUsage', onBuffer);
      // A deadline cannot cancel start/end. Keep only this one late-completion
      // handler until a pending owner settles; it closes, never downloads.
      if (report.ownership !== 'start-pending' && (!owned || report.completion)) session.removeListener('Tracing.tracingComplete', onComplete);
    });
    return detachPromise;
  };
  const marker = phase => {
    const name = `${phase}Marker`, syncId = `pandolab-${captureId}-${phase}`;
    report.markers[phase] = { syncId, stage: name };
    return bounded(name, () => session.send('Tracing.recordClockSyncMarker', { syncId }), LIMITS.markerMs);
  };
  const issueEnd = () => {
    if (!owned || endPromise) return;
    // Send in order, without awaiting a marker or download in the action owner.
    endMarkerPromise = marker('end');
    endPromise = bounded('end', async () => {
      report.host.stopRequestedAtMs = now();
      report.host.stopRequestOverrunMs = Math.max(0, now() - report.host.watchdogDueAtMs);
      const result = await session.send('Tracing.end');
      report.host.stopAcknowledgedAtMs = now();
      report.host.stopAcknowledgementOverrunMs = Math.max(0, now() - report.host.watchdogDueAtMs);
      return result;
    }, LIMITS.endMs);
  };
  const requestStop = reason => {
    if (report.stopReason === null) { report.stopReason = reason; report.host.stopQueuedAtMs = now(); }
    clearTimeout(watchdog);
    // A pending/rejected start is never permission to end someone else's trace.
    issueEnd();
  };
  function onBuffer(event) {
    if (!owned) return;
    const fullness = Math.max(...[event.percentFull, event.value].filter(Number.isFinite));
    const sample = { atMs: now(), fullness: Number.isFinite(fullness) ? fullness : null,
      eventCount: Number.isFinite(event.eventCount) ? event.eventCount : null };
    report.buffer.lastReportAtMs = sample.atMs;
    if (sample.fullness !== null) report.buffer.maxFullness = Math.max(report.buffer.maxFullness ?? 0, sample.fullness);
    if (report.buffer.reports.length < LIMITS.bufferReports) report.buffer.reports.push(sample);
    else report.buffer.omittedReports++;
    if (sample.fullness >= 0.8) requestStop('buffer-fullness');
  }
  function onComplete(event) {
    if (!owned || report.completion) return;
    stream = typeof event.stream === 'string' ? event.stream : null;
    report.completion = { atMs: now(), dataLossOccurred: typeof event.dataLossOccurred === 'boolean' ? event.dataLossOccurred : null,
      traceFormat: event.traceFormat ?? null, streamCompression: event.streamCompression ?? null, hasStream: !!stream };
    resolveComplete();
    if (abandoned) closeStream();
  }
  try {
    await withDiagnosticDeadline(async () => {
      report.metadata = boundedMetadata(typeof metadata === 'function' ? metadata() : metadata);
      session = await stage('session', () => browser.newBrowserCDPSession());
      if (preflightExpired) { detach(); return; }
      session.on('Tracing.bufferUsage', onBuffer); session.on('Tracing.tracingComplete', onComplete);
      const version = await stage('version', () => session.send('Browser.getVersion'));
      if (preflightExpired) return;
      report.preflight.browser = Object.fromEntries(['product', 'revision', 'protocolVersion', 'userAgent', 'jsVersion'].map(key => [key, clipped(version[key] ?? '')]));
      const result = await stage('categories', () => session.send('Tracing.getCategories'));
      if (preflightExpired) return;
      if (!Array.isArray(result.categories)) throw new Error('Tracing categories unavailable');
      report.preflight.categoryCount = result.categories.length;
      report.preflight.availableCategories = result.categories.slice(0, 256).map(value => String(value).slice(0, 160));
      report.preflight.omittedCategories = Math.max(0, result.categories.length - 256);
      report.preflight.missingCategories = CATEGORIES.filter(value => !result.categories.includes(value));
      if (!/^(?:Headless)?Chrome\/151\.0\.7922\.34$/.test(version.product)) throw new Error('Browser version differs from source-verified Chrome/151.0.7922.34');
      if (report.preflight.missingCategories.length) throw new Error('Missing required native tracing categories');
      report.preflight.status = 'ready';
    }, LIMITS.preflightMs);
  } catch (error) {
    preflightExpired = true; report.preflight.status = 'unavailable'; record('preflight', error);
    for (const name of ['session', 'version', 'categories']) expire(name);
    detach();
  }
  const start = () => {
    if (startPromise) return startPromise;
    if (report.preflight.status !== 'ready' || finishPromise) return Promise.resolve();
    report.host.startRequestedAtMs = now();
    report.host.watchdogDueAtMs = report.host.startRequestedAtMs + LIMITS.watchdogMs;
    report.ownership = 'start-pending';
    watchdog = setTimeout(() => requestStop('watchdog'), LIMITS.watchdogMs);
    startCommand = stage('start', () => session.send('Tracing.start', structuredClone(SETTINGS))).then(() => {
      owned = true; report.ownership = 'owned'; report.host.startAcknowledgedAtMs = now(); report.status = 'capturing';
      if (report.stages.start.deadlineExceededAtMs !== null || report.stopReason !== null || abandoned) requestStop('late-start');
    }, error => {
      report.ownership = 'not-owned'; report.status = 'unavailable'; record('start', error); clearTimeout(watchdog);
      if (abandoned) session.removeListener('Tracing.tracingComplete', onComplete);
    });
    startPromise = (async () => {
      try { await withDiagnosticDeadline(() => startCommand, LIMITS.startMs); }
      catch (error) { expire('start'); record('start', error); requestStop('start-expired'); }
      if (owned && report.stopReason === null) await marker('start');
    })().catch(error => record('start', error));
    return startPromise;
  };
  const discardStaging = () => { if (staging) fs.rm(staging, { force: true }).catch(() => {}); };
  const finish = testInfo => {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      report.host.teardownStartedAtMs = now();
      const teardownDeadline = performance.now() + LIMITS.teardownMs;
      outputController = new AbortController();
      requestStop('fixture-teardown');
      let hash, rawWriteFailed = false;
      try {
        await withDiagnosticDeadline(async () => {
          if (startCommand) await startCommand;
          if (!owned || abandoned) return;
          await stage('completion', () => complete);
          await Promise.all([endPromise, endMarkerPromise]);
          if (abandoned) return;
          if (!stream) throw new Error('Native tracing completion has no stream');
          if ((report.completion.traceFormat !== null && report.completion.traceFormat !== 'json') ||
              (report.completion.streamCompression !== null && report.completion.streamCompression !== 'none')) throw new Error('Native stream format/compression mismatch');
          const name = `${LABEL}-native-timeline.json`, path = testInfo.outputPath(name);
          staging = `${path}.partial-${captureId}`;
          hash = createHash('sha256');
          writingRaw = true;
          try { await fs.writeFile(staging, '', { flag: 'wx', signal: outputController.signal }); }
          catch (error) { rawWriteFailed = true; throw error; }
          finally { writingRaw = false; if (abandoned) discardStaging(); }
          if (abandoned) return;
          report.raw.name = name; report.raw.bytes = 0;
          while (!abandoned) {
            const chunk = await stage('read', () => session.send('IO.read', { handle: stream, size: LIMITS.readBytes }));
            if (abandoned) return;
            if (typeof chunk.data !== 'string' || Buffer.byteLength(chunk.data) > (chunk.base64Encoded ? 4 * Math.ceil(LIMITS.readBytes / 3) : LIMITS.readBytes)) throw new Error('Native stream chunk exceeds 64 KiB read budget');
            const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
            if (bytes.length > LIMITS.readBytes) throw new Error('Decoded native stream chunk exceeds 64 KiB read budget');
            report.raw.readCount++;
            const retained = bytes.subarray(0, LIMITS.rawBytes - report.raw.bytes);
            writingRaw = true;
            try { await fs.appendFile(staging, retained, { signal: outputController.signal }); }
            catch (error) { rawWriteFailed = true; throw error; }
            finally { writingRaw = false; if (abandoned) discardStaging(); }
            if (abandoned) return;
            hash.update(retained); report.raw.bytes += retained.length;
            if (report.raw.bytes >= LIMITS.rawBytes) { report.raw.limitReached = true; break; }
            if (chunk.eof) { report.raw.eof = true; break; }
            if (!bytes.length) throw new Error('Native stream made no progress before EOF');
          }
        }, LIMITS.drainMs);
      } catch (error) {
        record(report.stages.completion?.status === 'pending' ? 'completion' : 'drain', error);
        for (const name of ['start', 'completion', 'read']) expire(name);
      } finally {
        // A late write may finish while close/detach waits, after accounting was
        // abandoned. Latch failure before cleanup; writingRaw can later reset.
        if (writingRaw) { rawWriteFailed = true; record('raw-output', 'Raw write abandoned at the drain deadline; integrity unavailable'); }
        abandoned = true; clearTimeout(watchdog); outputController.abort();
        await closeStream(); await detach();
      }
      if (staging && !writingRaw && !rawWriteFailed && report.raw.bytes !== null) {
        try { report.raw.sha256 = hash.digest('hex'); renameSync(staging, testInfo.outputPath(report.raw.name)); }
        catch (error) { record('raw-output', error); report.raw.name = null; report.raw.bytes = null; report.raw.sha256 = null; }
      } else { report.raw.name = null; report.raw.bytes = null; }
      discardStaging();
      report.captureComplete = report.raw.eof && !!report.raw.sha256 && !report.raw.limitReached &&
        report.completion?.dataLossOccurred === false && report.stages.start?.status === 'fulfilled' &&
        report.stages.startMarker?.status === 'fulfilled' && report.stages.endMarker?.status === 'fulfilled' &&
        report.stopReason === 'wrapper-finished' && report.errors.length === 0;
      report.status = report.raw.sha256 ? (report.captureComplete ? 'captured' : 'partial') : 'unavailable';
      report.host.teardownCollectedAtMs = now();
      const snapshot = structuredClone(report);
      let manifestTemporary;
      const controller = new AbortController();
      try {
        while (Buffer.byteLength(JSON.stringify(snapshot)) > LIMITS.manifestBytes && snapshot.preflight.availableCategories.length) {
          snapshot.preflight.availableCategories.pop(); snapshot.preflight.omittedCategories++;
        }
        const body = Buffer.from(JSON.stringify(snapshot));
        if (body.length > LIMITS.manifestBytes) throw new Error('Native manifest exceeds 64 KiB budget');
        const name = `${LABEL}-native-timeline-manifest.json`, path = testInfo.outputPath(name);
        manifestTemporary = `${path}.partial-${captureId}`;
        await withDiagnosticDeadline(async () => {
          try {
            await fs.writeFile(manifestTemporary, body, { flag: 'wx', signal: controller.signal });
            if (controller.signal.aborted || performance.now() >= teardownDeadline) return;
            renameSync(manifestTemporary, path);
            log({ label: LABEL, status: snapshot.status, raw: snapshot.raw, manifest: name,
              manifestBytes: body.length, manifestSha256: createHash('sha256').update(body).digest('hex'),
              teardownEndedAtMs: now(), teardownOverrunMs: Math.max(0, performance.now() - teardownDeadline) });
          } finally {
            // Repeat after a late filesystem settlement that ignored abort.
            if (controller.signal.aborted) fs.rm(manifestTemporary, { force: true }).catch(() => {});
          }
        }, Math.max(1, Math.min(LIMITS.outputMs, teardownDeadline - performance.now())));
      } catch (error) { log({ label: LABEL, status: snapshot.status, outputError: clipped(error) }); }
      finally {
        controller.abort();
        if (manifestTemporary) fs.rm(manifestTemporary, { force: true }).catch(() => {});
      }
      return snapshot;
    })().catch(error => { log({ label: LABEL, diagnosticError: clipped(error) }); });
    return finishPromise;
  };
  return { start, requestStop, finish };
}

function boundedMetadata(metadata) {
  const visit = (value, depth = 0) => {
    if (typeof value === 'string') return value.slice(0, 500);
    if (!value || typeof value !== 'object') return value;
    if (depth >= 3) return '[depth-limit]';
    if (Array.isArray(value)) return value.slice(0, 16).map(item => visit(item, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, item]) => [key.slice(0, 80), visit(item, depth + 1)]));
  };
  const result = visit(metadata);
  return Buffer.byteLength(JSON.stringify(result)) <= 8192 ? result : { unavailable: 'metadata exceeds 8 KiB budget' };
}
