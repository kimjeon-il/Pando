const DEFAULT_QUIET_WINDOW_MS = 500;

const nowDefault = () => (globalThis.performance?.now?.() ?? Date.now());

export function createStartupTaskGate({
  quietWindowMs = DEFAULT_QUIET_WINDOW_MS,
  requestIdleCallback = globalThis.requestIdleCallback?.bind(globalThis),
  cancelIdleCallback = globalThis.cancelIdleCallback?.bind(globalThis),
  isInputPending = () => globalThis.navigator?.scheduling?.isInputPending?.() === true,
  isDocumentHidden = () => globalThis.document?.visibilityState === 'hidden',
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  now = nowDefault,
  onStateChange = () => {},
  onDeferral = () => {},
} = {}) {
  const pending = new Map();
  let state = 'preview';
  let lastInputAt = now();
  let interactionActive = false;
  let paintReady = false;
  let running = false;
  let disposed = false;
  let timerId = 0;
  let idleId = 0;
  const quietWaiters = new Set();

  const publishState = next => {
    if (state === next) return;
    state = next;
    onStateChange(next);
  };

  const cancelScheduledCheck = () => {
    if (timerId) clearTimer?.(timerId);
    if (idleId && cancelIdleCallback) cancelIdleCallback(idleId);
    timerId = 0;
    idleId = 0;
  };

  const defer = reason => {
    onDeferral(reason);
    if (reason !== 'quiet-window') lastInputAt = now();
    cancelScheduledCheck();
    scheduleCheck();
  };

  const runNext = async () => {
    if (disposed || running || !paintReady || !pending.size) return;
    const taskNotBefore = pending.values().next().value?.notBefore || 0;
    const elapsed = now() - Math.max(lastInputAt, taskNotBefore - quietWindowMs);
    if (interactionActive) return defer('interaction-active');
    if (isDocumentHidden()) return defer('document-hidden');
    if (elapsed < quietWindowMs) return defer('quiet-window');
    if (isInputPending()) {
      lastInputAt = now();
      return defer('input-pending');
    }

    const [key, task] = pending.entries().next().value;
    pending.delete(key);
    running = true;
    publishState(task.runningState || state);
    try {
      await task.run();
    } finally {
      running = false;
      if (!disposed && pending.size) scheduleCheck();
    }
  };

  function scheduleCheck() {
    if (disposed || running || !paintReady || !pending.size || timerId || idleId) return;
    const delay = Math.max(0, quietWindowMs - (now() - lastInputAt), (pending.values().next().value?.notBefore || 0) - now());
    timerId = setTimer?.(() => {
      timerId = 0;
      if (requestIdleCallback) {
        let firedSynchronously = false;
        const requestedId = requestIdleCallback(() => {
          firedSynchronously = true;
          idleId = 0;
          void runNext();
        }, { timeout: quietWindowMs });
        if (!firedSynchronously) idleId = requestedId;
      } else {
        void runNext();
      }
    }, delay || 1);
  }

  function queue(key, run, { queuedState = '', runningState = '', quietAfterQueue = false } = {}) {
    if (disposed || typeof run !== 'function') return false;
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || pending.has(normalizedKey)) return false;
    pending.set(normalizedKey, { run, runningState, notBefore: quietAfterQueue ? now() + quietWindowMs : 0 });
    if (queuedState) publishState(queuedState);
    scheduleCheck();
    return true;
  }

  function noteInput({ active = interactionActive, pulse = true } = {}) {
    if (disposed) return;
    const nextActive = !!active;
    if (pulse || nextActive || nextActive !== interactionActive) lastInputAt = now();
    interactionActive = nextActive;
    cancelScheduledCheck();
    scheduleCheck();
  }

  function markInteractivePaint() {
    if (disposed || paintReady) return;
    paintReady = true;
    lastInputAt = now();
    publishState('interactive');
    scheduleCheck();
  }

  function waitForQuiet() {
    if (disposed) return Promise.resolve();
    return new Promise(resolve => {
      const waiter = { timerId: 0, resolve };
      quietWaiters.add(waiter);
      const check = () => {
        waiter.timerId = 0;
        if (disposed) {
          quietWaiters.delete(waiter);
          resolve();
          return;
        }
        const elapsed = now() - lastInputAt;
        if (paintReady && !interactionActive && !isDocumentHidden() && elapsed >= quietWindowMs && !isInputPending()) {
          quietWaiters.delete(waiter);
          resolve();
          return;
        }
        if (isInputPending()) lastInputAt = now();
        const delay = Math.max(1, quietWindowMs - (now() - lastInputAt));
        waiter.timerId = setTimer?.(check, delay);
      };
      check();
    });
  }

  function yieldFrame() {
    if (disposed) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      let fallbackTimer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) clearTimer?.(fallbackTimer);
        resolve();
      };
      fallbackTimer = setTimer?.(finish, 32);
      if (requestFrame) requestFrame(finish);
      else if (!fallbackTimer) finish();
    });
  }

  function dispose() {
    disposed = true;
    cancelScheduledCheck();
    pending.clear();
    for (const waiter of quietWaiters) {
      if (waiter.timerId) clearTimer?.(waiter.timerId);
      waiter.resolve();
    }
    quietWaiters.clear();
  }

  return Object.freeze({
    dispose,
    getState: () => Object.freeze({
      state,
      paintReady,
      interactionActive,
      running,
      pendingKeys: Object.freeze([...pending.keys()]),
      lastInputAt,
    }),
    markInteractivePaint,
    noteInput,
    queue,
    setState: publishState,
    waitForQuiet,
    yieldFrame,
  });
}
