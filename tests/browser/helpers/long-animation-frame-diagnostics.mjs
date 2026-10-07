// Self-contained for page.addInitScript before navigation in one diagnostic test.
// No DOM/layout reads, app hooks, console streaming or recurring frame polling.
export function installLongAnimationFrameProbe() {
  const scope = globalThis;
  const key = '__PANDOLAB_LONG_ANIMATION_FRAME_TEST_PROBE__';
  scope[key]?.dispose('reinstalled');
  const clock = () => scope.performance.now();
  const limits = { frames: 32, scriptsPerFrame: 16, stringCharacters: 160, errors: 8,
    errorCharacters: 240, lifetimeMs: 360000, outputCharacters: 65536 };
  const report = {
    status: 'unsupported', support: { performanceObserver: typeof scope.PerformanceObserver === 'function',
      entryType: null, observed: false, bufferedRequested: false },
    clock: 'browser performance.now() milliseconds; separate origin from host performance.now() and CDP profile microseconds',
    timeOrigin: scope.performance.timeOrigin, installedAtMs: clock(), collectedAtMs: null,
    stoppedAtMs: null, stoppedReason: null, expired: false, limits,
    coverage: 'Completed long animation frames only; buffered samples may predate installation or click and are not click attribution. '
      + 'Empty or unsupported samples cannot rule out blocking. Browser buffer losses are unknown; scripts may omit short or cross-origin work. '
      + 'No worker/GPU/OS CPU coverage or native-function attribution; observer and collection add overhead.',
    browserDroppedFrameCount: null, totalFrameCount: 0, retainedFrameCount: 0, exportedFrameCount: 0,
    droppedFrameCount: 0, outputOmittedFrameCount: 0, omittedErrorCount: 0, errors: [], frames: [],
  };
  report.lifetimeDueAtMs = report.installedAtMs + limits.lifetimeMs;
  report.lifetimeOverrunMs = null;
  let observer, timer, stopped = false, finalReport;
  const recordError = error => {
    if (report.errors.length >= limits.errors) { report.omittedErrorCount++; return; }
    let message;
    try { message = String(error).slice(0, limits.errorCharacters); }
    catch (_) { message = 'Unprintable diagnostic error'; }
    report.errors.push(message);
  };
  const safe = action => { try { return action(); } catch (error) { recordError(error); } };
  const scalars = (entry, numbers, strings = []) => {
    const value = { unavailableFields: [] };
    for (const field of [...numbers, ...strings]) {
      const item = safe(() => entry[field]);
      const available = strings.includes(field) ? typeof item === 'string' : typeof item === 'number' && Number.isFinite(item);
      value[field] = available ? (typeof item === 'string' ? item.slice(0, limits.stringCharacters) : item) : null;
      if (!available) value.unavailableFields.push(field);
    }
    return value;
  };
  const retain = entries => {
    if (stopped) return;
    const observedAtMs = clock();
    report.totalFrameCount += entries.length;
    // Bound work for an unusually large observer delivery as well as storage.
    const skipped = Math.max(0, entries.length - limits.frames);
    report.droppedFrameCount += skipped;
    for (let index = skipped; index < entries.length; index++) {
      // Synthetic malformed entries must not abort a delivery or hide its tail.
      try {
        const entry = entries[index];
        const frame = scalars(entry, ['startTime', 'duration', 'blockingDuration', 'renderStart', 'styleAndLayoutStart', 'firstUIEventTimestamp']);
        frame.observedAtMs = observedAtMs;
        const scripts = safe(() => entry.scripts);
        frame.scriptsStatus = Array.isArray(scripts) ? 'available' : 'unavailable';
        frame.totalScriptCount = Array.isArray(scripts) ? scripts.length : null;
        frame.scripts = [];
        if (Array.isArray(scripts)) for (let scriptIndex = 0; scriptIndex < Math.min(scripts.length, limits.scriptsPerFrame); scriptIndex++) {
          try {
            frame.scripts.push(scalars(scripts[scriptIndex],
              ['startTime', 'duration', 'executionStart', 'sourceCharPosition', 'forcedStyleAndLayoutDuration', 'pauseDuration'],
              ['invoker', 'invokerType', 'sourceURL', 'sourceFunctionName', 'windowAttribution']));
          } catch (error) { recordError(error); }
        }
        frame.omittedScriptCount = Array.isArray(scripts) ? scripts.length - frame.scripts.length : null;
        report.frames.push(frame);
        if (report.frames.length > limits.frames) { report.frames.shift(); report.droppedFrameCount++; }
      } catch (error) { report.droppedFrameCount++; recordError(error); }
    }
  };
  const onPageHide = () => dispose('pagehide');
  const dispose = reason => {
    if (stopped) return;
    // takeRecords preserves completed frames queued while the CPU stop was pending.
    if (report.support.observed) safe(() => retain(observer.takeRecords()));
    stopped = true;
    report.stoppedAtMs = clock(); report.stoppedReason = reason;
    report.lifetimeOverrunMs = Math.max(0, report.stoppedAtMs - report.lifetimeDueAtMs);
    report.expired = reason === 'lifetime-limit' || report.stoppedAtMs >= report.lifetimeDueAtMs;
    safe(() => observer?.disconnect());
    safe(() => scope.clearTimeout(timer));
    safe(() => scope.removeEventListener('pagehide', onPageHide));
  };
  const exportSnapshot = (collectionMode, nativeAssociationReason) => {
    // Copy scalar data only at collection. Output caps must not truncate the live
    // ring when an unarmed/stale native read asks for non-destructive evidence.
    const snapshot = JSON.parse(JSON.stringify(report));
    snapshot.collectionMode = collectionMode;
    snapshot.collectedAtMs = clock();
    if (nativeAssociationReason) {
      snapshot.nativeAssociation = 'unknown';
      snapshot.nativeAssociationReason = nativeAssociationReason.slice(0, limits.stringCharacters);
    }
    snapshot.retainedFrameCount = snapshot.frames.length;
    snapshot.exportedFrameCount = snapshot.frames.length;
    snapshot.expired ||= snapshot.collectedAtMs >= snapshot.lifetimeDueAtMs;
    snapshot.lifetimeOverrunMs ??= Math.max(0, snapshot.collectedAtMs - snapshot.lifetimeDueAtMs);
    // A UTF-16 character cap also bounds UTF-8 output to at most 3x this limit.
    while (JSON.stringify(snapshot).length > limits.outputCharacters && snapshot.frames.length) {
      snapshot.frames.shift(); snapshot.outputOmittedFrameCount++;
      snapshot.exportedFrameCount = snapshot.frames.length;
    }
    return snapshot;
  };
  scope[key] = { dispose, snapshot(nativeAssociationReason) {
    // Preserve queued completed entries in the same ring for any later owner.
    if (!stopped && report.support.observed) safe(() => retain(observer.takeRecords()));
    return exportSnapshot('non-destructive-snapshot', nativeAssociationReason);
  }, take() {
    if (finalReport) return finalReport;
    dispose('take');
    finalReport = exportSnapshot('final-take');
    return finalReport;
  } };
  if (!report.support.performanceObserver) return;
  try {
    const supportedTypes = scope.PerformanceObserver.supportedEntryTypes;
    report.support.entryType = Array.isArray(supportedTypes) ? supportedTypes.includes('long-animation-frame') : null;
    if (!report.support.entryType) return;
    observer = new scope.PerformanceObserver(list => { if (!stopped) safe(() => retain(list.getEntries())); });
    report.support.bufferedRequested = true;
    observer.observe({ type: 'long-animation-frame', buffered: true });
    report.support.observed = true; report.status = 'available';
    timer = scope.setTimeout(() => dispose('lifetime-limit'), limits.lifetimeMs);
    scope.addEventListener('pagehide', onPageHide);
  } catch (error) { report.status = 'error'; recordError(error); dispose('installation-error'); }
}
