/** Own startup ordering, recoverable startup and termination; BFCache stays alive. */
export function createApplicationLifecycle({
  window,
  document = window?.document,
  compose = [],
  startup,
  getDisposables = () => [],
  onReady = () => {},
  onError = () => {},
  shouldRetryStartup = null,
  shouldRetryCompose = null,
  onRecoverableError = () => {},
  reportDisposeError = () => {},
} = {}) {
  let started;
  let disposed = false, composed = false, running = false, retryPending = false, listening = false;
  let wakeRevision = 0, compositionIndex = 0;
  const pagehide = event => { if (!event.persisted) dispose(); };
  const available = () => document?.visibilityState !== 'hidden' && window.navigator?.onLine !== false;
  const wake = () => {
    if (disposed || !available()) return;
    wakeRevision++;
    if (retryPending && !running) resume();
  };
  function resume() {
    start().catch(error => {
      try { reportDisposeError(error); } catch (_) { /* Do not leak event rejections. */ }
    });
  }
  function listen() {
    if (listening) return;
    listening = true;
    window.addEventListener('pagehide', pagehide);
    if (shouldRetryStartup || shouldRetryCompose) {
      for (const type of ['focus', 'online', 'pageshow']) window.addEventListener(type, wake);
      document?.addEventListener('visibilitychange', wake);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    retryPending = false;
    window.removeEventListener('pagehide', pagehide);
    for (const type of ['focus', 'online', 'pageshow']) window.removeEventListener(type, wake);
    document?.removeEventListener('visibilitychange', wake);
    for (const resource of getDisposables()) {
      try { resource?.dispose?.(); }
      catch (error) {
        try { reportDisposeError(error); } catch (_) { /* Release remaining resources. */ }
      }
    }
  }
  function fatal(error) {
    try {
      window.dispatchEvent(new window.CustomEvent('pandolab:error', { detail: error?.message || String(error) }));
      onError(error);
    } finally { dispose(); }
    return false;
  }
  function start() {
    if (disposed) return Promise.resolve(false);
    if (started && (running || !retryPending)) return started;
    listen();
    running = true;
    retryPending = false;
    const attemptWakeRevision = wakeRevision;
    let phase = 'compose';
    // Reentrant callers share this attempt. Composition is never replayed.
    started = Promise.resolve().then(async () => {
      if (!composed) {
        while (compositionIndex < compose.length) {
          if (disposed) return false;
          await compose[compositionIndex]();
          compositionIndex++;
        }
        composed = true;
      }
      if (disposed) return false;
      phase = 'startup';
      const accepted = await startup();
      if (disposed || (accepted === false && (shouldRetryStartup || shouldRetryCompose))) return false;
      phase = 'ready';
      await onReady({isActive:()=>!disposed});
      if (disposed) return false;
      window.dispatchEvent(new window.CustomEvent('pandolab:ready'));
      return true;
    }).catch(error => {
      if (disposed) return false;
      try {
        if ((phase === 'startup' && shouldRetryStartup?.(error))
          || (phase === 'compose' && shouldRetryCompose?.(error, compositionIndex))) {
          retryPending = true;
          onRecoverableError(error, { retry: start });
          return false;
        }
      } catch (recoveryError) { return fatal(recoveryError); }
      return fatal(error);
    }).finally(() => {
      running = false;
      // A resume event may arrive just before the interrupted request rejects.
      if (!disposed && retryPending && available() && wakeRevision > attemptWakeRevision) resume();
    });
    return started;
  }

  return Object.freeze({ start, dispose });
}
