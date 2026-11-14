/** Single recovery owner. The renderer owns GL, document lifecycle and frame evidence.
 * Device readiness releases preparation; only an accepted frame completes recovery.
 * Timers charge foreground work, never hidden/frozen or explicit external-data waits.
 */
export function createGpuContextRecovery({ capture, isTargetCurrent, prepare, commit, discard, onCommitted, onFailure,
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay), clearSchedule = id => clearTimeout(id),
  isSuspended = () => false,
} = {}) {
  for (const fn of [capture, isTargetCurrent, prepare, commit, discard, onCommitted, onFailure,
    now, schedule, clearSchedule, isSuspended]) {
    if (typeof fn !== 'function') throw new TypeError('GPU recovery callbacks are required.');
  }
  const contextLimit = 5000, idleLimit = 5000, totalLimit = 30000;
  let recoveryId = 0, attemptId = 0, revision = 0;
  let active = false, disposed = false, requested = false, running = null, current = null;
  let lastReason = '', unexplainedAborts = 0, abortIdentity = null, phase = 'idle';
  let terminalError = null, stop = new AbortController();
  let timer = null, timerVersion = 0, sampledAt = now(), suspended = isSuspended(), dataWaiting = false;
  let foregroundMs = 0, idleMs = 0, contextMs = 0, uploadedBytes = 0;
  const milestones = new Set(), deviceWaiters = new Set();
  const abortError = reason => Object.assign(new Error(reason), { name: 'AbortError' });
  const owns = ticket => active && !disposed && current?.ticket === ticket
    && ticket.recoveryId === recoveryId && ticket.revision === revision;
  const isCurrent = ticket => owns(ticket) && !ticket.signal.aborted && isTargetCurrent(ticket.identity);
  const monitored = () => active;
  const dataPaused = () => dataWaiting && phase === 'awaiting-frame';
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
    }
  }
  function invalidate(reason, terminal = false) {
    revision++;
    lastReason = reason;
    current?.controller.abort(abortError(reason));
    if (terminal) stop.abort(abortError(reason));
  }
  function fail(error) {
    if (disposed || terminalError) return;
    account(); clearTimer(); active = false; requested = false;
    phase = 'failed'; terminalError = error;
    invalidate(error?.code || error?.message || 'recovery-failed', true);
    current = null; settleDevice(null, error);
    onFailure(error);
  }
  function deadlineKind() {
    let kind = '';
    if (active && foregroundMs >= totalLimit) kind = 'TOTAL';
    else if (active && phase === 'waiting-context' && contextMs >= contextLimit) kind = 'CONTEXT';
    else if (active && phase !== 'waiting-context' && idleMs >= idleLimit) kind = 'IDLE';
    return kind;
  }
  function expired() {
    const kind = deadlineKind();
    if (!kind) return false;
    const error = Object.assign(new Error(`GPU recovery ${kind.toLowerCase()} deadline exceeded`),
      { code: `PL-GPU-RECOVERY-${kind}-TIMEOUT` });
    fail(error);
    return true;
  }
  function arm() {
    clearTimer();
    if (disposed || !monitored() || suspended || dataPaused()) return;
    const delay = Math.min(totalLimit - foregroundMs,
      phase === 'waiting-context' ? contextLimit - contextMs : idleLimit - idleMs);
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
    if (disposed || terminalError) return;
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
          if (adopted && !disposed && !terminalError && ticket.revision === revision && ticket.recoveryId === recoveryId) fail(error);
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
    waitForDevice() {
      if (disposed) return Promise.reject(abortError('Renderer disposed'));
      if (terminalError) return Promise.reject(terminalError);
      if (phase === 'awaiting-frame' && current && isCurrent(current.ticket)) return Promise.resolve(current.ticket);
      if (!active) return Promise.resolve(null);
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
      foregroundMs, idleMs, contextMs, uploadedBytes, suspended,
      dataWaiting, timerPending: timer !== null, deviceWaiterCount: deviceWaiters.size, unexplainedAborts }),
  });
}
