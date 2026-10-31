/** Single recovery owner. The renderer owns GL, document lifecycle and frame evidence.
 * Device readiness releases preparation; only an accepted frame completes recovery.
 * Timers charge foreground work, never hidden/frozen or explicit external-data waits.
 */
export function createGpuContextRecovery({ capture, isTargetCurrent, prepare, commit, discard, onCommitted, onFailure,
  onFallbackFailure = () => {}, now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay), clearSchedule = id => clearTimeout(id),
  isSuspended = () => false,
} = {}) {
  for (const fn of [capture, isTargetCurrent, prepare, commit, discard, onCommitted, onFailure,
    onFallbackFailure, now, schedule, clearSchedule, isSuspended]) {
    if (typeof fn !== 'function') throw new TypeError('GPU recovery callbacks are required.');
  }
  const contextLimit = 5000, idleLimit = 5000, totalLimit = 30000, canvasLimit = 5000;
  let recoveryId = 0, attemptId = 0, revision = 0;
  let active = false, disposed = false, requested = false, running = null, current = null;
  let lastReason = '', unexplainedAborts = 0, abortIdentity = null, phase = 'idle';
  let fallback = null, terminalError = null, stop = new AbortController();
  let timer = null, timerVersion = 0, sampledAt = now(), suspended = isSuspended(), dataWaiting = false;
  let foregroundMs = 0, idleMs = 0, contextMs = 0, canvasMs = 0, uploadedBytes = 0;
  const milestones = new Set(), deviceWaiters = new Set();
  const abortError = reason => Object.assign(new Error(reason), { name: 'AbortError' });
  const owns = ticket => active && !disposed && current?.ticket === ticket
    && ticket.recoveryId === recoveryId && ticket.revision === revision;
  const isCurrent = ticket => owns(ticket) && !ticket.signal.aborted && isTargetCurrent(ticket.identity);
  const ownsFallback = ticket => !disposed && !!fallback && fallback.ticket === ticket;
  const monitored = () => active || phase === 'awaiting-canvas' && fallback?.monitor;
  const dataPaused = () => dataWaiting && ['awaiting-frame', 'awaiting-canvas'].includes(phase);
  function settleDevice(ticket, error = null) {
    for (const waiter of deviceWaiters) {
      if (error) waiter.reject(error); else waiter.resolve(ticket);
    }
    deviceWaiters.clear();
  }
  function clearTimer() {
    timerVersion++;
    if (timer !== null) clearSchedule(timer);
    timer = null;
  }
  function account() {
    const at = now(), elapsed = Math.max(0, at - sampledAt);
    sampledAt = at;
    if (!monitored() || suspended || dataPaused()) return;
    if (active) {
      foregroundMs += elapsed;
      if (phase === 'waiting-context') contextMs += elapsed;
      else idleMs += elapsed;
    } else canvasMs += elapsed;
  }
  function invalidate(reason, terminal = false) {
    revision++;
    lastReason = reason;
    current?.controller.abort(abortError(reason));
    if (terminal) stop.abort(abortError(reason));
  }
  function reserveFallback(reason) {
    if (disposed || fallback) return null;
    account();
    const monitor = active; // Initial forced-Canvas startup is not a GPU loss recovery.
    active = false; requested = false;
    invalidate(reason, true);
    current = null;
    const ticket = Object.freeze({ recoveryId, revision, kind: 'canvas' });
    fallback = { ticket, claimed: false, usable: false, monitor };
    phase = 'awaiting-canvas'; canvasMs = 0;
    arm();
    return ticket;
  }
  function failFallback(ticket, error) {
    if (!ownsFallback(ticket) || phase !== 'awaiting-canvas') return false;
    account(); clearTimer(); phase = 'failed'; terminalError = error;
    lastReason = error?.code || 'canvas-failed';
    settleDevice(null, error);
    onFallbackFailure(error);
    return true;
  }
  function fail(error) {
    const ticket = reserveFallback(error?.code || error?.message || 'recovery-failed');
    if (!ticket) return;
    try { onFailure(error, ticket); }
    catch (failure) { failFallback(ticket, failure); }
  }
  function deadlineKind() {
    let kind = '';
    if (active && foregroundMs >= totalLimit) kind = 'TOTAL';
    else if (active && phase === 'waiting-context' && contextMs >= contextLimit) kind = 'CONTEXT';
    else if (active && phase !== 'waiting-context' && idleMs >= idleLimit) kind = 'IDLE';
    else if (phase === 'awaiting-canvas' && fallback?.monitor && canvasMs >= canvasLimit) kind = 'CANVAS';
    return kind;
  }
  function expired() {
    const kind = deadlineKind();
    if (!kind) return false;
    const error = Object.assign(new Error(`GPU recovery ${kind.toLowerCase()} deadline exceeded`),
      { code: `PL-GPU-RECOVERY-${kind}-TIMEOUT` });
    if (kind === 'CANVAS') failFallback(fallback.ticket, error); else fail(error);
    return true;
  }
  function arm() {
    clearTimer();
    if (disposed || !monitored() || suspended || dataPaused()) return;
    const delay = active ? Math.min(totalLimit - foregroundMs,
      phase === 'waiting-context' ? contextLimit - contextMs : idleLimit - idleMs) : canvasLimit - canvasMs;
    const version = timerVersion;
    timer = schedule(() => {
      if (disposed || version !== timerVersion) return;
      timer = null;
      // A delayed timer can precede visibility dispatch after a browser freeze.
      // Do not charge an interval whose foreground execution was not observable.
      if (isSuspended()) { suspended = true; sampledAt = now(); clearTimer(); return; }
      account();
      if (!expired()) arm();
    }, Math.max(0, delay));
  }
  function beginLoss() {
    if (disposed || fallback) return;
    account();
    if (!active) {
      recoveryId++;
      foregroundMs = idleMs = contextMs = uploadedBytes = 0;
      milestones.clear(); unexplainedAborts = 0; abortIdentity = null;
      stop = new AbortController(); terminalError = null;
    } else if (phase !== 'waiting-context') contextMs = 0;
    active = true; phase = 'waiting-context'; requested = false;
    invalidate('context-lost');
    arm();
  }
  function cancel(reason = 'cancelled') {
    if (disposed) return;
    account(); clearTimer(); active = false; requested = false;
    phase = reason === 'disposed' ? 'disposed' : 'cancelled';
    invalidate(reason, true); current = null;
    settleDevice(null, reason === 'disposed' ? abortError('Renderer disposed') : null);
  }
  function request() {
    if (!active || disposed) return Promise.resolve(false);
    if (phase === 'awaiting-frame' && current && isCurrent(current.ticket)) return Promise.resolve(true);
    requested = true;
    if (!running) {
      running = Promise.resolve().then(drain).finally(() => {
        running = null;
        if (active && requested && !disposed) return request();
      });
    }
    return running;
  }
  function supersede(reason = 'inputs-changed') {
    if (!active || disposed) return Promise.resolve(false);
    account();
    // Supersession is not progress and cannot reset either elapsed budget.
    if (phase !== 'waiting-context') phase = 'preparing';
    invalidate(reason); arm();
    return request();
  }
  function prepareOwned(ticket) {
    const terminalSignal = stop.signal;
    // Terminal cancellation releases our Promise even if an external operation
    // ignores abort. A superseded nonterminal attempt still drains serially.
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => terminalSignal.removeEventListener('abort', onStop);
      const onStop = () => { if (settled) return; settled = true; cleanup(); reject(terminalSignal.reason); };
      terminalSignal.addEventListener('abort', onStop, { once: true });
      if (terminalSignal.aborted) { onStop(); return; }
      Promise.resolve().then(() => {
        terminalSignal.throwIfAborted();
        return prepare(ticket);
      }).then(value => {
        if (settled) { if (value) discard(value); return; }
        settled = true; cleanup(); resolve(value);
      }, error => { if (!settled) { settled = true; cleanup(); reject(error); } });
    });
  }
  async function drain() {
    while (active && requested && !disposed) {
      requested = false;
      const identity = capture();
      if (identity == null) break;
      const controller = new AbortController();
      const ticket = Object.freeze({ recoveryId, attemptId: ++attemptId, revision, identity, signal: controller.signal });
      current = { ticket, controller };
      account(); phase = 'preparing'; arm();
      let candidate = null, adopted = false;
      try {
        candidate = await prepareOwned(ticket);
        if (!isCurrent(ticket)) {
          if (owns(ticket)) requested = true;
          continue;
        }
        adopted = commit(ticket, candidate) === true;
        if (!adopted) {
          if (owns(ticket) && isTargetCurrent(identity)) throw new Error('GPU recovery admission rejected current resources.');
          if (owns(ticket)) requested = true;
          continue;
        }
        if (!owns(ticket)) continue;
        account(); phase = 'awaiting-frame'; requested = false; lastReason = 'resources-ready'; arm();
        onCommitted(ticket);
        if (isCurrent(ticket)) settleDevice(ticket);
        return true;
      } catch (error) {
        if (!owns(ticket)) {
          if (adopted && !disposed && !fallback && ticket.revision === revision && ticket.recoveryId === recoveryId) fail(error);
          continue;
        }
        if (!isTargetCurrent(identity)) requested = true;
        else if (error?.name === 'AbortError') {
          if (!abortIdentity || !isTargetCurrent(abortIdentity)) { abortIdentity = identity; unexplainedAborts = 0; }
          if (unexplainedAborts++ === 0) { lastReason = 'retry-unexplained-abort'; requested = true; }
          else fail(error);
        } else fail(error);
      } finally {
        if (candidate && !adopted) discard(candidate);
        if (current?.ticket === ticket && phase !== 'awaiting-frame') current = null;
      }
    }
    return false;
  }
  return Object.freeze({
    beginLoss, request, supersede, cancel, isCurrent,
    currentTicket: () => active ? current?.ticket || null : null,
    noteProgress(ticket, { bytes = 0, stage = '' } = {}) {
      if (!isCurrent(ticket)) return false;
      account();
      // Progress is called inside synchronous GL upload steps. Replacing the
      // canvas here would invalidate their finally/binding restoration. Deliver
      // an already-due failure through the owned timer, never reentrantly.
      if (deadlineKind()) { arm(); return false; }
      const positive = Number.isFinite(bytes) && bytes > 0;
      const milestone = typeof stage === 'string' && stage !== '' && !milestones.has(stage);
      if (!positive && !milestone) return false;
      if (positive) uploadedBytes += bytes;
      if (milestone) milestones.add(stage);
      idleMs = 0; arm(); return true;
    },
    setSuspended(value) {
      if (disposed) return;
      account(); suspended = value === true; arm();
    },
    setDataWaiting(value) {
      if (disposed) return;
      account(); dataWaiting = value === true; arm();
    },
    beginFallback(reason, reserved = null) {
      if (disposed || reserved && !ownsFallback(reserved)) return null;
      const ticket = reserved || reserveFallback(reason);
      if (!ticket || !ownsFallback(ticket) || fallback.claimed || phase !== 'awaiting-canvas') return null;
      fallback.claimed = true;
      return ticket;
    },
    fallbackTicket: () => phase === 'awaiting-canvas' ? fallback?.ticket || null : null,
    fallbackUsable(ticket) {
      if (!ownsFallback(ticket) || phase !== 'awaiting-canvas') return false;
      fallback.usable = true; settleDevice(null); return true;
    },
    failFallback,
    completeFallback(ticket) {
      if (!ownsFallback(ticket) || phase !== 'awaiting-canvas') return false;
      account(); clearTimer(); phase = 'canvas'; lastReason = 'canvas-frame-presented';
      settleDevice(null); return true;
    },
    waitForDevice() {
      if (disposed) return Promise.reject(abortError('Renderer disposed'));
      if (terminalError) return Promise.reject(terminalError);
      if (phase === 'awaiting-frame' && current && isCurrent(current.ticket)) return Promise.resolve(current.ticket);
      if (!active && (phase !== 'awaiting-canvas' || fallback.usable)) return Promise.resolve(null);
      return new Promise((resolve, reject) => deviceWaiters.add({ resolve, reject }));
    },
    preparedTicket: () => phase === 'awaiting-frame' ? current?.ticket || null : null,
    complete(ticket) {
      if (phase !== 'awaiting-frame' || !isCurrent(ticket)) return false;
      account(); clearTimer(); active = false; requested = false; current = null;
      phase = 'complete'; lastReason = 'frame-presented'; settleDevice(ticket); return true;
    },
    dispose() { if (disposed) return; cancel('disposed'); disposed = true; },
    snapshot: () => Object.freeze({ recoveryId, attemptId, active, disposed,
      running: running !== null, queued: requested, phase, lastReason,
      foregroundMs, idleMs, contextMs, canvasMs, uploadedBytes, suspended,
      dataWaiting, timerPending: timer !== null, deviceWaiterCount: deviceWaiters.size, unexplainedAborts }),
  });
}
