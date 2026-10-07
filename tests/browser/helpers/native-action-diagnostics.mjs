import fs from 'node:fs/promises';
import { withDiagnosticDeadline } from './map-diagnostics.mjs';
import { startNativeActionCpuProfile } from './native-action-cpu-profile.mjs';

let nextToken = 0;
const DIAGNOSTIC_DEADLINE_MS = 250;

// No retry, timeout override or altered click options. The callback owns the
// original native action; diagnostic setup/output never determine its outcome.
export async function withNativeActionDiagnostics(page, testInfo, {
  label, selector, rowSelector, cpuProfile = false, longAnimationFrames = false, now = () => performance.now(), write = console.log,
}, action) {
  const token = String(++nextToken);
  const read = async options => {
    try { return await withDiagnosticDeadline(() => page.evaluate(nativeActionProbe, options), DIAGNOSTIC_DEADLINE_MS); }
    catch (error) { return { diagnosticError: String(error).slice(0, 240) }; }
  };
  const setup = await read({ command: 'install', token, selector, rowSelector, longAnimationFrames,
    installBeforeEpochMs: Date.now() + DIAGNOSTIC_DEADLINE_MS });
  const cpu = cpuProfile ? await startNativeActionCpuProfile(page, { label, now, write }) : null;
  const host = { startedAtMs: now(), endedAtMs: null, durationMs: null, outcome: 'rejected' };
  try {
    const result = await action();
    host.outcome = 'fulfilled';
    return result;
  } finally {
    host.endedAtMs = now();
    host.durationMs = host.endedAtMs - host.startedAtMs;
    cpu?.stop('action-settled', host);
    // Emit the host clock before any browser read: a stalled renderer cannot
    // withhold this evidence. Host and browser time origins are not interchangeable.
    try { Promise.resolve(write(`[native-action] ${JSON.stringify({ label, host, setup })}`)).catch(() => {}); } catch (_) { /* Diagnostic only. */ }
    // This completion was already awaited below. Retain the independently
    // observed frames after delayed stop/cleanup, without adding a wait or retry.
    await cpu?.finish(testInfo);
    const browser = await read({ command: 'take', token, longAnimationFrames });
    let outputController;
    try {
      const body = JSON.stringify({ label, host, setup, browser });
      const name = `${label}-native-action.json`;
      outputController = new AbortController();
      await withDiagnosticDeadline(async () => {
        // Body-only attachments are not files in a passing list-reporter run.
        const path = testInfo.outputPath(name);
        await fs.writeFile(path, body, { encoding: 'utf8', signal: outputController.signal });
        if (outputController.signal.aborted) return;
        await testInfo.attach(name, { path, contentType: 'application/json' });
      }, DIAGNOSTIC_DEADLINE_MS);
    } catch (error) {
      // Diagnose lost output, but preserve the original action result/error.
      try { Promise.resolve(write(`[native-action-output] ${JSON.stringify({ label, diagnosticError: String(error).slice(0, 240) })}`)).catch(() => {}); } catch (_) { /* Diagnostic only. */ }
    } finally { outputController?.abort(); }
  }
}

// Self-contained for page.evaluate and browser-free VM tests. Never reads layout,
// replaces an app function, cancels an event or schedules recurring frame polling.
export function nativeActionProbe({ command, token, selector, rowSelector, installBeforeEpochMs, longAnimationFrames = false }) {
  const scope = globalThis;
  const key = '__PANDOLAB_NATIVE_ACTION_TEST_PROBE__';
  const clock = () => scope.performance.now();
  const text = value => value == null ? null : String(value).slice(0, 160);
  // The startup monitor owns these rings. Read it once in the existing final
  // evaluation, independently of whether the native observer could be armed.
  const collectPerformance = (nativeWindow, recordError) => {
    const performanceCollection = {
      status: 'error', source: '__PANDOLAB_PERFORMANCE_REPORT__', version: null,
      installedAtMs: null, capturedAt: null, timeOrigin: scope.performance.timeOrigin,
      startedAtMs: clock(), endedAtMs: null,
      scope: nativeWindow ? 'native-window-overlap' : 'retained-startup-samples', partial: true,
      coverage: 'Unknown observer support and prior buffer loss; empty samples do not rule out JavaScript blocking.',
    };
    let performanceReport = null;
    try {
      if (typeof scope.__PANDOLAB_PERFORMANCE_REPORT__ !== 'function') {
        performanceCollection.status = 'unavailable';
        throw new Error('Performance report unavailable');
      }
      const report = scope.__PANDOLAB_PERFORMANCE_REPORT__();
      performanceCollection.version = Number.isFinite(report.version) ? report.version : null;
      performanceCollection.installedAtMs = Number.isFinite(report.installedAtMs) ? report.installedAtMs : null;
      performanceCollection.capturedAt = text(report.capturedAt);
      const samples = (source, keys, limit, endTimestamp = false) => {
        const available = Array.isArray(source?.samples);
        const values = available ? source.samples : [];
        const start = sample => endTimestamp ? sample.atMs - sample.durationMs : sample.startTime;
        const end = sample => endTimestamp ? sample.atMs : sample.startTime + sample.durationMs;
        const matching = nativeWindow ? values.filter(sample =>
          end(sample) >= nativeWindow.startedAtMs && start(sample) <= nativeWindow.endedAtMs) : values;
        const exported = matching.slice(-limit).map(sample => Object.fromEntries(keys.map(key =>
          [key, typeof sample[key] === 'number' ? (Number.isFinite(sample[key]) ? sample[key] : null) : text(sample[key])])));
        const starts = values.map(start).filter(Number.isFinite), ends = values.map(end).filter(Number.isFinite);
        return {
          status: available ? 'available' : 'unavailable', retainedCount: available ? values.length : null,
          exportedCount: exported.length, omitted: Math.max(0, matching.length - limit),
          oldestRetainedStartTimeMs: starts.length ? starts.reduce((a, b) => Math.min(a, b)) : null,
          newestRetainedEndTimeMs: ends.length ? ends.reduce((a, b) => Math.max(a, b)) : null,
          // Production retains at most 120, but exposes neither total drops nor
          // observer installation success. A full ring only suggests lost history.
          retentionLimitReached: available ? values.length >= 120 : null,
          observerSupported: null, droppedBeforeSnapshot: null, samples: exported,
        };
      };
      performanceReport = {
        longTasks: samples(report.longTasks, ['startTime', 'durationMs', 'name'], 120),
        eventTimings: samples(report.eventTimings, ['startTime', 'durationMs', 'name', 'target', 'interactionId'], 32),
        operations: Object.fromEntries(['autosave.persist', 'project.command', 'project.transaction'].map(name =>
          [name, samples(report.operations?.[name], ['atMs', 'durationMs'], 32, true)])),
      };
      performanceCollection.status = 'available';
    } catch (error) { recordError(String(error).slice(0, 240)); }
    performanceCollection.endedAtMs = clock();
    return { performance: performanceReport, performanceCollection };
  };
  const collectLongAnimationFrames = (probe, unavailableReason) => {
    if (!longAnimationFrames) return {};
    const missing = { status: 'unavailable', frames: null,
      coverage: 'LoAF observation unavailable; missing samples cannot rule out blocking.',
      reason: unavailableReason || 'missing-init-script-at-native-install' };
    try {
      if (probe && !unavailableReason) return { longAnimationFrames: probe.take() };
      // Early LoAF evidence remains useful when native setup expired. Unknown
      // document/action association permits a snapshot, never a destructive take.
      const currentProbe = scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__;
      return { longAnimationFrames: typeof currentProbe?.snapshot === 'function' ? currentProbe.snapshot(missing.reason) : missing };
    } catch (error) {
      return { longAnimationFrames: { ...missing, status: 'error', reason: String(error).slice(0, 240) } };
    }
  };
  if (command === 'take') {
    const current = scope[key];
    if (current?.token !== token) {
      const errors = [];
      return { unavailable: true, unavailableReason: current ? 'token-mismatch' : 'missing-token', nativeWindow: null,
        ...collectPerformance(null, error => errors.push(error)),
        ...collectLongAnimationFrames(null, current ? 'token-mismatch' : 'missing-native-token'), errors };
    }
    delete scope[key];
    return { ...current.take(), ...collectLongAnimationFrames(current.longAnimationFrameProbe) };
  }
  if (installBeforeEpochMs != null && Date.now() > installBeforeEpochMs) return { installationExpired: true };
  scope[key]?.dispose();
  const startedAtMs = clock();
  const rows = [], events = [], frames = [], errors = [], rowMutations = [];
  const rings = new Map([[rows, 'rows'], [events, 'events'], [frames, 'frames'], [errors, 'errors'], [rowMutations, 'rowMutations']]);
  const dropped = { rows: 0, events: 0, frames: 0, errors: 0, rowMutations: 0 };
  const rowChanges = { batches: 0, added: 0, removed: 0, replacements: 0, omittedRecords: 0, omittedNodes: 0, observationTruncated: false };
  const identities = new WeakMap(), capturedEvents = new WeakMap(), pendingFrames = new Set(), listeners = [];
  let identity = 0, eventId = 0, previousRow = null, observer, timer, disposed = false, expired = false, clickFramesStarted = false;
  const retain = (ring, value) => { ring.push(value); if (ring.length > 32) { ring.shift(); dropped[rings.get(ring)]++; } };
  const safe = action => {
    try { return action(); } catch (error) { retain(errors, String(error).slice(0, 240)); }
  };
  const nodeSummary = node => {
    if (!node) return null;
    if (!identities.has(node)) identities.set(node, ++identity);
    return { identity: identities.get(node), connected: node.isConnected, tag: text(node.tagName), id: text(node.id),
      class: text(node.getAttribute('class')), hidden: !!node.hidden, ariaHidden: text(node.getAttribute('aria-hidden')),
      selected: text(node.getAttribute('aria-selected')), disabled: !!node.disabled,
      objectKey: text(node.getAttribute('data-object-key')), itemId: text(node.getAttribute('data-item-id')),
      inlineStyle: text(node.getAttribute('style')) };
  };
  const root = rowSelector ? scope.document.querySelector('#layerSearchResults') : null;
  const observeRow = reason => {
    const row = root?.querySelector(rowSelector) || null;
    const summary = nodeSummary(row);
    if (previousRow != null && summary != null && previousRow !== summary.identity) rowChanges.replacements++;
    previousRow = summary?.identity ?? previousRow;
    retain(rows, { atMs: clock(), reason, row: summary, select: nodeSummary(row?.querySelector('[data-object-search-select]')),
      container: nodeSummary(root) });
  };
  const twoFrames = phase => {
    const schedule = index => {
      const id = scope.requestAnimationFrame(timestamp => {
        pendingFrames.delete(id);
        if (disposed) return;
        safe(() => {
          retain(frames, { phase, index, atMs: clock(), frameTimestampMs: timestamp });
          if (index === 1) schedule(2);
        });
      });
      pendingFrames.add(id);
    };
    schedule(1);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    safe(() => observer?.disconnect());
    for (const [type, listener, capture] of listeners) safe(() => scope.document.removeEventListener(type, listener, capture));
    for (const id of pendingFrames) safe(() => scope.cancelAnimationFrame(id));
    pendingFrames.clear();
    safe(() => scope.clearTimeout(timer));
  };
  // Bind the observer in this document to this successful native installation.
  // A stale take after navigation must not consume a newer document's observer.
  const api = { token, dispose,
    longAnimationFrameProbe: longAnimationFrames ? scope.__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__ : null, take() {
    dispose();
    const endedAtMs = clock();
    const nativeWindow = { startedAtMs, endedAtMs };
    const performanceReport = collectPerformance(nativeWindow, error => retain(errors, error));
    return { startedAtMs, endedAtMs, timeOrigin: scope.performance.timeOrigin, expired, nativeWindow,
      rows, rowChanges, rowMutations, events, frames, errors, dropped, rowContainerAvailable: !!root, ...performanceReport };
  } };
  scope[key] = api;
  // The observer self-disposes even if page.evaluate cannot return to the host.
  timer = scope.setTimeout(() => { expired = true; dispose(); }, 15_000);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) for (const capture of [true, false]) {
    const listener = event => safe(() => {
      if (disposed) return;
      let captured;
      if (capture) {
        if (!event.target?.closest(selector)) return;
        captured = { eventId: ++eventId, eventTimestampMs: event.timeStamp, trusted: event.isTrusted, target: nodeSummary(event.target) };
        capturedEvents.set(event, captured);
      } else {
        // The propagation path survives a handler detaching the search row.
        // Match by the original Event, retaining only its capture-time scalars.
        captured = capturedEvents.get(event);
        if (!captured) return;
        capturedEvents.delete(event);
      }
      retain(events, { type, phase: capture ? 'capture' : 'bubble', atMs: clock(), ...captured });
      if (type === 'click' && capture && !clickFramesStarted) { clickFramesStarted = true; twoFrames('click'); }
    });
    safe(() => { scope.document.addEventListener(type, listener, capture); listeners.push([type, listener, capture]); });
  }
  if (root) safe(() => {
    observeRow('initial');
    observer = new scope.MutationObserver(records => safe(() => {
      if (disposed) return;
      rowChanges.batches++;
      rowChanges.omittedRecords += Math.max(0, records.length - 32);
      for (const record of records.slice(0, 32)) for (const [field, counter] of [['addedNodes', 'added'], ['removedNodes', 'removed']]) {
        const nodes = record[field] || [];
        rowChanges.omittedNodes += Math.max(0, nodes.length - 32);
        for (let index = 0; index < Math.min(32, nodes.length); index++) {
          const node = nodes[index];
          if (node.nodeType !== 1 || !node.matches(rowSelector)) continue;
          rowChanges[counter]++;
          retain(rowMutations, { atMs: clock(), kind: counter, row: nodeSummary(node) });
        }
      }
      observeRow('mutation');
      if (rowChanges.batches >= 128) { rowChanges.observationTruncated = true; observer.disconnect(); }
    }));
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'aria-hidden', 'aria-selected', 'disabled'] });
  });
  safe(() => twoFrames('installed'));
  return { installed: true, startedAtMs };
}
